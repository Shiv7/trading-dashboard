package com.kotsin.dashboard.greeks;

import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Greek Trailing Engine — replaces static T2/T3/T4 targets after T1 with
 * dynamic trailing based on option Greeks (delta, theta, gamma).
 *
 * Activated when T1 is hit on an option position. Monitors:
 * 1. Delta reversal: exit if delta drops significantly from peak
 * 2. Theta burn: exit if daily theta decay exceeds threshold relative to premium
 * 3. Dynamic trailing stop: trail % tightens as delta accelerates, widens on theta decay
 * 4. DTE exit: exit day before expiry if theta is burning
 *
 * Mirror of com.kotsin.execution.greeks.GreekTrailingEngine (Trade Execution module),
 * adapted for Dashboard Backend's StrategyTradeExecutor monitoring loop.
 */
@Service
@Slf4j
public class GreekTrailingEngine {

    private static final String LOG_PREFIX = "[GREEK-TRAIL]";

    @Value("${greek.trailing.enabled:true}")
    private boolean enabled;

    @Value("${greek.trailing.base.pct:0.15}")
    private double baseTrailPct;

    @Value("${greek.trailing.delta.reversal.threshold:0.15}")
    private double deltaReversalThreshold;

    @Value("${greek.trailing.theta.burn.exit:0.05}")
    private double thetaBurnExit;

    @Value("${greek.trailing.theta.burn.tighten:0.03}")
    private double thetaBurnTighten;

    @Value("${greek.trailing.min.pct:0.05}")
    private double minTrailPct;

    @Value("${greek.trailing.max.pct:0.30}")
    private double maxTrailPct;

    /** Active trail state per position key. */
    private final ConcurrentHashMap<String, TrailState> activeTrails = new ConcurrentHashMap<>();

    @Data
    public static class TrailState {
        private final String positionKey;
        private final String scripCode;
        private final String companyName;
        private final String optionType; // CE or PE
        private final double strikePrice;
        private final double deltaAtT1;
        private final double premiumAtT1;
        private final double ivAtT1;
        private double peakDelta;
        private double highWatermark;
        private double currentDelta;
        private double currentGamma;
        private double currentTheta;
        private double currentIV;
        private double currentPremium;
        private double currentTrailPct;
        private double trailStopPrice;
        private double deltaAccelRatio;
        private double thetaBurnRate;
        private int dte;
        private long t1HitTime;
        private long lastUpdateTime;
        private String status;      // TRAILING, EXITED
        private String exitReason;  // null if still trailing
    }

    /** @return true if the engine is enabled via configuration */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * Called when T1 is hit for an option position. Activates Greek trailing for remaining qty.
     *
     * @param positionKey unique position identifier (typically scripCode)
     * @param scripCode   instrument scrip code
     * @param companyName display name (e.g. "BDL 1300 CE")
     * @param optionType  "CE" or "PE"
     * @param strikePrice option strike price
     * @param delta       delta at the moment T1 was hit
     * @param premium     option premium (LTP) at T1 hit
     * @param iv          implied volatility at T1 (annualised, e.g. 0.30 = 30%)
     * @param dte         days to expiry
     */
    public void onT1Hit(String positionKey, String scripCode, String companyName,
                        String optionType, double strikePrice,
                        double delta, double premium, double iv, int dte) {
        if (!enabled) return;

        TrailState state = new TrailState(positionKey, scripCode, companyName,
                optionType, strikePrice, delta, premium, iv);
        state.setPeakDelta(Math.abs(delta));
        state.setHighWatermark(premium);
        state.setCurrentDelta(delta);
        state.setCurrentPremium(premium);
        state.setCurrentIV(iv);
        state.setCurrentTrailPct(baseTrailPct);
        state.setTrailStopPrice(premium * (1.0 - baseTrailPct));
        state.setDte(dte);
        state.setT1HitTime(System.currentTimeMillis());
        state.setLastUpdateTime(System.currentTimeMillis());
        state.setStatus("TRAILING");

        activeTrails.put(positionKey, state);
        log.info("{} ACTIVATED key={} scrip={} {} delta={} premium={} iv={}% dte={}",
                LOG_PREFIX, positionKey, companyName, optionType,
                String.format("%.3f", delta), String.format("%.2f", premium),
                String.format("%.1f", iv * 100), dte);
    }

    /**
     * Called every monitoring tick (2s in Dashboard Backend). Returns exit reason or null to hold.
     *
     * @param positionKey  unique position identifier
     * @param currentPremium current option LTP
     * @param spotPrice    current underlying price
     * @param dte          days to expiry
     * @return exit reason string if position should be exited, null to hold
     */
    public String checkExit(String positionKey, double currentPremium,
                            double spotPrice, int dte) {
        if (!enabled) return null;

        TrailState state = activeTrails.get(positionKey);
        if (state == null || !"TRAILING".equals(state.getStatus())) return null;

        // Recompute Greeks from current market data
        boolean isCall = "CE".equals(state.getOptionType());
        double tte = Math.max(dte, 0.5) / 365.0; // time to expiry in years
        double iv = state.getIvAtT1(); // baseline IV

        // Try to compute live IV from current option price
        try {
            double liveIV = BlackScholesLite.impliedVol(currentPremium, spotPrice,
                    state.getStrikePrice(), tte, isCall);
            if (liveIV > 0.01 && liveIV < 5.0) {
                iv = liveIV; // use live IV if sane
            }
        } catch (Exception e) {
            // Fall back to entry IV — already set above
        }

        double delta = BlackScholesLite.delta(spotPrice, state.getStrikePrice(), tte, iv, isCall);
        double gamma = BlackScholesLite.gamma(spotPrice, state.getStrikePrice(), tte, iv);
        double theta = BlackScholesLite.theta(spotPrice, state.getStrikePrice(), tte, iv, isCall);

        // Update state
        double absDelta = Math.abs(delta);
        state.setCurrentDelta(delta);
        state.setCurrentGamma(gamma);
        state.setCurrentTheta(theta);
        state.setCurrentIV(iv);
        state.setCurrentPremium(currentPremium);
        state.setDte(dte);
        state.setLastUpdateTime(System.currentTimeMillis());

        // Update peaks
        if (absDelta > state.getPeakDelta()) state.setPeakDelta(absDelta);
        if (currentPremium > state.getHighWatermark()) state.setHighWatermark(currentPremium);

        // ── CHECK 1: Delta reversal ──
        double deltaDropPct = (state.getPeakDelta() - absDelta) / Math.max(state.getPeakDelta(), 0.001);
        if (deltaDropPct > deltaReversalThreshold && absDelta < Math.abs(state.getDeltaAtT1())) {
            state.setStatus("EXITED");
            state.setExitReason("GREEK_DELTA_REVERSAL");
            log.info("{} EXIT key={} reason=DELTA_REVERSAL peak={} current={} drop={}%",
                    LOG_PREFIX, positionKey,
                    String.format("%.3f", state.getPeakDelta()),
                    String.format("%.3f", absDelta),
                    String.format("%.1f", deltaDropPct * 100));
            return "GREEK_DELTA_REVERSAL";
        }

        // ── CHECK 2: Theta burn ──
        double thetaBurnRate = Math.abs(theta / 365.0) / Math.max(currentPremium, 0.01);
        state.setThetaBurnRate(thetaBurnRate);
        if (thetaBurnRate > thetaBurnExit) {
            state.setStatus("EXITED");
            state.setExitReason("GREEK_THETA_BURN");
            log.info("{} EXIT key={} reason=THETA_BURN rate={}%/day premium={} theta={}",
                    LOG_PREFIX, positionKey,
                    String.format("%.1f", thetaBurnRate * 100),
                    String.format("%.2f", currentPremium),
                    String.format("%.4f", theta));
            return "GREEK_THETA_BURN";
        }

        // ── CHECK 3: Dynamic trailing stop ──
        double deltaAccelRatio = absDelta / Math.max(Math.abs(state.getDeltaAtT1()), 0.01);
        state.setDeltaAccelRatio(deltaAccelRatio);
        double thetaPenalty = 1.0 + Math.max(0, thetaBurnRate - thetaBurnTighten) * 5.0;
        double dynamicTrailPct = baseTrailPct / Math.max(deltaAccelRatio, 0.5) * thetaPenalty;
        dynamicTrailPct = Math.max(minTrailPct, Math.min(dynamicTrailPct, maxTrailPct));
        state.setCurrentTrailPct(dynamicTrailPct);

        double trailStop = state.getHighWatermark() * (1.0 - dynamicTrailPct);
        state.setTrailStopPrice(trailStop);

        if (currentPremium < trailStop) {
            state.setStatus("EXITED");
            state.setExitReason("GREEK_TRAIL_STOP");
            log.info("{} EXIT key={} reason=TRAIL_STOP premium={} < trail={} (hwm={} trail%={}%)",
                    LOG_PREFIX, positionKey,
                    String.format("%.2f", currentPremium),
                    String.format("%.2f", trailStop),
                    String.format("%.2f", state.getHighWatermark()),
                    String.format("%.1f", dynamicTrailPct * 100));
            return "GREEK_TRAIL_STOP";
        }

        // ── CHECK 4: DTE exit ──
        if (dte <= 1 && thetaBurnRate > thetaBurnTighten) {
            state.setStatus("EXITED");
            state.setExitReason("GREEK_DTE_EXIT");
            log.info("{} EXIT key={} reason=DTE_EXIT dte={} theta={}%/day",
                    LOG_PREFIX, positionKey, dte,
                    String.format("%.1f", thetaBurnRate * 100));
            return "GREEK_DTE_EXIT";
        }

        // Periodic debug log (~every 30 seconds)
        if ((System.currentTimeMillis() % 30000) < 600) {
            log.debug("{} TRAILING key={} delta={}(peak={}) accel={} premium={}(hwm={}) trail={}({}%) theta={}%/day",
                    LOG_PREFIX, positionKey,
                    String.format("%.3f", absDelta),
                    String.format("%.3f", state.getPeakDelta()),
                    String.format("%.2f", deltaAccelRatio),
                    String.format("%.2f", currentPremium),
                    String.format("%.2f", state.getHighWatermark()),
                    String.format("%.2f", trailStop),
                    String.format("%.1f", dynamicTrailPct * 100),
                    String.format("%.1f", thetaBurnRate * 100));
        }

        return null; // HOLD
    }

    /** Remove trail state when position is fully closed. */
    public void removeTrail(String positionKey) {
        activeTrails.remove(positionKey);
    }

    /** Check if a position is actively being trailed by this engine. */
    public boolean isTrailing(String positionKey) {
        TrailState state = activeTrails.get(positionKey);
        return state != null && "TRAILING".equals(state.getStatus());
    }

    /** Get all trail states (active + exited). */
    public Collection<TrailState> getAllTrailStates() {
        return activeTrails.values();
    }

    /** Get trail state for a specific position. */
    public TrailState getTrailState(String positionKey) {
        return activeTrails.get(positionKey);
    }
}
