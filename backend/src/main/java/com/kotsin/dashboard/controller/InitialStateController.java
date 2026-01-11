package com.kotsin.dashboard.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.kotsin.dashboard.kafka.*;
import com.kotsin.dashboard.model.dto.FamilyScoreDTO;
import com.kotsin.dashboard.model.dto.QuantScoreDTO;
import com.kotsin.dashboard.service.ScoreExplainerService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * REST controller for initial state data.
 *
 * Returns all cached data from Kafka consumers so the frontend can
 * populate the store immediately on page load instead of waiting
 * for new Kafka messages.
 */
@RestController
@RequestMapping("/api/state")
@RequiredArgsConstructor
@Slf4j
public class InitialStateController {

    private final ScoreExplainerService scoreExplainerService;
    private final QuantScoreConsumer quantScoreConsumer;
    private final MarketIntelligenceConsumer marketIntelligenceConsumer;
    private final SignalConsumer signalConsumer;
    private final ACLConsumer aclConsumer;
    private final FUDKIIConsumer fudkiiConsumer;

    /**
     * Get all initial state data for dashboard.
     *
     * This endpoint returns ALL cached data from Kafka consumers so the frontend
     * can immediately display data on page load instead of waiting for new messages.
     *
     * @return Map containing all cached state
     */
    @GetMapping("/initial")
    public ResponseEntity<Map<String, Object>> getInitialState() {
        log.info("Fetching initial state for dashboard");

        Map<String, Object> state = new HashMap<>();

        try {
            // Family Scores (MTIS)
            List<FamilyScoreDTO> scores = scoreExplainerService.getAllScores();
            state.put("scores", scores);
            log.debug("Initial state: {} family scores", scores.size());

            // Quant Scores
            List<QuantScoreDTO> quantScores = quantScoreConsumer.getAllScoresSorted();
            state.put("quantScores", quantScores);
            log.debug("Initial state: {} quant scores", quantScores.size());

            // Market Narratives
            Map<String, JsonNode> narratives = marketIntelligenceConsumer.getAllNarratives();
            state.put("narratives", narratives);
            log.debug("Initial state: {} narratives", narratives.size());

            // Market Intelligence
            Map<String, JsonNode> intelligence = marketIntelligenceConsumer.getAllIntelligence();
            state.put("intelligence", intelligence);
            log.debug("Initial state: {} intelligence entries", intelligence.size());

            // Recent Signals (last 100)
            List<?> signals = signalConsumer.getRecentSignals(100);
            state.put("signals", signals);
            log.debug("Initial state: {} recent signals", signals.size());

            // ACL States
            Map<String, Map<String, Object>> aclStates = aclConsumer.getAllACLStates();
            state.put("aclStates", aclStates);
            log.debug("Initial state: {} ACL states", aclStates.size());

            // Active FUDKII Ignitions
            Map<String, Map<String, Object>> ignitions = fudkiiConsumer.getActiveIgnitions();
            state.put("activeIgnitions", ignitions.values());
            log.debug("Initial state: {} active ignitions", ignitions.size());

            // Metadata
            state.put("timestamp", System.currentTimeMillis());
            state.put("dataAvailable", !scores.isEmpty() || !quantScores.isEmpty());

            log.info("Initial state fetched: {} scores, {} quantScores, {} narratives, {} signals",
                scores.size(), quantScores.size(), narratives.size(), signals.size());

        } catch (Exception e) {
            log.error("Error fetching initial state: {}", e.getMessage(), e);
            state.put("error", e.getMessage());
        }

        return ResponseEntity.ok(state);
    }

    /**
     * Get minimal initial state (just scores) for faster load
     */
    @GetMapping("/initial/minimal")
    public ResponseEntity<Map<String, Object>> getMinimalInitialState() {
        Map<String, Object> state = new HashMap<>();

        List<FamilyScoreDTO> scores = scoreExplainerService.getAllScores();
        state.put("scores", scores);

        List<QuantScoreDTO> quantScores = quantScoreConsumer.getAllScoresSorted();
        state.put("quantScores", quantScores);

        state.put("timestamp", System.currentTimeMillis());

        return ResponseEntity.ok(state);
    }
}
