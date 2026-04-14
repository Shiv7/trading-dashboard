package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class PriceFactsComputer {

    public void compute(List<DailyCandle> candles, StockMetrics m) {
        if (candles == null || candles.isEmpty()) {
            m.setTrendState("INSUFFICIENT");
            return;
        }

        int n = candles.size();
        DailyCandle last = candles.get(n - 1);
        m.setLtpYesterday(last.close());

        m.setChange1dPct(pctChange(candles, n, 1));
        m.setChange5dPct(pctChange(candles, n, 5));
        m.setChange20dPct(pctChange(candles, n, 20));

        if (n < 60) {
            m.setTrendState("INSUFFICIENT");
            return;
        }
        double dma50 = averageClose(candles, n - 50, n);
        m.setAbove50dmaPct((last.close() - dma50) / dma50 * 100.0);

        if (n >= 200) {
            double dma200 = averageClose(candles, n - 200, n);
            m.setAbove200dmaPct((last.close() - dma200) / dma200 * 100.0);
        }

        m.setTrendState(classifyTrend(candles, n, dma50));
        m.setRsi14(computeRsi(candles, 14));
        m.setWeekly52PositionPct(compute52wPosition(candles));
    }

    private double pctChange(List<DailyCandle> candles, int n, int lookback) {
        if (n <= lookback) return 0.0;
        double prev = candles.get(n - 1 - lookback).close();
        double curr = candles.get(n - 1).close();
        return (curr - prev) / prev * 100.0;
    }

    private double averageClose(List<DailyCandle> candles, int from, int to) {
        double sum = 0;
        for (int i = from; i < to; i++) sum += candles.get(i).close();
        return sum / (to - from);
    }

    private String classifyTrend(List<DailyCandle> candles, int n, double dma50) {
        DailyCandle last = candles.get(n - 1);
        double dma50Old = averageClose(candles, n - 60, n - 10);
        boolean priceAbove = last.close() > dma50;
        boolean dmaRising = dma50 > dma50Old * 1.005;
        boolean dmaFalling = dma50 < dma50Old * 0.995;
        if (priceAbove && dmaRising) return "UPTREND";
        if (!priceAbove && dmaFalling) return "DOWNTREND";
        return "SIDEWAYS";
    }

    private Double computeRsi(List<DailyCandle> candles, int period) {
        int n = candles.size();
        if (n < period + 1) return null;
        double gain = 0, loss = 0;
        for (int i = n - period; i < n; i++) {
            double change = candles.get(i).close() - candles.get(i - 1).close();
            if (change >= 0) gain += change;
            else loss -= change;
        }
        double avgGain = gain / period;
        double avgLoss = loss / period;
        if (avgLoss == 0) return 100.0;
        double rs = avgGain / avgLoss;
        return 100.0 - (100.0 / (1.0 + rs));
    }

    private Double compute52wPosition(List<DailyCandle> candles) {
        int n = candles.size();
        int from = Math.max(0, n - 252);
        double hi = Double.MIN_VALUE, lo = Double.MAX_VALUE;
        for (int i = from; i < n; i++) {
            hi = Math.max(hi, candles.get(i).high());
            lo = Math.min(lo, candles.get(i).low());
        }
        double last = candles.get(n - 1).close();
        if (hi == lo) return 50.0;
        return (last - lo) / (hi - lo) * 100.0;
    }
}
