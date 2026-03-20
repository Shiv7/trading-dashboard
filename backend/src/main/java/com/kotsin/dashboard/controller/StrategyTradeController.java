package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.OptionSwapAware;
import com.kotsin.dashboard.model.dto.StrategyTradeRequest;
import com.kotsin.dashboard.service.StrategyTradeExecutor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * REST controller for strategy-driven virtual trades.
 * When strategy.execution.enabled=false, proxies all trade requests to 8089.
 * When true, executes locally (legacy behavior for rollback).
 */
@RestController
@RequestMapping("/api/strategy-trades")
@Slf4j
public class StrategyTradeController {

    private final StrategyTradeExecutor strategyTradeExecutor;
    private final List<OptionSwapAware> optionSwapConsumers;
    private final RestTemplate proxyRestTemplate = new RestTemplate();

    @Value("${strategy.execution.enabled:true}")
    private boolean executionEnabled;

    @Value("${trade.execution.url:http://localhost:8089}")
    private String tradeExecutionUrl;

    public StrategyTradeController(StrategyTradeExecutor strategyTradeExecutor,
                                   List<OptionSwapAware> optionSwapConsumers) {
        this.strategyTradeExecutor = strategyTradeExecutor;
        this.optionSwapConsumers = optionSwapConsumers;
    }

    /**
     * Create a new strategy trade (option or futures).
     * When execution is disabled on 8085, proxies to 8089.
     */
    @PostMapping
    @SuppressWarnings("unchecked")
    public ResponseEntity<Map<String, Object>> createTrade(@RequestBody StrategyTradeRequest request) {
        log.info("Strategy trade request: {} {} @ {} qty={} strategy={} proxy={}",
            request.getInstrumentSymbol(), request.getSide(),
            request.getEntryPrice(), request.getQuantity(), request.getStrategy(),
            !executionEnabled);

        Map<String, Object> result;
        if (!executionEnabled) {
            // Proxy to 8089 StrategyTradeExecutor
            try {
                String url = tradeExecutionUrl + "/api/strategy-trades";
                ResponseEntity<Map> response = proxyRestTemplate.postForEntity(url, request, Map.class);
                result = response.getBody() != null ? response.getBody() : Map.of("success", false, "error", "Empty response from 8089");
            } catch (Exception e) {
                log.error("Failed to proxy strategy trade to 8089: {}", e.getMessage());
                result = Map.of("success", false, "error", "Proxy to 8089 failed: " + e.getMessage());
            }
        } else {
            result = strategyTradeExecutor.openTrade(request);
        }

        boolean success = Boolean.TRUE.equals(result.get("success"));

        if (success && "OPTION".equals(request.getInstrumentType()) && request.getUnderlyingScripCode() != null) {
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
     * When execution is disabled, proxies to 8089.
     */
    @PostMapping("/{scripCode}/close")
    @SuppressWarnings("unchecked")
    public ResponseEntity<Map<String, Object>> closeTrade(@PathVariable String scripCode) {
        log.info("Manual close request for scripCode={} proxy={}", scripCode, !executionEnabled);

        Map<String, Object> result;
        if (!executionEnabled) {
            try {
                String url = tradeExecutionUrl + "/api/strategy-trades/" + scripCode + "/close";
                ResponseEntity<Map> response = proxyRestTemplate.postForEntity(url, null, Map.class);
                result = response.getBody() != null ? response.getBody() : Map.of("success", false, "error", "Empty response");
            } catch (Exception e) {
                log.error("Failed to proxy close to 8089: {}", e.getMessage());
                result = Map.of("success", false, "error", "Proxy to 8089 failed: " + e.getMessage());
            }
        } else {
            result = strategyTradeExecutor.closeTrade(scripCode);
        }

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
