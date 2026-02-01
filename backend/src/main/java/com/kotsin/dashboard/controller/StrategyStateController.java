package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.StrategyOpportunityConsumer;
import com.kotsin.dashboard.kafka.StrategyStateConsumer;
import com.kotsin.dashboard.model.dto.strategy.InstrumentStateSnapshotDTO;
import com.kotsin.dashboard.model.dto.strategy.StrategyOpportunityDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * REST controller for strategy state transparency.
 *
 * Provides endpoints to view:
 * - Instrument states (IDLE, WATCHING, READY, POSITIONED, COOLDOWN)
 * - Active setups with detailed conditions (current vs required)
 * - MTF analysis details
 * - Near-signal opportunities ranked by readiness
 */
@RestController
@RequestMapping("/api/strategy-state")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class StrategyStateController {

    private final StrategyStateConsumer stateConsumer;
    private final StrategyOpportunityConsumer opportunityConsumer;

    /**
     * Get all tracked instrument states.
     *
     * @return List of all instrument state snapshots
     */
    @GetMapping
    public ResponseEntity<List<InstrumentStateSnapshotDTO>> getAllStates() {
        List<InstrumentStateSnapshotDTO> states = stateConsumer.getAllStates();
        log.debug("[API] GET /strategy-state | {} instruments", states.size());
        return ResponseEntity.ok(states);
    }

    /**
     * Get state for a specific instrument.
     *
     * @param scripCode The scrip/instrument code
     * @return Instrument state snapshot or 404
     */
    @GetMapping("/{scripCode}")
    public ResponseEntity<InstrumentStateSnapshotDTO> getState(@PathVariable String scripCode) {
        InstrumentStateSnapshotDTO state = stateConsumer.getState(scripCode);
        if (state == null) {
            log.debug("[API] GET /strategy-state/{} | not found", scripCode);
            return ResponseEntity.notFound().build();
        }
        log.debug("[API] GET /strategy-state/{} | state={}", scripCode, state.getState());
        return ResponseEntity.ok(state);
    }

    /**
     * Get all WATCHING instruments with active setups.
     *
     * @return List of instruments currently in WATCHING state
     */
    @GetMapping("/watching")
    public ResponseEntity<List<InstrumentStateSnapshotDTO>> getWatchingInstruments() {
        List<InstrumentStateSnapshotDTO> watching = stateConsumer.getWatchingInstruments();
        log.debug("[API] GET /strategy-state/watching | {} instruments", watching.size());
        return ResponseEntity.ok(watching);
    }

    /**
     * Get all near-signal opportunities, ranked by readiness score.
     *
     * @param limit Optional limit on number of results (default: all)
     * @param minScore Optional minimum score threshold (default: 0)
     * @return List of strategy opportunities
     */
    @GetMapping("/opportunities")
    public ResponseEntity<List<StrategyOpportunityDTO>> getOpportunities(
            @RequestParam(required = false, defaultValue = "100") int limit,
            @RequestParam(required = false, defaultValue = "0") double minScore) {

        List<StrategyOpportunityDTO> opportunities;

        if (minScore > 0) {
            opportunities = opportunityConsumer.getHighScoreOpportunities(minScore);
        } else {
            opportunities = opportunityConsumer.getTopOpportunities(limit);
        }

        log.debug("[API] GET /strategy-state/opportunities | {} results (limit={}, minScore={})",
                opportunities.size(), limit, minScore);
        return ResponseEntity.ok(opportunities);
    }

    /**
     * Get opportunities for a specific strategy.
     *
     * @param strategyId Strategy identifier (e.g., "INST_PIVOT", "FUDKII")
     * @return List of opportunities for that strategy
     */
    @GetMapping("/opportunities/strategy/{strategyId}")
    public ResponseEntity<List<StrategyOpportunityDTO>> getOpportunitiesByStrategy(
            @PathVariable String strategyId) {

        List<StrategyOpportunityDTO> opportunities = opportunityConsumer.getOpportunitiesByStrategy(strategyId);
        log.debug("[API] GET /strategy-state/opportunities/strategy/{} | {} results",
                strategyId, opportunities.size());
        return ResponseEntity.ok(opportunities);
    }

    /**
     * Get opportunity for a specific instrument and strategy.
     *
     * @param scripCode  The scrip/instrument code
     * @param strategyId Strategy identifier
     * @return Opportunity or 404
     */
    @GetMapping("/opportunities/{scripCode}/{strategyId}")
    public ResponseEntity<StrategyOpportunityDTO> getOpportunity(
            @PathVariable String scripCode,
            @PathVariable String strategyId) {

        StrategyOpportunityDTO opportunity = opportunityConsumer.getOpportunity(scripCode, strategyId);
        if (opportunity == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(opportunity);
    }

    /**
     * Get summary statistics.
     *
     * @return Statistics object with counts
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalInstruments", stateConsumer.getTotalCount());
        stats.put("watchingInstruments", stateConsumer.getWatchingCount());
        stats.put("totalOpportunities", opportunityConsumer.getOpportunityCount());
        stats.put("highScoreOpportunities", opportunityConsumer.getHighScoreOpportunities(70).size());

        log.debug("[API] GET /strategy-state/stats | {}", stats);
        return ResponseEntity.ok(stats);
    }
}
