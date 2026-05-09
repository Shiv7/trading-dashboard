package com.kotsin.dashboard.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * Proxy for the trade-execution service /api/admin/kafka-lag endpoint so the
 * frontend (port 3001/8085) can poll it without a direct cross-origin hop to
 * 8089. Polled every 30s by the Kafka Lag panel.
 */
@Slf4j
@RestController
@RequestMapping("/api/admin")
@CrossOrigin(origins = "*")
public class KafkaLagProxyController {

    private final RestTemplate execRestTemplate;

    @Value("${execution.service.url:http://localhost:8089}")
    private String execUrl;

    public KafkaLagProxyController(
            @Qualifier("executionRestTemplate") RestTemplate execRestTemplate) {
        this.execRestTemplate = execRestTemplate;
    }

    @GetMapping("/kafka-lag")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> kafkaLag() {
        String url = execUrl + "/api/admin/kafka-lag";
        try {
            List<Map<String, Object>> result = execRestTemplate.getForObject(url, List.class);
            return ResponseEntity.ok(result != null ? result : List.of());
        } catch (Exception e) {
            log.warn("[KAFKA-LAG-PROXY] GET {} failed: {}", url, e.getMessage());
            return ResponseEntity.status(503).body(Map.of(
                "error", "exec-service-unreachable",
                "detail", String.valueOf(e.getMessage())
            ));
        }
    }
}
