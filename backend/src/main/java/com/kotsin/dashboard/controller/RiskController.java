package com.kotsin.dashboard.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.service.RiskAnalyticsService;
import com.kotsin.dashboard.service.RiskAnalyticsService.*;
import com.kotsin.dashboard.service.StrategyNameResolver;
import com.kotsin.dashboard.service.StrategyTradeExecutor;
import com.kotsin.dashboard.service.TradeIntelligenceService;
import com.kotsin.dashboard.service.StrategyTuningService;
import com.kotsin.dashboard.service.ConfigManagementService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.bson.Document;

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

    @Autowired
    private MongoTemplate mongoTemplate;

    private final RiskAnalyticsService riskService;
    private final TradeIntelligenceService tradeIntelligenceService;
    private final StrategyTuningService strategyTuningService;
    private final ConfigManagementService configManagementService;
    private final RestTemplate executionRestTemplate;
    private final RedisTemplate<String, String> redisTemplate;
    private final StrategyTradeExecutor strategyTradeExecutor;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${execution.service.url:http://localhost:8089}")
    private String executionServiceUrl;

    public RiskController(
            RiskAnalyticsService riskService,
            TradeIntelligenceService tradeIntelligenceService,
            StrategyTuningService strategyTuningService,
            ConfigManagementService configManagementService,
            @Qualifier("executionRestTemplate") RestTemplate executionRestTemplate,
            RedisTemplate<String, String> redisTemplate,
            StrategyTradeExecutor strategyTradeExecutor) {
        this.riskService = riskService;
        this.tradeIntelligenceService = tradeIntelligenceService;
        this.strategyTuningService = strategyTuningService;
        this.configManagementService = configManagementService;
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
                    logAuditEvent("CB_TRIP", key, reason, null);
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
                    logAuditEvent("CB_RESET", key, "Manual reset from dashboard", null);
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

        logAuditEvent("FORCE_CLOSE", normalized, "Manual force-close from dashboard", Map.of("closedCount", closed.size()));

        return ResponseEntity.ok(Map.of(
                "success", errors.isEmpty(),
                "strategy", normalized,
                "closed", closed.size(),
                "closedDetails", closed,
                "errors", errors
        ));
    }

    // ─────────────────────────────────────────────
    //  Trade Intelligence (Tab 2)
    // ─────────────────────────────────────────────

    /**
     * Full trade intelligence report — exit distribution, target funnel,
     * R-multiple histogram, time heatmap, loss clusters, correlation, etc.
     */
    @GetMapping("/trade-intelligence")
    public ResponseEntity<?> getTradeIntelligence(
            @RequestParam(required = false) Long from,
            @RequestParam(required = false) Long to,
            @RequestParam(required = false) String strategy,
            @RequestParam(required = false) String exchange) {
        try {
            return ResponseEntity.ok(tradeIntelligenceService.getFullIntelligence(from, to, strategy, exchange));
        } catch (Exception e) {
            log.error("[RISK] Trade intelligence error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─────────────────────────────────────────────
    //  Strategy Tuning (Tab 3)
    // ─────────────────────────────────────────────

    /**
     * Strategy tuning report — SL analysis, target analysis,
     * position sizing, confidence gate with recommendations.
     */
    @GetMapping("/strategy-tuning")
    public ResponseEntity<?> getStrategyTuning(
            @RequestParam(defaultValue = "ALL") String strategy,
            @RequestParam(required = false) Long from,
            @RequestParam(required = false) Long to) {
        try {
            return ResponseEntity.ok(strategyTuningService.getStrategyTuning(strategy, from, to));
        } catch (Exception e) {
            log.error("[RISK] Strategy tuning error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Simulate proposed config changes against historical trade data.
     */
    @PostMapping("/strategy-tuning/simulate")
    public ResponseEntity<?> simulateConfigChange(@RequestBody Map<String, Object> req) {
        try {
            String strategy = (String) req.getOrDefault("strategy", "ALL");
            @SuppressWarnings("unchecked")
            Map<String, String> changes = (Map<String, String>) req.get("changes");
            Long from = req.get("from") != null ? ((Number) req.get("from")).longValue() : null;
            Long to = req.get("to") != null ? ((Number) req.get("to")).longValue() : null;
            return ResponseEntity.ok(strategyTuningService.simulateConfigChange(strategy, changes, from, to));
        } catch (Exception e) {
            log.error("[RISK] Simulation error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─────────────────────────────────────────────
    //  Config Management
    // ─────────────────────────────────────────────

    /**
     * Get current config for a service (filtered to strategy-relevant keys).
     */
    @GetMapping("/config/current")
    public ResponseEntity<?> getCurrentConfig(@RequestParam String service) {
        try {
            return ResponseEntity.ok(configManagementService.getCurrentConfig(service));
        } catch (Exception e) {
            log.error("[RISK] Config read error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Apply config changes to a service's application.properties.
     */
    @PostMapping("/config/apply")
    public ResponseEntity<?> applyConfig(@RequestBody Map<String, Object> req) {
        try {
            String service = (String) req.get("service");
            @SuppressWarnings("unchecked")
            Map<String, String> changes = (Map<String, String>) req.get("changes");
            String reason = (String) req.getOrDefault("reason", "Applied from Risk Command Center");
            return ResponseEntity.ok(configManagementService.applyConfigChanges(service, changes, reason));
        } catch (Exception e) {
            log.error("[RISK] Config apply error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Config change history.
     */
    @GetMapping("/config/history")
    public ResponseEntity<?> getConfigHistory(@RequestParam(defaultValue = "50") int limit) {
        try {
            return ResponseEntity.ok(configManagementService.getConfigHistory(limit));
        } catch (Exception e) {
            log.error("[RISK] Config history error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Rollback a config change.
     */
    @PostMapping("/config/rollback/{changeId}")
    public ResponseEntity<?> rollbackConfig(@PathVariable String changeId) {
        try {
            return ResponseEntity.ok(configManagementService.rollbackConfig(changeId));
        } catch (Exception e) {
            log.error("[RISK] Config rollback error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─────────────────────────────────────────────
    //  Audit Log
    // ─────────────────────────────────────────────

    /**
     * Get audit log entries from MongoDB risk_audit_log collection.
     * @param limit   Max entries to return (default 50).
     * @param strategy Filter by strategy key (optional).
     */
    @GetMapping("/audit-log")
    public ResponseEntity<?> getAuditLog(
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String strategy) {
        try {
            Document query = new Document();
            if (strategy != null && !strategy.isEmpty()) {
                query.append("strategy", strategy);
            }
            List<Document> logs = mongoTemplate.getCollection("risk_audit_log")
                .find(query)
                .sort(new Document("timestamp", -1))
                .limit(limit)
                .into(new ArrayList<>());

            // Convert ObjectId to string for JSON serialization
            List<Map<String, Object>> result = new ArrayList<>();
            for (Document doc : logs) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("id", doc.getObjectId("_id").toHexString());
                entry.put("timestamp", doc.getDate("timestamp"));
                entry.put("action", doc.getString("action"));
                entry.put("strategy", doc.getString("strategy"));
                entry.put("reason", doc.getString("reason"));
                entry.put("details", doc.get("details"));
                entry.put("source", doc.getString("source"));
                result.add(entry);
            }
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("[RISK] Audit log error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────

    /**
     * Log an audit event to MongoDB risk_audit_log collection.
     */
    private void logAuditEvent(String action, String strategy, String reason, Map<String, Object> details) {
        try {
            Document doc = new Document()
                .append("timestamp", new Date())
                .append("action", action)
                .append("strategy", strategy)
                .append("reason", reason)
                .append("details", details != null ? new Document(details) : null)
                .append("source", "DASHBOARD");
            mongoTemplate.getCollection("risk_audit_log").insertOne(doc);
        } catch (Exception e) {
            log.warn("[RISK_AUDIT] Failed to log: {}", e.getMessage());
        }
    }

    /**
     * Resolve strategy param to list of wallet keys.
     * If strategy is null/empty, returns all strategy keys.
     */
    private List<String> resolveStrategyKeys(String strategy) {
        if (strategy == null || strategy.isBlank()) {
            return new ArrayList<>(StrategyNameResolver.ACTIVE_STRATEGY_KEYS);
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
