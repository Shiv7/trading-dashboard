package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Gate that prevents duplicate HotStocks entries when the same scrip is already
 * sitting in the wallet. Backed by the per-strategy Redis key pattern
 * {@code virtual:positions:HOTSTOCKS:{scripCode}} introduced with the Phase-2
 * per-strategy key migration (2026-04-22).
 *
 * Two responsibilities:
 *   1. {@link #fetchHeldScripCodes()} — bulk enumeration used by the enrichment
 *      flow to stamp {@code alreadyHeld} on each StockMetrics row.
 *   2. {@link #mayOpen(StockMetrics)} — per-candidate decision used by the
 *      position opener to block re-entries unless a fresh deal printed today.
 *
 * Behaviour follows the standard "first deal wins" rule: a held scrip is only
 * re-evaluated if a brand-new deal (dated today) has emerged since entry —
 * otherwise we leave the existing position alone.
 */
@Component
public class HotStocksPositionGate {

    private static final Logger log = LoggerFactory.getLogger(HotStocksPositionGate.class);
    static final String KEY_PREFIX = "virtual:positions:HOTSTOCKS:";

    private final StringRedisTemplate redis;

    @Autowired
    public HotStocksPositionGate(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /**
     * Returns the set of scripCodes currently held in the HOTSTOCKS wallet.
     * Keys of the shape {@code virtual:positions:HOTSTOCKS:{scripCode}} are
     * stripped of their prefix and returned raw. Redis failure → empty set
     * (permissive; a later check still runs on open attempt).
     */
    public Set<String> fetchHeldScripCodes() {
        try {
            Set<String> keys = redis.keys(KEY_PREFIX + "*");
            if (keys == null || keys.isEmpty()) return Collections.emptySet();
            return keys.stream()
                    .map(k -> k.substring(KEY_PREFIX.length()))
                    .collect(Collectors.toSet());
        } catch (Exception e) {
            log.warn("HotStocksPositionGate.fetchHeldScripCodes failed: {}", e.getMessage());
            return Collections.emptySet();
        }
    }

    /**
     * Gate for the position opener.
     *  - Not held            → always allow (fresh candidate)
     *  - Held + fresh deal   → allow re-evaluation (the opener can still reject
     *                          for other reasons like capital/budget)
     *  - Held + no fresh deal → skip (avoid duplicate entries)
     */
    public boolean mayOpen(StockMetrics m) {
        if (m == null) return false;
        if (!m.isAlreadyHeld()) return true;
        if (m.isHasNewDealToday()) return true;
        return false;
    }
}
