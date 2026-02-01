package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.QuantScoreConsumer;
import com.kotsin.dashboard.model.dto.QuantScoreDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST Controller for QuantScore endpoints.
 * Provides sorted quant scores for dashboard display.
 */
@RestController
@RequestMapping("/api/quant-scores")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class QuantScoresController {

    private final QuantScoreConsumer quantScoreConsumer;

    /**
     * Get all quant scores sorted by score descending.
     * By default returns latest score per scripCode.
     * Use allTimeframes=true to get scores for all timeframes.
     */
    @GetMapping
    public ResponseEntity<List<QuantScoreDTO>> getAllScores(
            @RequestParam(defaultValue = "100") int limit,
            @RequestParam(defaultValue = "false") boolean allTimeframes) {
        List<QuantScoreDTO> scores = allTimeframes
                ? quantScoreConsumer.getAllScoresAllTimeframes()
                : quantScoreConsumer.getAllScoresSorted();
        // FIX BUG #6: Null check before size()
        if (scores == null) {
            return ResponseEntity.ok(List.of());
        }
        if (scores.size() > limit) {
            scores = scores.subList(0, limit);
        }
        return ResponseEntity.ok(scores);
    }

    /**
     * Get all quant scores for ALL timeframes (for MTF dashboard display).
     * Returns all 8 timeframes per instrument.
     */
    @GetMapping("/all-timeframes")
    public ResponseEntity<List<QuantScoreDTO>> getAllScoresAllTimeframes(
            @RequestParam(defaultValue = "500") int limit) {
        List<QuantScoreDTO> scores = quantScoreConsumer.getAllScoresAllTimeframes();
        // FIX BUG #6: Null check before size()
        if (scores == null) {
            return ResponseEntity.ok(List.of());
        }
        if (scores.size() > limit) {
            scores = scores.subList(0, limit);
        }
        return ResponseEntity.ok(scores);
    }

    /**
     * Get top actionable scores only
     */
    @GetMapping("/actionable")
    public ResponseEntity<List<QuantScoreDTO>> getActionableScores(
            @RequestParam(defaultValue = "20") int limit) {
        return ResponseEntity.ok(quantScoreConsumer.getTopActionableScores(limit));
    }

    /**
     * Get scores by direction (BULLISH/BEARISH)
     */
    @GetMapping("/direction/{direction}")
    public ResponseEntity<List<QuantScoreDTO>> getScoresByDirection(
            @PathVariable String direction) {
        return ResponseEntity.ok(quantScoreConsumer.getScoresByDirection(direction));
    }

    /**
     * Get latest score for a specific scripCode
     */
    @GetMapping("/{scripCode}")
    public ResponseEntity<QuantScoreDTO> getScore(@PathVariable String scripCode) {
        QuantScoreDTO score = quantScoreConsumer.getLatestScore(scripCode);
        if (score == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(score);
    }

    /**
     * Get ALL timeframe scores for a specific scripCode.
     * Returns map of timeframe -> QuantScoreDTO (up to 8 entries).
     */
    @GetMapping("/{scripCode}/timeframes")
    public ResponseEntity<Map<String, QuantScoreDTO>> getScoreAllTimeframes(
            @PathVariable String scripCode) {
        Map<String, QuantScoreDTO> scores = quantScoreConsumer.getAllTimeframeScores(scripCode);
        if (scores == null || scores.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(scores);
    }

    /**
     * Get score for a specific scripCode and timeframe
     */
    @GetMapping("/{scripCode}/timeframe/{timeframe}")
    public ResponseEntity<QuantScoreDTO> getScoreForTimeframe(
            @PathVariable String scripCode,
            @PathVariable String timeframe) {
        QuantScoreDTO score = quantScoreConsumer.getScore(scripCode, timeframe);
        if (score == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(score);
    }

    /**
     * Get count of scores per timeframe (diagnostic endpoint)
     */
    @GetMapping("/stats/timeframes")
    public ResponseEntity<Map<String, Long>> getTimeframeStats() {
        return ResponseEntity.ok(quantScoreConsumer.getScoreCountByTimeframe());
    }

    /**
     * Get score statistics summary
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats() {
        List<QuantScoreDTO> allScores = quantScoreConsumer.getAllScoresSorted();

        long bullishCount = allScores.stream()
                .filter(s -> "BULLISH".equalsIgnoreCase(s.getDirection()))
                .count();
        long bearishCount = allScores.stream()
                .filter(s -> "BEARISH".equalsIgnoreCase(s.getDirection()))
                .count();
        long actionableCount = allScores.stream()
                .filter(QuantScoreDTO::isActionable)
                .count();

        double avgScore = allScores.stream()
                .mapToDouble(QuantScoreDTO::getQuantScore)
                .average()
                .orElse(0);

        double maxScore = allScores.stream()
                .mapToDouble(QuantScoreDTO::getQuantScore)
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
     * Get breakdown summary across all scores
     */
    @GetMapping("/breakdown-summary")
    public ResponseEntity<Map<String, Object>> getBreakdownSummary() {
        List<QuantScoreDTO> scores = quantScoreConsumer.getAllScoresSorted();
        // FIX BUG #7: Null check for scores list
        if (scores == null || scores.isEmpty()) {
            return ResponseEntity.ok(Map.of(
                    "avgGreeksScore", 0.0,
                    "avgIVSurfaceScore", 0.0,
                    "avgMicrostructureScore", 0.0,
                    "avgOptionsFlowScore", 0.0,
                    "avgPriceActionScore", 0.0,
                    "avgVolumeProfileScore", 0.0,
                    "avgCrossInstrumentScore", 0.0,
                    "avgConfluenceScore", 0.0
            ));
        }

        // Average each category across all scores
        double avgGreeks = scores.stream()
                .filter(s -> s.getBreakdown() != null)
                .mapToDouble(s -> s.getBreakdown().getGreeksScore())
                .average().orElse(0);

        double avgIV = scores.stream()
                .filter(s -> s.getBreakdown() != null)
                .mapToDouble(s -> s.getBreakdown().getIvSurfaceScore())
                .average().orElse(0);

        double avgMicro = scores.stream()
                .filter(s -> s.getBreakdown() != null)
                .mapToDouble(s -> s.getBreakdown().getMicrostructureScore())
                .average().orElse(0);

        double avgOptionsFlow = scores.stream()
                .filter(s -> s.getBreakdown() != null)
                .mapToDouble(s -> s.getBreakdown().getOptionsFlowScore())
                .average().orElse(0);

        double avgPriceAction = scores.stream()
                .filter(s -> s.getBreakdown() != null)
                .mapToDouble(s -> s.getBreakdown().getPriceActionScore())
                .average().orElse(0);

        double avgVolumeProfile = scores.stream()
                .filter(s -> s.getBreakdown() != null)
                .mapToDouble(s -> s.getBreakdown().getVolumeProfileScore())
                .average().orElse(0);

        double avgCrossInst = scores.stream()
                .filter(s -> s.getBreakdown() != null)
                .mapToDouble(s -> s.getBreakdown().getCrossInstrumentScore())
                .average().orElse(0);

        double avgConfluence = scores.stream()
                .filter(s -> s.getBreakdown() != null)
                .mapToDouble(s -> s.getBreakdown().getConfluenceScore())
                .average().orElse(0);

        return ResponseEntity.ok(Map.of(
                "avgGreeksScore", Math.round(avgGreeks * 100) / 100.0,
                "avgIVSurfaceScore", Math.round(avgIV * 100) / 100.0,
                "avgMicrostructureScore", Math.round(avgMicro * 100) / 100.0,
                "avgOptionsFlowScore", Math.round(avgOptionsFlow * 100) / 100.0,
                "avgPriceActionScore", Math.round(avgPriceAction * 100) / 100.0,
                "avgVolumeProfileScore", Math.round(avgVolumeProfile * 100) / 100.0,
                "avgCrossInstrumentScore", Math.round(avgCrossInst * 100) / 100.0,
                "avgConfluenceScore", Math.round(avgConfluence * 100) / 100.0
        ));
    }
}
