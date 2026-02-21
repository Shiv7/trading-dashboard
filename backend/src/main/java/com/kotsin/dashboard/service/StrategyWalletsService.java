package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.StrategyWalletDTO;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.*;
import java.util.*;

@Service
@Slf4j
public class StrategyWalletsService {

    @Autowired
    private MongoTemplate mongoTemplate;

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Autowired(required = false)
    private ScripLookupService scripLookup;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final double INITIAL_CAPITAL = 100_000.0;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private static final List<String> STRATEGY_KEYS = List.of(
            "FUDKII", "FUKAA", "PIVOT_CONFLUENCE", "MICROALPHA", "MERE"
    );
    private static final Map<String, String> DISPLAY_NAMES = Map.of(
            "FUDKII", "FUDKII",
            "FUKAA", "FUKAA",
            "PIVOT_CONFLUENCE", "PIVOT",
            "MICROALPHA", "MICROALPHA",
            "MERE", "MERE"
    );

    // ─────────────────────────────────────────────
    //  Summary: per-strategy wallet cards
    // ─────────────────────────────────────────────
    public List<StrategyWalletDTO.StrategySummary> getSummaries() {
        Map<String, double[]> stats = new LinkedHashMap<>();
        for (String key : STRATEGY_KEYS) {
            stats.put(key, new double[3]); // [totalPnl, wins, losses]
        }

        // Realized P&L from closed trades
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

        // Unrealized P&L from active Redis positions
        try {
            List<Map<String, Object>> activePositions = getActivePositions();
            for (Map<String, Object> pos : activePositions) {
                String strategy = (String) pos.get("strategy");
                String norm = normalizeStrategy(strategy);
                if (norm == null) continue;

                double[] arr = stats.get(norm);
                if (arr == null) continue;

                double unrealizedPnl = pos.get("unrealizedPnl") != null
                        ? ((Number) pos.get("unrealizedPnl")).doubleValue() : 0;
                arr[0] += unrealizedPnl;
                // Active positions don't count as win/loss yet
            }
        } catch (Exception e) {
            log.error("Error adding active position P&L to summaries: {}", e.getMessage());
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
    //  Weekly trades with filters + active positions
    // ─────────────────────────────────────────────
    public List<StrategyWalletDTO.StrategyTrade> getWeeklyTrades(
            String strategy, String direction, String exchange,
            String sortBy, int limit) {

        List<StrategyWalletDTO.StrategyTrade> trades = new ArrayList<>();

        // 1. Active positions from Redis (shown first)
        try {
            List<Map<String, Object>> activePositions = getActivePositions();
            for (Map<String, Object> pos : activePositions) {
                StrategyWalletDTO.StrategyTrade trade = activePositionToTrade(pos);
                if (trade == null) continue;

                // Apply filters
                if (strategy != null && !strategy.isEmpty() && !"ALL".equals(strategy)) {
                    if (!strategy.equals(trade.getStrategy())) continue;
                }
                if (direction != null && !direction.isEmpty() && !"ALL".equals(direction)) {
                    if (!direction.equals(trade.getDirection())) continue;
                }
                if (exchange != null && !exchange.isEmpty() && !"ALL".equals(exchange)) {
                    if (!exchange.equals(trade.getExchange())) continue;
                }

                trades.add(trade);
            }
        } catch (Exception e) {
            log.error("Error fetching active positions for trades: {}", e.getMessage());
        }

        // 2. Closed trades from MongoDB
        try {
            LocalDate today = LocalDate.now(IST);
            LocalDate monday = today.with(DayOfWeek.MONDAY);
            Instant weekStart = monday.atStartOfDay(IST).toInstant();

            Document query = new Document("exitTime", new Document("$gte", Date.from(weekStart)));

            String mongoSortField = "exitTime";
            int sortDir = -1;
            if ("pnl".equals(sortBy)) mongoSortField = "pnl";
            else if ("pnlPercent".equals(sortBy)) mongoSortField = "pnlPercent";
            else if ("companyName".equals(sortBy)) { mongoSortField = "companyName"; sortDir = 1; }

            mongoTemplate.getCollection("trade_outcomes")
                    .find(query)
                    .sort(new Document(mongoSortField, sortDir))
                    .limit(Math.min(limit, 1000))
                    .forEach(doc -> {
                        StrategyWalletDTO.StrategyTrade trade = parseTrade(doc);
                        if (trade == null) return;

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
    //  Read active positions from Redis
    // ─────────────────────────────────────────────
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> getActivePositions() {
        List<Map<String, Object>> positions = new ArrayList<>();
        if (redisTemplate == null) return positions;

        try {
            Set<String> keys = redisTemplate.keys("virtual:positions:*");
            if (keys == null || keys.isEmpty()) return positions;

            for (String key : keys) {
                try {
                    String json = redisTemplate.opsForValue().get(key);
                    if (json == null) continue;

                    Map<String, Object> data = objectMapper.readValue(json, Map.class);
                    int qtyOpen = data.get("qtyOpen") != null ? ((Number) data.get("qtyOpen")).intValue() : 0;
                    if (qtyOpen <= 0) continue;

                    // Extract strategy: signalSource -> signalType -> strategy -> signalId pattern
                    String strat = data.get("signalSource") != null ? data.get("signalSource").toString() : null;
                    if (strat == null || strat.isEmpty()) {
                        strat = data.get("signalType") != null ? data.get("signalType").toString() : null;
                    }
                    if (strat == null || strat.isEmpty()) {
                        strat = data.get("strategy") != null ? data.get("strategy").toString() : null;
                    }
                    // Last resort: parse signalId pattern (e.g. "FUKAA_LONG_472781_..." -> "FUKAA")
                    if ((strat == null || strat.isEmpty()) && data.get("signalId") != null) {
                        String sid = data.get("signalId").toString();
                        if (sid.contains("_")) {
                            strat = sid.substring(0, sid.indexOf("_"));
                        }
                    }
                    data.put("strategy", strat);

                    // Resolve company name — prefer instrumentSymbol (option/futures display name from trade)
                    String scripCode = data.get("scripCode") != null ? data.get("scripCode").toString()
                            : key.replace("virtual:positions:", "");
                    data.put("scripCode", scripCode);
                    if (data.get("instrumentSymbol") != null) {
                        data.put("companyName", data.get("instrumentSymbol").toString());
                    } else if (scripLookup != null) {
                        try {
                            String name = scripLookup.resolve(scripCode);
                            if (name != null && !name.isEmpty()) {
                                data.put("companyName", name);
                            }
                        } catch (Exception ignored) {}
                    }

                    positions.add(data);
                } catch (Exception e) {
                    log.warn("Error parsing Redis position {}: {}", key, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Error reading active positions from Redis: {}", e.getMessage());
        }

        return positions;
    }

    // ─────────────────────────────────────────────
    //  Convert active Redis position to StrategyTrade
    // ─────────────────────────────────────────────
    private StrategyWalletDTO.StrategyTrade activePositionToTrade(Map<String, Object> pos) {
        try {
            String scripCode = (String) pos.get("scripCode");
            String companyName = pos.get("companyName") != null ? pos.get("companyName").toString() : scripCode;
            String side = pos.get("side") != null ? pos.get("side").toString() : "LONG";
            boolean isLong = side.toUpperCase().contains("LONG");
            String dir = isLong ? "BULLISH" : "BEARISH";

            double avgEntry = pos.get("avgEntry") != null ? ((Number) pos.get("avgEntry")).doubleValue() : 0;
            double currentPrice = pos.get("currentPrice") != null ? ((Number) pos.get("currentPrice")).doubleValue() : avgEntry;
            double unrealizedPnl = pos.get("unrealizedPnl") != null ? ((Number) pos.get("unrealizedPnl")).doubleValue() : 0;

            double pnlPct = avgEntry > 0
                    ? (isLong ? (currentPrice - avgEntry) / avgEntry * 100 : (avgEntry - currentPrice) / avgEntry * 100)
                    : 0;

            String rawStrategy = (String) pos.get("strategy");
            String norm = normalizeStrategy(rawStrategy);
            String displayName = norm != null ? DISPLAY_NAMES.getOrDefault(norm, norm) : (rawStrategy != null ? rawStrategy : "UNKNOWN");

            boolean tp1Hit = Boolean.TRUE.equals(pos.get("tp1Hit"));

            // Parse openedAt timestamp
            LocalDateTime entryTime = null;
            if (pos.get("openedAt") != null) {
                long ms = ((Number) pos.get("openedAt")).longValue();
                entryTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), IST);
            }

            int qtyOpen = pos.get("qtyOpen") != null ? ((Number) pos.get("qtyOpen")).intValue() : 0;
            double capitalEmployed = avgEntry * qtyOpen;

            return StrategyWalletDTO.StrategyTrade.builder()
                    .tradeId(pos.get("signalId") != null ? pos.get("signalId").toString() : "active:" + scripCode)
                    .scripCode(scripCode)
                    .companyName(companyName)
                    .side(isLong ? "LONG" : "SHORT")
                    .direction(dir)
                    .entryPrice(round2(avgEntry))
                    .exitPrice(round2(currentPrice))
                    .quantity(qtyOpen)
                    .capitalEmployed(round2(capitalEmployed))
                    .entryTime(entryTime)
                    .exitTime(null) // null = "Active" on frontend
                    .exitReason("ACTIVE")
                    .target1Hit(tp1Hit)
                    .target2Hit(false)
                    .target3Hit(false)
                    .target4Hit(false)
                    .stopHit(false)
                    .pnl(round2(unrealizedPnl))
                    .pnlPercent(round2(pnlPct))
                    .strategy(displayName)
                    .exchange(extractExchangeFromPosition(pos))
                    .build();
        } catch (Exception e) {
            log.warn("Error converting active position to trade: {}", e.getMessage());
            return null;
        }
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

            boolean stopHit = Boolean.TRUE.equals(doc.getBoolean("stopHit"));
            boolean t1 = Boolean.TRUE.equals(doc.getBoolean("target1Hit"));
            boolean t2 = Boolean.TRUE.equals(doc.getBoolean("target2Hit"));
            boolean t3 = Boolean.TRUE.equals(doc.getBoolean("target3Hit"));
            boolean t4 = Boolean.TRUE.equals(doc.getBoolean("target4Hit"));

            if (!stopHit && !t1 && !t2 && !t3 && !t4 && exitReason != null) {
                String upper = exitReason.toUpperCase();
                stopHit = upper.contains("STOP") || upper.contains("SL");
                if (!stopHit && !upper.contains("SWITCH") && !upper.contains("REVERSAL")
                        && !upper.contains("EOD") && !upper.contains("END_OF_DAY") && !upper.contains("TIME_EXPIRY")) {
                    t4 = upper.contains("TARGET_4") || upper.contains("TP4") || upper.contains("T4");
                    t3 = t4 || upper.contains("TARGET_3") || upper.contains("TP3") || upper.contains("T3");
                    t2 = t3 || upper.contains("TARGET_2") || upper.contains("TP2") || upper.contains("T2");
                    t1 = t2 || upper.contains("TARGET") || upper.contains("TP1") || upper.contains("T1");
                }
            }

            int quantity = doc.get("quantity") instanceof Number ? ((Number) doc.get("quantity")).intValue() : 0;
            double capitalEmployed = entryPrice * quantity;

            return StrategyWalletDTO.StrategyTrade.builder()
                    .tradeId(doc.getString("signalId"))
                    .scripCode(doc.getString("scripCode"))
                    .companyName(doc.getString("companyName"))
                    .side(side)
                    .direction(dir)
                    .entryPrice(round2(entryPrice))
                    .exitPrice(round2(exitPrice))
                    .quantity(quantity)
                    .capitalEmployed(round2(capitalEmployed))
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
        if (upper.contains("MERE")) return "MERE";
        return null;
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

    private String extractExchangeFromScrip(String scripCode) {
        // Numeric scrip codes are typically NSE
        return "N";
    }

    /**
     * Extract exchange from position data, falling back to scrip-based guess.
     */
    private String extractExchangeFromPosition(Map<String, Object> pos) {
        if (pos.get("exchange") != null) {
            String exch = pos.get("exchange").toString().trim();
            if (!exch.isEmpty()) {
                return exch.substring(0, 1).toUpperCase();
            }
        }
        String scripCode = pos.get("scripCode") != null ? pos.get("scripCode").toString() : "";
        return extractExchangeFromScrip(scripCode);
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
