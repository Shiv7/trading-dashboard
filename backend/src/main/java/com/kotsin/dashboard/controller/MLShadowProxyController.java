package com.kotsin.dashboard.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * Proxy controller for ML Shadow endpoints.
 * Frontend calls dashboard backend (8085), which proxies to:
 *   - Trade Execution (8089) for Bayesian/shadow data
 *   - FastAnalytics (8002) for regime/quality models
 *
 * Uses mlRestTemplate with 120s timeout for training operations.
 */
@Slf4j
@RestController
@RequestMapping("/api/ml")
public class MLShadowProxyController {

    private final RestTemplate mlRestTemplate;
    private final RestTemplate execRestTemplate;

    @Value("${execution.service.url:http://localhost:8089}")
    private String execUrl;

    @Value("${fastanalytics.service.url:http://localhost:8002}")
    private String faUrl;

    public MLShadowProxyController(@Qualifier("mlRestTemplate") RestTemplate mlRestTemplate,
                                    @Qualifier("executionRestTemplate") RestTemplate execRestTemplate) {
        this.mlRestTemplate = mlRestTemplate;
        this.execRestTemplate = execRestTemplate;
    }

    // ========== FastAnalytics proxies (use mlRestTemplate for long timeouts) ==========

    @GetMapping("/regime/info")
    public ResponseEntity<?> regimeInfo() {
        return proxyGet(mlRestTemplate, faUrl + "/api/ml/regime/info");
    }

    @PostMapping("/regime/train")
    public ResponseEntity<?> regimeTrain(@RequestParam(required = false) String exchange,
                                          @RequestParam(defaultValue = "30") int days) {
        String url = faUrl + "/api/ml/regime/train?days=" + days;
        if (exchange != null) url += "&exchange=" + exchange;
        return proxyPost(mlRestTemplate, url);
    }

    @GetMapping("/quality/info")
    public ResponseEntity<?> qualityInfo() {
        return proxyGet(mlRestTemplate, faUrl + "/api/ml/quality/info");
    }

    @PostMapping("/quality/train")
    public ResponseEntity<?> qualityTrain() {
        return proxyPost(mlRestTemplate, faUrl + "/api/ml/quality/train");
    }

    @PostMapping("/reconstruct")
    public ResponseEntity<?> reconstruct() {
        return proxyPost(mlRestTemplate, faUrl + "/api/ml/reconstruct");
    }

    @GetMapping("/training-data/stats")
    public ResponseEntity<?> trainingDataStats() {
        return proxyGet(mlRestTemplate, faUrl + "/api/ml/training-data/stats");
    }

    @GetMapping("/fa-health")
    public ResponseEntity<?> faHealth() {
        return proxyGet(mlRestTemplate, faUrl + "/api/ml/health");
    }

    // ========== Trade Execution proxies ==========

    @GetMapping("/health")
    public ResponseEntity<?> execHealth() {
        return proxyGet(execRestTemplate, execUrl + "/api/ml/health");
    }

    @GetMapping("/bayesian/distributions")
    public ResponseEntity<?> bayesianDistributions() {
        return proxyGet(execRestTemplate, execUrl + "/api/ml/bayesian/distributions");
    }

    @GetMapping("/bayesian/recommend")
    public ResponseEntity<?> bayesianRecommend(@RequestParam String strategy,
                                                @RequestParam(defaultValue = "UNKNOWN") String regime,
                                                @RequestParam(defaultValue = "1.5") double avgWinLossRatio) {
        return proxyGet(execRestTemplate, execUrl + "/api/ml/bayesian/recommend?strategy=" + strategy
                + "&regime=" + regime + "&avgWinLossRatio=" + avgWinLossRatio);
    }

    @PostMapping("/bayesian/init-from-history")
    public ResponseEntity<?> initBayesian() {
        return proxyPost(execRestTemplate, execUrl + "/api/ml/bayesian/init-from-history");
    }

    @GetMapping("/shadow/logs")
    public ResponseEntity<?> shadowLogs(@RequestParam(defaultValue = "50") int limit) {
        try {
            List<?> result = execRestTemplate.getForObject(
                    execUrl + "/api/ml/shadow/logs?limit=" + limit, List.class);
            return ResponseEntity.ok(result != null ? result : List.of());
        } catch (Exception e) {
            log.warn("ML proxy shadow/logs failed: {}", e.getMessage());
            return ResponseEntity.ok(List.of());
        }
    }

    @GetMapping("/shadow/comparison")
    public ResponseEntity<?> shadowComparison(@RequestParam(defaultValue = "100") int limit) {
        return proxyGet(execRestTemplate, execUrl + "/api/ml/shadow/comparison?limit=" + limit);
    }

    @GetMapping("/shadow/daily-report")
    public ResponseEntity<?> dailyReport() {
        return proxyGet(mlRestTemplate, faUrl + "/api/ml/shadow/daily-report");
    }

    // ========== Proxy helpers ==========

    @SuppressWarnings("unchecked")
    private ResponseEntity<?> proxyGet(RestTemplate rt, String url) {
        try {
            Map<String, Object> result = rt.getForObject(url, Map.class);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.warn("ML proxy GET {} failed: {}", url, e.getMessage());
            return ResponseEntity.ok(Map.of("error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    private ResponseEntity<?> proxyPost(RestTemplate rt, String url) {
        try {
            Map<String, Object> result = rt.postForObject(url, null, Map.class);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.warn("ML proxy POST {} failed: {}", url, e.getMessage());
            return ResponseEntity.ok(Map.of("error", e.getMessage()));
        }
    }
}
