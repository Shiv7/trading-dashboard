package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.*;
import com.kotsin.dashboard.service.StrategyStateService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * REST API for strategy analysis data (VCP, IPU, Pivot states).
 *
 * This controller provides access to strategy state calculated by
 * StreamingCandle and stored in Redis. Unlike StrategyStateController
 * which handles real-time Kafka events, this provides persisted analysis.
 *
 * Strategy Types:
 * - VCP (Volume Cluster Profile): Support/resistance clusters, POC, VAH/VAL
 * - IPU (Institutional Participation & Urgency): Momentum, institutional activity
 * - Pivot (Market Structure): Swing points, trend, structure breaks
 *
 * Endpoints:
 * - GET /api/strategy-analysis/{symbol}?timeframe=5m        - Full strategy state
 * - GET /api/strategy-analysis/{symbol}/vcp?timeframe=5m    - VCP state only
 * - GET /api/strategy-analysis/{symbol}/ipu?timeframe=5m    - IPU state only
 * - GET /api/strategy-analysis/{symbol}/pivot?timeframe=5m  - Pivot state only
 * - GET /api/strategy-analysis/actionable?timeframe=5m      - Actionable setups
 * - GET /api/strategy-analysis/bullish-vcp?timeframe=5m     - Bullish VCP setups
 * - GET /api/strategy-analysis/uptrend?timeframe=5m         - Uptrending symbols
 * - GET /api/strategy-analysis/available?timeframe=5m       - Available symbols
 * - GET /api/strategy-analysis/counts?timeframe=5m          - State counts
 */
@RestController
@RequestMapping("/api/strategy-analysis")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class StrategyAnalysisController {

    private final StrategyStateService strategyStateService;

    // ==================== INDIVIDUAL SYMBOL ENDPOINTS ====================

    /**
     * Get full strategy state for a symbol (VCP + IPU + Pivot).
     * GET /api/strategy-analysis/{symbol}?timeframe=5m
     */
    @GetMapping("/{symbol}")
    public ResponseEntity<StrategyStateDTO> getFullState(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] GET /strategy-analysis/{} timeframe={}", symbol, timeframe);

        return strategyStateService.getFullState(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> {
                    log.debug("No strategy state found for {}/{}", symbol, timeframe);
                    return ResponseEntity.notFound().build();
                });
    }

    /**
     * Get VCP state for a symbol.
     * GET /api/strategy-analysis/{symbol}/vcp?timeframe=5m
     */
    @GetMapping("/{symbol}/vcp")
    public ResponseEntity<VcpStateDTO> getVcpState(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] GET /strategy-analysis/{}/vcp timeframe={}", symbol, timeframe);

        return strategyStateService.getVcpState(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get IPU state for a symbol.
     * GET /api/strategy-analysis/{symbol}/ipu?timeframe=5m
     */
    @GetMapping("/{symbol}/ipu")
    public ResponseEntity<IpuStateDTO> getIpuState(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] GET /strategy-analysis/{}/ipu timeframe={}", symbol, timeframe);

        return strategyStateService.getIpuState(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get Pivot (market structure) state for a symbol.
     * GET /api/strategy-analysis/{symbol}/pivot?timeframe=5m
     */
    @GetMapping("/{symbol}/pivot")
    public ResponseEntity<PivotStateDTO> getPivotState(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] GET /strategy-analysis/{}/pivot timeframe={}", symbol, timeframe);

        return strategyStateService.getPivotState(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    // ==================== SCREENING ENDPOINTS ====================

    /**
     * Get actionable setups (high IPU + clear structure).
     * GET /api/strategy-analysis/actionable?timeframe=5m&limit=20
     */
    @GetMapping("/actionable")
    public ResponseEntity<List<StrategyStateDTO>> getActionableSetups(
            @RequestParam(defaultValue = "5m") String timeframe,
            @RequestParam(defaultValue = "20") int limit) {

        log.debug("[API] GET /strategy-analysis/actionable timeframe={} limit={}", timeframe, limit);

        List<StrategyStateDTO> setups = strategyStateService.getActionableSetups(
                timeframe, Math.min(limit, 100));

        return ResponseEntity.ok(setups);
    }

    /**
     * Get symbols with high IPU score.
     * GET /api/strategy-analysis/high-ipu?timeframe=5m&minScore=0.7
     */
    @GetMapping("/high-ipu")
    public ResponseEntity<List<String>> getHighIpuSymbols(
            @RequestParam(defaultValue = "5m") String timeframe,
            @RequestParam(defaultValue = "0.7") double minScore) {

        log.debug("[API] GET /strategy-analysis/high-ipu timeframe={} minScore={}", timeframe, minScore);

        List<String> symbols = strategyStateService.getSymbolsWithHighIpu(timeframe, minScore);
        return ResponseEntity.ok(symbols);
    }

    /**
     * Get symbols with active VCP setup.
     * GET /api/strategy-analysis/active-vcp?timeframe=5m
     */
    @GetMapping("/active-vcp")
    public ResponseEntity<List<String>> getActiveVcpSymbols(
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] GET /strategy-analysis/active-vcp timeframe={}", timeframe);

        List<String> symbols = strategyStateService.getSymbolsWithActiveVcp(timeframe);
        return ResponseEntity.ok(symbols);
    }

    /**
     * Get symbols with bullish VCP setup.
     * GET /api/strategy-analysis/bullish-vcp?timeframe=5m
     */
    @GetMapping("/bullish-vcp")
    public ResponseEntity<List<String>> getBullishVcpSymbols(
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] GET /strategy-analysis/bullish-vcp timeframe={}", timeframe);

        List<String> symbols = strategyStateService.getSymbolsWithBullishVcp(timeframe);
        return ResponseEntity.ok(symbols);
    }

    /**
     * Get symbols in uptrend (based on Pivot state).
     * GET /api/strategy-analysis/uptrend?timeframe=5m
     */
    @GetMapping("/uptrend")
    public ResponseEntity<List<String>> getUptrendSymbols(
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] GET /strategy-analysis/uptrend timeframe={}", timeframe);

        List<String> symbols = strategyStateService.getSymbolsInUptrend(timeframe);
        return ResponseEntity.ok(symbols);
    }

    // ==================== METADATA ENDPOINTS ====================

    /**
     * Get available symbols with any strategy state.
     * GET /api/strategy-analysis/available?timeframe=5m
     */
    @GetMapping("/available")
    public ResponseEntity<Set<String>> getAvailableSymbols(
            @RequestParam(defaultValue = "5m") String timeframe) {

        Set<String> symbols = strategyStateService.getAvailableSymbols(timeframe);
        log.debug("[API] GET /strategy-analysis/available timeframe={} count={}", timeframe, symbols.size());
        return ResponseEntity.ok(symbols);
    }

    /**
     * Get state counts by type.
     * GET /api/strategy-analysis/counts?timeframe=5m
     */
    @GetMapping("/counts")
    public ResponseEntity<Map<String, Long>> getStateCounts(
            @RequestParam(defaultValue = "5m") String timeframe) {

        Map<String, Long> counts = strategyStateService.getStateCounts(timeframe);
        log.debug("[API] GET /strategy-analysis/counts timeframe={} {}", timeframe, counts);
        return ResponseEntity.ok(counts);
    }
}
