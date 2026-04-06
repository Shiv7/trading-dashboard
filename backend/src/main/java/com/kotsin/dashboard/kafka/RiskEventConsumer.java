package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.RiskEventDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/**
 * Consumes risk events from Kafka and broadcasts to WebSocket clients.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class RiskEventConsumer {

    private final SimpMessagingTemplate messagingTemplate;
    private static final ObjectMapper mapper = new ObjectMapper();

    @KafkaListener(topics = "risk-events", groupId = "dashboard-risk-consumer")
    public void consumeRiskEvent(String payload) {
        try {
            JsonNode root = mapper.readTree(payload);

            RiskEventDTO event = new RiskEventDTO();
            // Producer sends "type", DTO expects "eventType"
            event.setEventType(root.has("eventType") ? root.path("eventType").asText()
                    : root.path("type").asText("UNKNOWN"));
            event.setScripCode(root.path("scripCode").asText(null));
            event.setMessage(root.path("message").asText(""));
            event.setSeverity(root.path("severity").asText("INFO"));
            event.setWalletId(root.path("walletId").asText(null));
            event.setCurrentValue(root.path("currentValue").asDouble(0));
            event.setLimitValue(root.path("limitValue").asDouble(0));
            event.setThresholdPercent(root.path("thresholdPercent").asDouble(0));

            log.info("RISK_EVENT type={} scrip={} message={}",
                    event.getEventType(), event.getScripCode(), event.getMessage());

            messagingTemplate.convertAndSend("/topic/risk", event);

            if ("CRITICAL".equals(event.getSeverity())) {
                messagingTemplate.convertAndSend("/topic/alerts", event);
                log.warn("CRITICAL_RISK_ALERT: {}", event.getMessage());
            }

        } catch (Exception e) {
            log.debug("Error processing risk event: {}", e.getMessage());
        }
    }
}
