package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.SignalDTO;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * Kafka consumer for curated trading signals.
 * Parses signals and broadcasts to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class SignalConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @KafkaListener(topics = {"trading-signals", "trading-signals-curated"}, groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onSignal(String payload) {
        try {
            log.info("Received signal from Kafka: {}", payload.substring(0, Math.min(100, payload.length())));
            JsonNode root = objectMapper.readTree(payload);
            
            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.warn("Signal has no scripCode, skipping");
                return;
            }

            SignalDTO dto = parseSignal(root);
            
            // Broadcast to WebSocket
            sessionManager.broadcastSignal(dto);
            
            // Also send a notification
            String direction = dto.getDirection();
            String emoji = "BULLISH".equals(direction) ? "📈" : "📉";
            sessionManager.broadcastNotification("SIGNAL", 
                String.format("%s New %s signal for %s", emoji, direction, dto.getCompanyName()));

            log.info("New signal broadcasted: {} {} at {}", 
                dto.getCompanyName(), dto.getDirection(), dto.getEntryPrice());

        } catch (Exception e) {
            log.error("Error processing signal: {}", e.getMessage(), e);
        }
    }

    private SignalDTO parseSignal(JsonNode root) {
        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        
        // Parse entry details from nested structure
        JsonNode entry = root.path("entry");
        double entryPrice = entry.path("entryPrice").asDouble(root.path("entryPrice").asDouble(0));
        double stopLoss = entry.path("stopLoss").asDouble(root.path("stopLoss").asDouble(0));
        double target1 = entry.path("target").asDouble(root.path("target1").asDouble(0));
        double target2 = root.path("target2").asDouble(0);
        double riskReward = entry.path("riskReward").asDouble(root.path("riskRewardRatio").asDouble(0));

        return SignalDTO.builder()
                .signalId(root.path("signalId").asText())
                .scripCode(root.path("scripCode").asText())
                .companyName(root.path("companyName").asText(root.path("scripCode").asText()))
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .signalType(root.path("signalType").asText("BREAKOUT_RETEST"))
                .direction(determineDirection(root))
                .confidence(root.path("confidence").asDouble(0))
                .rationale(root.path("rationale").asText(""))
                .entryPrice(entryPrice)
                .stopLoss(stopLoss)
                .target1(target1)
                .target2(target2)
                .riskRewardRatio(riskReward)
                .vcpScore(root.path("vcpCombinedScore").asDouble(0))
                .ipuScore(root.path("ipuFinalScore").asDouble(0))
                .xfactorFlag(root.path("xfactorFlag").asBoolean(false))
                .regimeLabel(root.path("indexRegimeLabel").asText("UNKNOWN"))
                .allGatesPassed(true) // If it reached here, all gates passed
                .positionSizeMultiplier(root.path("positionSizeMultiplier").asDouble(1.0))
                .build();
    }

    private String determineDirection(JsonNode root) {
        // Try direct direction field
        String direction = root.path("direction").asText();
        if (direction != null && !direction.isEmpty() && !"null".equals(direction)) {
            return direction.toUpperCase();
        }
        
        // Infer from entry vs stopLoss
        JsonNode entry = root.path("entry");
        double entryPrice = entry.path("entryPrice").asDouble(0);
        double stopLoss = entry.path("stopLoss").asDouble(0);
        double target = entry.path("target").asDouble(0);
        
        if (entryPrice > 0 && stopLoss > 0) {
            return entryPrice > stopLoss ? "BULLISH" : "BEARISH";
        }
        if (entryPrice > 0 && target > 0) {
            return target > entryPrice ? "BULLISH" : "BEARISH";
        }
        
        return "UNKNOWN";
    }
}

