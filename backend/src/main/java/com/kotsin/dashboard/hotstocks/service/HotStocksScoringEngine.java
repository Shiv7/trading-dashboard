package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * HotStocks v2 signed-directional scorer.
 *
 * Replaces the additive facts-counting ranker. Produces a signed score in
 * [-100, +100] for F&O stocks (5 buckets) or [-80, +80] for non-F&O
 * (4 buckets — no OI-futures confirmation available).
 *
 * Positive = bullish buy candidate. Negative = distribution / avoid.
 * Zero = no edge.
 *
 * Hard clamps are applied AFTER bucket sum to cap bullish scores in known-bad
 * regimes (falling-knife, distribution, bottom-of-range). A data-confidence
 * multiplier penalises scores built from sparse inputs.
 *
 * Pure function — no Spring state, no IO. Unit-testable in isolation.
 */
@Component
public class HotStocksScoringEngine {

    // ── Bucket caps ─────────────────────────────────────────────────────────
    static final int BUCKET1_CAP = 30;   // institutional flow
    static final int BUCKET2_CAP = 25;   // price momentum
    static final int BUCKET3_CAP = 20;   // OI/futures congruence
    static final int BUCKET4_CAP = 15;   // relative strength
    static final int BUCKET5_CAP = 10;   // volume regime

    // ── Rotation penalty tuning (applied in scoreFlow, kill-switch aware) ───
    static final double ROTATION_HALF_THRESHOLD    = 0.30;  // below → 0.5×
    static final double ROTATION_QUARTER_THRESHOLD = 0.50;  // [0.30, 0.50) → 0.75×

    // Kill-switch + shadow collaborators (Spring-wired so unit tests without
    // ApplicationContext keep working — the static helpers don't touch these).
    @Value("${hotstocks.scoring.rotation.penalty.enabled:true}")
    private boolean rotationPenaltyEnabled;

    @Value("${hotstocks.fiidii.apply:false}")
    private boolean fiiDiiApply;

    @Autowired(required = false)
    private FiiDiiRegimeResolver fiiDiiResolver;

    @Autowired(required = false)
    private StringRedisTemplate redis;

    // Shadow FII/DII Redis log TTL (30 days).
    private static final long SHADOW_FIIDII_TTL_SECONDS = 30L * 24 * 60 * 60;

    /**
     * Net institutional flow in INR Cr = buyCr - sellCr (time-decayed, deduped).
     *
     * {@code conviction} ∈ [0,1] reports rotation awareness — |net|/gross.
     * 0 = perfect churn (pure rotation); 1 = pure one-sided flow. Feeds the
     * rotation-penalty step in {@link #scoreFlow(FlowInput, StockMetrics)}.
     */
    public static class FlowInput {
        public final double buyCr;
        public final double sellCr;
        public final int dealDays;
        public final double conviction;

        /** Legacy ctor — derives conviction from buy/sell if not supplied. */
        public FlowInput(double buyCr, double sellCr, int dealDays) {
            this(buyCr, sellCr, dealDays, defaultConviction(buyCr, sellCr));
        }

        public FlowInput(double buyCr, double sellCr, int dealDays, double conviction) {
            this.buyCr = buyCr;
            this.sellCr = sellCr;
            this.dealDays = dealDays;
            this.conviction = conviction;
        }

        public double net() { return buyCr - sellCr; }

        private static double defaultConviction(double buyCr, double sellCr) {
            double gross = buyCr + sellCr;
            return gross > 0 ? Math.abs(buyCr - sellCr) / gross : 0.0;
        }
    }

    /** 5-day OI change (percent). Null for non-F&O stocks. */
    public static class OiInput {
        public final Double oi5dPct;
        public OiInput(Double oi5dPct) { this.oi5dPct = oi5dPct; }
        public boolean available() { return oi5dPct != null; }
    }

    public static class ScoreBreakdown {
        public int bucket1, bucket2, bucket3, bucket4, bucket5;
        public int preClampScore, finalScore;
        public double dataConfidence;
        public List<String> clamps = new ArrayList<>();
        public String tier; // "FNO" or "NON_FNO"
    }

    /**
     * Score a stock. Returns a full breakdown so downstream can surface the
     * reasoning in the dashboard.
     *
     * @param m            enriched stock metrics (price/RS/volume/regime facts)
     * @param flow         institutional flow summary (time-decayed, deduped)
     * @param oi           OI input — {@code oi5dPct=null} for non-F&O
     */
    public ScoreBreakdown score(StockMetrics m, FlowInput flow, OiInput oi) {
        ScoreBreakdown out = new ScoreBreakdown();
        out.tier = oi.available() ? "FNO" : "NON_FNO";

        out.bucket1 = scoreFlow(flow, m, rotationPenaltyEnabled);
        out.bucket2 = scorePrice(m);
        out.bucket3 = scoreOi(oi, m, flow);
        out.bucket4 = scoreRelativeStrength(m);
        out.bucket5 = scoreVolume(m);

        int sum = out.bucket1 + out.bucket2 + out.bucket3 + out.bucket4 + out.bucket5;
        out.preClampScore = sum;

        int clamped = applyClamps(sum, m, flow, out.clamps);

        // Data confidence — reduces bullish scores built on sparse inputs
        out.dataConfidence = dataConfidence(m, flow, oi);
        if (out.dataConfidence < 0.6 && clamped > 0) {
            clamped = (int) Math.round(clamped * 0.7);
        }

        // ── Shadow FII/DII multiplier ─────────────────────────────────────
        // Compute BEFORE clamping so the stamped shadow fields reflect the
        // proposed bucket-1 scaling, not a post-clamp floor. When
        // {@code hotstocks.fiidii.apply=false} (default), nothing is applied
        // to finalScore — we just log what it WOULD have been.
        applyShadowFiiDii(out, m, clamped);

        out.finalScore = Math.max(-100, Math.min(100, clamped));
        return out;
    }

    /**
     * Populate shadow FII/DII fields on the metrics row and persist a per-run
     * Redis hash entry for offline audit. Never mutates finalScore unless
     * {@code hotstocks.fiidii.apply=true} (currently OFF for calibration).
     *
     * Note on signature: we accept the already-clamped score so the
     * "adjustedIfApplied" value reflects the same clamping pipeline the live
     * score will eventually go through.
     */
    private void applyShadowFiiDii(ScoreBreakdown out, StockMetrics m, int clampedScoreNoFiiDii) {
        if (fiiDiiResolver == null) {
            // Unit tests without Spring context — skip silently.
            return;
        }
        FiiDiiRegimeResolver.Regime regime = fiiDiiResolver.resolveLatestRegime();
        double multiplier = fiiDiiResolver.multiplierFor(regime);
        int shadowBucket1 = (int) Math.round(out.bucket1 * multiplier);
        int delta = (int) Math.round(out.bucket1 * (multiplier - 1.0));
        int adjustedIfApplied = clampedScoreNoFiiDii + delta;

        m.setShadowFiiDiiRegime(regime.name());
        m.setShadowFiiDiiMultiplier(multiplier);
        m.setShadowBucket1WithFiiDii(shadowBucket1);

        // Persist shadow to Redis for calibration. Key: one hash per (scrip, date).
        if (redis != null && m.getScripCode() != null) {
            try {
                String key = "hotstocks:shadow:fiidii:" + m.getScripCode() + ":"
                        + LocalDate.now(ZoneId.of("Asia/Kolkata")).format(DateTimeFormatter.ISO_LOCAL_DATE);
                Map<String, String> fields = new HashMap<>();
                fields.put("regime", regime.name());
                fields.put("proposedMultiplier", Double.toString(multiplier));
                fields.put("originalScore", Integer.toString(clampedScoreNoFiiDii));
                fields.put("adjustedScoreIfApplied", Integer.toString(adjustedIfApplied));
                redis.opsForHash().putAll(key, fields);
                redis.expire(key, SHADOW_FIIDII_TTL_SECONDS, TimeUnit.SECONDS);
            } catch (Exception ignored) {
                // shadow persistence is best-effort; don't fail scoring on Redis hiccup
            }
        }
    }

    // ── Bucket 1: Institutional flow ────────────────────────────────────────
    /** Back-compat entrypoint used by existing tests — rotation penalty defaults ON. */
    static int scoreFlow(FlowInput flow, StockMetrics m) {
        return scoreFlow(flow, m, true);
    }

    static int scoreFlow(FlowInput flow, StockMetrics m, boolean rotationPenaltyEnabled) {
        double net = flow.net();
        int s;
        if (net >= 50) s = 20;
        else if (net >= 20) s = 10;
        else if (net > -20) s = 0;
        else if (net >= -50) s = -10;
        else s = -20;

        // ── Rotation penalty ───────────────────────────────────────────────
        // Halve when conviction < 0.30 (heavy churn), quarter-cut in [0.30,0.50).
        // Intentionally runs BEFORE the delivery-institutional bonus + the
        // DELHIVERY-class soft penalty so the rotation multiplier shrinks the
        // raw net-tier contribution (the thing rotation actually erodes),
        // not the mismatched delivery bonus.
        if (rotationPenaltyEnabled) {
            if (flow.conviction < ROTATION_HALF_THRESHOLD) {
                s = (int) Math.round(s * 0.5);
            } else if (flow.conviction < ROTATION_QUARTER_THRESHOLD) {
                s = (int) Math.round(s * 0.75);
            }
        }

        // Soft net-flow penalty for DELHIVERY-class (net<-100 but not full distribution)
        if (net < -100 && flow.sellCr < 2 * Math.max(flow.buyCr, 0.01)) s -= 5;

        // Delivery-institutional bonus only in bullish/neutral regime
        String pr = m.getPriceRegime();
        if (m.isDeliveryInstitutional() &&
            ("BULLISH_TREND".equals(pr) || "NEUTRAL".equals(pr) || pr == null)) {
            s += 10;
        }
        return clamp(s, BUCKET1_CAP);
    }

    // ── Bucket 2: Price momentum ────────────────────────────────────────────
    static int scorePrice(StockMetrics m) {
        double c1 = m.getChange1dPct();
        double c5 = m.getChange5dPct();
        double c20 = m.getChange20dPct();
        double w52 = m.getWeekly52PositionPct() == null ? 0 : m.getWeekly52PositionPct();

        double s = 0;
        s += boundedLinear(c1,  2.0, 5);
        s += boundedLinear(c5,  2.0, 10);
        s += boundedLinear(c20, 0.5, 5);
        if (w52 > 80) s += 5;
        else if (w52 > 0 && w52 < 20) s -= 5;

        return clamp((int) Math.round(s), BUCKET2_CAP);
    }

    // ── Bucket 3: OI/futures congruence (F&O only) ──────────────────────────
    static int scoreOi(OiInput oi, StockMetrics m, FlowInput flow) {
        if (!oi.available()) return 0;
        double oi5d = oi.oi5dPct;
        double c5d = m.getChange5dPct();
        if (oi5d > 1 && c5d > 1) return 15;                                   // LONG_BUILDUP
        if (oi5d > 1 && c5d < -1) return -15;                                 // SHORT_BUILDUP
        if (oi5d < -1 && c5d > 1) return flow.net() >= 0 ? 5 : 0;             // SHORT_COVERING (only if flow not distributing)
        if (oi5d < -1 && c5d < -1) return -5;                                 // LONG_UNWINDING
        return 0;
    }

    // ── Bucket 4: Relative strength ─────────────────────────────────────────
    static int scoreRelativeStrength(StockMetrics m) {
        int s = 0;
        if ("LEADING".equals(m.getVsSectorLabel())) s += 10;
        else if ("LAGGING".equals(m.getVsSectorLabel())) s -= 10;
        if ("LEADING".equals(m.getVsNiftyLabel())) s += 5;
        else if ("LAGGING".equals(m.getVsNiftyLabel())) s -= 5;
        return clamp(s, BUCKET4_CAP);
    }

    // ── Bucket 5: Volume regime ─────────────────────────────────────────────
    static int scoreVolume(StockMetrics m) {
        String vr = m.getVolumeRegime();
        double c1 = m.getChange1dPct();
        if ("ELEVATED".equals(vr) && c1 > 0) return 5;
        if ("ELEVATED".equals(vr) && c1 < 0) return -7;
        if ("DRYING_UP".equals(vr) && c1 > 0) return -3;
        if ("DRYING_UP".equals(vr) && c1 < 0) return 3;
        return 0;
    }

    // ── Hard clamps ─────────────────────────────────────────────────────────
    //
    // Clamps run AFTER the bucket sum. They exist to catch known-bad regimes that
    // the additive buckets cannot veto on their own. Each clamp is independent;
    // many can stack on the same signal. Added clamps list the reason for UI.
    //
    // Ordering matters only for determinism of clamps[] output. Arithmetic effect
    // is additive — adjustments compose.

    static int applyClamps(int score, StockMetrics m, FlowInput flow, List<String> clamps) {
        int s = score;
        if ("BEARISH_TREND".equals(m.getPriceRegime())) {
            s = Math.min(s, 0);
            clamps.add("BEARISH_REGIME");
        }
        if (m.getChange5dPct() < -5) {
            s = Math.min(s, -30);
            clamps.add("FALLING_KNIFE");
        }
        if (flow.sellCr > 2 * Math.max(flow.buyCr, 0.01) && flow.sellCr > 25) {
            s -= 25;
            clamps.add("DISTRIBUTION");
        }
        Double w52 = m.getWeekly52PositionPct();
        if (w52 != null && w52 > 0 && w52 < 15) {
            s = Math.min(s, -10);
            clamps.add("BOTTOM_RANGE");
        }
        if (m.getChange1dPct() < -3 && "ELEVATED".equals(m.getVolumeRegime())) {
            s -= 15;
            clamps.add("HEAVY_SELL_YEST");
        }

        // ── Clamp: SMART_BUY_TAPE_SELL_DIVERGENCE ─────────────────────────────
        // Smart clients disclosed buying via bulk/block deals, but the aggregate
        // market is net-selling by a wide margin. Smart money may be selling in
        // the open market below disclosure thresholds — invisible here.
        // Catches the DELHIVERY-class pattern where the existing DISTRIBUTION
        // clamp (sell > 2× buy) doesn't fire but net-Cr is still strongly negative.
        double smartBuy = m.getSmartBuyCr();
        double smartSell = m.getSmartSellCr();
        double netCr = flow.net();
        if (smartBuy > 0 && smartSell < 5 && netCr < -100) {
            s -= 20;
            clamps.add("SMART_BUY_TAPE_SELL_DIVERGENCE");
        }

        // ── Clamp: LOW_DELIVERY_SPECULATION ───────────────────────────────────
        // Bullish score backed by LOW delivery % means the buyers are intraday
        // speculators who squared off at EOD. True institutional accumulation
        // shows up as high delivery %. Applied only when score is already
        // bullish — we're suppressing false-positive BUYs, not punishing SHORTs.
        double deliveryPct = m.getDeliveryPctLatest();
        if (s > 0 && deliveryPct > 0 && deliveryPct < 25 && smartBuy > 0) {
            s -= 15;
            clamps.add("LOW_DELIVERY_SPECULATION");
        }

        // ── Clamp: ROTATION_NOT_ACCUMULATION ─────────────────────────────────
        // Same smart client appears on BOTH buy and sell sides of the 7-day
        // window. That is rotation (or inter-fund position transfer), not
        // fresh accumulation. Suppress the consensus bonus assumption.
        List<String> buyers = m.getSmartBuyClients();
        List<String> sellers = m.getSmartSellClients();
        if (buyers != null && !buyers.isEmpty() && sellers != null && !sellers.isEmpty()) {
            java.util.Set<String> overlap = new java.util.HashSet<>(buyers);
            overlap.retainAll(sellers);
            if (!overlap.isEmpty()) {
                s -= 15;
                clamps.add("ROTATION_NOT_ACCUMULATION");
            }
        }

        // ── Clamp: PRE_EVENT_BLACKOUT ────────────────────────────────────────
        // Earnings / board meeting / results within the next 5 trading days
        // make smart-money signals ambiguous — flows could be positioning for
        // either an expected beat or information leak. Positional HotStocks
        // holds shouldn't take this binary risk.
        // ── Clamp: SMART_BUY_SHORT_RISING ────────────────────────────────────
        // Institutional short interest is growing alongside the smart buying.
        // Some institutions are expressing bearish views via stock-borrow shorts
        // while others accumulate cash — mixed smart-money positioning, bearish
        // skew if shorts are building faster than usual.
        // Threshold: +50% short interest growth over last 5 days vs prior 5.
        Double shortDelta = m.getShortInterestDelta5d();
        if (s > 0 && smartBuy > 0 && shortDelta != null && shortDelta > 0.50) {
            s -= 15;
            clamps.add("SMART_BUY_SHORT_RISING");
        }

        // ── Clamp: SMART_BUY_PUT_OI_BALLOONING ───────────────────────────────
        // Put OI growing faster than call OI (PCR rising) while smart money
        // buys cash = institutions hedging the purchase via options. Real
        // accumulation shows rising call OI, stable/falling put OI. A 15%
        // PCR rise over 5 days is conservative given our thin (5-10 day)
        // OI history; can tune down as data deepens.
        Double pcrDelta = m.getPcrDelta5d();
        if (s > 0 && smartBuy > 0 && pcrDelta != null && pcrDelta > 0.15) {
            s -= 20;
            clamps.add("SMART_BUY_PUT_OI_BALLOONING");
        }

        Integer daysToEventBoxed = m.getDaysToNearestEvent();
        String eventType = m.getNearestEventType();
        boolean blackoutEvent = eventType != null && (
                "EARNINGS".equalsIgnoreCase(eventType)
                || "RESULTS".equalsIgnoreCase(eventType)
                || "BOARD_MEETING".equalsIgnoreCase(eventType));
        if (daysToEventBoxed != null && blackoutEvent && s > 0) {
            int d = daysToEventBoxed;
            if (d >= 0 && d <= 5) {
                s = Math.min(s, 0);
                clamps.add("PRE_EVENT_BLACKOUT_" + eventType);
            }
        }

        return s;
    }

    /**
     * Data confidence: what fraction of buckets have meaningful data.
     *   3 points if enriched metrics exist (price/RS/volume — all from daily candles)
     *   1 point if OI input available
     *   1 point if any deal flow recorded
     */
    static double dataConfidence(StockMetrics m, FlowInput flow, OiInput oi) {
        int hits = 0;
        if (m.getChange5dPct() != 0 || m.getWeekly52PositionPct() != null) hits += 3;
        if (oi.available()) hits += 1;
        if (flow.buyCr > 0 || flow.sellCr > 0) hits += 1;
        return hits / 5.0;
    }

    private static int clamp(int v, int cap) { return Math.max(-cap, Math.min(cap, v)); }

    /** Value × slope, clipped to ±cap. Used for price-change buckets. */
    private static double boundedLinear(double value, double slope, double cap) {
        return Math.max(-cap, Math.min(cap, value * slope));
    }
}
