package com.kotsin.dashboard.observability;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Phase A/D 2026-05-05: Per-active-scrip tick freshness monitor.
 *
 * <p>Scheduled every {@code freshness.monitor.interval.ms} (default 30s).
 * Reads {@code trade-tick:{scripCode}} for every scrip with an open virtual
 * position; if the tick age exceeds the SLA, logs a TICK_STALE event to
 * the shipping_log.</p>
 *
 * <p>This is the bridge between the Phase A trade-tick freshness key and
 * the Phase D unified observability log. It surfaces freshness issues
 * BEFORE they cause LIVE_GATE_ABORT in cascade walker.</p>
 */
@Service
@Slf4j
public class FreshnessMonitor {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired(required = false)
    private ShippingLogService shippingLog;

    @Value("${freshness.monitor.enabled:true}")
    private boolean enabled;

    @Value("${freshness.sla.ms:60000}")
    private long slaMs;

    /** Scheduled per-active-scrip freshness check. */
    @Scheduled(fixedRateString = "${freshness.monitor.interval.ms:30000}")
    public void monitorActiveScrips() {
        if (!enabled) return;
        try {
            Set<String> activeScrips = collectActiveScrips();
            long now = System.currentTimeMillis();
            int stale = 0, fresh = 0, missing = 0;
            for (String scrip : activeScrips) {
                String tradeTickStr = redis.opsForValue().get("trade-tick:" + scrip);
                if (tradeTickStr == null) {
                    missing++;
                    if (shippingLog != null) {
                        Map<String, Object> details = new HashMap<>();
                        details.put("reason", "trade-tick key missing");
                        shippingLog.log("WARN", "FRESHNESS", scrip, null, "TICK_MISSING", details);
                    }
                    continue;
                }
                try {
                    long lastTickMs = Long.parseLong(tradeTickStr);
                    long ageMs = now - lastTickMs;
                    if (ageMs > slaMs) {
                        stale++;
                        if (shippingLog != null) {
                            Map<String, Object> details = new HashMap<>();
                            details.put("ageMs", ageMs);
                            details.put("slaMs", slaMs);
                            shippingLog.log("WARN", "FRESHNESS", scrip, null, "TICK_STALE", details);
                        }
                    } else {
                        fresh++;
                    }
                } catch (NumberFormatException nfe) {
                    log.debug("[FRESHNESS-MON] bad trade-tick value for {}: {}", scrip, tradeTickStr);
                }
            }
            if (shippingLog != null && (stale > 0 || missing > 0)) {
                log.info("[FRESHNESS-MON] active={} fresh={} stale={} missing={}",
                    activeScrips.size(), fresh, stale, missing);
            }
        } catch (Exception e) {
            log.warn("[FRESHNESS-MON] cycle failed: {}", e.getMessage());
        }
    }

    /** Collect scripCodes from open positions: virtual:positions:{strategy}:{scripCode}. */
    private Set<String> collectActiveScrips() {
        Set<String> scrips = new java.util.HashSet<>();
        try {
            Set<String> keys = redis.keys("virtual:positions:*:*");
            if (keys != null) {
                for (String key : keys) {
                    int idx = key.lastIndexOf(':');
                    if (idx > 0 && idx < key.length() - 1) {
                        scrips.add(key.substring(idx + 1));
                    }
                }
            }
            Set<String> tgtKeys = redis.keys("strategy:targets:*:*");
            if (tgtKeys != null) {
                for (String key : tgtKeys) {
                    int idx = key.lastIndexOf(':');
                    if (idx > 0 && idx < key.length() - 1) {
                        scrips.add(key.substring(idx + 1));
                    }
                }
            }
        } catch (Exception e) {
            log.debug("[FRESHNESS-MON] collectActiveScrips failed: {}", e.getMessage());
        }
        return scrips;
    }
}
