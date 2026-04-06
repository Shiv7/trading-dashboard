package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * Returns the "best" active signal for a given scripCode across all strategies.
 * Priority order: FUKAA > FUDKOI > FUDKII > MERE > Pivot > MCX-BB-15 > MCX-BB-30 > NSE-BB-30 > MicroAlpha
 *
 * Each strategy consumer caches its latest signal as Map<String, Object> — this endpoint
 * checks each in priority order and returns the first active signal found, enriched with
 * option/futures data already present in the payload.
 */
@RestController
@RequestMapping("/api/signals")
@RequiredArgsConstructor
@Slf4j
public class BestSignalController {

    private final FUKAAConsumer fukaaConsumer;
    private final FUDKOIConsumer fudkoiConsumer;
    private final FUDKIIConsumer fudkiiConsumer;
    private final MereConsumer mereConsumer;
    private final PivotConfluenceConsumer pivotConsumer;
    private final McxBb15Consumer mcxBb15Consumer;
    private final McxBb30Consumer mcxBb30Consumer;
    private final NseBb30Consumer nseBb30Consumer;
    private final MicroAlphaConsumer microAlphaConsumer;

    /**
     * Strategy priority — highest first. Option-first strategies rank above equity-first.
     */
    private static final List<String> PRIORITY = List.of(
        "FUKAA", "FUDKOI", "FUDKII", "MERE", "PIVOT",
        "MCX-BB-15", "MCX-BB-30", "NSE-BB-30", "MICROALPHA"
    );

    @GetMapping("/best/{scripCode}")
    public ResponseEntity<Map<String, Object>> getBestSignal(@PathVariable String scripCode) {

        // Query each consumer in priority order
        List<Map<String, Object>> candidates = new ArrayList<>();

        addIfPresent(candidates, "FUKAA", fukaaConsumer.getLatestFUKAA(scripCode));
        addIfPresent(candidates, "FUDKOI", fudkoiConsumer.getLatestFUDKOI(scripCode));
        addIfPresent(candidates, "FUDKII", fudkiiConsumer.getLatestFUDKII(scripCode));
        addIfPresent(candidates, "MERE", mereConsumer.getLatestMERE(scripCode));
        addIfPresent(candidates, "PIVOT", pivotConsumer.getLatestPivotSignal(scripCode));

        // BB consumers return full map — extract by scripCode
        addIfPresent(candidates, "MCX-BB-15", getFromMap(mcxBb15Consumer.getLatestMcxBb15(), scripCode));
        addIfPresent(candidates, "MCX-BB-30", getFromMap(mcxBb30Consumer.getLatestMcxBb30(), scripCode));
        addIfPresent(candidates, "NSE-BB-30", getFromMap(nseBb30Consumer.getLatestNseBb30(), scripCode));

        addIfPresent(candidates, "MICROALPHA", microAlphaConsumer.getLatestSignal(scripCode));

        if (candidates.isEmpty()) {
            return ResponseEntity.ok(Map.of(
                "found", false,
                "scripCode", scripCode,
                "message", "No active signal for this scrip"
            ));
        }

        // Already in priority order — first candidate wins
        Map<String, Object> best = candidates.get(0);
        best.put("found", true);

        log.debug("Best signal for {}: strategy={}", scripCode, best.get("_strategy"));
        return ResponseEntity.ok(best);
    }

    private void addIfPresent(List<Map<String, Object>> candidates, String strategy, Map<String, Object> signal) {
        if (signal == null || signal.isEmpty()) return;

        // Check signal is actionable (triggered/active)
        boolean triggered = Boolean.TRUE.equals(signal.get("triggered"))
            || "ACTIVE".equals(signal.get("state"))
            || "TRIGGERED".equals(signal.get("state"))
            || signal.containsKey("triggerPrice")
            || signal.containsKey("entryPrice");

        if (!triggered) return;

        // Tag with strategy name for the frontend
        Map<String, Object> enriched = new LinkedHashMap<>(signal);
        enriched.put("_strategy", strategy);
        enriched.put("_priorityRank", PRIORITY.indexOf(strategy));
        candidates.add(enriched);
    }

    private Map<String, Object> getFromMap(Map<String, Map<String, Object>> allSignals, String scripCode) {
        if (allSignals == null) return null;
        return allSignals.get(scripCode);
    }
}
