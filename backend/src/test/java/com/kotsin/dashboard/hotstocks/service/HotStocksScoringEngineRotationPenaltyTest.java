package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksScoringEngine.FlowInput;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Rotation-penalty tests for {@link HotStocksScoringEngine#scoreFlow}:
 *   conviction ≥ 0.50 → no penalty
 *   0.30 ≤ conviction < 0.50 → 0.75× (quarter-cut)
 *   conviction < 0.30 → 0.5× (halved)
 *
 * Baseline net=+50 → 20 (from scoreFlow tier table).
 */
class HotStocksScoringEngineRotationPenaltyTest {

    private static StockMetrics baseMetrics() {
        StockMetrics m = new StockMetrics();
        m.setPriceRegime("NEUTRAL");  // avoid BULLISH bonus interference
        return m;
    }

    @Test
    void noPenalty_whenConvictionAtOrAbove50() {
        // Buy 50, sell 0 → net +50, conviction = 1.0
        FlowInput flow = new FlowInput(50.0, 0.0, 2, 1.0);
        int s = HotStocksScoringEngine.scoreFlow(flow, baseMetrics(), true);
        assertEquals(20, s, "conviction 1.0 → full tier-1 score");
    }

    @Test
    void quarterCut_whenConvictionBetween30And50() {
        // Force a conviction of 0.40 explicitly (different from buy/sell derivation)
        FlowInput flow = new FlowInput(60.0, 0.0, 2, 0.40);
        // net +60 → tier gives 20, 0.75× → 15
        int s = HotStocksScoringEngine.scoreFlow(flow, baseMetrics(), true);
        assertEquals(15, s, "conviction 0.40 → 0.75× of 20 = 15");
    }

    @Test
    void halved_whenConvictionBelow30() {
        FlowInput flow = new FlowInput(60.0, 0.0, 2, 0.20);
        // net +60 → 20, halved to 10
        int s = HotStocksScoringEngine.scoreFlow(flow, baseMetrics(), true);
        assertEquals(10, s, "conviction 0.20 → 0.5× of 20 = 10");
    }

    @Test
    void edgeExactly30_usesQuarterCut() {
        // Boundary: 0.30 is in [0.30, 0.50) quarter-cut tier, NOT the <0.30 halved tier.
        FlowInput flow = new FlowInput(60.0, 0.0, 2, 0.30);
        int s = HotStocksScoringEngine.scoreFlow(flow, baseMetrics(), true);
        assertEquals(15, s, "conviction exactly 0.30 → quarter-cut path");
    }

    @Test
    void killSwitchOff_skipsPenaltyEntirely() {
        // conviction 0.10 would halve to 10 when penalty enabled — but OFF → 20.
        FlowInput flow = new FlowInput(60.0, 0.0, 2, 0.10);
        int s = HotStocksScoringEngine.scoreFlow(flow, baseMetrics(), false);
        assertEquals(20, s, "penalty disabled → raw tier score returned");
    }
}
