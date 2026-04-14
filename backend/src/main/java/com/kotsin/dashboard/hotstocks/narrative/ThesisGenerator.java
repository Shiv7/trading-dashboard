package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;
import java.util.ArrayList;
import java.util.List;

@Component
public class ThesisGenerator {

    public String generate(StockMetrics m) {
        List<String> clauses = new ArrayList<>();

        if (m.isDeliveryInstitutional() && m.getSmartBuyCr() >= 50.0 && m.getDealDays() >= 2) {
            int mfCount = countDistinctMf(m.getSmartBuyClients());
            if (mfCount >= 2) {
                clauses.add(String.format("Smart money accumulated ₹%.0fCr across %d days from %d MFs",
                    m.getSmartBuyCr(), m.getDealDays(), mfCount));
            } else {
                clauses.add(String.format("Smart money accumulated ₹%.0fCr across %d deal days",
                    m.getSmartBuyCr(), m.getDealDays()));
            }
        }

        if ("LEADING".equals(m.getVsSectorLabel()) && "UPTREND".equals(m.getTrendState())
                && m.getSector() != null) {
            clauses.add(String.format("stock leads %s by %+.1f%% while holding above 50 DMA",
                m.getSector(), m.getVsSectorIndexPct()));
        } else if ("LAGGING".equals(m.getVsSectorLabel()) && "DOWNTREND".equals(m.getTrendState())
                && m.getSector() != null) {
            clauses.add(String.format("lagging %s by %.1f%% and below 50 DMA",
                m.getSector(), Math.abs(m.getVsSectorIndexPct())));
        } else if (m.getVsNifty50Pct() > 2.0 && "RANGE_BOUND".equals(m.getPriceRegime())) {
            clauses.add(String.format("outperforming Nifty by %+.1f%% in a rangebound tape",
                m.getVsNifty50Pct()));
        }

        if (m.isFnoEligible() && "LONG_BUILDUP".equals(m.getOiInterpretation())
                && m.getVolumeRatio5d20d() >= 1.5) {
            clauses.add(String.format("LONG_BUILDUP on %.1f× volume confirms conviction",
                m.getVolumeRatio5d20d()));
        } else if (m.isFnoEligible() && "SHORT_BUILDUP".equals(m.getOiInterpretation())) {
            clauses.add("SHORT_BUILDUP signals bearish positioning");
        }

        // Delivery standalone — only when nothing else has fired
        if (clauses.isEmpty() && m.getDeliveryPctAvg5d() >= 60.0 && "RISING".equals(m.getDeliveryTrend())) {
            clauses.add(String.format("delivery at %.0f%% and rising — holding-hands accumulation",
                m.getDeliveryPctAvg5d()));
        }

        // Event — always last, always appended if applicable
        if (m.isEventWithin3Days() && m.getDaysToNearestEvent() != null
                && m.getNearestEventType() != null) {
            clauses.add(String.format("%s in %d days may compress the entry window",
                m.getNearestEventType(), m.getDaysToNearestEvent()));
        } else if ((m.isHasSplitAnnouncement() || m.isHasBonusAnnouncement())
                && m.getNextCorporateActionLabel() != null) {
            clauses.add(String.format("%s announced", m.getNextCorporateActionLabel()));
        }

        if (clauses.isEmpty()) {
            return "Watchlist entry on mixed signals — open detail page for drivers.";
        }

        String joined = capitalize(String.join("; ", clauses)) + ".";
        if (joined.length() > 240) {
            joined = joined.substring(0, 237) + "...";
        }
        return joined;
    }

    private int countDistinctMf(List<String> clients) {
        if (clients == null) return 0;
        return (int) clients.stream()
            .filter(c -> c != null && c.toUpperCase().contains("MF"))
            .distinct()
            .count();
    }

    private String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
