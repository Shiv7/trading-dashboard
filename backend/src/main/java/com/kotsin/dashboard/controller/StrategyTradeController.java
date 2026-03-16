package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.OptionSwapAware;
import com.kotsin.dashboard.model.dto.StrategyTradeRequest;
import com.kotsin.dashboard.service.StrategyTradeExecutor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST controller for strategy-driven virtual trades.
 * Handles trade creation, monitoring queries, and manual close.
 *
 * After a successful option trade, notifies all OptionSwapAware consumers
 * so the frontend CTA reflects the actual traded instrument (post-OTM swap).
 */
@RestController
@RequestMapping("/api/strategy-trades")
@Slf4j
public class StrategyTradeController {

    private final StrategyTradeExecutor strategyTradeExecutor;
    private final List<OptionSwapAware> optionSwapConsumers;

    public StrategyTradeController(StrategyTradeExecutor strategyTradeExecutor,
                                   List<OptionSwapAware> optionSwapConsumers) {
        this.strategyTradeExecutor = strategyTradeExecutor;
        this.optionSwapConsumers = optionSwapConsumers;
    }

    /**
     * Create a new strategy trade (option or futures).
     * Called by trade execution module (AUTO) or user CTA click (MANUAL).
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> createTrade(@RequestBody StrategyTradeRequest request) {
        log.info("Strategy trade request: {} {} @ {} qty={} strategy={}",
            request.getInstrumentSymbol(), request.getSide(),
            request.getEntryPrice(), request.getQuantity(), request.getStrategy());

        Map<String, Object> result = strategyTradeExecutor.openTrade(request);
        boolean success = Boolean.TRUE.equals(result.get("success"));

        if (success && "OPTION".equals(request.getInstrumentType()) && request.getUnderlyingScripCode() != null) {
            // Notify all strategy consumers to update their cached signal option data.
            // This ensures the frontend CTA shows the actual traded option (post-OTM swap),
            // not the pre-swap ITM option from the original Kafka signal.
            notifyOptionSwap(request);
        }

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

    private void notifyOptionSwap(StrategyTradeRequest req) {
        try {
            for (OptionSwapAware consumer : optionSwapConsumers) {
                consumer.updateTradedOption(
                    req.getUnderlyingScripCode(),
                    req.getStrategy(),
                    req.getScripCode(),
                    req.getInstrumentSymbol(),
                    req.getStrike(),
                    req.getEntryPrice(),
                    req.getOptionType()
                );
            }
        } catch (Exception e) {
            log.warn("Failed to notify option swap consumers: {}", e.getMessage());
        }
    }
}
