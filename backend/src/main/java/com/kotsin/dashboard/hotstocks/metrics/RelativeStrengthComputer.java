package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class RelativeStrengthComputer {

    public void compute(StockMetrics m, double sector5dPct, double nifty5dPct) {
        double vsSector = m.getChange5dPct() - sector5dPct;
        double vsNifty = m.getChange5dPct() - nifty5dPct;
        m.setVsSectorIndexPct(vsSector);
        m.setVsNifty50Pct(vsNifty);
        m.setVsSectorLabel(label(vsSector));
        m.setVsNiftyLabel(label(vsNifty));
        m.setSectorChange5dPct(sector5dPct);
    }

    private String label(double delta) {
        if (delta > 1.0) return "LEADING";
        if (delta < -1.0) return "LAGGING";
        return "INLINE";
    }
}
