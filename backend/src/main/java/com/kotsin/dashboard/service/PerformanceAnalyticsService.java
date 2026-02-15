package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.dto.TradeDTO;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * PerformanceAnalyticsService - Comprehensive trading performance analytics
 *
 * Provides:
 * - Win rate trending over time
 * - P&L analysis (daily, weekly, monthly)
 * - R-multiple tracking
 * - Drawdown analysis
 * - Signal source performance
 * - Pattern success rates
 * - Outcome tracking
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class PerformanceAnalyticsService {

    // Trade storage for analytics
    private final Map<String, TradeDTO> allTrades = new ConcurrentHashMap<>();
    private volatile PerformanceMetrics cachedMetrics;
    private volatile long lastCalculation = 0;

    // ======================== TRADE RECORDING ========================

    /**
     * Record a completed trade for analytics
     */
    public void recordTrade(TradeDTO trade) {
        if (trade == null || trade.getTradeId() == null) return;
        allTrades.put(trade.getTradeId(), trade);
        invalidateCache();
        log.debug("[PERF] Recorded trade: {} {} P&L={}",
            trade.getCompanyName(), trade.getStatus(), trade.getPnl());
    }

    /**
     * Record multiple trades
     */
    public void recordTrades(Collection<TradeDTO> trades) {
        trades.forEach(this::recordTrade);
    }

    // ======================== PERFORMANCE METRICS ========================

    /**
     * Get comprehensive performance metrics
     */
    public synchronized PerformanceMetrics getPerformanceMetrics() {
        if (cachedMetrics != null && System.currentTimeMillis() - lastCalculation < 60000) {
            return cachedMetrics;
        }
        cachedMetrics = calculateMetrics();
        lastCalculation = System.currentTimeMillis();
        return cachedMetrics;
    }

    /**
     * Calculate all performance metrics
     */
    private PerformanceMetrics calculateMetrics() {
        List<TradeDTO> trades = new ArrayList<>(allTrades.values());

        if (trades.isEmpty()) {
            return PerformanceMetrics.empty();
        }

        // Sort by exit time
        trades.sort(Comparator.comparing(t -> t.getExitTime() != null ? t.getExitTime() : LocalDateTime.MIN));

        // Basic stats
        int totalTrades = trades.size();
        long wins = trades.stream().filter(t -> isWin(t)).count();
        long losses = trades.stream().filter(t -> isLoss(t)).count();
        long decisiveTrades = wins + losses;
        double winRate = decisiveTrades > 0 ? (double) wins / decisiveTrades * 100 : 0;

        // P&L
        double totalPnl = trades.stream().mapToDouble(TradeDTO::getPnl).sum();
        double avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
        double maxWin = trades.stream().mapToDouble(TradeDTO::getPnl).max().orElse(0);
        double maxLoss = trades.stream().mapToDouble(TradeDTO::getPnl).min().orElse(0);

        // R-Multiple
        double avgRMultiple = trades.stream()
                .mapToDouble(TradeDTO::getRMultiple)
                .average().orElse(0);
        double totalRMultiple = trades.stream()
                .mapToDouble(TradeDTO::getRMultiple)
                .sum();

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

        // Drawdown
        DrawdownAnalysis drawdown = calculateDrawdown(trades);

        // Daily P&L
        Map<LocalDate, Double> dailyPnl = calculateDailyPnl(trades);
        List<DailyPerformance> dailyPerformance = dailyPnl.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> new DailyPerformance(e.getKey(), e.getValue()))
                .collect(Collectors.toList());

        // Weekly P&L
        List<WeeklyPerformance> weeklyPerformance = calculateWeeklyPerformance(trades);

        // Monthly P&L
        List<MonthlyPerformance> monthlyPerformance = calculateMonthlyPerformance(trades);

        // Win rate trend (rolling 20 trades)
        List<WinRateTrend> winRateTrend = calculateWinRateTrend(trades, 20);

        // By signal source
        Map<String, SourcePerformance> bySource = calculateBySource(trades);

        // By exit reason
        Map<String, OutcomeStats> byExitReason = calculateByExitReason(trades);

        // By category (pattern type)
        Map<String, OutcomeStats> byCategory = calculateByCategory(trades);

        // Streak analysis
        StreakAnalysis streaks = calculateStreaks(trades);

        // Time analysis
        TimeAnalysis timeAnalysis = calculateTimeAnalysis(trades);

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
                .totalRMultiple(totalRMultiple)
                .profitFactor(profitFactor)
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
                .calculatedAt(LocalDateTime.now())
                .build();
    }

    // ======================== CALCULATION HELPERS ========================

    private boolean isWin(TradeDTO trade) {
        return trade.getStatus() != null && trade.getStatus().contains("WIN");
    }

    private boolean isLoss(TradeDTO trade) {
        return trade.getStatus() != null && trade.getStatus().contains("LOSS");
    }

    private Map<LocalDate, Double> calculateDailyPnl(List<TradeDTO> trades) {
        Map<LocalDate, Double> dailyPnl = new TreeMap<>();
        for (TradeDTO trade : trades) {
            if (trade.getExitTime() != null) {
                LocalDate date = trade.getExitTime().toLocalDate();
                dailyPnl.merge(date, trade.getPnl(), Double::sum);
            }
        }
        return dailyPnl;
    }

    private List<WeeklyPerformance> calculateWeeklyPerformance(List<TradeDTO> trades) {
        Map<String, List<TradeDTO>> byWeek = new TreeMap<>();
        for (TradeDTO trade : trades) {
            if (trade.getExitTime() != null) {
                LocalDate date = trade.getExitTime().toLocalDate();
                String weekKey = date.getYear() + "-W" + String.format("%02d",
                    date.get(java.time.temporal.WeekFields.ISO.weekOfYear()));
                byWeek.computeIfAbsent(weekKey, k -> new ArrayList<>()).add(trade);
            }
        }

        return byWeek.entrySet().stream()
                .map(e -> {
                    List<TradeDTO> weekTrades = e.getValue();
                    double pnl = weekTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
                    long wins = weekTrades.stream().filter(this::isWin).count();
                    double winRate = weekTrades.isEmpty() ? 0 : (double) wins / weekTrades.size();
                    return new WeeklyPerformance(e.getKey(), pnl, weekTrades.size(), winRate);
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
                    long wins = monthTrades.stream().filter(this::isWin).count();
                    double winRate = monthTrades.isEmpty() ? 0 : (double) wins / monthTrades.size();
                    double avgR = monthTrades.stream().mapToDouble(TradeDTO::getRMultiple).average().orElse(0);
                    return new MonthlyPerformance(e.getKey(), pnl, monthTrades.size(), winRate, avgR);
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
            trend.add(new WinRateTrend(i + 1, winRate,
                lastTrade.getExitTime() != null ? lastTrade.getExitTime().toLocalDate() : LocalDate.now()));
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

        // Initialize to first trade's exit time so it's non-null if first trade is a loss
        List<TradeDTO> sortedTrades = trades;
        if (!sortedTrades.isEmpty()) {
            currentDrawdownStart = sortedTrades.get(0).getExitTime();
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

        return DrawdownAnalysis.builder()
                .maxDrawdown(maxDrawdown)
                .maxDrawdownPct(maxDrawdownPct)
                .currentDrawdown(peak - cumulative)
                .currentDrawdownPct(peak > 0 ? ((peak - cumulative) / peak) * 100 : 0)
                .maxDrawdownStart(maxDrawdownStart)
                .maxDrawdownEnd(maxDrawdownEnd)
                .peakEquity(peak)
                .currentEquity(cumulative)
                .build();
    }

    private Map<String, SourcePerformance> calculateBySource(List<TradeDTO> trades) {
        Map<String, List<TradeDTO>> bySource = trades.stream()
                .collect(Collectors.groupingBy(t -> {
                    return t.getStrategy() != null && !t.getStrategy().isEmpty()
                        ? t.getStrategy() : "UNKNOWN";
                }));

        Map<String, SourcePerformance> result = new HashMap<>();
        for (var entry : bySource.entrySet()) {
            List<TradeDTO> sourceTrades = entry.getValue();
            long wins = sourceTrades.stream().filter(this::isWin).count();
            double pnl = sourceTrades.stream().mapToDouble(TradeDTO::getPnl).sum();
            double avgR = sourceTrades.stream().mapToDouble(TradeDTO::getRMultiple).average().orElse(0);

            result.put(entry.getKey(), SourcePerformance.builder()
                    .source(entry.getKey())
                    .totalTrades(sourceTrades.size())
                    .wins((int) wins)
                    .winRate(sourceTrades.isEmpty() ? 0 : (double) wins / sourceTrades.size())
                    .totalPnl(pnl)
                    .avgRMultiple(avgR)
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

            result.put(entry.getKey(), OutcomeStats.builder()
                    .category(entry.getKey())
                    .count(reasonTrades.size())
                    .totalPnl(pnl)
                    .avgPnl(avgPnl)
                    .percentage(trades.isEmpty() ? 0 : (double) reasonTrades.size() / trades.size() * 100)
                    .build());
        }
        return result;
    }

    private Map<String, OutcomeStats> calculateByCategory(List<TradeDTO> trades) {
        Map<String, List<TradeDTO>> byCategory = trades.stream()
                .filter(t -> t.getSide() != null)
                .collect(Collectors.groupingBy(t -> {
                    return t.getStrategy() != null && !t.getStrategy().isEmpty()
                        ? t.getStrategy() : (t.getSide() != null ? t.getSide() : "UNKNOWN");
                }));

        Map<String, OutcomeStats> result = new HashMap<>();
        for (var entry : byCategory.entrySet()) {
            List<TradeDTO> sideTrades = entry.getValue();
            long wins = sideTrades.stream().filter(this::isWin).count();
            double pnl = sideTrades.stream().mapToDouble(TradeDTO::getPnl).sum();

            result.put(entry.getKey(), OutcomeStats.builder()
                    .category(entry.getKey())
                    .count(sideTrades.size())
                    .totalPnl(pnl)
                    .avgPnl(sideTrades.isEmpty() ? 0 : pnl / sideTrades.size())
                    .percentage(trades.isEmpty() ? 0 : (double) sideTrades.size() / trades.size() * 100)
                    .winRate(sideTrades.isEmpty() ? 0 : (double) wins / sideTrades.size())
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

        for (TradeDTO trade : trades) {
            boolean isWin = isWin(trade);

            if (isWin) {
                tempWinStreak++;
                tempLossStreak = 0;
                maxWinStreak = Math.max(maxWinStreak, tempWinStreak);
                lastWasWin = true;
            } else if (isLoss(trade)) {
                tempLossStreak++;
                tempWinStreak = 0;
                maxLossStreak = Math.max(maxLossStreak, tempLossStreak);
                lastWasWin = false;
            } else {
                // Breakeven/trailing trades break both streaks
                tempWinStreak = 0;
                tempLossStreak = 0;
            }
        }

        currentStreak = lastWasWin ? tempWinStreak : -tempLossStreak;

        return StreakAnalysis.builder()
                .currentStreak(currentStreak)
                .maxWinStreak(maxWinStreak)
                .maxLossStreak(maxLossStreak)
                .isCurrentWinning(currentStreak > 0)
                .build();
    }

    private TimeAnalysis calculateTimeAnalysis(List<TradeDTO> trades) {
        // Average trade duration
        double avgDuration = trades.stream()
                .mapToLong(TradeDTO::getDurationMinutes)
                .average().orElse(0);

        // Best/worst hour (simplified)
        Map<Integer, Double> hourlyPnl = new HashMap<>();
        for (TradeDTO trade : trades) {
            if (trade.getEntryTime() != null) {
                int hour = trade.getEntryTime().getHour();
                hourlyPnl.merge(hour, trade.getPnl(), Double::sum);
            }
        }

        int bestHour = hourlyPnl.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey).orElse(10);
        int worstHour = hourlyPnl.entrySet().stream()
                .min(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey).orElse(15);

        return TimeAnalysis.builder()
                .avgTradeDurationMinutes(avgDuration)
                .bestHour(bestHour)
                .worstHour(worstHour)
                .hourlyPnl(hourlyPnl)
                .build();
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

    // ======================== DTOs ========================

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
        private double totalRMultiple;
        private double profitFactor;
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
        private LocalDateTime calculatedAt;

        public static PerformanceMetrics empty() {
            return PerformanceMetrics.builder()
                    .totalTrades(0)
                    .wins(0)
                    .losses(0)
                    .winRate(0)
                    .totalPnl(0)
                    .avgPnl(0)
                    .profitFactor(0)
                    .drawdown(DrawdownAnalysis.builder().build())
                    .dailyPerformance(List.of())
                    .weeklyPerformance(List.of())
                    .monthlyPerformance(List.of())
                    .winRateTrend(List.of())
                    .bySource(Map.of())
                    .byExitReason(Map.of())
                    .byCategory(Map.of())
                    .streaks(StreakAnalysis.builder().build())
                    .timeAnalysis(TimeAnalysis.builder().hourlyPnl(Map.of()).build())
                    .calculatedAt(LocalDateTime.now())
                    .build();
        }
    }

    @Data
    @Builder
    public static class DrawdownAnalysis {
        private double maxDrawdown;
        private double maxDrawdownPct;
        private double currentDrawdown;
        private double currentDrawdownPct;
        private LocalDateTime maxDrawdownStart;
        private LocalDateTime maxDrawdownEnd;
        private double peakEquity;
        private double currentEquity;
    }

    public record DailyPerformance(LocalDate date, double pnl) {}
    public record WeeklyPerformance(String week, double pnl, int trades, double winRate) {}
    public record MonthlyPerformance(String month, double pnl, int trades, double winRate, double avgRMultiple) {}
    public record WinRateTrend(int tradeNumber, double winRate, LocalDate date) {}

    @Data
    @Builder
    public static class SourcePerformance {
        private String source;
        private int totalTrades;
        private int wins;
        private double winRate;
        private double totalPnl;
        private double avgRMultiple;
    }

    @Data
    @Builder
    public static class OutcomeStats {
        private String category;
        private int count;
        private double totalPnl;
        private double avgPnl;
        private double percentage;
        private double winRate;
    }

    @Data
    @Builder
    public static class StreakAnalysis {
        private int currentStreak;
        private int maxWinStreak;
        private int maxLossStreak;
        private boolean isCurrentWinning;
    }

    @Data
    @Builder
    public static class TimeAnalysis {
        private double avgTradeDurationMinutes;
        private int bestHour;
        private int worstHour;
        private Map<Integer, Double> hourlyPnl;
    }
}
