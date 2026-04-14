package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class VolumeLiquidityComputer {

    public void compute(List<DailyCandle> candles, StockMetrics m) {
        if (candles == null || candles.isEmpty()) return;
        int n = candles.size();

        // Swing levels from last 20 days
        int from = Math.max(0, n - 20);
        double low = Double.MAX_VALUE, high = Double.MIN_VALUE;
        for (int i = from; i < n; i++) {
            low = Math.min(low, candles.get(i).low());
            high = Math.max(high, candles.get(i).high());
        }
        m.setSwingLow20d(low);
        m.setSwingHigh20d(high);

        double ltp = candles.get(n - 1).close();
        m.setEntryZoneLow(ltp * 0.99);
        m.setEntryZoneHigh(ltp);
        m.setSuggestedSlPrice(low * 0.995);

        // Volume ratio 5D/20D
        long vol5 = 0, vol20 = 0;
        int c5 = 0, c20 = 0;
        for (int i = Math.max(0, n - 20); i < n; i++) {
            vol20 += candles.get(i).volume();
            c20++;
            if (i >= n - 5) {
                vol5 += candles.get(i).volume();
                c5++;
            }
        }
        double avg5 = c5 > 0 ? (double) vol5 / c5 : 0;
        double avg20 = c20 > 0 ? (double) vol20 / c20 : 1;
        double ratio = avg5 / avg20;
        m.setVolumeRatio5d20d(ratio);
        m.setVolumeRegime(ratio > 1.5 ? "ELEVATED" : ratio < 0.7 ? "QUIET" : "NORMAL");

        // Liquidity tier = 20D avg (close * volume) in Cr
        double turnoverSum = 0;
        for (int i = Math.max(0, n - 20); i < n; i++) {
            turnoverSum += candles.get(i).close() * candles.get(i).volume();
        }
        double avgTurnoverCr = (turnoverSum / Math.max(1, c20)) / 1e7;
        m.setAvgTurnover20dCr(avgTurnoverCr);
        m.setLiquidityTier(LiquidityTier.fromTurnoverCr(avgTurnoverCr));
    }
}
