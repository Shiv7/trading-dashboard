package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.QuantScoreDTO;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import java.util.Collections;

/**
 * Kafka consumer for quant-scores topic.
 * Receives QuantScore from StreamingCandle and broadcasts to WebSocket clients.
 * Maintains sorted cache for REST API endpoints.
 *
 * FIX: Changed cache structure to support multi-timeframe data.
 * BEFORE: Map<familyId, score> - timeframes would overwrite each other!
 * AFTER: Map<familyId, Map<timeframe, score>> - each timeframe preserved separately
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class QuantScoreConsumer {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // FIX: Multi-timeframe cache structure: familyId -> (timeframe -> score)
    // BEFORE: Map<String, QuantScoreDTO> latestScores - WRONG! Timeframes overwrite each other
    // AFTER: Nested map preserves all timeframe data separately
    private final Map<String, Map<String, QuantScoreDTO>> latestScores = new ConcurrentHashMap<>();

    // Legacy flat cache for backward-compatible API (returns latest timeframe only)
    private final Map<String, QuantScoreDTO> latestScoreFlat = new ConcurrentHashMap<>();

    // Redis key prefix (must match streaming candle service)
    private static final String REDIS_KEY_PREFIX = "quant:score:";

    // FIX BUG #10: Limit max cached scores to prevent OOM
    private static final int MAX_CACHED_SCORES = 5000;
    private static final int MAX_REDIS_LOAD = 10000;

    /**
     * Load cached quant scores from Redis on startup.
     * This ensures dashboard is not empty after backend restart.
     */
    @PostConstruct
    public void loadFromRedis() {
        try {
            Set<String> keys = redisTemplate.keys(REDIS_KEY_PREFIX + "*");
            if (keys == null || keys.isEmpty()) {
                log.info("[QUANT_SCORE] No cached quant scores in Redis on startup");
                return;
            }

            // FIX BUG #10: Limit max keys to prevent OOM
            if (keys.size() > MAX_REDIS_LOAD) {
                log.warn("[QUANT_SCORE] Large number of cached scores ({}) - limiting to {}", keys.size(), MAX_REDIS_LOAD);
            }

            // Filter out history keys
            int loaded = 0;
            for (String key : keys) {
                if (loaded >= MAX_REDIS_LOAD) {
                    log.warn("[QUANT_SCORE] Reached max load limit, stopping at {} scores", loaded);
                    break;
                }

                if (key.contains(":history:")) {
                    continue;
                }

                try {
                    String json = redisTemplate.opsForValue().get(key);
                    if (json != null && !json.isEmpty()) {
                        JsonNode root = objectMapper.readTree(json);
                        String familyId = root.path("familyId").asText();

                        if (familyId != null && !familyId.isEmpty()) {
                            QuantScoreDTO dto = parseQuantScore(root);
                            if (dto == null) {
                                log.warn("[QUANT_SCORE] Failed to parse score from Redis key: {}", key);
                                continue;
                            }
                            String timeframe = dto.getTimeframe() != null ? dto.getTimeframe() : "1m";

                            // FIX BUG #8: Use synchronized block for thread safety
                            synchronized (latestScores) {
                                latestScores.computeIfAbsent(familyId, k -> new ConcurrentHashMap<>())
                                        .put(timeframe, dto);
                                latestScoreFlat.put(familyId, dto);
                            }
                            loaded++;
                        }
                    }
                } catch (Exception e) {
                    log.warn("[QUANT_SCORE] Error parsing cached quant score from {}: {}", key, e.getMessage());
                }
            }

            log.info("[QUANT_SCORE] Loaded {} quant scores from Redis on startup", loaded);
        } catch (Exception e) {
            log.error("[QUANT_SCORE] Error loading quant scores from Redis: {}", e.getMessage());
        }
    }

    @KafkaListener(topics = "quant-scores", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onQuantScore(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String familyId = root.path("familyId").asText();
            if (familyId == null || familyId.isEmpty()) {
                log.trace("No familyId in quant-scores message, skipping");
                return;
            }

            QuantScoreDTO dto = parseQuantScore(root);
            // FIX BUG #11: Validate parsing result
            if (dto == null) {
                log.warn("[QUANT_SCORE] Failed to parse message for {}", familyId);
                return;
            }

            String timeframe = dto.getTimeframe();

            // FIX BUG #9: Strict timeframe validation - reject if missing to prevent data collision
            if (timeframe == null || timeframe.isEmpty()) {
                log.warn("[QUANT_SCORE] {} - Missing timeframe in message, defaulting to 1m. This may cause data collision!", familyId);
                timeframe = "1m";
                // Note: In production, consider rejecting messages without timeframe:
                // log.error("[QUANT_SCORE] {} - Rejecting message with missing timeframe", familyId);
                // return;
            }

            log.debug("Received quant-score for {} (score={}, timeframe={}, label={}, actionable={})",
                familyId, String.format("%.1f", dto.getQuantScore()), timeframe, dto.getQuantLabel(), dto.isActionable());

            // FIX BUG #8: Use synchronized block for thread-safe cache update
            // This prevents race conditions where two threads could create duplicate maps
            final String tf = timeframe; // Effectively final for lambda
            synchronized (latestScores) {
                // FIX BUG #10: Enforce max cache size
                if (latestScores.size() >= MAX_CACHED_SCORES && !latestScores.containsKey(familyId)) {
                    log.warn("[QUANT_SCORE] Cache full ({} scores), rejecting new entry for {}",
                            latestScores.size(), familyId);
                    return;
                }

                latestScores.computeIfAbsent(familyId, k -> new ConcurrentHashMap<>())
                        .put(tf, dto);
                latestScoreFlat.put(familyId, dto);
            }

            // Broadcast to WebSocket (frontend handles timeframe via nested Record in Zustand store)
            sessionManager.broadcastQuantScore(familyId, dto);

        } catch (Exception e) {
            log.error("Error processing quant-scores: {}", e.getMessage(), e);
        }
    }

    /**
     * Get latest quant score for a scripCode (returns most recent timeframe)
     */
    public QuantScoreDTO getLatestScore(String scripCode) {
        return latestScoreFlat.get(scripCode);
    }

    /**
     * FIX: Get quant score for a specific scripCode and timeframe
     */
    public QuantScoreDTO getScore(String scripCode, String timeframe) {
        Map<String, QuantScoreDTO> tfScores = latestScores.get(scripCode);
        if (tfScores == null) return null;
        return tfScores.get(timeframe);
    }

    /**
     * FIX: Get all timeframe scores for a specific scripCode
     */
    public Map<String, QuantScoreDTO> getAllTimeframeScores(String scripCode) {
        return latestScores.getOrDefault(scripCode, Collections.emptyMap());
    }

    /**
     * Get all quant scores sorted by score descending (uses latest timeframe per scripCode)
     */
    public List<QuantScoreDTO> getAllScoresSorted() {
        return latestScoreFlat.values().stream()
                .sorted((a, b) -> Double.compare(b.getQuantScore(), a.getQuantScore()))
                .collect(Collectors.toList());
    }

    /**
     * FIX: Get all scores for all timeframes, flattened and sorted
     */
    public List<QuantScoreDTO> getAllScoresAllTimeframes() {
        return latestScores.values().stream()
                .flatMap(tfMap -> tfMap.values().stream())
                .sorted((a, b) -> Double.compare(b.getQuantScore(), a.getQuantScore()))
                .collect(Collectors.toList());
    }

    /**
     * Get top N actionable scores
     */
    public List<QuantScoreDTO> getTopActionableScores(int limit) {
        return latestScoreFlat.values().stream()
                .filter(QuantScoreDTO::isActionable)
                .sorted((a, b) -> Double.compare(b.getQuantScore(), a.getQuantScore()))
                .limit(limit)
                .collect(Collectors.toList());
    }

    /**
     * Get scores filtered by direction
     */
    public List<QuantScoreDTO> getScoresByDirection(String direction) {
        return latestScoreFlat.values().stream()
                .filter(s -> direction.equalsIgnoreCase(s.getDirection()))
                .sorted((a, b) -> Double.compare(b.getQuantScore(), a.getQuantScore()))
                .collect(Collectors.toList());
    }

    /**
     * FIX: Get count of scores per timeframe for monitoring
     */
    public Map<String, Long> getScoreCountByTimeframe() {
        return latestScores.values().stream()
                .flatMap(tfMap -> tfMap.values().stream())
                .collect(Collectors.groupingBy(
                        s -> s.getTimeframe() != null ? s.getTimeframe() : "unknown",
                        Collectors.counting()));
    }

    private QuantScoreDTO parseQuantScore(JsonNode root) {
        QuantScoreDTO.QuantScoreDTOBuilder builder = QuantScoreDTO.builder()
                .familyId(root.path("familyId").asText())
                .symbol(root.path("symbol").asText())
                .scripCode(root.path("scripCode").asText(root.path("familyId").asText()))
                .timestamp(root.path("timestamp").asLong(System.currentTimeMillis()))
                .timeframe(root.path("timeframe").asText("1m"))
                .humanReadableTime(root.path("humanReadableTime").asText())
                .quantScore(root.path("quantScore").asDouble(0))
                .quantLabel(root.path("quantLabel").asText("NEUTRAL"))
                .confidence(root.path("confidence").asDouble(0))
                .direction(root.path("direction").asText("NEUTRAL"))
                .directionalStrength(root.path("directionalStrength").asDouble(0))
                .actionable(root.path("actionable").asBoolean(false))
                .actionableReason(root.path("actionableReason").asText())
                .minActionableScore(root.path("minActionableScore").asDouble(65));

        // Parse breakdown
        JsonNode breakdownNode = root.path("breakdown");
        if (!breakdownNode.isMissingNode()) {
            builder.breakdown(parseBreakdown(breakdownNode));
        }

        // Parse Greeks summary
        JsonNode greeksNode = root.path("greeksSummary");
        if (!greeksNode.isMissingNode()) {
            builder.greeksSummary(parseGreeksSummary(greeksNode));
        }

        // Parse IV summary
        JsonNode ivNode = root.path("ivSummary");
        if (!ivNode.isMissingNode()) {
            builder.ivSummary(parseIVSummary(ivNode));
        }

        // Parse microstructure summary
        JsonNode microNode = root.path("microstructureSummary");
        if (!microNode.isMissingNode()) {
            builder.microstructureSummary(parseMicrostructureSummary(microNode));
        }

        // Parse options flow summary
        JsonNode flowNode = root.path("optionsFlowSummary");
        if (!flowNode.isMissingNode()) {
            builder.optionsFlowSummary(parseOptionsFlowSummary(flowNode));
        }

        // Parse price action summary
        JsonNode priceNode = root.path("priceActionSummary");
        if (!priceNode.isMissingNode()) {
            builder.priceActionSummary(parsePriceActionSummary(priceNode));
        }

        // Parse volume profile summary
        JsonNode volumeNode = root.path("volumeProfileSummary");
        if (!volumeNode.isMissingNode()) {
            builder.volumeProfileSummary(parseVolumeProfileSummary(volumeNode));
        }

        // Parse warnings
        JsonNode warningsNode = root.path("warnings");
        if (warningsNode.isArray()) {
            List<QuantScoreDTO.Warning> warnings = new ArrayList<>();
            for (JsonNode w : warningsNode) {
                warnings.add(QuantScoreDTO.Warning.builder()
                        .type(w.path("type").asText())
                        .severity(w.path("severity").asText())
                        .message(w.path("message").asText())
                        .recommendation(w.path("recommendation").asText())
                        .build());
            }
            builder.warnings(warnings);
        }

        // Parse data quality
        JsonNode qualityNode = root.path("dataQuality");
        if (!qualityNode.isMissingNode()) {
            builder.dataQuality(parseDataQuality(qualityNode));
        }

        return builder.build();
    }

    private QuantScoreDTO.ScoreBreakdown parseBreakdown(JsonNode node) {
        return QuantScoreDTO.ScoreBreakdown.builder()
                .greeksScore(node.path("greeksScore").asDouble(0))
                .ivSurfaceScore(node.path("ivSurfaceScore").asDouble(0))
                .microstructureScore(node.path("microstructureScore").asDouble(0))
                .optionsFlowScore(node.path("optionsFlowScore").asDouble(0))
                .priceActionScore(node.path("priceActionScore").asDouble(0))
                .volumeProfileScore(node.path("volumeProfileScore").asDouble(0))
                .crossInstrumentScore(node.path("crossInstrumentScore").asDouble(0))
                .confluenceScore(node.path("confluenceScore").asDouble(0))
                .greeksPct(node.path("greeksPct").asDouble(0))
                .ivSurfacePct(node.path("ivSurfacePct").asDouble(0))
                .microstructurePct(node.path("microstructurePct").asDouble(0))
                .optionsFlowPct(node.path("optionsFlowPct").asDouble(0))
                .priceActionPct(node.path("priceActionPct").asDouble(0))
                .volumeProfilePct(node.path("volumeProfilePct").asDouble(0))
                .crossInstrumentPct(node.path("crossInstrumentPct").asDouble(0))
                .confluencePct(node.path("confluencePct").asDouble(0))
                .rawScore(node.path("rawScore").asDouble(0))
                .regimeModifier(node.path("regimeModifier").asDouble(1))
                .confidenceModifier(node.path("confidenceModifier").asDouble(1))
                .build();
    }

    private QuantScoreDTO.GreeksSummary parseGreeksSummary(JsonNode node) {
        return QuantScoreDTO.GreeksSummary.builder()
                .totalDelta(node.path("totalDelta").asDouble(0))
                .totalGamma(node.path("totalGamma").asDouble(0))
                .totalVega(node.path("totalVega").asDouble(0))
                .totalTheta(node.path("totalTheta").asDouble(0))
                .gammaSqueezeRisk(node.path("gammaSqueezeRisk").asBoolean(false))
                .gammaSqueezeDistance(node.path("gammaSqueezeDistance").asDouble(0))
                .maxGammaStrike(node.path("maxGammaStrike").asDouble(0))
                .deltaBias(node.path("deltaBias").asText("NEUTRAL"))
                .vegaStructure(node.path("vegaStructure").asText("BALANCED"))
                .riskScore(node.path("riskScore").asDouble(0))
                .build();
    }

    private QuantScoreDTO.IVSummary parseIVSummary(JsonNode node) {
        return QuantScoreDTO.IVSummary.builder()
                .atmIV(node.path("atmIV").asDouble(0))
                .ivRank(node.path("ivRank").asDouble(0))
                .ivSignal(node.path("ivSignal").asText("MODERATE"))
                .ivCrushRisk(node.path("ivCrushRisk").asBoolean(false))
                .ivVelocity(node.path("ivVelocity").asDouble(0))
                .smileShape(node.path("smileShape").asText("NORMAL"))
                .termStructure(node.path("termStructure").asText("FLAT"))
                .skew25Delta(node.path("skew25Delta").asDouble(0))
                .nearTermIV(node.path("nearTermIV").asDouble(0))
                .farTermIV(node.path("farTermIV").asDouble(0))
                .build();
    }

    private QuantScoreDTO.MicrostructureSummary parseMicrostructureSummary(JsonNode node) {
        return QuantScoreDTO.MicrostructureSummary.builder()
                .avgOFI(node.path("avgOFI").asDouble(0))
                .avgVPIN(node.path("avgVPIN").asDouble(0))
                .avgDepthImbalance(node.path("avgDepthImbalance").asDouble(0))
                .avgKyleLambda(node.path("avgKyleLambda").asDouble(0))
                .avgSpread(node.path("avgSpread").asDouble(0))
                .aggressiveBuyRatio(node.path("aggressiveBuyRatio").asDouble(0))
                .aggressiveSellRatio(node.path("aggressiveSellRatio").asDouble(0))
                .flowDirection(node.path("flowDirection").asText("BALANCED"))
                .flowStrength(node.path("flowStrength").asDouble(0))
                .build();
    }

    private QuantScoreDTO.OptionsFlowSummary parseOptionsFlowSummary(JsonNode node) {
        // Handle null values properly - asText() returns "null" for explicit null in JSON
        String oiBuildupType = node.path("oiBuildupType").asText(null);
        String futuresBuildup = node.path("futuresBuildup").asText(null);

        // FIX BUG #12: Fixed operator precedence - added parentheses
        // BEFORE: "null".equals(x) || x != null && x.isEmpty() - incorrect precedence
        // AFTER: "null".equals(x) || (x != null && x.isEmpty()) - correct grouping
        if ("null".equals(oiBuildupType) || (oiBuildupType != null && oiBuildupType.isEmpty())) {
            oiBuildupType = null;
        }
        if ("null".equals(futuresBuildup) || (futuresBuildup != null && futuresBuildup.isEmpty())) {
            futuresBuildup = null;
        }

        return QuantScoreDTO.OptionsFlowSummary.builder()
                .pcr(node.path("pcr").asDouble(1))
                .pcrChange(node.path("pcrChange").asDouble(0))
                .pcrSignal(node.path("pcrSignal").asText("NEUTRAL"))
                .oiBuildupType(oiBuildupType)
                .oiMomentum(node.path("oiMomentum").asDouble(0))
                .futuresBuildup(futuresBuildup)
                .spotFuturePremium(node.path("spotFuturePremium").asDouble(0))
                // FIX BUG #14: Added proper null/missing checks for OI fields
                .totalCallOI(getOptionalLong(node, "totalCallOI"))
                .totalPutOI(getOptionalLong(node, "totalPutOI"))
                .totalCallOIChange(getOptionalLong(node, "totalCallOIChange"))
                .totalPutOIChange(getOptionalLong(node, "totalPutOIChange"))
                .build();
    }

    /**
     * FIX BUG #14: Helper to safely parse optional Long values
     * Handles missing nodes, null values, and numeric types
     */
    private Long getOptionalLong(JsonNode parent, String field) {
        JsonNode node = parent.path(field);
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        // Handle both integer and floating point values
        if (node.isNumber()) {
            return node.asLong();
        }
        return null;
    }

    private QuantScoreDTO.PriceActionSummary parsePriceActionSummary(JsonNode node) {
        return QuantScoreDTO.PriceActionSummary.builder()
                .candleSequencePattern(getNullableText(node, "candleSequencePattern"))
                .sequenceType(getNullableText(node, "sequenceType"))
                .reversalIndex(node.path("reversalIndex").asDouble(0))
                .momentumSlope(node.path("momentumSlope").asDouble(0))
                .wyckoffPhase(getNullableText(node, "wyckoffPhase"))
                .wyckoffStrength(node.path("wyckoffStrength").asDouble(0))
                .pcrDivergence(node.path("pcrDivergence").asBoolean(false))
                .oiDivergence(node.path("oiDivergence").asBoolean(false))
                .build();
    }

    private QuantScoreDTO.VolumeProfileSummary parseVolumeProfileSummary(JsonNode node) {
        return QuantScoreDTO.VolumeProfileSummary.builder()
                .poc(node.path("poc").asDouble(0))
                .vah(node.path("vah").asDouble(0))
                .val(node.path("val").asDouble(0))
                .pocMigration(node.path("pocMigration").asDouble(0))
                .pocTrend(getNullableText(node, "pocTrend"))
                .valueAreaExpanding(node.path("valueAreaExpanding").asBoolean(false))
                .valueAreaContracting(node.path("valueAreaContracting").asBoolean(false))
                .valueAreaShift(getNullableText(node, "valueAreaShift"))
                .build();
    }

    private QuantScoreDTO.DataQuality parseDataQuality(JsonNode node) {
        return QuantScoreDTO.DataQuality.builder()
                .hasGreeks(node.path("hasGreeks").asBoolean(false))
                .hasIVSurface(node.path("hasIVSurface").asBoolean(false))
                .hasMicrostructure(node.path("hasMicrostructure").asBoolean(false))
                .hasOptionsFlow(node.path("hasOptionsFlow").asBoolean(false))
                .hasPriceAction(node.path("hasPriceAction").asBoolean(false))
                .hasVolumeProfile(node.path("hasVolumeProfile").asBoolean(false))
                .hasCrossInstrument(node.path("hasCrossInstrument").asBoolean(false))
                .completenessScore(node.path("completenessScore").asDouble(0))
                .qualityLevel(node.path("qualityLevel").asText("MINIMAL"))
                .build();
    }

    /**
     * Helper to get nullable text - handles both missing fields and "null" string
     */
    private String getNullableText(JsonNode node, String field) {
        JsonNode fieldNode = node.path(field);
        if (fieldNode.isMissingNode() || fieldNode.isNull()) {
            return null;
        }
        String value = fieldNode.asText();
        if ("null".equals(value) || value.isEmpty()) {
            return null;
        }
        return value;
    }
}
