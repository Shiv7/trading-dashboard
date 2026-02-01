package com.kotsin.dashboard.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * Controller for risk status and circuit breaker control.
 * Proxies requests to the execution module.
 */
@RestController
@RequestMapping("/api/risk")
@RequiredArgsConstructor
@Slf4j
public class RiskStatusController {

    private final RestTemplate restTemplate;

    @Value("${execution.service.url:http://localhost:8081}")
    private String executionServiceUrl;

    /**
     * Get current risk status
     */
    @GetMapping("/status")
    public ResponseEntity<?> getRiskStatus() {
        try {
            String url = executionServiceUrl + "/api/risk/status";
            return ResponseEntity.ok(restTemplate.getForObject(url, Map.class));
        } catch (Exception e) {
            log.error("Failed to get risk status: {}", e.getMessage());
            return ResponseEntity.ok(Map.of(
                    "healthy", true,
                    "status", "UNKNOWN",
                    "message", "Unable to connect to execution service"
            ));
        }
    }

    /**
     * Trip circuit breaker manually
     */
    @PostMapping("/circuit-breaker/trip")
    public ResponseEntity<?> tripCircuitBreaker(
            @RequestParam(defaultValue = "Manual intervention from dashboard") String reason) {
        try {
            String url = executionServiceUrl + "/api/risk/circuit-breaker/trip?reason=" + reason;
            return ResponseEntity.ok(restTemplate.postForObject(url, null, Map.class));
        } catch (Exception e) {
            log.error("Failed to trip circuit breaker: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "message", "Failed to connect to execution service"
            ));
        }
    }

    /**
     * Reset circuit breaker
     */
    @PostMapping("/circuit-breaker/reset")
    public ResponseEntity<?> resetCircuitBreaker() {
        try {
            String url = executionServiceUrl + "/api/risk/circuit-breaker/reset";
            return ResponseEntity.ok(restTemplate.postForObject(url, null, Map.class));
        } catch (Exception e) {
            log.error("Failed to reset circuit breaker: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "message", "Failed to connect to execution service"
            ));
        }
    }
}
