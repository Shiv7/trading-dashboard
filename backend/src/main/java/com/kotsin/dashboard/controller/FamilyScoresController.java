package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.FamilyScoreConsumer;
import com.kotsin.dashboard.model.dto.FamilyScoreDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * REST Controller for Family Score (MTIS) endpoints.
 * Provides family scores for dashboard display.
 */
@RestController
@RequestMapping("/api/family-scores")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class FamilyScoresController {

    private final FamilyScoreConsumer familyScoreConsumer;

    /**
     * Get all family scores sorted by overall score descending.
     * GET /api/family-scores
     */
    @GetMapping
    public ResponseEntity<List<FamilyScoreDTO>> getAllScores(
            @RequestParam(defaultValue = "100") int limit) {

        Map<String, FamilyScoreDTO> allScores = familyScoreConsumer.getAllLatestScores();

        List<FamilyScoreDTO> sorted = allScores.values().stream()
                .sorted(Comparator.comparingDouble(FamilyScoreDTO::getOverallScore).reversed())
                .limit(limit)
                .collect(Collectors.toList());

        log.debug("Returning {} family scores", sorted.size());
        return ResponseEntity.ok(sorted);
    }

    /**
     * Get family score for a specific scripCode.
     * GET /api/family-scores/{scripCode}
     */
    @GetMapping("/{scripCode}")
    public ResponseEntity<FamilyScoreDTO> getScore(@PathVariable String scripCode) {
        FamilyScoreDTO score = familyScoreConsumer.getLatestScore(scripCode);
        if (score == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(score);
    }

    /**
     * Get scores filtered by direction (BULLISH/BEARISH/NEUTRAL).
     * GET /api/family-scores/direction/{direction}
     */
    @GetMapping("/direction/{direction}")
    public ResponseEntity<List<FamilyScoreDTO>> getScoresByDirection(
            @PathVariable String direction,
            @RequestParam(defaultValue = "50") int limit) {

        Map<String, FamilyScoreDTO> allScores = familyScoreConsumer.getAllLatestScores();

        List<FamilyScoreDTO> filtered = allScores.values().stream()
                .filter(s -> direction.equalsIgnoreCase(s.getDirection()))
                .sorted(Comparator.comparingDouble(FamilyScoreDTO::getOverallScore).reversed())
                .limit(limit)
                .collect(Collectors.toList());

        return ResponseEntity.ok(filtered);
    }

    /**
     * Get actionable scores only (hardGatePassed=true).
     * GET /api/family-scores/actionable
     */
    @GetMapping("/actionable")
    public ResponseEntity<List<FamilyScoreDTO>> getActionableScores(
            @RequestParam(defaultValue = "20") int limit) {

        Map<String, FamilyScoreDTO> allScores = familyScoreConsumer.getAllLatestScores();

        List<FamilyScoreDTO> actionable = allScores.values().stream()
                .filter(FamilyScoreDTO::isActionable)
                .sorted(Comparator.comparingDouble(FamilyScoreDTO::getOverallScore).reversed())
                .limit(limit)
                .collect(Collectors.toList());

        return ResponseEntity.ok(actionable);
    }

    /**
     * Get batch scores for multiple scripCodes.
     * POST /api/family-scores/batch
     * Body: ["NIFTY", "BANKNIFTY", "RELIANCE"]
     */
    @PostMapping("/batch")
    public ResponseEntity<Map<String, FamilyScoreDTO>> getBatchScores(
            @RequestBody List<String> scripCodes) {

        if (scripCodes == null || scripCodes.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        Map<String, FamilyScoreDTO> result = new HashMap<>();
        for (String scripCode : scripCodes) {
            FamilyScoreDTO score = familyScoreConsumer.getLatestScore(scripCode);
            if (score != null) {
                result.put(scripCode, score);
            }
        }

        return ResponseEntity.ok(result);
    }

    /**
     * Get statistics summary.
     * GET /api/family-scores/stats
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats() {
        Map<String, FamilyScoreDTO> allScores = familyScoreConsumer.getAllLatestScores();

        long bullishCount = allScores.values().stream()
                .filter(s -> "BULLISH".equalsIgnoreCase(s.getDirection()))
                .count();
        long bearishCount = allScores.values().stream()
                .filter(s -> "BEARISH".equalsIgnoreCase(s.getDirection()))
                .count();
        long actionableCount = allScores.values().stream()
                .filter(FamilyScoreDTO::isActionable)
                .count();

        double avgScore = allScores.values().stream()
                .mapToDouble(FamilyScoreDTO::getOverallScore)
                .average()
                .orElse(0);

        double maxScore = allScores.values().stream()
                .mapToDouble(FamilyScoreDTO::getOverallScore)
                .max()
                .orElse(0);

        return ResponseEntity.ok(Map.of(
                "totalSymbols", allScores.size(),
                "bullishCount", bullishCount,
                "bearishCount", bearishCount,
                "actionableCount", actionableCount,
                "averageScore", Math.round(avgScore * 100) / 100.0,
                "maxScore", Math.round(maxScore * 100) / 100.0
        ));
    }

    /**
     * Get available scripCodes.
     * GET /api/family-scores/available
     */
    @GetMapping("/available")
    public ResponseEntity<Set<String>> getAvailableScrips() {
        Set<String> available = familyScoreConsumer.getAllLatestScores().keySet();
        return ResponseEntity.ok(available);
    }
}
