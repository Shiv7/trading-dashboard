package com.kotsin.dashboard.service;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class TradeIntelligenceService {

    private final MongoTemplate mongoTemplate;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final String COLLECTION = "trade_outcomes";
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("MMM dd");
    private static final DateTimeFormatter ISO_FMT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    // ════════════════════════════════════════════
    //  Initialization
    // ════════════════════════════════════════════

    @PostConstruct
    public void ensureIndexes() {
        try {
            var col = mongoTemplate.getCollection(COLLECTION);
            col.createIndex(new Document("exitTime", -1));
            col.createIndex(new Document("strategy", 1).append("exitTime", -1));
            col.createIndex(new Document("exchange", 1).append("exitTime", -1));
            col.createIndex(new Document("scripCode", 1).append("exitTime", -1));
            log.info("[TRADE_INTEL] Indexes ensured on trade_outcomes");
        } catch (Exception e) {
            log.warn("[TRADE_INTEL] Index creation skipped: {}", e.getMessage());
        }
    }

    // ════════════════════════════════════════════
    //  Public API
    // ════════════════════════════════════════════

    /**
     * Full trade intelligence report in a single call.
     */
    public TradeIntelligenceReport getFullIntelligence(Long from, Long to, String strategy, String exchange) {
        List<Document> trades = fetchTrades(from, to, strategy, exchange);
        log.info("[TRADE_INTEL] Fetched {} trades for range [{} - {}], strategy={}, exchange={}",
                trades.size(), from, to, strategy, exchange);

        if (trades.isEmpty()) {
            return TradeIntelligenceReport.builder()
                    .periodSummary(PeriodSummary.builder().build())
                    .exitDistribution(Collections.emptyMap())
                    .targetFunnel(TargetFunnel.builder().build())
                    .rMultipleDistribution(Collections.emptyList())
                    .timeOfDayHeatmap(Collections.emptyList())
                    .durationByOutcome(Collections.emptyList())
                    .topInstruments(Collections.emptyList())
                    .bottomInstruments(Collections.emptyList())
                    .lossClusterAnalysis(Collections.emptyList())
                    .lastUpdated(LocalDateTime.now(IST).format(ISO_FMT))
                    .directionalAnalysis(DirectionalAnalysis.builder().build())
                    .dayOfWeekPerformance(Collections.emptyList())
                    .strategyExchangeMatrix(Collections.emptyList())
                    .confidenceAnalysis(Collections.emptyList())
                    .partialExitAnalysis(PartialExitAnalysis.builder().build())
                    .streakAnalysis(StreakAnalysis.builder().build())
                    .holdingPeriodAnalysis(Collections.emptyList())
                    .riskRewardAnalysis(RiskRewardAnalysis.builder().build())
                    .build();
        }

        Map<String, ExitDistribution> exitDist = computeExitDistribution(trades);
        TargetFunnel funnel = computeTargetFunnel(trades);
        List<RMultipleBucket> rBuckets = computeRMultipleDistribution(trades);
        List<HourStats> heatmap = computeTimeOfDayHeatmap(trades);
        List<DurationStats> durations = computeDurationByOutcome(trades);
        Map<String, List<InstrumentPerf>> instruments = computeInstrumentPerformance(trades);
        List<LossCluster> lossClusters = computeLossClusterAnalysis(trades);
        PeriodComparison periodComp = computePeriodComparison(trades, from, to, strategy, exchange);
        CorrelationMatrix corrMatrix = computeStrategyCorrelation(trades);
        PeriodSummary summary = computePeriodSummary(trades, from, to);

        // R-multiple stats
        List<Double> rValues = trades.stream()
                .map(d -> safeDouble(d, "rMultiple"))
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
        double meanR = rValues.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double medianR = computeMedian(rValues);
        double percentAbove1R = rValues.isEmpty() ? 0
                : rValues.stream().filter(r -> r > 1.0).count() * 100.0 / rValues.size();

        return TradeIntelligenceReport.builder()
                .periodSummary(summary)
                .exitDistribution(exitDist)
                .targetFunnel(funnel)
                .rMultipleDistribution(rBuckets)
                .meanR(round2(meanR))
                .medianR(round2(medianR))
                .percentAbove1R(round2(percentAbove1R))
                .timeOfDayHeatmap(heatmap)
                .durationByOutcome(durations)
                .topInstruments(instruments.getOrDefault("top", Collections.emptyList()))
                .bottomInstruments(instruments.getOrDefault("bottom", Collections.emptyList()))
                .lossClusterAnalysis(lossClusters)
                .periodComparison(periodComp)
                .strategyCorrelation(corrMatrix)
                .lastUpdated(LocalDateTime.now(IST).format(ISO_FMT))
                .directionalAnalysis(computeDirectionalAnalysis(trades))
                .dayOfWeekPerformance(computeDayOfWeekPerformance(trades))
                .strategyExchangeMatrix(computeStrategyExchangeMatrix(trades))
                .confidenceAnalysis(computeConfidenceAnalysis(trades))
                .partialExitAnalysis(computePartialExitAnalysis(trades))
                .streakAnalysis(computeStreakAnalysis(trades))
                .holdingPeriodAnalysis(computeHoldingPeriodAnalysis(trades))
                .riskRewardAnalysis(computeRiskRewardAnalysis(trades))
                .build();
    }

    // ════════════════════════════════════════════
    //  1. Period Summary
    // ════════════════════════════════════════════

    private PeriodSummary computePeriodSummary(List<Document> trades, Long from, Long to) {
        int total = trades.size();
        int wins = 0;
        int losses = 0;
        double totalPnl = 0;
        Map<LocalDate, Double> dailyPnl = new TreeMap<>();

        for (Document t : trades) {
            Double pnl = safeDouble(t, "pnl");
            double p = pnl != null ? pnl : 0;
            totalPnl += p;
            if (p > 0) wins++;
            else if (p < 0) losses++;

            Date exitTime = safeDate(t, "exitTime");
            if (exitTime != null) {
                LocalDate day = exitTime.toInstant().atZone(IST).toLocalDate();
                dailyPnl.merge(day, p, Double::sum);
            }
        }

        double winRate = total > 0 ? (double) wins / total * 100 : 0;
        double avgPnl = total > 0 ? totalPnl / total : 0;

        // Best/worst day
        String bestDay = null;
        double bestDayPnl = Double.NEGATIVE_INFINITY;
        String worstDay = null;
        double worstDayPnl = Double.POSITIVE_INFINITY;
        int profitableDays = 0;

        for (Map.Entry<LocalDate, Double> entry : dailyPnl.entrySet()) {
            if (entry.getValue() > 0) profitableDays++;
            if (entry.getValue() > bestDayPnl) {
                bestDayPnl = entry.getValue();
                bestDay = entry.getKey().format(DATE_FMT);
            }
            if (entry.getValue() < worstDayPnl) {
                worstDayPnl = entry.getValue();
                worstDay = entry.getKey().format(DATE_FMT);
            }
        }

        // SL rate
        long slCount = trades.stream().filter(this::isSlTrade).count();
        double slRate = total > 0 ? slCount * 100.0 / total : 0;

        // Average R-multiple
        List<Double> rValues = trades.stream()
                .map(d -> safeDouble(d, "rMultiple"))
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
        double avgR = rValues.stream().mapToDouble(Double::doubleValue).average().orElse(0);

        // Profit factor
        double grossProfit = trades.stream()
                .map(d -> safeDouble(d, "pnl"))
                .filter(v -> v != null && v > 0)
                .mapToDouble(Double::doubleValue).sum();
        double grossLoss = Math.abs(trades.stream()
                .map(d -> safeDouble(d, "pnl"))
                .filter(v -> v != null && v < 0)
                .mapToDouble(Double::doubleValue).sum());
        double profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999.0 : 0);

        return PeriodSummary.builder()
                .totalTrades(total)
                .wins(wins)
                .losses(losses)
                .winRate(round2(winRate))
                .totalPnl(round2(totalPnl))
                .avgPnlPerTrade(round2(avgPnl))
                .bestDay(bestDay)
                .bestDayPnl(bestDayPnl == Double.NEGATIVE_INFINITY ? 0 : round2(bestDayPnl))
                .worstDay(worstDay)
                .worstDayPnl(worstDayPnl == Double.POSITIVE_INFINITY ? 0 : round2(worstDayPnl))
                .profitableDays(profitableDays)
                .totalTradingDays(dailyPnl.size())
                .slRate(round2(slRate))
                .avgRMultiple(round2(avgR))
                .profitFactor(round2(profitFactor))
                .build();
    }

    // ════════════════════════════════════════════
    //  2. Exit Distribution
    // ════════════════════════════════════════════

    private Map<String, ExitDistribution> computeExitDistribution(List<Document> trades) {
        Map<String, List<Document>> byStrategy = new LinkedHashMap<>();
        byStrategy.put("ALL", trades);
        for (Document t : trades) {
            String strat = safeString(t, "strategy");
            if (strat != null && !strat.isEmpty()) {
                byStrategy.computeIfAbsent(strat, k -> new ArrayList<>()).add(t);
            }
        }

        Map<String, ExitDistribution> result = new LinkedHashMap<>();
        for (Map.Entry<String, List<Document>> entry : byStrategy.entrySet()) {
            result.put(entry.getKey(), buildExitDistribution(entry.getKey(), entry.getValue()));
        }
        return result;
    }

    private ExitDistribution buildExitDistribution(String strategy, List<Document> trades) {
        int total = trades.size();
        int slCount = 0, t1Count = 0, t2Count = 0, t3Count = 0, t4Count = 0, eodCount = 0, otherCount = 0;
        double slPnlSum = 0;
        double slDurationSum = 0;
        int slWithin5Min = 0;

        for (Document t : trades) {
            String bucket = classifyExit(t);
            switch (bucket) {
                case "SL":
                    slCount++;
                    Double pnl = safeDouble(t, "pnl");
                    if (pnl != null) slPnlSum += pnl;
                    Double dur = safeDouble(t, "durationMinutes");
                    if (dur != null) {
                        slDurationSum += dur;
                        if (dur < 5.0) slWithin5Min++;
                    } else {
                        // Try computing from entry/exit times
                        double computed = computeDurationMin(t);
                        if (computed >= 0) {
                            slDurationSum += computed;
                            if (computed < 5.0) slWithin5Min++;
                        }
                    }
                    break;
                case "T1": t1Count++; break;
                case "T2": t2Count++; break;
                case "T3": t3Count++; break;
                case "T4": t4Count++; break;
                case "EOD": eodCount++; break;
                default: otherCount++; break;
            }
        }

        return ExitDistribution.builder()
                .strategy(strategy)
                .totalTrades(total)
                .slCount(slCount)
                .t1Count(t1Count)
                .t2Count(t2Count)
                .t3Count(t3Count)
                .t4Count(t4Count)
                .eodCount(eodCount)
                .otherCount(otherCount)
                .slPercent(pct(slCount, total))
                .t1Percent(pct(t1Count, total))
                .t2Percent(pct(t2Count, total))
                .t3Percent(pct(t3Count, total))
                .t4Percent(pct(t4Count, total))
                .eodPercent(pct(eodCount, total))
                .otherPercent(pct(otherCount, total))
                .avgSlLoss(slCount > 0 ? round2(slPnlSum / slCount) : 0)
                .avgSlDurationMin(slCount > 0 ? round2(slDurationSum / slCount) : 0)
                .slWithin5Min(slWithin5Min)
                .slWithin5MinPercent(pct(slWithin5Min, slCount))
                .build();
    }

    // ════════════════════════════════════════════
    //  3. Target Funnel
    // ════════════════════════════════════════════

    private TargetFunnel computeTargetFunnel(List<Document> trades) {
        int total = trades.size();
        int slHits = (int) trades.stream().filter(this::isSlTrade).count();
        int survived = total - slHits;
        int t1Hits = 0, t2Hits = 0, t3Hits = 0, t4Hits = 0;
        double t1TimeSum = 0, t2TimeSum = 0, t3TimeSum = 0, t4TimeSum = 0;
        int t1TimeCount = 0, t2TimeCount = 0, t3TimeCount = 0, t4TimeCount = 0;

        for (Document t : trades) {
            if (safeBool(t, "target1Hit")) {
                t1Hits++;
                Double time = safeDouble(t, "timeToT1Min");
                if (time != null) { t1TimeSum += time; t1TimeCount++; }
            }
            if (safeBool(t, "target2Hit")) {
                t2Hits++;
                Double time = safeDouble(t, "timeToT2Min");
                if (time != null) { t2TimeSum += time; t2TimeCount++; }
            }
            if (safeBool(t, "target3Hit")) {
                t3Hits++;
                Double time = safeDouble(t, "timeToT3Min");
                if (time != null) { t3TimeSum += time; t3TimeCount++; }
            }
            if (safeBool(t, "target4Hit")) {
                t4Hits++;
                Double time = safeDouble(t, "timeToT4Min");
                if (time != null) { t4TimeSum += time; t4TimeCount++; }
            }
        }

        return TargetFunnel.builder()
                .totalTrades(total)
                .survivedSl(survived)
                .t1HitRate(pct(t1Hits, total))
                .t2HitRate(pct(t2Hits, total))
                .t3HitRate(pct(t3Hits, total))
                .t4HitRate(pct(t4Hits, total))
                .t1ToT2Conversion(pct(t2Hits, t1Hits))
                .t2ToT3Conversion(pct(t3Hits, t2Hits))
                .t3ToT4Conversion(pct(t4Hits, t3Hits))
                .avgTimeToT1Min(t1TimeCount > 0 ? round2(t1TimeSum / t1TimeCount) : 0)
                .avgTimeToT2Min(t2TimeCount > 0 ? round2(t2TimeSum / t2TimeCount) : 0)
                .avgTimeToT3Min(t3TimeCount > 0 ? round2(t3TimeSum / t3TimeCount) : 0)
                .avgTimeToT4Min(t4TimeCount > 0 ? round2(t4TimeSum / t4TimeCount) : 0)
                .build();
    }

    // ════════════════════════════════════════════
    //  4. R-Multiple Distribution
    // ════════════════════════════════════════════

    private List<RMultipleBucket> computeRMultipleDistribution(List<Document> trades) {
        String[] ranges = {"<-2R", "-2 to -1R", "-1 to 0R", "0 to 1R", "1 to 2R", "2 to 3R", ">3R"};
        double[] lowerBounds = {Double.NEGATIVE_INFINITY, -2, -1, 0, 1, 2, 3};
        double[] upperBounds = {-2, -1, 0, 1, 2, 3, Double.POSITIVE_INFINITY};

        int[] counts = new int[ranges.length];
        double[] pnlSums = new double[ranges.length];

        List<Double> rValues = new ArrayList<>();
        for (Document t : trades) {
            Double r = safeDouble(t, "rMultiple");
            if (r == null) continue;
            rValues.add(r);
            Double pnl = safeDouble(t, "pnl");

            for (int i = 0; i < ranges.length; i++) {
                if (r >= lowerBounds[i] && r < upperBounds[i]) {
                    counts[i]++;
                    if (pnl != null) pnlSums[i] += pnl;
                    break;
                }
            }
        }

        int totalWithR = rValues.size();
        List<RMultipleBucket> buckets = new ArrayList<>();
        for (int i = 0; i < ranges.length; i++) {
            buckets.add(RMultipleBucket.builder()
                    .range(ranges[i])
                    .count(counts[i])
                    .percent(pct(counts[i], totalWithR))
                    .avgPnl(counts[i] > 0 ? round2(pnlSums[i] / counts[i]) : 0)
                    .build());
        }
        return buckets;
    }

    // ════════════════════════════════════════════
    //  5. Time of Day Heatmap
    // ════════════════════════════════════════════

    private List<HourStats> computeTimeOfDayHeatmap(List<Document> trades) {
        Map<Integer, List<Document>> byHour = new TreeMap<>();

        for (Document t : trades) {
            Date entryTime = safeDate(t, "entryTime");
            if (entryTime == null) continue;
            int hour = entryTime.toInstant().atZone(IST).getHour();
            byHour.computeIfAbsent(hour, k -> new ArrayList<>()).add(t);
        }

        List<HourStats> result = new ArrayList<>();
        for (Map.Entry<Integer, List<Document>> entry : byHour.entrySet()) {
            int hour = entry.getKey();
            List<Document> hourTrades = entry.getValue();
            int count = hourTrades.size();

            long winCount = hourTrades.stream()
                    .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                    .count();
            double winRate = pct((int) winCount, count);

            double avgPnl = hourTrades.stream()
                    .map(d -> safeDouble(d, "pnl"))
                    .filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue)
                    .average().orElse(0);

            long slHits = hourTrades.stream().filter(this::isSlTrade).count();
            double slPercent = pct((int) slHits, count);

            String assessment;
            if (count == 0) {
                assessment = "NO_ENTRIES";
            } else if (winRate >= 55 && slPercent < 35) {
                assessment = "BEST";
            } else if (winRate >= 50) {
                assessment = "GOOD";
            } else if (winRate >= 40) {
                assessment = "CAUTION";
            } else {
                assessment = "AVOID";
            }

            result.add(HourStats.builder()
                    .hour(hour)
                    .trades(count)
                    .winRate(round2(winRate))
                    .avgPnl(round2(avgPnl))
                    .slPercent(round2(slPercent))
                    .assessment(assessment)
                    .build());
        }
        return result;
    }

    // ════════════════════════════════════════════
    //  6. Duration by Outcome
    // ════════════════════════════════════════════

    private List<DurationStats> computeDurationByOutcome(List<Document> trades) {
        Map<String, List<Double>> durationsByExit = new LinkedHashMap<>();

        for (Document t : trades) {
            String bucket = classifyExit(t);
            double dur = getDurationMinutes(t);
            if (dur < 0) continue;
            durationsByExit.computeIfAbsent(bucket, k -> new ArrayList<>()).add(dur);
        }

        List<DurationStats> result = new ArrayList<>();
        for (Map.Entry<String, List<Double>> entry : durationsByExit.entrySet()) {
            List<Double> durations = entry.getValue();
            double avg = durations.stream().mapToDouble(Double::doubleValue).average().orElse(0);
            double median = computeMedian(durations);

            result.add(DurationStats.builder()
                    .exitType(entry.getKey())
                    .avgDurationMin(round2(avg))
                    .medianDurationMin(round2(median))
                    .count(durations.size())
                    .build());
        }
        return result;
    }

    // ════════════════════════════════════════════
    //  7. Instrument Performance
    // ════════════════════════════════════════════

    private Map<String, List<InstrumentPerf>> computeInstrumentPerformance(List<Document> trades) {
        Map<String, List<Document>> byInstrument = new LinkedHashMap<>();
        for (Document t : trades) {
            String scrip = safeString(t, "scripCode");
            if (scrip == null || scrip.isEmpty()) continue;
            byInstrument.computeIfAbsent(scrip, k -> new ArrayList<>()).add(t);
        }

        List<InstrumentPerf> all = new ArrayList<>();
        for (Map.Entry<String, List<Document>> entry : byInstrument.entrySet()) {
            List<Document> instrTrades = entry.getValue();
            int count = instrTrades.size();

            long wins = instrTrades.stream()
                    .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                    .count();
            double winRate = pct((int) wins, count);

            double totalPnl = instrTrades.stream()
                    .map(d -> safeDouble(d, "pnl"))
                    .filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).sum();

            double avgPnl = instrTrades.stream()
                    .map(d -> safeDouble(d, "pnl"))
                    .filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);

            long slHits = instrTrades.stream().filter(this::isSlTrade).count();
            double slPct = pct((int) slHits, count);

            double avgR = instrTrades.stream()
                    .map(d -> safeDouble(d, "rMultiple"))
                    .filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);

            String companyName = safeString(instrTrades.get(0), "companyName");
            if (companyName == null) companyName = safeString(instrTrades.get(0), "symbol");

            all.add(InstrumentPerf.builder()
                    .scripCode(entry.getKey())
                    .companyName(companyName != null ? companyName : entry.getKey())
                    .trades(count)
                    .winRate(round2(winRate))
                    .totalPnl(round2(totalPnl))
                    .avgPnl(round2(avgPnl))
                    .slPercent(round2(slPct))
                    .avgRMultiple(round2(avgR))
                    .build());
        }

        all.sort(Comparator.comparingDouble(InstrumentPerf::getTotalPnl));
        List<InstrumentPerf> bottom = all.stream().limit(10).collect(Collectors.toList());
        List<InstrumentPerf> top = all.stream()
                .sorted(Comparator.comparingDouble(InstrumentPerf::getTotalPnl).reversed())
                .limit(10)
                .collect(Collectors.toList());

        Map<String, List<InstrumentPerf>> result = new LinkedHashMap<>();
        result.put("top", top);
        result.put("bottom", bottom);
        return result;
    }

    // ════════════════════════════════════════════
    //  8. Loss Cluster Analysis
    // ════════════════════════════════════════════

    private List<LossCluster> computeLossClusterAnalysis(List<Document> trades) {
        List<Document> losers = trades.stream()
                .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p < 0; })
                .collect(Collectors.toList());

        if (losers.isEmpty()) return Collections.emptyList();

        int totalTrades = trades.size();
        long totalWins = trades.stream()
                .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                .count();
        double overallWinRate = totalTrades > 0 ? totalWins * 100.0 / totalTrades : 0;
        double overallSlRate = trades.isEmpty() ? 0
                : trades.stream().filter(this::isSlTrade).count() * 100.0 / totalTrades;

        List<LossCluster> clusters = new ArrayList<>();

        // Cluster 1: Low confidence entries
        List<Document> lowConfLosers = losers.stream()
                .filter(d -> { Double c = safeDouble(d, "confidence"); return c != null && c < 70; })
                .collect(Collectors.toList());
        List<Document> highConfTrades = trades.stream()
                .filter(d -> { Double c = safeDouble(d, "confidence"); return c != null && c >= 70; })
                .collect(Collectors.toList());
        List<Document> lowConfTrades = trades.stream()
                .filter(d -> { Double c = safeDouble(d, "confidence"); return c != null && c < 70; })
                .collect(Collectors.toList());

        if (!lowConfLosers.isEmpty() && !lowConfTrades.isEmpty()) {
            long lowConfWins = lowConfTrades.stream()
                    .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                    .count();
            double lowConfWR = lowConfTrades.isEmpty() ? 0 : lowConfWins * 100.0 / lowConfTrades.size();
            long highConfWins = highConfTrades.stream()
                    .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                    .count();
            double highConfWR = highConfTrades.isEmpty() ? 0 : highConfWins * 100.0 / highConfTrades.size();

            if (lowConfWR < overallWinRate - 5) {
                double avgPnl = lowConfLosers.stream()
                        .map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull)
                        .mapToDouble(Double::doubleValue).average().orElse(0);
                double avgConf = lowConfLosers.stream()
                        .map(d -> safeDouble(d, "confidence")).filter(Objects::nonNull)
                        .mapToDouble(Double::doubleValue).average().orElse(0);

                clusters.add(LossCluster.builder()
                        .name("Low confidence entries")
                        .description(String.format("Trades with confidence < 70 have %.1f%% WR vs %.1f%% for high confidence",
                                lowConfWR, highConfWR))
                        .tradeCount(lowConfLosers.size())
                        .percentOfLosses(pct(lowConfLosers.size(), losers.size()))
                        .avgPnl(round2(avgPnl))
                        .avgConfidence(round2(avgConf))
                        .recommendation("Consider raising minimum confidence threshold or reducing position size for low-confidence signals")
                        .build());
            }
        }

        // Cluster 2: Midday entries (11:00-13:00 IST)
        List<Document> middayLosers = losers.stream()
                .filter(d -> {
                    Date entry = safeDate(d, "entryTime");
                    if (entry == null) return false;
                    int hour = entry.toInstant().atZone(IST).getHour();
                    return hour >= 11 && hour < 13;
                })
                .collect(Collectors.toList());
        List<Document> middayAll = trades.stream()
                .filter(d -> {
                    Date entry = safeDate(d, "entryTime");
                    if (entry == null) return false;
                    int hour = entry.toInstant().atZone(IST).getHour();
                    return hour >= 11 && hour < 13;
                })
                .collect(Collectors.toList());

        if (!middayLosers.isEmpty() && !middayAll.isEmpty()) {
            long middayWins = middayAll.stream()
                    .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                    .count();
            double middayWR = middayAll.isEmpty() ? 0 : middayWins * 100.0 / middayAll.size();

            if (middayWR < overallWinRate - 5) {
                double avgPnl = middayLosers.stream()
                        .map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull)
                        .mapToDouble(Double::doubleValue).average().orElse(0);

                clusters.add(LossCluster.builder()
                        .name("Counter-trend midday")
                        .description(String.format("Midday (11-13 IST) entries have %.1f%% WR vs %.1f%% overall",
                                middayWR, overallWinRate))
                        .tradeCount(middayLosers.size())
                        .percentOfLosses(pct(middayLosers.size(), losers.size()))
                        .avgPnl(round2(avgPnl))
                        .avgConfidence(0)
                        .recommendation("Reduce position size or tighten SL for midday entries during low-volume hours")
                        .build());
            }
        }

        // Cluster 3: Quick SL hits (<5min)
        List<Document> quickSl = losers.stream()
                .filter(d -> {
                    double dur = getDurationMinutes(d);
                    return dur >= 0 && dur < 5 && isSlTrade(d);
                })
                .collect(Collectors.toList());

        if (!quickSl.isEmpty() && quickSl.size() >= 3) {
            double avgPnl = quickSl.stream()
                    .map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);
            double quickSlRate = pct(quickSl.size(), totalTrades);

            if (quickSlRate > overallSlRate * 0.2) { // significant portion
                clusters.add(LossCluster.builder()
                        .name("Quick SL hits (<5min)")
                        .description(String.format("%d trades hit SL within 5 minutes of entry — %.1f%% of all trades",
                                quickSl.size(), quickSlRate))
                        .tradeCount(quickSl.size())
                        .percentOfLosses(pct(quickSl.size(), losers.size()))
                        .avgPnl(round2(avgPnl))
                        .avgConfidence(0)
                        .recommendation("Entry timing may be poor — consider waiting for confirmation candle or widening initial SL")
                        .build());
            }
        }

        // Cluster 4: Exchange-specific worst SL rate
        Map<String, int[]> exchangeStats = new LinkedHashMap<>(); // [total, slCount]
        for (Document t : trades) {
            String ex = safeString(t, "exchange");
            if (ex == null || ex.isEmpty()) continue;
            exchangeStats.computeIfAbsent(ex, k -> new int[2]);
            exchangeStats.get(ex)[0]++;
            if (isSlTrade(t)) exchangeStats.get(ex)[1]++;
        }

        String worstExchange = null;
        double worstSlRate = 0;
        for (Map.Entry<String, int[]> entry : exchangeStats.entrySet()) {
            int[] stats = entry.getValue();
            if (stats[0] < 5) continue; // need minimum sample
            double slRate = stats[0] > 0 ? stats[1] * 100.0 / stats[0] : 0;
            if (slRate > worstSlRate) {
                worstSlRate = slRate;
                worstExchange = entry.getKey();
            }
        }

        if (worstExchange != null && worstSlRate > overallSlRate + 5) {
            String exKey = worstExchange;
            List<Document> exLosers = losers.stream()
                    .filter(d -> exKey.equals(safeString(d, "exchange")))
                    .collect(Collectors.toList());
            double avgPnl = exLosers.stream()
                    .map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);

            clusters.add(LossCluster.builder()
                    .name("Exchange-specific: " + worstExchange)
                    .description(String.format("%s has %.1f%% SL rate vs %.1f%% overall",
                            worstExchange, worstSlRate, overallSlRate))
                    .tradeCount(exLosers.size())
                    .percentOfLosses(pct(exLosers.size(), losers.size()))
                    .avgPnl(round2(avgPnl))
                    .avgConfidence(0)
                    .recommendation("Review strategy calibration for " + worstExchange + " instruments")
                    .build());
        }

        return clusters;
    }

    // ════════════════════════════════════════════
    //  9. Period Comparison
    // ════════════════════════════════════════════

    private PeriodComparison computePeriodComparison(List<Document> currentTrades, Long from, Long to,
                                                      String strategy, String exchange) {
        if (from == null || to == null) return null;

        long duration = to - from;
        long prevFrom = from - duration;
        long prevTo = from;

        List<Document> prevTrades = fetchTrades(prevFrom, prevTo, strategy, exchange);

        PeriodMetrics current = buildPeriodMetrics(currentTrades, from, to, "Current");
        PeriodMetrics previous = buildPeriodMetrics(prevTrades, prevFrom, prevTo, "Previous");

        // Generate insight
        StringBuilder insight = new StringBuilder();
        if (previous.getTradeCount() == 0) {
            insight.append("No previous period data available for comparison.");
        } else {
            double wrDiff = current.getWinRate() - previous.getWinRate();
            double pnlDiff = current.getTotalPnl() - previous.getTotalPnl();
            if (wrDiff > 0) {
                insight.append(String.format("Win rate improved by %.1f%%. ", wrDiff));
            } else if (wrDiff < 0) {
                insight.append(String.format("Win rate declined by %.1f%%. ", Math.abs(wrDiff)));
            }
            if (pnlDiff > 0) {
                insight.append(String.format("Total PnL improved by %.0f. ", pnlDiff));
            } else if (pnlDiff < 0) {
                insight.append(String.format("Total PnL decreased by %.0f. ", Math.abs(pnlDiff)));
            }
            double slDiff = current.getSlPercent() - previous.getSlPercent();
            if (Math.abs(slDiff) > 3) {
                insight.append(String.format("SL rate %s by %.1f%%.",
                        slDiff > 0 ? "increased" : "decreased", Math.abs(slDiff)));
            }
        }

        return PeriodComparison.builder()
                .current(current)
                .previous(previous)
                .insight(insight.toString().trim())
                .build();
    }

    private PeriodMetrics buildPeriodMetrics(List<Document> trades, Long from, Long to, String defaultLabel) {
        int total = trades.size();
        long wins = trades.stream()
                .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                .count();
        double winRate = total > 0 ? wins * 100.0 / total : 0;

        double totalPnl = trades.stream()
                .map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull)
                .mapToDouble(Double::doubleValue).sum();
        double avgPnl = total > 0 ? totalPnl / total : 0;

        long slCount = trades.stream().filter(this::isSlTrade).count();
        double slPct = total > 0 ? slCount * 100.0 / total : 0;

        double avgR = trades.stream()
                .map(d -> safeDouble(d, "rMultiple")).filter(Objects::nonNull)
                .mapToDouble(Double::doubleValue).average().orElse(0);

        double grossProfit = trades.stream()
                .map(d -> safeDouble(d, "pnl")).filter(v -> v != null && v > 0)
                .mapToDouble(Double::doubleValue).sum();
        double grossLoss = Math.abs(trades.stream()
                .map(d -> safeDouble(d, "pnl")).filter(v -> v != null && v < 0)
                .mapToDouble(Double::doubleValue).sum());
        double profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999.0 : 0);

        // Average hold time for wins vs losses
        double avgHoldWin = trades.stream()
                .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                .mapToDouble(this::getDurationMinutes)
                .filter(d -> d >= 0)
                .average().orElse(0);
        double avgHoldLoss = trades.stream()
                .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p < 0; })
                .mapToDouble(this::getDurationMinutes)
                .filter(d -> d >= 0)
                .average().orElse(0);

        // Daily breakdown
        Map<LocalDate, Double> dailyPnl = new TreeMap<>();
        for (Document t : trades) {
            Date exitTime = safeDate(t, "exitTime");
            if (exitTime == null) continue;
            LocalDate day = exitTime.toInstant().atZone(IST).toLocalDate();
            Double pnl = safeDouble(t, "pnl");
            if (pnl != null) dailyPnl.merge(day, pnl, Double::sum);
        }
        int profitableDays = (int) dailyPnl.values().stream().filter(v -> v > 0).count();

        // Label
        String label;
        if (from != null && to != null) {
            LocalDate fromDate = Instant.ofEpochMilli(from).atZone(IST).toLocalDate();
            LocalDate toDate = Instant.ofEpochMilli(to).atZone(IST).toLocalDate();
            label = fromDate.format(DATE_FMT) + " - " + toDate.format(DATE_FMT);
        } else {
            label = defaultLabel;
        }

        return PeriodMetrics.builder()
                .label(label)
                .tradeCount(total)
                .winRate(round2(winRate))
                .avgPnl(round2(avgPnl))
                .totalPnl(round2(totalPnl))
                .slPercent(round2(slPct))
                .avgRMultiple(round2(avgR))
                .profitFactor(round2(profitFactor))
                .avgHoldWin(round2(avgHoldWin))
                .avgHoldLoss(round2(avgHoldLoss))
                .profitableDays(profitableDays)
                .totalTradingDays(dailyPnl.size())
                .build();
    }

    // ════════════════════════════════════════════
    //  10. Strategy Correlation
    // ════════════════════════════════════════════

    private CorrelationMatrix computeStrategyCorrelation(List<Document> trades) {
        // Group by date and strategy → daily PnL
        Map<String, Map<LocalDate, Double>> strategyDailyPnl = new LinkedHashMap<>();

        for (Document t : trades) {
            String strat = safeString(t, "strategy");
            Date exitTime = safeDate(t, "exitTime");
            Double pnl = safeDouble(t, "pnl");
            if (strat == null || exitTime == null || pnl == null) continue;

            LocalDate day = exitTime.toInstant().atZone(IST).toLocalDate();
            strategyDailyPnl.computeIfAbsent(strat, k -> new TreeMap<>())
                    .merge(day, pnl, Double::sum);
        }

        List<String> strategies = new ArrayList<>(strategyDailyPnl.keySet());
        if (strategies.size() < 2) {
            return CorrelationMatrix.builder()
                    .strategies(strategies)
                    .correlations(Collections.emptyMap())
                    .effectiveDiversification(strategies.size())
                    .insight("Need at least 2 strategies with trades for correlation analysis")
                    .build();
        }

        // Collect all dates
        Set<LocalDate> allDates = new TreeSet<>();
        strategyDailyPnl.values().forEach(m -> allDates.addAll(m.keySet()));

        // Compute pairwise correlation
        Map<String, Map<String, Double>> correlations = new LinkedHashMap<>();
        for (String s1 : strategies) {
            Map<String, Double> row = new LinkedHashMap<>();
            for (String s2 : strategies) {
                if (s1.equals(s2)) {
                    row.put(s2, 1.0);
                } else {
                    double corr = computePearsonCorrelation(
                            strategyDailyPnl.get(s1), strategyDailyPnl.get(s2), allDates);
                    row.put(s2, round2(corr));
                }
            }
            correlations.put(s1, row);
        }

        // Effective diversification: sum of 1/(1+avg_abs_corr) for each strategy
        double avgAbsCorr = 0;
        int pairCount = 0;
        for (int i = 0; i < strategies.size(); i++) {
            for (int j = i + 1; j < strategies.size(); j++) {
                Double corr = correlations.get(strategies.get(i)).get(strategies.get(j));
                if (corr != null && !Double.isNaN(corr)) {
                    avgAbsCorr += Math.abs(corr);
                    pairCount++;
                }
            }
        }
        avgAbsCorr = pairCount > 0 ? avgAbsCorr / pairCount : 0;
        double effectiveDiv = strategies.size() * (1 - avgAbsCorr);
        effectiveDiv = Math.max(1, effectiveDiv);

        // Insight
        String insight;
        if (avgAbsCorr < 0.3) {
            insight = String.format("Strategies show low correlation (avg %.2f) — good diversification", avgAbsCorr);
        } else if (avgAbsCorr < 0.6) {
            insight = String.format("Moderate correlation (avg %.2f) — some diversification benefit", avgAbsCorr);
        } else {
            insight = String.format("High correlation (avg %.2f) — strategies tend to win/lose together, limited diversification", avgAbsCorr);
        }

        return CorrelationMatrix.builder()
                .strategies(strategies)
                .correlations(correlations)
                .effectiveDiversification(round2(effectiveDiv))
                .insight(insight)
                .build();
    }

    private double computePearsonCorrelation(Map<LocalDate, Double> series1,
                                              Map<LocalDate, Double> series2,
                                              Set<LocalDate> allDates) {
        List<Double> x = new ArrayList<>();
        List<Double> y = new ArrayList<>();

        for (LocalDate date : allDates) {
            Double v1 = series1.getOrDefault(date, 0.0);
            Double v2 = series2.getOrDefault(date, 0.0);
            x.add(v1);
            y.add(v2);
        }

        if (x.size() < 3) return 0;

        double meanX = x.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double meanY = y.stream().mapToDouble(Double::doubleValue).average().orElse(0);

        double cov = 0, varX = 0, varY = 0;
        for (int i = 0; i < x.size(); i++) {
            double dx = x.get(i) - meanX;
            double dy = y.get(i) - meanY;
            cov += dx * dy;
            varX += dx * dx;
            varY += dy * dy;
        }

        double denom = Math.sqrt(varX * varY);
        return denom > 0 ? cov / denom : 0;
    }

    // ════════════════════════════════════════════
    //  10. Directional Analysis
    // ════════════════════════════════════════════

    private DirectionalAnalysis computeDirectionalAnalysis(List<Document> trades) {
        List<Document> longTrades = new ArrayList<>();
        List<Document> shortTrades = new ArrayList<>();

        for (Document t : trades) {
            String side = safeString(t, "side");
            String direction = safeString(t, "direction");
            boolean isLong = false;
            if (side != null && side.equalsIgnoreCase("BUY")) isLong = true;
            else if (side != null && side.equalsIgnoreCase("SELL")) isLong = false;
            else if (direction != null && direction.equalsIgnoreCase("BULLISH")) isLong = true;
            else if (direction != null && direction.equalsIgnoreCase("BEARISH")) isLong = false;
            else isLong = true; // default fallback

            if (isLong) longTrades.add(t);
            else shortTrades.add(t);
        }

        DirectionStats longStats = buildDirectionStats("LONG", longTrades);
        DirectionStats shortStats = buildDirectionStats("SHORT", shortTrades);

        // Per-strategy breakdown
        Map<String, List<Document>> longByStrategy = longTrades.stream()
                .filter(t -> safeString(t, "strategy") != null)
                .collect(Collectors.groupingBy(t -> safeString(t, "strategy")));
        Map<String, List<Document>> shortByStrategy = shortTrades.stream()
                .filter(t -> safeString(t, "strategy") != null)
                .collect(Collectors.groupingBy(t -> safeString(t, "strategy")));

        Set<String> allStrategies = new TreeSet<>();
        allStrategies.addAll(longByStrategy.keySet());
        allStrategies.addAll(shortByStrategy.keySet());

        List<StrategyDirectionStats> byStrategy = new ArrayList<>();
        for (String strat : allStrategies) {
            DirectionStats sLong = buildDirectionStats("LONG", longByStrategy.getOrDefault(strat, Collections.emptyList()));
            DirectionStats sShort = buildDirectionStats("SHORT", shortByStrategy.getOrDefault(strat, Collections.emptyList()));
            String edge = "NEUTRAL";
            if (sLong.getProfitFactor() > sShort.getProfitFactor() + 0.3) edge = "LONG";
            else if (sShort.getProfitFactor() > sLong.getProfitFactor() + 0.3) edge = "SHORT";
            byStrategy.add(StrategyDirectionStats.builder()
                    .strategy(strat).longStats(sLong).shortStats(sShort).edge(edge).build());
        }

        // Generate insight
        String insight;
        StrategyDirectionStats biggest = byStrategy.stream()
                .max(Comparator.comparingInt(s -> s.getLongStats().getTrades() + s.getShortStats().getTrades()))
                .orElse(null);
        if (biggest != null && !biggest.getEdge().equals("NEUTRAL")) {
            String weak = biggest.getEdge().equals("LONG") ? "SHORT" : "LONG";
            DirectionStats weakStats = biggest.getEdge().equals("LONG") ? biggest.getShortStats() : biggest.getLongStats();
            DirectionStats strongStats = biggest.getEdge().equals("LONG") ? biggest.getLongStats() : biggest.getShortStats();
            insight = String.format("%s has %.0f%% WR on %s but only %.0f%% on %s — consider disabling %s entries",
                    biggest.getStrategy(), strongStats.getWinRate(), biggest.getEdge(),
                    weakStats.getWinRate(), weak, weak);
        } else {
            double longPf = longStats.getProfitFactor();
            double shortPf = shortStats.getProfitFactor();
            if (longPf > shortPf * 1.5 && longPf > 1) {
                insight = String.format("Overall directional bias: LONG trades outperform by %.1fx", longPf / Math.max(shortPf, 0.01));
            } else if (shortPf > longPf * 1.5 && shortPf > 1) {
                insight = String.format("Overall directional bias: SHORT trades outperform by %.1fx", shortPf / Math.max(longPf, 0.01));
            } else {
                insight = "No strong directional bias detected — balanced performance";
            }
        }

        return DirectionalAnalysis.builder()
                .longStats(longStats).shortStats(shortStats)
                .byStrategy(byStrategy).insight(insight).build();
    }

    private DirectionStats buildDirectionStats(String direction, List<Document> trades) {
        int total = trades.size();
        if (total == 0) {
            return DirectionStats.builder().direction(direction).trades(0)
                    .winRate(0).avgPnl(0).totalPnl(0).avgRMultiple(0).slPercent(0).profitFactor(0).build();
        }
        int wins = 0;
        double totalPnl = 0;
        double sumWins = 0, sumLosses = 0;
        long slCount = 0;
        List<Double> rValues = new ArrayList<>();

        for (Document t : trades) {
            Double pnl = safeDouble(t, "pnl");
            double p = pnl != null ? pnl : 0;
            totalPnl += p;
            if (p > 0) { wins++; sumWins += p; }
            else if (p < 0) { sumLosses += Math.abs(p); }
            if (isSlTrade(t)) slCount++;
            Double r = safeDouble(t, "rMultiple");
            if (r != null) rValues.add(r);
        }

        double avgR = rValues.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double profitFactor = sumLosses > 0 ? sumWins / sumLosses : (sumWins > 0 ? 99.9 : 0);

        return DirectionStats.builder()
                .direction(direction).trades(total)
                .winRate(round2(wins * 100.0 / total))
                .avgPnl(round2(totalPnl / total))
                .totalPnl(round2(totalPnl))
                .avgRMultiple(round2(avgR))
                .slPercent(round2(slCount * 100.0 / total))
                .profitFactor(round2(profitFactor))
                .build();
    }

    // ════════════════════════════════════════════
    //  11. Day of Week Performance
    // ════════════════════════════════════════════

    private List<DayOfWeekStats> computeDayOfWeekPerformance(List<Document> trades) {
        // dayOfWeek: 1=Monday .. 7=Sunday (ISO)
        Map<Integer, List<Document>> byDay = new LinkedHashMap<>();
        for (int i = 1; i <= 7; i++) byDay.put(i, new ArrayList<>());

        for (Document t : trades) {
            Date entryTime = safeDate(t, "entryTime");
            if (entryTime == null) entryTime = safeDate(t, "exitTime");
            if (entryTime == null) continue;
            DayOfWeek dow = entryTime.toInstant().atZone(IST).toLocalDate().getDayOfWeek();
            byDay.get(dow.getValue()).add(t);
        }

        List<DayOfWeekStats> results = new ArrayList<>();
        double bestAvgPnl = Double.NEGATIVE_INFINITY;
        double worstAvgPnl = Double.POSITIVE_INFINITY;
        int bestDay = -1, worstDay = -1;

        // First pass to find best/worst
        for (Map.Entry<Integer, List<Document>> entry : byDay.entrySet()) {
            List<Document> dayTrades = entry.getValue();
            if (dayTrades.isEmpty()) continue;
            double avgPnl = dayTrades.stream().map(d -> safeDouble(d, "pnl"))
                    .filter(Objects::nonNull).mapToDouble(Double::doubleValue).average().orElse(0);
            if (avgPnl > bestAvgPnl) { bestAvgPnl = avgPnl; bestDay = entry.getKey(); }
            if (avgPnl < worstAvgPnl) { worstAvgPnl = avgPnl; worstDay = entry.getKey(); }
        }

        String[] dayNames = {"", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
        for (Map.Entry<Integer, List<Document>> entry : byDay.entrySet()) {
            List<Document> dayTrades = entry.getValue();
            if (dayTrades.isEmpty()) continue;
            int total = dayTrades.size();
            int wins = (int) dayTrades.stream().filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; }).count();
            double totalPnl = dayTrades.stream().map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull).mapToDouble(Double::doubleValue).sum();
            double avgPnl = totalPnl / total;
            long slCount = dayTrades.stream().filter(this::isSlTrade).count();
            double winRate = wins * 100.0 / total;

            String assessment;
            if (entry.getKey() == bestDay) assessment = "BEST";
            else if (entry.getKey() == worstDay) assessment = "AVOID";
            else if (winRate >= 50 && avgPnl > 0) assessment = "GOOD";
            else assessment = "CAUTION";

            results.add(DayOfWeekStats.builder()
                    .day(dayNames[entry.getKey()]).dayNumber(entry.getKey())
                    .trades(total).winRate(round2(winRate)).avgPnl(round2(avgPnl))
                    .totalPnl(round2(totalPnl)).slPercent(round2(slCount * 100.0 / total))
                    .assessment(assessment).build());
        }
        return results;
    }

    // ════════════════════════════════════════════
    //  12. Strategy-Exchange Matrix
    // ════════════════════════════════════════════

    private List<StrategyExchangeCell> computeStrategyExchangeMatrix(List<Document> trades) {
        Map<String, String> exchangeNames = Map.of("N", "NSE", "M", "MCX", "C", "CDS");
        Map<String, List<Document>> grouped = new LinkedHashMap<>();

        for (Document t : trades) {
            String strat = safeString(t, "strategy");
            String exch = safeString(t, "exchange");
            if (strat == null) strat = "UNKNOWN";
            String exchDisplay = exchangeNames.getOrDefault(exch, exch != null ? exch : "UNKNOWN");
            String key = strat + "|" + exchDisplay;
            grouped.computeIfAbsent(key, k -> new ArrayList<>()).add(t);
        }

        List<StrategyExchangeCell> results = new ArrayList<>();
        for (Map.Entry<String, List<Document>> entry : grouped.entrySet()) {
            String[] parts = entry.getKey().split("\\|", 2);
            List<Document> cellTrades = entry.getValue();
            int total = cellTrades.size();
            int wins = (int) cellTrades.stream().filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; }).count();
            double totalPnl = cellTrades.stream().map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull).mapToDouble(Double::doubleValue).sum();
            long slCount = cellTrades.stream().filter(this::isSlTrade).count();
            double sumWins = cellTrades.stream().map(d -> safeDouble(d, "pnl")).filter(v -> v != null && v > 0).mapToDouble(Double::doubleValue).sum();
            double sumLosses = Math.abs(cellTrades.stream().map(d -> safeDouble(d, "pnl")).filter(v -> v != null && v < 0).mapToDouble(Double::doubleValue).sum());
            double profitFactor = sumLosses > 0 ? sumWins / sumLosses : (sumWins > 0 ? 99.9 : 0);
            double avgR = cellTrades.stream().map(d -> safeDouble(d, "rMultiple")).filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);

            results.add(StrategyExchangeCell.builder()
                    .strategy(parts[0]).exchange(parts[1]).trades(total)
                    .winRate(round2(wins * 100.0 / total)).avgPnl(round2(totalPnl / total))
                    .totalPnl(round2(totalPnl)).slPercent(round2(slCount * 100.0 / total))
                    .avgRMultiple(round2(avgR)).profitFactor(round2(profitFactor)).build());
        }
        return results;
    }

    // ════════════════════════════════════════════
    //  13. Confidence vs Outcome
    // ════════════════════════════════════════════

    private List<ConfidenceVsOutcome> computeConfidenceAnalysis(List<Document> trades) {
        Map<String, List<Document>> buckets = new LinkedHashMap<>();
        buckets.put("<50", new ArrayList<>());
        buckets.put("50-60", new ArrayList<>());
        buckets.put("60-70", new ArrayList<>());
        buckets.put("70-80", new ArrayList<>());
        buckets.put("80-90", new ArrayList<>());
        buckets.put("90-100", new ArrayList<>());

        for (Document t : trades) {
            Double conf = safeDouble(t, "confidence");
            if (conf == null || conf <= 0) continue;
            String bucket;
            if (conf < 50) bucket = "<50";
            else if (conf < 60) bucket = "50-60";
            else if (conf < 70) bucket = "60-70";
            else if (conf < 80) bucket = "70-80";
            else if (conf < 90) bucket = "80-90";
            else bucket = "90-100";
            buckets.get(bucket).add(t);
        }

        List<ConfidenceVsOutcome> results = new ArrayList<>();
        for (Map.Entry<String, List<Document>> entry : buckets.entrySet()) {
            List<Document> bTrades = entry.getValue();
            if (bTrades.isEmpty()) continue;
            int total = bTrades.size();
            int wins = (int) bTrades.stream().filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; }).count();
            double totalPnl = bTrades.stream().map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull).mapToDouble(Double::doubleValue).sum();
            double avgPnl = totalPnl / total;
            double avgR = bTrades.stream().map(d -> safeDouble(d, "rMultiple")).filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);

            results.add(ConfidenceVsOutcome.builder()
                    .bucket(entry.getKey()).trades(total).winRate(round2(wins * 100.0 / total))
                    .avgPnl(round2(avgPnl)).avgRMultiple(round2(avgR)).totalPnl(round2(totalPnl))
                    .profitable(avgPnl > 0).build());
        }
        return results;
    }

    // ════════════════════════════════════════════
    //  14. Partial Exit Analysis
    // ════════════════════════════════════════════

    private PartialExitAnalysis computePartialExitAnalysis(List<Document> trades) {
        int tradesWithT1 = 0, t1ThenStopped = 0, t1ThenT2 = 0;
        int t1ThenT2ThenStopped = 0, t1ThenT2ThenT3 = 0, reachedAllTargets = 0;
        List<Double> pnlAfterT1 = new ArrayList<>();

        for (Document t : trades) {
            boolean t1 = safeBool(t, "target1Hit");
            boolean t2 = safeBool(t, "target2Hit");
            boolean t3 = safeBool(t, "target3Hit");
            boolean t4 = safeBool(t, "target4Hit");

            if (!t1) continue;
            tradesWithT1++;
            Double pnl = safeDouble(t, "pnl");
            if (pnl != null) pnlAfterT1.add(pnl);

            if (t1 && !t2) {
                t1ThenStopped++;
            } else if (t1 && t2 && !t3) {
                t1ThenT2++;
                t1ThenT2ThenStopped++;
            } else if (t1 && t2 && t3 && !t4) {
                t1ThenT2++;
                t1ThenT2ThenT3++;
            } else if (t1 && t2 && t3 && t4) {
                t1ThenT2++;
                t1ThenT2ThenT3++;
                reachedAllTargets++;
            }
        }

        double avgPnlT1 = pnlAfterT1.stream().mapToDouble(Double::doubleValue).average().orElse(0);

        // Trailing effectiveness: actual PnL captured vs MFE
        List<Double> captureRatios = new ArrayList<>();
        for (Document t : trades) {
            Double mfe = safeDouble(t, "mfe");
            Double pnl = safeDouble(t, "pnl");
            if (mfe != null && mfe > 0 && pnl != null) {
                captureRatios.add(pnl / mfe * 100);
            }
        }
        double trailingEff = captureRatios.stream().mapToDouble(Double::doubleValue).average().orElse(0);

        // Insight
        String insight;
        double t1ToT2Rate = tradesWithT1 > 0 ? t1ThenT2 * 100.0 / tradesWithT1 : 0;
        if (tradesWithT1 > 0 && t1ThenStopped * 100.0 / tradesWithT1 > 60) {
            insight = String.format("%.0f%% of T1 hits are stopped before T2 — consider increasing T1 exit allocation from 40%% to 60%%",
                    t1ThenStopped * 100.0 / tradesWithT1);
        } else if (t1ToT2Rate > 60) {
            insight = String.format("T1→T2 conversion is %.0f%% — trailing SL is working well", t1ToT2Rate);
        } else {
            insight = String.format("T1 hit on %d trades, %.0f%% progressed to T2", tradesWithT1, t1ToT2Rate);
        }

        return PartialExitAnalysis.builder()
                .tradesWithT1(tradesWithT1).t1ThenStopped(t1ThenStopped).t1ThenT2(t1ThenT2)
                .t1ThenT2ThenStopped(t1ThenT2ThenStopped).t1ThenT2ThenT3(t1ThenT2ThenT3)
                .reachedAllTargets(reachedAllTargets)
                .avgPnlAfterT1Partial(round2(avgPnlT1))
                .trailingEffectiveness(round2(trailingEff))
                .insight(insight).build();
    }

    // ════════════════════════════════════════════
    //  15. Streak Analysis
    // ════════════════════════════════════════════

    private StreakAnalysis computeStreakAnalysis(List<Document> trades) {
        // Sort by exitTime ascending
        List<Document> sorted = trades.stream()
                .filter(t -> safeDate(t, "exitTime") != null)
                .sorted(Comparator.comparing(t -> safeDate(t, "exitTime")))
                .collect(Collectors.toList());

        if (sorted.isEmpty()) {
            return StreakAnalysis.builder().insight("No trades to analyze").build();
        }

        int maxWinStreak = 0, maxLossStreak = 0;
        int currentWinStreak = 0, currentLossStreak = 0;
        int winsAfterWin = 0, tradesAfterWin = 0;
        int winsAfterLoss = 0, tradesAfterLoss = 0;
        double pnlSumAfterWin = 0, pnlSumAfterLoss = 0;
        Boolean previousWasWin = null;

        for (Document t : sorted) {
            Double pnl = safeDouble(t, "pnl");
            double p = pnl != null ? pnl : 0;
            boolean isWin = p > 0;

            // Track performance after previous outcome
            if (previousWasWin != null) {
                if (previousWasWin) {
                    tradesAfterWin++;
                    pnlSumAfterWin += p;
                    if (isWin) winsAfterWin++;
                } else {
                    tradesAfterLoss++;
                    pnlSumAfterLoss += p;
                    if (isWin) winsAfterLoss++;
                }
            }

            // Track streaks
            if (isWin) {
                currentWinStreak++;
                currentLossStreak = 0;
                maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
            } else {
                currentLossStreak++;
                currentWinStreak = 0;
                maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
            }

            previousWasWin = isWin;
        }

        int currentStreak = currentWinStreak > 0 ? currentWinStreak : -currentLossStreak;
        double winRateAfterWin = tradesAfterWin > 0 ? winsAfterWin * 100.0 / tradesAfterWin : 0;
        double winRateAfterLoss = tradesAfterLoss > 0 ? winsAfterLoss * 100.0 / tradesAfterLoss : 0;
        double avgPnlAfterWin = tradesAfterWin > 0 ? pnlSumAfterWin / tradesAfterWin : 0;
        double avgPnlAfterLoss = tradesAfterLoss > 0 ? pnlSumAfterLoss / tradesAfterLoss : 0;

        String insight;
        if (winRateAfterLoss > winRateAfterWin + 5) {
            insight = "You trade BETTER after losses (discipline reset). No evidence of tilt.";
        } else if (winRateAfterWin > winRateAfterLoss + 10) {
            insight = "Loss aversion detected — after losses, performance drops. Consider mandatory cooldown after 2+ consecutive losses.";
        } else {
            insight = "Consistent performance regardless of previous outcome — no streak dependency detected.";
        }

        return StreakAnalysis.builder()
                .maxWinStreak(maxWinStreak).maxLossStreak(maxLossStreak)
                .currentStreak(currentStreak)
                .avgPnlAfterWin(round2(avgPnlAfterWin)).avgPnlAfterLoss(round2(avgPnlAfterLoss))
                .winRateAfterWin(round2(winRateAfterWin)).winRateAfterLoss(round2(winRateAfterLoss))
                .insight(insight).build();
    }

    // ════════════════════════════════════════════
    //  16. Holding Period Analysis
    // ════════════════════════════════════════════

    private List<TradeDecayPoint> computeHoldingPeriodAnalysis(List<Document> trades) {
        String[] bucketNames = {"0-5m", "5-15m", "15-30m", "30m-1h", "1h-2h", "2h-4h", "4h+"};
        double[] bucketMins = {0, 5, 15, 30, 60, 120, 240, Double.MAX_VALUE};
        Map<String, List<Document>> buckets = new LinkedHashMap<>();
        for (String name : bucketNames) buckets.put(name, new ArrayList<>());

        for (Document t : trades) {
            double dur = getDurationMinutes(t);
            if (dur < 0) continue;
            for (int i = 0; i < bucketNames.length; i++) {
                if (dur >= bucketMins[i] && dur < bucketMins[i + 1]) {
                    buckets.get(bucketNames[i]).add(t);
                    break;
                }
            }
        }

        // Find best bucket by avgPnl
        String bestBucket = null;
        double bestAvgPnl = Double.NEGATIVE_INFINITY;
        String worstBucket = null;
        double worstAvgPnl = Double.POSITIVE_INFINITY;
        for (Map.Entry<String, List<Document>> entry : buckets.entrySet()) {
            if (entry.getValue().isEmpty()) continue;
            double avg = entry.getValue().stream().map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);
            if (avg > bestAvgPnl) { bestAvgPnl = avg; bestBucket = entry.getKey(); }
            if (avg < worstAvgPnl) { worstAvgPnl = avg; worstBucket = entry.getKey(); }
        }

        // Find adjacent to best
        Set<String> goodBuckets = new HashSet<>();
        if (bestBucket != null) {
            int bestIdx = Arrays.asList(bucketNames).indexOf(bestBucket);
            if (bestIdx > 0) goodBuckets.add(bucketNames[bestIdx - 1]);
            if (bestIdx < bucketNames.length - 1) goodBuckets.add(bucketNames[bestIdx + 1]);
        }

        List<TradeDecayPoint> results = new ArrayList<>();
        for (Map.Entry<String, List<Document>> entry : buckets.entrySet()) {
            List<Document> bTrades = entry.getValue();
            if (bTrades.isEmpty()) continue;
            int total = bTrades.size();
            int wins = (int) bTrades.stream().filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; }).count();
            double avgPnl = bTrades.stream().map(d -> safeDouble(d, "pnl")).filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);
            double avgR = bTrades.stream().map(d -> safeDouble(d, "rMultiple")).filter(Objects::nonNull)
                    .mapToDouble(Double::doubleValue).average().orElse(0);

            String assessment;
            if (entry.getKey().equals(bestBucket)) assessment = "SWEET_SPOT";
            else if (goodBuckets.contains(entry.getKey())) assessment = "GOOD";
            else if (entry.getKey().equals(worstBucket)) assessment = "EXIT";
            else assessment = "DIMINISHING";

            results.add(TradeDecayPoint.builder()
                    .bucket(entry.getKey()).trades(total).winRate(round2(wins * 100.0 / total))
                    .avgPnl(round2(avgPnl)).avgRMultiple(round2(avgR))
                    .assessment(assessment).build());
        }
        return results;
    }

    // ════════════════════════════════════════════
    //  17. Risk-Reward Analysis
    // ════════════════════════════════════════════

    private RiskRewardAnalysis computeRiskRewardAnalysis(List<Document> trades) {
        List<Double> plannedRRs = trades.stream().map(d -> safeDouble(d, "riskReward"))
                .filter(v -> v != null && v > 0).collect(Collectors.toList());
        List<Double> actualRRs = trades.stream().map(d -> safeDouble(d, "rMultiple"))
                .filter(Objects::nonNull).collect(Collectors.toList());

        double avgPlannedRR = plannedRRs.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double avgActualRR = actualRRs.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double rrCapture = avgPlannedRR > 0 ? avgActualRR / avgPlannedRR * 100 : 0;

        // Winner/loser R
        double avgWinnerR = trades.stream()
                .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p > 0; })
                .map(d -> safeDouble(d, "rMultiple")).filter(Objects::nonNull)
                .mapToDouble(Double::doubleValue).average().orElse(0);
        double avgLoserR = trades.stream()
                .filter(d -> { Double p = safeDouble(d, "pnl"); return p != null && p < 0; })
                .map(d -> safeDouble(d, "rMultiple")).filter(Objects::nonNull)
                .mapToDouble(Double::doubleValue).average().orElse(0);

        int above2R = (int) actualRRs.stream().filter(r -> r > 2.0).count();
        int above3R = (int) actualRRs.stream().filter(r -> r > 3.0).count();
        double pctAbove2R = actualRRs.isEmpty() ? 0 : above2R * 100.0 / actualRRs.size();

        String insight;
        if (avgPlannedRR > 0 && rrCapture < 50) {
            insight = String.format("Planned RR is %.1f but actual average is %.1f — targets are too ambitious or SL too tight",
                    avgPlannedRR, avgActualRR);
        } else if (avgPlannedRR > 0 && rrCapture > 80) {
            insight = String.format("RR capture at %.0f%% — excellent execution vs planned targets", rrCapture);
        } else if (above2R > 0) {
            insight = String.format("%.1f%% of trades achieve >2R — big winners present. Avg winner R: %.2f", pctAbove2R, avgWinnerR);
        } else {
            insight = String.format("Average actual R-multiple: %.2f. Focus on letting winners run beyond 2R.", avgActualRR);
        }

        return RiskRewardAnalysis.builder()
                .avgPlannedRR(round2(avgPlannedRR)).avgActualRR(round2(avgActualRR))
                .rrCapturePercent(round2(rrCapture))
                .avgWinnerR(round2(avgWinnerR)).avgLoserR(round2(avgLoserR))
                .tradesAbove2R(above2R).tradesAbove3R(above3R)
                .percentAbove2R(round2(pctAbove2R)).insight(insight).build();
    }

    // ════════════════════════════════════════════
    //  MongoDB Query
    // ════════════════════════════════════════════

    private List<Document> fetchTrades(Long from, Long to, String strategy, String exchange) {
        Document query = new Document();

        // Date range filter on exitTime — also ensures only closed trades
        Document dateFilter = new Document();
        dateFilter.append("$exists", true);
        dateFilter.append("$ne", null);
        if (from != null) dateFilter.append("$gte", new Date(from));
        if (to != null) dateFilter.append("$lte", new Date(to));
        query.append("exitTime", dateFilter);

        if (strategy != null && !strategy.isEmpty() && !"ALL".equalsIgnoreCase(strategy)) {
            query.append("strategy", strategy);
        }
        if (exchange != null && !exchange.isEmpty() && !"ALL".equalsIgnoreCase(exchange)) {
            query.append("exchange", exchange);
        }

        try {
            return mongoTemplate.getCollection(COLLECTION)
                    .find(query)
                    .sort(new Document("exitTime", -1))
                    .limit(5000)
                    .into(new ArrayList<>());
        } catch (Exception e) {
            log.error("[TRADE_INTEL] Error fetching trades: {}", e.getMessage(), e);
            return Collections.emptyList();
        }
    }

    // ════════════════════════════════════════════
    //  Classification helpers
    // ════════════════════════════════════════════

    private String classifyExit(Document t) {
        String exitReason = safeString(t, "exitReason");
        String reason = exitReason != null ? exitReason.toUpperCase() : "";

        // SL bucket: exitReason contains SL or 1% DD or stopHit=true
        if (reason.contains("SL") || reason.contains("1% DD") || safeBool(t, "stopHit")) {
            return "SL";
        }

        // Target buckets — check highest target first to avoid double-counting
        if (safeBool(t, "target4Hit") && reason.contains("T4")) return "T4";
        if (safeBool(t, "target3Hit") && reason.contains("T3")) return "T3";
        if (safeBool(t, "target2Hit") && reason.contains("T2")) return "T2";
        if (safeBool(t, "target1Hit") && reason.contains("T1")) return "T1";

        // EOD bucket
        if (reason.contains("EOD") || reason.contains("MCX")) return "EOD";

        return "OTHER";
    }

    private boolean isSlTrade(Document t) {
        String exitReason = safeString(t, "exitReason");
        String reason = exitReason != null ? exitReason.toUpperCase() : "";
        return reason.contains("SL") || reason.contains("1% DD") || safeBool(t, "stopHit");
    }

    // ════════════════════════════════════════════
    //  Safe Document field access
    // ════════════════════════════════════════════

    private Double safeDouble(Document doc, String field) {
        Object val = doc.get(field);
        if (val == null) return null;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try {
            return Double.parseDouble(val.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String safeString(Document doc, String field) {
        Object val = doc.get(field);
        return val != null ? val.toString() : null;
    }

    private boolean safeBool(Document doc, String field) {
        Object val = doc.get(field);
        if (val == null) return false;
        if (val instanceof Boolean) return (Boolean) val;
        return "true".equalsIgnoreCase(val.toString());
    }

    private Date safeDate(Document doc, String field) {
        Object val = doc.get(field);
        if (val instanceof Date) return (Date) val;
        if (val instanceof Number) return new Date(((Number) val).longValue());
        return null;
    }

    private double getDurationMinutes(Document t) {
        Double dur = safeDouble(t, "durationMinutes");
        if (dur != null) return dur;
        return computeDurationMin(t);
    }

    private double computeDurationMin(Document t) {
        Date entry = safeDate(t, "entryTime");
        Date exit = safeDate(t, "exitTime");
        if (entry != null && exit != null) {
            return (exit.getTime() - entry.getTime()) / 60000.0;
        }
        return -1;
    }

    // ════════════════════════════════════════════
    //  Math helpers
    // ════════════════════════════════════════════

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private double pct(int part, int total) {
        return total > 0 ? round2(part * 100.0 / total) : 0;
    }

    private double computeMedian(List<Double> values) {
        if (values == null || values.isEmpty()) return 0;
        List<Double> sorted = values.stream().sorted().collect(Collectors.toList());
        int n = sorted.size();
        if (n % 2 == 0) {
            return (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2.0;
        } else {
            return sorted.get(n / 2);
        }
    }

    // ════════════════════════════════════════════
    //  DTOs
    // ════════════════════════════════════════════

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TradeIntelligenceReport {
        private PeriodSummary periodSummary;
        private Map<String, ExitDistribution> exitDistribution;
        private TargetFunnel targetFunnel;
        @JsonProperty("rMultipleDistribution")
        private List<RMultipleBucket> rMultipleDistribution;
        private double meanR;
        private double medianR;
        private double percentAbove1R;
        private List<HourStats> timeOfDayHeatmap;
        private List<DurationStats> durationByOutcome;
        private List<InstrumentPerf> topInstruments;
        private List<InstrumentPerf> bottomInstruments;
        private List<LossCluster> lossClusterAnalysis;
        private PeriodComparison periodComparison;
        private CorrelationMatrix strategyCorrelation;
        private String lastUpdated;

        // Deep analytics
        private DirectionalAnalysis directionalAnalysis;
        private List<DayOfWeekStats> dayOfWeekPerformance;
        private List<StrategyExchangeCell> strategyExchangeMatrix;
        private List<ConfidenceVsOutcome> confidenceAnalysis;
        private PartialExitAnalysis partialExitAnalysis;
        private StreakAnalysis streakAnalysis;
        private List<TradeDecayPoint> holdingPeriodAnalysis;
        private RiskRewardAnalysis riskRewardAnalysis;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class PeriodSummary {
        private int totalTrades;
        private int wins;
        private int losses;
        private double winRate;
        private double totalPnl;
        private double avgPnlPerTrade;
        private String bestDay;
        private double bestDayPnl;
        private String worstDay;
        private double worstDayPnl;
        private int profitableDays;
        private int totalTradingDays;
        private double slRate;
        private double avgRMultiple;
        private double profitFactor;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ExitDistribution {
        private String strategy;
        private int totalTrades;
        private int slCount;
        private int t1Count;
        private int t2Count;
        private int t3Count;
        private int t4Count;
        private int eodCount;
        private int otherCount;
        private double slPercent;
        private double t1Percent;
        private double t2Percent;
        private double t3Percent;
        private double t4Percent;
        private double eodPercent;
        private double otherPercent;
        private double avgSlLoss;
        private double avgSlDurationMin;
        private int slWithin5Min;
        private double slWithin5MinPercent;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TargetFunnel {
        private int totalTrades;
        private int survivedSl;
        private double t1HitRate;
        private double t2HitRate;
        private double t3HitRate;
        private double t4HitRate;
        private double t1ToT2Conversion;
        private double t2ToT3Conversion;
        private double t3ToT4Conversion;
        private double avgTimeToT1Min;
        private double avgTimeToT2Min;
        private double avgTimeToT3Min;
        private double avgTimeToT4Min;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RMultipleBucket {
        private String range;
        private int count;
        private double percent;
        private double avgPnl;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class HourStats {
        private int hour;
        private int trades;
        private double winRate;
        private double avgPnl;
        private double slPercent;
        private String assessment;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class DurationStats {
        private String exitType;
        private double avgDurationMin;
        private double medianDurationMin;
        private int count;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class InstrumentPerf {
        private String scripCode;
        private String companyName;
        private int trades;
        private double winRate;
        private double totalPnl;
        private double avgPnl;
        private double slPercent;
        private double avgRMultiple;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class LossCluster {
        private String name;
        private String description;
        private int tradeCount;
        private double percentOfLosses;
        private double avgPnl;
        private double avgConfidence;
        private String recommendation;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class PeriodComparison {
        private PeriodMetrics current;
        private PeriodMetrics previous;
        private String insight;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class PeriodMetrics {
        private String label;
        private int tradeCount;
        private double winRate;
        private double avgPnl;
        private double totalPnl;
        private double slPercent;
        private double avgRMultiple;
        private double profitFactor;
        private double avgHoldWin;
        private double avgHoldLoss;
        private int profitableDays;
        private int totalTradingDays;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class CorrelationMatrix {
        private List<String> strategies;
        private Map<String, Map<String, Double>> correlations;
        private double effectiveDiversification;
        private String insight;
    }

    // ─── Deep Analytics DTOs ────────────────────────────────

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class DirectionalAnalysis {
        private DirectionStats longStats;
        private DirectionStats shortStats;
        private List<StrategyDirectionStats> byStrategy;
        private String insight;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class DirectionStats {
        private String direction; // "LONG" or "SHORT"
        private int trades;
        private double winRate;
        private double avgPnl;
        private double totalPnl;
        private double avgRMultiple;
        private double slPercent;
        private double profitFactor;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StrategyDirectionStats {
        private String strategy;
        private DirectionStats longStats;
        private DirectionStats shortStats;
        private String edge; // "LONG", "SHORT", "NEUTRAL" — which direction is more profitable
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class DayOfWeekStats {
        private String day; // "Monday", "Tuesday", etc.
        private int dayNumber; // 1=Mon, 7=Sun
        private int trades;
        private double winRate;
        private double avgPnl;
        private double totalPnl;
        private double slPercent;
        private String assessment; // "BEST", "GOOD", "CAUTION", "AVOID"
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StrategyExchangeCell {
        private String strategy;
        private String exchange;
        private int trades;
        private double winRate;
        private double avgPnl;
        private double totalPnl;
        private double slPercent;
        private double avgRMultiple;
        private double profitFactor;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ConfidenceVsOutcome {
        private String bucket; // "50-60", "60-70", "70-80", "80-90", "90-100"
        private int trades;
        private double winRate;
        private double avgPnl;
        private double avgRMultiple;
        private double totalPnl;
        private boolean profitable;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class PartialExitAnalysis {
        private int tradesWithT1;
        private int t1ThenStopped; // hit T1 partial but rest hit SL
        private int t1ThenT2;
        private int t1ThenT2ThenStopped;
        private int t1ThenT2ThenT3;
        private int reachedAllTargets;
        private double avgPnlAfterT1Partial; // avg PnL of the REMAINING position after T1 exit
        private double trailingEffectiveness; // % of MFE captured (actual exit vs best possible)
        private String insight;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StreakAnalysis {
        private int maxWinStreak;
        private int maxLossStreak;
        private int currentStreak; // positive = wins, negative = losses
        private double avgPnlAfterWin; // avg PnL of trade AFTER a win
        private double avgPnlAfterLoss; // avg PnL of trade AFTER a loss
        private double winRateAfterWin;
        private double winRateAfterLoss;
        private String insight; // "You trade BETTER after losses" or "momentum trading detected"
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TradeDecayPoint {
        private String bucket; // "0-5m", "5-15m", "15-30m", "30m-1h", "1h-2h", "2h-4h", "4h+"
        private int trades;
        private double winRate;
        private double avgPnl;
        private double avgRMultiple;
        private String assessment; // "SWEET_SPOT", "GOOD", "DIMINISHING", "EXIT"
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RiskRewardAnalysis {
        private double avgPlannedRR; // from riskReward field
        private double avgActualRR; // from rMultiple field
        private double rrCapturePercent; // actual / planned * 100
        private double avgWinnerR; // avg R of winning trades
        private double avgLoserR; // avg R of losing trades (negative)
        private int tradesAbove2R;
        private int tradesAbove3R;
        private double percentAbove2R;
        private String insight;
    }
}
