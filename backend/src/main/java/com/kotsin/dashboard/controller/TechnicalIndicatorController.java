package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.TechnicalIndicatorDTO;
import com.kotsin.dashboard.service.TechnicalIndicatorService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * REST API for technical indicators (Bollinger Bands, VWAP, SuperTrend).
 * Replaces the external streaming candle service (port 8081).
 *
 * Endpoints:
 * - GET  /api/technical-indicators/{scripCode}?timeframe=5m
 * - GET  /api/technical-indicators/{scripCode}/history?timeframe=5m&limit=100
 * - POST /api/technical-indicators/batch?timeframe=5m
 * - GET  /api/technical-indicators/available?timeframe=5m
 * - GET  /api/technical-indicators/stats
 */
@RestController
@RequestMapping("/api/technical-indicators")
@RequiredArgsConstructor
@Slf4j
public class TechnicalIndicatorController {

    private final TechnicalIndicatorService technicalIndicatorService;

    /**
     * Get all available technical indicators (latest for each scripCode).
     * GET /api/technical-indicators?timeframe=5m
     */
    @GetMapping
    public ResponseEntity<Map<String, TechnicalIndicatorDTO>> getAllIndicators(
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting all technical indicators for timeframe={}", timeframe);

        Map<String, TechnicalIndicatorDTO> result = technicalIndicatorService.getAllIndicators(timeframe);
        return ResponseEntity.ok(result);
    }

    /**
     * Get current technical indicators for a single stock.
     * GET /api/technical-indicators/{scripCode}?timeframe=5m
     */
    @GetMapping("/{scripCode}")
    public ResponseEntity<TechnicalIndicatorDTO> getIndicators(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting technical indicators for {}/{}", scripCode, timeframe);

        return technicalIndicatorService.getIndicators(scripCode, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> {
                    log.warn("No indicator data found for {}/{}", scripCode, timeframe);
                    return ResponseEntity.notFound().build();
                });
    }

    /**
     * Get indicator history for chart overlays.
     * GET /api/technical-indicators/{scripCode}/history?timeframe=5m&limit=100
     */
    @GetMapping("/{scripCode}/history")
    public ResponseEntity<List<TechnicalIndicatorDTO>> getIndicatorHistory(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "5m") String timeframe,
            @RequestParam(defaultValue = "100") int limit) {

        log.debug("Getting indicator history for {}/{}, limit={}", scripCode, timeframe, limit);

        List<TechnicalIndicatorDTO> history = technicalIndicatorService.getIndicatorHistory(
                scripCode, timeframe, Math.min(limit, 200));

        if (history.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(history);
    }

    /**
     * Get indicators for multiple stocks in a single request.
     * POST /api/technical-indicators/batch?timeframe=5m
     * Body: ["INFY", "RELIANCE", "TCS"]
     */
    @PostMapping("/batch")
    public ResponseEntity<Map<String, TechnicalIndicatorDTO>> getBatchIndicators(
            @RequestBody List<String> scripCodes,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting batch indicators for {} stocks, timeframe={}", scripCodes.size(), timeframe);

        if (scripCodes == null || scripCodes.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        // Limit batch size
        if (scripCodes.size() > 100) {
            scripCodes = scripCodes.subList(0, 100);
        }

        Map<String, TechnicalIndicatorDTO> result = technicalIndicatorService.getBatchIndicators(
                scripCodes, timeframe);

        return ResponseEntity.ok(result);
    }

    /**
     * Get list of all scripCodes that have indicator data available.
     * GET /api/technical-indicators/available?timeframe=5m
     */
    @GetMapping("/available")
    public ResponseEntity<Set<String>> getAvailableScrips(
            @RequestParam(defaultValue = "5m") String timeframe) {

        Set<String> available = technicalIndicatorService.getAvailableScripCodes(timeframe);
        return ResponseEntity.ok(available);
    }

    /**
     * Get cache statistics.
     * GET /api/technical-indicators/stats
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getCacheStats() {
        Map<String, Object> stats = technicalIndicatorService.getStats();
        return ResponseEntity.ok(stats);
    }

    // ==================== SPECIALIZED INDICATOR ENDPOINTS ====================

    /**
     * Get moving averages for a scripCode.
     * GET /api/technical-indicators/{scripCode}/moving-averages?timeframe=5m
     */
    @GetMapping("/{scripCode}/moving-averages")
    public ResponseEntity<Map<String, Object>> getMovingAverages(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting moving averages for {}/{}", scripCode, timeframe);

        return technicalIndicatorService.getMovingAverages(scripCode, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get momentum indicators for a scripCode.
     * GET /api/technical-indicators/{scripCode}/momentum?timeframe=5m
     */
    @GetMapping("/{scripCode}/momentum")
    public ResponseEntity<Map<String, Object>> getMomentumIndicators(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting momentum indicators for {}/{}", scripCode, timeframe);

        return technicalIndicatorService.getMomentumIndicators(scripCode, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get trend indicators for a scripCode.
     * GET /api/technical-indicators/{scripCode}/trend?timeframe=5m
     */
    @GetMapping("/{scripCode}/trend")
    public ResponseEntity<Map<String, Object>> getTrendIndicators(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting trend indicators for {}/{}", scripCode, timeframe);

        return technicalIndicatorService.getTrendIndicators(scripCode, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get pivot points for a scripCode.
     * GET /api/technical-indicators/{scripCode}/pivots?timeframe=5m
     */
    @GetMapping("/{scripCode}/pivots")
    public ResponseEntity<Map<String, Object>> getPivotPoints(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting pivot points for {}/{}", scripCode, timeframe);

        return technicalIndicatorService.getPivotPoints(scripCode, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get composite signal for a scripCode.
     * GET /api/technical-indicators/{scripCode}/signal?timeframe=5m
     */
    @GetMapping("/{scripCode}/signal")
    public ResponseEntity<Map<String, Object>> getCompositeSignal(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting composite signal for {}/{}", scripCode, timeframe);

        return technicalIndicatorService.getCompositeSignal(scripCode, timeframe)
                .map(signal -> ResponseEntity.ok(Map.of(
                        "scripCode", (Object) scripCode,
                        "timeframe", timeframe,
                        "signal", signal
                )))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    // ==================== SCREENING ENDPOINTS ====================

    /**
     * Get scripCodes with bullish setups.
     * GET /api/technical-indicators/screen/bullish?timeframe=5m
     */
    @GetMapping("/screen/bullish")
    public ResponseEntity<List<String>> getBullishSetups(
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting bullish setups for timeframe={}", timeframe);

        List<String> bullish = technicalIndicatorService.getBullishSetups(timeframe);
        return ResponseEntity.ok(bullish);
    }

    /**
     * Get scripCodes with bearish setups.
     * GET /api/technical-indicators/screen/bearish?timeframe=5m
     */
    @GetMapping("/screen/bearish")
    public ResponseEntity<List<String>> getBearishSetups(
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("Getting bearish setups for timeframe={}", timeframe);

        List<String> bearish = technicalIndicatorService.getBearishSetups(timeframe);
        return ResponseEntity.ok(bearish);
    }

    /**
     * Get scripCodes in strong trend.
     * GET /api/technical-indicators/screen/trending?timeframe=5m&minAdx=25
     */
    @GetMapping("/screen/trending")
    public ResponseEntity<List<String>> getTrendingSymbols(
            @RequestParam(defaultValue = "5m") String timeframe,
            @RequestParam(defaultValue = "25") double minAdx) {

        log.debug("Getting trending symbols for timeframe={} minAdx={}", timeframe, minAdx);

        List<String> trending = technicalIndicatorService.getTrendingSymbols(timeframe, minAdx);
        return ResponseEntity.ok(trending);
    }

    /**
     * Get scripCodes with high volume.
     * GET /api/technical-indicators/screen/high-volume?timeframe=5m&minRatio=1.5
     */
    @GetMapping("/screen/high-volume")
    public ResponseEntity<List<String>> getHighVolumeSymbols(
            @RequestParam(defaultValue = "5m") String timeframe,
            @RequestParam(defaultValue = "1.5") double minRatio) {

        log.debug("Getting high volume symbols for timeframe={} minRatio={}", timeframe, minRatio);

        List<String> highVolume = technicalIndicatorService.getHighVolumeSymbols(timeframe, minRatio);
        return ResponseEntity.ok(highVolume);
    }
}
