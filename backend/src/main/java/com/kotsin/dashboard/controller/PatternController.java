package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.PatternSignalConsumer;
import com.kotsin.dashboard.kafka.PatternSignalConsumer.PatternStats;
import com.kotsin.dashboard.kafka.PatternSignalConsumer.PatternSummary;
import com.kotsin.dashboard.model.dto.PatternSignalDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * PatternController - REST endpoints for pattern signals
 *
 * Provides:
 * - Active patterns list
 * - Pattern history
 * - Pattern statistics
 * - Pattern by stock
 */
@RestController
@RequestMapping("/api/patterns")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class PatternController {

    private final PatternSignalConsumer patternConsumer;

    /**
     * Get all active patterns
     */
    @GetMapping
    public ResponseEntity<List<PatternSignalDTO>> getActivePatterns() {
        return ResponseEntity.ok(patternConsumer.getActivePatterns());
    }

    /**
     * Get pattern summary statistics
     */
    @GetMapping("/summary")
    public ResponseEntity<PatternSummary> getSummary() {
        return ResponseEntity.ok(patternConsumer.getPatternSummary());
    }

    /**
     * Get patterns for a specific stock
     */
    @GetMapping("/stock/{scripCode}")
    public ResponseEntity<List<PatternSignalDTO>> getPatternsByStock(
            @PathVariable String scripCode) {
        return ResponseEntity.ok(patternConsumer.getActivePatternsForStock(scripCode));
    }

    /**
     * Get a specific pattern by ID
     */
    @GetMapping("/{patternId}")
    public ResponseEntity<PatternSignalDTO> getPattern(@PathVariable String patternId) {
        PatternSignalDTO pattern = patternConsumer.getPattern(patternId);
        if (pattern == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(pattern);
    }

    /**
     * Get completed patterns history
     */
    @GetMapping("/history")
    public ResponseEntity<List<PatternSignalDTO>> getCompletedPatterns(
            @RequestParam(defaultValue = "50") int limit) {
        return ResponseEntity.ok(patternConsumer.getCompletedPatterns(limit));
    }

    /**
     * Get pattern statistics by type
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, PatternStats>> getPatternStats() {
        return ResponseEntity.ok(patternConsumer.getPatternStats());
    }

    /**
     * Clear all active and completed patterns (remove stale entries)
     */
    @DeleteMapping("/clear")
    public ResponseEntity<Map<String, Object>> clearAllPatterns() {
        int cleared = patternConsumer.clearAllPatterns();
        log.info("Cleared all patterns via API: {} active patterns removed", cleared);
        return ResponseEntity.ok(Map.of("cleared", cleared, "status", "ok"));
    }

    /**
     * Update pattern outcome (for manual outcome recording)
     */
    @PostMapping("/{patternId}/outcome")
    public ResponseEntity<String> updatePatternOutcome(
            @PathVariable String patternId,
            @RequestParam boolean isWin,
            @RequestParam double pnl) {
        patternConsumer.updatePatternOutcome(patternId, isWin, pnl);
        return ResponseEntity.ok("Pattern outcome updated");
    }
}
