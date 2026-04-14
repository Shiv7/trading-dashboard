package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class RegimeComputer {

    public void compute(StockMetrics m) {
        if ("UPTREND".equals(m.getTrendState())
                && m.getAbove50dmaPct() != null && m.getAbove50dmaPct() > 0) {
            m.setPriceRegime("BULLISH_TREND");
            m.setPriceRegimeConfidence(0.85);
        } else if ("DOWNTREND".equals(m.getTrendState())
                && m.getAbove50dmaPct() != null && m.getAbove50dmaPct() < 0) {
            m.setPriceRegime("BEARISH_TREND");
            m.setPriceRegimeConfidence(0.85);
        } else {
            m.setPriceRegime("RANGE_BOUND");
            m.setPriceRegimeConfidence(0.6);
        }
    }
}
