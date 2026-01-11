package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.QuantScoreDTO;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Kafka consumer for quant-scores topic.
 * Receives QuantScore from StreamingCandle and broadcasts to WebSocket clients.
 * Maintains sorted cache for REST API endpoints.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class QuantScoreConsumer {

    private final WebSocketSessionManager sessionManager;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache for latest quant scores
    private final Map<String, QuantScoreDTO> latestScores = new ConcurrentHashMap<>();

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

            log.info("Received quant-score for {} (score={:.1f}, label={}, actionable={})",
                familyId, dto.getQuantScore(), dto.getQuantLabel(), dto.isActionable());

            // Cache latest score
            latestScores.put(familyId, dto);

            // Broadcast to WebSocket
            sessionManager.broadcastQuantScore(familyId, dto);

        } catch (Exception e) {
            log.error("Error processing quant-scores: {}", e.getMessage(), e);
        }
    }

    /**
     * Get latest quant score for a scripCode
     */
    public QuantScoreDTO getLatestScore(String scripCode) {
        return latestScores.get(scripCode);
    }

    /**
     * Get all quant scores sorted by score descending
     */
    public List<QuantScoreDTO> getAllScoresSorted() {
        return latestScores.values().stream()
                .sorted((a, b) -> Double.compare(b.getQuantScore(), a.getQuantScore()))
                .collect(Collectors.toList());
    }

    /**
     * Get top N actionable scores
     */
    public List<QuantScoreDTO> getTopActionableScores(int limit) {
        return latestScores.values().stream()
                .filter(QuantScoreDTO::isActionable)
                .sorted((a, b) -> Double.compare(b.getQuantScore(), a.getQuantScore()))
                .limit(limit)
                .collect(Collectors.toList());
    }

    /**
     * Get scores filtered by direction
     */
    public List<QuantScoreDTO> getScoresByDirection(String direction) {
        return latestScores.values().stream()
                .filter(s -> direction.equalsIgnoreCase(s.getDirection()))
                .sorted((a, b) -> Double.compare(b.getQuantScore(), a.getQuantScore()))
                .collect(Collectors.toList());
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

        // Convert "null" string to actual null
        if ("null".equals(oiBuildupType) || oiBuildupType != null && oiBuildupType.isEmpty()) {
            oiBuildupType = null;
        }
        if ("null".equals(futuresBuildup) || futuresBuildup != null && futuresBuildup.isEmpty()) {
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
                .build();
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
