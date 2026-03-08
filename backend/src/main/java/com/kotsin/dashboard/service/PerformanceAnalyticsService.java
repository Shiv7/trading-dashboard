package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.dto.TradeDTO;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.annotation.PostConstruct;
import lombok.Builder;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.mongodb.client.model.Filters;
import com.mongodb.client.model.Sorts;

import java.time.*;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.time.temporal.WeekFields;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * PerformanceAnalyticsService - Comprehensive trading performance analytics
 *
 * Loads all trade_outcomes from MongoDB on startup and calculates:
 * - Win rate trending, P&L analysis (daily/weekly/monthly)
 * - R-multiple tracking, drawdown analysis
 * - Signal source performance, outcome tracking
 * - Streak analysis, time-based analysis
 */
@Service
@Slf4j
public class PerformanceAnalyticsService {

    private final MongoTemplate mongoTemplate;

    // Trade storage for analytics
    private final Map<String, TradeDTO> allTrades = new ConcurrentHashMap<>();
    private volatile PerformanceMetrics cachedMetrics;
    private volatile long lastCalculation = 0;

    public PerformanceAnalyticsService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    // ======================== STARTUP DATA LOADING ========================

    @PostConstruct
    public void loadTradesFromMongoDB() {
        try {
            log.info("[PERF] Loading trade_outcomes from MongoDB...");
            int count = 0;
            for (Document doc : mongoTemplate.getCollection("trade_outcomes").find()) {
                TradeDTO trade = documentToTradeDTO(doc);
                if (trade != null && trade.getTradeId() != null) {
                    allTrades.put(trade.getTradeId(), trade);
                    count++;
                }
            }
            log.info("[PERF] Loaded {} trades from MongoDB trade_outcomes", count);
            if (count > 0) {
                cachedMetrics = calculateMetrics();
                lastCalculation = System.currentTimeMillis();
                log.info("[PERF] Initial metrics calculated: trades={} wins={} pnl={}",
                    cachedMetrics.getTotalTrades(), cachedMetrics.getWins(), cachedMetrics.getTotalPnl());
            }
        } catch (Exception e) {
            log.error("[PERF] Failed to load trades from MongoDB: {}", e.getMessage(), e);
        }
    }

    private TradeDTO documentToTradeDTO(Document doc) {
        try {
            String id = doc.getObjectId("_id").toString();

            // Parse times
            LocalDateTime entryTime = parseDocDate(doc.get("entryTime"));
            LocalDateTime exitTime = parseDocDate(doc.get("exitTime"));

            // Skip trades without exit time (not completed)
            if (exitTime == null) return null;

            double pnl = getDoubleVal(doc, "pnl");
            boolean isWin = doc.getBoolean("isWin", pnl > 0);
            String exitReason = doc.getString("exitReason");

            // Determine status
            String status;
            if (exitReason != null && (exitReason.contains("TARGET") || exitReason.contains("TP") || exitReason.startsWith("T"))) {
                status = isWin ? "CLOSED_WIN" : "CLOSED_LOSS";
            } else if (exitReason != null && (exitReason.contains("STOP") || exitReason.contains("SL"))) {
                status = isWin ? "CLOSED_WIN" : "CLOSED_LOSS";
            } else {
                status = isWin ? "CLOSED_WIN" : "CLOSED_LOSS";
            }

            // Compute duration from timestamps for precision
            long durationMinutes = 0;
            if (entryTime != null && exitTime != null) {
                durationMinutes = ChronoUnit.MINUTES.between(entryTime, exitTime);
            } else {
                Object durVal = doc.get("durationMinutes");
                if (durVal instanceof Number) {
                    durationMinutes = ((Number) durVal).longValue();
                }
            }

            int quantity = 0;
            Object qtyVal = doc.get("quantity");
            if (qtyVal instanceof Number) {
                quantity = ((Number) qtyVal).intValue();
            }

            String strategy = StrategyNameResolver.extractFromDocument(doc);

            return TradeDTO.builder()
                    .tradeId(id)
                    .signalId(doc.getString("signalId"))
                    .scripCode(doc.getString("scripCode"))
                    .companyName(doc.getString("companyName"))
                    .side(doc.getString("side"))
                    .status(status)
                    .entryPrice(getDoubleVal(doc, "entryPrice"))
                    .exitPrice(getDoubleVal(doc, "exitPrice"))
                    .quantity(quantity)
                    .exitTime(exitTime)
                    .entryTime(entryTime)
                    .exitReason(exitReason)
                    .stopLoss(getDoubleVal(doc, "stopLoss"))
                    .target1(getDoubleVal(doc, "target1"))
                    .pnl(pnl)
                    .pnlPercent(getDoubleVal(doc, "pnlPercent"))
                    .rMultiple(getDoubleVal(doc, "rMultiple"))
                    .durationMinutes(durationMinutes)
                    .strategy(strategy)
                    .build();
        } catch (Exception e) {
            log.warn("[PERF] Failed to parse trade document: {}", e.getMessage());
            return null;
        }
    }

    private LocalDateTime parseDocDate(Object val) {
        if (val instanceof Date) {
            return LocalDateTime.ofInstant(((Date) val).toInstant(), ZoneId.of("Asia/Kolkata"));
        }
        return null;
    }

    private double getDoubleVal(Document doc, String key) {
        Object val = doc.get(key);
        if (val instanceof Number) return ((Number) val).doubleValue();
        return 0.0;
    }

    // ======================== TRADE RECORDING ========================

    public void recordTrade(TradeDTO trade) {
        if (trade == null || trade.getTradeId() == null) return;
        allTrades.put(trade.getTradeId(), trade);
        invalidateCache();
        log.debug("[PERF] Recorded trade: {} {} P&L={}",
            trade.getCompanyName(), trade.getStatus(), trade.getPnl());
    }

    public void recordTrades(Collection<TradeDTO> trades) {
        trades.forEach(this::recordTrade);
    }

    // ======================== PERFORMANCE METRICS ========================

    public synchronized PerformanceMetrics getPerformanceMetrics() {
        if (cachedMetrics != null && System.currentTimeMillis() - lastCalculation < 60000) {
            return cachedMetrics;
        }
        cachedMetrics = calculateMetrics();
        lastCalculation = System.currentTimeMillis();
        return cachedMetrics;
    }

    private PerformanceMetrics calculateMetrics() {
        List<TradeDTO> trades = new ArrayList<>(allTrades.values());

        if (trades.isEmpty()) {
            return PerformanceMetrics.empty();
        }

        // Sort by exit time
        trades.sort(Comparator.comparing(t -> t.getExitTime() != null ? t.getExitTime() : LocalDateTime.MIN));

        // Basic stats
        int totalTrades = trades.size();
        long wins = trades.stream().filter(this::isWin).count();
        long losses = trades.stream().filter(this::isLoss).count();
        long decisiveTrades = wins + losses;
        double winRate = decisiveTrades > 0 ? (double) wins / decisiveTrades : 0;

        // P&L
        double totalPnl = trades.stream().mapToDouble(TradeDTO::getPnl).sum();
        double avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
        double maxWin = trades.stream().mapToDouble(TradeDTO::getPnl).max().orElse(0);
        double maxLoss = trades.stream().mapToDouble(TradeDTO::getPnl).min().orElse(0);

        // R-Multiple
        double avgRMultiple = trades.stream()
                .mapToDouble(TradeDTO::getRMultiple)
                .average().orElse(0);

        // Profit factor
        double grossProfit = trades.stream()
                .filter(t -> t.getPnl() > 0)
                .mapToDouble(TradeDTO::getPnl)
                .sum();
        double grossLoss = Math.abs(trades.stream()
                .filter(t -> t.getPnl() < 0)
                .mapToDouble(TradeDTO::getPnl)
                .sum());
        double profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

        // Expectancy: (winRate * avgWin) - (lossRate * avgLoss)
        double avgWin = wins > 0 ? grossProfit / wins : 0;
        double avgLoss2 = losses > 0 ? grossLoss / losses : 0;
        double expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss2);

        // Drawdown
        DrawdownAnalysis drawdown = calculateDrawdown(trades);

        // Daily performance
        List<DailyPerformance> dailyPerformance = calculateDailyPerformance(trades);

        // Weekly performance
        List<WeeklyPerformance> weeklyPerformance = calculateWeeklyPerformance(trades);

        // Monthly performance
        List<MonthlyPerformance> monthlyPerformance = calculateMonthlyPerformance(trades);

        // Win rate trend
        List<WinRateTrend> winRateTrend = calculateWinRateTrend(trades, 20);

        // By signal source
        Map<String, SourcePerformance> bySource = calculateBySource(trades);

        // By exit reason
        Map<String, OutcomeStats> byExitReason = calculateByExitReason(trades);

        // By category
        Map<String, OutcomeStats> byCategory = calculateByCategory(trades);

        // Streak analysis
        StreakAnalysis streaks = calculateStreaks(trades);

        // Time analysis
        TimeAnalysis timeAnalysis = calculateTimeAnalysis(trades);

        // Strategy details with exchange breakdown
        List<StrategyDetail> strategyDetails = calculateStrategyDetails(trades);
        Map<String, StrategyDetail> bestByExchange = findBestByExchange(strategyDetails);

        return PerformanceMetrics.builder()
                .totalTrades(totalTrades)
                .wins((int) wins)
                .losses((int) losses)
                .winRate(winRate)
                .totalPnl(totalPnl)
                .avgPnl(avgPnl)
                .maxWin(maxWin)
                .maxLoss(maxLoss)
                .avgRMultiple(avgRMultiple)
                .profitFactor(profitFactor)
                .expectancy(expectancy)
                .grossProfit(grossProfit)
                .grossLoss(grossLoss)
                .drawdown(drawdown)
                .dailyPerformance(dailyPerformance)
                .weeklyPerformance(weeklyPerformance)
                .monthlyPerformance(monthlyPerformance)
                .winRateTrend(winRateTrend)
                .bySource(bySource)
                .byExitReason(byExitReason)
                .byCategory(byCategory)
                .streaks(streaks)
                .timeAnalysis(timeAnalysis)
                .strategyDetails(strategyDetails)
                .bestByExchange(bestByExchange)
                .lastUpdated(LocalDateTime.now().toString())
                .build();
    }

    // ======================== CALCULATION HELPERS ========================

    private boolean isWin(TradeDTO trade) {
        if (trade.getStatus() != null && trade.getStatus().contains("WIN")) return true;
        return trade.getPnl() > 0;
    }

    private boolean isLoss(TradeDTO trade) {
        if (trade.getStatus() != null && trade.getStatus().contains("LOSS")) return true;
        return trade.getPnl() < 0;
    }

    private List<DailyPerformance> calculateDailyPerformance(List<TradeDTO> trades) {
        Map<LocalDate, List<TradeDTO>> byDay = new TreeMap<>();
        for (TradeDTO trade : trades) {
            if (trade.getExitTime() != null) {
                LocalDate date = trade.getExitTime().toLocalDate();
                byDay.computeIfAbsent(date, k -> new ArrayList<>()).add(trade);
            }
        }
        return byDay.entrySet().stream()
                .map(e -> {
                    List<TradeDTO> dayTrades = e.getValue();
                    double pnl = dayTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
                    int w = (int) dayTrades.stream().filter(this::isWin).count();
                    int l = (int) dayTrades.stream().filter(this::isLoss).count();
                    double wr = dayTrades.isEmpty() ? 0 : (double) w / dayTrades.size();
                    return new DailyPerformance(e.getKey().toString(), dayTrades.size(), w, l, pnl, wr);
                })
                .collect(Collectors.toList());
    }

    private List<WeeklyPerformance> calculateWeeklyPerformance(List<TradeDTO> trades) {
        Map<String, List<TradeDTO>> byWeek = new TreeMap<>();
        for (TradeDTO trade : trades) {
            if (trade.getExitTime() != null) {
                LocalDate date = trade.getExitTime().toLocalDate();
                // Use Monday of the week as the key
                LocalDate monday = date.with(java.time.DayOfWeek.MONDAY);
                String weekKey = monday.toString();
                byWeek.computeIfAbsent(weekKey, k -> new ArrayList<>()).add(trade);
            }
        }
        return byWeek.entrySet().stream()
                .map(e -> {
                    List<TradeDTO> weekTrades = e.getValue();
                    double pnl = weekTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
                    int w = (int) weekTrades.stream().filter(this::isWin).count();
                    int l = (int) weekTrades.stream().filter(this::isLoss).count();
                    double wr = weekTrades.isEmpty() ? 0 : (double) w / weekTrades.size();
                    return new WeeklyPerformance(e.getKey(), weekTrades.size(), w, l, pnl, wr);
                })
                .collect(Collectors.toList());
    }

    private List<MonthlyPerformance> calculateMonthlyPerformance(List<TradeDTO> trades) {
        Map<String, List<TradeDTO>> byMonth = new TreeMap<>();
        for (TradeDTO trade : trades) {
            if (trade.getExitTime() != null) {
                LocalDate date = trade.getExitTime().toLocalDate();
                String monthKey = date.getYear() + "-" + String.format("%02d", date.getMonthValue());
                byMonth.computeIfAbsent(monthKey, k -> new ArrayList<>()).add(trade);
            }
        }
        return byMonth.entrySet().stream()
                .map(e -> {
                    List<TradeDTO> monthTrades = e.getValue();
                    double pnl = monthTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
                    int w = (int) monthTrades.stream().filter(this::isWin).count();
                    int l = (int) monthTrades.stream().filter(this::isLoss).count();
                    double wr = monthTrades.isEmpty() ? 0 : (double) w / monthTrades.size();
                    return new MonthlyPerformance(e.getKey(), monthTrades.size(), w, l, pnl, wr);
                })
                .collect(Collectors.toList());
    }

    private List<WinRateTrend> calculateWinRateTrend(List<TradeDTO> trades, int windowSize) {
        List<WinRateTrend> trend = new ArrayList<>();
        for (int i = windowSize - 1; i < trades.size(); i++) {
            List<TradeDTO> window = trades.subList(i - windowSize + 1, i + 1);
            long wins = window.stream().filter(this::isWin).count();
            double winRate = (double) wins / windowSize;
            TradeDTO lastTrade = trades.get(i);
            String period = lastTrade.getExitTime() != null
                ? lastTrade.getExitTime().toLocalDate().toString()
                : String.valueOf(i + 1);
            trend.add(new WinRateTrend(period, winRate, windowSize));
        }
        return trend;
    }

    private DrawdownAnalysis calculateDrawdown(List<TradeDTO> trades) {
        double peak = 0;
        double maxDrawdown = 0;
        double maxDrawdownPct = 0;
        double cumulative = 0;
        LocalDateTime maxDrawdownStart = null;
        LocalDateTime maxDrawdownEnd = null;
        LocalDateTime currentDrawdownStart = null;
        int recoveryPeriod = 0;

        if (!trades.isEmpty()) {
            currentDrawdownStart = trades.get(0).getExitTime();
        }

        for (TradeDTO trade : trades) {
            cumulative += trade.getPnl();

            if (cumulative > peak) {
                peak = cumulative;
                currentDrawdownStart = trade.getExitTime();
            }

            double drawdown = peak - cumulative;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
                maxDrawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
                maxDrawdownStart = currentDrawdownStart;
                maxDrawdownEnd = trade.getExitTime();
            }
        }

        // Calculate recovery period (trades from max drawdown end to recovery)
        if (maxDrawdownEnd != null) {
            boolean recovered = false;
            double cumAfterDD = 0;
            for (TradeDTO trade : trades) {
                if (trade.getExitTime() != null && trade.getExitTime().isAfter(maxDrawdownEnd)) {
                    cumAfterDD += trade.getPnl();
                    recoveryPeriod++;
                    if (cumAfterDD >= maxDrawdown) {
                        recovered = true;
                        break;
                    }
                }
            }
            if (!recovered) recoveryPeriod = -1; // Not yet recovered
        }

        return DrawdownAnalysis.builder()
                .maxDrawdown(maxDrawdown)
                .maxDrawdownPercent(maxDrawdownPct)
                .currentDrawdown(peak - cumulative)
                .currentDrawdownPercent(peak > 0 ? ((peak - cumulative) / peak) * 100 : 0)
                .drawdownStart(maxDrawdownStart != null ? maxDrawdownStart.toString() : null)
                .drawdownEnd(maxDrawdownEnd != null ? maxDrawdownEnd.toString() : null)
                .recoveryPeriod(Math.max(recoveryPeriod, 0))
                .peakEquity(peak)
                .currentEquity(cumulative)
                .build();
    }

    private static final List<String> ALL_STRATEGIES = StrategyNameResolver.ALL_STRATEGY_KEYS;

    private Map<String, SourcePerformance> calculateBySource(List<TradeDTO> trades) {
        Map<String, List<TradeDTO>> bySource = trades.stream()
                .collect(Collectors.groupingBy(t ->
                    t.getStrategy() != null && !t.getStrategy().isEmpty()
                        ? t.getStrategy() : "UNKNOWN"));

        Map<String, SourcePerformance> result = new LinkedHashMap<>();

        // Seed all known strategies in order (even with 0 trades)
        for (String strat : ALL_STRATEGIES) {
            result.put(strat, SourcePerformance.builder()
                .source(strat).trades(0).wins(0).losses(0).winRate(0)
                .totalPnl(0).avgRMultiple(0).maxDrawdownPercent(0)
                .maxCapitalEmployed(0).avgHoldingTime(0).minHoldingTime(0).maxHoldingTime(0)
                .build());
        }
        for (var entry : bySource.entrySet()) {
            List<TradeDTO> sourceTrades = entry.getValue();
            int w = (int) sourceTrades.stream().filter(this::isWin).count();
            int l = (int) sourceTrades.stream().filter(this::isLoss).count();
            double pnl = sourceTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
            double avgR = sourceTrades.stream().mapToDouble(TradeDTO::getRMultiple).average().orElse(0);

            // Sort by exit time for sequential analysis
            sourceTrades.sort(Comparator.comparing(t -> t.getExitTime() != null ? t.getExitTime() : LocalDateTime.MIN));

            // Max capital employed = largest single position cost (entryPrice * qty)
            double maxCapEmployed = sourceTrades.stream()
                .mapToDouble(t -> t.getEntryPrice() * t.getQuantity())
                .max().orElse(0);

            // Intra-trade max drawdown: worst unrealized loss during the life of any trade
            double maxDDPct = 0;
            for (TradeDTO t : sourceTrades) {
                double intraDDPct = calculateIntraTradeDrawdownPct(t);
                if (intraDDPct > maxDDPct) maxDDPct = intraDDPct;
            }

            // Holding time stats computed from actual timestamps (in seconds for precision)
            List<Long> holdSeconds = new ArrayList<>();
            for (TradeDTO t : sourceTrades) {
                if (t.getEntryTime() != null && t.getExitTime() != null) {
                    holdSeconds.add(ChronoUnit.SECONDS.between(t.getEntryTime(), t.getExitTime()));
                }
            }
            // Store as seconds in the DTO fields
            double avgHoldSec = holdSeconds.stream().mapToLong(Long::longValue).average().orElse(0);
            double minHoldSec = holdSeconds.stream().mapToLong(Long::longValue).min().orElse(0);
            double maxHoldSec = holdSeconds.stream().mapToLong(Long::longValue).max().orElse(0);

            result.put(entry.getKey(), SourcePerformance.builder()
                    .source(entry.getKey())
                    .trades(sourceTrades.size())
                    .wins(w)
                    .losses(l)
                    .winRate(sourceTrades.isEmpty() ? 0 : (double) w / sourceTrades.size())
                    .totalPnl(pnl)
                    .avgRMultiple(avgR)
                    .maxDrawdownPercent(maxDDPct)
                    .maxCapitalEmployed(maxCapEmployed)
                    .avgHoldingTime(avgHoldSec)
                    .minHoldingTime(minHoldSec)
                    .maxHoldingTime(maxHoldSec)
                    .build());
        }
        return result;
    }

    private Map<String, OutcomeStats> calculateByExitReason(List<TradeDTO> trades) {
        Map<String, List<TradeDTO>> byReason = trades.stream()
                .filter(t -> t.getExitReason() != null)
                .collect(Collectors.groupingBy(TradeDTO::getExitReason));

        Map<String, OutcomeStats> result = new HashMap<>();
        for (var entry : byReason.entrySet()) {
            List<TradeDTO> reasonTrades = entry.getValue();
            double pnl = reasonTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
            double avgPnl = reasonTrades.isEmpty() ? 0 : pnl / reasonTrades.size();
            int w = (int) reasonTrades.stream().filter(this::isWin).count();

            result.put(entry.getKey(), OutcomeStats.builder()
                    .count(reasonTrades.size())
                    .totalPnl(pnl)
                    .avgPnl(avgPnl)
                    .winRate(reasonTrades.isEmpty() ? 0 : (double) w / reasonTrades.size())
                    .build());
        }
        return result;
    }

    private Map<String, OutcomeStats> calculateByCategory(List<TradeDTO> trades) {
        // Group by side (LONG/SHORT)
        Map<String, List<TradeDTO>> byCategory = trades.stream()
                .filter(t -> t.getSide() != null)
                .collect(Collectors.groupingBy(t ->
                    t.getSide() != null ? t.getSide() : "UNKNOWN"));

        Map<String, OutcomeStats> result = new HashMap<>();
        for (var entry : byCategory.entrySet()) {
            List<TradeDTO> sideTrades = entry.getValue();
            int w = (int) sideTrades.stream().filter(this::isWin).count();
            double pnl = sideTrades.stream().mapToDouble(TradeDTO::getPnl).sum();

            result.put(entry.getKey(), OutcomeStats.builder()
                    .count(sideTrades.size())
                    .totalPnl(pnl)
                    .avgPnl(sideTrades.isEmpty() ? 0 : pnl / sideTrades.size())
                    .winRate(sideTrades.isEmpty() ? 0 : (double) w / sideTrades.size())
                    .build());
        }
        return result;
    }

    private StreakAnalysis calculateStreaks(List<TradeDTO> trades) {
        int currentStreak = 0;
        int maxWinStreak = 0;
        int maxLossStreak = 0;
        int tempWinStreak = 0;
        int tempLossStreak = 0;
        boolean lastWasWin = false;

        // Track all win/loss streaks for averages
        List<Integer> winStreaks = new ArrayList<>();
        List<Integer> lossStreaks = new ArrayList<>();

        for (TradeDTO trade : trades) {
            boolean win = isWin(trade);
            boolean loss = isLoss(trade);

            if (win) {
                if (tempLossStreak > 0) lossStreaks.add(tempLossStreak);
                tempWinStreak++;
                tempLossStreak = 0;
                maxWinStreak = Math.max(maxWinStreak, tempWinStreak);
                lastWasWin = true;
            } else if (loss) {
                if (tempWinStreak > 0) winStreaks.add(tempWinStreak);
                tempLossStreak++;
                tempWinStreak = 0;
                maxLossStreak = Math.max(maxLossStreak, tempLossStreak);
                lastWasWin = false;
            }
        }
        // Capture final streak
        if (tempWinStreak > 0) winStreaks.add(tempWinStreak);
        if (tempLossStreak > 0) lossStreaks.add(tempLossStreak);

        currentStreak = lastWasWin ? tempWinStreak : tempLossStreak;
        String currentStreakType = lastWasWin ? "WIN" : (tempLossStreak > 0 ? "LOSS" : "NONE");

        double avgWinStreak = winStreaks.stream().mapToInt(Integer::intValue).average().orElse(0);
        double avgLossStreak = lossStreaks.stream().mapToInt(Integer::intValue).average().orElse(0);

        return StreakAnalysis.builder()
                .currentStreak(currentStreak)
                .currentStreakType(currentStreakType)
                .maxWinStreak(maxWinStreak)
                .maxLossStreak(maxLossStreak)
                .avgWinStreak(avgWinStreak)
                .avgLossStreak(avgLossStreak)
                .build();
    }

    private TimeAnalysis calculateTimeAnalysis(List<TradeDTO> trades) {
        // Compute avg holding time from timestamps in seconds
        double avgDuration = trades.stream()
                .filter(t -> t.getEntryTime() != null && t.getExitTime() != null)
                .mapToLong(t -> ChronoUnit.SECONDS.between(t.getEntryTime(), t.getExitTime()))
                .average().orElse(0);

        // Hourly P&L
        Map<Integer, List<TradeDTO>> byHourTrades = new HashMap<>();
        for (TradeDTO trade : trades) {
            if (trade.getEntryTime() != null) {
                int hour = trade.getEntryTime().getHour();
                byHourTrades.computeIfAbsent(hour, k -> new ArrayList<>()).add(trade);
            }
        }

        Map<Integer, OutcomeStats> byHour = new HashMap<>();
        Map<Integer, Double> hourlyPnl = new HashMap<>();
        for (var entry : byHourTrades.entrySet()) {
            List<TradeDTO> hourTrades = entry.getValue();
            double pnl = hourTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
            int w = (int) hourTrades.stream().filter(this::isWin).count();
            hourlyPnl.put(entry.getKey(), pnl);
            byHour.put(entry.getKey(), OutcomeStats.builder()
                    .count(hourTrades.size())
                    .totalPnl(pnl)
                    .avgPnl(hourTrades.isEmpty() ? 0 : pnl / hourTrades.size())
                    .winRate(hourTrades.isEmpty() ? 0 : (double) w / hourTrades.size())
                    .build());
        }

        int bestHour = hourlyPnl.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey).orElse(-1);
        int worstHour = hourlyPnl.entrySet().stream()
                .min(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey).orElse(-1);

        // Day of week analysis
        Map<String, List<TradeDTO>> byDayTrades = new HashMap<>();
        for (TradeDTO trade : trades) {
            if (trade.getExitTime() != null) {
                String dayName = trade.getExitTime().getDayOfWeek()
                    .getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
                byDayTrades.computeIfAbsent(dayName, k -> new ArrayList<>()).add(trade);
            }
        }

        Map<String, OutcomeStats> byDayOfWeek = new HashMap<>();
        String bestDay = "N/A";
        String worstDay = "N/A";
        double bestDayPnl = Double.NEGATIVE_INFINITY;
        double worstDayPnl = Double.POSITIVE_INFINITY;

        for (var entry : byDayTrades.entrySet()) {
            List<TradeDTO> dayTrades = entry.getValue();
            double pnl = dayTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
            int w = (int) dayTrades.stream().filter(this::isWin).count();
            byDayOfWeek.put(entry.getKey(), OutcomeStats.builder()
                    .count(dayTrades.size())
                    .totalPnl(pnl)
                    .avgPnl(dayTrades.isEmpty() ? 0 : pnl / dayTrades.size())
                    .winRate(dayTrades.isEmpty() ? 0 : (double) w / dayTrades.size())
                    .build());
            if (pnl > bestDayPnl) { bestDayPnl = pnl; bestDay = entry.getKey(); }
            if (pnl < worstDayPnl) { worstDayPnl = pnl; worstDay = entry.getKey(); }
        }

        return TimeAnalysis.builder()
                .bestTradingHour(bestHour)
                .worstTradingHour(worstHour)
                .bestTradingDay(bestDay)
                .worstTradingDay(worstDay)
                .avgHoldingTime(avgDuration)
                .byHour(byHour)
                .byDayOfWeek(byDayOfWeek)
                .build();
    }

    // ======================== EXCHANGE CATEGORIZATION ========================

    private static final Set<String> MCX_KEYWORDS = Set.of(
        "CRUDEOIL", "CRUDE", "NATURALGAS", "NATGAS", "NATGASMINI",
        "GOLD", "GOLDM", "GOLDPETAL", "SILVER", "SILVERM", "SILVERMIC",
        "ZINC", "ZINCMINI", "LEAD", "LEADMINI", "NICKEL", "NICKELMINI",
        "ALUMINI", "ALUMINIUM", "COPPER", "MENTHAOIL", "COTTON"
    );

    private static final Set<String> CURRENCY_KEYWORDS = Set.of(
        "USDINR", "EURINR", "GBPINR", "JPYINR", "EURUSD", "GBPUSD", "USDJPY"
    );

    private String inferExchange(TradeDTO trade) {
        String name = (trade.getCompanyName() != null ? trade.getCompanyName() : "").toUpperCase();
        String scrip = (trade.getScripCode() != null ? trade.getScripCode() : "").toUpperCase();
        String combined = name + " " + scrip;

        // Extract first word for keyword matching
        String firstWord = name.split("\\s+")[0];

        for (String kw : MCX_KEYWORDS) {
            if (firstWord.startsWith(kw) || combined.contains(kw)) return "MCX";
        }
        for (String kw : CURRENCY_KEYWORDS) {
            if (combined.contains(kw)) return "Currency";
        }
        return "NSE";
    }

    private List<StrategyDetail> calculateStrategyDetails(List<TradeDTO> trades) {
        // Group by strategy + exchange
        Map<String, Map<String, List<TradeDTO>>> stratExch = new HashMap<>();
        for (TradeDTO t : trades) {
            String strategy = t.getStrategy() != null && !t.getStrategy().isEmpty() ? t.getStrategy() : "UNKNOWN";
            String exchange = inferExchange(t);
            stratExch.computeIfAbsent(strategy, k -> new HashMap<>())
                     .computeIfAbsent(exchange, k -> new ArrayList<>())
                     .add(t);
        }

        List<StrategyDetail> result = new ArrayList<>();
        for (var stratEntry : stratExch.entrySet()) {
            String strategy = stratEntry.getKey();
            for (var exchEntry : stratEntry.getValue().entrySet()) {
                String exchange = exchEntry.getKey();
                List<TradeDTO> exchTrades = exchEntry.getValue();

                // Sort by exit time for drawdown calculation
                exchTrades.sort(Comparator.comparing(t -> t.getExitTime() != null ? t.getExitTime() : LocalDateTime.MIN));

                int w = (int) exchTrades.stream().filter(this::isWin).count();
                int l = (int) exchTrades.stream().filter(this::isLoss).count();
                double totalPnl = exchTrades.stream().mapToDouble(TradeDTO::getPnl).sum();

                // Max capital employed = largest single position cost
                double maxCapEmployed = exchTrades.stream()
                    .mapToDouble(t -> t.getEntryPrice() * t.getQuantity())
                    .max().orElse(0);

                // Total capital deployed (sum of all position costs) for profit% calc
                double totalCapDeployed = exchTrades.stream()
                    .mapToDouble(t -> t.getEntryPrice() * t.getQuantity())
                    .sum();

                // Profit % = totalPnl / totalCapitalDeployed * 100
                double profitPercent = totalCapDeployed > 0 ? (totalPnl / totalCapDeployed) * 100 : 0;

                // ROI = totalPnl / maxCapitalEmployed * 100
                double roi = maxCapEmployed > 0 ? (totalPnl / maxCapEmployed) * 100 : 0;

                // Intra-trade max drawdown: worst unrealized loss during any trade's life
                double maxDDPct = 0;
                for (TradeDTO t : exchTrades) {
                    double intraDDPct = calculateIntraTradeDrawdownPct(t);
                    if (intraDDPct > maxDDPct) maxDDPct = intraDDPct;
                }

                result.add(StrategyDetail.builder()
                    .strategy(strategy)
                    .exchange(exchange)
                    .trades(exchTrades.size())
                    .wins(w)
                    .losses(l)
                    .winRate(exchTrades.isEmpty() ? 0 : (double) w / exchTrades.size())
                    .totalPnl(totalPnl)
                    .profitPercent(profitPercent)
                    .roi(roi)
                    .maxDrawdownPercent(maxDDPct)
                    .maxCapitalEmployed(maxCapEmployed)
                    .build());
            }
        }

        // Sort by totalPnl descending
        result.sort((a, b) -> Double.compare(b.getTotalPnl(), a.getTotalPnl()));
        return result;
    }

    private Map<String, StrategyDetail> findBestByExchange(List<StrategyDetail> details) {
        Map<String, StrategyDetail> best = new HashMap<>();
        for (StrategyDetail d : details) {
            String exch = d.getExchange();
            if (!best.containsKey(exch) || d.getTotalPnl() > best.get(exch).getTotalPnl()) {
                best.put(exch, d);
            }
        }
        return best;
    }

    private synchronized void invalidateCache() {
        cachedMetrics = null;
    }

    // ======================== SCHEDULED REFRESH ========================

    @Scheduled(fixedRate = 300000) // Every 5 minutes
    public void refreshMetrics() {
        if (!allTrades.isEmpty()) {
            log.debug("[PERF] Refreshing performance metrics...");
            cachedMetrics = calculateMetrics();
            lastCalculation = System.currentTimeMillis();
        }
    }

    // ======================== INTRA-TRADE DRAWDOWN ========================

    /**
     * Calculate the max intra-trade drawdown % for a single trade by querying
     * 1-minute candles from tick_candles_1m during the trade's lifetime.
     *
     * For LONG: worst unrealized loss = (entryPrice - lowestLow) * qty
     * For SHORT: worst unrealized loss = (highestHigh - entryPrice) * qty
     * DD% = unrealizedLoss / capitalEmployed * 100
     */
    private double calculateIntraTradeDrawdownPct(TradeDTO trade) {
        if (trade.getEntryTime() == null || trade.getExitTime() == null) return 0;
        if (trade.getScripCode() == null || trade.getQuantity() <= 0) return 0;

        double entryPrice = trade.getEntryPrice();
        double capital = entryPrice * trade.getQuantity();
        if (capital <= 0) return 0;

        try {
            // Convert LocalDateTime (IST) to Date (UTC) for MongoDB query
            ZoneId ist = ZoneId.of("Asia/Kolkata");
            Date entryDate = Date.from(trade.getEntryTime().atZone(ist).toInstant());
            Date exitDate = Date.from(trade.getExitTime().atZone(ist).toInstant());

            var candles = mongoTemplate.getCollection("tick_candles_1m")
                .find(Filters.and(
                    Filters.eq("scripCode", trade.getScripCode()),
                    Filters.gte("timestamp", entryDate),
                    Filters.lte("timestamp", exitDate)
                ))
                .sort(Sorts.ascending("timestamp"));

            double worstPrice = entryPrice; // no drawdown by default
            boolean isShort = "SHORT".equalsIgnoreCase(trade.getSide());
            boolean hasCandles = false;

            for (Document candle : candles) {
                hasCandles = true;
                if (isShort) {
                    double high = getDoubleVal(candle, "high");
                    if (high > worstPrice) worstPrice = high;
                } else {
                    double low = getDoubleVal(candle, "low");
                    if (low > 0 && low < worstPrice) worstPrice = low;
                }
            }

            if (!hasCandles) {
                // Very short trade with no candle data — use exit price as fallback
                double exitPrice = trade.getExitPrice() != null ? trade.getExitPrice() : entryPrice;
                if (isShort) {
                    worstPrice = Math.max(entryPrice, exitPrice);
                } else {
                    worstPrice = Math.min(entryPrice, exitPrice);
                }
            }

            double worstDrop;
            if (isShort) {
                worstDrop = Math.max(0, worstPrice - entryPrice);
            } else {
                worstDrop = Math.max(0, entryPrice - worstPrice);
            }

            double unrealizedLoss = worstDrop * trade.getQuantity();
            return (unrealizedLoss / capital) * 100;

        } catch (Exception e) {
            log.warn("[PERF] Failed to calculate intra-trade DD for {}: {}", trade.getCompanyName(), e.getMessage());
            return 0;
        }
    }

    // ======================== DTOs (matching frontend types) ========================

    @Data
    @Builder
    public static class PerformanceMetrics {
        private int totalTrades;
        private int wins;
        private int losses;
        private double winRate;
        private double totalPnl;
        private double avgPnl;
        private double maxWin;
        private double maxLoss;
        private double avgRMultiple;
        private double profitFactor;
        private double expectancy;
        private double grossProfit;
        private double grossLoss;
        private DrawdownAnalysis drawdown;
        private List<DailyPerformance> dailyPerformance;
        private List<WeeklyPerformance> weeklyPerformance;
        private List<MonthlyPerformance> monthlyPerformance;
        private List<WinRateTrend> winRateTrend;
        private Map<String, SourcePerformance> bySource;
        private Map<String, OutcomeStats> byExitReason;
        private Map<String, OutcomeStats> byCategory;
        private StreakAnalysis streaks;
        private TimeAnalysis timeAnalysis;
        private List<StrategyDetail> strategyDetails;
        private Map<String, StrategyDetail> bestByExchange;
        private String lastUpdated;

        public static PerformanceMetrics empty() {
            return PerformanceMetrics.builder()
                    .totalTrades(0).wins(0).losses(0).winRate(0)
                    .totalPnl(0).avgPnl(0).profitFactor(0).expectancy(0)
                    .drawdown(DrawdownAnalysis.builder().build())
                    .dailyPerformance(List.of())
                    .weeklyPerformance(List.of())
                    .monthlyPerformance(List.of())
                    .winRateTrend(List.of())
                    .bySource(Map.of())
                    .byExitReason(Map.of())
                    .byCategory(Map.of())
                    .streaks(StreakAnalysis.builder()
                        .currentStreakType("NONE").build())
                    .timeAnalysis(TimeAnalysis.builder()
                        .byHour(Map.of()).byDayOfWeek(Map.of())
                        .bestTradingDay("N/A").worstTradingDay("N/A").build())
                    .strategyDetails(List.of())
                    .bestByExchange(Map.of())
                    .lastUpdated(LocalDateTime.now().toString())
                    .build();
        }
    }

    @Data
    @Builder
    public static class DrawdownAnalysis {
        private double maxDrawdown;
        private double maxDrawdownPercent;
        private double currentDrawdown;
        private double currentDrawdownPercent;
        private String drawdownStart;
        private String drawdownEnd;
        private int recoveryPeriod;
        private double peakEquity;
        private double currentEquity;
    }

    // Frontend-matching record types
    public record DailyPerformance(String date, int trades, int wins, int losses, double pnl, double winRate) {}
    public record WeeklyPerformance(String weekStart, int trades, int wins, int losses, double pnl, double winRate) {}
    public record MonthlyPerformance(String month, int trades, int wins, int losses, double pnl, double winRate) {}
    public record WinRateTrend(String period, double winRate, int trades) {}

    @Data
    @Builder
    public static class SourcePerformance {
        private String source;
        private int trades;
        private int wins;
        private int losses;
        private double winRate;
        private double totalPnl;
        private double avgRMultiple;
        private double maxDrawdownPercent;
        private double maxCapitalEmployed;
        private double avgHoldingTime;   // in seconds
        private double minHoldingTime;   // in seconds
        private double maxHoldingTime;   // in seconds
    }

    @Data
    @Builder
    public static class OutcomeStats {
        private int count;
        private double totalPnl;
        private double avgPnl;
        private double winRate;
    }

    @Data
    @Builder
    public static class StreakAnalysis {
        private int currentStreak;
        private String currentStreakType;
        private int maxWinStreak;
        private int maxLossStreak;
        private double avgWinStreak;
        private double avgLossStreak;
    }

    @Data
    @Builder
    public static class TimeAnalysis {
        private int bestTradingHour;
        private int worstTradingHour;
        private String bestTradingDay;
        private String worstTradingDay;
        private double avgHoldingTime;
        private Map<Integer, OutcomeStats> byHour;
        private Map<String, OutcomeStats> byDayOfWeek;
    }

    @Data
    @Builder
    public static class StrategyDetail {
        private String strategy;
        private String exchange;
        private int trades;
        private int wins;
        private int losses;
        private double winRate;
        private double totalPnl;
        private double profitPercent;
        private double roi;
        private double maxDrawdownPercent;
        private double maxCapitalEmployed;
    }
}
