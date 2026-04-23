package com.kotsin.dashboard.hotstocks.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * Resolves the current FII/DII flow regime from the latest Redis-cached NSE
 * provisional report. Used in SHADOW mode only — actual score multiplier is
 * gated by {@code hotstocks.fiidii.apply}.
 *
 * Redis key format: {@code market-pulse:fii-dii:{ISO_DATE}} — JSON object with
 * nested {@code FII} + {@code DII} records each carrying {@code netValue} in
 * INR Cr. Populated daily by FastAnalytics after NSE publish (~18:00 IST).
 *
 * Regime classification uses a single ±500 Cr threshold on each side; values
 * below threshold collapse to FLAT regardless of sign so marginal days don't
 * produce noisy regime flips.
 */
@Component
public class FiiDiiRegimeResolver {

    private static final Logger log = LoggerFactory.getLogger(FiiDiiRegimeResolver.class);
    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final String KEY_PREFIX = "market-pulse:fii-dii:";
    private static final int LOOKBACK_DAYS = 3;  // fall back up to 3 days if today missing

    public enum Regime { BOTH_BUY, BOTH_SELL, FII_DIVERGE, DII_DIVERGE, FLAT }

    public static final double STRONG_FLOW_CR = 500.0;  // ±500Cr threshold

    public static final double MULT_TAILWIND = 1.10;
    public static final double MULT_HEADWIND = 0.85;
    public static final double MULT_NEUTRAL  = 1.00;

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    @Autowired
    public FiiDiiRegimeResolver(StringRedisTemplate redis, ObjectMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
    }

    /**
     * Read the most recent FII/DII data within {@link #LOOKBACK_DAYS} and
     * classify. Returns {@link Regime#FLAT} on any parse/read failure so
     * downstream picks up the neutral multiplier without exception.
     */
    public Regime resolveLatestRegime() {
        try {
            LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
            for (int offset = 0; offset < LOOKBACK_DAYS; offset++) {
                LocalDate d = today.minusDays(offset);
                String key = KEY_PREFIX + d.format(ISO);
                String json = redis.opsForValue().get(key);
                if (json == null || json.isBlank()) continue;
                JsonNode root = mapper.readTree(json);
                double fiiNet = root.path("FII").path("netValue").asDouble(0.0);
                double diiNet = root.path("DII").path("netValue").asDouble(0.0);
                return classify(fiiNet, diiNet);
            }
            log.debug("FiiDiiRegimeResolver: no FII/DII data in last {} days — defaulting to FLAT", LOOKBACK_DAYS);
            return Regime.FLAT;
        } catch (Exception e) {
            log.warn("FiiDiiRegimeResolver: regime resolution failed — defaulting to FLAT: {}", e.getMessage());
            return Regime.FLAT;
        }
    }

    /**
     * Pure classifier. Exposed for tests and callers that already have the
     * two net values in hand.
     */
    public Regime classify(double fiiNetCr, double diiNetCr) {
        boolean fiiStrongBuy = fiiNetCr >= STRONG_FLOW_CR;
        boolean fiiStrongSell = fiiNetCr <= -STRONG_FLOW_CR;
        boolean diiStrongBuy = diiNetCr >= STRONG_FLOW_CR;
        boolean diiStrongSell = diiNetCr <= -STRONG_FLOW_CR;

        if (fiiStrongBuy && diiStrongBuy) return Regime.BOTH_BUY;
        if (fiiStrongSell && diiStrongSell) return Regime.BOTH_SELL;
        // Divergence — one side strongly one way while the other is the opposite
        if (fiiStrongBuy && diiStrongSell) return Regime.FII_DIVERGE;   // FII bullish, DII bearish
        if (fiiStrongSell && diiStrongBuy) return Regime.DII_DIVERGE;   // DII bullish, FII bearish
        return Regime.FLAT;
    }

    /**
     * Proposed score multiplier given a regime. Only BOTH_BUY / BOTH_SELL move
     * the needle; divergences stay neutral because direction attribution is
     * ambiguous.
     */
    public double multiplierFor(Regime r) {
        return switch (r) {
            case BOTH_BUY  -> MULT_TAILWIND;
            case BOTH_SELL -> MULT_HEADWIND;
            default         -> MULT_NEUTRAL;
        };
    }
}
