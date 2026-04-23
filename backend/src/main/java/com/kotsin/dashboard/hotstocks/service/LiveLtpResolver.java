package com.kotsin.dashboard.hotstocks.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * LiveLtpResolver — reads the most recent live traded price for a scripCode
 * from Redis ({@code price:<exch>:<scripCode>}, written by streamingcandle's
 * {@code RedisCacheService.cacheLivePrice} on every tick).
 *
 * Called by HotStocksPositionOpenerJob at 09:15:00.x IST to replace the
 * previous-day-close entry price (the 2026-04-23 bug where positions opened
 * at {@code ltpYesterday} incurred immediate phantom P&L equal to the
 * overnight gap).
 *
 * Fallback chain:
 *   1. Redis live LTP (fresh — TTL is 300s, feed begins tick-arrival at 09:15:00)
 *   2. Caller-supplied ltpYesterday (last-resort; used only when live feed missing)
 *
 * Static helpers are extracted to keep unit tests trivial and the injection
 * surface of the Spring-managed component minimal.
 */
@Component
public class LiveLtpResolver {

    private static final Logger log = LoggerFactory.getLogger(LiveLtpResolver.class);
    private static final String PRICE_KEY_PREFIX = "price:";
    private static final String DEFAULT_EXCHANGE = "N";

    private final StringRedisTemplate redis;

    public LiveLtpResolver(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /**
     * Primary entry point. Returns a valid entry price or throws.
     *
     * @param scripCode    tradable scripCode (e.g. "11630" for NTPC)
     * @param exchange     "N" / "M" / "C" — null/blank defaults to NSE
     * @param ltpYesterday fallback from StockMetrics when live feed unavailable
     * @throws IllegalStateException if neither live nor yesterday is positive
     */
    public double resolveEntry(String scripCode, String exchange, double ltpYesterday) {
        double live = readLivePrice(scripCode, exchange).orElse(0.0);
        if (live > 0) {
            double diffPct = ltpYesterday > 0
                ? Math.abs(live - ltpYesterday) / ltpYesterday * 100.0
                : 0;
            log.info("[LIVE-LTP] scrip={} exch={} live={} yesterday={} deltaPct={}",
                scripCode, exchange, live, ltpYesterday, String.format("%.2f", diffPct));
        } else {
            log.warn("[LIVE-LTP] scrip={} exch={} live feed MISSING — falling back to yesterday={}",
                scripCode, exchange, ltpYesterday);
        }
        return resolveEntryPrice(live, ltpYesterday);
    }

    /** Pure helper for unit testing — no Redis dependency. */
    public static double resolveEntryPrice(double liveLtp, double ltpYesterday) {
        if (liveLtp > 0) return liveLtp;
        if (ltpYesterday > 0) return ltpYesterday;
        throw new IllegalStateException(
            "no valid entry price: liveLtp=" + liveLtp + " ltpYesterday=" + ltpYesterday);
    }

    /** Pure helper for unit testing — parses raw string from Redis to positive double. */
    public static Optional<Double> parseLivePrice(String raw) {
        if (raw == null) return Optional.empty();
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) return Optional.empty();
        try {
            double v = Double.parseDouble(trimmed);
            return v > 0 ? Optional.of(v) : Optional.empty();
        } catch (NumberFormatException e) {
            return Optional.empty();
        }
    }

    /** Pure helper for unit testing — builds the Redis key with NSE default. */
    public static String buildPriceKey(String scripCode, String exchange) {
        String exch = (exchange == null || exchange.isBlank()) ? DEFAULT_EXCHANGE : exchange.trim();
        return PRICE_KEY_PREFIX + exch + ":" + scripCode;
    }

    /** Redis read. Returns Optional.empty() on any failure (missing key, bad value, IO error). */
    Optional<Double> readLivePrice(String scripCode, String exchange) {
        if (scripCode == null || scripCode.isBlank()) return Optional.empty();
        try {
            String raw = redis.opsForValue().get(buildPriceKey(scripCode, exchange));
            return parseLivePrice(raw);
        } catch (Exception e) {
            log.debug("[LIVE-LTP] Redis read failed for {}:{}: {}", exchange, scripCode, e.getMessage());
            return Optional.empty();
        }
    }
}
