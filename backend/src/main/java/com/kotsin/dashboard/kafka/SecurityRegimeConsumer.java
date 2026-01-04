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
 * Kafka consumer for Security Regime output.
 * Tracks individual stock's alignment with index regime.
 *
 * Consumes from: regime-security-output
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class SecurityRegimeConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache latest security regime per scripCode
    private final Map<String, Map<String, Object>> latestSecurityRegime = new ConcurrentHashMap<>();

    @KafkaListener(
            topics = "regime-security-output",
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onSecurityRegime(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in security-regime message, skipping");
                return;
            }

            Map<String, Object> regimeData = parseSecurityRegime(root);
            log.debug("Security Regime: {} label={} aligned={} rs={}",
                    scripCode,
                    regimeData.get("label"),
                    regimeData.get("alignedWithIndex"),
                    regimeData.get("relativeStrength"));

            // Cache latest
            latestSecurityRegime.put(scripCode, regimeData);

            // Broadcast to WebSocket
            sessionManager.broadcastScoreUpdate(scripCode, Map.of(
                    "type", "SECURITY_REGIME",
                    "scripCode", scripCode,
                    "data", regimeData
            ));

        } catch (Exception e) {
            log.error("Error processing security regime: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parseSecurityRegime(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        data.put("timestamp", LocalDateTime.ofInstant(
                Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")).toString());

        data.put("scripCode", root.path("scripCode").asText());
        data.put("companyName", root.path("companyName").asText(root.path("scripCode").asText()));

        // Trend
        data.put("trendDirection", root.path("trendDirection").asInt(0));
        data.put("trendPersistence", root.path("trendPersistence").asDouble(0));
        data.put("ema20", root.path("ema20").asDouble(0));
        data.put("ema50", root.path("ema50").asDouble(0));

        // Relative Strength vs Index
        data.put("relativeStrength", root.path("relativeStrength").asDouble(0));

        // ATR / Volatility
        data.put("atrExpansion", root.path("atrExpansion").asDouble(0));
        data.put("atr14", root.path("atr14").asDouble(0));
        data.put("avgAtr20", root.path("avgAtr20").asDouble(0));
        data.put("atrExpansionRatio", root.path("atrExpansionRatio").asDouble(1));
        data.put("atrState", root.path("atrState").asText("NORMAL"));

        // Security context score
        data.put("securityContextScore", root.path("securityContextScore").asDouble(0));
        data.put("label", root.path("label").asText("NEUTRAL"));

        // Index alignment
        data.put("indexFlowMultiplier", root.path("indexFlowMultiplier").asDouble(1.0));
        data.put("alignedWithIndex", root.path("alignedWithIndex").asBoolean(false));
        data.put("microLeaderOverrideApplied", root.path("microLeaderOverrideApplied").asBoolean(false));

        return data;
    }

    /**
     * Get latest security regime for a scripCode
     */
    public Map<String, Object> getLatestSecurityRegime(String scripCode) {
        return latestSecurityRegime.get(scripCode);
    }

    /**
     * Get all security regimes
     */
    public Map<String, Map<String, Object>> getAllSecurityRegimes() {
        return new HashMap<>(latestSecurityRegime);
    }

    /**
     * Get stocks aligned with index
     */
    public Map<String, Map<String, Object>> getAlignedStocks() {
        Map<String, Map<String, Object>> aligned = new HashMap<>();
        latestSecurityRegime.forEach((k, v) -> {
            if (Boolean.TRUE.equals(v.get("alignedWithIndex"))) {
                aligned.put(k, v);
            }
        });
        return aligned;
    }
}
