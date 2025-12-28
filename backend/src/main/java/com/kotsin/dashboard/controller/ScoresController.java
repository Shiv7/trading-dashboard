package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.FamilyScoreDTO;
import com.kotsin.dashboard.service.ScoreExplainerService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST controller for family score endpoints.
 */
@RestController
@RequestMapping("/api/scores")
@RequiredArgsConstructor
public class ScoresController {

    private final ScoreExplainerService scoreExplainerService;

    /**
     * Get all current scores
     */
    @GetMapping
    public ResponseEntity<List<FamilyScoreDTO>> getAllScores() {
        return ResponseEntity.ok(scoreExplainerService.getAllScores());
    }

    /**
     * Get top N scores
     */
    @GetMapping("/top")
    public ResponseEntity<List<FamilyScoreDTO>> getTopScores(
            @RequestParam(defaultValue = "10") int limit) {
        return ResponseEntity.ok(scoreExplainerService.getTopScores(limit));
    }

    /**
     * Get latest score for a stock
     */
    @GetMapping("/{scripCode}")
    public ResponseEntity<FamilyScoreDTO> getScore(@PathVariable String scripCode) {
        return scoreExplainerService.getLatestScore(scripCode)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get score history for a stock
     */
    @GetMapping("/{scripCode}/history")
    public ResponseEntity<List<FamilyScoreDTO>> getScoreHistory(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "50") int limit) {
        return ResponseEntity.ok(scoreExplainerService.getScoreHistory(scripCode, limit));
    }

    /**
     * Get detailed explanation for a stock's score
     */
    @GetMapping("/{scripCode}/explain")
    public ResponseEntity<Map<String, Object>> explainScore(@PathVariable String scripCode) {
        return ResponseEntity.ok(scoreExplainerService.explainScore(scripCode));
    }
}

