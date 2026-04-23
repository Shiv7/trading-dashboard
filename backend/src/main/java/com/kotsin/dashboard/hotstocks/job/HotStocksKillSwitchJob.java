package com.kotsin.dashboard.hotstocks.job;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Monitors the HOTSTOCKS wallet drawdown on a topup-aware basis and trips the
 * kill switch at 3% drawdown from DEPLOYED CAPITAL (initial + topups), not
 * from initial capital alone. Runs every 5 min during market hours.
 *
 * Formula (mirrors StrategyWalletsService.java:58-68 — the canonical dashboard
 * formula so kill-switch math stays in sync with what the UI reports):
 *
 *   declaredTopups     = sum(wallet.topupHistory[*].amount)
 *   declaredDeployed   = initialCapital + declaredTopups
 *   backCalcDeployed   = currentBalance − realizedPnl    (invariant-based)
 *   deployedCapital    = max(declared, backCalc)
 *   drawdownPct        = (deployedCapital − currentBalance) / deployedCapital × 100
 *
 * Without this topup-aware math the kill-switch would look at a ₹15L wallet
 * (₹10L initial + ₹5L topup) and only trip when balance fell below ₹9.7L — a
 * 36% single-day crash. The fixed formula trips at the intended ₹55K loss.
 *
 * When TRIPPED, HotStocksPositionOpenerJob skips all new position opens.
 * Hysteresis: auto-untrips when drawdown recovers below 2.0%.
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
            double realizedPnl = w.path("realizedPnl").asDouble(0);
            double declaredTopups = sumTopupHistory(w.path("topupHistory"));

            // Canonical deployed-capital derivation. Max of declared-history and back-calculated
            // catches undeclared admin adds / wallet resets (B4 fix in scoring_pipeline_data_audit).
            double declaredDeployed = initial + declaredTopups;
            double backCalcDeployed = current - realizedPnl;
            double deployedCapital = Math.max(declaredDeployed, backCalcDeployed);
            if (deployedCapital <= 0) return;

            double drawdownPct = (deployedCapital - current) / deployedCapital * 100.0;
            String prev = redis.opsForValue().get(KILL_SWITCH_KEY);
            boolean wasTripped = "TRIPPED".equals(prev);

            if (drawdownPct >= KILL_TRIP_PCT && !wasTripped) {
                redis.opsForValue().set(KILL_SWITCH_KEY, "TRIPPED");
                log.error("HOTSTOCKS KILL SWITCH TRIPPED — drawdown={}% deployed={} current={} (initial={} topups={} realizedPnl={})",
                    String.format("%.2f", drawdownPct), deployedCapital, current, initial, declaredTopups, realizedPnl);
            } else if (wasTripped && drawdownPct <= KILL_UNTRIP_PCT) {
                redis.delete(KILL_SWITCH_KEY);
                log.warn("HOTSTOCKS KILL SWITCH AUTO-UNTRIPPED — drawdown={}% recovered below {}% (deployed={} current={})",
                    String.format("%.2f", drawdownPct), KILL_UNTRIP_PCT, deployedCapital, current);
            }
        } catch (Exception e) {
            log.warn("HotStocksKillSwitchJob: check failed: {}", e.getMessage());
        }
    }

    /** Mirror of StrategyWalletsService.sumTopupHistory so both services compute deployed capital identically. */
    private static double sumTopupHistory(JsonNode history) {
        if (history == null || !history.isArray()) return 0;
        double sum = 0;
        for (JsonNode entry : history) {
            JsonNode amt = entry.path("amount");
            if (amt.isNumber()) sum += amt.asDouble();
        }
        return sum;
    }
}
