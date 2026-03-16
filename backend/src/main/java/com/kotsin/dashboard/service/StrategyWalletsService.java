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

    private static final double INITIAL_CAPITAL = 1_000_000.0; // 10 Lakh
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private static final List<String> STRATEGY_KEYS = StrategyNameResolver.ALL_STRATEGY_KEYS;
    private static final Map<String, String> DISPLAY_NAMES = StrategyNameResolver.DISPLAY_NAMES;

    // ─────────────────────────────────────────────
    //  Summary: per-strategy wallet cards
    // ─────────────────────────────────────────────
    @SuppressWarnings("unchecked")
    public List<StrategyWalletDTO.StrategySummary> getSummaries() {
        List<StrategyWalletDTO.StrategySummary> result = new ArrayList<>();

        for (String key : STRATEGY_KEYS) {
            String walletKey = "wallet:entity:strategy-wallet-" + key;
            try {
                String json = redisTemplate.opsForValue().get(walletKey);
                if (json != null) {
                    Map<String, Object> wallet = objectMapper.readValue(json, Map.class);

                    double initialCapital = getNumericValue(wallet, "initialCapital", INITIAL_CAPITAL);
                    double currentBalance = getNumericValue(wallet, "currentBalance", INITIAL_CAPITAL);
                    double realizedPnl = getNumericValue(wallet, "realizedPnl", 0);
                    double unrealizedPnl = getNumericValue(wallet, "unrealizedPnl", 0);
                    double totalPnl = realizedPnl + unrealizedPnl;
                    int totalTrades = getIntValue(wallet, "totalTradeCount", 0);
                    int wins = getIntValue(wallet, "totalWinCount", 0);
                    int losses = getIntValue(wallet, "totalLossCount", 0);
                    double winRate = getNumericValue(wallet, "winRate", 0);
                    double availableMargin = getNumericValue(wallet, "availableMargin", 0);
                    double usedMargin = getNumericValue(wallet, "usedMargin", 0);
                    double dayPnl = getNumericValue(wallet, "dayPnl", 0);
                    boolean circuitBreakerTripped = getBoolValue(wallet, "circuitBreakerTripped", false);

                    double pnlPercent = initialCapital > 0 ? totalPnl / initialCapital * 100 : 0;

                    double peakBalance = getNumericValue(wallet, "peakBalance", 0);
                    double maxDrawdown = getNumericValue(wallet, "maxDrawdown", 0);
                    double maxDailyLoss = getNumericValue(wallet, "maxDailyLoss", 0);
                    double maxDrawdownPercent = getNumericValue(wallet, "maxDrawdownPercent", 0);
                    double maxDailyLossPercent = initialCapital > 0 ? maxDailyLoss / initialCapital * 100 : 0;
                    double profitFactor = getNumericValue(wallet, "profitFactor", 0);
                    double avgWin = getNumericValue(wallet, "avgWin", 0);
                    double avgLoss = getNumericValue(wallet, "avgLoss", 0);
                    String circuitBreakerReason = wallet.get("circuitBreakerReason") != null
                            ? wallet.get("circuitBreakerReason").toString() : null;
                    int dayTradeCount = getIntValue(wallet, "dayTradeCount", 0);
                    int dayWinCount = getIntValue(wallet, "dayWinCount", 0);
                    int dayLossCount = getIntValue(wallet, "dayLossCount", 0);
                    int maxOpenPositions = getIntValue(wallet, "maxOpenPositions", 0);

                    result.add(StrategyWalletDTO.StrategySummary.builder()
                            .strategy(key)
                            .displayName(DISPLAY_NAMES.getOrDefault(key, key))
                            .initialCapital(round2(initialCapital))
                            .currentCapital(round2(currentBalance))
                            .totalPnl(round2(totalPnl))
                            .totalPnlPercent(round2(pnlPercent))
                            .totalTrades(totalTrades)
                            .wins(wins)
                            .losses(losses)
                            .winRate(round2(winRate))
                            .availableMargin(round2(availableMargin))
                            .usedMargin(round2(usedMargin))
                            .dayPnl(round2(dayPnl))
                            .circuitBreakerTripped(circuitBreakerTripped)
                            .peakBalance(round2(peakBalance))
                            .maxDrawdown(round2(maxDrawdown))
                            .maxDailyLoss(round2(maxDailyLoss))
                            .maxDrawdownPercent(round2(maxDrawdownPercent))
                            .maxDailyLossPercent(round2(maxDailyLossPercent))
                            .profitFactor(round2(profitFactor))
                            .avgWin(round2(avgWin))
                            .avgLoss(round2(avgLoss))
                            .circuitBreakerReason(circuitBreakerReason)
                            .unrealizedPnl(round2(unrealizedPnl))
                            .dayTradeCount(dayTradeCount)
                            .dayWinCount(dayWinCount)
                            .dayLossCount(dayLossCount)
                            .maxOpenPositions(maxOpenPositions)
                            .build());
                } else {
                    // Wallet not yet created in Redis — show empty wallet
                    result.add(StrategyWalletDTO.StrategySummary.builder()
                            .strategy(key)
                            .displayName(DISPLAY_NAMES.getOrDefault(key, key))
                            .initialCapital(INITIAL_CAPITAL)
                            .currentCapital(INITIAL_CAPITAL)
                            .totalPnl(0)
                            .totalPnlPercent(0)
                            .totalTrades(0)
                            .wins(0)
                            .losses(0)
                            .winRate(0)
                            .build());
                }
            } catch (Exception e) {
                log.error("ERR [STRATEGY-WALLETS] Failed to read wallet {}: {}", walletKey, e.getMessage());
                result.add(StrategyWalletDTO.StrategySummary.builder()
                        .strategy(key)
                        .displayName(DISPLAY_NAMES.getOrDefault(key, key))
                        .initialCapital(INITIAL_CAPITAL)
                        .currentCapital(INITIAL_CAPITAL)
                        .build());
            }
        }

        // Add unrealized P&L + MCX capital usage from active Redis positions
        try {
            List<Map<String, Object>> activePositions = getActivePositions();
            Map<String, Double> unrealizedByStrategy = new HashMap<>();
            Map<String, Double> mcxMarginByStrategy = new HashMap<>();
            for (Map<String, Object> pos : activePositions) {
                String strategy = (String) pos.get("strategy");
                String norm = StrategyNameResolver.normalize(strategy);
                if (!StrategyNameResolver.ALL_STRATEGY_KEYS.contains(norm)) continue;
                double unrealizedPnl = pos.get("unrealizedPnl") != null
                        ? ((Number) pos.get("unrealizedPnl")).doubleValue() : 0;
                unrealizedByStrategy.merge(norm, unrealizedPnl, Double::sum);

                // MCX capital: sum avgEntry * qtyOpen for exchange "M"
                String exchange = pos.get("exchange") != null ? pos.get("exchange").toString().trim() : "";
                if (exchange.equalsIgnoreCase("M")) {
                    double avgEntry = pos.get("avgEntry") != null ? ((Number) pos.get("avgEntry")).doubleValue() : 0;
                    int qtyOpen = pos.get("qtyOpen") != null ? ((Number) pos.get("qtyOpen")).intValue() : 0;
                    mcxMarginByStrategy.merge(norm, avgEntry * qtyOpen, Double::sum);
                }
            }
            // Update summaries with live unrealized P&L + MCX margin from positions
            for (StrategyWalletDTO.StrategySummary s : result) {
                Double positionUnrealized = unrealizedByStrategy.get(s.getStrategy());
                if (positionUnrealized != null && positionUnrealized != 0) {
                    // The wallet entity may not reflect real-time unrealized P&L,
                    // so add position-level unrealized to what's already in the summary
                    s.setTotalPnl(round2(s.getTotalPnl() + positionUnrealized));
                    s.setTotalPnlPercent(round2(s.getTotalPnl() / s.getInitialCapital() * 100));
                }
                Double mcxMargin = mcxMarginByStrategy.get(s.getStrategy());
                s.setMcxUsedMargin(round2(mcxMargin != null ? mcxMargin : 0));
            }
        } catch (Exception e) {
            log.error("ERR [STRATEGY-WALLETS] Error adding active position P&L: {}", e.getMessage());
        }

        return result;
    }

    // ─────────────────────────────────────────────
    //  Position counts by exchange for slot sizing
    // ─────────────────────────────────────────────
    @SuppressWarnings("unchecked")
    public Map<String, Integer> getActivePositionCountsByExchange(String strategyKey) {
        Map<String, Integer> counts = new HashMap<>();
        counts.put("N", 0);
        counts.put("M", 0);
        counts.put("C", 0);
        try {
            List<Map<String, Object>> positions = getActivePositions();
            for (Map<String, Object> pos : positions) {
                String norm = StrategyNameResolver.normalize(
                        StrategyNameResolver.extractFromRedis(pos));
                if (!strategyKey.equalsIgnoreCase(norm)) continue;
                String exch = extractExchangeFromPosition(pos);
                counts.merge(exch, 1, Integer::sum);
            }
        } catch (Exception e) {
            log.error("ERR [STRATEGY-WALLETS] Failed to count positions by exchange for {}: {}", strategyKey, e.getMessage());
        }
        return counts;
    }

    // ─────────────────────────────────────────────
    //  Weekly trades with filters + active positions
    // ─────────────────────────────────────────────
    /**
     * Get trades with flexible time range.
     * @param from  epoch millis start (inclusive), null = all time
     * @param to    epoch millis end (inclusive), null = now
     */
    public List<StrategyWalletDTO.StrategyTrade> getTrades(
            String strategy, String direction, String exchange,
            String sortBy, int limit, Long from, Long to) {

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

        // 2. Closed trades from MongoDB with time range
        try {
            Document timeFilter = new Document();
            if (from != null) {
                timeFilter.append("$gte", new Date(from));
            }
            if (to != null) {
                timeFilter.append("$lte", new Date(to));
            }

            Document query = timeFilter.isEmpty()
                    ? new Document()
                    : new Document("exitTime", timeFilter);

            String mongoSortField = "exitTime";
            int sortDir = -1;
            if ("pnl".equals(sortBy)) mongoSortField = "pnl";
            else if ("pnlPercent".equals(sortBy)) mongoSortField = "pnlPercent";
            else if ("companyName".equals(sortBy)) { mongoSortField = "companyName"; sortDir = 1; }

            mongoTemplate.getCollection("trade_outcomes")
                    .find(query)
                    .sort(new Document(mongoSortField, sortDir))
                    .limit(Math.min(limit, 5000))
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
            log.error("Error fetching strategy trades: {}", e.getMessage());
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

                    // Preserve raw signalSource as variant (e.g., MERE_SCALP) before normalization
                    String rawSource = data.get("signalSource") != null ? data.get("signalSource").toString() : null;
                    // Extract strategy via shared resolver (unified fallback + normalization)
                    String strat = StrategyNameResolver.extractFromRedis(data);
                    data.put("strategy", strat);
                    if (rawSource != null && !rawSource.equals(strat)) {
                        data.put("variant", rawSource);
                    }
                    data.put("executionMode", StrategyNameResolver.extractExecutionMode(data));

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

            // Use stored direction if available (side alone is wrong for option trades:
            // options are always BUY/LONG regardless of BULLISH/BEARISH direction)
            String dir;
            String storedDir = pos.get("direction") != null ? pos.get("direction").toString() : null;
            if (storedDir != null && !storedDir.isEmpty()) {
                dir = storedDir.toUpperCase().contains("BEAR") ? "BEARISH" : "BULLISH";
            } else if (pos.get("equitySl") != null && pos.get("equityT1") != null) {
                // Fallback for existing positions without direction: infer from equity levels
                double eqSl = ((Number) pos.get("equitySl")).doubleValue();
                double eqT1 = ((Number) pos.get("equityT1")).doubleValue();
                dir = eqSl > eqT1 ? "BEARISH" : "BULLISH";
            } else {
                dir = isLong ? "BULLISH" : "BEARISH";
            }

            double avgEntry = pos.get("avgEntry") != null ? ((Number) pos.get("avgEntry")).doubleValue() : 0;
            double currentPrice = pos.get("currentPrice") != null ? ((Number) pos.get("currentPrice")).doubleValue() : avgEntry;
            double unrealizedPnl = pos.get("unrealizedPnl") != null ? ((Number) pos.get("unrealizedPnl")).doubleValue() : 0;

            double pnlPct = avgEntry > 0
                    ? (isLong ? (currentPrice - avgEntry) / avgEntry * 100 : (avgEntry - currentPrice) / avgEntry * 100)
                    : 0;

            String rawStrategy = (String) pos.get("strategy");
            String norm = StrategyNameResolver.normalize(rawStrategy);
            String displayName = DISPLAY_NAMES.getOrDefault(norm, norm);
            String variant = pos.get("variant") != null ? pos.get("variant").toString()
                    : (pos.get("signalSource") != null ? pos.get("signalSource").toString() : null);
            // Only keep variant if it differs from normalized strategy (e.g., MERE_SCALP vs MERE)
            if (variant != null && variant.equalsIgnoreCase(norm)) variant = null;

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
                    .target1Hit(tp1Hit || Boolean.TRUE.equals(pos.get("t1Hit")))
                    .target2Hit(Boolean.TRUE.equals(pos.get("t2Hit")))
                    .target3Hit(Boolean.TRUE.equals(pos.get("t3Hit")))
                    .target4Hit(Boolean.TRUE.equals(pos.get("t4Hit")))
                    .stopHit(Boolean.TRUE.equals(pos.get("slHit")))
                    .pnl(round2(unrealizedPnl))
                    .pnlPercent(round2(pnlPct))
                    .strategy(displayName)
                    .variant(variant)
                    .executionMode(StrategyNameResolver.extractExecutionMode(pos))
                    .exchange(extractExchangeFromPosition(pos))
                    // Price levels
                    .stopLoss(getOptionalDouble(pos, "sl"))
                    .target1(getOptionalDouble(pos, "tp1"))
                    .target2(getOptionalDouble(pos, "tp2"))
                    .target3(getOptionalDouble(pos, "target3"))
                    .target4(getOptionalDouble(pos, "target4"))
                    // Dual-leg levels
                    .equitySl(getOptionalDouble(pos, "equitySl"))
                    .equityT1(getOptionalDouble(pos, "equityT1"))
                    .equityT2(getOptionalDouble(pos, "equityT2"))
                    .equityT3(getOptionalDouble(pos, "equityT3"))
                    .equityT4(getOptionalDouble(pos, "equityT4"))
                    .optionSl(getOptionalDouble(pos, "optionSl"))
                    .optionT1(getOptionalDouble(pos, "optionT1"))
                    .optionT2(getOptionalDouble(pos, "optionT2"))
                    .optionT3(getOptionalDouble(pos, "optionT3"))
                    .optionT4(getOptionalDouble(pos, "optionT4"))
                    // Instrument metadata
                    .instrumentType(pos.get("instrumentType") != null ? pos.get("instrumentType").toString() : null)
                    .instrumentSymbol(pos.get("instrumentSymbol") != null ? pos.get("instrumentSymbol").toString() : null)
                    // Analytics
                    .confidence(getMetricDouble(pos, "confidence"))
                    .rMultiple(null)
                    .durationMinutes(null)
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
            // Use stored direction if available (side is wrong for option trades)
            String dir;
            String storedDir = doc.getString("direction");
            if (storedDir != null && !storedDir.isEmpty()) {
                dir = storedDir.toUpperCase().contains("BEAR") ? "BEARISH" : "BULLISH";
            } else {
                dir = "LONG".equals(side) ? "BULLISH" : "BEARISH";
            }
            String exitReason = doc.getString("exitReason");
            String norm = StrategyNameResolver.extractFromDocument(doc);
            String rawSrc = doc.getString("signalSource");
            String docVariant = (rawSrc != null && !rawSrc.equalsIgnoreCase(norm)) ? rawSrc : null;

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
                    .variant(docVariant)
                    .executionMode(StrategyNameResolver.extractExecutionModeFromDocument(doc))
                    .exchange(extractExchange(doc))
                    // Price levels
                    .stopLoss(getDoubleOrNull(doc, "stopLoss"))
                    .target1(getDoubleOrNull(doc, "target1"))
                    .target2(getDoubleOrNull(doc, "target2"))
                    .target3(getDoubleOrNull(doc, "target3"))
                    .target4(getDoubleOrNull(doc, "target4"))
                    // Dual-leg levels
                    .equitySl(getDoubleOrNull(doc, "equitySl"))
                    .equityT1(getDoubleOrNull(doc, "equityT1"))
                    .equityT2(getDoubleOrNull(doc, "equityT2"))
                    .equityT3(getDoubleOrNull(doc, "equityT3"))
                    .equityT4(getDoubleOrNull(doc, "equityT4"))
                    .optionSl(getDoubleOrNull(doc, "optionSl"))
                    .optionT1(getDoubleOrNull(doc, "optionT1"))
                    .optionT2(getDoubleOrNull(doc, "optionT2"))
                    .optionT3(getDoubleOrNull(doc, "optionT3"))
                    .optionT4(getDoubleOrNull(doc, "optionT4"))
                    // Instrument metadata
                    .instrumentType(doc.getString("instrumentType"))
                    .instrumentSymbol(doc.getString("instrumentSymbol"))
                    // Analytics
                    .rMultiple(getMetricDoubleFromDoc(doc, "rMultiple"))
                    .confidence(getMetricDoubleFromDoc(doc, "confidence"))
                    .durationMinutes(doc.get("durationMinutes") instanceof Number
                            ? ((Number) doc.get("durationMinutes")).longValue() : null)
                    .totalCharges(getMetricDoubleFromDoc(doc, "totalCharges"))
                    // Signal-level metrics
                    .atr(getMetricDoubleFromDoc(doc, "atr"))
                    .volumeSurge(getMetricDoubleFromDoc(doc, "volumeSurge"))
                    .oiChangePercent(getMetricDoubleFromDoc(doc, "oiChangePercent"))
                    .blockDealPercent(getMetricDoubleFromDoc(doc, "blockDealPercent"))
                    .riskReward(getMetricDoubleFromDoc(doc, "riskReward"))
                    .build();
        } catch (Exception e) {
            log.warn("Error parsing strategy trade: {}", e.getMessage());
            return null;
        }
    }

    // ─────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────

    private String determineSide(Document doc) {
        // 1. Read stored side field (BUY/SELL or LONG/SHORT)
        String side = doc.getString("side");
        if (side != null && !side.isEmpty()) {
            String upper = side.toUpperCase();
            if (upper.contains("SELL") || upper.contains("SHORT")) return "SHORT";
            if (upper.contains("BUY") || upper.contains("LONG")) return "LONG";
        }
        // 2. Read stored direction field (BULLISH/BEARISH)
        String dir = doc.getString("direction");
        if (dir != null && !dir.isEmpty()) {
            String upper = dir.toUpperCase();
            if (upper.contains("BEAR") || upper.contains("SHORT")) return "SHORT";
            if (upper.contains("BULL") || upper.contains("LONG")) return "LONG";
        }
        // 3. Fallback: derive from entry vs stop (only when stop > 0)
        double entry = getDouble(doc, "entryPrice");
        double stop = getDouble(doc, "stopLoss");
        if (stop > 0 && entry > 0) {
            return entry > stop ? "LONG" : "SHORT";
        }
        return "LONG";
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

    private double getNumericValue(Map<String, Object> map, String key, double defaultVal) {
        Object val = map.get(key);
        return val instanceof Number ? ((Number) val).doubleValue() : defaultVal;
    }

    private int getIntValue(Map<String, Object> map, String key, int defaultVal) {
        Object val = map.get(key);
        return val instanceof Number ? ((Number) val).intValue() : defaultVal;
    }

    private boolean getBoolValue(Map<String, Object> map, String key, boolean defaultVal) {
        Object val = map.get(key);
        return val instanceof Boolean ? (Boolean) val : defaultVal;
    }

    /** For price fields (SL, targets): 0 means "not set" → return null */
    private Double getOptionalDouble(Map<String, Object> map, String key) {
        Object val = map.get(key);
        if (val instanceof Number) {
            double d = ((Number) val).doubleValue();
            return d != 0 ? round2(d) : null;
        }
        return null;
    }

    /** For metric fields (rMultiple, confidence): 0 IS a valid value → preserve it */
    private Double getMetricDouble(Map<String, Object> map, String key) {
        Object val = map.get(key);
        return val instanceof Number ? round2(((Number) val).doubleValue()) : null;
    }

    /** For price fields (SL, targets): 0 means "not set" → return null */
    private Double getDoubleOrNull(Document doc, String key) {
        Object val = doc.get(key);
        if (val instanceof Number) {
            double d = ((Number) val).doubleValue();
            return d != 0 ? round2(d) : null;
        }
        return null;
    }

    /** For metric fields (rMultiple, confidence): 0 IS valid → preserve it */
    private Double getMetricDoubleFromDoc(Document doc, String key) {
        Object val = doc.get(key);
        return val instanceof Number ? round2(((Number) val).doubleValue()) : null;
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
