package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.FamilyScoreDTO;
import com.kotsin.dashboard.service.ScoreExplainerService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka consumer for family-score topic.
 * This topic contains the enriched MTIS scores with breakdowns.
 * Broadcasts score updates to WebSocket clients.
 *
 * IMPORTANT: On startup, loads cached scores from Redis to survive restarts.
 * Redis key pattern: family:score:{familyId}
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class FamilyScoreConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ScoreExplainerService scoreExplainerService;
    private final RedisTemplate<String, String> redisTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache for latest scores (for REST API fallback)
    private final Map<String, FamilyScoreDTO> latestScores = new ConcurrentHashMap<>();

    // Redis key prefix (must match streaming candle service)
    private static final String REDIS_KEY_PREFIX = "family:score:";

    /**
     * Load cached scores from Redis on startup.
     * This ensures dashboard is not empty after backend restart.
     */
    @PostConstruct
    public void loadFromRedis() {
        try {
            Set<String> keys = redisTemplate.keys(REDIS_KEY_PREFIX + "*");
            if (keys == null || keys.isEmpty()) {
                log.info("[FAMILY_SCORE] No cached scores in Redis on startup");
                return;
            }

            // Filter out history keys
            int loaded = 0;
            for (String key : keys) {
                if (key.contains(":history:")) {
                    continue;
                }

                try {
                    String json = redisTemplate.opsForValue().get(key);
                    if (json != null && !json.isEmpty()) {
                        JsonNode root = objectMapper.readTree(json);
                        String familyId = root.path("familyId").asText();

                        if (familyId != null && !familyId.isEmpty()) {
                            FamilyScoreDTO dto = parseFamilyScoreFromRedis(root);
                            latestScores.put(familyId, dto);
                            scoreExplainerService.updateScore(familyId, dto);
                            loaded++;
                        }
                    }
                } catch (Exception e) {
                    log.warn("[FAMILY_SCORE] Error parsing cached score from {}: {}", key, e.getMessage());
                }
            }

            log.info("[FAMILY_SCORE] Loaded {} scores from Redis on startup", loaded);
        } catch (Exception e) {
            log.error("[FAMILY_SCORE] Error loading scores from Redis: {}", e.getMessage());
        }
    }

    @KafkaListener(topics = "family-score", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}", autoStartup = "false")
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
            
            // Cache latest score in both places
            latestScores.put(familyId, dto);
            scoreExplainerService.updateScore(familyId, dto);  // FIX: Also update ScoreExplainerService cache
            
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
        JsonNode breakdownNode = root.path("breakdown");

        // MTIS is the overall score
        double mtis = root.path("mtis").asDouble(0);
        String mtisLabel = root.path("mtisLabel").asText("NEUTRAL");
        String mtisTrend = root.path("mtisTrend").asText("FLAT");

        FamilyScoreDTO.FamilyScoreDTOBuilder builder = FamilyScoreDTO.builder()
                .scripCode(familyId)
                .companyName(symbol)
                .timeframe(timeframe)
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .humanReadableTime(root.path("humanReadableTime").asText(""))
                .triggerTimeframe(timeframe)
                // MTIS Score fields
                .mtis(mtis)
                .mtisLabel(mtisLabel)
                .mtisTrend(mtisTrend)
                .previousMtis(root.path("previousMtis").asDouble(0))
                .mtisChange(root.path("mtisChange").asDouble(0))
                .rawMtis(root.path("rawMtis").asDouble(0))
                // Modifiers
                .sessionModifier(root.path("sessionModifier").asDouble(1.0))
                .cprModifier(root.path("cprModifier").asDouble(1.0))
                .expiryModifier(root.path("expiryModifier").asDouble(1.0))
                // Use actual OHLC from family-score (now available!)
                .open(root.path("open").asDouble(root.path("spotPrice").asDouble(0)))
                .high(root.path("high").asDouble(root.path("spotPrice").asDouble(0)))
                .low(root.path("low").asDouble(root.path("spotPrice").asDouble(0)))
                .close(root.path("spotPrice").asDouble(0))
                .volume(root.path("volume").asLong(0))
                .vwap(root.path("spotPrice").asDouble(0))
                // Flags
                .hasDivergence(root.path("hasDivergence").asBoolean())
                .hasExhaustion(root.path("hasExhaustion").asBoolean())
                .actionable(root.path("actionable").asBoolean())
                .fudkiiIgnition(root.path("fudkiiIgnition").asBoolean())
                .cprWidth(root.path("cprWidth").asText("NORMAL"))
                .expiryDay(root.path("expiryDay").asBoolean())
                .sessionPhase(root.path("sessionPhase").asText("UNKNOWN"))
                .summary(root.path("summary").asText(""));
        
        // Breakdown scores
        double priceScore = breakdownNode.path("priceScore").asDouble(0);
        double ipuScore = breakdownNode.path("ipuScore").asDouble(0);
        double foAlignmentScore = breakdownNode.path("foAlignmentScore").asDouble(0);
        double microstructureScore = breakdownNode.path("microstructureScore").asDouble(0);
        double orderbookScore = breakdownNode.path("orderbookScore").asDouble(0);
        double mtfRegimeScore = breakdownNode.path("mtfRegimeScore").asDouble(0);
        double patternBonus = breakdownNode.path("patternBonus").asDouble(0);
        double levelRetestBonus = breakdownNode.path("levelRetestBonus").asDouble(0);
        double fudkiiBonus = breakdownNode.path("fudkiiBonus").asDouble(0);
        double relativeStrengthBonus = breakdownNode.path("relativeStrengthBonus").asDouble(0);
        double mtisMomentumBonus = breakdownNode.path("mtisMomentumBonus").asDouble(0);
        
        // VCP scores - use root level vcpScore which is the actual VCP combined score
        double vcpScore = root.path("vcpScore").asDouble(0);
        builder.vcpCombinedScore(vcpScore / 100.0)  // Normalize from 0-100 to 0-1
               .vcpRunway(patternBonus / 15.0)     // Normalize pattern bonus
               .vcpStructuralBias(levelRetestBonus)
               .vcpSupportScore(priceScore > 0 ? priceScore / 10.0 : 0)
               .vcpResistanceScore(priceScore < 0 ? Math.abs(priceScore) / 10.0 : 0);

        // IPU scores - use root level ipuFinalScore which is the actual IPU score
        double ipuFinal = root.path("ipuFinalScore").asDouble(0);
        builder.ipuFinalScore(ipuFinal)
               .ipuInstProxy(microstructureScore / 10.0)  // Normalize
               .ipuMomentum(mtisMomentumBonus / 10.0)
               .ipuExhaustion(root.path("hasExhaustion").asBoolean() ? 1.0 : 0.0)
               .ipuUrgency(ipuFinal > 0.5 ? 1.0 : (ipuFinal > 0.3 ? 0.5 : 0.0))
               .ipuDirectionalConviction(ipuFinal * (priceScore > 0 ? 1 : -1))
               .ipuXfactor(root.path("fudkiiIgnition").asBoolean())
               .ipuMomentumState(mtisTrend);

        // Regime - use indexRegimeLabel from root
        String regimeLabel = root.path("indexRegimeLabel").asText(mtisLabel);
        builder.indexRegimeLabel(regimeLabel.isEmpty() ? mtisLabel : regimeLabel)
               .indexRegimeStrength(mtfRegimeScore / 10.0) // Normalize to 0-1
               .securityRegimeLabel(root.path("sessionPhase").asText("UNKNOWN"))
               .securityAligned(root.path("actionable").asBoolean());

        // OI/F&O - calculate actual values
        Double premium = calculatePremium(root);
        String futuresBuildup = determineFuturesBuildup(foAlignmentScore, root);
        boolean isCommodity = root.path("isCommodity").asBoolean(false);
        
        // For commodities: future IS the primary instrument, so no spot-future premium exists
        // PCR is now available from family-score
        Double pcr = root.has("pcr") && !root.path("pcr").isNull() ? root.path("pcr").asDouble() : null;
        
        builder.oiSignal(root.path("oiSignal").asText("NEUTRAL"))
               .pcr(pcr)
               .spotFuturePremium(isCommodity ? null : premium)  // N/A for commodities
               .futuresBuildup(isCommodity ? "COMMODITY" : futuresBuildup);

        // FIX: Add raw OI data for transparency (if available in family-score)
        builder.totalCallOI(root.path("totalCallOI").isNull() ? null : root.path("totalCallOI").asLong())
               .totalPutOI(root.path("totalPutOI").isNull() ? null : root.path("totalPutOI").asLong())
               .totalCallOIChange(root.path("totalCallOIChange").isNull() ? null : root.path("totalCallOIChange").asLong())
               .totalPutOIChange(root.path("totalPutOIChange").isNull() ? null : root.path("totalPutOIChange").asLong())
               .callOiBuildingUp(root.path("callOiBuildingUp").asBoolean(false))
               .putOiUnwinding(root.path("putOiUnwinding").asBoolean(false));

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
        details.put("ipuScoreBreakdown", ipuScore);
        details.put("microstructureScore", microstructureScore);
        details.put("orderbookScore", orderbookScore);
        details.put("mtfRegimeScore", mtfRegimeScore);
        details.put("patternBonus", patternBonus);
        details.put("levelRetestBonus", levelRetestBonus);
        details.put("relativeStrengthBonus", relativeStrengthBonus);
        details.put("mtisMomentumBonus", mtisMomentumBonus);
        
        // Root level scores for easy access
        details.put("vcpScore", vcpScore);
        details.put("ipuFinalScore", ipuFinal);
        details.put("spotPrice", root.path("spotPrice").asDouble(0));
        details.put("futurePrice", root.path("futurePrice").asDouble(0));
        details.put("spotFuturePremium", premium);
        details.put("indexRegimeLabel", regimeLabel);
        
        // Score explanation - contributors array
        List<Map<String, Object>> contributorsList = new ArrayList<>();
        JsonNode contributorsNode = root.path("contributors");
        if (contributorsNode.isArray()) {
            for (JsonNode c : contributorsNode) {
                Map<String, Object> contrib = new HashMap<>();
                contrib.put("category", c.path("category").asText());
                contrib.put("points", c.path("points").asDouble());
                contrib.put("reason", c.path("reason").asText());
                contrib.put("dataSource", c.path("dataSource").asText());
                contrib.put("rawValue", c.path("rawValue").asText());
                contributorsList.add(contrib);
            }
        }
        details.put("contributors", contributorsList);

        // Warnings array
        List<Map<String, Object>> warningsList = new ArrayList<>();
        JsonNode warningsNode = root.path("warnings");
        if (warningsNode.isArray()) {
            for (JsonNode w : warningsNode) {
                Map<String, Object> warning = new HashMap<>();
                warning.put("type", w.path("type").asText());
                warning.put("severity", w.path("severity").asText());
                warning.put("message", w.path("message").asText());
                warningsList.add(warning);
            }
        }
        details.put("warnings", warningsList);

        builder.moduleDetails(details);

        // Build structured breakdown object
        FamilyScoreDTO.ScoreBreakdown scoreBreakdown = FamilyScoreDTO.ScoreBreakdown.builder()
                .priceScore(priceScore)
                .foAlignmentScore(foAlignmentScore)
                .ipuScore(ipuScore)
                .fudkiiBonus(fudkiiBonus)
                .microstructureScore(microstructureScore)
                .orderbookScore(orderbookScore)
                .mtfRegimeScore(mtfRegimeScore)
                .patternBonus(patternBonus)
                .levelRetestBonus(levelRetestBonus)
                .relativeStrengthBonus(relativeStrengthBonus)
                .mtisMomentumBonus(mtisMomentumBonus)
                .build();
        builder.breakdown(scoreBreakdown);

        // Build structured warnings list
        List<FamilyScoreDTO.Warning> warningsDTO = new ArrayList<>();
        for (Map<String, Object> w : warningsList) {
            warningsDTO.add(FamilyScoreDTO.Warning.builder()
                    .type((String) w.get("type"))
                    .severity((String) w.get("severity"))
                    .message((String) w.get("message"))
                    .build());
        }
        builder.warnings(warningsDTO);

        // Build structured contributors list
        List<FamilyScoreDTO.ScoreContributor> contributorsDTO = new ArrayList<>();
        for (Map<String, Object> c : contributorsList) {
            contributorsDTO.add(FamilyScoreDTO.ScoreContributor.builder()
                    .category((String) c.get("category"))
                    .points(((Number) c.getOrDefault("points", 0.0)).doubleValue())
                    .reason((String) c.get("reason"))
                    .dataSource((String) c.get("dataSource"))
                    .rawValue((String) c.get("rawValue"))
                    .build());
        }
        builder.contributors(contributorsDTO);

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
    
    private String determineFuturesBuildup(double foAlignmentScore, JsonNode root) {
        // Check foAlignmentScore first
        if (foAlignmentScore > 5) {
            return "LONG_BUILDUP";
        } else if (foAlignmentScore < -5) {
            return "SHORT_BUILDUP";
        }
        
        // Fallback: check oiSignal
        String oiSignal = root.path("oiSignal").asText("NEUTRAL");
        switch (oiSignal) {
            case "BULLISH":
            case "STRONG_BULLISH":
                return "LONG_BUILDUP";
            case "BEARISH":
            case "STRONG_BEARISH":
                return "SHORT_BUILDUP";
            case "LONG_UNWINDING":
                return "LONG_UNWINDING";
            case "SHORT_COVERING":
                return "SHORT_COVERING";
            default:
                return "NONE";
        }
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

    /**
     * Parse FamilyScore from Redis JSON (same format as streaming candle stores it).
     * This is called on startup to load cached scores.
     */
    private FamilyScoreDTO parseFamilyScoreFromRedis(JsonNode root) {
        // Redis stores the same format as Kafka family-score topic
        // So we can reuse the parseFamilyScore method
        return parseFamilyScore(root);
    }
}

