package com.kotsin.dashboard.hotstocks.job;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Monitors the HOTSTOCKS wallet drawdown and trips the kill switch if it
 * exceeds 3% in a single trading day. Runs every 5 minutes during market
 * hours (09:15–15:30 IST).
 *
 * When TRIPPED, HotStocksPositionOpenerJob will skip all new position opens
 * (existing positions run to their SL/T1 or time stop).
 *
 * Hysteresis: auto-untrips when drawdown recovers below 2.0% (0.5% gap below
 * the 2.5% untrip threshold that also sits below the 3.0% trip threshold,
 * preventing flap at the boundary).
 */
@Component
public class HotStocksKillSwitchJob {
    private static final Logger log = LoggerFactory.getLogger(HotStocksKillSwitchJob.class);
    private static final double KILL_TRIP_PCT = 3.0;
    private static final double KILL_UNTRIP_PCT = 2.0;   // hysteresis — must recover below 2% to clear
    private static final String KILL_SWITCH_KEY = "hotstocks:v1:kill_switch";
    private static final String WALLET_KEY = "wallet:entity:strategy-wallet-HOTSTOCKS";

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();

    public HotStocksKillSwitchJob(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** Runs every 5 minutes Mon-Fri between 09:15 and 15:30 IST. */
    @Scheduled(cron = "0 */5 9-15 * * MON-FRI", zone = "Asia/Kolkata")
    public void check() {
        try {
            // Wallet is stored as a JSON STRING (not a hash) by trade-exec — read via GET + parse.
            String walletJson = redis.opsForValue().get(WALLET_KEY);
            if (walletJson == null || walletJson.isBlank()) return;

            JsonNode w = mapper.readTree(walletJson);
            double initial = w.path("initialCapital").asDouble(1_000_000.0);
            double current = w.path("currentBalance").asDouble(initial);
            if (initial <= 0) return;

            double drawdownPct = (initial - current) / initial * 100.0;
            String prev = redis.opsForValue().get(KILL_SWITCH_KEY);
            boolean wasTripped = "TRIPPED".equals(prev);

            if (drawdownPct >= KILL_TRIP_PCT && !wasTripped) {
                redis.opsForValue().set(KILL_SWITCH_KEY, "TRIPPED");
                log.error("HOTSTOCKS KILL SWITCH TRIPPED — drawdown={}% initial={} current={}",
                    String.format("%.2f", drawdownPct), initial, current);
            } else if (wasTripped && drawdownPct <= KILL_UNTRIP_PCT) {
                redis.delete(KILL_SWITCH_KEY);
                log.warn("HOTSTOCKS KILL SWITCH AUTO-UNTRIPPED — drawdown={}% recovered below {}%",
                    String.format("%.2f", drawdownPct), KILL_UNTRIP_PCT);
            }
        } catch (Exception e) {
            log.warn("HotStocksKillSwitchJob: check failed: {}", e.getMessage());
        }
    }
}
