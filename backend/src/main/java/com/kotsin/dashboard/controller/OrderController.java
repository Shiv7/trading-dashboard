package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.CreateOrderRequest;
import com.kotsin.dashboard.model.dto.ModifyPositionRequest;
import lombok.RequiredArgsConstructor;
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
 * Proxy controller for virtual order operations.
 * Forwards requests to TradeExecutionModule (port 8089).
 */
@RestController
@RequestMapping("/api/orders")
@Slf4j
public class OrderController {

    private final RestTemplate restTemplate;
    
    @Value("${execution.service.url:http://localhost:8089}")
    private String executionServiceUrl;

    public OrderController(@Qualifier("executionRestTemplate") RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * Create a new virtual order.
     * Proxies to POST /api/virtual/orders on TradeExecutionModule.
     */
    @PostMapping
    public ResponseEntity<?> createOrder(@RequestBody CreateOrderRequest request) {
        log.info("Creating order: scripCode={}, side={}, qty={}", 
                request.getScripCode(), request.getSide(), request.getQty());
        
        try {
            String url = executionServiceUrl + "/api/virtual/orders";
            HttpEntity<CreateOrderRequest> entity = new HttpEntity<>(request, jsonHeaders());
            
            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);
            log.info("Order created successfully: {}", response.getBody());
            return ResponseEntity.status(response.getStatusCode()).body(response.getBody());
            
        } catch (RestClientException e) {
            log.error("Failed to create order: {}", e.getMessage());
            return ResponseEntity.status(500).body(Map.of(
                "error", "Failed to create order",
                "message", e.getMessage()
            ));
        }
    }

    /**
     * Close an existing position.
     * Proxies to POST /api/virtual/close/{scripCode} on TradeExecutionModule.
     */
    @PostMapping("/close/{scripCode}")
    public ResponseEntity<?> closePosition(@PathVariable String scripCode) {
        log.info("Closing position: scripCode={}", scripCode);
        
        try {
            String url = executionServiceUrl + "/api/virtual/close/" + scripCode;
            ResponseEntity<Map> response = restTemplate.postForEntity(url, null, Map.class);
            log.info("Position closed successfully");
            return ResponseEntity.status(response.getStatusCode()).body(response.getBody());
            
        } catch (RestClientException e) {
            log.error("Failed to close position: {}", e.getMessage());
            return ResponseEntity.status(500).body(Map.of(
                "error", "Failed to close position",
                "message", e.getMessage()
            ));
        }
    }

    /**
     * Modify an existing position (SL, TP, trailing stop).
     * Proxies to PATCH /api/virtual/positions/{scripCode} on TradeExecutionModule.
     */
    @PatchMapping("/positions/{scripCode}")
    public ResponseEntity<?> modifyPosition(
            @PathVariable String scripCode,
            @RequestBody ModifyPositionRequest request) {
        log.info("Modifying position: scripCode={}", scripCode);
        
        try {
            String url = executionServiceUrl + "/api/virtual/positions/" + scripCode;
            HttpEntity<ModifyPositionRequest> entity = new HttpEntity<>(request, jsonHeaders());
            
            ResponseEntity<Map> response = restTemplate.exchange(
                url, HttpMethod.PATCH, entity, Map.class);
            log.info("Position modified successfully");
            return ResponseEntity.status(response.getStatusCode()).body(response.getBody());
            
        } catch (RestClientException e) {
            log.error("Failed to modify position: {}", e.getMessage());
            return ResponseEntity.status(500).body(Map.of(
                "error", "Failed to modify position",
                "message", e.getMessage()
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
