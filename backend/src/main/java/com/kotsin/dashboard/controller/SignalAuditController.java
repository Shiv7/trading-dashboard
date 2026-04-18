package com.kotsin.dashboard.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * Dashboard-side proxy to trade-exec's {@code /api/audit/*} endpoints so the frontend keeps a
 * single API_BASE. Handles upstream failures gracefully (503 with the underlying error message).
 */
@RestController
@RequestMapping("/api/signal-audit")
@CrossOrigin(origins = "*")
@Slf4j
public class SignalAuditController {

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String tradeExecBaseUrl;

    private final RestTemplate http = new RestTemplate();

    @GetMapping("/signal/{signalId}")
    public ResponseEntity<?> getSignal(@PathVariable String signalId) {
        return proxy("/api/audit/signal/" + signalId);
    }

    @GetMapping("/recent")
    public ResponseEntity<?> getRecent(@RequestParam(defaultValue = "100") int limit,
                                        @RequestParam(defaultValue = "1440") int sinceMinutes) {
        return proxy("/api/audit/recent?limit=" + limit + "&sinceMinutes=" + sinceMinutes);
    }

    @GetMapping("/by-scrip/{scripCode}")
    public ResponseEntity<?> getByScrip(@PathVariable String scripCode) {
        return proxy("/api/audit/by-scrip/" + scripCode);
    }

    @GetMapping("/by-strategy/{strategy}")
    public ResponseEntity<?> getByStrategy(@PathVariable String strategy,
                                             @RequestParam(defaultValue = "100") int limit,
                                             @RequestParam(defaultValue = "1440") int sinceMinutes) {
        return proxy("/api/audit/by-strategy/" + strategy
            + "?limit=" + limit + "&sinceMinutes=" + sinceMinutes);
    }

    private ResponseEntity<?> proxy(String path) {
        try {
            return http.getForEntity(tradeExecBaseUrl + path, Object.class);
        } catch (RestClientException e) {
            log.warn("[API] signal-audit proxy failed path={}: {}", path, e.getMessage());
            return ResponseEntity.status(503).body(Map.of(
                "error", "trade-exec unavailable", "detail", e.getMessage()));
        }
    }
}
