package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.QuantScoreDTO;
import com.kotsin.dashboard.service.ScripLookupService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import java.util.Collections;

/**
 * Kafka consumer for quant-scores topic.
 * Receives QuantScore from StreamingCandle and broadcasts to WebSocket clients.
 * Maintains sorted cache for REST API endpoints.
 *
 * Cache structure: scripCode -> (timeframe -> score)
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class QuantScoreConsumer {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;
    private final ScripLookupService scripLookup;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Multi-timeframe cache: scripCode -> (timeframe -> score)
    private final Map<String, Map<String, QuantScoreDTO>> latestScores = new ConcurrentHashMap<>();

    // Flat cache for backward-compatible API (returns latest timeframe only per scripCode)
    private final Map<String, QuantScoreDTO> latestScoreFlat = new ConcurrentHashMap<>();

    // Redis key prefix (must match streaming candle service)
    private static final String REDIS_KEY_PREFIX = "quant:score:";

    private static final int MAX_CACHED_SCORES = 5000;
    private static final int MAX_REDIS_LOAD = 10000;

    // Category max points for percentage calculation
    private static final double GREEKS_MAX = 15.0;
    private static final double IV_SURFACE_MAX = 12.0;
    private static final double MICROSTRUCTURE_MAX = 18.0;
    private static final double OPTIONS_FLOW_MAX = 15.0;
    private static final double PRICE_ACTION_MAX = 12.0;
    private static final double VOLUME_PROFILE_MAX = 8.0;
    private static final double CROSS_INSTRUMENT_MAX = 10.0;
    private static final double CONFLUENCE_MAX = 10.0;

    private static final DateTimeFormatter TIME_FORMATTER =
            DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.of("Asia/Kolkata"));

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

            if (keys.size() > MAX_REDIS_LOAD) {
                log.warn("[QUANT_SCORE] Large number of cached scores ({}) - limiting to {}", keys.size(), MAX_REDIS_LOAD);
            }

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

                        // Use scripCode as the primary identifier
                        String scripCode = resolveScripCode(root);
                        if (scripCode == null || scripCode.isEmpty()) {
                            log.warn("[QUANT_SCORE] No scripCode in Redis key: {}, skipping", key);
                            continue;
                        }

                        QuantScoreDTO dto = parseQuantScore(root);
                        if (dto == null) {
                            log.warn("[QUANT_SCORE] Failed to parse score from Redis key: {}", key);
                            continue;
                        }
                        String timeframe = dto.getTimeframe() != null ? dto.getTimeframe() : "5m";

                        synchronized (latestScores) {
                            latestScores.computeIfAbsent(scripCode, k -> new ConcurrentHashMap<>())
                                    .put(timeframe, dto);
                            latestScoreFlat.put(scripCode, dto);
                        }
                        loaded++;
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

            // Use scripCode as the primary identifier
            String scripCode = resolveScripCode(root);
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("[QUANT_SCORE] No scripCode in quant-scores message, skipping");
                return;
            }

            QuantScoreDTO dto = parseQuantScore(root);
            if (dto == null) {
                log.warn("[QUANT_SCORE] Failed to parse message for {}", scripCode);
                return;
            }

            String timeframe = dto.getTimeframe();
            if (timeframe == null || timeframe.isEmpty()) {
                log.warn("[QUANT_SCORE] {} - Missing timeframe, defaulting to 5m", scripCode);
                timeframe = "5m";
            }

            log.debug("[QUANT_SCORE] Received {} score={} tf={} dir={} actionable={}",
                scripCode, String.format("%.1f", dto.getQuantScore()), timeframe,
                dto.getDirection(), dto.isActionable());

            final String tf = timeframe;
            synchronized (latestScores) {
                if (latestScores.size() >= MAX_CACHED_SCORES && !latestScores.containsKey(scripCode)) {
                    log.warn("[QUANT_SCORE] Cache full ({} scores), rejecting new entry for {}",
                            latestScores.size(), scripCode);
                    return;
                }

                latestScores.computeIfAbsent(scripCode, k -> new ConcurrentHashMap<>())
                        .put(tf, dto);
                latestScoreFlat.put(scripCode, dto);
            }

            // Broadcast to WebSocket
            sessionManager.broadcastQuantScore(scripCode, dto);

        } catch (Exception e) {
            log.error("[QUANT_SCORE] Error processing quant-scores: {}", e.getMessage(), e);
        }
    }

    /**
     * Resolve scripCode from message - the primary identifier after family concept removal.
     */
    private String resolveScripCode(JsonNode root) {
        String scripCode = root.path("scripCode").asText(null);
        if (scripCode != null && !scripCode.isEmpty()) {
            return scripCode;
        }
        // Fallback to familyId for backward compat with any old messages
        String familyId = root.path("familyId").asText(null);
        if (familyId != null && !familyId.isEmpty()) {
            return familyId;
        }
        return null;
    }

    /**
     * Get latest quant score for a scripCode (returns most recent timeframe)
     */
    public QuantScoreDTO getLatestScore(String scripCode) {
        return latestScoreFlat.get(scripCode);
    }

    /**
     * Get quant score for a specific scripCode and timeframe
     */
    public QuantScoreDTO getScore(String scripCode, String timeframe) {
        Map<String, QuantScoreDTO> tfScores = latestScores.get(scripCode);
        if (tfScores == null) return null;
        return tfScores.get(timeframe);
    }

    /**
     * Get all timeframe scores for a specific scripCode
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
     * Get all scores for all timeframes, flattened and sorted
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
     * Get count of scores per timeframe for monitoring
     */
    public Map<String, Long> getScoreCountByTimeframe() {
        return latestScores.values().stream()
                .flatMap(tfMap -> tfMap.values().stream())
                .collect(Collectors.groupingBy(
                        s -> s.getTimeframe() != null ? s.getTimeframe() : "unknown",
                        Collectors.counting()));
    }

    private QuantScoreDTO parseQuantScore(JsonNode root) {
        String scripCode = resolveScripCode(root);
        double quantScore = root.path("quantScore").asDouble(0);
        double confidence = root.path("confidence").asDouble(0);
        String direction = root.path("direction").asText("NEUTRAL");

        // Convert timestamp: producer sends epoch-seconds as double, we store as epoch-millis
        long timestampMillis = parseTimestamp(root);

        // Derive humanReadableTime from timestamp
        String humanReadableTime = root.path("humanReadableTime").asText(null);
        if (humanReadableTime == null || humanReadableTime.isEmpty() || "null".equals(humanReadableTime)) {
            humanReadableTime = TIME_FORMATTER.format(Instant.ofEpochMilli(timestampMillis));
        }

        // Derive quantLabel from score if not provided
        String quantLabel = root.path("quantLabel").asText(null);
        if (quantLabel == null || quantLabel.isEmpty() || "null".equals(quantLabel)) {
            quantLabel = deriveQuantLabel(quantScore, direction);
        }

        // Derive directionalStrength from direction + confidence if not provided
        double directionalStrength = root.path("directionalStrength").asDouble(0);
        if (directionalStrength == 0 && !"NEUTRAL".equals(direction)) {
            directionalStrength = "BULLISH".equals(direction) ? confidence : -confidence;
        }

        QuantScoreDTO.QuantScoreDTOBuilder builder = QuantScoreDTO.builder()
                .symbol(root.path("symbol").asText())
                .scripCode(scripCode)
                .companyName(scripLookup.resolve(scripCode, root.path("companyName").asText("")))
                .timestamp(timestampMillis)
                .timeframe(root.path("timeframe").asText("5m"))
                .humanReadableTime(humanReadableTime)
                .quantScore(quantScore)
                .quantLabel(quantLabel)
                .confidence(confidence)
                .direction(direction)
                .directionalStrength(directionalStrength)
                .actionable(root.path("actionable").asBoolean(false))
                .actionableReason(root.path("actionableReason").asText(null))
                .minActionableScore(root.path("minActionableScore").asDouble(65));

        // Parse breakdown (uses dataQuality for regime modifier normalization)
        JsonNode breakdownNode = root.path("breakdown");
        if (!breakdownNode.isMissingNode()) {
            JsonNode dqNode = root.path("dataQuality");
            builder.breakdown(parseBreakdown(breakdownNode, quantScore, confidence, dqNode));
        }

        // Parse optional summary sections (only present when producer generates them)
        JsonNode greeksNode = root.path("greeksSummary");
        if (!greeksNode.isMissingNode()) {
            builder.greeksSummary(parseGreeksSummary(greeksNode));
        }

        JsonNode ivNode = root.path("ivSummary");
        if (!ivNode.isMissingNode()) {
            builder.ivSummary(parseIVSummary(ivNode));
        }

        JsonNode microNode = root.path("microstructureSummary");
        if (!microNode.isMissingNode()) {
            builder.microstructureSummary(parseMicrostructureSummary(microNode));
        }

        JsonNode flowNode = root.path("optionsFlowSummary");
        if (!flowNode.isMissingNode()) {
            builder.optionsFlowSummary(parseOptionsFlowSummary(flowNode));
        }

        JsonNode priceNode = root.path("priceActionSummary");
        if (!priceNode.isMissingNode()) {
            builder.priceActionSummary(parsePriceActionSummary(priceNode));
        }

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

    /**
     * Parse timestamp from producer. Handles:
     * - Epoch seconds as double (1770361629.066) from Instant serialization
     * - Epoch millis as long (1770361629066)
     * Returns epoch millis.
     */
    private long parseTimestamp(JsonNode root) {
        JsonNode tsNode = root.path("timestamp");
        if (tsNode.isMissingNode() || tsNode.isNull()) {
            return System.currentTimeMillis();
        }
        double tsValue = tsNode.asDouble(0);
        if (tsValue == 0) {
            return System.currentTimeMillis();
        }
        // If value < 1e12, it's epoch seconds (possibly fractional); convert to millis
        // If value >= 1e12, it's already epoch millis
        if (tsValue < 1e12) {
            return (long) (tsValue * 1000);
        }
        return (long) tsValue;
    }

    /**
     * Derive quantLabel from score and direction.
     */
    private String deriveQuantLabel(double score, String direction) {
        if ("BULLISH".equals(direction)) {
            if (score >= 75) return "STRONG_BUY";
            if (score >= 60) return "BUY";
        } else if ("BEARISH".equals(direction)) {
            if (score >= 75) return "STRONG_SELL";
            if (score >= 60) return "SELL";
        }
        return "NEUTRAL";
    }

    /**
     * Parse breakdown with proper field mapping from producer's FUDKII fields
     * to the dashboard's 8-category system.
     */
    private QuantScoreDTO.ScoreBreakdown parseBreakdown(JsonNode node, double quantScore, double confidence, JsonNode dqNode) {
        // Read the 8-category scores directly (producer sends these)
        double greeksScore = node.path("greeksScore").asDouble(0);
        double ivSurfaceScore = node.path("ivSurfaceScore").asDouble(0);
        double microstructureScore = node.path("microstructureScore").asDouble(0);
        double optionsFlowScore = node.path("optionsFlowScore").asDouble(0);
        double volumeProfileScore = node.path("volumeProfileScore").asDouble(0);
        double crossInstrumentScore = node.path("crossInstrumentScore").asDouble(0);
        double confluenceScore = node.path("confluenceScore").asDouble(0);

        // priceActionScore: map from patternScore + trendScore if not directly provided
        double priceActionScore = node.path("priceActionScore").asDouble(-1);
        if (priceActionScore < 0) {
            double patternScore = node.path("patternScore").asDouble(0);
            double trendScore = node.path("trendScore").asDouble(0);
            // Combine: pattern (0-100) and trend (0-100) → priceAction (0-100)
            priceActionScore = (patternScore + trendScore) / 2.0;
        }

        // Normalize all raw scores from 0-100 range to their max-point ranges
        double greeksNorm = clampToMax(greeksScore, GREEKS_MAX);
        double ivNorm = clampToMax(ivSurfaceScore, IV_SURFACE_MAX);
        double microNorm = clampToMax(microstructureScore, MICROSTRUCTURE_MAX);
        double optionsNorm = clampToMax(optionsFlowScore, OPTIONS_FLOW_MAX);
        double priceNorm = clampToMax(priceActionScore, PRICE_ACTION_MAX);
        double volumeNorm = clampToMax(volumeProfileScore, VOLUME_PROFILE_MAX);
        double crossNorm = clampToMax(crossInstrumentScore, CROSS_INSTRUMENT_MAX);
        double confNorm = clampToMax(confluenceScore, CONFLUENCE_MAX);

        // Parse DataQuality to determine which categories have data
        boolean hasGreeks = dqNode != null && !dqNode.isMissingNode() && dqNode.path("hasGreeks").asBoolean(false);
        boolean hasIV = dqNode != null && !dqNode.isMissingNode() && dqNode.path("hasIVSurface").asBoolean(false);
        boolean hasMicro = dqNode != null && !dqNode.isMissingNode() ? dqNode.path("hasMicrostructure").asBoolean(true) : true;
        boolean hasOptFlow = dqNode != null && !dqNode.isMissingNode() ? dqNode.path("hasOptionsFlow").asBoolean(true) : true;
        boolean hasPrice = true; // Price action always applicable
        boolean hasVolume = dqNode != null && !dqNode.isMissingNode() ? dqNode.path("hasVolumeProfile").asBoolean(true) : true;
        boolean hasCross = dqNode != null && !dqNode.isMissingNode() && dqNode.path("hasCrossInstrument").asBoolean(false);
        boolean hasConf = true; // Confluence always applicable

        // Parse applicability flags (distinguishes N/A from DM)
        boolean greeksApplicable = dqNode != null && !dqNode.isMissingNode() && dqNode.path("greeksApplicable").asBoolean(false);
        boolean ivApplicable = dqNode != null && !dqNode.isMissingNode() && dqNode.path("ivSurfaceApplicable").asBoolean(false);
        boolean crossApplicable = dqNode != null && !dqNode.isMissingNode() ? dqNode.path("crossInstrumentApplicable").asBoolean(true) : true;

        // Compute applicable max score (only sum max points for categories that HAVE data)
        double applicableMax = 0;
        if (hasGreeks) applicableMax += GREEKS_MAX;
        if (hasIV) applicableMax += IV_SURFACE_MAX;
        if (hasMicro) applicableMax += MICROSTRUCTURE_MAX;
        if (hasOptFlow) applicableMax += OPTIONS_FLOW_MAX;
        if (hasPrice) applicableMax += PRICE_ACTION_MAX;
        if (hasVolume) applicableMax += VOLUME_PROFILE_MAX;
        if (hasCross) applicableMax += CROSS_INSTRUMENT_MAX;
        if (hasConf) applicableMax += CONFLUENCE_MAX;
        if (applicableMax <= 0) applicableMax = 100.0;

        // Sum only applicable categories into rawScore
        double rawScore = 0;
        if (hasGreeks) rawScore += greeksNorm;
        if (hasIV) rawScore += ivNorm;
        if (hasMicro) rawScore += microNorm;
        if (hasOptFlow) rawScore += optionsNorm;
        if (hasPrice) rawScore += priceNorm;
        if (hasVolume) rawScore += volumeNorm;
        if (hasCross) rawScore += crossNorm;
        if (hasConf) rawScore += confNorm;

        // Normalize rawScore to 0-100 scale based on applicable categories
        double normalizedRaw = (rawScore / applicableMax) * 100.0;

        // Derive regimeModifier: stable because it compares only against existing categories
        double regimeModifier = 1.0;
        double confidenceModifier = Math.max(0.8, Math.min(1.0, confidence));
        if (normalizedRaw > 0 && confidenceModifier > 0) {
            regimeModifier = quantScore / (normalizedRaw * confidenceModifier);
            regimeModifier = Math.max(0.7, Math.min(1.3, regimeModifier));
        }

        // Compute percentages with tri-state sentinels:
        //   >= 0  → real score percentage
        //   -1    → N/A (category not applicable for this instrument)
        //   -2    → DM  (data missing: applicable but not yet available)
        double greeksPct = hasGreeks ? (greeksNorm / GREEKS_MAX) * 100
                         : greeksApplicable ? -2 : -1;
        double ivPct = hasIV ? (ivNorm / IV_SURFACE_MAX) * 100
                     : ivApplicable ? -2 : -1;
        double microPct = MICROSTRUCTURE_MAX > 0 ? (microNorm / MICROSTRUCTURE_MAX) * 100 : 0;
        double optionsPct = OPTIONS_FLOW_MAX > 0 ? (optionsNorm / OPTIONS_FLOW_MAX) * 100 : 0;
        double pricePct = PRICE_ACTION_MAX > 0 ? (priceNorm / PRICE_ACTION_MAX) * 100 : 0;
        double volumePct = VOLUME_PROFILE_MAX > 0 ? (volumeNorm / VOLUME_PROFILE_MAX) * 100 : 0;
        double crossPct = hasCross ? (crossNorm / CROSS_INSTRUMENT_MAX) * 100
                        : crossApplicable ? -2 : -1;
        double confPct = CONFLUENCE_MAX > 0 ? (confNorm / CONFLUENCE_MAX) * 100 : 0;

        return QuantScoreDTO.ScoreBreakdown.builder()
                .greeksScore(greeksNorm)
                .ivSurfaceScore(ivNorm)
                .microstructureScore(microNorm)
                .optionsFlowScore(optionsNorm)
                .priceActionScore(priceNorm)
                .volumeProfileScore(volumeNorm)
                .crossInstrumentScore(crossNorm)
                .confluenceScore(confNorm)
                .greeksPct(greeksPct)
                .ivSurfacePct(ivPct)
                .microstructurePct(microPct)
                .optionsFlowPct(optionsPct)
                .priceActionPct(pricePct)
                .volumeProfilePct(volumePct)
                .crossInstrumentPct(crossPct)
                .confluencePct(confPct)
                .rawScore(rawScore)
                .regimeModifier(regimeModifier)
                .confidenceModifier(confidenceModifier)
                .build();
    }

    /**
     * Clamp a 0-100 raw score to a category's max points.
     * E.g., raw 100 with max 18 → 18, raw 50 with max 18 → 9.
     */
    private double clampToMax(double rawScore0to100, double maxPoints) {
        if (rawScore0to100 <= 0) return 0;
        double scaled = (Math.abs(rawScore0to100) / 100.0) * maxPoints;
        return Math.min(scaled, maxPoints);
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
        String oiBuildupType = node.path("oiBuildupType").asText(null);
        String futuresBuildup = node.path("futuresBuildup").asText(null);

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
                .totalCallOI(getOptionalLong(node, "totalCallOI"))
                .totalPutOI(getOptionalLong(node, "totalPutOI"))
                .totalCallOIChange(getOptionalLong(node, "totalCallOIChange"))
                .totalPutOIChange(getOptionalLong(node, "totalPutOIChange"))
                .build();
    }

    private Long getOptionalLong(JsonNode parent, String field) {
        JsonNode node = parent.path(field);
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
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
                .greeksApplicable(node.path("greeksApplicable").asBoolean(false))
                .ivSurfaceApplicable(node.path("ivSurfaceApplicable").asBoolean(false))
                .crossInstrumentApplicable(node.path("crossInstrumentApplicable").asBoolean(true))
                .completenessScore(node.path("completenessScore").asDouble(0))
                .qualityLevel(node.path("qualityLevel").asText("MINIMAL"))
                .build();
    }

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
