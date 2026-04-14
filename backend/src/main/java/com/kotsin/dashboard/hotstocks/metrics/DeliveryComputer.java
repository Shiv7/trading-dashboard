package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class DeliveryComputer {

    public void compute(List<Double> last5Days, StockMetrics m) {
        if (last5Days == null || last5Days.isEmpty()) return;

        double latest = last5Days.get(last5Days.size() - 1);
        double avg5 = last5Days.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        m.setDeliveryPctLatest(latest);
        m.setDeliveryPctAvg5d(avg5);

        if (last5Days.size() >= 3) {
            double first = last5Days.get(0);
            double last = last5Days.get(last5Days.size() - 1);
            double delta = last - first;
            if (delta > 3.0) m.setDeliveryTrend("RISING");
            else if (delta < -3.0) m.setDeliveryTrend("FALLING");
            else m.setDeliveryTrend("STABLE");
        } else {
            m.setDeliveryTrend("STABLE");
        }

        String interp;
        if (avg5 >= 60 && "RISING".equals(m.getDeliveryTrend())) {
            interp = "STRONG_INSTITUTIONAL_ACCUMULATION";
        } else if (avg5 >= 50) {
            interp = "MODERATE_HOLDING";
        } else if (avg5 >= 40) {
            interp = "MIXED_ROTATION";
        } else {
            interp = "RETAIL_DOMINATED";
        }
        m.setDeliveryInterpretation(interp);
        m.setDeliveryInstitutional(avg5 >= 50.0);

        if ("RISING".equals(m.getDeliveryTrend()) && avg5 >= 50) {
            m.setDeliveryTrendLabel("MF_ACCUMULATING");
        } else if ("FALLING".equals(m.getDeliveryTrend()) && avg5 < 50) {
            m.setDeliveryTrendLabel("MF_DISTRIBUTING");
        } else {
            m.setDeliveryTrendLabel("STABLE");
        }
    }
}
