package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.FinalOpportunityScoreDTO;
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
 * Kafka consumer for MASTER ARCHITECTURE FinalOpportunityScore.
 * 
 * Listens to: score-final-opportunity
 * 
 * This consumer:
 * 1. Parses FinalOpportunityScore from Kafka
 * 2. Caches latest scores for REST API
 * 3. Broadcasts to WebSocket clients
 * 4. Sends notifications for actionable signals
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class FinalOpportunityScoreConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache for latest opportunity scores (for REST API)
    private final Map<String, FinalOpportunityScoreDTO> latestScores = new ConcurrentHashMap<>();
    
    // Cache for actionable signals only
    private final Map<String, FinalOpportunityScoreDTO> actionableSignals = new ConcurrentHashMap<>();

    /**
     * Listen to score-final-opportunity topic
     */
    @KafkaListener(
            topics = "score-final-opportunity",
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onFinalOpportunityScore(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in score-final-opportunity message, skipping");
                return;
            }

            FinalOpportunityScoreDTO dto = parseScore(root);
            
            // Cache latest score
            latestScores.put(scripCode, dto);
            
            // Log based on decision
            if (dto.isActionable()) {
                log.info("🎯 MASTER ARCH SIGNAL | {} ({}) | decision={} | score={:.3f} | conf={:.2f} | lots={} | hedge={}",
                        dto.getCompanyName(),
                        scripCode,
                        dto.getDecision(),
                        dto.getFinalScore(),
                        dto.getDirectionConfidence(),
                        dto.getRecommendedLots(),
                        dto.isHedgeRecommended() ? "YES" : "NO");
                
                // Cache actionable signal
                actionableSignals.put(scripCode, dto);
                
                // Broadcast notification for actionable signals
                String emoji = dto.getFinalScore() > 0 ? "📈" : "📉";
                String direction = dto.getFinalScore() > 0 ? "BULLISH" : "BEARISH";
                sessionManager.broadcastNotification("OPPORTUNITY",
                        String.format("%s %s %s signal | Score: %.2f | Confidence: %.0f%% | %d lots",
                                emoji,
                                direction,
                                dto.getCompanyName(),
                                dto.getFinalScore(),
                                dto.getDirectionConfidence() * 100,
                                dto.getRecommendedLots()));
            } else {
                log.debug("[MASTER ARCH] {} | {} | score={:.3f}",
                        dto.getCompanyName(),
                        dto.getDecision(),
                        dto.getFinalScore());
            }

            // Broadcast to WebSocket (all scores, not just actionable)
            broadcastOpportunityScore(scripCode, dto);

        } catch (Exception e) {
            log.error("Error processing score-final-opportunity: {}", e.getMessage(), e);
        }
    }

    /**
     * Parse FinalOpportunityScore from JSON
     */
    private FinalOpportunityScoreDTO parseScore(JsonNode root) {
        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        
        // Parse finalScore object
        JsonNode finalScoreNode = root.path("finalScore");
        double currentScore = finalScoreNode.path("current").asDouble(0);
        double previousScore = finalScoreNode.path("previous").asDouble(0);
        double delta = finalScoreNode.path("delta").asDouble(currentScore - previousScore);
        
        // Parse position sizing from root (if available from PositionSizer output)
        JsonNode position = root.path("position");
        
        // Determine direction from score sign
        String direction;
        if (currentScore > 0.1) {
            direction = "BULLISH";
        } else if (currentScore < -0.1) {
            direction = "BEARISH";
        } else {
            direction = "NEUTRAL";
        }

        FinalOpportunityScoreDTO.FinalOpportunityScoreDTOBuilder builder = FinalOpportunityScoreDTO.builder()
                .scripCode(root.path("scripCode").asText())
                .companyName(root.path("companyName").asText(root.path("scripCode").asText()))
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                // Component scores
                .indexContextScore(root.path("indexContextScore").asDouble(0))
                .securityContextScore(root.path("securityContextScore").asDouble(0))
                .signalStrengthScore(root.path("signalStrengthScore").asDouble(0))
                .directionConfidence(root.path("directionConfidence").asDouble(0))
                // Final score
                .finalScore(currentScore)
                .previousScore(previousScore)
                .scoreDelta(delta)
                // Decision
                .decision(root.path("decision").asText("REJECT"))
                .decisionReason(root.path("decisionReason").asText(""))
                .direction(direction)
                .actionable(root.path("isActionable").asBoolean(false))
                // Position sizing
                .recommendedLots(root.path("recommendedLots").asInt(0))
                .hedgeRecommended(root.path("hedgeRecommended").asBoolean(false))
                .hedgeOptional(root.path("hedgeOptional").asBoolean(false))
                .hedgeType(root.path("hedgeType").asText(null))
                // Decay tracking
                .barsWithoutFollowThrough(root.path("barsWithoutFollowThrough").asInt(0))
                .decayApplied(root.path("decayApplied").asBoolean(false))
                .decayCount(root.path("decayCount").asInt(0))
                // Validation
                .valid(root.path("isValid").asBoolean(true))
                .invalidReason(root.path("invalidReason").asText(null));

        // Parse entry/exit from position node if available
        if (position != null && !position.isMissingNode()) {
            builder.entryPrice(position.path("entryPrice").asDouble(0))
                   .stopLoss(position.path("stopLoss").asDouble(0))
                   .target1(position.path("target1").asDouble(0))
                   .target2(position.path("target2").asDouble(0))
                   .target3(position.path("target3").asDouble(0))
                   .riskRewardRatio(position.path("riskRewardRatio").asDouble(0));
        }

        // Build module details for expandable view
        Map<String, Object> details = new HashMap<>();
        details.put("indexContextScore", root.path("indexContextScore").asDouble(0));
        details.put("securityContextScore", root.path("securityContextScore").asDouble(0));
        details.put("signalStrengthScore", root.path("signalStrengthScore").asDouble(0));
        details.put("directionConfidence", root.path("directionConfidence").asDouble(0));
        details.put("decisionThreshold", root.path("decision").asText());
        details.put("lotSizing", Map.of(
                "lots", root.path("recommendedLots").asInt(0),
                "hedge", root.path("hedgeRecommended").asBoolean(false),
                "hedgeOptional", root.path("hedgeOptional").asBoolean(false)
        ));
        details.put("decay", Map.of(
                "applied", root.path("decayApplied").asBoolean(false),
                "count", root.path("decayCount").asInt(0),
                "barsWithoutFollowThrough", root.path("barsWithoutFollowThrough").asInt(0)
        ));
        builder.moduleDetails(details);

        return builder.build();
    }

    /**
     * Broadcast opportunity score to WebSocket clients
     */
    private void broadcastOpportunityScore(String scripCode, FinalOpportunityScoreDTO dto) {
        // Broadcast to specific scripCode channel
        sessionManager.broadcastScoreUpdate(scripCode, Map.of(
                "type", "OPPORTUNITY_SCORE",
                "data", dto
        ));
        
        // Broadcast actionable signals to dedicated channel
        if (dto.isActionable()) {
            sessionManager.broadcastSignal(Map.of(
                    "type", "MASTER_ARCH_SIGNAL",
                    "scripCode", scripCode,
                    "decision", dto.getDecision(),
                    "score", dto.getFinalScore(),
                    "confidence", dto.getDirectionConfidence(),
                    "direction", dto.getDirection(),
                    "lots", dto.getRecommendedLots(),
                    "hedge", dto.isHedgeRecommended(),
                    "timestamp", dto.getTimestamp().toString()
            ));
        }
    }

    // ========== REST API Support ==========

    /**
     * Get latest opportunity score for a scripCode
     */
    public FinalOpportunityScoreDTO getLatestScore(String scripCode) {
        return latestScores.get(scripCode);
    }

    /**
     * Get all latest opportunity scores
     */
    public Map<String, FinalOpportunityScoreDTO> getAllLatestScores() {
        return new HashMap<>(latestScores);
    }

    /**
     * Get only actionable signals
     */
    public Map<String, FinalOpportunityScoreDTO> getActionableSignals() {
        return new HashMap<>(actionableSignals);
    }

    /**
     * Get count of actionable signals
     */
    public int getActionableCount() {
        return actionableSignals.size();
    }

    /**
     * Clear stale actionable signals (older than specified minutes)
     */
    public void clearStaleSignals(int maxAgeMinutes) {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(maxAgeMinutes);
        actionableSignals.entrySet().removeIf(e -> 
                e.getValue().getTimestamp() != null && e.getValue().getTimestamp().isBefore(cutoff));
        log.info("Cleared stale actionable signals older than {} minutes", maxAgeMinutes);
    }
}
