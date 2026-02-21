package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.StrategyTradeRequest;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * StrategyTradeExecutor - Manages virtual strategy option/futures trades.
 *
 * Responsibilities:
 * 1. openTrade()       — Creates position in Redis + stores target metadata
 * 2. monitorPositions() — @Scheduled every 2s: dual-level monitoring (option + equity/futures)
 * 3. closeTrade()       — Manual close
 * 4. getActiveStrategyTrades() — Returns all open strategy positions
 * 5. eodExitAllPositions() — @Scheduled 15:25 IST: auto-exit all remaining positions
 *
 * Dual monitoring: checks both option LTP and equity/futures LTP against respective
 * SL and target levels. Whichever level is hit first triggers the exit.
 * - NSE instruments: equity price from NSE
 * - MCX/Currency instruments: underlying futures price
 *
 * 1% Drawdown: tracks option price 5-minute rolling high, auto-exits if option price
 * falls below 1% of its 5-min high.
 *
 * Exit reasons: "1% DD", "SL-EQ", "SL-OP", "T1-EQ", "T1-OP", "T2-EQ", "T2-OP",
 *               "T3-EQ", "T3-OP", "T4-EQ", "T4-OP", "EOD", "MANUAL_CLOSE"
 *
 * Positions stored in Redis: virtual:positions:{scripCode}
 * Target metadata stored in Redis: strategy:targets:{scripCode}
 * Trade outcomes published to Kafka "trade-outcomes".
 * Position updates pushed via WebSocket /topic/positions every 2s.
 */
@Service
@Slf4j
public class StrategyTradeExecutor {

    private static final String LOG_PREFIX = "[STRATEGY-TRADE]";
    private static final String POSITION_PREFIX = "virtual:positions:";
    private static final String TARGETS_PREFIX = "strategy:targets:";
    private static final String PRICE_PREFIX = "price:";

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @Autowired
    private WebSocketSessionManager sessionManager;

    @Autowired
    private OptionTickPriceService tickPriceService;

    @Value("${kafka.topics.trade-outcomes:trade-outcomes}")
    private String tradeOutcomesTopic;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Open a new strategy trade.
     * Creates position in Redis and stores target metadata for monitoring.
     */
    public Map<String, Object> openTrade(StrategyTradeRequest req) {
        String scripCode = req.getScripCode();
        String tradeId = "ST-" + req.getStrategy() + "-" + System.currentTimeMillis();
        long now = System.currentTimeMillis();

        log.info("{} Opening trade: {} {} @ {} qty={} lots={} lotSize={} multiplier={} strategy={}",
            LOG_PREFIX, req.getInstrumentSymbol(), req.getSide(),
            req.getEntryPrice(), req.getQuantity(), req.getLots(),
            req.getLotSize(), req.getMultiplier(), req.getStrategy());

        // Validate quantity is lot-aligned
        if (req.getLotSize() > 0 && req.getQuantity() % req.getLotSize() != 0) {
            log.warn("{} Quantity {} not multiple of lotSize {}. Adjusting.",
                LOG_PREFIX, req.getQuantity(), req.getLotSize());
            int correctedQty = (req.getQuantity() / req.getLotSize()) * req.getLotSize();
            if (correctedQty <= 0) correctedQty = req.getLotSize();
            req.setQuantity(correctedQty);
            req.setLots(correctedQty / req.getLotSize());
        }

        // 0. Compute smart confluence-scored targets (replaces static delta-adjusted levels)
        double optT1 = req.getT1(), optT2 = req.getT2(), optT3 = req.getT3(), optT4 = req.getT4();
        double optSl = req.getSl();
        boolean smartTargetsApplied = false;
        try {
            double[] smart = computeSmartTargets(req);
            if (smart != null) {
                if (smart[0] > 0) optT1 = smart[0];
                if (smart[1] > 0) optT2 = smart[1];
                if (smart[2] > 0) optT3 = smart[2];
                if (smart[3] > 0) optT4 = smart[3];
                if (smart[4] > 0) optSl = smart[4];
                smartTargetsApplied = true;
                log.info("{} SMART TARGETS applied for {}: T1={} T2={} T3={} T4={} SL={} " +
                    "(was: T1={} T2={} T3={} T4={} SL={})",
                    LOG_PREFIX, req.getInstrumentSymbol(),
                    fmt(optT1), fmt(optT2), fmt(optT3), fmt(optT4), fmt(optSl),
                    fmt(req.getT1()), fmt(req.getT2()), fmt(req.getT3()), fmt(req.getT4()), fmt(req.getSl()));
            }
        } catch (Exception e) {
            log.warn("{} Smart target computation failed, using signal targets: {}",
                LOG_PREFIX, e.getMessage());
        }

        // 1. Write position to Redis (standard format WalletService reads)
        Map<String, Object> position = new LinkedHashMap<>();
        position.put("scripCode", scripCode);
        position.put("qtyOpen", req.getQuantity());
        position.put("avgEntry", req.getEntryPrice());
        position.put("side", "LONG");
        position.put("sl", optSl);
        position.put("tp1", optT1);
        position.put("tp2", optT2);
        position.put("tp1Hit", false);
        position.put("trailingType", "NONE");
        position.put("trailingStop", 0);
        position.put("realizedPnl", 0.0);
        position.put("unrealizedPnl", 0.0);
        position.put("currentPrice", req.getEntryPrice());
        position.put("signalId", tradeId);
        position.put("signalSource", req.getStrategy());
        position.put("strategy", req.getStrategy());
        position.put("openedAt", now);
        position.put("updatedAt", now);
        position.put("status", "ACTIVE");
        // Dual levels for wallet display
        position.put("equitySl", req.getEquitySl());
        position.put("equityT1", req.getEquityT1());
        position.put("equityT2", req.getEquityT2());
        position.put("equityT3", req.getEquityT3());
        position.put("equityT4", req.getEquityT4());
        position.put("optionSl", optSl);
        position.put("optionT1", optT1);
        position.put("optionT2", optT2);
        position.put("optionT3", optT3);
        position.put("optionT4", optT4);
        position.put("target3", optT3);
        position.put("target4", optT4);
        position.put("smartTargets", smartTargetsApplied);
        position.put("t1Hit", false);
        position.put("t2Hit", false);
        position.put("t3Hit", false);
        position.put("t4Hit", false);
        position.put("slHit", false);
        position.put("instrumentType", req.getInstrumentType());
        position.put("delta", req.getDelta());
        position.put("instrumentSymbol", req.getInstrumentSymbol());
        position.put("underlyingScripCode", req.getUnderlyingScripCode());
        position.put("confidence", req.getConfidence());
        position.put("exitReason", "");
        position.put("equityLtp", req.getEquitySpot());

        try {
            String posJson = objectMapper.writeValueAsString(position);
            redisTemplate.opsForValue().set(POSITION_PREFIX + scripCode, posJson);
            log.info("{} Position written to Redis: {}{}", LOG_PREFIX, POSITION_PREFIX, scripCode);
        } catch (Exception e) {
            log.error("{} Failed to write position to Redis: {}", LOG_PREFIX, e.getMessage());
            return Map.of("success", false, "error", "Failed to write position: " + e.getMessage());
        }

        // 2. Write target metadata for monitoring
        Map<String, Object> targets = new LinkedHashMap<>();
        targets.put("tradeId", tradeId);
        targets.put("scripCode", scripCode);
        targets.put("instrumentSymbol", req.getInstrumentSymbol());
        targets.put("totalQty", req.getQuantity());
        targets.put("remainingQty", req.getQuantity());
        targets.put("entryPrice", req.getEntryPrice());
        targets.put("sl", optSl);
        targets.put("currentSl", optSl);

        // Pre-compute lot-aligned close quantities using largest-remainder method
        int totalLots = req.getQuantity() / Math.max(req.getLotSize(), 1);
        int[] lotAlloc = allocateLots(totalLots, new int[]{40, 30, 20, 10});
        int lotSize = Math.max(req.getLotSize(), 1);
        log.info("{} Lot allocation for {} lots: T1={} T2={} T3={} T4={}",
            LOG_PREFIX, totalLots, lotAlloc[0], lotAlloc[1], lotAlloc[2], lotAlloc[3]);

        List<Map<String, Object>> targetLevels = new ArrayList<>();
        addTarget(targetLevels, "T1", optT1, lotAlloc[0] * lotSize);
        addTarget(targetLevels, "T2", optT2, lotAlloc[1] * lotSize);
        addTarget(targetLevels, "T3", optT3, lotAlloc[2] * lotSize);
        addTarget(targetLevels, "T4", optT4, lotAlloc[3] * lotSize);
        targets.put("smartTargets", smartTargetsApplied);
        targets.put("targets", targetLevels);

        targets.put("strategy", req.getStrategy());
        targets.put("direction", req.getDirection());
        targets.put("exchange", req.getExchange());
        targets.put("lotSize", req.getLotSize());
        targets.put("multiplier", req.getMultiplier());
        targets.put("lots", req.getLots());
        targets.put("instrumentType", req.getInstrumentType());
        targets.put("openedAt", now);
        // Dual monitoring metadata
        targets.put("underlyingScripCode", req.getUnderlyingScripCode());
        targets.put("equitySpot", req.getEquitySpot());
        targets.put("confidence", req.getConfidence());
        targets.put("optionHighFiveMin", req.getEntryPrice());
        targets.put("optionHighFiveMinUpdatedAt", now);
        // Equity/futures levels for dual monitoring
        targets.put("equitySl", req.getEquitySl());
        targets.put("equityT1", req.getEquityT1());
        targets.put("equityT2", req.getEquityT2());
        targets.put("equityT3", req.getEquityT3());
        targets.put("equityT4", req.getEquityT4());

        try {
            String targetsJson = objectMapper.writeValueAsString(targets);
            redisTemplate.opsForValue().set(TARGETS_PREFIX + scripCode, targetsJson);
            log.info("{} Targets written to Redis: {}{}", LOG_PREFIX, TARGETS_PREFIX, scripCode);
        } catch (Exception e) {
            log.error("{} Failed to write targets to Redis: {}", LOG_PREFIX, e.getMessage());
        }

        // 3. Ensure the option contract is subscribed on the broker WebSocket
        // This guarantees TickAggregator receives ticks and caches price to Redis in real-time
        // MCX uses ExchType "D" for both options AND futures; only NSE futures use "U"
        String exch = req.getExchange() != null ? req.getExchange() : "N";
        String exchType = "M".equals(exch) || "C".equals(exch) ? "D"
            : ("FUTURES".equals(req.getInstrumentType()) ? "U" : "D");
        tickPriceService.ensureSubscribed(exch, exchType, scripCode, req.getInstrumentSymbol());
        tickPriceService.ensureOiSubscribed(exch, exchType, scripCode, req.getInstrumentSymbol());

        log.info("{} WebSocket subscription ensured for {} ({}:{}:{})",
            LOG_PREFIX, req.getInstrumentSymbol(), exch, exchType, scripCode);

        // 4. FIX: Use actual option LTP as entry instead of frontend estimate.
        // The frontend estimates premium via ATR*3 heuristic which can be wildly off,
        // causing all targets to be hit instantly if actual LTP >> estimate.
        double actualLtp = getLtpFromRedis(exch, scripCode);
        double estimatedEntry = req.getEntryPrice();
        if (actualLtp > 0 && estimatedEntry > 0) {
            double deviation = Math.abs(actualLtp - estimatedEntry) / estimatedEntry;
            if (deviation > 0.10) { // > 10% off from estimate
                log.info("{} ENTRY PRICE CORRECTION: {} estimate={} actualLtp={} deviation={}%",
                    LOG_PREFIX, req.getInstrumentSymbol(), fmt(estimatedEntry),
                    fmt(actualLtp), String.format("%.1f", deviation * 100));

                // Scale targets proportionally: ratio = actualLtp / estimatedEntry
                double ratio = actualLtp / estimatedEntry;
                optT1 = Math.round(optT1 * ratio * 100.0) / 100.0;
                optT2 = Math.round(optT2 * ratio * 100.0) / 100.0;
                optT3 = Math.round(optT3 * ratio * 100.0) / 100.0;
                optT4 = Math.round(optT4 * ratio * 100.0) / 100.0;
                optSl = Math.round(optSl * ratio * 100.0) / 100.0;

                // Update position and target maps with corrected entry price
                position.put("avgEntry", actualLtp);
                position.put("currentPrice", actualLtp);
                position.put("sl", optSl);
                position.put("tp1", optT1);
                position.put("tp2", optT2);
                position.put("optionSl", optSl);
                position.put("optionT1", optT1);
                position.put("optionT2", optT2);
                position.put("optionT3", optT3);
                position.put("optionT4", optT4);
                position.put("target3", optT3);
                position.put("target4", optT4);

                // Re-write position to Redis with corrected entry
                try {
                    String posJson = objectMapper.writeValueAsString(position);
                    redisTemplate.opsForValue().set(POSITION_PREFIX + scripCode, posJson);
                    log.info("{} Position RE-WRITTEN with corrected entry={} T1={} T2={} T3={} T4={} SL={}",
                        LOG_PREFIX, fmt(actualLtp), fmt(optT1), fmt(optT2), fmt(optT3), fmt(optT4), fmt(optSl));
                } catch (Exception e) {
                    log.error("{} Failed to re-write corrected position: {}", LOG_PREFIX, e.getMessage());
                }

                // Also update targets metadata
                try {
                    String tKey = TARGETS_PREFIX + scripCode;
                    String tJson = redisTemplate.opsForValue().get(tKey);
                    if (tJson != null) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> tMap = objectMapper.readValue(tJson, Map.class);
                        tMap.put("entryPrice", actualLtp);
                        tMap.put("sl", optSl);
                        tMap.put("currentSl", optSl);
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> tLevels = (List<Map<String, Object>>) tMap.get("targets");
                        if (tLevels != null) {
                            double[] corrected = {optT1, optT2, optT3, optT4};
                            for (int i = 0; i < tLevels.size() && i < corrected.length; i++) {
                                tLevels.get(i).put("price", corrected[i]);
                            }
                        }
                        redisTemplate.opsForValue().set(tKey, objectMapper.writeValueAsString(tMap));
                    }
                } catch (Exception e) {
                    log.error("{} Failed to re-write corrected targets: {}", LOG_PREFIX, e.getMessage());
                }

                // Use actual LTP for response
                estimatedEntry = actualLtp;
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("tradeId", tradeId);
        result.put("scripCode", scripCode);
        result.put("instrumentSymbol", req.getInstrumentSymbol());
        result.put("entryPrice", estimatedEntry);
        result.put("quantity", req.getQuantity());
        result.put("lots", req.getLots());
        result.put("sl", optSl);
        result.put("t1", optT1);
        result.put("t2", optT2);
        result.put("t3", optT3);
        result.put("t4", optT4);
        result.put("smartTargets", smartTargetsApplied);
        result.put("strategy", req.getStrategy());
        return result;
    }

    // ==================== SMART TARGET COMPUTATION ====================

    /**
     * Compute smart confluence-scored option targets using:
     *   Method A: Delta-adjusted equity pivots (weight 2, multi-TF bonus +1)
     *   Method B: Option swing levels from candle history (weight 1)
     *   Method C: Round figures based on option price range (weight 1)
     *
     * Clusters nearby levels (within 2%), sorts by distance from entry,
     * assigns T1-T4 to nearest clusters with sufficient score.
     *
     * @return double[5] = {T1, T2, T3, T4, SL} or null if insufficient data
     */
    private double[] computeSmartTargets(StrategyTradeRequest req) {
        double entryPrice = req.getEntryPrice();
        double delta = req.getDelta() > 0 ? req.getDelta() : 0.5; // Default delta
        double equityEntry = req.getEquitySpot();

        if (entryPrice <= 0 || equityEntry <= 0) return null;

        // --- Step 1: Collect candidate levels ---
        // Each candidate: {price, score, source}
        List<double[]> candidates = new ArrayList<>(); // [price, score]
        Map<Double, String> candidateSources = new LinkedHashMap<>(); // price → source description

        // Method A: Delta-adjusted equity pivots (weight 2)
        Map<String, Double> pivotLevels = tickPriceService.readPivotLevels(req.getUnderlyingScripCode());
        Map<Double, Integer> pivotTimeframeCount = new LinkedHashMap<>(); // optionLevel → number of timeframes

        if (!pivotLevels.isEmpty()) {
            for (Map.Entry<String, Double> entry : pivotLevels.entrySet()) {
                double equityLevel = entry.getValue();
                double optionLevel = entryPrice + delta * (equityLevel - equityEntry);
                if (optionLevel <= 0) continue;

                // Round to 0.05 for cleaner levels
                optionLevel = Math.round(optionLevel * 20.0) / 20.0;

                candidates.add(new double[]{optionLevel, 2});
                candidateSources.put(optionLevel, entry.getKey());

                // Track multi-TF confluence: if different timeframes map to similar option level
                double roundedOpt = Math.round(optionLevel * 10.0) / 10.0;
                pivotTimeframeCount.merge(roundedOpt, 1, Integer::sum);
            }

            // Multi-TF bonus: if 2+ timeframe pivots map to similar option level
            for (Map.Entry<Double, Integer> entry : pivotTimeframeCount.entrySet()) {
                if (entry.getValue() >= 2) {
                    candidates.add(new double[]{entry.getKey(), 1}); // +1 bonus
                }
            }
        }

        // Method B: Option swing levels (weight 1)
        Map<String, List<Double>> swingLevels = tickPriceService.readSwingLevels(req.getScripCode(), 60);
        for (double swingHigh : swingLevels.get("swingHighs")) {
            candidates.add(new double[]{swingHigh, 1});
            candidateSources.putIfAbsent(swingHigh, "swingHigh");
        }
        for (double swingLow : swingLevels.get("swingLows")) {
            candidates.add(new double[]{swingLow, 1});
            candidateSources.putIfAbsent(swingLow, "swingLow");
        }

        // Method C: Round figures (weight 1)
        double roundStep = entryPrice < 50 ? 5 : (entryPrice < 200 ? 10 : 25);
        double baseRound = Math.ceil(entryPrice / roundStep) * roundStep;
        for (int i = -3; i <= 8; i++) {
            double roundLevel = baseRound + i * roundStep;
            if (roundLevel > 0) {
                candidates.add(new double[]{roundLevel, 1});
                candidateSources.putIfAbsent(roundLevel, "round");
            }
        }

        if (candidates.isEmpty()) return null;

        // --- Step 2: Cluster nearby levels (within 2% of each other) ---
        // Sort candidates by price
        candidates.sort(Comparator.comparingDouble(a -> a[0]));

        List<double[]> clusters = new ArrayList<>(); // [clusterCenter, totalScore]
        double clusterStart = candidates.get(0)[0];
        double clusterScoreSum = candidates.get(0)[1];
        int clusterCount = 1;
        double clusterWeightedSum = candidates.get(0)[0] * candidates.get(0)[1];

        for (int i = 1; i < candidates.size(); i++) {
            double price = candidates.get(i)[0];
            double score = candidates.get(i)[1];
            double clusterCenter = clusterWeightedSum / clusterScoreSum;

            // Within 2% of cluster center → merge
            if (Math.abs(price - clusterCenter) / clusterCenter < 0.02) {
                clusterScoreSum += score;
                clusterWeightedSum += price * score;
                clusterCount++;
            } else {
                // Emit current cluster
                double center = clusterWeightedSum / clusterScoreSum;
                // Snap to nearest round figure if within 1%
                double nearestRound = Math.round(center / roundStep) * roundStep;
                if (nearestRound > 0 && Math.abs(center - nearestRound) / center < 0.01) {
                    center = nearestRound;
                }
                clusters.add(new double[]{center, clusterScoreSum});

                // Start new cluster
                clusterStart = price;
                clusterScoreSum = score;
                clusterWeightedSum = price * score;
                clusterCount = 1;
            }
        }
        // Emit final cluster
        double finalCenter = clusterWeightedSum / clusterScoreSum;
        double nearestRound = Math.round(finalCenter / roundStep) * roundStep;
        if (nearestRound > 0 && Math.abs(finalCenter - nearestRound) / finalCenter < 0.01) {
            finalCenter = nearestRound;
        }
        clusters.add(new double[]{finalCenter, clusterScoreSum});

        // --- Step 3: Separate into above-entry (targets) and below-entry (SL) ---
        List<double[]> aboveEntry = new ArrayList<>();
        List<double[]> belowEntry = new ArrayList<>();

        for (double[] cluster : clusters) {
            if (cluster[0] > entryPrice * 1.005) { // At least 0.5% above entry
                aboveEntry.add(cluster);
            } else if (cluster[0] < entryPrice * 0.995) { // At least 0.5% below entry
                belowEntry.add(cluster);
            }
        }

        // Sort above by distance from entry (nearest first), tiebreak by score (higher first)
        aboveEntry.sort((a, b) -> {
            int distCmp = Double.compare(a[0], b[0]); // nearest first
            return distCmp != 0 ? distCmp : Double.compare(b[1], a[1]); // higher score first
        });

        // Sort below by distance from entry (nearest first = highest price below entry)
        belowEntry.sort((a, b) -> Double.compare(b[0], a[0]));

        // Need at least 2 target clusters above entry for smart targets to be useful
        if (aboveEntry.size() < 2) return null;

        // --- Step 4: Assign T1-T4 and SL ---
        double t1 = aboveEntry.size() > 0 ? aboveEntry.get(0)[0] : 0;
        double t2 = aboveEntry.size() > 1 ? aboveEntry.get(1)[0] : 0;
        double t3 = aboveEntry.size() > 2 ? aboveEntry.get(2)[0] : 0;
        double t4 = aboveEntry.size() > 3 ? aboveEntry.get(3)[0] : 0;

        // T4 fallback: if only 3 clusters, use next round figure beyond T3
        if (t4 <= 0 && t3 > 0) {
            t4 = Math.ceil(t3 / roundStep) * roundStep + roundStep;
        }
        // T3 fallback: if only 2 clusters, use next round figure beyond T2
        if (t3 <= 0 && t2 > 0) {
            t3 = Math.ceil(t2 / roundStep) * roundStep + roundStep;
        }

        // SL: nearest below-entry cluster with score >= 2, or strongest support
        double sl = 0;
        for (double[] cluster : belowEntry) {
            if (cluster[1] >= 2) {
                sl = cluster[0];
                break;
            }
        }
        // SL fallback: if no strong support, use the signal's original SL
        if (sl <= 0) {
            sl = req.getSl();
        }

        log.info("{} Smart targets computed for {}: T1={} T2={} T3={} T4={} SL={} " +
                "(pivots={} swings={} clusters={})",
            LOG_PREFIX, req.getInstrumentSymbol(),
            fmt(t1), fmt(t2), fmt(t3), fmt(t4), fmt(sl),
            pivotLevels.size(), swingLevels.get("swingHighs").size() + swingLevels.get("swingLows").size(),
            clusters.size());

        return new double[]{t1, t2, t3, t4, sl};
    }

    private static String fmt(double v) {
        return String.format("%.2f", v);
    }

    private void addTarget(List<Map<String, Object>> targets, String level, double price, int closeQty) {
        if (price > 0) {
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("level", level);
            t.put("price", price);
            t.put("closeQty", closeQty);
            t.put("hit", false);
            targets.add(t);
        }
    }

    /**
     * Allocate lots across targets using the largest-remainder method.
     * Guarantees sum of allocations == totalLots with no over/under-allocation.
     *
     * @param totalLots  total lots available
     * @param percentages target percentages (e.g., [40, 30, 20, 10])
     * @return lot count per target, same length as percentages
     */
    private int[] allocateLots(int totalLots, int[] percentages) {
        int n = percentages.length;
        double[] ideal = new double[n];
        int[] floored = new int[n];
        int floorSum = 0;

        for (int i = 0; i < n; i++) {
            ideal[i] = (double) percentages[i] / 100.0 * totalLots;
            floored[i] = (int) Math.floor(ideal[i]);
            floorSum += floored[i];
        }

        int leftover = totalLots - floorSum;

        // Sort indices by fractional remainder descending, tiebreak favors later targets
        Integer[] indices = new Integer[n];
        for (int i = 0; i < n; i++) indices[i] = i;
        Arrays.sort(indices, (a, b) -> {
            double remA = ideal[a] - floored[a];
            double remB = ideal[b] - floored[b];
            int cmp = Double.compare(remB, remA);
            return cmp != 0 ? cmp : Integer.compare(b, a); // tiebreak: later target wins
        });

        for (int i = 0; i < leftover && i < n; i++) {
            floored[indices[i]]++;
        }

        return floored;
    }

    /**
     * Monitor all active strategy positions every 2 seconds.
     * Checks prices, executes partial exits at targets, manages trailing stops.
     */
    @Scheduled(fixedRate = 2000)
    public void monitorPositions() {
        try {
            Set<String> targetKeys = redisTemplate.keys(TARGETS_PREFIX + "*");
            if (targetKeys == null || targetKeys.isEmpty()) return;

            for (String targetKey : targetKeys) {
                try {
                    monitorSinglePosition(targetKey);
                } catch (Exception e) {
                    log.error("{} Error monitoring {}: {}", LOG_PREFIX, targetKey, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.debug("{} Monitor cycle error: {}", LOG_PREFIX, e.getMessage());
        }
    }

    // ==================== OI MONITORING ====================

    /**
     * Monitor OI patterns for all active positions every 60 seconds.
     * Reads oi:{scripCode}:latest from Redis, tracks interpretation pattern
     * in a sliding window of 5 readings, and sets oiExitFlag when danger pattern detected.
     *
     * For LONG trades:
     *   LONG_UNWINDING 3/5 → oiExitFlag (exit ALL at next target)
     *   SHORT_BUILDUP 3/5  → oiImmediateExit (exit immediately)
     *
     * For SHORT trades:
     *   SHORT_COVERING 3/5 → oiExitFlag (exit ALL at next target)
     *   LONG_BUILDUP 3/5   → oiImmediateExit (exit immediately)
     */
    @Scheduled(fixedRate = 60000)
    @SuppressWarnings("unchecked")
    public void monitorOiPatterns() {
        try {
            Set<String> targetKeys = redisTemplate.keys(TARGETS_PREFIX + "*");
            if (targetKeys == null || targetKeys.isEmpty()) return;

            for (String targetKey : targetKeys) {
                try {
                    String targetsJson = redisTemplate.opsForValue().get(targetKey);
                    if (targetsJson == null) continue;

                    Map<String, Object> targets = objectMapper.readValue(targetsJson, Map.class);
                    String scripCode = (String) targets.get("scripCode");
                    int remainingQty = targets.get("remainingQty") != null
                        ? ((Number) targets.get("remainingQty")).intValue() : 0;
                    if (remainingQty <= 0) continue;

                    // Skip grace period (first 30s)
                    long openedAt = targets.get("openedAt") != null
                        ? ((Number) targets.get("openedAt")).longValue() : 0;
                    if (openedAt > 0 && System.currentTimeMillis() - openedAt < 30_000) continue;

                    // Read OI metrics from Redis
                    Map<String, Object> oi = tickPriceService.readOiMetrics(scripCode);
                    if (oi == null) continue;

                    String interpretation = (String) oi.get("interpretation");
                    double confidence = ((Number) oi.get("confidence")).doubleValue();
                    double oiChangePct = ((Number) oi.get("oiChangePercent")).doubleValue();

                    // Skip low-confidence or neutral readings
                    if (confidence < 0.3 || "NEUTRAL".equals(interpretation)) continue;

                    long now = System.currentTimeMillis();

                    // Maintain sliding window of last 5 OI readings
                    List<Map<String, Object>> oiReadings = targets.get("oiReadings") != null
                        ? new ArrayList<>((List<Map<String, Object>>) targets.get("oiReadings"))
                        : new ArrayList<>();

                    Map<String, Object> reading = new LinkedHashMap<>();
                    reading.put("ts", now);
                    reading.put("interp", interpretation);
                    reading.put("pct", oiChangePct);
                    reading.put("conf", confidence);
                    oiReadings.add(reading);

                    // Keep only last 5 readings
                    while (oiReadings.size() > 5) {
                        oiReadings.remove(0);
                    }
                    targets.put("oiReadings", oiReadings);
                    targets.put("oiLastChecked", now);

                    // Evaluate OI exit condition (only when window has 5 readings)
                    if (oiReadings.size() >= 5) {
                        String direction = targets.get("direction") != null
                            ? (String) targets.get("direction") : "BULLISH";
                        boolean isLong = !"BEARISH".equals(direction);

                        // For longs: LONG_UNWINDING = danger, SHORT_BUILDUP = urgent
                        // For shorts: SHORT_COVERING = danger, LONG_BUILDUP = urgent
                        String dangerSignal = isLong ? "LONG_UNWINDING" : "SHORT_COVERING";
                        String urgentSignal = isLong ? "SHORT_BUILDUP" : "LONG_BUILDUP";

                        int dangerCount = 0;
                        int urgentCount = 0;
                        for (Map<String, Object> r : oiReadings) {
                            String interp = (String) r.get("interp");
                            double conf = r.get("conf") != null
                                ? ((Number) r.get("conf")).doubleValue() : 0;
                            if (conf > 0.5) {
                                if (dangerSignal.equals(interp)) dangerCount++;
                                if (urgentSignal.equals(interp)) urgentCount++;
                            }
                        }

                        if (dangerCount >= 3 && !Boolean.TRUE.equals(targets.get("oiExitFlag"))) {
                            targets.put("oiExitFlag", true);
                            targets.put("oiPattern", dangerSignal + " " + dangerCount + "/5");
                            log.info("{} OI EXIT FLAG for {} — {} {}/5 (exit ALL at next target)",
                                LOG_PREFIX, scripCode, dangerSignal, dangerCount);
                        }

                        if (urgentCount >= 3 && !Boolean.TRUE.equals(targets.get("oiImmediateExit"))) {
                            targets.put("oiImmediateExit", true);
                            targets.put("oiPattern", urgentSignal + " " + urgentCount + "/5");
                            log.info("{} OI IMMEDIATE EXIT flagged for {} — {} {}/5",
                                LOG_PREFIX, scripCode, urgentSignal, urgentCount);
                        }
                    }

                    // Persist updated OI metadata
                    String updatedJson = objectMapper.writeValueAsString(targets);
                    redisTemplate.opsForValue().set(targetKey, updatedJson);

                } catch (Exception e) {
                    log.debug("{} OI monitor error for {}: {}", LOG_PREFIX, targetKey, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.debug("{} OI monitor cycle error: {}", LOG_PREFIX, e.getMessage());
        }
    }

    // ==================== POSITION MONITORING ====================

    @SuppressWarnings("unchecked")
    private void monitorSinglePosition(String targetKey) throws Exception {
        String targetsJson = redisTemplate.opsForValue().get(targetKey);
        if (targetsJson == null) return;

        Map<String, Object> targets = objectMapper.readValue(targetsJson, Map.class);
        String scripCode = (String) targets.get("scripCode");
        String exchange = (String) targets.get("exchange");
        double entryPrice = ((Number) targets.get("entryPrice")).doubleValue();
        double currentSl = ((Number) targets.get("currentSl")).doubleValue();
        int remainingQty = ((Number) targets.get("remainingQty")).intValue();
        int lotSize = targets.get("lotSize") != null ? ((Number) targets.get("lotSize")).intValue() : 1;

        if (remainingQty <= 0) {
            redisTemplate.delete(targetKey);
            return;
        }

        // --- Grace period: skip target/SL checks for first 30s after trade entry ---
        long openedAt = targets.get("openedAt") != null
            ? ((Number) targets.get("openedAt")).longValue() : 0;
        long ageMs = System.currentTimeMillis() - openedAt;
        if (openedAt > 0 && ageMs < 30_000) {
            // Still update live price for display, but skip all exit checks
            double optionLtp = getLtpFromRedis(exchange, scripCode);
            if (optionLtp > 0) {
                String underlyingScripCode = (String) targets.get("underlyingScripCode");
                double equityLtp = -1;
                if (underlyingScripCode != null && !underlyingScripCode.isEmpty()) {
                    if ("M".equals(exchange) || "C".equals(exchange)) {
                        equityLtp = getLtpFromRedis(exchange, underlyingScripCode);
                    } else {
                        equityLtp = getLtpFromRedis("N", underlyingScripCode);
                    }
                }
                updatePositionPrice(scripCode, optionLtp, equityLtp, entryPrice, remainingQty);
            }
            return;
        }

        // --- Fetch OPTION LTP (tick-level from Kafka, fallback to Redis) ---
        double optionLtp = getLtpFromRedis(exchange, scripCode);
        if (optionLtp <= 0) return;

        // --- Fetch EQUITY/FUTURES LTP for dual monitoring ---
        String underlyingScripCode = (String) targets.get("underlyingScripCode");
        double equityLtp = -1;
        if (underlyingScripCode != null && !underlyingScripCode.isEmpty()) {
            // MCX/Currency → use futures price from same exchange; NSE → use equity price
            if ("M".equals(exchange) || "C".equals(exchange)) {
                equityLtp = getLtpFromRedis(exchange, underlyingScripCode);
            } else {
                equityLtp = getLtpFromRedis("N", underlyingScripCode);
            }
        }

        // --- Update position price + broadcast via WebSocket ---
        updatePositionPrice(scripCode, optionLtp, equityLtp, entryPrice, remainingQty);

        long now = System.currentTimeMillis();

        // --- Update 5-minute rolling high for option price ---
        updateOptionHighFiveMin(targets, optionLtp, now);
        double optionHighFiveMin = targets.get("optionHighFiveMin") != null
            ? ((Number) targets.get("optionHighFiveMin")).doubleValue() : optionLtp;

        // --- 1% Drawdown check: auto-exit if option price < 1% of 5-min high ---
        if (optionHighFiveMin > 0 && optionLtp <= optionHighFiveMin * 0.01) {
            log.info("{} 1% DD EXIT for {} optionLtp={} (1% of fiveMinHigh={})",
                LOG_PREFIX, scripCode, String.format("%.2f", optionLtp), String.format("%.2f", optionHighFiveMin));
            executeExit(targets, scripCode, optionLtp, remainingQty, "1% DD", targetKey);
            return;
        }

        // --- Dual SL check: whichever level is hit first ---
        double optionSlLevel = currentSl; // already the trailing/current SL for options
        double equitySlLevel = targets.get("equitySl") != null
            ? ((Number) targets.get("equitySl")).doubleValue() : 0;

        boolean optionSlHit = optionLtp <= optionSlLevel;
        boolean equitySlHit = equityLtp > 0 && equitySlLevel > 0 && equityLtp <= equitySlLevel;

        if (optionSlHit || equitySlHit) {
            String slReason = optionSlHit ? "SL-OP" : "SL-EQ";
            log.info("{} {} for {} optionLtp={} equityLtp={} (optSL={} eqSL={})",
                LOG_PREFIX, slReason, scripCode,
                String.format("%.2f", optionLtp), String.format("%.2f", equityLtp),
                String.format("%.2f", optionSlLevel), String.format("%.2f", equitySlLevel));
            executeExit(targets, scripCode, optionLtp, remainingQty, slReason, targetKey);
            return;
        }

        // --- OI Immediate Exit: SHORT_BUILDUP (longs) or LONG_BUILDUP (shorts) 3/5 ---
        if (Boolean.TRUE.equals(targets.get("oiImmediateExit"))) {
            String oiPattern = targets.get("oiPattern") != null
                ? (String) targets.get("oiPattern") : "OI_URGENT";
            log.info("{} OI IMMEDIATE EXIT for {} — pattern: {} optionLtp={}",
                LOG_PREFIX, scripCode, oiPattern, String.format("%.2f", optionLtp));
            executeExit(targets, scripCode, optionLtp, remainingQty,
                "OI_EXIT(" + oiPattern + ")", targetKey);
            return;
        }

        // --- Dual target checks T1→T4: whichever level is hit first ---
        List<Map<String, Object>> targetLevels = (List<Map<String, Object>>) targets.get("targets");
        if (targetLevels == null) return;

        // Read equity target levels
        double[] equityTargets = {
            targets.get("equityT1") != null ? ((Number) targets.get("equityT1")).doubleValue() : 0,
            targets.get("equityT2") != null ? ((Number) targets.get("equityT2")).doubleValue() : 0,
            targets.get("equityT3") != null ? ((Number) targets.get("equityT3")).doubleValue() : 0,
            targets.get("equityT4") != null ? ((Number) targets.get("equityT4")).doubleValue() : 0,
        };

        boolean anyTargetHit = false;
        for (int i = 0; i < targetLevels.size(); i++) {
            Map<String, Object> target = targetLevels.get(i);
            boolean hit = Boolean.TRUE.equals(target.get("hit"));
            if (hit) continue;

            double optionTargetPrice = ((Number) target.get("price")).doubleValue();
            String level = (String) target.get("level"); // "T1", "T2", "T3", "T4"

            // Dual check: option target OR equity target — whichever hits first
            boolean optionHit = optionLtp >= optionTargetPrice;
            boolean equityHit = equityLtp > 0 && i < equityTargets.length
                && equityTargets[i] > 0 && equityLtp >= equityTargets[i];

            if (optionHit || equityHit) {
                String hitSource = optionHit ? level + "-OP" : level + "-EQ";
                log.info("{} {} for {} optionLtp={} equityLtp={} (optTarget={} eqTarget={})",
                    LOG_PREFIX, hitSource, scripCode,
                    String.format("%.2f", optionLtp), String.format("%.2f", equityLtp),
                    String.format("%.2f", optionTargetPrice),
                    i < equityTargets.length ? String.format("%.2f", equityTargets[i]) : "N/A");

                target.put("hit", true);
                target.put("hitSource", hitSource);
                target.put("hitTimestamp", now);
                anyTargetHit = true;

                // Use pre-computed closeQty (lot-aligned via largest-remainder method)
                int closeQty = target.get("closeQty") != null
                    ? ((Number) target.get("closeQty")).intValue() : 0;
                closeQty = Math.min(closeQty, remainingQty);

                // OI Exit Flag: LONG_UNWINDING 3/5 → close ALL remaining lots at this target
                if (Boolean.TRUE.equals(targets.get("oiExitFlag")) && remainingQty > closeQty) {
                    String oiPattern = targets.get("oiPattern") != null
                        ? (String) targets.get("oiPattern") : "OI_DANGER";
                    log.info("{} OI EXIT ALL at {} for {} — {} remaining={} (was closeQty={})",
                        LOG_PREFIX, level, scripCode, oiPattern, remainingQty, closeQty);
                    closeQty = remainingQty;
                    hitSource = hitSource + " ALL(" + oiPattern + ")";
                }

                remainingQty -= closeQty;
                targets.put("remainingQty", remainingQty);

                double tranchePnl = (optionLtp - entryPrice) * closeQty;
                int lots = closeQty / Math.max(lotSize, 1);

                // Record exit history entry
                addExitHistoryEntry(scripCode, level, lots, closeQty, optionLtp, now, hitSource);

                updateTargetHit(scripCode, level, remainingQty, tranchePnl, hitSource);

                publishTradeOutcome(targets, scripCode, optionLtp, closeQty,
                    hitSource, tranchePnl, remainingQty == 0);

                log.info("{} {} partial exit: closeQty={} ({}L) remainingQty={} pnl={}",
                    LOG_PREFIX, hitSource, closeQty, lots, remainingQty, String.format("%.2f", tranchePnl));

                if (remainingQty <= 0) break;
            }
        }

        // Update trailing stop after any target hit (with 1% buffer confirmation)
        if (anyTargetHit) {
            updateTrailingSl(targets, targetLevels, optionLtp, entryPrice);
        }

        // Persist updated targets back to Redis
        if (remainingQty <= 0) {
            redisTemplate.delete(targetKey);
            updatePositionStatus(scripCode, "CLOSED", 0);
    
            log.info("{} Position fully closed: {}", LOG_PREFIX, scripCode);
        } else {
            String updatedJson = objectMapper.writeValueAsString(targets);
            redisTemplate.opsForValue().set(targetKey, updatedJson);
        }
    }

    /**
     * Update 5-minute rolling high for option price tracking.
     * Used for 1% drawdown auto-exit detection.
     */
    private void updateOptionHighFiveMin(Map<String, Object> targets, double currentOptionLtp, long now) {
        double prevHigh = targets.get("optionHighFiveMin") != null
            ? ((Number) targets.get("optionHighFiveMin")).doubleValue() : currentOptionLtp;
        long prevTimestamp = targets.get("optionHighFiveMinUpdatedAt") != null
            ? ((Number) targets.get("optionHighFiveMinUpdatedAt")).longValue() : now;

        long fiveMinMs = 5 * 60 * 1000;

        if (now - prevTimestamp > fiveMinMs) {
            // 5-min window expired: reset with current price as new high
            targets.put("optionHighFiveMin", currentOptionLtp);
            targets.put("optionHighFiveMinUpdatedAt", now);
        } else if (currentOptionLtp > prevHigh) {
            // New high within current 5-min window
            targets.put("optionHighFiveMin", currentOptionLtp);
        }
        // else: keep existing high within window
    }

    /**
     * Update trailing SL based on targets hit with 1% buffer confirmation.
     *
     * After T1 hit: SL = T1 price, but ONLY once option LTP >= T1 * 1.01
     * After T2 hit: SL = T2 price, but ONLY once option LTP >= T2 * 1.01
     * After T3 hit: SL = T3 price, but ONLY once option LTP >= T3 * 1.01
     *
     * This prevents whipsaw: price barely touches target, partial exit happens,
     * then immediate dip would stop out at the new SL. The 1% confirmation
     * ensures the breakout is real before trailing up.
     */
    @SuppressWarnings("unchecked")
    private void updateTrailingSl(Map<String, Object> targets,
                                   List<Map<String, Object>> targetLevels,
                                   double currentLtp, double entryPrice) {
        // Walk from highest hit target downward to find the best SL level
        // that has been confirmed (price went 1% above it)
        double newSl = -1;
        String confirmedLevel = null;

        for (int i = targetLevels.size() - 1; i >= 0; i--) {
            Map<String, Object> t = targetLevels.get(i);
            if (!Boolean.TRUE.equals(t.get("hit"))) continue;

            double targetPrice = ((Number) t.get("price")).doubleValue();
            String level = (String) t.get("level");

            // Check 1% buffer: has price gone at least 1% above this target?
            if (currentLtp >= targetPrice * 1.01) {
                newSl = targetPrice;
                confirmedLevel = level;
                break; // Highest confirmed target wins
            }
        }

        if (newSl <= 0) return;

        double currentSl = ((Number) targets.get("currentSl")).doubleValue();
        if (newSl > currentSl) {
            targets.put("currentSl", newSl);
            log.info("{} Trailing SL updated to {} ({}) from {} — price {} confirmed 1% above",
                LOG_PREFIX, String.format("%.2f", newSl), confirmedLevel,
                String.format("%.2f", currentSl), String.format("%.2f", currentLtp));

            // Also update the position's SL in Redis for display
            updatePositionSl(targets, newSl);
        }
    }

    /**
     * Update position's SL field in Redis for frontend display.
     */
    @SuppressWarnings("unchecked")
    private void updatePositionSl(Map<String, Object> targets, double newSl) {
        try {
            String scripCode = (String) targets.get("scripCode");
            String posKey = POSITION_PREFIX + scripCode;
            String posJson = redisTemplate.opsForValue().get(posKey);
            if (posJson == null) return;

            Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);
            pos.put("sl", newSl);
            pos.put("trailingType", "TARGET_TRAIL");
            pos.put("trailingStop", newSl);
            redisTemplate.opsForValue().set(posKey, objectMapper.writeValueAsString(pos));
        } catch (Exception e) {
            log.debug("{} Could not update position SL: {}", LOG_PREFIX, e.getMessage());
        }
    }

    /**
     * Add an exit history entry to the position in Redis.
     * Each entry records: level, lots, qty, price, timestamp, source.
     */
    @SuppressWarnings("unchecked")
    private void addExitHistoryEntry(String scripCode, String level, int lots, int qty,
                                      double price, long timestamp, String source) {
        try {
            String posKey = POSITION_PREFIX + scripCode;
            String posJson = redisTemplate.opsForValue().get(posKey);
            if (posJson == null) return;

            Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);

            List<Map<String, Object>> exitHistory = pos.get("exitHistory") != null
                ? (List<Map<String, Object>>) pos.get("exitHistory")
                : new ArrayList<>();

            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("level", level);
            entry.put("lots", lots);
            entry.put("qty", qty);
            entry.put("price", price);
            entry.put("timestamp", timestamp);
            entry.put("source", source);
            exitHistory.add(entry);

            pos.put("exitHistory", exitHistory);
            redisTemplate.opsForValue().set(posKey, objectMapper.writeValueAsString(pos));

            log.info("{} Exit history added for {}: {} {}L @{} ({})",
                LOG_PREFIX, scripCode, level, lots, String.format("%.2f", price), source);
        } catch (Exception e) {
            log.error("{} Failed to add exit history for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
        }
    }

    /**
     * Get latest price from Redis price cache.
     * Redis is now updated on every tick (not just at candle boundary) thanks to
     * the per-tick cachePrice() call in TickAggregator.processRecord().
     */
    private double getLtpFromRedis(String exchange, String scripCode) {
        try {
            String exch = exchange != null ? exchange : "M";
            String key = PRICE_PREFIX + exch + ":" + scripCode;
            String val = redisTemplate.opsForValue().get(key);
            if (val != null && !val.isEmpty()) {
                return Double.parseDouble(val);
            }
            // Fallback: try N exchange
            if (!"N".equals(exch)) {
                key = PRICE_PREFIX + "N:" + scripCode;
                val = redisTemplate.opsForValue().get(key);
                if (val != null && !val.isEmpty()) {
                    return Double.parseDouble(val);
                }
            }
        } catch (Exception e) {
            log.debug("{} Could not get LTP for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
        }
        return -1;
    }

    /**
     * Update position's currentPrice, equityLtp, and unrealizedPnl in Redis.
     * Broadcasts updated position via WebSocket for real-time frontend display.
     */
    @SuppressWarnings("unchecked")
    private void updatePositionPrice(String scripCode, double optionLtp, double equityLtp,
                                      double entryPrice, int remainingQty) {
        try {
            String posKey = POSITION_PREFIX + scripCode;
            String posJson = redisTemplate.opsForValue().get(posKey);
            if (posJson == null) return;

            Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);
            pos.put("currentPrice", optionLtp);
            if (equityLtp > 0) {
                pos.put("equityLtp", equityLtp);
            }
            pos.put("unrealizedPnl", (optionLtp - entryPrice) * remainingQty);
            pos.put("updatedAt", System.currentTimeMillis());

            String updatedJson = objectMapper.writeValueAsString(pos);
            redisTemplate.opsForValue().set(posKey, updatedJson);

            // Push real-time update via WebSocket
            try {
                sessionManager.broadcastPositionUpdate(scripCode, pos);
            } catch (Exception wsEx) {
                log.debug("{} WebSocket broadcast failed for {}: {}", LOG_PREFIX, scripCode, wsEx.getMessage());
            }
        } catch (Exception e) {
            log.debug("{} Could not update position price for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
        }
    }

    /**
     * Update target hit flag, exit reason, and realized PnL in position.
     */
    @SuppressWarnings("unchecked")
    private void updateTargetHit(String scripCode, String level, int remainingQty,
                                  double tranchePnl, String exitReason) {
        try {
            String posKey = POSITION_PREFIX + scripCode;
            String posJson = redisTemplate.opsForValue().get(posKey);
            if (posJson == null) return;

            Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);

            // Set target hit flag
            switch (level) {
                case "T1" -> { pos.put("t1Hit", true); pos.put("tp1Hit", true); }
                case "T2" -> pos.put("t2Hit", true);
                case "T3" -> pos.put("t3Hit", true);
                case "T4" -> pos.put("t4Hit", true);
            }

            pos.put("exitReason", exitReason);
            pos.put("qtyOpen", remainingQty);
            double existing = pos.get("realizedPnl") != null ? ((Number) pos.get("realizedPnl")).doubleValue() : 0;
            pos.put("realizedPnl", existing + tranchePnl);
            pos.put("updatedAt", System.currentTimeMillis());
            if (remainingQty <= 0) {
                pos.put("status", "CLOSED");
            } else {
                pos.put("status", "PARTIAL_EXIT");
            }

            String updatedJson = objectMapper.writeValueAsString(pos);
            redisTemplate.opsForValue().set(posKey, updatedJson);

            // Push target hit update via WebSocket
            try {
                sessionManager.broadcastPositionUpdate(scripCode, pos);
            } catch (Exception wsEx) {
                log.debug("{} WebSocket broadcast failed for {}: {}", LOG_PREFIX, scripCode, wsEx.getMessage());
            }
        } catch (Exception e) {
            log.error("{} Could not update target hit for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
        }
    }

    /**
     * Update position status in Redis.
     */
    @SuppressWarnings("unchecked")
    private void updatePositionStatus(String scripCode, String status, int qtyOpen) {
        try {
            String posKey = POSITION_PREFIX + scripCode;
            String posJson = redisTemplate.opsForValue().get(posKey);
            if (posJson == null) return;

            Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);
            pos.put("status", status);
            pos.put("qtyOpen", qtyOpen);
            pos.put("updatedAt", System.currentTimeMillis());

            redisTemplate.opsForValue().set(posKey, objectMapper.writeValueAsString(pos));
        } catch (Exception e) {
            log.error("{} Could not update position status for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
        }
    }

    /**
     * Execute full exit — close all remaining quantity and publish outcome.
     * Stores granular exit reason and broadcasts via WebSocket.
     */
    @SuppressWarnings("unchecked")
    private void executeExit(Map<String, Object> targets, String scripCode,
                              double exitPrice, int qty, String exitReason, String targetKey) {
        double entryPrice = ((Number) targets.get("entryPrice")).doubleValue();
        double pnl = (exitPrice - entryPrice) * qty;

        // Update position as fully closed
        try {
            String posKey = POSITION_PREFIX + scripCode;
            String posJson = redisTemplate.opsForValue().get(posKey);
            if (posJson != null) {
                Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);
                double existingRealizedPnl = pos.get("realizedPnl") != null
                    ? ((Number) pos.get("realizedPnl")).doubleValue() : 0;
                pos.put("realizedPnl", existingRealizedPnl + pnl);
                pos.put("qtyOpen", 0);
                pos.put("currentPrice", exitPrice);
                pos.put("unrealizedPnl", 0.0);
                pos.put("status", "CLOSED");
                pos.put("exitReason", exitReason);
                pos.put("slHit", exitReason.contains("SL") || "1% DD".equals(exitReason));
                pos.put("updatedAt", System.currentTimeMillis());
                String updatedJson = objectMapper.writeValueAsString(pos);
                redisTemplate.opsForValue().set(posKey, updatedJson);

                // Broadcast exit via WebSocket
                try {
                    sessionManager.broadcastPositionUpdate(scripCode, pos);
                } catch (Exception wsEx) {
                    log.debug("{} WebSocket broadcast failed for exit {}: {}", LOG_PREFIX, scripCode, wsEx.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("{} Failed to update position for exit: {}", LOG_PREFIX, e.getMessage());
        }

        publishTradeOutcome(targets, scripCode, exitPrice, qty, exitReason, pnl, true);
        redisTemplate.delete(targetKey);

        // Unregister from tick monitoring (position fully closed)

    }

    /**
     * Publish trade outcome to Kafka (matches TradeOutcomeConsumer expected format).
     */
    @SuppressWarnings("unchecked")
    private void publishTradeOutcome(Map<String, Object> targets, String scripCode,
                                      double exitPrice, int qty, String exitReason,
                                      double pnl, boolean isFinalExit) {
        try {
            String tradeId = (String) targets.get("tradeId");
            double entryPrice = ((Number) targets.get("entryPrice")).doubleValue();
            String strategy = (String) targets.get("strategy");
            String direction = (String) targets.get("direction");
            String instrumentSymbol = (String) targets.get("instrumentSymbol");
            long openedAt = ((Number) targets.get("openedAt")).longValue();

            List<Map<String, Object>> targetLevels = (List<Map<String, Object>>) targets.get("targets");
            boolean t1Hit = false, t2Hit = false, t3Hit = false, t4Hit = false;
            if (targetLevels != null) {
                for (Map<String, Object> t : targetLevels) {
                    String level = (String) t.get("level");
                    boolean hit = Boolean.TRUE.equals(t.get("hit"));
                    switch (level) {
                        case "T1" -> t1Hit = hit;
                        case "T2" -> t2Hit = hit;
                        case "T3" -> t3Hit = hit;
                        case "T4" -> t4Hit = hit;
                    }
                }
            }

            LocalDateTime entryTime = LocalDateTime.ofInstant(
                Instant.ofEpochMilli(openedAt), ZoneId.of("Asia/Kolkata"));
            LocalDateTime exitTime = LocalDateTime.now(ZoneId.of("Asia/Kolkata"));

            Map<String, Object> outcome = new LinkedHashMap<>();
            outcome.put("signalId", tradeId);
            outcome.put("scripCode", scripCode);
            outcome.put("companyName", instrumentSymbol);
            outcome.put("entryPrice", entryPrice);
            outcome.put("exitPrice", exitPrice);
            outcome.put("pnl", pnl);
            outcome.put("isWin", pnl > 0);
            outcome.put("exitReason", exitReason);
            outcome.put("side", "BUY");
            outcome.put("direction", direction);
            outcome.put("entryTime", entryTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
            outcome.put("exitTime", exitTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
            outcome.put("quantity", qty);
            outcome.put("target1Hit", t1Hit);
            outcome.put("target2Hit", t2Hit);
            outcome.put("target3Hit", t3Hit);
            outcome.put("target4Hit", t4Hit);
            outcome.put("stopHit", exitReason.contains("SL") || "1% DD".equals(exitReason));
            outcome.put("signalType", strategy);
            outcome.put("strategy", strategy);
            outcome.put("signalSource", strategy);
            outcome.put("walletType", "PAPER");

            String json = objectMapper.writeValueAsString(outcome);
            kafkaTemplate.send(tradeOutcomesTopic, scripCode, json);

            log.info("{} Published trade outcome: {} {} exit={} pnl={}",
                LOG_PREFIX, instrumentSymbol, exitReason, String.format("%.2f", exitPrice),
                String.format("%.2f", pnl));

        } catch (Exception e) {
            log.error("{} Failed to publish trade outcome: {}", LOG_PREFIX, e.getMessage());
        }
    }

    /**
     * Manual close of a strategy position.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> closeTrade(String scripCode) {
        String targetKey = TARGETS_PREFIX + scripCode;
        String targetsJson = redisTemplate.opsForValue().get(targetKey);
        if (targetsJson == null) {
            return Map.of("success", false, "error", "No active strategy trade for " + scripCode);
        }

        try {
            Map<String, Object> targets = objectMapper.readValue(targetsJson, Map.class);
            int remainingQty = ((Number) targets.get("remainingQty")).intValue();
            String exchange = (String) targets.get("exchange");
            double entryPrice = ((Number) targets.get("entryPrice")).doubleValue();

            double currentLtp = getLtpFromRedis(exchange, scripCode);
            if (currentLtp <= 0) {
                currentLtp = entryPrice; // Fallback to entry price
            }

            double pnl = (currentLtp - entryPrice) * remainingQty;
            executeExit(targets, scripCode, currentLtp, remainingQty, "MANUAL_CLOSE", targetKey);

            return Map.of(
                "success", true,
                "scripCode", scripCode,
                "exitPrice", currentLtp,
                "quantity", remainingQty,
                "pnl", pnl
            );
        } catch (Exception e) {
            log.error("{} Failed to close trade for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
            return Map.of("success", false, "error", e.getMessage());
        }
    }

    /**
     * EOD auto-exit for NSE positions at 15:25 IST (NSE closes 15:30).
     */
    @Scheduled(cron = "0 25 15 * * MON-FRI", zone = "Asia/Kolkata")
    public void eodExitNsePositions() {
        eodExitForExchanges(Set.of("N", "", null), "15:25 IST (NSE)");
    }

    /**
     * EOD auto-exit for Currency positions at 16:55 IST (Currency closes 17:00).
     */
    @Scheduled(cron = "0 55 16 * * MON-FRI", zone = "Asia/Kolkata")
    public void eodExitCurrencyPositions() {
        eodExitForExchanges(Set.of("C"), "16:55 IST (Currency)");
    }

    /**
     * EOD auto-exit for MCX positions at 23:25 IST (MCX closes 23:30).
     */
    @Scheduled(cron = "0 25 23 * * MON-FRI", zone = "Asia/Kolkata")
    public void eodExitMcxPositions() {
        eodExitForExchanges(Set.of("M"), "23:25 IST (MCX)");
    }

    /**
     * Exchange-aware EOD exit: only closes positions matching the given exchanges.
     */
    @SuppressWarnings("unchecked")
    private void eodExitForExchanges(Set<String> exchanges, String timeLabel) {
        log.info("{} EOD auto-exit triggered at {} for exchanges {}", LOG_PREFIX, timeLabel, exchanges);
        try {
            Set<String> targetKeys = redisTemplate.keys(TARGETS_PREFIX + "*");
            if (targetKeys == null || targetKeys.isEmpty()) {
                log.info("{} No active strategy positions for EOD exit", LOG_PREFIX);
                return;
            }

            int exitCount = 0;
            int skippedCount = 0;
            for (String targetKey : targetKeys) {
                try {
                    String targetsJson = redisTemplate.opsForValue().get(targetKey);
                    if (targetsJson == null) continue;

                    Map<String, Object> targets = objectMapper.readValue(targetsJson, Map.class);
                    String scripCode = (String) targets.get("scripCode");
                    int remainingQty = ((Number) targets.get("remainingQty")).intValue();
                    String exchange = (String) targets.get("exchange");
                    double entryPrice = ((Number) targets.get("entryPrice")).doubleValue();

                    if (remainingQty <= 0) continue;

                    // Only exit positions matching the target exchange(s)
                    String exch = exchange != null ? exchange : "";
                    if (!exchanges.contains(exch)) {
                        skippedCount++;
                        continue;
                    }

                    double currentLtp = getLtpFromRedis(exchange, scripCode);
                    if (currentLtp <= 0) currentLtp = entryPrice;

                    executeExit(targets, scripCode, currentLtp, remainingQty, "EOD", targetKey);
                    exitCount++;
                    log.info("{} EOD exit: {} exch={} qty={} price={}",
                        LOG_PREFIX, scripCode, exch, remainingQty, String.format("%.2f", currentLtp));
                } catch (Exception e) {
                    log.error("{} EOD exit error for {}: {}", LOG_PREFIX, targetKey, e.getMessage());
                }
            }
            log.info("{} EOD exit complete: {} exited, {} skipped (different exchange)", LOG_PREFIX, exitCount, skippedCount);
        } catch (Exception e) {
            log.error("{} EOD exit cycle error: {}", LOG_PREFIX, e.getMessage());
        }
    }

    /**
     * Get all active strategy trades (positions with strategy:targets:* keys).
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getActiveStrategyTrades() {
        List<Map<String, Object>> result = new ArrayList<>();
        try {
            Set<String> targetKeys = redisTemplate.keys(TARGETS_PREFIX + "*");
            if (targetKeys == null) return result;

            for (String key : targetKeys) {
                String json = redisTemplate.opsForValue().get(key);
                if (json != null) {
                    Map<String, Object> targets = objectMapper.readValue(json, Map.class);
                    // Merge with position data for current price
                    String scripCode = (String) targets.get("scripCode");
                    String posJson = redisTemplate.opsForValue().get(POSITION_PREFIX + scripCode);
                    if (posJson != null) {
                        Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);
                        targets.put("currentPrice", pos.get("currentPrice"));
                        targets.put("unrealizedPnl", pos.get("unrealizedPnl"));
                        targets.put("status", pos.get("status"));
                    }
                    result.add(targets);
                }
            }
        } catch (Exception e) {
            log.error("{} Failed to get active trades: {}", LOG_PREFIX, e.getMessage());
        }
        return result;
    }
}
