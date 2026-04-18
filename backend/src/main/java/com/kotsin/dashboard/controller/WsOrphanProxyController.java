package com.kotsin.dashboard.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * Proxies /api/ws-audit/* to trade-exec's /api/ws-orphans/*. Keeps frontend on single API_BASE.
 * Returns 503 with detail on upstream failure so the frontend /ws-audit page can render a
 * clean ERR badge without breaking.
 */
@RestController
@RequestMapping("/api/ws-audit")
@CrossOrigin(origins = "*")
@Slf4j
public class WsOrphanProxyController {

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String tradeExecBaseUrl;

    private final RestTemplate http = new RestTemplate();

    @GetMapping("/active")
    public ResponseEntity<?> active() { return proxy("/api/ws-orphans/active"); }

    @GetMapping("/history")
    public ResponseEntity<?> history(@RequestParam(defaultValue = "100") int limit,
                                      @RequestParam(defaultValue = "1440") int sinceMinutes) {
        return proxy("/api/ws-orphans/history?limit=" + limit + "&sinceMinutes=" + sinceMinutes);
    }

    @GetMapping("/stats")
    public ResponseEntity<?> stats() { return proxy("/api/ws-orphans/stats"); }

    @GetMapping("/by-scrip/{scripCode}")
    public ResponseEntity<?> byScrip(@PathVariable String scripCode) {
        return proxy("/api/ws-orphans/by-scrip/" + scripCode);
    }

    @GetMapping("/state/{scripCode}")
    public ResponseEntity<?> state(@PathVariable String scripCode) {
        return proxy("/api/ws-orphans/state/" + scripCode);
    }

    private ResponseEntity<?> proxy(String path) {
        try {
            return http.getForEntity(tradeExecBaseUrl + path, Object.class);
        } catch (RestClientException e) {
            log.warn("[API] ws-audit proxy failed path={}: {}", path, e.getMessage());
            return ResponseEntity.status(503).body(Map.of(
                "error", "trade-exec unavailable", "detail", e.getMessage()));
        }
    }
}
