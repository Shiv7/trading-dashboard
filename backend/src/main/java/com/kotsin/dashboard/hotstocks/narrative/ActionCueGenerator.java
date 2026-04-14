package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.ActionCueType;
import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class ActionCueGenerator {

    public static class CueResult {
        public final ActionCueType type;
        public final String text;
        public CueResult(ActionCueType type, String text) {
            this.type = type;
            this.text = text;
        }
    }

    public CueResult generate(StockMetrics m) {
        CueResult primary = computePrimary(m);
        if (m.getLiquidityTier() == LiquidityTier.LOW && primary.type != ActionCueType.AVOID) {
            return new CueResult(primary.type, "▸ HALF SIZE — low liquidity  •  " + primary.text.substring(2));
        }
        return primary;
    }

    private CueResult computePrimary(StockMetrics m) {
        // Priority 0: HOLD_OFF takes precedence over all else
        if (m.isEventWithin3Days() && "EARNINGS".equals(m.getNearestEventType())
                && m.getDaysToNearestEvent() != null) {
            return new CueResult(ActionCueType.HOLD_OFF_EVENT,
                String.format("▸ HOLD OFF — earnings in %dd", m.getDaysToNearestEvent()));
        }

        // 1. AVOID — structural downtrend
        if ("DOWNTREND".equals(m.getTrendState()) && "LAGGING".equals(m.getVsSectorLabel())) {
            return new CueResult(ActionCueType.AVOID, "▸ AVOID — structural downtrend");
        }

        // 2. WAIT_PULLBACK — extended at 52W
        if ("UPTREND".equals(m.getTrendState())
                && m.getWeekly52PositionPct() != null && m.getWeekly52PositionPct() >= 85.0) {
            return new CueResult(ActionCueType.WAIT_PULLBACK, "▸ WAIT FOR PULLBACK — extended at 52W");
        }

        // 3. BUY_DIP — uptrend + leader + not extended
        if ("UPTREND".equals(m.getTrendState())
                && m.getWeekly52PositionPct() != null && m.getWeekly52PositionPct() < 85.0
                && "LEADING".equals(m.getVsSectorLabel())) {
            String text = String.format("▸ BUY DIP ₹%.0f–%.0f  •  SL ₹%.0f  •  5d",
                m.getEntryZoneLow(), m.getEntryZoneHigh(), m.getSuggestedSlPrice());
            return new CueResult(ActionCueType.BUY_DIP, text);
        }

        // 4. BUY_RANGE_LOW — rangebound + oversold
        if ("SIDEWAYS".equals(m.getTrendState())
                && "RANGE_BOUND".equals(m.getPriceRegime())
                && m.getRsi14() != null && m.getRsi14() < 40.0) {
            double slPrice = m.getSwingLow20d() * 0.97;
            String text = String.format("▸ BUY RANGE LOW ₹%.0f  •  SL ₹%.0f  •  5d",
                m.getSwingLow20d(), slPrice);
            return new CueResult(ActionCueType.BUY_RANGE_LOW, text);
        }

        return new CueResult(ActionCueType.OBSERVE, "▸ OBSERVE — drivers mixed");
    }
}
