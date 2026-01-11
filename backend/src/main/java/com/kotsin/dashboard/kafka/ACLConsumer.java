package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka consumer for ACL (Anti-Cycle Limiter) output.
 * Tracks trend age, exhaustion warnings, and multi-TF agreement.
 *
 * Consumes from: regime-acl-output
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class ACLConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache latest ACL state per scripCode
    private final Map<String, Map<String, Object>> latestACLState = new ConcurrentHashMap<>();

    @KafkaListener(
            topics = "regime-acl-output",
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onACLOutput(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                scripCode = root.path("indexName").asText("NIFTY50");
            }

            Map<String, Object> aclData = parseACL(root);
            log.debug("ACL Update: {} state={} exhaustion={}",
                    scripCode,
                    aclData.get("aclState"),
                    aclData.get("exhaustionNear"));

            // Cache latest
            latestACLState.put(scripCode, aclData);

            // Broadcast to WebSocket - FIX: use broadcastACL instead of broadcastRegimeUpdate
            sessionManager.broadcastACL(scripCode, Map.of(
                    "type", "ACL_UPDATE",
                    "scripCode", scripCode,
                    "data", aclData
            ));

            // Send notification for exhaustion warning
            if (Boolean.TRUE.equals(aclData.get("exhaustionNear"))) {
                sessionManager.broadcastNotification("ACL_EXHAUSTION",
                        String.format("⚠️ Trend exhaustion warning for %s - %s state",
                                scripCode, aclData.get("aclState")));
            }

        } catch (Exception e) {
            log.error("Error processing ACL output: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parseACL(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        data.put("timestamp", LocalDateTime.ofInstant(
                Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")).toString());

        // Trend age per timeframe
        data.put("trendAge30m", root.path("trendAge30m").asInt(0));
        data.put("trendAge2H", root.path("trendAge2H").asInt(0));
        data.put("trendAge4H", root.path("trendAge4H").asInt(0));
        data.put("trendAge1D", root.path("trendAge1D").asInt(0));

        // Agreement
        data.put("agreementScore", root.path("agreementScore").asInt(0));
        data.put("isOrderedTransition", root.path("isOrderedTransition").asBoolean(false));
        data.put("isChaoticDisagreement", root.path("isChaoticDisagreement").asBoolean(false));

        // ACL multiplier and state
        data.put("aclMultiplier", root.path("aclMultiplier").asDouble(1.0));
        data.put("aclState", root.path("aclState").asText("UNKNOWN"));
        data.put("trendDirection", root.path("trendDirection").asInt(0));
        data.put("exhaustionNear", root.path("exhaustionNear").asBoolean(false));

        // TF flow agreements
        JsonNode flows = root.path("tfFlowAgreements");
        if (flows.isArray() && flows.size() >= 4) {
            data.put("flow30m", flows.get(0).asInt(0));
            data.put("flow2H", flows.get(1).asInt(0));
            data.put("flow4H", flows.get(2).asInt(0));
            data.put("flow1D", flows.get(3).asInt(0));
        }

        return data;
    }

    /**
     * Get latest ACL state for a scripCode
     */
    public Map<String, Object> getLatestACL(String scripCode) {
        return latestACLState.get(scripCode);
    }

    /**
     * Get all ACL states
     */
    public Map<String, Map<String, Object>> getAllACLStates() {
        return new HashMap<>(latestACLState);
    }
}
