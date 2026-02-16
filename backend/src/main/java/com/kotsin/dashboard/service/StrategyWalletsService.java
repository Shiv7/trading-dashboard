package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.dto.StrategyWalletDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import java.time.*;
import java.util.*;

@Service
@Slf4j
@RequiredArgsConstructor
public class StrategyWalletsService {

    private final MongoTemplate mongoTemplate;

    private static final double INITIAL_CAPITAL = 100_000.0;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private static final List<String> STRATEGY_KEYS = List.of(
            "FUDKII", "FUKAA", "PIVOT_CONFLUENCE", "MICROALPHA"
    );
    private static final Map<String, String> DISPLAY_NAMES = Map.of(
            "FUDKII", "FUDKII",
            "FUKAA", "FUKAA",
            "PIVOT_CONFLUENCE", "PIVOT",
            "MICROALPHA", "MICROALPHA"
    );

    // ─────────────────────────────────────────────
    //  Summary: per-strategy wallet cards
    // ─────────────────────────────────────────────
    public List<StrategyWalletDTO.StrategySummary> getSummaries() {
        Map<String, double[]> stats = new LinkedHashMap<>();
        for (String key : STRATEGY_KEYS) {
            stats.put(key, new double[3]); // [totalPnl, wins, losses]
        }

        try {
            mongoTemplate.getCollection("trade_outcomes").find().forEach(doc -> {
                String raw = extractStrategy(doc);
                String norm = normalizeStrategy(raw);
                if (norm == null) return;

                double[] arr = stats.get(norm);
                if (arr == null) return;

                double pnl = getDouble(doc, "pnl");
                arr[0] += pnl;
                boolean isWin = Boolean.TRUE.equals(doc.getBoolean("isWin")) || pnl > 0;
                if (isWin) arr[1]++;
                else arr[2]++;
            });
        } catch (Exception e) {
            log.error("Error computing strategy wallet summaries: {}", e.getMessage());
        }

        List<StrategyWalletDTO.StrategySummary> result = new ArrayList<>();
        for (String key : STRATEGY_KEYS) {
            double[] arr = stats.get(key);
            double totalPnl = arr[0];
            int wins = (int) arr[1];
            int losses = (int) arr[2];
            int total = wins + losses;
            double winRate = total > 0 ? (double) wins / total * 100 : 0;
            double current = INITIAL_CAPITAL + totalPnl;

            result.add(StrategyWalletDTO.StrategySummary.builder()
                    .strategy(key)
                    .displayName(DISPLAY_NAMES.getOrDefault(key, key))
                    .initialCapital(INITIAL_CAPITAL)
                    .currentCapital(round2(current))
                    .totalPnl(round2(totalPnl))
                    .totalPnlPercent(round2(totalPnl / INITIAL_CAPITAL * 100))
                    .totalTrades(total)
                    .wins(wins)
                    .losses(losses)
                    .winRate(round2(winRate))
                    .build());
        }
        return result;
    }

    // ─────────────────────────────────────────────
    //  Weekly trades with filters
    // ─────────────────────────────────────────────
    public List<StrategyWalletDTO.StrategyTrade> getWeeklyTrades(
            String strategy, String direction, String exchange,
            String sortBy, int limit) {

        List<StrategyWalletDTO.StrategyTrade> trades = new ArrayList<>();

        try {
            // Monday 00:00 IST of current week
            LocalDate today = LocalDate.now(IST);
            LocalDate monday = today.with(DayOfWeek.MONDAY);
            Instant weekStart = monday.atStartOfDay(IST).toInstant();

            Document query = new Document("exitTime", new Document("$gte", Date.from(weekStart)));

            // Determine sort field and direction
            String mongoSortField = "exitTime";
            int sortDir = -1; // desc by default
            if ("pnl".equals(sortBy)) mongoSortField = "pnl";
            else if ("pnlPercent".equals(sortBy)) mongoSortField = "pnlPercent";
            else if ("companyName".equals(sortBy)) { mongoSortField = "companyName"; sortDir = 1; }

            mongoTemplate.getCollection("trade_outcomes")
                    .find(query)
                    .sort(new Document(mongoSortField, sortDir))
                    .limit(Math.min(limit, 500))
                    .forEach(doc -> {
                        StrategyWalletDTO.StrategyTrade trade = parseTrade(doc);
                        if (trade == null) return;

                        // Apply filters
                        if (strategy != null && !strategy.isEmpty() && !"ALL".equals(strategy)) {
                            if (!strategy.equals(trade.getStrategy())) return;
                        }
                        if (direction != null && !direction.isEmpty() && !"ALL".equals(direction)) {
                            if (!direction.equals(trade.getDirection())) return;
                        }
                        if (exchange != null && !exchange.isEmpty() && !"ALL".equals(exchange)) {
                            if (!exchange.equals(trade.getExchange())) return;
                        }

                        trades.add(trade);
                    });
        } catch (Exception e) {
            log.error("Error fetching weekly strategy trades: {}", e.getMessage());
        }

        return trades;
    }

    // ─────────────────────────────────────────────
    //  Parse single trade_outcomes document
    // ─────────────────────────────────────────────
    private StrategyWalletDTO.StrategyTrade parseTrade(Document doc) {
        try {
            double entryPrice = getDouble(doc, "entryPrice");
            double exitPrice = getDouble(doc, "exitPrice");
            double pnl = getDouble(doc, "pnl");

            String side = determineSide(doc);

            // Read stored pnlPercent first; fallback to per-share price diff
            double pnlPct = getDouble(doc, "pnlPercent");
            if (pnlPct == 0 && pnl != 0 && entryPrice > 0) {
                pnlPct = "SHORT".equals(side)
                        ? ((entryPrice - exitPrice) / entryPrice) * 100
                        : ((exitPrice - entryPrice) / entryPrice) * 100;
            }
            String dir = "LONG".equals(side) ? "BULLISH" : "BEARISH";
            String exitReason = doc.getString("exitReason");
            String raw = extractStrategy(doc);
            String norm = normalizeStrategy(raw);
            if (norm == null) norm = raw != null ? raw : "UNKNOWN";

            // Read target/stop hit booleans from document first, fallback to exitReason parsing
            boolean stopHit = Boolean.TRUE.equals(doc.getBoolean("stopHit"));
            boolean t1 = Boolean.TRUE.equals(doc.getBoolean("target1Hit"));
            boolean t2 = Boolean.TRUE.equals(doc.getBoolean("target2Hit"));
            boolean t3 = Boolean.TRUE.equals(doc.getBoolean("target3Hit"));
            boolean t4 = Boolean.TRUE.equals(doc.getBoolean("target4Hit"));

            // Fallback: parse from exitReason if no booleans set
            if (!stopHit && !t1 && !t2 && !t3 && !t4 && exitReason != null) {
                String upper = exitReason.toUpperCase();
                stopHit = upper.contains("STOP") || upper.contains("SL");
                // SWITCH/REVERSAL and EOD leave all target flags false -- exitReason speaks for itself
                if (!stopHit && !upper.contains("SWITCH") && !upper.contains("REVERSAL")
                        && !upper.contains("EOD") && !upper.contains("END_OF_DAY") && !upper.contains("TIME_EXPIRY")) {
                    t4 = upper.contains("TARGET_4") || upper.contains("TP4") || upper.contains("T4");
                    t3 = t4 || upper.contains("TARGET_3") || upper.contains("TP3") || upper.contains("T3");
                    t2 = t3 || upper.contains("TARGET_2") || upper.contains("TP2") || upper.contains("T2");
                    t1 = t2 || upper.contains("TARGET") || upper.contains("TP1") || upper.contains("T1");
                }
            }

            return StrategyWalletDTO.StrategyTrade.builder()
                    .tradeId(doc.getString("signalId"))
                    .scripCode(doc.getString("scripCode"))
                    .companyName(doc.getString("companyName"))
                    .side(side)
                    .direction(dir)
                    .entryPrice(round2(entryPrice))
                    .exitPrice(round2(exitPrice))
                    .entryTime(parseDateTime(doc.get("entryTime")))
                    .exitReason(exitReason)
                    .target1Hit(t1)
                    .target2Hit(t2)
                    .target3Hit(t3)
                    .target4Hit(t4)
                    .stopHit(stopHit)
                    .pnl(round2(pnl))
                    .pnlPercent(round2(pnlPct))
                    .exitTime(parseDateTime(doc.get("exitTime")))
                    .strategy(DISPLAY_NAMES.getOrDefault(norm, norm))
                    .exchange(extractExchange(doc))
                    .build();
        } catch (Exception e) {
            log.warn("Error parsing strategy trade: {}", e.getMessage());
            return null;
        }
    }

    // ─────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────

    private String extractStrategy(Document doc) {
        String s = doc.getString("signalSource");
        if (s == null || s.isEmpty()) s = doc.getString("strategy");
        if (s == null || s.isEmpty()) s = doc.getString("signalType");
        return s;
    }

    private String normalizeStrategy(String raw) {
        if (raw == null) return null;
        String upper = raw.toUpperCase();
        if (upper.contains("FUDKII")) return "FUDKII";
        if (upper.contains("FUKAA")) return "FUKAA";
        if (upper.contains("PIVOT")) return "PIVOT_CONFLUENCE";
        if (upper.contains("MICRO")) return "MICROALPHA";
        return null; // not one of the 4 strategies
    }

    private String determineSide(Document doc) {
        String side = doc.getString("side");
        if (side != null && !side.isEmpty()) {
            return side.toUpperCase().contains("SHORT") ? "SHORT" : "LONG";
        }
        String dir = doc.getString("direction");
        if (dir != null && !dir.isEmpty()) {
            return dir.toUpperCase().contains("BEAR") || dir.toUpperCase().contains("SHORT") ? "SHORT" : "LONG";
        }
        double entry = getDouble(doc, "entryPrice");
        double stop = getDouble(doc, "stopLoss");
        return entry > stop ? "LONG" : "SHORT";
    }

    private String extractExchange(Document doc) {
        String exch = doc.getString("exchange");
        if (exch != null && !exch.isEmpty()) return exch.substring(0, 1).toUpperCase();
        return "N";
    }

    private LocalDateTime parseDateTime(Object obj) {
        if (obj == null) return null;
        try {
            if (obj instanceof Long) {
                return LocalDateTime.ofInstant(Instant.ofEpochMilli((Long) obj), IST);
            } else if (obj instanceof java.util.Date) {
                return LocalDateTime.ofInstant(((java.util.Date) obj).toInstant(), IST);
            } else if (obj instanceof String) {
                return LocalDateTime.parse((String) obj);
            }
        } catch (Exception e) { /* ignore */ }
        return null;
    }

    private double getDouble(Document doc, String key) {
        Object val = doc.get(key);
        return val instanceof Number ? ((Number) val).doubleValue() : 0;
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
