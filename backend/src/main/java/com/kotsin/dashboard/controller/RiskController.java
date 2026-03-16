package com.kotsin.dashboard.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.service.RiskAnalyticsService;
import com.kotsin.dashboard.service.RiskAnalyticsService.*;
import com.kotsin.dashboard.service.StrategyNameResolver;
import com.kotsin.dashboard.service.StrategyTradeExecutor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.*;

/**
 * RiskController - REST endpoints for portfolio risk analytics,
 * circuit breaker control, and force-close operations.
 *
 * Merges analytics (RiskAnalyticsService) with execution-module proxying
 * and direct Redis wallet manipulation for per-strategy circuit breakers.
 */
@RestController
@RequestMapping("/api/risk")
@Slf4j
@CrossOrigin(origins = "*")
public class RiskController {

    private final RiskAnalyticsService riskService;
    private final RestTemplate executionRestTemplate;
    private final RedisTemplate<String, String> redisTemplate;
    private final StrategyTradeExecutor strategyTradeExecutor;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${execution.service.url:http://localhost:8089}")
    private String executionServiceUrl;

    public RiskController(
            RiskAnalyticsService riskService,
            @Qualifier("executionRestTemplate") RestTemplate executionRestTemplate,
            RedisTemplate<String, String> redisTemplate,
            StrategyTradeExecutor strategyTradeExecutor) {
        this.riskService = riskService;
        this.executionRestTemplate = executionRestTemplate;
        this.redisTemplate = redisTemplate;
        this.strategyTradeExecutor = strategyTradeExecutor;
    }

    // ─────────────────────────────────────────────
    //  Analytics endpoints (from original RiskController)
    // ─────────────────────────────────────────────

    /**
     * Full portfolio risk summary (all strategies + alerts).
     */
    @GetMapping
    public ResponseEntity<PortfolioRiskSummary> getPortfolioRisk() {
        return ResponseEntity.ok(riskService.getPortfolioRisk());
    }

    /**
     * Risk profile for a single strategy.
     */
    @GetMapping("/strategy/{strategyKey}")
    public ResponseEntity<StrategyRiskProfile> getStrategyRisk(@PathVariable String strategyKey) {
        return ResponseEntity.ok(riskService.getStrategyRisk(strategyKey));
    }

    /**
     * Drawdown history for a strategy.
     * @param strategy Strategy key (e.g., FUKAA, FUDKII)
     * @param period   TODAY, WEEK, MONTH, ALL (default: ALL)
     */
    @GetMapping("/drawdown/{strategy}")
    public ResponseEntity<List<DrawdownPoint>> getDrawdownHistory(
            @PathVariable String strategy,
            @RequestParam(defaultValue = "ALL") String period) {
        return ResponseEntity.ok(riskService.getDrawdownHistory(strategy, period));
    }

    /**
     * Risk alerts only (sorted by severity).
     */
    @GetMapping("/alerts")
    public ResponseEntity<List<RiskAlert>> getAlerts() {
        PortfolioRiskSummary summary = riskService.getPortfolioRisk();
        return ResponseEntity.ok(summary.getAlerts());
    }

    // ─────────────────────────────────────────────
    //  Execution-module proxy (from RiskStatusController)
    // ─────────────────────────────────────────────

    /**
     * Get current risk status from execution module.
     */
    @GetMapping("/status")
    public ResponseEntity<?> getRiskStatus() {
        try {
            String url = executionServiceUrl + "/api/risk/status";
            return ResponseEntity.ok(executionRestTemplate.getForObject(url, Map.class));
        } catch (Exception e) {
            log.error("Failed to get risk status: {}", e.getMessage());
            return ResponseEntity.ok(Map.of(
                    "healthy", false,
                    "status", "DOWN",
                    "message", "Unable to connect to execution service: " + e.getMessage()
            ));
        }
    }

    // ─────────────────────────────────────────────
    //  Per-strategy circuit breaker (direct Redis)
    // ─────────────────────────────────────────────

    /**
     * Trip circuit breaker for a strategy wallet.
     * @param strategy Strategy key (FUKAA, FUDKII, etc.). If omitted, trips all.
     * @param reason   Reason for tripping (default: manual intervention).
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/circuit-breaker/trip")
    public ResponseEntity<?> tripCircuitBreaker(
            @RequestParam(required = false) String strategy,
            @RequestParam(defaultValue = "Manual intervention from dashboard") String reason) {
        try {
            List<String> keys = resolveStrategyKeys(strategy);
            List<String> tripped = new ArrayList<>();
            List<String> failed = new ArrayList<>();

            for (String key : keys) {
                try {
                    setCircuitBreaker(key, true, reason);
                    tripped.add(key);
                } catch (Exception e) {
                    log.error("Failed to trip circuit breaker for {}: {}", key, e.getMessage());
                    failed.add(key);
                }
            }

            return ResponseEntity.ok(Map.of(
                    "success", failed.isEmpty(),
                    "tripped", tripped,
                    "failed", failed,
                    "reason", reason
            ));
        } catch (Exception e) {
            log.error("Failed to trip circuit breaker: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        }
    }

    /**
     * Reset circuit breaker for a strategy wallet.
     * @param strategy Strategy key (FUKAA, FUDKII, etc.). If omitted, resets all.
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/circuit-breaker/reset")
    public ResponseEntity<?> resetCircuitBreaker(
            @RequestParam(required = false) String strategy) {
        try {
            List<String> keys = resolveStrategyKeys(strategy);
            List<String> reset = new ArrayList<>();
            List<String> failed = new ArrayList<>();

            for (String key : keys) {
                try {
                    setCircuitBreaker(key, false, null);
                    reset.add(key);
                } catch (Exception e) {
                    log.error("Failed to reset circuit breaker for {}: {}", key, e.getMessage());
                    failed.add(key);
                }
            }

            return ResponseEntity.ok(Map.of(
                    "success", failed.isEmpty(),
                    "reset", reset,
                    "failed", failed
            ));
        } catch (Exception e) {
            log.error("Failed to reset circuit breaker: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        }
    }

    // ─────────────────────────────────────────────
    //  Force-close all positions for a strategy
    // ─────────────────────────────────────────────

    /**
     * Force-close all open positions for a strategy.
     * Iterates active strategy:targets:* keys, filters by strategy, and calls closeTrade().
     * @param strategy Strategy key (FUKAA, FUDKII, etc.) — required.
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/force-close")
    public ResponseEntity<?> forceCloseStrategy(@RequestParam String strategy) {
        String normalized = StrategyNameResolver.normalize(strategy);
        if ("MANUAL".equals(normalized) && !"MANUAL".equalsIgnoreCase(strategy)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "Unknown strategy: " + strategy
            ));
        }

        log.info("[RISK] Force-close requested for strategy {}", normalized);

        List<Map<String, Object>> closed = new ArrayList<>();
        List<Map<String, Object>> errors = new ArrayList<>();

        try {
            Set<String> targetKeys = redisTemplate.keys("strategy:targets:*");
            if (targetKeys == null || targetKeys.isEmpty()) {
                return ResponseEntity.ok(Map.of(
                        "success", true,
                        "strategy", normalized,
                        "message", "No active positions found",
                        "closed", 0
                ));
            }

            for (String targetKey : targetKeys) {
                try {
                    String json = redisTemplate.opsForValue().get(targetKey);
                    if (json == null) continue;

                    Map<String, Object> targets = objectMapper.readValue(json, Map.class);
                    String posStrategy = (String) targets.get("strategy");
                    String posNorm = StrategyNameResolver.normalize(posStrategy);

                    if (!normalized.equals(posNorm)) continue;

                    int remainingQty = targets.get("remainingQty") != null
                            ? ((Number) targets.get("remainingQty")).intValue() : 0;
                    if (remainingQty <= 0) continue;

                    String scripCode = (String) targets.get("scripCode");
                    Map<String, Object> result = strategyTradeExecutor.closeTrade(scripCode);
                    if (Boolean.TRUE.equals(result.get("success"))) {
                        closed.add(result);
                        log.info("[RISK] Force-closed {} for {}", scripCode, normalized);
                    } else {
                        errors.add(result);
                        log.warn("[RISK] Failed to force-close {} for {}: {}",
                                scripCode, normalized, result.get("error"));
                    }
                } catch (Exception e) {
                    errors.add(Map.of("targetKey", targetKey, "error", e.getMessage()));
                }
            }
        } catch (Exception e) {
            log.error("[RISK] Force-close error for {}: {}", normalized, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "error", e.getMessage()
            ));
        }

        return ResponseEntity.ok(Map.of(
                "success", errors.isEmpty(),
                "strategy", normalized,
                "closed", closed.size(),
                "closedDetails", closed,
                "errors", errors
        ));
    }

    // ─────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────

    /**
     * Resolve strategy param to list of wallet keys.
     * If strategy is null/empty, returns all strategy keys.
     */
    private List<String> resolveStrategyKeys(String strategy) {
        if (strategy == null || strategy.isBlank()) {
            return new ArrayList<>(StrategyNameResolver.ALL_STRATEGY_KEYS);
        }
        String normalized = StrategyNameResolver.normalize(strategy);
        return List.of(normalized);
    }

    /**
     * Set circuit breaker state directly in Redis wallet JSON.
     * Reads wallet:entity:strategy-wallet-{KEY}, updates circuitBreakerTripped
     * and circuitBreakerReason, writes back.
     */
    @SuppressWarnings("unchecked")
    private void setCircuitBreaker(String strategyKey, boolean tripped, String reason) {
        String walletKey = "wallet:entity:strategy-wallet-" + strategyKey;
        String json = redisTemplate.opsForValue().get(walletKey);
        if (json == null) {
            throw new IllegalStateException("Wallet not found in Redis: " + walletKey);
        }

        try {
            Map<String, Object> wallet = objectMapper.readValue(json, Map.class);
            wallet.put("circuitBreakerTripped", tripped);
            wallet.put("circuitBreakerReason", tripped ? reason : null);
            String updatedJson = objectMapper.writeValueAsString(wallet);
            redisTemplate.opsForValue().set(walletKey, updatedJson);
            log.info("[RISK] Circuit breaker {} for {} (reason: {})",
                    tripped ? "TRIPPED" : "RESET", strategyKey, reason);
        } catch (Exception e) {
            throw new RuntimeException("Failed to update wallet " + walletKey + ": " + e.getMessage(), e);
        }
    }
}
