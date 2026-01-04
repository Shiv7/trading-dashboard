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
 * Kafka consumer for FUDKII (First-Up/Down-Kill Ignition Indicator) standalone signals.
 * Detects first valid volatility expansion - momentum ignition events.
 *
 * Consumes from: kotsin_FUDKII, fudkii-output
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class FUDKIIConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache latest FUDKII signals
    private final Map<String, Map<String, Object>> latestFUDKII = new ConcurrentHashMap<>();

    // Cache active ignitions only
    private final Map<String, Map<String, Object>> activeIgnitions = new ConcurrentHashMap<>();

    @KafkaListener(
            topics = {"kotsin_FUDKII", "fudkii-output"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onFUDKII(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in FUDKII message, skipping");
                return;
            }

            Map<String, Object> fudkiiData = parseFUDKII(root);
            boolean ignitionFlag = Boolean.TRUE.equals(fudkiiData.get("ignitionFlag"));

            if (ignitionFlag) {
                log.info("🔥 FUDKII IGNITION: {} direction={} strength={} simultaneity={}",
                        scripCode,
                        fudkiiData.get("direction"),
                        fudkiiData.get("fudkiiStrength"),
                        fudkiiData.get("simultaneityScore"));

                // Cache active ignition
                activeIgnitions.put(scripCode, fudkiiData);

                // Send notification
                String emoji = "BULLISH_IGNITION".equals(fudkiiData.get("direction")) ? "🚀" : "💥";
                sessionManager.broadcastNotification("FUDKII_IGNITION",
                        String.format("%s IGNITION detected for %s! Strength: %.0f%% | Conditions: %d/5",
                                emoji,
                                fudkiiData.get("companyName"),
                                ((Number) fudkiiData.get("fudkiiStrength")).doubleValue() * 100,
                                fudkiiData.get("simultaneityScore")));
            } else {
                // Remove from active ignitions if no longer active
                activeIgnitions.remove(scripCode);
            }

            // Cache latest
            latestFUDKII.put(scripCode, fudkiiData);

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "FUDKII_UPDATE",
                    "scripCode", scripCode,
                    "ignition", ignitionFlag,
                    "data", fudkiiData
            ));

        } catch (Exception e) {
            log.error("Error processing FUDKII: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parseFUDKII(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        data.put("timestamp", LocalDateTime.ofInstant(
                Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")).toString());

        data.put("scripCode", root.path("scripCode").asText());
        data.put("companyName", root.path("companyName").asText(root.path("scripCode").asText()));
        data.put("timeframe", root.path("timeframe").asText("5m"));

        // FUDKII scores
        data.put("fudkiiStrength", root.path("fudkiiStrength").asDouble(0));
        data.put("simultaneityScore", root.path("simultaneityScore").asInt(0));
        data.put("ignitionFlag", root.path("ignitionFlag").asBoolean(false));
        data.put("direction", root.path("direction").asText("NO_IGNITION"));

        // 5 Ignition conditions
        data.put("priceBreaking", root.path("priceBreaking").asBoolean(false));
        data.put("volumeSurging", root.path("volumeSurging").asBoolean(false));
        data.put("momentumPositive", root.path("momentumPositive").asBoolean(false));
        data.put("atrExpanding", root.path("atrExpanding").asBoolean(false));
        data.put("flowConfirming", root.path("flowConfirming").asBoolean(false));

        // Threshold metrics
        data.put("priceVsHighLow", root.path("priceVsHighLow").asDouble(0));
        data.put("volumeRatio", root.path("volumeRatio").asDouble(0));
        data.put("atrRatio", root.path("atrRatio").asDouble(0));
        data.put("momentumScore", root.path("momentumScore").asDouble(0));
        data.put("flowScore", root.path("flowScore").asDouble(0));

        return data;
    }

    /**
     * Get latest FUDKII for a scripCode
     */
    public Map<String, Object> getLatestFUDKII(String scripCode) {
        return latestFUDKII.get(scripCode);
    }

    /**
     * Get all active ignitions
     */
    public Map<String, Map<String, Object>> getActiveIgnitions() {
        return new HashMap<>(activeIgnitions);
    }

    /**
     * Get count of active ignitions
     */
    public int getActiveIgnitionCount() {
        return activeIgnitions.size();
    }
}
