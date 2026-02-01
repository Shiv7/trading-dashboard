package com.kotsin.dashboard.kafka;

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

    @KafkaListener(topics = "risk-events", groupId = "dashboard-risk-consumer")
    public void consumeRiskEvent(RiskEventDTO event) {
        try {
            log.info("RISK_EVENT_RECEIVED type={} severity={} message={}",
                    event.getEventType(), event.getSeverity(), event.getMessage());

            // Broadcast to all connected WebSocket clients
            messagingTemplate.convertAndSend("/topic/risk", event);

            // For critical events, also send to a separate alert topic
            if ("CRITICAL".equals(event.getSeverity())) {
                messagingTemplate.convertAndSend("/topic/alerts", event);
                log.warn("CRITICAL_RISK_ALERT: {}", event.getMessage());
            }

        } catch (Exception e) {
            log.error("Error processing risk event: {}", e.getMessage());
        }
    }
}
