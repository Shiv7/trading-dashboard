package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class OiComputer {

    public void compute(StockMetrics m, double oiChangePct5d) {
        if (!m.isFnoEligible()) return;
        m.setOiChangePct5d(oiChangePct5d);
        double price = m.getChange5dPct();
        String interp;
        if (price > 0.5 && oiChangePct5d > 2.0) interp = "LONG_BUILDUP";
        else if (price < -0.5 && oiChangePct5d > 2.0) interp = "SHORT_BUILDUP";
        else if (price > 0.5 && oiChangePct5d < -2.0) interp = "SHORT_COVERING";
        else if (price < -0.5 && oiChangePct5d < -2.0) interp = "LONG_UNWINDING";
        else interp = "NEUTRAL";
        m.setOiInterpretation(interp);

        // Volume regime label (for F&O): institutional if LONG_BUILDUP + ELEVATED vol
        if ("LONG_BUILDUP".equals(interp) && "ELEVATED".equals(m.getVolumeRegime())) {
            m.setVolumeRegimeLabel("INSTITUTIONAL_ACCUMULATION");
        } else if ("ELEVATED".equals(m.getVolumeRegime())) {
            m.setVolumeRegimeLabel("RETAIL_SPIKE");
        } else if ("QUIET".equals(m.getVolumeRegime())) {
            m.setVolumeRegimeLabel("QUIET");
        } else {
            m.setVolumeRegimeLabel("NORMAL");
        }
    }
}
