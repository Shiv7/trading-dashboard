package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka consumer for market intelligence topics from StreamingCandle.
 *
 * Consumes from:
 * - market-narrative: Human-readable market story and posture
 * - market-intelligence: Full intelligence with setups, forecasts, recommendations
 * - active-setups: Ready trading setups
 * - opportunity-forecast: Price predictions and probabilities
 *
 * Broadcasts all data to WebSocket clients for real-time dashboard updates.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class MarketIntelligenceConsumer {

    private final WebSocketSessionManager sessionManager;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache for latest intelligence data
    private final Map<String, JsonNode> latestNarratives = new ConcurrentHashMap<>();
    private final Map<String, JsonNode> latestIntelligence = new ConcurrentHashMap<>();
    private final Map<String, JsonNode> latestSetups = new ConcurrentHashMap<>();
    private final Map<String, JsonNode> latestForecasts = new ConcurrentHashMap<>();

    // ======================== MARKET NARRATIVE ========================

    @KafkaListener(topics = "market-narrative", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onMarketNarrative(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            String familyId = extractFamilyId(root);

            if (familyId == null) {
                log.trace("No familyId in market-narrative message, skipping");
                return;
            }

            log.info("Received market-narrative for {} | headline: {} | posture: {}",
                familyId,
                root.path("headline").asText("N/A"),
                root.path("posture").asText("N/A"));

            // Cache and broadcast
            latestNarratives.put(familyId, root);
            sessionManager.broadcastMarketNarrative(familyId, root);

        } catch (Exception e) {
            log.error("Error processing market-narrative: {}", e.getMessage(), e);
        }
    }

    // ======================== MARKET INTELLIGENCE ========================

    @KafkaListener(topics = "market-intelligence", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onMarketIntelligence(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            String familyId = extractFamilyId(root);

            if (familyId == null) {
                log.trace("No familyId in market-intelligence message, skipping");
                return;
            }

            String headline = root.path("headline").asText("N/A");
            String posture = root.path("posture").asText("NEUTRAL");
            boolean isActionable = root.path("isActionableMoment").asBoolean(false);
            boolean hasSetups = root.path("hasReadySetups").asBoolean(false);
            double confidence = root.path("overallConfidence").asDouble(0);

            log.info("Received market-intelligence for {} | {} | {} | actionable={} | hasSetups={} | conf={:.1f}%",
                familyId, headline, posture, isActionable, hasSetups, confidence * 100);

            // Cache and broadcast
            latestIntelligence.put(familyId, root);
            sessionManager.broadcastMarketIntelligence(familyId, root);

            // If actionable moment, also send notification
            if (isActionable) {
                sessionManager.broadcastNotification("ACTIONABLE_MOMENT",
                    String.format("%s: %s - Actionable moment detected!", familyId, headline));
            }

        } catch (Exception e) {
            log.error("Error processing market-intelligence: {}", e.getMessage(), e);
        }
    }

    // ======================== ACTIVE SETUPS ========================

    @KafkaListener(topics = "active-setups", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onActiveSetups(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            // Setups come as an array with key in Kafka message
            // We need to extract familyId from the first setup or use a wrapper
            String familyId = null;
            int setupCount = 0;

            if (root.isArray() && root.size() > 0) {
                setupCount = root.size();
                familyId = root.get(0).path("familyId").asText(null);
                if (familyId == null) {
                    familyId = root.get(0).path("scripCode").asText("UNKNOWN");
                }
            }

            if (familyId == null) {
                log.trace("No familyId in active-setups message, skipping");
                return;
            }

            log.info("Received {} active setups for {}", setupCount, familyId);

            // Cache and broadcast
            latestSetups.put(familyId, root);
            sessionManager.broadcastActiveSetups(familyId, root);

            // Send notification for ready setups
            if (setupCount > 0) {
                sessionManager.broadcastNotification("SETUP_READY",
                    String.format("%s: %d trading setup(s) ready!", familyId, setupCount));
            }

        } catch (Exception e) {
            log.error("Error processing active-setups: {}", e.getMessage(), e);
        }
    }

    // ======================== OPPORTUNITY FORECAST ========================

    @KafkaListener(topics = "opportunity-forecast", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onOpportunityForecast(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            String familyId = extractFamilyId(root);

            if (familyId == null) {
                log.trace("No familyId in opportunity-forecast message, skipping");
                return;
            }

            int predictionCount = 0;
            JsonNode predictions = root.path("predictions");
            if (predictions.isArray()) {
                predictionCount = predictions.size();
            }

            log.info("Received opportunity-forecast for {} | {} predictions",
                familyId, predictionCount);

            // Cache and broadcast
            latestForecasts.put(familyId, root);
            sessionManager.broadcastOpportunityForecast(familyId, root);

        } catch (Exception e) {
            log.error("Error processing opportunity-forecast: {}", e.getMessage(), e);
        }
    }

    // ======================== HELPER METHODS ========================

    private String extractFamilyId(JsonNode root) {
        String familyId = root.path("familyId").asText(null);
        if (familyId == null) {
            familyId = root.path("scripCode").asText(null);
        }
        return familyId;
    }

    // ======================== API METHODS ========================

    /**
     * Get latest narrative for a family
     */
    public JsonNode getLatestNarrative(String familyId) {
        return latestNarratives.get(familyId);
    }

    /**
     * Get latest intelligence for a family
     */
    public JsonNode getLatestIntelligence(String familyId) {
        return latestIntelligence.get(familyId);
    }

    /**
     * Get latest setups for a family
     */
    public JsonNode getLatestSetups(String familyId) {
        return latestSetups.get(familyId);
    }

    /**
     * Get latest forecast for a family
     */
    public JsonNode getLatestForecast(String familyId) {
        return latestForecasts.get(familyId);
    }

    /**
     * Get all cached narratives
     */
    public Map<String, JsonNode> getAllNarratives() {
        return Map.copyOf(latestNarratives);
    }

    /**
     * Get all cached intelligence
     */
    public Map<String, JsonNode> getAllIntelligence() {
        return Map.copyOf(latestIntelligence);
    }
}
