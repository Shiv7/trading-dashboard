package com.kotsin.dashboard.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.kafka.FUDKIIConsumer;
import com.kotsin.dashboard.kafka.FUKAAConsumer;
import com.kotsin.dashboard.kafka.PivotConfluenceConsumer;
import com.kotsin.dashboard.kafka.StrategyOpportunityConsumer;
import com.kotsin.dashboard.kafka.StrategyStateConsumer;
import com.kotsin.dashboard.kafka.TradingSignalConsumer;
import com.kotsin.dashboard.model.dto.strategy.InstrumentStateSnapshotDTO;
import com.kotsin.dashboard.model.dto.strategy.StrategyOpportunityDTO;
import com.kotsin.dashboard.service.TradingSignalService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

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
    private final FUKAAConsumer fukaaConsumer;
    private final PivotConfluenceConsumer pivotConfluenceConsumer;
    private final TradingSignalService tradingSignalService;
    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;

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
     * Get all READY instruments (gate-validated, awaiting trade execution).
     *
     * @return List of instruments currently in READY state
     */
    @GetMapping("/ready")
    public ResponseEntity<List<InstrumentStateSnapshotDTO>> getReadyInstruments() {
        List<InstrumentStateSnapshotDTO> ready = stateConsumer.getReadyInstruments();
        log.debug("[API] GET /strategy-state/ready | {} instruments", ready.size());
        return ResponseEntity.ok(ready);
    }

    /**
     * Get all POSITIONED instruments (active trades being monitored).
     *
     * @return List of instruments currently in POSITIONED state
     */
    @GetMapping("/positioned")
    public ResponseEntity<List<InstrumentStateSnapshotDTO>> getPositionedInstruments() {
        List<InstrumentStateSnapshotDTO> positioned = stateConsumer.getPositionedInstruments();
        log.debug("[API] GET /strategy-state/positioned | {} instruments", positioned.size());
        return ResponseEntity.ok(positioned);
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
        stats.put("readyInstruments", stateConsumer.getReadyCount());
        stats.put("positionedInstruments", stateConsumer.getPositionedCount());
        stats.put("totalOpportunities", opportunityConsumer.getOpportunityCount());
        stats.put("highScoreOpportunities", opportunityConsumer.getHighScoreOpportunities(70).size());
        stats.put("fukaaActive", fukaaConsumer.getActiveTriggerCount());

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
     * Get ALL FUDKII signals (including expired triggers) as a list.
     * Uses the latestFUDKII cache which has no TTL.
     */
    @GetMapping("/fudkii/all/list")
    public ResponseEntity<List<Map<String, Object>>> getAllFudkiiSignals() {
        Map<String, Map<String, Object>> all = fudkiiConsumer.getAllLatestSignals();
        List<Map<String, Object>> list = new ArrayList<>(all.values());
        log.debug("[API] GET /strategy-state/fudkii/all/list | {} signals", list.size());
        return ResponseEntity.ok(list);
    }

    /**
     * Get today's FUDKII signal history — ALL triggered signals, never lost.
     * Persisted in Redis, survives restart.
     */
    @GetMapping("/fudkii/history/list")
    public ResponseEntity<List<Map<String, Object>>> getFudkiiSignalHistory() {
        List<Map<String, Object>> history = fudkiiConsumer.getTodaySignalHistory();
        log.debug("[API] GET /strategy-state/fudkii/history/list | {} signals", history.size());
        return ResponseEntity.ok(history);
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
                "historyCount", fudkiiConsumer.getTodaySignalHistoryCount(),
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

    // ==================== FUKAA STRATEGY ENDPOINTS (Volume-filtered FUDKII) ====================

    /**
     * Get all active FUKAA triggers (volume-confirmed FUDKII signals).
     */
    @GetMapping("/fukaa/active")
    public ResponseEntity<Map<String, Map<String, Object>>> getActiveFukaaTriggers() {
        Map<String, Map<String, Object>> triggers = fukaaConsumer.getActiveTriggers();
        log.debug("[API] GET /strategy-state/fukaa/active | {} active triggers", triggers.size());
        return ResponseEntity.ok(triggers);
    }

    /**
     * Get active FUKAA triggers as a list.
     */
    @GetMapping("/fukaa/active/list")
    public ResponseEntity<List<Map<String, Object>>> getActiveFukaaTriggersList() {
        Map<String, Map<String, Object>> triggers = fukaaConsumer.getActiveTriggers();
        List<Map<String, Object>> list = new ArrayList<>(triggers.values());
        log.debug("[API] GET /strategy-state/fukaa/active/list | {} active triggers", list.size());
        return ResponseEntity.ok(list);
    }

    /**
     * Get FUKAA signal for a specific instrument.
     */
    @GetMapping("/fukaa/{scripCode}")
    public ResponseEntity<Map<String, Object>> getFukaaSignal(@PathVariable String scripCode) {
        Map<String, Object> signal = fukaaConsumer.getLatestFUKAA(scripCode);
        if (signal == null) {
            return ResponseEntity.notFound().build();
        }
        log.debug("[API] GET /strategy-state/fukaa/{} | outcome={}", scripCode, signal.get("fukaaOutcome"));
        return ResponseEntity.ok(signal);
    }

    /**
     * Get ALL FUKAA signals (per-instrument latest, no TTL).
     * Same pattern as /fudkii/all/list — survives restart via Redis.
     */
    @GetMapping("/fukaa/all/list")
    public ResponseEntity<List<Map<String, Object>>> getAllFukaaSignals() {
        Map<String, Map<String, Object>> all = fukaaConsumer.getAllLatestSignals();
        List<Map<String, Object>> list = new ArrayList<>(all.values());
        log.debug("[API] GET /strategy-state/fukaa/all/list | {} signals", list.size());
        return ResponseEntity.ok(list);
    }

    /**
     * Get today's FUKAA signal history — ALL triggered signals, never lost.
     * Persisted in Redis, survives restart.
     */
    @GetMapping("/fukaa/history/list")
    public ResponseEntity<List<Map<String, Object>>> getFukaaSignalHistory() {
        List<Map<String, Object>> history = fukaaConsumer.getTodaySignalHistory();
        log.debug("[API] GET /strategy-state/fukaa/history/list | {} signals", history.size());
        return ResponseEntity.ok(history);
    }

    /**
     * Get FUKAA trigger count.
     */
    @GetMapping("/fukaa/count")
    public ResponseEntity<Map<String, Object>> getFukaaCount() {
        int count = fukaaConsumer.getActiveTriggerCount();
        return ResponseEntity.ok(Map.of(
                "activeTriggers", count,
                "historyCount", fukaaConsumer.getTodaySignalHistoryCount(),
                "timestamp", System.currentTimeMillis()
        ));
    }

    // ==================== COMBINED SIGNAL HISTORY (FUDKII + FUKAA) ====================

    /**
     * Get combined FUDKII + FUKAA signal history for today.
     * Returns ALL triggered signals from both strategies, sorted by trigger time (newest first).
     * Survives restart via Redis persistence.
     */
    @GetMapping("/signals/combined/list")
    public ResponseEntity<List<Map<String, Object>>> getCombinedSignalHistory() {
        List<Map<String, Object>> combined = new ArrayList<>();

        // Add all FUDKII history
        combined.addAll(fudkiiConsumer.getTodaySignalHistory());

        // Add all FUKAA history
        combined.addAll(fukaaConsumer.getTodaySignalHistory());

        // Sort by trigger time (newest first)
        combined.sort((a, b) -> {
            long epochA = a.containsKey("triggerTimeEpoch")
                    ? ((Number) a.get("triggerTimeEpoch")).longValue()
                    : (a.containsKey("cachedAt") ? ((Number) a.get("cachedAt")).longValue() : 0);
            long epochB = b.containsKey("triggerTimeEpoch")
                    ? ((Number) b.get("triggerTimeEpoch")).longValue()
                    : (b.containsKey("cachedAt") ? ((Number) b.get("cachedAt")).longValue() : 0);
            return Long.compare(epochB, epochA); // newest first
        });

        log.debug("[API] GET /strategy-state/signals/combined/list | {} total (fudkii={}, fukaa={})",
                combined.size(), fudkiiConsumer.getTodaySignalHistoryCount(),
                fukaaConsumer.getTodaySignalHistoryCount());
        return ResponseEntity.ok(combined);
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

        // FUKAA signals (Volume-confirmed FUDKII)
        Map<String, Map<String, Object>> fukaaTriggers = fukaaConsumer.getActiveTriggers();
        result.put("fukaaSignals", new ArrayList<>(fukaaTriggers.values()));
        result.put("fukaaCount", fukaaTriggers.size());

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
        result.put("totalActive", fudkiiIgnitions.size() + fukaaTriggers.size() + pivotTriggers.size() + pendingSignals.size());
        result.put("timestamp", System.currentTimeMillis());

        log.debug("[API] GET /strategy-state/signals/active | fudkii={}, fukaa={}, pivot={}, trading={}, opportunities={}",
                fudkiiIgnitions.size(), fukaaTriggers.size(), pivotTriggers.size(), pendingSignals.size(), opportunities.size());
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
        stateCounts.put("FUKAA_ACTIVE", fukaaConsumer.getActiveTriggerCount());
        stateCounts.put("PIVOT_ACTIVE", pivotConfluenceConsumer.getActiveTriggerCount());
        stateCounts.put("TRADING_SIGNALS", tradingSignalService.getPendingSignals().size());
        stateCounts.put("OPPORTUNITIES", opportunityConsumer.getOpportunityCount());

        // Detect conflicts: instruments with FUDKII + Pivot in opposite directions
        int conflicts = 0;
        Map<String, Map<String, Object>> fudkiiActive = fudkiiConsumer.getActiveTriggers();
        Map<String, Map<String, Object>> pivotActive = pivotConfluenceConsumer.getActiveTriggers();
        for (String scripCode : fudkiiActive.keySet()) {
            if (pivotActive.containsKey(scripCode)) {
                String fDir = fudkiiConsumer.getDirectionForScrip(scripCode);
                String pDir = pivotConfluenceConsumer.getDirectionForScrip(scripCode);
                if (fDir != null && pDir != null && !fDir.equals(pDir)) {
                    conflicts++;
                }
            }
        }
        stateCounts.put("CONFLICTS", conflicts);

        diagram.put("nodes", nodes);
        diagram.put("edges", edges);
        diagram.put("stateCounts", stateCounts);
        diagram.put("timestamp", System.currentTimeMillis());

        log.debug("[API] GET /strategy-state/flow-diagram | counts={}", stateCounts);
        return ResponseEntity.ok(diagram);
    }

    // ==================== PIVOT LEVELS FOR TARGET COMPUTATION ====================

    /**
     * Get sorted pivot levels for multiple instruments.
     * Reads multi-timeframe pivot data from Redis (key: pivot:mtf:{scripCode})
     * and returns all unique non-zero levels sorted ascending per instrument.
     *
     * @param scripCodes List of scrip codes
     * @return Map of scripCode to sorted list of unique pivot levels
     */
    @PostMapping("/pivots/batch")
    public ResponseEntity<Map<String, List<Double>>> getBatchPivotLevels(@RequestBody List<String> scripCodes) {
        Map<String, List<Double>> result = new LinkedHashMap<>();
        for (String scripCode : scripCodes) {
            try {
                String json = redisTemplate.opsForValue().get("pivot:mtf:" + scripCode);
                if (json == null || json.isEmpty()) continue;

                JsonNode root = objectMapper.readTree(json);
                JsonNode levels = root.path("allPivotLevels");
                if (!levels.isArray()) continue;

                TreeSet<Double> uniqueLevels = new TreeSet<>();
                for (JsonNode tf : levels) {
                    addPivotLevels(uniqueLevels, tf,
                        "pivot", "s1", "s2", "s3", "s4", "r1", "r2", "r3", "r4",
                        "fibS1", "fibS2", "fibS3", "fibR1", "fibR2", "fibR3",
                        "camS1", "camS2", "camS3", "camS4", "camR1", "camR2", "camR3", "camR4",
                        "tc", "bc");
                }

                if (!uniqueLevels.isEmpty()) {
                    result.put(scripCode, new ArrayList<>(uniqueLevels));
                }
            } catch (Exception e) {
                log.warn("Error reading pivots for {}: {}", scripCode, e.getMessage());
            }
        }
        log.debug("[API] POST /strategy-state/pivots/batch | {} codes requested, {} with data",
                scripCodes.size(), result.size());
        return ResponseEntity.ok(result);
    }

    private void addPivotLevels(TreeSet<Double> set, JsonNode node, String... fields) {
        for (String field : fields) {
            double val = node.path(field).asDouble(0);
            if (val > 0) {
                set.add(Math.round(val * 100.0) / 100.0);
            }
        }
    }
}
