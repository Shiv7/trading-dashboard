package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * Consumes wallet-events from Kafka and broadcasts to WebSocket clients.
 * Events: MARGIN_INSUFFICIENT, FUND_ADDED, SIGNAL_EXPIRED
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class WalletEventConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @SuppressWarnings("unchecked")
    @KafkaListener(topics = "wallet-events", groupId = "dashboard-wallet-events")
    public void onWalletEvent(String payload) {
        try {
            Map<String, Object> event = objectMapper.readValue(payload, Map.class);
            String eventType = (String) event.get("eventType");
            String walletId = (String) event.get("walletId");

            // Broadcast to frontend via WebSocket /topic/wallet
            sessionManager.broadcastWalletUpdate(event);

            log.info("[WALLET-EVENT] type={} walletId={}", eventType, walletId);
        } catch (Exception e) {
            log.error("ERR [WALLET-EVENT] Failed to process: {}", e.getMessage());
        }
    }
}
