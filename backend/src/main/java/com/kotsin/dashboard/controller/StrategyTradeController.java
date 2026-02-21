package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.StrategyTradeRequest;
import com.kotsin.dashboard.service.StrategyTradeExecutor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST controller for strategy-driven virtual trades.
 * Handles trade creation, monitoring queries, and manual close.
 */
@RestController
@RequestMapping("/api/strategy-trades")
@Slf4j
@RequiredArgsConstructor
public class StrategyTradeController {

    private final StrategyTradeExecutor strategyTradeExecutor;

    /**
     * Create a new strategy trade (option or futures).
     * Called when user clicks the BUY CTA on a strategy card.
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> createTrade(@RequestBody StrategyTradeRequest request) {
        log.info("Strategy trade request: {} {} @ {} qty={} strategy={}",
            request.getInstrumentSymbol(), request.getSide(),
            request.getEntryPrice(), request.getQuantity(), request.getStrategy());

        Map<String, Object> result = strategyTradeExecutor.openTrade(request);
        boolean success = Boolean.TRUE.equals(result.get("success"));
        return success ? ResponseEntity.ok(result) : ResponseEntity.badRequest().body(result);
    }

    /**
     * Get all active strategy positions.
     */
    @GetMapping("/active")
    public ResponseEntity<List<Map<String, Object>>> getActiveTrades() {
        return ResponseEntity.ok(strategyTradeExecutor.getActiveStrategyTrades());
    }

    /**
     * Manual close of a strategy position.
     */
    @PostMapping("/{scripCode}/close")
    public ResponseEntity<Map<String, Object>> closeTrade(@PathVariable String scripCode) {
        log.info("Manual close request for scripCode={}", scripCode);
        Map<String, Object> result = strategyTradeExecutor.closeTrade(scripCode);
        boolean success = Boolean.TRUE.equals(result.get("success"));
        return success ? ResponseEntity.ok(result) : ResponseEntity.badRequest().body(result);
    }
}
