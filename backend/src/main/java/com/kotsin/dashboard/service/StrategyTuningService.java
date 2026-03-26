package com.kotsin.dashboard.service;

import lombok.*;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * StrategyTuningService - Analyzes trade outcomes to provide actionable tuning
 * recommendations for SL, targets, position sizing, and confidence gates.
 *
 * Reads live config from application.properties files and computes optimal
 * parameter suggestions based on actual trade performance data from MongoDB.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class StrategyTuningService {

    private final MongoTemplate mongoTemplate;
    private final StrategyWalletsService strategyWalletsService;

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter ISO_FMT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
    private static final String COLLECTION = "trade_outcomes";

    // Config file paths
    private static final String TRADE_EXEC_PROPS = "/home/ubuntu/tradeExcutionModule/src/main/resources/application.properties";
    private static final String STREAMING_CANDLE_PROPS = "/home/ubuntu/streamingcandle/src/main/resources/application.properties";

    // ════════════════════════════════════════════
    //  Public API
    // ════════════════════════════════════════════

    /**
     * Full tuning report for a strategy over the given period.
     */
    public StrategyTuningReport getStrategyTuning(String strategy, Long from, Long to) {
        List<Document> trades = fetchTrades(strategy, from, to);

        if (trades.isEmpty()) {
            log.warn("[STRATEGY_TUNING] No trades found for strategy={} from={} to={}", strategy, from, to);
            return StrategyTuningReport.builder()
                    .strategy(strategy != null ? strategy : "ALL")
                    .tradeCount(0)
                    .period(formatPeriod(from, to))
                    .lastUpdated(LocalDateTime.now(IST).format(ISO_FMT))
                    .build();
        }

        String effectiveStrategy = strategy != null ? strategy : "ALL";

        return StrategyTuningReport.builder()
                .strategy(effectiveStrategy)
                .tradeCount(trades.size())
                .period(formatPeriod(from, to))
                .slAnalysis(computeSLAnalysis(trades, effectiveStrategy))
                .targetAnalysis(computeTargetAnalysis(trades))
                .positionSizing(computePositionSizingAnalysis(trades, effectiveStrategy))
                .confidenceGate(computeConfidenceGateAnalysis(trades))
                .lastUpdated(LocalDateTime.now(IST).format(ISO_FMT))
                .build();
    }

    /**
     * Simulate a config change against historical trades (estimate, not backtest).
     */
    public SimulationResult simulateConfigChange(String strategy, Map<String, String> proposedChanges,
                                                  Long from, Long to) {
        List<Document> trades = fetchTrades(strategy, from, to);
        if (trades.isEmpty()) {
            return SimulationResult.builder()
                    .totalTrades(0)
                    .affectedTrades(0)
                    .description("No trades found for simulation")
                    .details(Collections.emptyList())
                    .build();
        }

        double currentTotalPnl = trades.stream()
                .mapToDouble(t -> getDouble(t, "pnl", 0))
                .sum();
        long currentWins = trades.stream()
                .filter(t -> getDouble(t, "pnl", 0) > 0)
                .count();
        double currentWinRate = trades.isEmpty() ? 0 : (double) currentWins / trades.size() * 100;

        double simulatedTotalPnl = currentTotalPnl;
        int affectedTrades = 0;
        List<SimulationDetail> details = new ArrayList<>();

        for (Map.Entry<String, String> entry : proposedChanges.entrySet()) {
            String configKey = entry.getKey();
            String proposedValue = entry.getValue();

            if (configKey.contains("confidence") || configKey.contains("gate")) {
                // Confidence gate simulation
                double currentGate = readDoubleConfig(TRADE_EXEC_PROPS, configKey, 15);
                double newGate = parseDoubleSafe(proposedValue, currentGate);

                List<Document> belowGate = trades.stream()
                        .filter(t -> getDouble(t, "confidence", 100) < newGate
                                && getDouble(t, "confidence", 100) >= currentGate)
                        .collect(Collectors.toList());

                double eliminatedPnl = belowGate.stream()
                        .mapToDouble(t -> getDouble(t, "pnl", 0))
                        .sum();

                affectedTrades += belowGate.size();
                simulatedTotalPnl -= eliminatedPnl;

                details.add(SimulationDetail.builder()
                        .configKey(configKey)
                        .currentValue(String.valueOf(currentGate))
                        .proposedValue(proposedValue)
                        .impact(String.format("Would eliminate %d trades with net PnL of %.2f",
                                belowGate.size(), eliminatedPnl))
                        .build());

            } else if (configKey.contains("sl") || configKey.contains("atr")) {
                // SL multiplier simulation
                double currentMult = readDoubleConfig(STREAMING_CANDLE_PROPS, configKey, 1.5);
                double newMult = parseDoubleSafe(proposedValue, currentMult);

                // Estimate: trades that hit SL within 5 minutes might survive with wider SL
                List<Document> quickSLHits = trades.stream()
                        .filter(t -> isSLHit(t) && getDouble(t, "durationMinutes", 999) < 5)
                        .collect(Collectors.toList());

                // Rough estimate: if widening SL by X%, ~X/2% of quick SL hits would survive
                double wideningPercent = newMult > currentMult
                        ? ((newMult - currentMult) / currentMult) * 100 : 0;
                int estimatedSaved = (int) (quickSLHits.size() * wideningPercent / 200.0);
                double avgQuickSLLoss = quickSLHits.stream()
                        .mapToDouble(t -> Math.abs(getDouble(t, "pnl", 0)))
                        .average().orElse(0);

                affectedTrades += estimatedSaved;
                simulatedTotalPnl += estimatedSaved * avgQuickSLLoss * 0.3; // conservative recovery estimate

                details.add(SimulationDetail.builder()
                        .configKey(configKey)
                        .currentValue(String.valueOf(currentMult))
                        .proposedValue(proposedValue)
                        .impact(String.format("Estimated %d quick-SL trades might survive, potential recovery ~%.2f",
                                estimatedSaved, estimatedSaved * avgQuickSLLoss * 0.3))
                        .build());

            } else if (configKey.contains("target") && configKey.contains("allocation")) {
                // Target allocation simulation
                details.add(SimulationDetail.builder()
                        .configKey(configKey)
                        .currentValue(readStringConfig(TRADE_EXEC_PROPS, configKey, "unknown"))
                        .proposedValue(proposedValue)
                        .impact("Target allocation changes require full PnL re-simulation (estimate only)")
                        .build());
            } else {
                details.add(SimulationDetail.builder()
                        .configKey(configKey)
                        .currentValue(readStringConfig(TRADE_EXEC_PROPS, configKey,
                                readStringConfig(STREAMING_CANDLE_PROPS, configKey, "unknown")))
                        .proposedValue(proposedValue)
                        .impact("Impact estimation not available for this config key")
                        .build());
            }
        }

        // Recalculate simulated win rate
        long simulatedWins = currentWins; // simplified; gate changes affect this
        double simulatedWinRate = trades.size() > 0
                ? (double) simulatedWins / (trades.size() - affectedTrades) * 100 : 0;

        return SimulationResult.builder()
                .totalTrades(trades.size())
                .affectedTrades(affectedTrades)
                .currentTotalPnl(round2(currentTotalPnl))
                .simulatedTotalPnl(round2(simulatedTotalPnl))
                .netImpact(round2(simulatedTotalPnl - currentTotalPnl))
                .currentWinRate(round2(currentWinRate))
                .simulatedWinRate(round2(simulatedWinRate))
                .description("ESTIMATE only - based on historical trade data, not a true backtest. " +
                        "Actual results will vary based on market conditions.")
                .details(details)
                .build();
    }

    // ════════════════════════════════════════════
    //  SL Analysis
    // ════════════════════════════════════════════

    private SLAnalysis computeSLAnalysis(List<Document> trades, String strategy) {
        double currentAtrMultiplier = readDoubleConfig(STREAMING_CANDLE_PROPS,
                "pattern.signal.atr.sl.multiplier", 1.5);

        // SL hit trades
        List<Document> slHitTrades = trades.stream()
                .filter(this::isSLHit)
                .collect(Collectors.toList());

        double slHitRate = trades.isEmpty() ? 0 : (double) slHitTrades.size() / trades.size() * 100;

        // Average SL distance as % of entry price
        // For OPTION trades, use equity (underlying) SL/entry to avoid inflated % from small premiums
        double avgSlDistance = trades.stream()
                .filter(t -> getDouble(t, "entryPrice", 0) > 0 && getDouble(t, "stopLoss", 0) > 0)
                .mapToDouble(t -> {
                    boolean isOption = "OPTION".equals(getString(t, "instrumentType", ""));
                    double entry, sl;
                    if (isOption && getDouble(t, "equitySl", 0) > 0) {
                        // Use underlying equity prices for option trades
                        entry = getDouble(t, "equityT1", 0) > 0
                                ? getDouble(t, "entryPrice", 0) : getDouble(t, "entryPrice", 0);
                        // For options, compute from equity levels if available
                        double eqEntry = getDouble(t, "equityT1", 0); // approximate equity entry
                        double eqSl = getDouble(t, "equitySl", 0);
                        if (eqEntry > 0 && eqSl > 0) {
                            return Math.abs(eqEntry - eqSl) / eqEntry * 100;
                        }
                    }
                    entry = getDouble(t, "entryPrice", 0);
                    sl = getDouble(t, "stopLoss", 0);
                    return Math.abs(entry - sl) / entry * 100;
                })
                .average().orElse(0);

        // Average ATR at entry (will be 0 for pre-pipeline trades — show as N/A on frontend)
        double avgAtrAtEntry = trades.stream()
                .filter(t -> getDouble(t, "atr", 0) > 0)
                .mapToDouble(t -> getDouble(t, "atr", 0))
                .average().orElse(0);

        // SL/ATR ratio: -1 sentinel means "ATR data not available"
        double slAtrRatio = avgAtrAtEntry > 0 ? avgSlDistance / avgAtrAtEntry : -1;

        // Average SL loss
        double avgSlLoss = slHitTrades.stream()
                .mapToDouble(t -> getDouble(t, "pnl", 0))
                .average().orElse(0);

        // SL hits within 5 minutes
        List<Document> quickSLHits = slHitTrades.stream()
                .filter(t -> getDouble(t, "durationMinutes", 999) < 5)
                .collect(Collectors.toList());
        int slWithin5Min = quickSLHits.size();
        double slWithin5MinPercent = slHitTrades.isEmpty() ? 0
                : (double) slWithin5Min / slHitTrades.size() * 100;

        // Per-exchange breakdown
        List<ExchangeSLStats> exchangeBreakdown = computeExchangeSLBreakdown(trades, slHitTrades);

        // Recommendations
        List<TuningRecommendation> recommendations = new ArrayList<>();

        // Check NSE SL rate
        ExchangeSLStats nseStats = exchangeBreakdown.stream()
                .filter(e -> "NSE".equals(e.getExchange()))
                .findFirst().orElse(null);
        if (nseStats != null && nseStats.getSlRate() > 45 && nseStats.getTradeCount() >= 10) {
            double recommended = round2(currentAtrMultiplier + 0.3);
            recommendations.add(TuningRecommendation.builder()
                    .id("sl-widen-nse")
                    .title("Widen SL ATR Multiplier for NSE")
                    .description(String.format("NSE SL hit rate is %.1f%% (> 45%%). Widening SL by 0.3x ATR may reduce premature exits.",
                            nseStats.getSlRate()))
                    .configKey("pattern.signal.atr.sl.multiplier")
                    .configFile("STREAMING_CANDLE")
                    .currentValue(String.valueOf(currentAtrMultiplier))
                    .recommendedValue(String.valueOf(recommended))
                    .estimatedImpact(estimateSlWidenImpact(slHitTrades, trades.size()))
                    .exchange("NSE")
                    .build());
        }

        // Check MCX SL rate
        ExchangeSLStats mcxStats = exchangeBreakdown.stream()
                .filter(e -> "MCX".equals(e.getExchange()))
                .findFirst().orElse(null);
        if (mcxStats != null && mcxStats.getSlRate() > 50 && mcxStats.getTradeCount() >= 5) {
            double recommended = round2(currentAtrMultiplier + 0.3);
            recommendations.add(TuningRecommendation.builder()
                    .id("sl-widen-mcx")
                    .title("Widen SL ATR Multiplier for MCX")
                    .description(String.format("MCX SL hit rate is %.1f%% (> 50%%). MCX instruments are more volatile — consider wider SL.",
                            mcxStats.getSlRate()))
                    .configKey("pattern.signal.atr.sl.multiplier")
                    .configFile("STREAMING_CANDLE")
                    .currentValue(String.valueOf(currentAtrMultiplier))
                    .recommendedValue(String.valueOf(recommended))
                    .estimatedImpact(estimateSlWidenImpact(slHitTrades, trades.size()))
                    .exchange("MCX")
                    .build());
        }

        // Quick SL hit pattern
        if (slWithin5MinPercent > 60 && slHitTrades.size() >= 5) {
            recommendations.add(TuningRecommendation.builder()
                    .id("sl-entry-timing")
                    .title("Entry Timing Issue Detected")
                    .description(String.format("%.1f%% of SL hits occur within 5 minutes of entry. " +
                            "This suggests an entry timing problem, not SL distance. " +
                            "Consider adding a confirmation candle requirement.", slWithin5MinPercent))
                    .configKey("pattern.signal.entry.confirmation")
                    .configFile("STREAMING_CANDLE")
                    .currentValue("N/A")
                    .recommendedValue("Add confirmation candle filter")
                    .estimatedImpact("Reduce quick-SL trades by ~30-40%")
                    .exchange("ALL")
                    .build());
        }

        return SLAnalysis.builder()
                .currentAtrMultiplier(currentAtrMultiplier)
                .avgSlDistance(round2(avgSlDistance))
                .avgAtrAtEntry(round2(avgAtrAtEntry))
                .slAtrRatio(round2(slAtrRatio))
                .slHitRate(round2(slHitRate))
                .avgSlLoss(round2(avgSlLoss))
                .slWithin5Min(slWithin5Min)
                .slWithin5MinPercent(round2(slWithin5MinPercent))
                .exchangeBreakdown(exchangeBreakdown)
                .recommendations(recommendations)
                .build();
    }

    private List<ExchangeSLStats> computeExchangeSLBreakdown(List<Document> allTrades,
                                                              List<Document> slHitTrades) {
        Map<String, String> exchangeMap = Map.of("N", "NSE", "M", "MCX", "C", "CDS");
        List<ExchangeSLStats> breakdown = new ArrayList<>();

        for (Map.Entry<String, String> ex : exchangeMap.entrySet()) {
            String code = ex.getKey();
            String name = ex.getValue();

            List<Document> exTrades = allTrades.stream()
                    .filter(t -> code.equals(getString(t, "exchange", "")))
                    .collect(Collectors.toList());

            if (exTrades.isEmpty()) continue;

            long exSlHits = slHitTrades.stream()
                    .filter(t -> code.equals(getString(t, "exchange", "")))
                    .count();

            double exSlRate = (double) exSlHits / exTrades.size() * 100;
            double exAvgSlLoss = slHitTrades.stream()
                    .filter(t -> code.equals(getString(t, "exchange", "")))
                    .mapToDouble(t -> getDouble(t, "pnl", 0))
                    .average().orElse(0);

            String recommendation = "Current OK";
            if ("NSE".equals(name) && exSlRate > 45) {
                recommendation = "Widen to +0.3x ATR";
            } else if ("MCX".equals(name) && exSlRate > 50) {
                recommendation = "Widen to +0.3x ATR";
            } else if ("CDS".equals(name) && exSlRate > 50) {
                recommendation = "Widen to +0.3x ATR";
            }

            breakdown.add(ExchangeSLStats.builder()
                    .exchange(name)
                    .slRate(round2(exSlRate))
                    .avgSlLoss(round2(exAvgSlLoss))
                    .tradeCount(exTrades.size())
                    .recommendation(recommendation)
                    .build());
        }

        return breakdown;
    }

    private String estimateSlWidenImpact(List<Document> slHitTrades, int totalTrades) {
        if (slHitTrades.isEmpty() || totalTrades == 0) return "Insufficient data";
        double avgSlLoss = slHitTrades.stream()
                .mapToDouble(t -> Math.abs(getDouble(t, "pnl", 0)))
                .average().orElse(0);
        // Conservative estimate: widening saves ~15% of SL hits
        double weeklyEstimate = avgSlLoss * slHitTrades.size() * 0.15 / Math.max(1, totalTrades / 50.0);
        if (weeklyEstimate > 1000) {
            return String.format("+₹%.0fK/week (estimated)", weeklyEstimate / 1000);
        }
        return String.format("+₹%.0f/week (estimated)", weeklyEstimate);
    }

    // ════════════════════════════════════════════
    //  Target Analysis
    // ════════════════════════════════════════════

    private TargetAnalysis computeTargetAnalysis(List<Document> trades) {
        // Read current target multipliers
        double t1Mult = readDoubleConfig(TRADE_EXEC_PROPS, "app.trading.targets.target1-multiplier", 1.5);
        double t2Mult = readDoubleConfig(TRADE_EXEC_PROPS, "app.trading.targets.target2-multiplier", 2.5);
        double t3Mult = readDoubleConfig(TRADE_EXEC_PROPS, "app.trading.targets.target3-multiplier", 4.0);
        double t4Mult = readDoubleConfig(TRADE_EXEC_PROPS, "app.trading.targets.target4-multiplier", 6.0);
        double[] currentMultipliers = {t1Mult, t2Mult, t3Mult, t4Mult};

        // Read current allocations
        double a1 = readDoubleConfig(TRADE_EXEC_PROPS, "app.trading.targets.target1-allocation", 40);
        double a2 = readDoubleConfig(TRADE_EXEC_PROPS, "app.trading.targets.target2-allocation", 30);
        double a3 = readDoubleConfig(TRADE_EXEC_PROPS, "app.trading.targets.target3-allocation", 20);
        double a4 = readDoubleConfig(TRADE_EXEC_PROPS, "app.trading.targets.target4-allocation", 10);
        double[] currentAllocation = {a1, a2, a3, a4};

        // Compute hit rates per target level
        List<TargetLevelStats> targetLevels = new ArrayList<>();
        String[] levelNames = {"T1", "T2", "T3", "T4"};
        String[] hitFields = {"target1Hit", "target2Hit", "target3Hit", "target4Hit"};

        for (int i = 0; i < 4; i++) {
            final int idx = i;
            String hitField = hitFields[i];

            long hitCount = trades.stream()
                    .filter(t -> getBool(t, hitField, false))
                    .count();
            double hitRate = trades.isEmpty() ? 0 : (double) hitCount / trades.size() * 100;

            double avgPnlWhenHit = trades.stream()
                    .filter(t -> getBool(t, hitField, false))
                    .mapToDouble(t -> getDouble(t, "pnl", 0))
                    .average().orElse(0);

            double avgDuration = trades.stream()
                    .filter(t -> getBool(t, hitField, false))
                    .mapToDouble(t -> getDouble(t, "durationMinutes", 0))
                    .average().orElse(0);

            double contribution = (hitRate / 100.0) * avgPnlWhenHit * (currentAllocation[idx] / 100.0);

            targetLevels.add(TargetLevelStats.builder()
                    .level(levelNames[i])
                    .hitRate(round2(hitRate))
                    .avgPnlWhenHit(round2(avgPnlWhenHit))
                    .avgDurationMin(round2(avgDuration))
                    .contribution(round2(contribution))
                    .build());
        }

        // Recommendations
        List<TuningRecommendation> recommendations = new ArrayList<>();

        // Check T4 hit rate
        TargetLevelStats t4Stats = targetLevels.get(3);
        if (t4Stats.getHitRate() < 10 && trades.size() >= 20) {
            recommendations.add(TuningRecommendation.builder()
                    .id("target-remove-t4")
                    .title("Consider Removing T4 Target")
                    .description(String.format("T4 hit rate is only %.1f%%. The 10%% allocation to T4 " +
                            "rarely pays off. Consider redistributing to T1/T2.", t4Stats.getHitRate()))
                    .configKey("app.trading.targets.target4-allocation")
                    .configFile("TRADE_EXECUTION")
                    .currentValue(String.valueOf((int) a4))
                    .recommendedValue("0 (redistribute: T1=45, T2=35, T3=20)")
                    .estimatedImpact("Locks in more profit earlier")
                    .exchange("ALL")
                    .build());
        }

        // Check T1→T2 conversion
        TargetLevelStats t1Stats = targetLevels.get(0);
        TargetLevelStats t2Stats = targetLevels.get(1);
        if (t1Stats.getHitRate() > 60 && t2Stats.getHitRate() > 0) {
            double t1t2Conversion = t2Stats.getHitRate() / t1Stats.getHitRate() * 100;
            if (t1t2Conversion < 50) {
                recommendations.add(TuningRecommendation.builder()
                        .id("target-t1-allocation")
                        .title("Increase T1 Exit Allocation")
                        .description(String.format("T1 hit rate is %.1f%% but only %.1f%% of T1 hits convert to T2. " +
                                "Consider taking more profit at T1.", t1Stats.getHitRate(), t1t2Conversion))
                        .configKey("app.trading.targets.target1-allocation")
                        .configFile("TRADE_EXECUTION")
                        .currentValue(String.valueOf((int) a1))
                        .recommendedValue(String.valueOf((int) Math.min(60, a1 + 10)))
                        .estimatedImpact("Lock in more at T1, reduce risk of reversal")
                        .exchange("ALL")
                        .build());
            }
        }

        return TargetAnalysis.builder()
                .targetLevels(targetLevels)
                .currentMultipliers(currentMultipliers)
                .currentAllocation(currentAllocation)
                .recommendations(recommendations)
                .build();
    }

    // ════════════════════════════════════════════
    //  Position Sizing Analysis
    // ════════════════════════════════════════════

    private PositionSizingAnalysis computePositionSizingAnalysis(List<Document> trades, String strategy) {
        double currentRiskPercent = readDoubleConfig(TRADE_EXEC_PROPS,
                "app.trading.risk.default-risk-percentage", 2.0);

        // Average capital employed per trade
        double avgCapitalEmployed = trades.stream()
                .filter(t -> getDouble(t, "positionCost", 0) > 0)
                .mapToDouble(t -> getDouble(t, "positionCost", 0))
                .average().orElse(0);

        // Average risk per trade (SL distance * quantity)
        double avgRiskPerTrade = trades.stream()
                .filter(t -> getDouble(t, "entryPrice", 0) > 0 && getDouble(t, "stopLoss", 0) > 0)
                .mapToDouble(t -> {
                    double entry = getDouble(t, "entryPrice", 0);
                    double sl = getDouble(t, "stopLoss", 0);
                    double qty = getDouble(t, "quantity", 1);
                    return Math.abs(entry - sl) * qty;
                })
                .average().orElse(0);

        double riskPercentOfCapital = avgCapitalEmployed > 0
                ? avgRiskPerTrade / avgCapitalEmployed * 100 : 0;

        // Kelly criterion
        long wins = trades.stream().filter(t -> getDouble(t, "pnl", 0) > 0).count();
        long losses = trades.stream().filter(t -> getDouble(t, "pnl", 0) < 0).count();
        double winRate = (wins + losses) > 0 ? (double) wins / (wins + losses) : 0;

        double avgWin = trades.stream()
                .filter(t -> getDouble(t, "pnl", 0) > 0)
                .mapToDouble(t -> getDouble(t, "pnl", 0))
                .average().orElse(0);
        double avgLoss = trades.stream()
                .filter(t -> getDouble(t, "pnl", 0) < 0)
                .mapToDouble(t -> Math.abs(getDouble(t, "pnl", 0)))
                .average().orElse(1); // avoid division by zero

        double winLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
        double kellyFraction = winLossRatio > 0
                ? (winRate * winLossRatio - (1 - winRate)) / winLossRatio : 0;
        kellyFraction = Math.max(0, kellyFraction);
        double halfKellyPercent = kellyFraction * 50; // half Kelly as percentage

        // Wallet efficiency
        List<WalletEfficiency> walletEfficiency = computeWalletEfficiency(strategy);

        // Profit factor
        double totalWins = trades.stream()
                .filter(t -> getDouble(t, "pnl", 0) > 0)
                .mapToDouble(t -> getDouble(t, "pnl", 0))
                .sum();
        double totalLosses = trades.stream()
                .filter(t -> getDouble(t, "pnl", 0) < 0)
                .mapToDouble(t -> Math.abs(getDouble(t, "pnl", 0)))
                .sum();
        double profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

        // Recommendations
        List<TuningRecommendation> recommendations = new ArrayList<>();

        if (profitFactor > 1.5 && winRate > 0.5 && trades.size() >= 30) {
            double recommendedRisk = Math.min(currentRiskPercent + 0.5,
                    Math.min(halfKellyPercent, 5.0));
            if (recommendedRisk > currentRiskPercent) {
                recommendations.add(TuningRecommendation.builder()
                        .id("sizing-increase-risk")
                        .title("Increase Risk Percentage")
                        .description(String.format("Profit factor %.2f and win rate %.1f%% support higher risk. " +
                                        "Half-Kelly suggests %.1f%%.",
                                profitFactor, winRate * 100, halfKellyPercent))
                        .configKey("app.trading.risk.default-risk-percentage")
                        .configFile("TRADE_EXECUTION")
                        .currentValue(String.valueOf(currentRiskPercent))
                        .recommendedValue(String.valueOf(round2(recommendedRisk)))
                        .estimatedImpact(String.format("Higher per-trade sizing (Kelly=%.1f%%, half-Kelly=%.1f%%)",
                                kellyFraction * 100, halfKellyPercent))
                        .exchange("ALL")
                        .build());
            }
        } else if ((profitFactor < 1 || winRate < 0.4) && trades.size() >= 20) {
            double recommendedRisk = Math.max(0.5, currentRiskPercent - 0.5);
            recommendations.add(TuningRecommendation.builder()
                    .id("sizing-decrease-risk")
                    .title("Decrease Risk Percentage")
                    .description(String.format("Profit factor %.2f and win rate %.1f%% suggest reducing exposure. " +
                                    "Preserve capital until edge improves.",
                            profitFactor, winRate * 100))
                    .configKey("app.trading.risk.default-risk-percentage")
                    .configFile("TRADE_EXECUTION")
                    .currentValue(String.valueOf(currentRiskPercent))
                    .recommendedValue(String.valueOf(round2(recommendedRisk)))
                    .estimatedImpact("Reduce drawdown risk by lowering per-trade sizing")
                    .exchange("ALL")
                    .build());
        }

        return PositionSizingAnalysis.builder()
                .currentRiskPercent(currentRiskPercent)
                .avgCapitalEmployed(round2(avgCapitalEmployed))
                .avgRiskPerTrade(round2(avgRiskPerTrade))
                .riskPercentOfCapital(round2(riskPercentOfCapital))
                .walletEfficiency(walletEfficiency)
                .kellyFraction(round2(kellyFraction))
                .halfKellyPercent(round2(halfKellyPercent))
                .recommendations(recommendations)
                .build();
    }

    private List<WalletEfficiency> computeWalletEfficiency(String strategy) {
        List<WalletEfficiency> efficiencies = new ArrayList<>();
        try {
            var wallets = strategyWalletsService.getSummaries();
            for (var w : wallets) {
                if (!"ALL".equalsIgnoreCase(strategy)
                        && !w.getStrategy().equalsIgnoreCase(strategy)) {
                    continue;
                }

                double balance = w.getCurrentCapital();
                double usedMargin = w.getUsedMargin();
                double idle = balance - usedMargin;
                double idlePct = balance > 0 ? idle / balance * 100 : 0;

                String reason;
                double recommendedRisk;
                if (idlePct > 80) {
                    reason = "High idle capital — consider increasing position sizing or slot count";
                    recommendedRisk = 3.0;
                } else if (idlePct > 60) {
                    reason = "Moderate idle capital — room for additional positions";
                    recommendedRisk = 2.5;
                } else if (idlePct < 20) {
                    reason = "Low idle capital — fully deployed, high margin utilization";
                    recommendedRisk = 1.5;
                } else {
                    reason = "Healthy capital utilization";
                    recommendedRisk = 2.0;
                }

                efficiencies.add(WalletEfficiency.builder()
                        .strategy(w.getStrategy())
                        .currentBalance(round2(balance))
                        .usedMargin(round2(usedMargin))
                        .idleCapital(round2(idle))
                        .idlePercent(round2(idlePct))
                        .recommendedRiskPercent(recommendedRisk)
                        .reason(reason)
                        .build());
            }
        } catch (Exception e) {
            log.error("[STRATEGY_TUNING] Failed to compute wallet efficiency: {}", e.getMessage());
        }
        return efficiencies;
    }

    // ════════════════════════════════════════════
    //  Confidence Gate Analysis
    // ════════════════════════════════════════════

    private ConfidenceGateAnalysis computeConfidenceGateAnalysis(List<Document> trades) {
        double currentGate = readDoubleConfig(TRADE_EXEC_PROPS,
                "fund.allocation.confidence.threshold", 15);

        // Bucket trades by confidence in 10-point ranges
        List<ConfidenceBucket> buckets = new ArrayList<>();
        int[] rangeStarts = {0, 10, 20, 30, 40, 50, 60, 70, 80, 90};

        for (int start : rangeStarts) {
            int end = start + 10;
            final int s = start;
            final int e = end;

            List<Document> bucketTrades = trades.stream()
                    .filter(t -> {
                        double conf = getDouble(t, "confidence", -1);
                        return conf >= s && conf < e;
                    })
                    .collect(Collectors.toList());

            if (bucketTrades.isEmpty()) continue;

            long wins = bucketTrades.stream()
                    .filter(t -> getDouble(t, "pnl", 0) > 0).count();
            double winRate = (double) wins / bucketTrades.size() * 100;
            double avgPnl = bucketTrades.stream()
                    .mapToDouble(t -> getDouble(t, "pnl", 0))
                    .average().orElse(0);

            // R-multiple average
            double avgR = bucketTrades.stream()
                    .filter(t -> getDouble(t, "rMultiple", 0) != 0)
                    .mapToDouble(t -> getDouble(t, "rMultiple", 0))
                    .average().orElse(0);

            buckets.add(ConfidenceBucket.builder()
                    .range(String.format("%d-%d%%", start, end))
                    .tradeCount(bucketTrades.size())
                    .winRate(round2(winRate))
                    .avgPnl(round2(avgPnl))
                    .avgRMultiple(round2(avgR))
                    .profitable(avgPnl > 0)
                    .build());
        }

        // Find optimal gate: lowest bucket where avgPnl is positive
        double optimalGate = currentGate;
        for (ConfidenceBucket bucket : buckets) {
            // Parse the range start
            String rangeStr = bucket.getRange().split("-")[0];
            double rangeStart = parseDoubleSafe(rangeStr, 0);
            if (bucket.isProfitable() && bucket.getTradeCount() >= 3) {
                optimalGate = rangeStart;
                break;
            }
        }

        List<TuningRecommendation> recommendations = new ArrayList<>();

        // Check if raising gate eliminates unprofitable bucket
        List<ConfidenceBucket> unprofitableBuckets = buckets.stream()
                .filter(b -> !b.isProfitable() && b.getTradeCount() >= 3)
                .collect(Collectors.toList());

        if (!unprofitableBuckets.isEmpty()) {
            // Find the highest unprofitable bucket
            ConfidenceBucket worstBucket = unprofitableBuckets.get(unprofitableBuckets.size() - 1);
            String worstRangeEnd = worstBucket.getRange().split("-")[1].replace("%", "");
            double suggestedGate = parseDoubleSafe(worstRangeEnd, currentGate + 10);

            if (suggestedGate > currentGate) {
                int eliminatedTrades = unprofitableBuckets.stream()
                        .mapToInt(ConfidenceBucket::getTradeCount).sum();
                double eliminatedLoss = unprofitableBuckets.stream()
                        .mapToDouble(b -> b.getAvgPnl() * b.getTradeCount()).sum();

                recommendations.add(TuningRecommendation.builder()
                        .id("gate-raise")
                        .title("Raise Confidence Gate")
                        .description(String.format("Raising gate from %.0f to %.0f would eliminate %d unprofitable trades " +
                                        "with total PnL of ₹%.0f.",
                                currentGate, suggestedGate, eliminatedTrades, eliminatedLoss))
                        .configKey("fund.allocation.confidence.threshold")
                        .configFile("TRADE_EXECUTION")
                        .currentValue(String.valueOf((int) currentGate))
                        .recommendedValue(String.valueOf((int) suggestedGate))
                        .estimatedImpact(String.format("Eliminate %d losing trades, save ₹%.0f",
                                eliminatedTrades, Math.abs(eliminatedLoss)))
                        .exchange("ALL")
                        .build());
            }
        }

        return ConfidenceGateAnalysis.builder()
                .currentGate(currentGate)
                .buckets(buckets)
                .optimalGate(optimalGate)
                .recommendations(recommendations)
                .build();
    }

    // ════════════════════════════════════════════
    //  MongoDB query
    // ════════════════════════════════════════════

    private List<Document> fetchTrades(String strategy, Long from, Long to) {
        Document query = new Document();
        Document dateFilter = new Document();
        if (from != null) dateFilter.append("$gte", new Date(from));
        if (to != null) dateFilter.append("$lte", new Date(to));
        if (!dateFilter.isEmpty()) {
            query.append("exitTime", dateFilter);
        } else {
            query.append("exitTime", new Document("$ne", null));
        }

        if (strategy != null && !strategy.isEmpty() && !"ALL".equalsIgnoreCase(strategy)) {
            query.append("strategy", strategy);
        }

        try {
            return mongoTemplate.getCollection(COLLECTION)
                    .find(query).sort(new Document("exitTime", -1)).limit(5000)
                    .into(new ArrayList<>());
        } catch (Exception e) {
            log.error("[STRATEGY_TUNING] Failed to fetch trades: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    // ════════════════════════════════════════════
    //  Config reading helpers
    // ════════════════════════════════════════════

    private Properties readProperties(String filePath) {
        Properties props = new Properties();
        try (FileReader reader = new FileReader(filePath)) {
            props.load(reader);
        } catch (IOException e) {
            log.error("[STRATEGY_TUNING] Cannot read properties from {}: {}", filePath, e.getMessage());
        }
        return props;
    }

    private double readDoubleConfig(String filePath, String key, double defaultVal) {
        Properties props = readProperties(filePath);
        String val = props.getProperty(key);
        if (val == null) return defaultVal;
        try {
            return Double.parseDouble(val.trim());
        } catch (NumberFormatException e) {
            return defaultVal;
        }
    }

    private String readStringConfig(String filePath, String key, String defaultVal) {
        Properties props = readProperties(filePath);
        String val = props.getProperty(key);
        return val != null ? val.trim() : defaultVal;
    }

    // ════════════════════════════════════════════
    //  Document field helpers
    // ════════════════════════════════════════════

    private double getDouble(Document doc, String field, double defaultVal) {
        Object val = doc.get(field);
        if (val == null) return defaultVal;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try {
            return Double.parseDouble(val.toString());
        } catch (NumberFormatException e) {
            return defaultVal;
        }
    }

    private String getString(Document doc, String field, String defaultVal) {
        Object val = doc.get(field);
        return val != null ? val.toString() : defaultVal;
    }

    private boolean getBool(Document doc, String field, boolean defaultVal) {
        Object val = doc.get(field);
        if (val == null) return defaultVal;
        if (val instanceof Boolean) return (Boolean) val;
        return Boolean.parseBoolean(val.toString());
    }

    private boolean isSLHit(Document trade) {
        if (getBool(trade, "stopHit", false)) return true;
        String exitReason = getString(trade, "exitReason", "");
        return exitReason.toUpperCase().contains("SL") || exitReason.toUpperCase().contains("STOP");
    }

    private double parseDoubleSafe(String val, double defaultVal) {
        if (val == null || val.isEmpty()) return defaultVal;
        try {
            return Double.parseDouble(val.trim().replace("%", ""));
        } catch (NumberFormatException e) {
            return defaultVal;
        }
    }

    private String formatPeriod(Long from, Long to) {
        if (from == null && to == null) return "ALL";
        StringBuilder sb = new StringBuilder();
        if (from != null) {
            sb.append(Instant.ofEpochMilli(from).atZone(IST).toLocalDate());
        } else {
            sb.append("start");
        }
        sb.append(" to ");
        if (to != null) {
            sb.append(Instant.ofEpochMilli(to).atZone(IST).toLocalDate());
        } else {
            sb.append("now");
        }
        return sb.toString();
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    // ════════════════════════════════════════════
    //  DTOs
    // ════════════════════════════════════════════

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StrategyTuningReport {
        private String strategy;
        private int tradeCount;
        private String period;
        private SLAnalysis slAnalysis;
        private TargetAnalysis targetAnalysis;
        private PositionSizingAnalysis positionSizing;
        private ConfidenceGateAnalysis confidenceGate;
        private String lastUpdated;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class SLAnalysis {
        private double currentAtrMultiplier;
        private double avgSlDistance;
        private double avgAtrAtEntry;
        private double slAtrRatio;
        private double slHitRate;
        private double avgSlLoss;
        private int slWithin5Min;
        private double slWithin5MinPercent;
        private List<ExchangeSLStats> exchangeBreakdown;
        private List<TuningRecommendation> recommendations;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ExchangeSLStats {
        private String exchange;
        private double slRate;
        private double avgSlLoss;
        private int tradeCount;
        private String recommendation;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TuningRecommendation {
        private String id;
        private String title;
        private String description;
        private String configKey;
        private String configFile;
        private String currentValue;
        private String recommendedValue;
        private String estimatedImpact;
        private String exchange;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TargetAnalysis {
        private List<TargetLevelStats> targetLevels;
        private double[] currentMultipliers;
        private double[] currentAllocation;
        private List<TuningRecommendation> recommendations;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TargetLevelStats {
        private String level;
        private double hitRate;
        private double avgPnlWhenHit;
        private double avgDurationMin;
        private double contribution;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class PositionSizingAnalysis {
        private double currentRiskPercent;
        private double avgCapitalEmployed;
        private double avgRiskPerTrade;
        private double riskPercentOfCapital;
        private List<WalletEfficiency> walletEfficiency;
        private double kellyFraction;
        private double halfKellyPercent;
        private List<TuningRecommendation> recommendations;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class WalletEfficiency {
        private String strategy;
        private double currentBalance;
        private double usedMargin;
        private double idleCapital;
        private double idlePercent;
        private double recommendedRiskPercent;
        private String reason;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ConfidenceGateAnalysis {
        private double currentGate;
        private List<ConfidenceBucket> buckets;
        private double optimalGate;
        private List<TuningRecommendation> recommendations;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ConfidenceBucket {
        private String range;
        private int tradeCount;
        private double winRate;
        private double avgPnl;
        private double avgRMultiple;
        private boolean profitable;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class SimulationResult {
        private int totalTrades;
        private int affectedTrades;
        private double currentTotalPnl;
        private double simulatedTotalPnl;
        private double netImpact;
        private double currentWinRate;
        private double simulatedWinRate;
        private String description;
        private List<SimulationDetail> details;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class SimulationDetail {
        private String configKey;
        private String currentValue;
        private String proposedValue;
        private String impact;
    }
}
