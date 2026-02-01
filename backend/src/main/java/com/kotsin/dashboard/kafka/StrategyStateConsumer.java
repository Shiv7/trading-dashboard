package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.strategy.*;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

/**
 * Kafka consumer for instrument state snapshots.
 * Consumes from: instrument-state-snapshots
 *
 * Provides full transparency into strategy states for the dashboard.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class StrategyStateConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache all instrument states
    private final Map<String, InstrumentStateSnapshotDTO> stateCache = new ConcurrentHashMap<>();

    // Cache only WATCHING instruments
    private final Map<String, InstrumentStateSnapshotDTO> watchingCache = new ConcurrentHashMap<>();

    @KafkaListener(
            topics = {"instrument-state-snapshots"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onStateSnapshot(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            String scripCode = root.path("scripCode").asText();

            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in state snapshot, skipping");
                return;
            }

            InstrumentStateSnapshotDTO snapshot = parseSnapshot(root);

            // Update caches
            stateCache.put(scripCode, snapshot);

            if ("WATCHING".equals(snapshot.getState())) {
                watchingCache.put(scripCode, snapshot);
                log.debug("[STRATEGY_STATE] {} now WATCHING | setups={}",
                        scripCode, snapshot.getActiveSetups() != null ? snapshot.getActiveSetups().size() : 0);
            } else {
                watchingCache.remove(scripCode);
            }

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "STRATEGY_STATE_UPDATE",
                    "scripCode", scripCode,
                    "state", snapshot.getState(),
                    "data", snapshot
            ));

        } catch (Exception e) {
            log.error("Error processing state snapshot: {}", e.getMessage(), e);
        }
    }

    private InstrumentStateSnapshotDTO parseSnapshot(JsonNode root) {
        InstrumentStateSnapshotDTO.InstrumentStateSnapshotDTOBuilder builder = InstrumentStateSnapshotDTO.builder()
                .scripCode(root.path("scripCode").asText())
                .companyName(root.path("companyName").asText())
                .state(root.path("state").asText())
                .stateTimestamp(root.path("stateTimestamp").asLong())
                .stateEntryTime(root.path("stateEntryTime").asLong())
                .stateDurationMs(root.path("stateDurationMs").asLong())
                .currentPrice(root.path("currentPrice").asDouble())
                .ofiZscore(root.path("ofiZscore").asDouble())
                .atr(root.path("atr").asDouble())
                .vpin(root.path("vpin").asDouble())
                .superTrendBullish(root.path("superTrendBullish").asBoolean())
                .superTrendFlip(root.path("superTrendFlip").asBoolean())
                .bbPercentB(root.path("bbPercentB").asDouble())
                .bbSqueezing(root.path("bbSqueezing").asBoolean())
                .cooldownRemainingMs(root.path("cooldownRemainingMs").asLong())
                .signalsToday(root.path("signalsToday").asInt())
                .maxSignalsPerDay(root.path("maxSignalsPerDay").asInt());

        // Parse active setups
        JsonNode setupsNode = root.path("activeSetups");
        if (setupsNode.isArray()) {
            List<ActiveSetupInfoDTO> setups = new ArrayList<>();
            for (JsonNode setupNode : setupsNode) {
                setups.add(parseActiveSetup(setupNode));
            }
            builder.activeSetups(setups);
        }

        // Parse position
        JsonNode positionNode = root.path("position");
        if (!positionNode.isMissingNode() && !positionNode.isNull()) {
            builder.position(parsePosition(positionNode));
        }

        return builder.build();
    }

    private ActiveSetupInfoDTO parseActiveSetup(JsonNode node) {
        ActiveSetupInfoDTO.ActiveSetupInfoDTOBuilder builder = ActiveSetupInfoDTO.builder()
                .strategyId(node.path("strategyId").asText())
                .setupDescription(node.path("setupDescription").asText())
                .direction(node.path("direction").asText())
                .keyLevel(node.path("keyLevel").asDouble())
                .watchingStartTime(node.path("watchingStartTime").asLong())
                .watchingDurationMs(node.path("watchingDurationMs").asLong())
                .progressPercent(node.path("progressPercent").asInt())
                .blockingCondition(node.path("blockingCondition").asText(null))
                .qualityTier(node.path("qualityTier").asText(null))
                .readyForEntry(node.path("readyForEntry").asBoolean())
                .notReadyReason(node.path("notReadyReason").asText(null));

        // Parse basic conditions
        JsonNode conditionsNode = node.path("conditions");
        if (conditionsNode.isArray()) {
            List<ConditionCheckDTO> conditions = new ArrayList<>();
            for (JsonNode condNode : conditionsNode) {
                conditions.add(ConditionCheckDTO.builder()
                        .conditionName(condNode.path("conditionName").asText())
                        .passed(condNode.path("passed").asBoolean())
                        .currentValue(condNode.path("currentValue").asDouble())
                        .requiredValue(condNode.path("requiredValue").asDouble())
                        .comparison(condNode.path("comparison").asText())
                        .progressPercent(condNode.path("progressPercent").asInt())
                        .displayValue(condNode.path("displayValue").asText())
                        .build());
            }
            builder.conditions(conditions);
        }

        // Parse detailed conditions
        JsonNode detailedNode = node.path("detailedConditions");
        if (detailedNode.isArray()) {
            List<StrategyConditionDTO> detailed = new ArrayList<>();
            for (JsonNode dc : detailedNode) {
                detailed.add(StrategyConditionDTO.builder()
                        .name(dc.path("name").asText())
                        .category(dc.path("category").asText())
                        .passed(dc.path("passed").asBoolean())
                        .currentValue(dc.path("currentValue").asText())
                        .requiredValue(dc.path("requiredValue").asText())
                        .explanation(dc.path("explanation").asText())
                        .progressPercent(dc.path("progressPercent").asInt())
                        .source(dc.path("source").asText(null))
                        .timeframe(dc.path("timeframe").asText(null))
                        .notes(dc.path("notes").asText(null))
                        .build());
            }
            builder.detailedConditions(detailed);
        }

        // Parse MTF analysis
        JsonNode mtfNode = node.path("mtfAnalysis");
        if (!mtfNode.isMissingNode() && !mtfNode.isNull()) {
            builder.mtfAnalysis(parseMtfAnalysis(mtfNode));
        }

        return builder.build();
    }

    private MtfAnalysisDTO parseMtfAnalysis(JsonNode node) {
        return MtfAnalysisDTO.builder()
                .htfTimeframe(node.path("htfTimeframe").asText())
                .ltfTimeframe(node.path("ltfTimeframe").asText())
                .htfBias(node.path("htfBias").asText())
                .ltfBias(node.path("ltfBias").asText())
                .biasAligned(node.path("biasAligned").asBoolean())
                .htfStructure(node.path("htfStructure").asText())
                .ltfStructure(node.path("ltfStructure").asText())
                .swingHigh(node.path("swingHigh").asDouble())
                .swingLow(node.path("swingLow").asDouble())
                .equilibrium(node.path("equilibrium").asDouble())
                .zonePosition(node.path("zonePosition").asText())
                .rangePositionPercent(node.path("rangePositionPercent").asDouble())
                .swingSizePercent(node.path("swingSizePercent").asDouble())
                .isUpswing(node.path("isUpswing").asBoolean())
                .flowStatus(node.path("flowStatus").asText())
                .flowInterpretation(node.path("flowInterpretation").asText())
                .flowReason(node.path("flowReason").asText())
                .flowConfidence(node.path("flowConfidence").isNull() ? null : node.path("flowConfidence").asDouble())
                .completedSteps(node.path("completedSteps").asInt())
                .totalSteps(node.path("totalSteps").asInt())
                .completedStepNames(parseStringList(node.path("completedStepNames")))
                .missingStepNames(parseStringList(node.path("missingStepNames")))
                .coreRequirementsMet(node.path("coreRequirementsMet").asBoolean())
                .fullSequenceMet(node.path("fullSequenceMet").asBoolean())
                .qualityTier(node.path("qualityTier").asText())
                .qualityTierDisplay(node.path("qualityTierDisplay").asText())
                .qualitySummary(node.path("qualitySummary").asText())
                .qualityReasons(parseStringList(node.path("qualityReasons")))
                .qualityScore(node.path("qualityScore").asInt())
                .atHtfDemand(node.path("atHtfDemand").asBoolean())
                .atHtfSupply(node.path("atHtfSupply").asBoolean())
                .ltfSweepDetected(node.path("ltfSweepDetected").asBoolean())
                .ltfSweepSide(node.path("ltfSweepSide").asText(null))
                .ltfChochDetected(node.path("ltfChochDetected").asBoolean())
                .ltfChochDirection(node.path("ltfChochDirection").asText(null))
                .ltfBosDetected(node.path("ltfBosDetected").asBoolean())
                .ltfBosDirection(node.path("ltfBosDirection").asText(null))
                .build();
    }

    private PositionInfoDTO parsePosition(JsonNode node) {
        return PositionInfoDTO.builder()
                .direction(node.path("direction").asText())
                .entryPrice(node.path("entryPrice").asDouble())
                .currentPrice(node.path("currentPrice").asDouble())
                .stopLoss(node.path("stopLoss").asDouble())
                .takeProfit(node.path("takeProfit").asDouble())
                .unrealizedPnl(node.path("unrealizedPnl").asDouble())
                .unrealizedPnlPercent(node.path("unrealizedPnlPercent").asDouble())
                .entryTime(node.path("entryTime").asLong())
                .holdingDurationMs(node.path("holdingDurationMs").asLong())
                .strategyId(node.path("strategyId").asText())
                .signalId(node.path("signalId").asText())
                .build();
    }

    private List<String> parseStringList(JsonNode node) {
        if (node == null || !node.isArray()) {
            return Collections.emptyList();
        }
        return StreamSupport.stream(node.spliterator(), false)
                .map(JsonNode::asText)
                .collect(Collectors.toList());
    }

    // ============ PUBLIC ACCESSORS ============

    public InstrumentStateSnapshotDTO getState(String scripCode) {
        return stateCache.get(scripCode);
    }

    public List<InstrumentStateSnapshotDTO> getAllStates() {
        return new ArrayList<>(stateCache.values());
    }

    public List<InstrumentStateSnapshotDTO> getWatchingInstruments() {
        return new ArrayList<>(watchingCache.values());
    }

    public int getWatchingCount() {
        return watchingCache.size();
    }

    public int getTotalCount() {
        return stateCache.size();
    }
}
