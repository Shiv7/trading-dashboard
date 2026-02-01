package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.UnifiedCandleDTO;
import com.kotsin.dashboard.service.UnifiedCandleService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * REST API for unified candles (merged Tick + Orderbook + OI data).
 *
 * This controller provides access to real-time candle data that is
 * merged from three separate data streams stored in Redis:
 * - Tick data (OHLCV, trade classification, volume profile)
 * - Orderbook data (OFI, depth, spread metrics)
 * - Open Interest data (OI changes, interpretation)
 *
 * Endpoints:
 * - GET  /api/candles/{symbol}?timeframe=5m           - Get latest unified candle
 * - GET  /api/candles/{symbol}/history?timeframe=5m   - Get candle history
 * - POST /api/candles/batch?timeframe=5m              - Get batch candles
 * - GET  /api/candles/available?timeframe=5m          - Get available symbols
 * - GET  /api/candles/stats                           - Get cache statistics
 */
@RestController
@RequestMapping("/api/candles")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class UnifiedCandleController {

    private final UnifiedCandleService unifiedCandleService;

    /**
     * Get latest unified candle for a symbol.
     * GET /api/candles/{symbol}?timeframe=5m
     */
    @GetMapping("/{symbol}")
    public ResponseEntity<UnifiedCandleDTO> getLatestCandle(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] GET /candles/{} timeframe={}", symbol, timeframe);

        return unifiedCandleService.getLatestCandle(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> {
                    log.debug("No candle data found for {}/{}", symbol, timeframe);
                    return ResponseEntity.notFound().build();
                });
    }

    /**
     * Get candle history for a symbol.
     * GET /api/candles/{symbol}/history?timeframe=5m&limit=100
     */
    @GetMapping("/{symbol}/history")
    public ResponseEntity<List<UnifiedCandleDTO>> getCandleHistory(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe,
            @RequestParam(defaultValue = "100") int limit) {

        log.debug("[API] GET /candles/{}/history timeframe={} limit={}", symbol, timeframe, limit);

        List<UnifiedCandleDTO> history = unifiedCandleService.getCandleHistory(
                symbol, timeframe, Math.min(limit, 500));

        if (history.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(history);
    }

    /**
     * Get latest candles for multiple symbols.
     * POST /api/candles/batch?timeframe=5m
     * Body: ["NIFTY", "BANKNIFTY", "RELIANCE"]
     */
    @PostMapping("/batch")
    public ResponseEntity<Map<String, UnifiedCandleDTO>> getBatchCandles(
            @RequestBody List<String> symbols,
            @RequestParam(defaultValue = "5m") String timeframe) {

        log.debug("[API] POST /candles/batch timeframe={} symbols={}", timeframe, symbols.size());

        if (symbols == null || symbols.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        // Limit batch size
        if (symbols.size() > 100) {
            symbols = symbols.subList(0, 100);
        }

        Map<String, UnifiedCandleDTO> result = unifiedCandleService.getBatchCandles(symbols, timeframe);
        return ResponseEntity.ok(result);
    }

    /**
     * Get all available symbols with candle data.
     * GET /api/candles/available?timeframe=5m
     */
    @GetMapping("/available")
    public ResponseEntity<Set<String>> getAvailableSymbols(
            @RequestParam(defaultValue = "5m") String timeframe) {

        Set<String> symbols = unifiedCandleService.getAvailableSymbols(timeframe);
        log.debug("[API] GET /candles/available timeframe={} count={}", timeframe, symbols.size());
        return ResponseEntity.ok(symbols);
    }

    /**
     * Check if data exists for a symbol.
     * GET /api/candles/{symbol}/exists?timeframe=5m
     */
    @GetMapping("/{symbol}/exists")
    public ResponseEntity<Map<String, Object>> hasData(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {

        boolean exists = unifiedCandleService.hasData(symbol, timeframe);
        return ResponseEntity.ok(Map.of(
                "symbol", symbol,
                "timeframe", timeframe,
                "exists", exists
        ));
    }

    /**
     * Get cache statistics.
     * GET /api/candles/stats
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats() {
        Map<String, Object> stats = unifiedCandleService.getStats();
        log.debug("[API] GET /candles/stats {}", stats);
        return ResponseEntity.ok(stats);
    }
}
