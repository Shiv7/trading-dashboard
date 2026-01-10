package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.RiskAnalyticsService;
import com.kotsin.dashboard.service.RiskAnalyticsService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * RiskController - REST endpoints for risk analytics
 *
 * Provides:
 * - Portfolio risk metrics
 * - Exposure analysis
 * - VaR calculations
 * - Risk alerts
 */
@RestController
@RequestMapping("/api/risk")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class RiskController {

    private final RiskAnalyticsService riskService;

    /**
     * Get comprehensive risk metrics
     */
    @GetMapping
    public ResponseEntity<RiskMetrics> getRiskMetrics() {
        return ResponseEntity.ok(riskService.getRiskMetrics());
    }

    /**
     * Get portfolio exposure only
     */
    @GetMapping("/exposure")
    public ResponseEntity<PortfolioExposure> getExposure() {
        RiskMetrics metrics = riskService.getRiskMetrics();
        return ResponseEntity.ok(metrics.getPortfolioExposure());
    }

    /**
     * Get concentration risk
     */
    @GetMapping("/concentration")
    public ResponseEntity<ConcentrationRisk> getConcentration() {
        RiskMetrics metrics = riskService.getRiskMetrics();
        return ResponseEntity.ok(metrics.getConcentrationRisk());
    }

    /**
     * Get direction exposure
     */
    @GetMapping("/direction")
    public ResponseEntity<DirectionExposure> getDirection() {
        RiskMetrics metrics = riskService.getRiskMetrics();
        return ResponseEntity.ok(metrics.getDirectionExposure());
    }

    /**
     * Get Value at Risk analysis
     */
    @GetMapping("/var")
    public ResponseEntity<ValueAtRisk> getVaR() {
        RiskMetrics metrics = riskService.getRiskMetrics();
        return ResponseEntity.ok(metrics.getValueAtRisk());
    }

    /**
     * Get risk score
     */
    @GetMapping("/score")
    public ResponseEntity<RiskScore> getRiskScore() {
        RiskMetrics metrics = riskService.getRiskMetrics();
        return ResponseEntity.ok(metrics.getRiskScore());
    }

    /**
     * Get risk alerts
     */
    @GetMapping("/alerts")
    public ResponseEntity<List<RiskAlert>> getAlerts() {
        RiskMetrics metrics = riskService.getRiskMetrics();
        return ResponseEntity.ok(metrics.getAlerts());
    }

    /**
     * Get summary for dashboard widget
     */
    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> getSummary() {
        RiskMetrics metrics = riskService.getRiskMetrics();
        return ResponseEntity.ok(Map.of(
                "riskScore", metrics.getRiskScore().getScore(),
                "riskLevel", metrics.getRiskScore().getLevel(),
                "openPositions", metrics.getRiskBreakdown().getOpenPositions(),
                "maxLossExposure", metrics.getMaxLossExposure(),
                "netDirection", metrics.getPortfolioExposure().getNetDirection(),
                "alertCount", metrics.getAlerts().size(),
                "var95", metrics.getValueAtRisk().getVar95()
        ));
    }
}
