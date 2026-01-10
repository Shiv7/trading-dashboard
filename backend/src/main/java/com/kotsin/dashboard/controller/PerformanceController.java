package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.PerformanceAnalyticsService;
import com.kotsin.dashboard.service.PerformanceAnalyticsService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * PerformanceController - REST endpoints for performance analytics
 *
 * Provides:
 * - Overall performance metrics
 * - Daily/Weekly/Monthly breakdown
 * - Win rate trending
 * - Drawdown analysis
 * - Source performance comparison
 * - Outcome tracking
 */
@RestController
@RequestMapping("/api/performance")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class PerformanceController {

    private final PerformanceAnalyticsService analyticsService;

    /**
     * Get comprehensive performance metrics
     */
    @GetMapping
    public ResponseEntity<PerformanceMetrics> getPerformanceMetrics() {
        return ResponseEntity.ok(analyticsService.getPerformanceMetrics());
    }

    /**
     * Get summary statistics only
     */
    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> getSummary() {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        return ResponseEntity.ok(Map.of(
            "totalTrades", metrics.getTotalTrades(),
            "wins", metrics.getWins(),
            "losses", metrics.getLosses(),
            "winRate", metrics.getWinRate(),
            "totalPnl", metrics.getTotalPnl(),
            "avgRMultiple", metrics.getAvgRMultiple(),
            "profitFactor", metrics.getProfitFactor(),
            "maxDrawdown", metrics.getDrawdown() != null ? metrics.getDrawdown().getMaxDrawdown() : 0,
            "currentStreak", metrics.getStreaks() != null ? metrics.getStreaks().getCurrentStreak() : 0
        ));
    }

    /**
     * Get drawdown analysis
     */
    @GetMapping("/drawdown")
    public ResponseEntity<DrawdownAnalysis> getDrawdown() {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        return ResponseEntity.ok(metrics.getDrawdown());
    }

    /**
     * Get daily performance breakdown
     */
    @GetMapping("/daily")
    public ResponseEntity<?> getDailyPerformance(
            @RequestParam(defaultValue = "30") int days) {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        var daily = metrics.getDailyPerformance();
        if (daily != null && daily.size() > days) {
            daily = daily.subList(daily.size() - days, daily.size());
        }
        return ResponseEntity.ok(daily);
    }

    /**
     * Get weekly performance breakdown
     */
    @GetMapping("/weekly")
    public ResponseEntity<?> getWeeklyPerformance(
            @RequestParam(defaultValue = "12") int weeks) {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        var weekly = metrics.getWeeklyPerformance();
        if (weekly != null && weekly.size() > weeks) {
            weekly = weekly.subList(weekly.size() - weeks, weekly.size());
        }
        return ResponseEntity.ok(weekly);
    }

    /**
     * Get monthly performance breakdown
     */
    @GetMapping("/monthly")
    public ResponseEntity<?> getMonthlyPerformance(
            @RequestParam(defaultValue = "12") int months) {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        var monthly = metrics.getMonthlyPerformance();
        if (monthly != null && monthly.size() > months) {
            monthly = monthly.subList(monthly.size() - months, monthly.size());
        }
        return ResponseEntity.ok(monthly);
    }

    /**
     * Get win rate trend
     */
    @GetMapping("/winrate-trend")
    public ResponseEntity<?> getWinRateTrend() {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        return ResponseEntity.ok(metrics.getWinRateTrend());
    }

    /**
     * Get performance by signal source
     */
    @GetMapping("/by-source")
    public ResponseEntity<Map<String, SourcePerformance>> getBySource() {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        return ResponseEntity.ok(metrics.getBySource());
    }

    /**
     * Get performance by exit reason (outcome tracking)
     */
    @GetMapping("/by-exit-reason")
    public ResponseEntity<Map<String, OutcomeStats>> getByExitReason() {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        return ResponseEntity.ok(metrics.getByExitReason());
    }

    /**
     * Get performance by category (LONG/SHORT)
     */
    @GetMapping("/by-category")
    public ResponseEntity<Map<String, OutcomeStats>> getByCategory() {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        return ResponseEntity.ok(metrics.getByCategory());
    }

    /**
     * Get streak analysis
     */
    @GetMapping("/streaks")
    public ResponseEntity<StreakAnalysis> getStreaks() {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        return ResponseEntity.ok(metrics.getStreaks());
    }

    /**
     * Get time-based analysis
     */
    @GetMapping("/time-analysis")
    public ResponseEntity<TimeAnalysis> getTimeAnalysis() {
        PerformanceMetrics metrics = analyticsService.getPerformanceMetrics();
        return ResponseEntity.ok(metrics.getTimeAnalysis());
    }
}
