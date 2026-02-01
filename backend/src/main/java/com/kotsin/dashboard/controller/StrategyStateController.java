package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.FUDKIIConsumer;
import com.kotsin.dashboard.kafka.PivotConfluenceConsumer;
import com.kotsin.dashboard.kafka.StrategyOpportunityConsumer;
import com.kotsin.dashboard.kafka.StrategyStateConsumer;
import com.kotsin.dashboard.kafka.TradingSignalConsumer;
import com.kotsin.dashboard.model.dto.strategy.InstrumentStateSnapshotDTO;
import com.kotsin.dashboard.model.dto.strategy.StrategyOpportunityDTO;
import com.kotsin.dashboard.service.TradingSignalService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
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
    private final FUDKIIConsumer fudkiiConsumer;
    private final PivotConfluenceConsumer pivotConfluenceConsumer;
    private final TradingSignalService tradingSignalService;

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

    // ==================== FUDKII STRATEGY ENDPOINTS ====================

    /**
     * Get all active FUDKII ignitions.
     * These are instruments where the FUDKII trigger fired (ST flip + BB outside).
     *
     * @return Map of scripCode to FUDKII signal data
     */
    @GetMapping("/fudkii/active")
    public ResponseEntity<Map<String, Map<String, Object>>> getActiveFudkiiIgnitions() {
        Map<String, Map<String, Object>> ignitions = fudkiiConsumer.getActiveIgnitions();
        log.debug("[API] GET /strategy-state/fudkii/active | {} active ignitions", ignitions.size());
        return ResponseEntity.ok(ignitions);
    }

    /**
     * Get active FUDKII ignitions as a list.
     *
     * @return List of FUDKII signal data
     */
    @GetMapping("/fudkii/active/list")
    public ResponseEntity<List<Map<String, Object>>> getActiveFudkiiIgnitionsList() {
        Map<String, Map<String, Object>> ignitions = fudkiiConsumer.getActiveIgnitions();
        List<Map<String, Object>> list = new ArrayList<>(ignitions.values());
        log.debug("[API] GET /strategy-state/fudkii/active/list | {} active ignitions", list.size());
        return ResponseEntity.ok(list);
    }

    /**
     * Get FUDKII signal for a specific instrument.
     *
     * @param scripCode The scrip code
     * @return FUDKII signal data or 404
     */
    @GetMapping("/fudkii/{scripCode}")
    public ResponseEntity<Map<String, Object>> getFudkiiSignal(@PathVariable String scripCode) {
        Map<String, Object> signal = fudkiiConsumer.getLatestFUDKII(scripCode);
        if (signal == null) {
            return ResponseEntity.notFound().build();
        }
        log.debug("[API] GET /strategy-state/fudkii/{} | ignition={}", scripCode, signal.get("ignitionFlag"));
        return ResponseEntity.ok(signal);
    }

    /**
     * Get FUDKII ignition count.
     *
     * @return Count of active ignitions
     */
    @GetMapping("/fudkii/count")
    public ResponseEntity<Map<String, Object>> getFudkiiCount() {
        int count = fudkiiConsumer.getActiveIgnitionCount();
        return ResponseEntity.ok(Map.of(
                "activeIgnitions", count,
                "timestamp", System.currentTimeMillis()
        ));
    }

    // ==================== PIVOT CONFLUENCE STRATEGY ENDPOINTS ====================

    /**
     * Get all active Pivot Confluence triggers.
     * These are instruments where HTF+LTF+Pivot+SMC confluence triggered.
     *
     * @return Map of scripCode to Pivot signal data
     */
    @GetMapping("/pivot/active")
    public ResponseEntity<Map<String, Map<String, Object>>> getActivePivotTriggers() {
        Map<String, Map<String, Object>> triggers = pivotConfluenceConsumer.getActiveTriggers();
        log.debug("[API] GET /strategy-state/pivot/active | {} active triggers", triggers.size());
        return ResponseEntity.ok(triggers);
    }

    /**
     * Get active Pivot Confluence triggers as a list.
     *
     * @return List of Pivot signal data
     */
    @GetMapping("/pivot/active/list")
    public ResponseEntity<List<Map<String, Object>>> getActivePivotTriggersList() {
        Map<String, Map<String, Object>> triggers = pivotConfluenceConsumer.getActiveTriggers();
        List<Map<String, Object>> list = new ArrayList<>(triggers.values());
        log.debug("[API] GET /strategy-state/pivot/active/list | {} active triggers", list.size());
        return ResponseEntity.ok(list);
    }

    /**
     * Get Pivot Confluence signal for a specific instrument.
     *
     * @param scripCode The scrip code
     * @return Pivot signal data or 404
     */
    @GetMapping("/pivot/{scripCode}")
    public ResponseEntity<Map<String, Object>> getPivotSignal(@PathVariable String scripCode) {
        Map<String, Object> signal = pivotConfluenceConsumer.getLatestPivotSignal(scripCode);
        if (signal == null) {
            return ResponseEntity.notFound().build();
        }
        log.debug("[API] GET /strategy-state/pivot/{} | triggered={}", scripCode, signal.get("triggered"));
        return ResponseEntity.ok(signal);
    }

    /**
     * Get Pivot Confluence trigger count.
     *
     * @return Count of active triggers
     */
    @GetMapping("/pivot/count")
    public ResponseEntity<Map<String, Object>> getPivotCount() {
        int count = pivotConfluenceConsumer.getActiveTriggerCount();
        return ResponseEntity.ok(Map.of(
                "activeTriggers", count,
                "timestamp", System.currentTimeMillis()
        ));
    }

    // ==================== COMBINED STRATEGY SIGNALS ====================

    /**
     * Get combined strategy signals (FUDKII + Pivot + Trading Signals).
     * Shows all active strategy triggers with their details.
     *
     * @return Combined strategy signal summary
     */
    @GetMapping("/signals/active")
    public ResponseEntity<Map<String, Object>> getActiveStrategySignals() {
        Map<String, Object> result = new HashMap<>();

        // FUDKII signals (Strategy 1: SuperTrend + BB on 30m)
        Map<String, Map<String, Object>> fudkiiIgnitions = fudkiiConsumer.getActiveIgnitions();
        result.put("fudkiiSignals", new ArrayList<>(fudkiiIgnitions.values()));
        result.put("fudkiiCount", fudkiiIgnitions.size());

        // Pivot Confluence signals (Strategy 2: HTF/LTF + Pivot + SMC)
        Map<String, Map<String, Object>> pivotTriggers = pivotConfluenceConsumer.getActiveTriggers();
        result.put("pivotSignals", new ArrayList<>(pivotTriggers.values()));
        result.put("pivotCount", pivotTriggers.size());

        // Trading signals (includes both FUDKII and PIVOT triggered)
        var pendingSignals = tradingSignalService.getPendingSignals();
        result.put("tradingSignals", pendingSignals);
        result.put("tradingSignalCount", pendingSignals.size());

        // Opportunities (near-trigger)
        var opportunities = opportunityConsumer.getTopOpportunities(20);
        result.put("opportunities", opportunities);
        result.put("opportunityCount", opportunities.size());

        // Stats
        result.put("totalActive", fudkiiIgnitions.size() + pivotTriggers.size() + pendingSignals.size());
        result.put("timestamp", System.currentTimeMillis());

        log.debug("[API] GET /strategy-state/signals/active | fudkii={}, pivot={}, trading={}, opportunities={}",
                fudkiiIgnitions.size(), pivotTriggers.size(), pendingSignals.size(), opportunities.size());
        return ResponseEntity.ok(result);
    }

    /**
     * Get strategy signal flow diagram data.
     * Shows the state transition flow for each active signal.
     *
     * @return Flow diagram data structure
     */
    @GetMapping("/flow-diagram")
    public ResponseEntity<Map<String, Object>> getFlowDiagramData() {
        Map<String, Object> diagram = new HashMap<>();

        // Define state nodes
        List<Map<String, Object>> nodes = List.of(
                Map.of("id", "IDLE", "label", "Idle", "type", "start",
                        "description", "No active setup"),
                Map.of("id", "WATCHING", "label", "Watching", "type", "progress",
                        "description", "Setup forming, conditions being monitored"),
                Map.of("id", "FUDKII_CHECK", "label", "FUDKII Check", "type", "decision",
                        "description", "ST flip + BB breakout check"),
                Map.of("id", "PIVOT_CHECK", "label", "Pivot Check", "type", "decision",
                        "description", "HTF/LTF + SMC + Pivot confluence"),
                Map.of("id", "GATE_VALIDATION", "label", "Gate Validation", "type", "validation",
                        "description", "Risk, volume, regime checks"),
                Map.of("id", "ACTIVE", "label", "Active Signal", "type", "success",
                        "description", "Signal triggered, trade entry"),
                Map.of("id", "POSITIONED", "label", "Positioned", "type", "active",
                        "description", "Trade open, monitoring exit"),
                Map.of("id", "COMPLETED", "label", "Completed", "type", "end",
                        "description", "Trade closed (target/stop/expired)")
        );

        // Define edges
        List<Map<String, Object>> edges = List.of(
                Map.of("from", "IDLE", "to", "WATCHING", "label", "Setup detected"),
                Map.of("from", "WATCHING", "to", "FUDKII_CHECK", "label", "30m boundary"),
                Map.of("from", "WATCHING", "to", "PIVOT_CHECK", "label", "Confluence check"),
                Map.of("from", "FUDKII_CHECK", "to", "GATE_VALIDATION", "label", "Trigger passed"),
                Map.of("from", "PIVOT_CHECK", "to", "GATE_VALIDATION", "label", "Trigger passed"),
                Map.of("from", "FUDKII_CHECK", "to", "WATCHING", "label", "No trigger", "dashed", true),
                Map.of("from", "PIVOT_CHECK", "to", "WATCHING", "label", "No trigger", "dashed", true),
                Map.of("from", "GATE_VALIDATION", "to", "ACTIVE", "label", "Gates passed"),
                Map.of("from", "GATE_VALIDATION", "to", "WATCHING", "label", "Gates blocked", "dashed", true),
                Map.of("from", "ACTIVE", "to", "POSITIONED", "label", "Entry filled"),
                Map.of("from", "POSITIONED", "to", "COMPLETED", "label", "Exit triggered")
        );

        // Current active counts per state
        Map<String, Integer> stateCounts = new HashMap<>();
        stateCounts.put("WATCHING", stateConsumer.getWatchingCount());
        stateCounts.put("FUDKII_ACTIVE", fudkiiConsumer.getActiveIgnitionCount());
        stateCounts.put("TRADING_SIGNALS", tradingSignalService.getPendingSignals().size());
        stateCounts.put("OPPORTUNITIES", opportunityConsumer.getOpportunityCount());

        diagram.put("nodes", nodes);
        diagram.put("edges", edges);
        diagram.put("stateCounts", stateCounts);
        diagram.put("timestamp", System.currentTimeMillis());

        log.debug("[API] GET /strategy-state/flow-diagram | counts={}", stateCounts);
        return ResponseEntity.ok(diagram);
    }
}
