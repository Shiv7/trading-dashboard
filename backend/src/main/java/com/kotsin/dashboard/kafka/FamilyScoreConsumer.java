package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.FamilyScoreDTO;
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
 * Kafka consumer for family-score topic.
 * This topic contains the enriched MTIS scores with breakdowns.
 * Broadcasts score updates to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class FamilyScoreConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    
    // Cache for latest scores (for REST API fallback)
    private final Map<String, FamilyScoreDTO> latestScores = new ConcurrentHashMap<>();

    @KafkaListener(topics = "family-score", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onFamilyScore(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            
            String familyId = root.path("familyId").asText();
            if (familyId == null || familyId.isEmpty()) {
                log.trace("No familyId in family-score message, skipping");
                return;
            }

            FamilyScoreDTO dto = parseFamilyScore(root);
            log.info("Received family-score for {} (MTIS={}, label={})", 
                familyId, dto.getOverallScore(), dto.getDirection());
            
            // Cache latest score
            latestScores.put(familyId, dto);
            
            // Broadcast to WebSocket
            sessionManager.broadcastScoreUpdate(familyId, dto);

        } catch (Exception e) {
            log.error("Error processing family-score: {}", e.getMessage(), e);
        }
    }
    
    /**
     * Get latest score for a scripCode (for REST API)
     */
    public FamilyScoreDTO getLatestScore(String scripCode) {
        return latestScores.get(scripCode);
    }
    
    /**
     * Get all latest scores (for REST API)
     */
    public Map<String, FamilyScoreDTO> getAllLatestScores() {
        return new HashMap<>(latestScores);
    }

    private FamilyScoreDTO parseFamilyScore(JsonNode root) {
        String familyId = root.path("familyId").asText();
        String symbol = root.path("symbol").asText(familyId);
        long timestamp = root.path("windowEndMillis").asLong(root.path("timestamp").asLong(System.currentTimeMillis()));
        String timeframe = root.path("triggerTimeframe").asText("1m");
        
        // Get breakdown scores
        JsonNode breakdown = root.path("breakdown");
        
        FamilyScoreDTO.FamilyScoreDTOBuilder builder = FamilyScoreDTO.builder()
                .scripCode(familyId)
                .companyName(symbol)
                .timeframe(timeframe)
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .open(root.path("spotPrice").asDouble(0))
                .high(root.path("spotPrice").asDouble(0))
                .low(root.path("spotPrice").asDouble(0))
                .close(root.path("spotPrice").asDouble(0))
                .volume(0L) // Not available in family-score
                .vwap(root.path("spotPrice").asDouble(0));

        // MTIS is the overall score
        double mtis = root.path("mtis").asDouble(0);
        String mtisLabel = root.path("mtisLabel").asText("NEUTRAL");
        String mtisTrend = root.path("mtisTrend").asText("FLAT");
        
        // Breakdown scores
        double priceScore = breakdown.path("priceScore").asDouble(0);
        double ipuScore = breakdown.path("ipuScore").asDouble(0);
        double foAlignmentScore = breakdown.path("foAlignmentScore").asDouble(0);
        double microstructureScore = breakdown.path("microstructureScore").asDouble(0);
        double orderbookScore = breakdown.path("orderbookScore").asDouble(0);
        double mtfRegimeScore = breakdown.path("mtfRegimeScore").asDouble(0);
        double patternBonus = breakdown.path("patternBonus").asDouble(0);
        double levelRetestBonus = breakdown.path("levelRetestBonus").asDouble(0);
        
        // VCP-like scores from breakdown
        builder.vcpCombinedScore(priceScore)
               .vcpRunway(patternBonus)
               .vcpStructuralBias(levelRetestBonus)
               .vcpSupportScore(0)
               .vcpResistanceScore(0);

        // IPU scores
        builder.ipuFinalScore(ipuScore)
               .ipuInstProxy(microstructureScore)
               .ipuMomentum(0)
               .ipuExhaustion(root.path("hasExhaustion").asBoolean() ? 1.0 : 0.0)
               .ipuUrgency(0)
               .ipuDirectionalConviction(0)
               .ipuXfactor(root.path("fudkiiIgnition").asBoolean())
               .ipuMomentumState(mtisTrend);

        // Regime
        builder.indexRegimeLabel(mtisLabel)
               .indexRegimeStrength(mtfRegimeScore / 10.0) // Normalize to 0-1
               .securityRegimeLabel(root.path("sessionPhase").asText("UNKNOWN"))
               .securityAligned(root.path("actionable").asBoolean());

        // OI/F&O
        builder.oiSignal(root.path("oiSignal").asText("NEUTRAL"))
               .pcr(null)
               .spotFuturePremium(calculatePremium(root))
               .futuresBuildup(foAlignmentScore > 0 ? "LONG_BUILDUP" : (foAlignmentScore < 0 ? "SHORT_BUILDUP" : "NONE"));

        // Gate status from actionability
        boolean actionable = root.path("actionable").asBoolean();
        builder.hardGatePassed(actionable)
               .hardGateReason(actionable ? "" : "Not actionable")
               .mtfGatePassed(mtfRegimeScore > 0)
               .mtfGateReason(mtfRegimeScore > 0 ? "" : "No MTF alignment")
               .qualityGatePassed(mtis > 5)
               .qualityGateReason(mtis > 5 ? "" : "MTIS too low")
               .statsGatePassed(true)
               .statsGateReason("");

        // Overall MTIS score
        builder.overallScore(mtis)
               .direction(determineDirection(mtisLabel, mtisTrend))
               .signalEmitted(actionable);

        // Module details for expandable view
        Map<String, Object> details = new HashMap<>();
        details.put("rawMtis", root.path("rawMtis").asDouble(0));
        details.put("sessionModifier", root.path("sessionModifier").asDouble(1));
        details.put("cprModifier", root.path("cprModifier").asDouble(1));
        details.put("expiryModifier", root.path("expiryModifier").asDouble(1));
        details.put("mtisChange", root.path("mtisChange").asDouble(0));
        details.put("previousMtis", root.path("previousMtis").asDouble(0));
        details.put("summary", root.path("summary").asText(""));
        details.put("sessionPhase", root.path("sessionPhase").asText("UNKNOWN"));
        details.put("hasDivergence", root.path("hasDivergence").asBoolean());
        details.put("hasExhaustion", root.path("hasExhaustion").asBoolean());
        details.put("expiryDay", root.path("expiryDay").asBoolean());
        details.put("fudkiiIgnition", root.path("fudkiiIgnition").asBoolean());
        
        // Add all breakdown scores
        details.put("priceScore", priceScore);
        details.put("foAlignmentScore", foAlignmentScore);
        details.put("ipuScore", ipuScore);
        details.put("microstructureScore", microstructureScore);
        details.put("orderbookScore", orderbookScore);
        details.put("mtfRegimeScore", mtfRegimeScore);
        details.put("patternBonus", patternBonus);
        details.put("levelRetestBonus", levelRetestBonus);
        
        builder.moduleDetails(details);

        return builder.build();
    }
    
    private Double calculatePremium(JsonNode root) {
        double spotPrice = root.path("spotPrice").asDouble(0);
        double futurePrice = root.path("futurePrice").asDouble(0);
        if (spotPrice > 0 && futurePrice > 0) {
            return ((futurePrice - spotPrice) / spotPrice) * 100;
        }
        return null;
    }
    
    private String determineDirection(String mtisLabel, String mtisTrend) {
        if ("BULLISH".equals(mtisLabel) || "STRONG_BULLISH".equals(mtisLabel)) {
            return "BULLISH";
        } else if ("BEARISH".equals(mtisLabel) || "STRONG_BEARISH".equals(mtisLabel)) {
            return "BEARISH";
        } else if ("RISING".equals(mtisTrend)) {
            return "BULLISH";
        } else if ("FALLING".equals(mtisTrend)) {
            return "BEARISH";
        }
        return "NEUTRAL";
    }
}

