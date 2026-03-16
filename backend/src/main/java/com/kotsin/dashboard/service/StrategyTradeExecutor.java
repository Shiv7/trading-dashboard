package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.StrategyTradeRequest;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.*;
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
 * 5. eodExitNsePositions() — @Scheduled 15:25 IST NSE, 16:55 CDS, 23:25/23:50 MCX (seasonal)
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
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @Autowired
    private WebSocketSessionManager sessionManager;

    @Autowired
    private OptionTickPriceService tickPriceService;

    @Autowired
    private TransactionCostService transactionCostService;

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

        // 0. Use Greek-enriched targets from Streaming Candle when available.
        // Greek targets are authoritative (Black-Scholes delta/gamma/IV-based) — DO NOT override.
        // Only fall back to computeSmartTargets() for legacy signals without Greek enrichment.
        double optT1 = req.getT1(), optT2 = req.getT2(), optT3 = req.getT3(), optT4 = req.getT4();
        double optSl = req.getSl();
        boolean smartTargetsApplied = false;

        if (req.isGreekEnriched()) {
            // Streaming Candle computed these via Black-Scholes — trust them as-is
            log.info("{} GREEK TARGETS (authoritative) for {}: T1={} T2={} T3={} T4={} SL={} " +
                "delta={} IV={}% DTE={} method={} RR={} thetaImpaired={}",
                LOG_PREFIX, req.getInstrumentSymbol(),
                fmt(optT1), fmt(optT2), fmt(optT3), fmt(optT4), fmt(optSl),
                String.format("%.3f", req.getGreekDelta()),
                String.format("%.1f", req.getGreekIV()),
                req.getGreekDte(), req.getGreekSlMethod(),
                String.format("%.2f", req.getOptionRR()),
                req.isGreekThetaImpaired());
            smartTargetsApplied = true;  // Mark as "smart" for position display
        } else {
            // Legacy path: compute smart targets for signals without Greek enrichment
            try {
                double[] smart = computeSmartTargets(req);
                if (smart != null) {
                    if (smart[0] > 0) optT1 = smart[0];
                    if (smart[1] > 0) optT2 = smart[1];
                    if (smart[2] > 0) optT3 = smart[2];
                    if (smart[3] > 0) optT4 = smart[3];
                    if (smart[4] > 0) optSl = smart[4];
                    smartTargetsApplied = true;
                    log.info("{} SMART TARGETS (legacy) applied for {}: T1={} T2={} T3={} T4={} SL={} " +
                        "(was: T1={} T2={} T3={} T4={} SL={})",
                        LOG_PREFIX, req.getInstrumentSymbol(),
                        fmt(optT1), fmt(optT2), fmt(optT3), fmt(optT4), fmt(optSl),
                        fmt(req.getT1()), fmt(req.getT2()), fmt(req.getT3()), fmt(req.getT4()), fmt(req.getSl()));
                }
            } catch (Exception e) {
                log.warn("{} Smart target computation failed, using signal targets: {}",
                    LOG_PREFIX, e.getMessage());
            }
        }

        // 1. Write position to Redis (standard format WalletService reads)
        Map<String, Object> position = new LinkedHashMap<>();
        position.put("scripCode", scripCode);
        position.put("qtyOpen", req.getQuantity());
        position.put("avgEntry", req.getEntryPrice());
        position.put("side", "SELL".equalsIgnoreCase(req.getSide()) ? "SHORT" : "LONG");
        position.put("direction", req.getDirection());
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
        position.put("executionMode", req.getExecutionMode() != null ? req.getExecutionMode() : "MANUAL");
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
        position.put("optionType", req.getOptionType());  // CE / PE / null
        position.put("optionExpiry", req.getOptionExpiry());  // expiry date string
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
        // Use Streaming Candle's theta-aware allocation when available (e.g. "100,0,0,0" for theta-impaired)
        int totalLots = req.getQuantity() / Math.max(req.getLotSize(), 1);
        int[] lotPercentages = new int[]{40, 30, 20, 10}; // default
        if (req.getLotAllocation() != null && !req.getLotAllocation().isEmpty()) {
            try {
                String[] parts = req.getLotAllocation().split(",");
                if (parts.length == 4) {
                    lotPercentages = new int[]{
                        Integer.parseInt(parts[0].trim()),
                        Integer.parseInt(parts[1].trim()),
                        Integer.parseInt(parts[2].trim()),
                        Integer.parseInt(parts[3].trim())
                    };
                    log.info("{} Using signal lotAllocation: {} (greekEnriched={})",
                        LOG_PREFIX, req.getLotAllocation(), req.isGreekEnriched());
                }
            } catch (NumberFormatException e) {
                log.warn("{} Invalid lotAllocation '{}', using default 40/30/20/10",
                    LOG_PREFIX, req.getLotAllocation());
            }
        }
        int[] lotAlloc = allocateLots(totalLots, lotPercentages);
        int lotSize = Math.max(req.getLotSize(), 1);
        log.info("{} Lot allocation for {} lots: T1={} T2={} T3={} T4={} (pcts={})",
            LOG_PREFIX, totalLots, lotAlloc[0], lotAlloc[1], lotAlloc[2], lotAlloc[3],
            java.util.Arrays.toString(lotPercentages));

        List<Map<String, Object>> targetLevels = new ArrayList<>();
        addTarget(targetLevels, "T1", optT1, lotAlloc[0] * lotSize);
        addTarget(targetLevels, "T2", optT2, lotAlloc[1] * lotSize);
        addTarget(targetLevels, "T3", optT3, lotAlloc[2] * lotSize);
        addTarget(targetLevels, "T4", optT4, lotAlloc[3] * lotSize);
        targets.put("smartTargets", smartTargetsApplied);
        targets.put("targets", targetLevels);

        targets.put("strategy", req.getStrategy());
        targets.put("executionMode", req.getExecutionMode() != null ? req.getExecutionMode() : "MANUAL");
        targets.put("direction", req.getDirection());
        targets.put("exchange", req.getExchange());
        targets.put("lotSize", req.getLotSize());
        targets.put("multiplier", req.getMultiplier());
        targets.put("lots", req.getLots());
        targets.put("instrumentType", req.getInstrumentType());
        targets.put("optionType", req.getOptionType());  // CE / PE / null
        targets.put("optionExpiry", req.getOptionExpiry());  // expiry date for theta decay trailing
        targets.put("strike", req.getStrike());  // option strike for OTM detection
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
        // Greek enrichment metadata (for theta-aware trailing SL and monitoring)
        if (req.isGreekEnriched()) {
            targets.put("greekEnriched", true);
            targets.put("greekDelta", req.getGreekDelta());
            targets.put("greekGamma", req.getGreekGamma());
            targets.put("greekTheta", req.getGreekTheta());
            targets.put("greekIV", req.getGreekIV());
            targets.put("greekDte", req.getGreekDte());
            targets.put("greekMoneynessType", req.getGreekMoneynessType());
            targets.put("greekThetaImpaired", req.isGreekThetaImpaired());
            targets.put("optionRR", req.getOptionRR());
            // Cross-instrument futures SL/targets
            if (req.getFuturesSL() > 0) {
                targets.put("futuresSL", req.getFuturesSL());
                targets.put("futuresT1", req.getFuturesT1());
                targets.put("futuresT2", req.getFuturesT2());
                targets.put("futuresT3", req.getFuturesT3());
                targets.put("futuresT4", req.getFuturesT4());
            }
        }

        try {
            String targetsJson = objectMapper.writeValueAsString(targets);
            redisTemplate.opsForValue().set(TARGETS_PREFIX + scripCode, targetsJson);
            log.info("{} Targets written to Redis: {}{}", LOG_PREFIX, TARGETS_PREFIX, scripCode);
        } catch (Exception e) {
            log.error("{} Failed to write targets to Redis: {}", LOG_PREFIX, e.getMessage());
        }

        // 3. Ensure the option contract is subscribed on the broker WebSocket
        // This guarantees TickAggregator receives ticks and caches price to Redis in real-time
        // MCX uses ExchType "D" for commodity derivatives; CDS uses "C" for currency
        String exch = req.getExchange() != null ? req.getExchange() : "N";
        String exchType = "M".equals(exch) ? "D"
            : "C".equals(exch) ? "C"
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

        // 5. Lock margin in strategy wallet
        lockStrategyWalletMargin(req.getStrategy(), estimatedEntry * req.getQuantity());

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

        // --- Step 3: Separate into above-entry and below-entry clusters ---
        // For options: always LONG on premium (buy CE for bullish, buy PE for bearish).
        // isShort only applies to SELL-side FUTURES, never to option buys.
        boolean isOptionBuy = "OPTION".equalsIgnoreCase(req.getInstrumentType());
        boolean isShort = !isOptionBuy && ("BEARISH".equalsIgnoreCase(req.getDirection()) || "SELL".equalsIgnoreCase(req.getSide()));
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

        // Direction-aware: LONG targets above, SHORT targets below
        List<double[]> targetClusters = isShort ? belowEntry : aboveEntry;
        List<double[]> slClusters = isShort ? aboveEntry : belowEntry;

        // Need at least 2 target clusters for smart targets to be useful
        if (targetClusters.size() < 2) return null;

        // --- Step 4: Assign T1-T4 and SL ---
        double t1 = targetClusters.size() > 0 ? targetClusters.get(0)[0] : 0;
        double t2 = targetClusters.size() > 1 ? targetClusters.get(1)[0] : 0;
        double t3 = targetClusters.size() > 2 ? targetClusters.get(2)[0] : 0;
        double t4 = targetClusters.size() > 3 ? targetClusters.get(3)[0] : 0;

        // T4 fallback: if only 3 clusters, use next round figure beyond T3
        if (t4 <= 0 && t3 > 0) {
            t4 = isShort
                ? Math.floor(t3 / roundStep) * roundStep - roundStep
                : Math.ceil(t3 / roundStep) * roundStep + roundStep;
        }
        // T3 fallback: if only 2 clusters, use next round figure beyond T2
        if (t3 <= 0 && t2 > 0) {
            t3 = isShort
                ? Math.floor(t2 / roundStep) * roundStep - roundStep
                : Math.ceil(t2 / roundStep) * roundStep + roundStep;
        }

        // SL: nearest cluster on the SL side with score >= 2
        double sl = 0;
        for (double[] cluster : slClusters) {
            if (cluster[1] >= 2) {
                sl = cluster[0];
                break;
            }
        }
        // SL fallback: if no strong cluster, use the signal's original SL
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

        // --- 1% Drawdown check: auto-exit if option premium < 1% of 5-min high ---
        // Only applicable to LONG option positions (premium decay). Skip for SHORT futures.
        String instrType = (String) targets.getOrDefault("instrumentType", "OPTION");
        boolean ddApplicable = !("FUTURES".equals(instrType) && "BEARISH".equals(
            (String) targets.getOrDefault("direction", "BULLISH")));
        if (ddApplicable && optionHighFiveMin > 0 && optionLtp <= optionHighFiveMin * 0.01) {
            log.info("{} 1% DD EXIT for {} optionLtp={} (1% of fiveMinHigh={})",
                LOG_PREFIX, scripCode, String.format("%.2f", optionLtp), String.format("%.2f", optionHighFiveMin));
            executeExit(targets, scripCode, optionLtp, remainingQty, "1% DD", targetKey);
            return;
        }

        // --- Dual SL check: whichever level is hit first ---
        double optionSlLevel = currentSl; // already the trailing/current SL for options
        double equitySlLevel = targets.get("equitySl") != null
            ? ((Number) targets.get("equitySl")).doubleValue() : 0;
        String direction = (String) targets.getOrDefault("direction", "BULLISH");
        boolean isBearish = "BEARISH".equals(direction);

        String instrumentType = (String) targets.getOrDefault("instrumentType", "OPTION");
        boolean isShortFutures = "FUTURES".equals(instrumentType) && isBearish;
        // LONG/OPTION: SL hit when price DROPS below SL level
        // SHORT FUTURES: SL hit when price RISES above SL level
        boolean optionSlHit = isShortFutures
            ? optionLtp >= optionSlLevel
            : optionLtp <= optionSlLevel;
        // BEARISH (PE): equity SL is ABOVE entry, hit when price rises past it
        // BULLISH (CE): equity SL is BELOW entry, hit when price drops past it
        boolean equitySlHit = equityLtp > 0 && equitySlLevel > 0
            && (isBearish ? equityLtp >= equitySlLevel : equityLtp <= equitySlLevel);

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
            // LONG/OPTION: target hit when price RISES above target
            // SHORT FUTURES: target hit when price DROPS below target
            boolean optionHit = isShortFutures
                ? optionLtp <= optionTargetPrice
                : optionLtp >= optionTargetPrice;
            // BEARISH (PE): equity targets are BELOW entry, hit when price drops past them
            // BULLISH (CE): equity targets are ABOVE entry, hit when price rises past them
            boolean equityHit = equityLtp > 0 && i < equityTargets.length
                && equityTargets[i] > 0
                && (isBearish ? equityLtp <= equityTargets[i] : equityLtp >= equityTargets[i]);

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

                double grossTranchePnl = isShortFutures
                    ? (entryPrice - optionLtp) * closeQty
                    : (optionLtp - entryPrice) * closeQty;

                // Calculate Zerodha charges for this tranche
                double trancheCharges = 0.0;
                java.util.Map<String, Double> trancheBreakdown = java.util.Collections.emptyMap();
                try {
                    String trExch = (String) targets.getOrDefault("exchange", "N");
                    String trInstr = (String) targets.getOrDefault("instrumentType", "OPTION");
                    TransactionCostService.TradeType tradeType = TransactionCostService.resolveTradeType(trExch, trInstr);
                    String normExch = TransactionCostService.normalizeExchange(trExch);
                    trancheBreakdown = transactionCostService.calculateRoundTripBreakdown(
                            tradeType, entryPrice, optionLtp, closeQty, normExch);
                    trancheCharges = trancheBreakdown.getOrDefault("total", 0.0);
                    // Accumulate breakdown into position
                    accumulateChargeBreakdown(scripCode, trancheBreakdown);
                } catch (Exception chargeEx) {
                    log.warn("{} CHARGES_CALC_ERROR partial scrip={} err={}", LOG_PREFIX, scripCode, chargeEx.getMessage());
                }
                double tranchePnl = grossTranchePnl - trancheCharges;

                int lots = closeQty / Math.max(lotSize, 1);

                // Record exit history entry
                addExitHistoryEntry(scripCode, level, lots, closeQty, optionLtp, now, hitSource);

                updateTargetHit(scripCode, level, remainingQty, tranchePnl, hitSource);

                publishTradeOutcome(targets, scripCode, optionLtp, closeQty,
                    hitSource, tranchePnl, trancheCharges, remainingQty == 0);

                // Credit tranche NET PnL + release proportional margin in strategy wallet
                String trancheStrategy = (String) targets.get("strategy");
                double trancheMarginRelease = entryPrice * closeQty;
                boolean trancheWalletOk = updateStrategyWallet(trancheStrategy, tranchePnl, trancheMarginRelease, scripCode, hitSource);
                if (!trancheWalletOk) {
                    targets.put("walletUpdateFailed", true);
                }

                log.info("{} {} partial exit: closeQty={} ({}L) remainingQty={} pnl={}",
                    LOG_PREFIX, hitSource, closeQty, lots, remainingQty, String.format("%.2f", tranchePnl));

                if (remainingQty <= 0) break;
            }
        }

        // Update trailing stop after any target hit (with 1% buffer confirmation)
        // For OPTION trades: also update on every tick after T2 hit (DTE/time factors change)
        boolean hasT2Hit = false;
        if ("OPTION".equals(instrumentType)) {
            for (Map<String, Object> t : targetLevels) {
                if ("T2".equals(t.get("level")) && Boolean.TRUE.equals(t.get("hit"))) {
                    hasT2Hit = true;
                    break;
                }
            }
        }
        if (anyTargetHit || hasT2Hit) {
            updateTrailingSl(targets, targetLevels, optionLtp, entryPrice);
        }

        // Persist updated targets back to Redis
        if (remainingQty <= 0) {
            boolean walletFailed = Boolean.TRUE.equals(targets.get("walletUpdateFailed"));
            if (!walletFailed) {
                redisTemplate.delete(targetKey);
            } else {
                // Retain target key so reconciliation service can detect and fix the leaked margin
                targets.put("remainingQty", 0);
                String retainJson = objectMapper.writeValueAsString(targets);
                redisTemplate.opsForValue().set(targetKey, retainJson);
                log.warn("{} MARGIN_LEAK_GUARD target key retained (partial wallet update failed) scrip={}",
                    LOG_PREFIX, scripCode);
            }
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
     * After T1 hit: SL = T1 price (with 1% confirmation above T1)
     * After T2 hit: For OPTION trades, uses theta decay-aware trailing SL that
     *               protects more of the T1→T2 gain based on DTE, premium level,
     *               and time of day. For non-OPTION trades, standard 1% confirmation.
     * After T3 hit: SL = T3 price (with 1% confirmation above T3)
     */
    @SuppressWarnings("unchecked")
    private void updateTrailingSl(Map<String, Object> targets,
                                   List<Map<String, Object>> targetLevels,
                                   double currentLtp, double entryPrice) {
        String instrumentType = (String) targets.getOrDefault("instrumentType", "OPTION");
        boolean isOption = "OPTION".equals(instrumentType);

        // Check if T2 has been hit (for decay-aware trailing)
        boolean t2Hit = false;
        double t1Price = 0, t2Price = 0;
        for (Map<String, Object> t : targetLevels) {
            String level = (String) t.get("level");
            if ("T1".equals(level)) {
                t1Price = ((Number) t.get("price")).doubleValue();
            } else if ("T2".equals(level)) {
                t2Price = ((Number) t.get("price")).doubleValue();
                t2Hit = Boolean.TRUE.equals(t.get("hit"));
            }
        }

        // For OPTION trades after T2 hit: use decay-aware trailing SL
        if (isOption && t2Hit && t1Price > 0 && t2Price > 0) {
            double decaySl = computeDecayAwareTrailingSl(targets, t1Price, t2Price, currentLtp);
            if (decaySl > 0) {
                double currentSl = ((Number) targets.get("currentSl")).doubleValue();
                if (decaySl > currentSl) {
                    targets.put("currentSl", decaySl);
                    targets.put("trailingType", "THETA_DECAY");
                    log.info("{} THETA DECAY trailing SL updated to {} from {} — T1={} T2={} price={}",
                        LOG_PREFIX, fmt(decaySl), fmt(currentSl),
                        fmt(t1Price), fmt(t2Price), fmt(currentLtp));
                    updatePositionSl(targets, decaySl);
                }
                return; // Decay-aware trailing takes precedence; skip standard logic
            }
        }

        // Standard trailing: walk from highest hit target downward
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
     * Compute theta decay-aware trailing SL for OPTION trades after T2 hit.
     *
     * FORMULA: Trail SL = T1 + (T2 - T1) × protectionPct
     *
     * LAYER 1 — BASE PROTECTION (by DTE):
     *   DTE = 0 (expiry day) → 90%   (theta catastrophic)
     *   DTE ≤ 2             → 75%   (gamma week, sharp acceleration)
     *   DTE 3-5             → 60%   (moderate decay)
     *   DTE 6-10            → 50%   (balanced)
     *   DTE > 10            → 25%   (theta negligible, give room)
     *   No expiry data      → 50%   (safe default)
     *
     * LAYER 2 — TIME-OF-DAY ADJUSTMENT (5-tier IST schedule):
     *   09:15–11:00  →  +0%  (opening volatility, gamma dominates theta)
     *   11:00–13:00  →  +5%  (midday lull, premium bleeds silently in consolidation)
     *   13:00–14:00  → +10%  (institutional positioning, premium starts fading)
     *   14:00–15:00  → +15%  (accelerated decay, MM spread widening)
     *   15:00–15:25  → +20%  (final stretch, extreme decay, liquidity thins)
     *
     * LAYER 3 — PREMIUM FRAGILITY:
     *   Current premium < ₹20 → +15%  (low premium = high theta sensitivity,
     *                                    small absolute moves = large % loss)
     *
     * LAYER 4 — MONEYNESS:
     *   OTM option → +10%  (100% extrinsic value decays faster than ITM)
     *
     * All layers are ADDITIVE, CAPPED at 95%.
     * SL only moves UPWARD (ratchet — never lowers).
     * Re-evaluated every 2s on each monitoring tick (DTE/time change continuously).
     *
     * @return decay-aware SL price, or -1 if cannot compute
     */
    private double computeDecayAwareTrailingSl(Map<String, Object> targets,
                                                double t1Price, double t2Price,
                                                double currentLtp) {
        // === LAYER 1: Base protection by DTE ===
        double protectionPct = 0.50; // default if no expiry info
        String optionExpiry = (String) targets.get("optionExpiry");
        int dte = -1;

        if (optionExpiry != null && !optionExpiry.isEmpty()) {
            try {
                LocalDate expiryDate = LocalDate.parse(optionExpiry,
                    DateTimeFormatter.ofPattern("yyyy-MM-dd"));
                LocalDate today = LocalDate.now(IST);
                dte = (int) java.time.temporal.ChronoUnit.DAYS.between(today, expiryDate);
                if (dte < 0) dte = 0; // past expiry treated as expiry day

                if (dte == 0) {
                    protectionPct = 0.90;
                } else if (dte <= 2) {
                    protectionPct = 0.75;
                } else if (dte <= 5) {
                    protectionPct = 0.60;
                } else if (dte <= 10) {
                    protectionPct = 0.50;
                } else {
                    protectionPct = 0.25;
                }
            } catch (Exception e) {
                log.debug("{} Could not parse optionExpiry '{}': {}", LOG_PREFIX, optionExpiry, e.getMessage());
            }
        }

        // === LAYER 2: Time-of-day adjustment (5-tier IST schedule) ===
        LocalTime nowTime = LocalTime.now(IST);
        double timeAdj = 0.0;
        if (nowTime.isAfter(LocalTime.of(15, 0))) {
            timeAdj = 0.20; // 15:00-15:25: extreme decay, liquidity thins
        } else if (nowTime.isAfter(LocalTime.of(14, 0))) {
            timeAdj = 0.15; // 14:00-15:00: accelerated decay, MM spread widening
        } else if (nowTime.isAfter(LocalTime.of(13, 0))) {
            timeAdj = 0.10; // 13:00-14:00: institutional positioning, premium fading
        } else if (nowTime.isAfter(LocalTime.of(11, 0))) {
            timeAdj = 0.05; // 11:00-13:00: midday lull, silent theta bleed
        }
        // 09:15-11:00: +0% (gamma dominates, volatility supports premium)
        protectionPct += timeAdj;

        // === LAYER 3: Premium fragility ===
        if (currentLtp < 20.0) {
            protectionPct += 0.15; // low premium = high theta sensitivity
        }

        // === LAYER 4: Moneyness (OTM decays faster) ===
        String optionType = (String) targets.get("optionType");
        Double equitySpot = targets.get("equitySpot") != null
            ? ((Number) targets.get("equitySpot")).doubleValue() : null;
        Double strike = targets.get("strike") != null
            ? ((Number) targets.get("strike")).doubleValue() : null;
        if (optionType != null && equitySpot != null && strike != null && equitySpot > 0 && strike > 0) {
            boolean isOtm = "CE".equals(optionType) ? strike > equitySpot : strike < equitySpot;
            if (isOtm) {
                protectionPct += 0.10;
            }
        }

        // === CAP at 95% ===
        protectionPct = Math.min(protectionPct, 0.95);

        // === COMPUTE trailing SL ===
        double t1t2Distance = t2Price - t1Price;
        double trailSl = t1Price + (t1t2Distance * protectionPct);
        trailSl = Math.round(trailSl * 100.0) / 100.0;

        log.info("{} THETA_DECAY SL: DTE={} base={}% timeAdj=+{}% premium={} otm={} → protection={}% " +
            "trailSl={} (T1={} T2={} dist={})",
            LOG_PREFIX, dte,
            dte == 0 ? "90" : dte <= 2 ? "75" : dte <= 5 ? "60" : dte <= 10 ? "50" : dte > 10 ? "25" : "50",
            String.format("%.0f", timeAdj * 100),
            fmt(currentLtp),
            (optionType != null && strike != null && equitySpot != null) ?
                ("CE".equals(optionType) ? strike > equitySpot : strike < equitySpot) : "unknown",
            String.format("%.0f", protectionPct * 100),
            fmt(trailSl), fmt(t1Price), fmt(t2Price), fmt(t1t2Distance));

        return trailSl;
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
            String trailType = targets.get("trailingType") != null
                ? (String) targets.get("trailingType") : "TARGET_TRAIL";
            pos.put("trailingType", trailType);
            pos.put("trailingStop", newSl);
            redisTemplate.opsForValue().set(posKey, objectMapper.writeValueAsString(pos));
        } catch (Exception e) {
            log.debug("{} Could not update position SL: {}", LOG_PREFIX, e.getMessage());
        }
    }

    /** Accumulate charge breakdown fields into position JSON in Redis (for partial exits). */
    @SuppressWarnings("unchecked")
    private void accumulateChargeBreakdown(String scripCode, java.util.Map<String, Double> breakdown) {
        try {
            String posKey = POSITION_PREFIX + scripCode;
            String posJson = redisTemplate.opsForValue().get(posKey);
            if (posJson == null) return;
            Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);
            for (String[] kv : new String[][]{
                {"chargesBrokerage", "brokerage"}, {"chargesStt", "stt"},
                {"chargesExchange", "exchangeCharges"}, {"chargesGst", "gst"},
                {"chargesSebi", "sebiCharges"}, {"chargesStamp", "stampDuty"}
            }) {
                double existing = pos.get(kv[0]) != null ? ((Number) pos.get(kv[0])).doubleValue() : 0;
                pos.put(kv[0], existing + breakdown.getOrDefault(kv[1], 0.0));
            }
            redisTemplate.opsForValue().set(posKey, objectMapper.writeValueAsString(pos));
        } catch (Exception e) {
            log.warn("{} CHARGE_BREAKDOWN_ACCUMULATE_ERR scrip={} err={}", LOG_PREFIX, scripCode, e.getMessage());
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
            boolean isShort = "SHORT".equals(pos.get("side"));
            pos.put("unrealizedPnl", isShort
                ? (entryPrice - optionLtp) * remainingQty
                : (optionLtp - entryPrice) * remainingQty);
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
        String exitDirection = (String) targets.getOrDefault("direction", "BULLISH");
        String exitInstrType = (String) targets.getOrDefault("instrumentType", "OPTION");
        boolean isExitShortFutures = "FUTURES".equals(exitInstrType) && "BEARISH".equals(exitDirection);
        double grossPnl = isExitShortFutures
            ? (entryPrice - exitPrice) * qty
            : (exitPrice - entryPrice) * qty;

        // ── Calculate Zerodha charges (round-trip: entry BUY + exit SELL) ──
        double totalCharges = 0.0;
        java.util.Map<String, Double> chargeBreakdown = java.util.Collections.emptyMap();
        try {
            String posExchange = (String) targets.getOrDefault("exchange", "N");
            TransactionCostService.TradeType tradeType = TransactionCostService.resolveTradeType(
                    posExchange, exitInstrType);
            String normExchange = TransactionCostService.normalizeExchange(posExchange);
            chargeBreakdown = transactionCostService.calculateRoundTripBreakdown(
                    tradeType, entryPrice, exitPrice, qty, normExchange);
            totalCharges = chargeBreakdown.getOrDefault("total", 0.0);

            log.info("{} CHARGES scrip={} type={} exch={} grossPnl={} charges={} netPnl={} [brok={} stt={} txn={} gst={} sebi={} stamp={}]",
                    LOG_PREFIX, scripCode, tradeType, normExchange,
                    fmt(grossPnl), fmt(totalCharges), fmt(grossPnl - totalCharges),
                    fmt(chargeBreakdown.getOrDefault("brokerage", 0.0)),
                    fmt(chargeBreakdown.getOrDefault("stt", 0.0)),
                    fmt(chargeBreakdown.getOrDefault("exchangeCharges", 0.0)),
                    fmt(chargeBreakdown.getOrDefault("gst", 0.0)),
                    fmt(chargeBreakdown.getOrDefault("sebiCharges", 0.0)),
                    fmt(chargeBreakdown.getOrDefault("stampDuty", 0.0)));
        } catch (Exception e) {
            log.warn("{} CHARGES_CALC_ERROR scrip={} err={}, crediting gross PnL",
                    LOG_PREFIX, scripCode, e.getMessage());
        }

        double netPnl = grossPnl - totalCharges;

        // Update position as fully closed
        try {
            String posKey = POSITION_PREFIX + scripCode;
            String posJson = redisTemplate.opsForValue().get(posKey);
            if (posJson != null) {
                Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);
                double existingRealizedPnl = pos.get("realizedPnl") != null
                    ? ((Number) pos.get("realizedPnl")).doubleValue() : 0;
                pos.put("realizedPnl", existingRealizedPnl + netPnl);
                pos.put("totalCharges", totalCharges);
                pos.put("chargesBrokerage", chargeBreakdown.getOrDefault("brokerage", 0.0));
                pos.put("chargesStt", chargeBreakdown.getOrDefault("stt", 0.0));
                pos.put("chargesExchange", chargeBreakdown.getOrDefault("exchangeCharges", 0.0));
                pos.put("chargesGst", chargeBreakdown.getOrDefault("gst", 0.0));
                pos.put("chargesSebi", chargeBreakdown.getOrDefault("sebiCharges", 0.0));
                pos.put("chargesStamp", chargeBreakdown.getOrDefault("stampDuty", 0.0));
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

        publishTradeOutcome(targets, scripCode, exitPrice, qty, exitReason, netPnl, totalCharges, true);

        // Credit NET PnL + release margin for REMAINING qty only (partial exits already released their share)
        String strategy = (String) targets.get("strategy");
        int remainingQty = targets.get("remainingQty") != null
            ? ((Number) targets.get("remainingQty")).intValue() : qty;
        double marginToRelease = entryPrice * remainingQty;
        boolean walletUpdated = updateStrategyWallet(strategy, netPnl, marginToRelease, scripCode, exitReason);

        if (walletUpdated) {
            redisTemplate.delete(targetKey);
        } else {
            log.warn("{} MARGIN_LEAK_GUARD target key retained (wallet update failed) strategy={} scrip={} marginToRelease={}",
                LOG_PREFIX, strategy, scripCode, fmt(marginToRelease));
        }

        // Unregister from tick monitoring (position fully closed)

    }

    /** Backward-compatible overload — zero charges. */
    @SuppressWarnings("unchecked")
    private void publishTradeOutcome(Map<String, Object> targets, String scripCode,
                                      double exitPrice, int qty, String exitReason,
                                      double pnl, boolean isFinalExit) {
        publishTradeOutcome(targets, scripCode, exitPrice, qty, exitReason, pnl, 0.0, isFinalExit);
    }

    /**
     * Publish trade outcome to Kafka (matches TradeOutcomeConsumer expected format).
     */
    @SuppressWarnings("unchecked")
    private void publishTradeOutcome(Map<String, Object> targets, String scripCode,
                                      double exitPrice, int qty, String exitReason,
                                      double pnl, double totalCharges, boolean isFinalExit) {
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
            outcome.put("totalCharges", totalCharges);
            outcome.put("isWin", pnl > 0);
            outcome.put("exitReason", exitReason);
            boolean isOutcomeShort = "FUTURES".equals(targets.get("instrumentType"))
                && "BEARISH".equals(direction);
            outcome.put("side", isOutcomeShort ? "SELL" : "BUY");
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
            outcome.put("executionMode", targets.getOrDefault("executionMode", "MANUAL"));
            outcome.put("walletType", "PAPER");

            // Enrichment for trade detail drawer
            outcome.put("exchange", targets.getOrDefault("exchange", "N"));
            outcome.put("instrumentType", targets.get("instrumentType"));
            outcome.put("instrumentSymbol", instrumentSymbol);
            outcome.put("confidence", targets.get("confidence"));
            outcome.put("stopLoss", targets.get("sl"));

            // Extract target price levels from targetLevels list
            if (targetLevels != null) {
                for (Map<String, Object> t : targetLevels) {
                    String level = (String) t.get("level");
                    Object price = t.get("price");
                    if (level != null && price != null) {
                        switch (level) {
                            case "T1" -> outcome.put("target1", price);
                            case "T2" -> outcome.put("target2", price);
                            case "T3" -> outcome.put("target3", price);
                            case "T4" -> outcome.put("target4", price);
                        }
                    }
                }
            }

            // Dual-leg levels
            outcome.put("equitySl", targets.get("equitySl"));
            outcome.put("equityT1", targets.get("equityT1"));
            outcome.put("equityT2", targets.get("equityT2"));
            outcome.put("equityT3", targets.get("equityT3"));
            outcome.put("equityT4", targets.get("equityT4"));
            outcome.put("optionSl", targets.get("optionSl"));
            outcome.put("optionT1", targets.get("optionT1"));
            outcome.put("optionT2", targets.get("optionT2"));
            outcome.put("optionT3", targets.get("optionT3"));
            outcome.put("optionT4", targets.get("optionT4"));

            String json = objectMapper.writeValueAsString(outcome);
            kafkaTemplate.send(tradeOutcomesTopic, scripCode, json);

            log.info("{} Published trade outcome: {} {} exit={} pnl={}",
                LOG_PREFIX, instrumentSymbol, exitReason, String.format("%.2f", exitPrice),
                String.format("%.2f", pnl));

        } catch (Exception e) {
            log.error("{} Failed to publish trade outcome: {}", LOG_PREFIX, e.getMessage());
        }
    }

    // ==================== STRATEGY WALLET MANAGEMENT (Lua-atomic) ====================

    /**
     * Lua script for atomic margin lock.
     * Increments usedMargin, dayTradeCount, totalTradeCount; decrements availableMargin.
     * Runs atomically — no other Redis command can interleave.
     */
    private static final String LUA_LOCK_MARGIN =
        "local json = redis.call('GET', KEYS[1])\n" +
        "if not json then return '-1' end\n" +
        "local w = cjson.decode(json)\n" +
        "local margin = tonumber(ARGV[1])\n" +
        "local now = ARGV[2]\n" +
        "w['usedMargin'] = (tonumber(w['usedMargin']) or 0) + margin\n" +
        "w['availableMargin'] = math.max(0, (tonumber(w['currentBalance']) or 0) - w['usedMargin'])\n" +
        "w['dayTradeCount'] = (tonumber(w['dayTradeCount']) or 0) + 1\n" +
        "w['totalTradeCount'] = (tonumber(w['totalTradeCount']) or 0) + 1\n" +
        "w['updatedAt'] = now\n" +
        "w['version'] = (tonumber(w['version']) or 0) + 1\n" +
        "redis.call('SET', KEYS[1], cjson.encode(w))\n" +
        "return tostring(w['usedMargin']) .. '|' .. tostring(w['availableMargin']) .. '|' .. tostring(w['dayTradeCount'])\n";

    /**
     * Lua script for atomic PnL credit + margin release.
     * Updates: currentBalance, usedMargin, availableMargin, realizedPnl, dayRealizedPnl,
     *          totalPnl, dayPnl, totalWinCount, totalLossCount, dayWinCount, dayLossCount,
     *          winRate, peakBalance, maxDrawdownHit, updatedAt, version
     * ARGV: [1]=pnl, [2]=marginToRelease, [3]=updatedAt
     * Returns: "balance|realized|dayPnl|peak|drawdown|totalW|totalL|dayW|dayL"
     */
    private static final String LUA_CREDIT_PNL =
        "local json = redis.call('GET', KEYS[1])\n" +
        "if not json then return '-1' end\n" +
        "local w = cjson.decode(json)\n" +
        "local pnl = tonumber(ARGV[1])\n" +
        "local marginRelease = tonumber(ARGV[2])\n" +
        "local now = ARGV[3]\n" +
        // Update balances
        "w['currentBalance'] = (tonumber(w['currentBalance']) or 0) + pnl\n" +
        "w['usedMargin'] = math.max(0, (tonumber(w['usedMargin']) or 0) - marginRelease)\n" +
        "w['realizedPnl'] = (tonumber(w['realizedPnl']) or 0) + pnl\n" +
        "w['dayRealizedPnl'] = (tonumber(w['dayRealizedPnl']) or 0) + pnl\n" +
        // Win/loss counters
        "if pnl > 0 then\n" +
        "  w['totalWinCount'] = (tonumber(w['totalWinCount']) or 0) + 1\n" +
        "  w['dayWinCount'] = (tonumber(w['dayWinCount']) or 0) + 1\n" +
        "elseif pnl < 0 then\n" +
        "  w['totalLossCount'] = (tonumber(w['totalLossCount']) or 0) + 1\n" +
        "  w['dayLossCount'] = (tonumber(w['dayLossCount']) or 0) + 1\n" +
        "end\n" +
        // Peak balance + max drawdown
        "local peak = tonumber(w['peakBalance']) or 0\n" +
        "if w['currentBalance'] > peak then peak = w['currentBalance'] end\n" +
        "w['peakBalance'] = peak\n" +
        "local dd = peak - w['currentBalance']\n" +
        "local maxDD = tonumber(w['maxDrawdownHit']) or 0\n" +
        "if dd > maxDD then maxDD = dd end\n" +
        "w['maxDrawdownHit'] = maxDD\n" +
        // Derived fields
        "w['availableMargin'] = math.max(0, w['currentBalance'] - w['usedMargin'])\n" +
        "w['totalPnl'] = w['realizedPnl'] + (tonumber(w['unrealizedPnl']) or 0)\n" +
        "w['dayPnl'] = w['dayRealizedPnl'] + (tonumber(w['dayUnrealizedPnl']) or 0)\n" +
        "local totalTrades = (tonumber(w['totalWinCount']) or 0) + (tonumber(w['totalLossCount']) or 0)\n" +
        "w['winRate'] = totalTrades > 0 and ((tonumber(w['totalWinCount']) or 0) / totalTrades * 100) or 0\n" +
        "w['updatedAt'] = now\n" +
        "w['version'] = (tonumber(w['version']) or 0) + 1\n" +
        "redis.call('SET', KEYS[1], cjson.encode(w))\n" +
        "return tostring(w['currentBalance']) .. '|' .. tostring(w['realizedPnl']) .. '|' ..\n" +
        "  tostring(w['dayPnl']) .. '|' .. tostring(peak) .. '|' .. tostring(maxDD) .. '|' ..\n" +
        "  tostring(w['totalWinCount'] or 0) .. '|' .. tostring(w['totalLossCount'] or 0) .. '|' ..\n" +
        "  tostring(w['dayWinCount'] or 0) .. '|' .. tostring(w['dayLossCount'] or 0)\n";

    /**
     * Lock margin in the strategy wallet when a trade is opened.
     * Uses Redis Lua script for atomic field-level update — immune to cross-JVM race.
     */
    private void lockStrategyWalletMargin(String strategy, double marginAmount) {
        if (strategy == null || strategy.isEmpty()) return;
        String walletKey = "wallet:entity:strategy-wallet-" + strategy;
        try {
            DefaultRedisScript<String> script = new DefaultRedisScript<>(LUA_LOCK_MARGIN, String.class);
            String result = redisTemplate.execute(script,
                Collections.singletonList(walletKey),
                String.valueOf(marginAmount),
                LocalDateTime.now(IST).toString());

            if ("-1".equals(result)) {
                log.debug("{} No wallet found for strategy {} — skipping margin lock", LOG_PREFIX, strategy);
                return;
            }

            log.info("{} WALLET_MARGIN_LOCK strategy={} margin={} result={}",
                LOG_PREFIX, strategy, fmt(marginAmount), result);
        } catch (Exception e) {
            log.error("{} Failed to lock wallet margin for {}: {}", LOG_PREFIX, strategy, e.getMessage());
        }
    }

    /**
     * Credit PnL and release margin in the strategy wallet when a trade is closed.
     * Uses Redis Lua script for atomic field-level update — immune to cross-JVM race.
     *
     * All 7 original issues are fixed:
     * 1. dayRealizedPnl updated atomically
     * 2. dayWinCount/dayLossCount incremented atomically
     * 3. peakBalance + maxDrawdownHit tracked atomically
     * 4. Atomic via Redis Lua (no cross-JVM race possible)
     * 5. Trading day reset handled by 8089's ensureTradingDayReset
     * 6. Transaction audit trail saved after atomic update
     * 7. Margin release uses correct qty (caller passes correct amount)
     */
    private boolean updateStrategyWallet(String strategy, double pnl, double marginToRelease,
                                       String scripCode, String exitReason) {
        if (strategy == null || strategy.isEmpty()) return true; // no wallet to update — safe to delete target
        String walletKey = "wallet:entity:strategy-wallet-" + strategy;
        try {
            DefaultRedisScript<String> script = new DefaultRedisScript<>(LUA_CREDIT_PNL, String.class);
            String result = redisTemplate.execute(script,
                Collections.singletonList(walletKey),
                String.valueOf(pnl),
                String.valueOf(marginToRelease),
                LocalDateTime.now(IST).toString());

            if ("-1".equals(result)) {
                log.debug("{} No wallet found for strategy {} — skipping PnL credit", LOG_PREFIX, strategy);
                return true; // wallet doesn't exist — safe to delete target
            }

            // Parse result for logging: "balance|realized|dayPnl|peak|drawdown|totalW|totalL|dayW|dayL"
            String[] parts = result != null ? result.split("\\|") : new String[0];
            String balance = parts.length > 0 ? parts[0] : "?";
            String realized = parts.length > 1 ? parts[1] : "?";
            String dayPnl = parts.length > 2 ? parts[2] : "?";
            String peak = parts.length > 3 ? parts[3] : "?";
            String drawdown = parts.length > 4 ? parts[4] : "?";

            log.info("{} WALLET_PNL_CREDIT strategy={} scrip={} pnl={} marginReleased={} " +
                    "balance={} realized={} dayPnl={} peak={} drawdown={} exit={}",
                LOG_PREFIX, strategy, scripCode, fmt(pnl), fmt(marginToRelease),
                balance, realized, dayPnl, peak, drawdown, exitReason);

            // Broadcast wallet update via WebSocket for instant frontend refresh
            try {
                Map<String, Object> walletUpdate = new LinkedHashMap<>();
                walletUpdate.put("type", "WALLET_UPDATE");
                walletUpdate.put("strategy", strategy);
                walletUpdate.put("currentBalance", parts.length > 0 ? Double.parseDouble(parts[0]) : 0);
                walletUpdate.put("dayPnl", parts.length > 2 ? Double.parseDouble(parts[2]) : 0);
                sessionManager.broadcastWalletUpdate(walletUpdate);
            } catch (Exception wsEx) {
                log.debug("{} Failed to broadcast wallet update: {}", LOG_PREFIX, wsEx.getMessage());
            }

            // Transaction audit trail (separate, non-critical)
            saveWalletTransaction(strategy, scripCode, pnl, marginToRelease, exitReason);
            return true;
        } catch (Exception e) {
            log.error("{} Failed to update wallet for {}: {}", LOG_PREFIX, strategy, e.getMessage());
            return false;
        }
    }

    /**
     * Save a transaction record to Redis list for audit trail.
     * Key: wallet:transactions:{strategy} — capped at last 500 entries.
     */
    private void saveWalletTransaction(String strategy, String scripCode,
                                        double pnl, double marginReleased, String exitReason) {
        try {
            String txnKey = "wallet:transactions:" + strategy;
            Map<String, Object> txn = new LinkedHashMap<>();
            txn.put("timestamp", LocalDateTime.now(IST).toString());
            txn.put("type", "PNL_CREDIT");
            txn.put("strategy", strategy);
            txn.put("scripCode", scripCode);
            txn.put("pnl", pnl);
            txn.put("marginReleased", marginReleased);
            txn.put("exitReason", exitReason);

            String txnJson = objectMapper.writeValueAsString(txn);
            redisTemplate.opsForList().leftPush(txnKey, txnJson);
            redisTemplate.opsForList().trim(txnKey, 0, 499);
        } catch (Exception e) {
            log.debug("{} Failed to save wallet transaction for {}: {}", LOG_PREFIX, strategy, e.getMessage());
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
     * MCX EOD auto-exit — seasonal close aligned with US DST:
     *   US DST active  → MCX closes 23:30 IST → exit at 23:25
     *   US standard    → MCX closes 23:55 IST → exit at 23:50
     * Fires at 23:25 (DST) and 23:50 (standard); each checks if it's the right season.
     */
    @Scheduled(cron = "0 25 23 * * MON-FRI", zone = "Asia/Kolkata")
    public void eodExitMcxPositionsDst() {
        if (isMcxDstClose()) {
            eodExitForExchanges(Set.of("M"), "23:25 IST (MCX DST)");
        } else {
            log.info("{} MCX 23:25 trigger skipped — US standard time, MCX closes 23:55", LOG_PREFIX);
        }
    }

    @Scheduled(cron = "0 50 23 * * MON-FRI", zone = "Asia/Kolkata")
    public void eodExitMcxPositionsStandard() {
        if (!isMcxDstClose()) {
            eodExitForExchanges(Set.of("M"), "23:50 IST (MCX standard)");
        } else {
            log.info("{} MCX 23:50 trigger skipped — US DST active, MCX already closed at 23:30", LOG_PREFIX);
        }
    }

    private static final ZoneId US_EASTERN = ZoneId.of("America/New_York");

    /**
     * Returns true if MCX closes at 23:30 (US DST), false if 23:55 (US standard).
     * Mirrors the seasonal logic from streaming candle TimeframeBoundary.
     */
    private boolean isMcxDstClose() {
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        ZonedDateTime usNoon = today.atTime(12, 0).atZone(US_EASTERN);
        if (usNoon.getZone().getRules().isDaylightSavings(usNoon.toInstant())) return true;

        ZonedDateTime usTomorrow = today.plusDays(1).atTime(12, 0).atZone(US_EASTERN);
        if (usTomorrow.getZone().getRules().isDaylightSavings(usTomorrow.toInstant())) return true;

        ZonedDateTime usLastWeek = today.minusDays(6).atTime(12, 0).atZone(US_EASTERN);
        if (usLastWeek.getZone().getRules().isDaylightSavings(usLastWeek.toInstant())) return true;

        return false;
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

            // Cleanup orphan targets: keys where remainingQty <= 0 or position is already closed
            cleanupOrphanTargets(exchanges);
        } catch (Exception e) {
            log.error("{} EOD exit cycle error: {}", LOG_PREFIX, e.getMessage());
        }
    }

    /**
     * Remove strategy:targets:* keys that are orphaned — remainingQty <= 0 or
     * the corresponding position has qtyOpen == 0.
     */
    @SuppressWarnings("unchecked")
    private void cleanupOrphanTargets(Set<String> exchanges) {
        try {
            Set<String> targetKeys = redisTemplate.keys(TARGETS_PREFIX + "*");
            if (targetKeys == null || targetKeys.isEmpty()) return;

            int cleaned = 0;
            for (String targetKey : targetKeys) {
                try {
                    String targetsJson = redisTemplate.opsForValue().get(targetKey);
                    if (targetsJson == null) continue;

                    Map<String, Object> targets = objectMapper.readValue(targetsJson, Map.class);
                    String scripCode = (String) targets.get("scripCode");
                    String exchange = (String) targets.getOrDefault("exchange", "");
                    int remainingQty = targets.get("remainingQty") != null
                            ? ((Number) targets.get("remainingQty")).intValue() : 0;

                    // Only clean targets for the exchanges that just closed
                    if (!exchanges.contains(exchange)) continue;

                    // Check if orphaned: qty=0 OR position is closed/missing
                    boolean orphaned = false;
                    if (remainingQty <= 0) {
                        orphaned = true;
                    } else {
                        String posJson = redisTemplate.opsForValue().get(POSITION_PREFIX + scripCode);
                        if (posJson == null) {
                            orphaned = true;
                        } else {
                            Map<String, Object> pos = objectMapper.readValue(posJson, Map.class);
                            int qtyOpen = pos.get("qtyOpen") != null
                                    ? ((Number) pos.get("qtyOpen")).intValue() : 0;
                            if (qtyOpen <= 0) orphaned = true;
                        }
                    }

                    if (orphaned) {
                        redisTemplate.delete(targetKey);
                        cleaned++;
                        log.info("{} Cleaned orphan target: {} scrip={} exch={} qty={}",
                                LOG_PREFIX, targetKey, scripCode, exchange, remainingQty);
                    }
                } catch (Exception e) {
                    log.warn("{} Orphan cleanup error for {}: {}", LOG_PREFIX, targetKey, e.getMessage());
                }
            }
            if (cleaned > 0) {
                log.info("{} Orphan target cleanup: {} removed", LOG_PREFIX, cleaned);
            }
        } catch (Exception e) {
            log.error("{} Orphan target cleanup error: {}", LOG_PREFIX, e.getMessage());
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
