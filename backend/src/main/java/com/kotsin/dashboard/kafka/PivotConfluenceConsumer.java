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
 * Kafka consumer for Pivot Confluence signals.
 * Detects multi-timeframe pivot confluence with SMC zones.
 *
 * Consumes from: pivot-confluence-signals
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class PivotConfluenceConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache latest Pivot signals
    private final Map<String, Map<String, Object>> latestPivotSignals = new ConcurrentHashMap<>();

    // Cache active triggers only
    private final Map<String, Map<String, Object>> activeTriggers = new ConcurrentHashMap<>();

    @KafkaListener(
            topics = {"pivot-confluence-signals"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onPivotConfluence(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in Pivot Confluence message, skipping");
                return;
            }

            Map<String, Object> pivotData = parsePivotSignal(root);
            boolean triggered = Boolean.TRUE.equals(pivotData.get("triggered"));

            if (triggered) {
                log.info("PIVOT CONFLUENCE: {} direction={} score={} R:R={}",
                        scripCode,
                        pivotData.get("direction"),
                        String.format("%.1f", ((Number) pivotData.getOrDefault("score", 0)).doubleValue()),
                        String.format("%.2f", ((Number) pivotData.getOrDefault("riskReward", 0)).doubleValue()));

                // Cache active trigger
                activeTriggers.put(scripCode, pivotData);

                // Send notification
                String emoji = "BULLISH".equals(pivotData.get("direction")) ? "^" : "v";
                sessionManager.broadcastNotification("PIVOT_CONFLUENCE",
                        String.format("%s Pivot Confluence for %s! HTF: %s | LTF Confirmed | R:R=%.1f",
                                emoji,
                                scripCode,
                                pivotData.get("htfDirection"),
                                ((Number) pivotData.getOrDefault("riskReward", 0)).doubleValue()));
            } else {
                // Remove from active triggers if no longer active
                activeTriggers.remove(scripCode);
            }

            // Cache latest
            latestPivotSignals.put(scripCode, pivotData);

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "PIVOT_CONFLUENCE_UPDATE",
                    "scripCode", scripCode,
                    "triggered", triggered,
                    "data", pivotData
            ));

        } catch (Exception e) {
            log.error("Error processing Pivot Confluence: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parsePivotSignal(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        data.put("timestamp", LocalDateTime.ofInstant(
                Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")).toString());

        data.put("scripCode", root.path("scripCode").asText());
        data.put("triggered", root.path("triggered").asBoolean(false));
        data.put("direction", root.path("direction").asText("NEUTRAL"));
        data.put("reason", root.path("reason").asText(""));
        data.put("score", root.path("score").asDouble(0));
        data.put("triggerTime", root.path("triggerTime").asText());

        // HTF Bias details
        data.put("htfDirection", root.path("htfDirection").asText("NEUTRAL"));
        data.put("htfStrength", root.path("htfStrength").asDouble(0));
        data.put("htfBullishScore", root.path("htfBullishScore").asDouble(0));
        data.put("htfBearishScore", root.path("htfBearishScore").asDouble(0));
        data.put("htfReason", root.path("htfReason").asText(""));

        // LTF Confirmation
        data.put("ltfConfirmed", root.path("ltfConfirmed").asBoolean(false));
        data.put("ltfAlignmentScore", root.path("ltfAlignmentScore").asDouble(0));
        data.put("ltfReason", root.path("ltfReason").asText(""));

        // Pivot Analysis
        data.put("pivotCurrentPrice", root.path("pivotCurrentPrice").asDouble(0));
        data.put("pivotNearbyLevels", root.path("pivotNearbyLevels").asInt(0));
        data.put("cprPosition", root.path("cprPosition").asText(""));

        // SMC Analysis
        data.put("smcInOrderBlock", root.path("smcInOrderBlock").asBoolean(false));
        data.put("smcNearFVG", root.path("smcNearFVG").asBoolean(false));
        data.put("smcAtLiquidityZone", root.path("smcAtLiquidityZone").asBoolean(false));
        data.put("smcBias", root.path("smcBias").asText("NEUTRAL"));

        // Risk:Reward
        data.put("entryPrice", root.path("entryPrice").asDouble(0));
        data.put("stopLoss", root.path("stopLoss").asDouble(0));
        data.put("target", root.path("target").asDouble(0));
        data.put("riskReward", root.path("riskReward").asDouble(0));

        return data;
    }

    /**
     * Get latest Pivot signal for a scripCode
     */
    public Map<String, Object> getLatestPivotSignal(String scripCode) {
        return latestPivotSignals.get(scripCode);
    }

    /**
     * Get all active triggers
     */
    public Map<String, Map<String, Object>> getActiveTriggers() {
        return new HashMap<>(activeTriggers);
    }

    /**
     * Get count of active triggers
     */
    public int getActiveTriggerCount() {
        return activeTriggers.size();
    }
}
