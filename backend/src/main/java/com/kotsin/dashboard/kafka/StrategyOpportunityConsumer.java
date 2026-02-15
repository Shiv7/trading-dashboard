package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.strategy.ConditionCheckDTO;
import com.kotsin.dashboard.model.dto.strategy.StrategyOpportunityDTO;
import com.kotsin.dashboard.service.ScripLookupService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

/**
 * Kafka consumer for strategy opportunities (near-signal instruments).
 * Consumes from: strategy-opportunities
 *
 * Provides ranked list of instruments close to triggering signals.
 * Automatically clears all data at the start of each new trading day.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class StrategyOpportunityConsumer {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final WebSocketSessionManager sessionManager;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache opportunities, keyed by scripCode_strategyId
    private final Map<String, StrategyOpportunityDTO> opportunityCache = new ConcurrentHashMap<>();

    // Keep last update timestamp per key for staleness checks
    private final Map<String, Long> lastUpdateTime = new ConcurrentHashMap<>();

    // Track the current trading session date for daily reset
    private final AtomicReference<LocalDate> currentSessionDate = new AtomicReference<>(LocalDate.now(IST));

    // Opportunities older than this are considered stale (35 minutes — covers 30m candle cycle)
    private static final long STALE_THRESHOLD_MS = 35 * 60 * 1000;

    @KafkaListener(
            topics = {"strategy-opportunities"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onOpportunity(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            String scripCode = root.path("scripCode").asText();
            String strategyId = root.path("strategyId").asText();

            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in opportunity message, skipping");
                return;
            }

            StrategyOpportunityDTO opportunity = parseOpportunity(root);
            String key = scripCode + "_" + strategyId;

            // Update cache
            opportunityCache.put(key, opportunity);
            lastUpdateTime.put(key, System.currentTimeMillis());

            // Log high-score opportunities
            if (opportunity.getOpportunityScore() >= 70) {
                log.info("[OPPORTUNITY] {} {} {} | score={}% | next={}",
                        scripCode, strategyId, opportunity.getDirection(),
                        String.format("%.0f", opportunity.getOpportunityScore()),
                        opportunity.getNextConditionNeeded());
            }

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "STRATEGY_OPPORTUNITY",
                    "scripCode", scripCode,
                    "strategyId", strategyId,
                    "score", opportunity.getOpportunityScore(),
                    "data", opportunity
            ));

        } catch (Exception e) {
            log.error("Error processing opportunity: {}", e.getMessage(), e);
        }
    }

    private StrategyOpportunityDTO parseOpportunity(JsonNode root) {
        StrategyOpportunityDTO.StrategyOpportunityDTOBuilder builder = StrategyOpportunityDTO.builder()
                .scripCode(root.path("scripCode").asText())
                .companyName(scripLookup.resolve(root.path("scripCode").asText(), root.path("companyName").asText("")))
                .strategyId(root.path("strategyId").asText())
                .direction(root.path("direction").asText())
                .opportunityScore(root.path("opportunityScore").asDouble())
                .nextConditionNeeded(root.path("nextConditionNeeded").asText())
                .estimatedTimeframe(root.path("estimatedTimeframe").asText())
                .currentPrice(root.path("currentPrice").asDouble())
                .entryLevel(root.path("entryLevel").asDouble())
                .keyLevel(root.path("keyLevel").asDouble())
                .target2(root.path("target2").asDouble())
                .superTrendLevel(root.path("superTrendLevel").asDouble())
                .expectedRR(root.path("expectedRR").asDouble())
                .timestamp(System.currentTimeMillis())
                .strategyContext(root.has("strategyContext") ? root.path("strategyContext").asText() : null)
                .tradingMode(root.has("tradingMode") ? root.path("tradingMode").asText() : null);

        // Parse conditions
        JsonNode conditionsNode = root.path("conditions");
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

        return builder.build();
    }

    // ============ PUBLIC ACCESSORS ============

    /**
     * Get all opportunities, sorted by score descending.
     */
    public List<StrategyOpportunityDTO> getAllOpportunities() {
        cleanupStale();
        return opportunityCache.values().stream()
                .sorted(Comparator.comparingDouble(StrategyOpportunityDTO::getOpportunityScore).reversed())
                .collect(Collectors.toList());
    }

    /**
     * Get top N opportunities by score.
     */
    public List<StrategyOpportunityDTO> getTopOpportunities(int limit) {
        return getAllOpportunities().stream()
                .limit(limit)
                .collect(Collectors.toList());
    }

    /**
     * Get opportunities for a specific strategy.
     */
    public List<StrategyOpportunityDTO> getOpportunitiesByStrategy(String strategyId) {
        cleanupStale();
        return opportunityCache.values().stream()
                .filter(o -> strategyId.equals(o.getStrategyId()))
                .sorted(Comparator.comparingDouble(StrategyOpportunityDTO::getOpportunityScore).reversed())
                .collect(Collectors.toList());
    }

    /**
     * Get opportunity for a specific scripCode and strategy.
     */
    public StrategyOpportunityDTO getOpportunity(String scripCode, String strategyId) {
        String key = scripCode + "_" + strategyId;
        return opportunityCache.get(key);
    }

    /**
     * Get opportunities with score >= threshold.
     */
    public List<StrategyOpportunityDTO> getHighScoreOpportunities(double threshold) {
        cleanupStale();
        return opportunityCache.values().stream()
                .filter(o -> o.getOpportunityScore() >= threshold)
                .sorted(Comparator.comparingDouble(StrategyOpportunityDTO::getOpportunityScore).reversed())
                .collect(Collectors.toList());
    }

    /**
     * Get count of opportunities.
     */
    public int getOpportunityCount() {
        cleanupStale();
        return opportunityCache.size();
    }

    /**
     * Remove stale opportunities and clear all data on new trading day.
     */
    private void cleanupStale() {
        // Daily session reset — clear everything when a new day starts
        LocalDate today = LocalDate.now(IST);
        LocalDate lastSession = currentSessionDate.get();
        if (!today.equals(lastSession) && currentSessionDate.compareAndSet(lastSession, today)) {
            int cleared = opportunityCache.size();
            opportunityCache.clear();
            lastUpdateTime.clear();
            if (cleared > 0) {
                log.info("[OPPORTUNITY] New trading session {} — cleared {} previous-day opportunities", today, cleared);
            }
            return;
        }

        long now = System.currentTimeMillis();
        List<String> staleKeys = lastUpdateTime.entrySet().stream()
                .filter(e -> now - e.getValue() > STALE_THRESHOLD_MS)
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());

        for (String key : staleKeys) {
            opportunityCache.remove(key);
            lastUpdateTime.remove(key);
        }

        if (!staleKeys.isEmpty()) {
            log.debug("[OPPORTUNITY] Cleaned up {} stale opportunities", staleKeys.size());
        }
    }
}
