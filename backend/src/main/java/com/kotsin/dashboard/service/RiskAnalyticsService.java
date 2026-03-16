package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.dto.StrategyWalletDTO;
import lombok.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * RiskAnalyticsService - Portfolio risk metrics from REAL wallet and trade data.
 *
 * Uses StrategyWalletsService for:
 * - Live wallet state (balance, margin, drawdown, circuit breakers)
 * - Closed trade history (PnL, R-multiple, win/loss streaks)
 *
 * Produces health scores, risk alerts, and drawdown history.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class RiskAnalyticsService {

    private final StrategyWalletsService strategyWalletsService;

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter ISO_FMT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    // ════════════════════════════════════════════
    //  Public API
    // ════════════════════════════════════════════

    /**
     * Full portfolio risk summary across all strategies.
     */
    public PortfolioRiskSummary getPortfolioRisk() {
        List<StrategyWalletDTO.StrategySummary> wallets = strategyWalletsService.getSummaries();
        List<StrategyRiskProfile> profiles = new ArrayList<>();
        List<RiskAlert> allAlerts = new ArrayList<>();

        double totalBalance = 0;
        double totalUnrealized = 0;
        double totalDayPnl = 0;
        double totalUsedMargin = 0;
        double totalAvailableMargin = 0;
        int totalOpenPositions = 0;
        int circuitBreakersTripped = 0;
        double weightedHealthSum = 0;
        double totalCapitalWeight = 0;

        for (StrategyWalletDTO.StrategySummary w : wallets) {
            StrategyRiskProfile profile = buildProfile(w);
            profiles.add(profile);

            totalBalance += w.getCurrentCapital();
            totalUnrealized += w.getUnrealizedPnl();
            totalDayPnl += w.getDayPnl();
            totalUsedMargin += w.getUsedMargin();
            totalAvailableMargin += w.getAvailableMargin();
            totalOpenPositions += w.getMaxOpenPositions();
            if (w.isCircuitBreakerTripped()) circuitBreakersTripped++;

            weightedHealthSum += profile.getHealthScore() * w.getCurrentCapital();
            totalCapitalWeight += w.getCurrentCapital();

            allAlerts.addAll(generateAlertsForStrategy(profile));
        }

        int overallHealth = totalCapitalWeight > 0
                ? (int) Math.round(weightedHealthSum / totalCapitalWeight)
                : 100;

        // Sort alerts: CRITICAL first, then HIGH, MEDIUM, LOW
        allAlerts.sort(Comparator.comparingInt(a -> severityOrder(a.getSeverity())));

        return PortfolioRiskSummary.builder()
                .strategies(profiles)
                .totalBalance(round2(totalBalance))
                .totalUnrealizedPnl(round2(totalUnrealized))
                .totalDayPnl(round2(totalDayPnl))
                .totalUsedMargin(round2(totalUsedMargin))
                .totalAvailableMargin(round2(totalAvailableMargin))
                .overallHealthScore(Math.max(0, Math.min(100, overallHealth)))
                .overallHealthStatus(healthStatus(overallHealth))
                .totalOpenPositions(totalOpenPositions)
                .circuitBreakersTripped(circuitBreakersTripped)
                .alerts(allAlerts)
                .lastUpdated(LocalDateTime.now(IST).format(ISO_FMT))
                .build();
    }

    /**
     * Risk profile for a single strategy.
     */
    public StrategyRiskProfile getStrategyRisk(String strategyKey) {
        List<StrategyWalletDTO.StrategySummary> wallets = strategyWalletsService.getSummaries();
        StrategyWalletDTO.StrategySummary wallet = wallets.stream()
                .filter(w -> w.getStrategy().equalsIgnoreCase(strategyKey))
                .findFirst()
                .orElse(null);

        if (wallet == null) {
            log.warn("No wallet found for strategy: {}", strategyKey);
            return StrategyRiskProfile.builder()
                    .strategy(strategyKey)
                    .displayName(strategyKey)
                    .healthScore(0)
                    .healthStatus("UNKNOWN")
                    .build();
        }

        return buildProfile(wallet);
    }

    /**
     * Drawdown history from closed trades for a strategy.
     */
    public List<DrawdownPoint> getDrawdownHistory(String strategy, String period) {
        LocalDateTime cutoff = resolveCutoff(period);

        // Get closed trades sorted by exitTime ascending
        List<StrategyWalletDTO.StrategyTrade> trades = strategyWalletsService.getTrades(
                strategy, null, null, "exitTime", 5000, null, null);

        // Filter to closed trades only (exitTime != null) and within period
        List<StrategyWalletDTO.StrategyTrade> closed = trades.stream()
                .filter(t -> t.getExitTime() != null)
                .filter(t -> !"ACTIVE".equals(t.getExitReason()))
                .filter(t -> cutoff == null || t.getExitTime().isAfter(cutoff))
                .sorted(Comparator.comparing(StrategyWalletDTO.StrategyTrade::getExitTime))
                .collect(Collectors.toList());

        // Find initial capital from wallet
        double initialCapital = 1_000_000.0; // default
        List<StrategyWalletDTO.StrategySummary> wallets = strategyWalletsService.getSummaries();
        for (StrategyWalletDTO.StrategySummary w : wallets) {
            if (w.getStrategy().equalsIgnoreCase(strategy)) {
                initialCapital = w.getInitialCapital();
                break;
            }
        }

        List<DrawdownPoint> history = new ArrayList<>();
        double balance = initialCapital;
        double peak = initialCapital;

        for (StrategyWalletDTO.StrategyTrade t : closed) {
            balance += t.getPnl();
            peak = Math.max(peak, balance);
            double ddPct = peak > 0 ? ((peak - balance) / peak) * 100 : 0;

            history.add(DrawdownPoint.builder()
                    .timestamp(t.getExitTime().format(ISO_FMT))
                    .balance(round2(balance))
                    .peakBalance(round2(peak))
                    .drawdownPercent(round2(ddPct))
                    .pnl(round2(t.getPnl()))
                    .build());
        }

        return history;
    }

    // ════════════════════════════════════════════
    //  Profile builder
    // ════════════════════════════════════════════

    private StrategyRiskProfile buildProfile(StrategyWalletDTO.StrategySummary w) {
        // Drawdown %
        double drawdownPct = (w.getPeakBalance() > 0)
                ? ((w.getPeakBalance() - w.getCurrentCapital()) / w.getPeakBalance()) * 100
                : 0;
        drawdownPct = Math.max(0, drawdownPct);

        // Daily loss % of limit
        double dailyLossPct = (w.getMaxDailyLoss() > 0 && w.getDayPnl() < 0)
                ? (Math.abs(w.getDayPnl()) / w.getMaxDailyLoss()) * 100
                : 0;

        // Margin utilization %
        double marginUtilPct = (w.getCurrentCapital() > 0)
                ? (w.getUsedMargin() / w.getCurrentCapital()) * 100
                : 0;

        // Trade quality metrics from recent trades
        List<StrategyWalletDTO.StrategyTrade> recentTrades = fetchClosedTrades(w.getStrategy(), 40);

        double last10WinRate = 0;
        int consecutiveLosses = 0;
        double avgRMultiple = 0;
        double last10AvgPnl = 0;

        if (!recentTrades.isEmpty()) {
            // Last 10 trades
            List<StrategyWalletDTO.StrategyTrade> last10 = recentTrades.stream()
                    .limit(10)
                    .collect(Collectors.toList());

            if (!last10.isEmpty()) {
                long last10Wins = last10.stream().filter(t -> t.getPnl() > 0).count();
                last10WinRate = (double) last10Wins / last10.size() * 100;
                last10AvgPnl = last10.stream().mapToDouble(StrategyWalletDTO.StrategyTrade::getPnl).average().orElse(0);
            }

            // Consecutive losses (from most recent)
            for (StrategyWalletDTO.StrategyTrade t : recentTrades) {
                if (t.getPnl() < 0) {
                    consecutiveLosses++;
                } else {
                    break;
                }
            }

            // Average R-multiple
            avgRMultiple = recentTrades.stream()
                    .filter(t -> t.getRMultiple() != null)
                    .mapToDouble(StrategyWalletDTO.StrategyTrade::getRMultiple)
                    .average()
                    .orElse(0);
        }

        boolean winRateDeclining = last10WinRate < (w.getWinRate() - 5);

        // Health score
        int healthScore = computeHealthScore(
                w.isCircuitBreakerTripped(), dailyLossPct, drawdownPct,
                winRateDeclining, consecutiveLosses, marginUtilPct);

        return StrategyRiskProfile.builder()
                .strategy(w.getStrategy())
                .displayName(w.getDisplayName())
                .currentBalance(round2(w.getCurrentCapital()))
                .initialCapital(round2(w.getInitialCapital()))
                .usedMargin(round2(w.getUsedMargin()))
                .availableMargin(round2(w.getAvailableMargin()))
                .dayPnl(round2(w.getDayPnl()))
                .unrealizedPnl(round2(w.getUnrealizedPnl()))
                .peakBalance(round2(w.getPeakBalance()))
                .maxDrawdown(round2(w.getMaxDrawdown()))
                .maxDailyLoss(round2(w.getMaxDailyLoss()))
                .circuitBreakerTripped(w.isCircuitBreakerTripped())
                .circuitBreakerReason(w.getCircuitBreakerReason())
                .winRate(round2(w.getWinRate()))
                .profitFactor(round2(w.getProfitFactor()))
                .totalTradeCount(w.getTotalTrades())
                .dayTradeCount(w.getDayTradeCount())
                .openPositionCount(w.getMaxOpenPositions())
                // Computed risk metrics
                .healthScore(healthScore)
                .healthStatus(healthStatus(healthScore))
                .drawdownPercent(round2(drawdownPct))
                .dailyLossPercent(round2(dailyLossPct))
                .marginUtilPercent(round2(marginUtilPct))
                // Trade quality
                .last10WinRate(round2(last10WinRate))
                .winRateDeclining(winRateDeclining)
                .consecutiveLosses(consecutiveLosses)
                .avgRMultiple(round2(avgRMultiple))
                .last10AvgPnl(round2(last10AvgPnl))
                .build();
    }

    // ════════════════════════════════════════════
    //  Health score
    // ════════════════════════════════════════════

    private int computeHealthScore(boolean circuitBreaker, double dailyLossPct,
                                   double drawdownPct, boolean winRateDeclining,
                                   int consecutiveLosses, double marginUtilPct) {
        double score = 100;

        if (circuitBreaker) score -= 50;

        if (dailyLossPct > 70) {
            score -= Math.min(45, (dailyLossPct - 70) * 1.5);
        }

        if (drawdownPct > 5) {
            score -= (drawdownPct - 5) * 2;
        }

        if (winRateDeclining) score -= 10;

        if (consecutiveLosses > 2) {
            score -= consecutiveLosses * 5;
        }

        if (marginUtilPct > 80) {
            score -= (marginUtilPct - 80);
        }

        return (int) Math.round(Math.max(0, Math.min(100, score)));
    }

    private String healthStatus(int score) {
        if (score >= 70) return "HEALTHY";
        if (score >= 40) return "DEGRADING";
        return "CRITICAL";
    }

    // ════════════════════════════════════════════
    //  Alert generation
    // ════════════════════════════════════════════

    private List<RiskAlert> generateAlertsForStrategy(StrategyRiskProfile p) {
        List<RiskAlert> alerts = new ArrayList<>();

        if (p.isCircuitBreakerTripped()) {
            alerts.add(RiskAlert.builder()
                    .strategy(p.getDisplayName())
                    .type("CIRCUIT_BREAKER")
                    .severity("CRITICAL")
                    .message("Circuit breaker tripped: " +
                            (p.getCircuitBreakerReason() != null ? p.getCircuitBreakerReason() : "unknown reason"))
                    .recommendation("Review strategy parameters and market conditions before resetting")
                    .build());
        }

        if (p.getDailyLossPercent() > 80) {
            alerts.add(RiskAlert.builder()
                    .strategy(p.getDisplayName())
                    .type("DAILY_LOSS_WARNING")
                    .severity("HIGH")
                    .message(String.format("Daily loss at %.1f%% of limit", p.getDailyLossPercent()))
                    .recommendation("Consider reducing position sizes for remaining trades today")
                    .build());
        } else if (p.getDailyLossPercent() > 50) {
            alerts.add(RiskAlert.builder()
                    .strategy(p.getDisplayName())
                    .type("DAILY_LOSS_WARNING")
                    .severity("MEDIUM")
                    .message(String.format("Daily loss approaching limit (%.1f%%)", p.getDailyLossPercent()))
                    .recommendation("Monitor closely, consider tightening stop losses")
                    .build());
        }

        if (p.getDrawdownPercent() > 8) {
            alerts.add(RiskAlert.builder()
                    .strategy(p.getDisplayName())
                    .type("DRAWDOWN_WARNING")
                    .severity("HIGH")
                    .message(String.format("Drawdown at %.1f%%", p.getDrawdownPercent()))
                    .recommendation("Review strategy performance and consider reducing allocation")
                    .build());
        }

        if (p.getConsecutiveLosses() >= 4) {
            alerts.add(RiskAlert.builder()
                    .strategy(p.getDisplayName())
                    .type("LOSS_STREAK")
                    .severity("HIGH")
                    .message(p.getConsecutiveLosses() + " consecutive losses")
                    .recommendation("Consider pausing strategy and reviewing recent trade quality")
                    .build());
        } else if (p.getConsecutiveLosses() >= 3) {
            alerts.add(RiskAlert.builder()
                    .strategy(p.getDisplayName())
                    .type("LOSS_STREAK")
                    .severity("MEDIUM")
                    .message(p.getConsecutiveLosses() + " consecutive losses")
                    .recommendation("Monitor next few trades closely")
                    .build());
        }

        if (p.isWinRateDeclining()) {
            alerts.add(RiskAlert.builder()
                    .strategy(p.getDisplayName())
                    .type("WIN_RATE_DECLINE")
                    .severity("MEDIUM")
                    .message(String.format("Win rate declining: last 10 = %.1f%% vs overall %.1f%%",
                            p.getLast10WinRate(), p.getWinRate()))
                    .recommendation("Review recent signal quality and market conditions")
                    .build());
        }

        if (p.getMarginUtilPercent() > 85) {
            alerts.add(RiskAlert.builder()
                    .strategy(p.getDisplayName())
                    .type("MARGIN_HIGH")
                    .severity("MEDIUM")
                    .message(String.format("Margin utilization at %.1f%%", p.getMarginUtilPercent()))
                    .recommendation("Close some positions to free margin for new opportunities")
                    .build());
        }

        return alerts;
    }

    // ════════════════════════════════════════════
    //  Helpers
    // ════════════════════════════════════════════

    private List<StrategyWalletDTO.StrategyTrade> fetchClosedTrades(String strategy, int limit) {
        try {
            List<StrategyWalletDTO.StrategyTrade> trades = strategyWalletsService.getTrades(
                    strategy, null, null, "exitTime", limit, null, null);
            // Filter to closed trades only, most recent first
            return trades.stream()
                    .filter(t -> t.getExitTime() != null)
                    .filter(t -> !"ACTIVE".equals(t.getExitReason()))
                    .sorted(Comparator.comparing(StrategyWalletDTO.StrategyTrade::getExitTime).reversed())
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Error fetching trades for strategy {}: {}", strategy, e.getMessage());
            return Collections.emptyList();
        }
    }

    private LocalDateTime resolveCutoff(String period) {
        if (period == null) return null;
        switch (period.toUpperCase()) {
            case "TODAY":
                return LocalDate.now(IST).atTime(9, 15);
            case "WEEK":
                return LocalDateTime.now(IST).minusDays(7);
            case "MONTH":
                return LocalDateTime.now(IST).minusDays(30);
            case "ALL":
            default:
                return null;
        }
    }

    private int severityOrder(String severity) {
        if (severity == null) return 99;
        switch (severity) {
            case "CRITICAL": return 0;
            case "HIGH": return 1;
            case "MEDIUM": return 2;
            case "LOW": return 3;
            default: return 99;
        }
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    // ════════════════════════════════════════════
    //  DTOs
    // ════════════════════════════════════════════

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StrategyRiskProfile {
        private String strategy;
        private String displayName;
        // Wallet state
        private double currentBalance;
        private double initialCapital;
        private double usedMargin;
        private double availableMargin;
        private double dayPnl;
        private double unrealizedPnl;
        private double peakBalance;
        private double maxDrawdown;
        private double maxDailyLoss;
        private boolean circuitBreakerTripped;
        private String circuitBreakerReason;
        private double winRate;
        private double profitFactor;
        private int totalTradeCount;
        private int dayTradeCount;
        private int openPositionCount;
        // Computed risk metrics
        private int healthScore;
        private String healthStatus;
        private double drawdownPercent;
        private double dailyLossPercent;
        private double marginUtilPercent;
        // Trade quality metrics
        private double last10WinRate;
        private boolean winRateDeclining;
        private int consecutiveLosses;
        private double avgRMultiple;
        private double last10AvgPnl;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class PortfolioRiskSummary {
        private List<StrategyRiskProfile> strategies;
        private double totalBalance;
        private double totalUnrealizedPnl;
        private double totalDayPnl;
        private double totalUsedMargin;
        private double totalAvailableMargin;
        private int overallHealthScore;
        private String overallHealthStatus;
        private int totalOpenPositions;
        private int circuitBreakersTripped;
        private List<RiskAlert> alerts;
        private String lastUpdated;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RiskAlert {
        private String strategy;
        private String type;
        private String severity;
        private String message;
        private String recommendation;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class DrawdownPoint {
        private String timestamp;
        private double balance;
        private double peakBalance;
        private double drawdownPercent;
        private double pnl;
    }
}
