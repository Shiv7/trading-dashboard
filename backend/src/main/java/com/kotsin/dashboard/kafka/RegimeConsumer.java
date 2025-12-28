package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.RegimeDTO;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * Kafka consumer for regime updates.
 * Broadcasts index and security regime changes to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class RegimeConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @KafkaListener(topics = "regime-index-output", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onIndexRegime(String payload) {
        try {
            log.info("Received regime update from Kafka");
            JsonNode root = objectMapper.readTree(payload);
            
            RegimeDTO dto = parseRegime(root);
            
            // Broadcast regime update
            sessionManager.broadcastRegimeUpdate(dto);
            
            log.info("Index regime update broadcasted: {} - {} (strength={})", 
                dto.getIndexName(), dto.getLabel(), dto.getRegimeStrength());

        } catch (Exception e) {
            log.error("Error processing regime: {}", e.getMessage(), e);
        }
    }

    private RegimeDTO parseRegime(JsonNode root) {
        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        
        // Parse timeframe components
        JsonNode tf1D = root.path("tf1D");
        JsonNode tf2H = root.path("tf2H");
        JsonNode tf30m = root.path("tf30m");

        return RegimeDTO.builder()
                .indexName(root.path("indexName").asText("NIFTY50"))
                .scripCode(root.path("scripCode").asText())
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .label(root.path("label").asText("NEUTRAL"))
                .regimeStrength(root.path("regimeStrength").asDouble(0))
                .regimeCoherence(root.path("regimeCoherence").asDouble(0))
                .flowAgreement(root.path("flowAgreement").asInt(0))
                .volatilityState(root.path("volatilityState").asText("NORMAL"))
                .tf1DLabel(tf1D.path("label").asText("NEUTRAL"))
                .tf1DStrength(tf1D.path("regimeStrength").asDouble(0))
                .tf2HLabel(tf2H.path("label").asText("NEUTRAL"))
                .tf2HStrength(tf2H.path("regimeStrength").asDouble(0))
                .tf30mLabel(tf30m.path("label").asText("NEUTRAL"))
                .tf30mStrength(tf30m.path("regimeStrength").asDouble(0))
                .build();
    }
}

