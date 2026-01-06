package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.CreateOrderRequest;
import com.kotsin.dashboard.model.dto.ModifyPositionRequest;
import com.kotsin.dashboard.service.TradingModeService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * Proxy controller for order operations.
 * Routes to either virtual or live trading based on TradingModeService.
 */
@RestController
@RequestMapping("/api/orders")
@Slf4j
public class OrderController {

    private final RestTemplate restTemplate;
    private final TradingModeService tradingModeService;

    @Value("${execution.service.url:http://localhost:8089}")
    private String executionServiceUrl;

    public OrderController(
            @Qualifier("executionRestTemplate") RestTemplate restTemplate,
            TradingModeService tradingModeService) {
        this.restTemplate = restTemplate;
        this.tradingModeService = tradingModeService;
    }

    /**
     * Create a new order.
     * Routes to virtual or live trading based on current mode.
     */
    @PostMapping
    public ResponseEntity<?> createOrder(@RequestBody CreateOrderRequest request) {
        boolean isLive = tradingModeService.isLive();
        String modeLabel = isLive ? "LIVE" : "VIRTUAL";

        log.info("[{}] Creating order: scripCode={}, side={}, qty={}",
                modeLabel, request.getScripCode(), request.getSide(), request.getQty());

        try {
            String apiPath = tradingModeService.getApiPathPrefix();
            String url = executionServiceUrl + apiPath + "/orders";

            HttpEntity<CreateOrderRequest> entity = new HttpEntity<>(request, jsonHeaders());

            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);
            log.info("[{}] Order created successfully: {}", modeLabel, response.getBody());

            // Add mode info to response
            Map<String, Object> body = new java.util.HashMap<>(response.getBody() != null ? response.getBody() : Map.of());
            body.put("tradingMode", modeLabel);
            body.put("isLive", isLive);

            return ResponseEntity.status(response.getStatusCode()).body(body);

        } catch (RestClientException e) {
            log.error("[{}] Failed to create order: {}", modeLabel, e.getMessage());
            return ResponseEntity.status(500).body(Map.of(
                "error", "Failed to create order",
                "message", e.getMessage(),
                "tradingMode", modeLabel
            ));
        }
    }

    /**
     * Close an existing position.
     * Routes to virtual or live trading based on current mode.
     */
    @PostMapping("/close/{scripCode}")
    public ResponseEntity<?> closePosition(@PathVariable String scripCode) {
        boolean isLive = tradingModeService.isLive();
        String modeLabel = isLive ? "LIVE" : "VIRTUAL";

        log.info("[{}] Closing position: scripCode={}", modeLabel, scripCode);

        try {
            String apiPath = tradingModeService.getApiPathPrefix();
            String url = executionServiceUrl + apiPath + "/close/" + scripCode;

            ResponseEntity<Map> response = restTemplate.postForEntity(url, null, Map.class);
            log.info("[{}] Position closed successfully", modeLabel);

            Map<String, Object> body = new java.util.HashMap<>(response.getBody() != null ? response.getBody() : Map.of());
            body.put("tradingMode", modeLabel);

            return ResponseEntity.status(response.getStatusCode()).body(body);

        } catch (RestClientException e) {
            log.error("[{}] Failed to close position: {}", modeLabel, e.getMessage());
            return ResponseEntity.status(500).body(Map.of(
                "error", "Failed to close position",
                "message", e.getMessage(),
                "tradingMode", modeLabel
            ));
        }
    }

    /**
     * Modify an existing position (SL, TP, trailing stop).
     * Routes to virtual or live trading based on current mode.
     */
    @PatchMapping("/positions/{scripCode}")
    public ResponseEntity<?> modifyPosition(
            @PathVariable String scripCode,
            @RequestBody ModifyPositionRequest request) {
        boolean isLive = tradingModeService.isLive();
        String modeLabel = isLive ? "LIVE" : "VIRTUAL";

        log.info("[{}] Modifying position: scripCode={}", modeLabel, scripCode);

        try {
            String apiPath = tradingModeService.getApiPathPrefix();
            String url = executionServiceUrl + apiPath + "/positions/" + scripCode;

            HttpEntity<ModifyPositionRequest> entity = new HttpEntity<>(request, jsonHeaders());

            ResponseEntity<Map> response = restTemplate.exchange(
                url, HttpMethod.PATCH, entity, Map.class);
            log.info("[{}] Position modified successfully", modeLabel);

            Map<String, Object> body = new java.util.HashMap<>(response.getBody() != null ? response.getBody() : Map.of());
            body.put("tradingMode", modeLabel);

            return ResponseEntity.status(response.getStatusCode()).body(body);

        } catch (RestClientException e) {
            log.error("[{}] Failed to modify position: {}", modeLabel, e.getMessage());
            return ResponseEntity.status(500).body(Map.of(
                "error", "Failed to modify position",
                "message", e.getMessage(),
                "tradingMode", modeLabel
            ));
        }
    }

    /**
     * Health check for execution service connectivity.
     */
    @GetMapping("/health")
    public ResponseEntity<?> healthCheck() {
        try {
            String url = executionServiceUrl + "/api/virtual/health";
            ResponseEntity<Map> response = restTemplate.getForEntity(url, Map.class);
            return ResponseEntity.ok(Map.of(
                "status", "UP",
                "executionService", response.getBody()
            ));
        } catch (RestClientException e) {
            return ResponseEntity.ok(Map.of(
                "status", "DEGRADED",
                "error", "Execution service unavailable: " + e.getMessage()
            ));
        }
    }

    private HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}
