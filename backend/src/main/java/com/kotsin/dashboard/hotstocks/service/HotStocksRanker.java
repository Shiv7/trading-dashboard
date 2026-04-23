package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;

/**
 * v2 signed-directional ranker.
 *
 *   - F&O stocks: score ∈ [-100, +100], threshold +30 to surface as buy candidate
 *   - Non-F&O stocks: score ∈ [-80, +80], threshold +40 (higher bar without OI signal)
 *
 * BEARISH-regime stocks are never surfaced as buys regardless of score.
 *
 * Legacy facts-counting ranker preserved under {@link #legacyScore(StockMetrics)} for
 * comparison/regression during the cutover.
 */
@Component
@Slf4j
public class HotStocksRanker {

    @Value("${hotstocks.v2.enabled:true}")
    private boolean v2Enabled;

    @Value("${hotstocks.v2.fno.threshold:30}")
    private int fnoThreshold;

    @Value("${hotstocks.v2.nonfno.threshold:40}")
    private int nonFnoThreshold;

    @Autowired(required = false)
    private HotStocksScoringEngine scoringEngine;

    @Autowired(required = false)
    private OiSeriesProvider oiSeriesProvider;

    public List<StockMetrics> rank(List<StockMetrics> universe, int topN, boolean fnoOnly) {
        if (!v2Enabled || scoringEngine == null) {
            return universe.stream()
                .filter(m -> !fnoOnly || m.isFnoEligible())
                .filter(m -> m.getLiquidityTier() != LiquidityTier.LOW)
                .sorted(Comparator.comparingDouble(this::legacyScore).reversed())
                .limit(topN).toList();
        }

        // Enrich with v2 score, then filter+sort.
        universe.forEach(this::enrichWithV2Score);

        return universe.stream()
            .filter(m -> !fnoOnly || m.isFnoEligible())
            .filter(m -> m.getLiquidityTier() != LiquidityTier.LOW)
            .filter(this::passesV2Threshold)
            .sorted(Comparator.comparingInt((StockMetrics m) ->
                m.getV2Score() != null ? m.getV2Score() : Integer.MIN_VALUE).reversed())
            .limit(topN).toList();
    }

    private boolean passesV2Threshold(StockMetrics m) {
        if (m.getV2Score() == null) return false;
        if ("BEARISH_TREND".equals(m.getPriceRegime())) return false;
        int threshold = m.isFnoEligible() ? fnoThreshold : nonFnoThreshold;
        return m.getV2Score() >= threshold;
    }

    /** Compute v2 score and stamp the full breakdown onto the metrics row. */
    public void enrichWithV2Score(StockMetrics m) {
        if (scoringEngine == null) return;
        HotStocksScoringEngine.FlowInput flow =
                new HotStocksScoringEngine.FlowInput(m.getSmartBuyCr(), m.getSmartSellCr(),
                        m.getDealDays(), m.getConviction());
        Double oi5d = null;
        if (m.isFnoEligible() && oiSeriesProvider != null) {
            oi5d = oiSeriesProvider.fiveDayOiChangePct(m.getSymbol()).orElse(null);
        }
        HotStocksScoringEngine.OiInput oi = new HotStocksScoringEngine.OiInput(oi5d);
        HotStocksScoringEngine.ScoreBreakdown b = scoringEngine.score(m, flow, oi);

        m.setV2Score(b.finalScore);
        m.setV2PreClampScore(b.preClampScore);
        m.setV2Tier(b.tier);
        m.setV2DataConfidence(b.dataConfidence);
        m.setV2Clamps(b.clamps);
        m.setV2Bucket1(b.bucket1);
        m.setV2Bucket2(b.bucket2);
        m.setV2Bucket3(b.bucket3);
        m.setV2Bucket4(b.bucket4);
        m.setV2Bucket5(b.bucket5);
        m.setV2OiChange5dPct(oi5d);
        m.setV2NetInstitutionalCr(flow.net());
    }

    /** Legacy facts-counting score — retained for rollback / comparison. */
    public double legacyScore(StockMetrics m) {
        double s = 0;
        if (m.isDeliveryInstitutional()) s += 25;
        if (m.getSmartBuyCr() >= 50 && m.getDealDays() >= 2) s += 20;
        if ("LEADING".equals(m.getVsSectorLabel())) s += 15;
        if ("UPTREND".equals(m.getTrendState())) s += 10;
        if ("LONG_BUILDUP".equals(m.getOiInterpretation())) s += 10;
        if ("ELEVATED".equals(m.getVolumeRegime())) s += 5;
        if (m.getWeekly52PositionPct() != null && m.getWeekly52PositionPct() > 60) s += 5;
        if ("BULLISH_TREND".equals(m.getPriceRegime())) s += 10;
        return s;
    }

    // Exposed for legacy score back-compat in ranker callers
    public double score(StockMetrics m) { return legacyScore(m); }
}
