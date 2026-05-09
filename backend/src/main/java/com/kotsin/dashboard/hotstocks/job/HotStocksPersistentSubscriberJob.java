package com.kotsin.dashboard.hotstocks.job;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 2026-05-07 (HOTSTOCKS persistent subscription system).
 *
 * <p>Problem this fixes: at 09:15 IST IST, EquitySchedular fires ~2952 sequential
 * subscribe calls (213 EQ + 469 FUT + 2270 OPT). At 5paisa rate-limits, this takes
 * many minutes. HOTSTOCKS opens at 09:16:10 / 09:17:10 — many picks haven't
 * received their first tick yet → WS-orphan service force-kills with
 * UNRESOLVED_ORPHAN_FORCE_EXIT. Last 30 days: 30 such kills, ~₹12K loss.</p>
 *
 * <h3>Design</h3>
 * <ol>
 *   <li>HotStocksEnrichmentJob ranks picks at 05:45 IST (existing).</li>
 *   <li>HotStocksNonFnoScanJob ranks non-F&amp;O at 17:45 IST (existing).</li>
 *   <li><b>This job runs at 09:00 IST</b> — 15 minutes before the equity
 *       stampede. Reads merged ranked list, picks top-N (default 8 = 6 F&amp;O + 2
 *       non-F&amp;O), and calls OptionProducer's /api/ws/priority-subscribe
 *       which sets Priority.ACTIVE_TRADE.</li>
 *   <li>ACTIVE_TRADE is preserved by both SubscriptionEodCleaner and
 *       StalePruneService — subs survive across sessions automatically. No
 *       changes needed in OptionProducer.</li>
 *   <li>Diff vs previous day: read last-subscribed Set from Redis, unsubscribe
 *       removed picks, subscribe new picks. Idempotent on unchanged picks.</li>
 * </ol>
 *
 * <h3>Why ACTIVE_TRADE not BASE</h3>
 * BASE-priority subs are pruned by StalePruneService after 5 min without ticks
 * (which is exactly what happens overnight 15:30→09:15). ACTIVE_TRADE is
 * pinned — never evicted. We're using it semantically as "intended-trade",
 * not "actually open" — but it's safe because every other code path checks
 * ACTIVE_TRADE only to AVOID evicting, never to assume an open position.
 *
 * <h3>Kill switch</h3>
 * {@code hotstocks.persistent.subscription.enabled=false} disables the cron
 * entirely; reverts to the legacy 09:15 stampede behaviour.
 */
@Component
public class HotStocksPersistentSubscriberJob {

    private static final Logger log = LoggerFactory.getLogger(HotStocksPersistentSubscriberJob.class);
    private static final String LAST_SUBSCRIBED_KEY = "persistent:sub:HOTSTOCKS:lastSubscribed";

    private final HotStocksService service;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();
    private final RestTemplate rest = new RestTemplate();

    @Value("${hotstocks.persistent.subscription.enabled:true}")
    private boolean enabled;

    @Value("${hotstocks.persistent.subscription.top.n:8}")
    private int topN;

    @Value("${option.producer.base.url:http://localhost:8208}")
    private String optionProducerBaseUrl;

    public HotStocksPersistentSubscriberJob(HotStocksService service, StringRedisTemplate redis) {
        this.service = service;
        this.redis = redis;
    }

    /**
     * 09:01 IST cron — 14 minutes before EquitySchedular's 09:15 stampede.
     *
     * <p>Picks get a head start so when 5paisa starts streaming at 09:15:00,
     * HOTSTOCKS subs are already in the queue and tick immediately. The opener
     * at 09:16:10 sees fresh tick data instead of a still-warming feed.</p>
     *
     * <p>Why 09:01 not 09:00: 5paisa cycles its WebSocket at exactly 09:00:00 IST
     * for the pre-open → open transition. The reconnect window (~30s) caused all
     * 8 PSUB calls to fail on 2026-05-08. 09:01:00 lands well after reconnect.</p>
     */
    @Scheduled(cron = "0 1 9 * * MON-FRI", zone = "Asia/Kolkata")
    public void run() {
        if (!enabled) {
            log.info("[HOTSTOCKS-PSUB] disabled via kill switch");
            return;
        }

        try {
            List<StockMetrics> merged = service.loadRankedList();
            if (merged == null || merged.isEmpty()) {
                log.warn("[HOTSTOCKS-PSUB] ranked list empty — enrichment job didn't populate or Redis TTL expired. Skipping subscribe.");
                return;
            }

            // Take top-N by v2Score (already sorted DESC in loadRankedList).
            Set<String> targetCodes = new LinkedHashSet<>();
            for (StockMetrics m : merged) {
                if (targetCodes.size() >= topN) break;
                if (m.getScripCode() != null) targetCodes.add(m.getScripCode());
            }

            // Read last subscribed Set (carried from yesterday or earlier).
            Set<String> lastCodes = readLastSubscribed();

            // Diff: subscribe only new; unsubscribe removed.
            // Subscribe is also IDEMPOTENT — calling subscribe on already-subscribed scrip
            // is a no-op at OptionProducer side, so on first day after restart we re-create.
            Set<String> toAdd = new LinkedHashSet<>(targetCodes);
            toAdd.removeAll(lastCodes);
            Set<String> toRemove = new LinkedHashSet<>(lastCodes);
            toRemove.removeAll(targetCodes);

            int subscribed = 0, failed = 0;
            for (String sc : targetCodes) {  // subscribe ALL (idempotent) so OP restart recovers.
                StockMetrics m = findByScripCode(merged, sc);
                if (m == null) continue;
                boolean ok = prioritySubscribe(sc, m.getSymbol());
                if (ok) subscribed++; else failed++;
            }

            int unsubscribed = 0;
            for (String sc : toRemove) {
                if (unsubscribeBase(sc)) unsubscribed++;
            }

            // Persist last-subscribed for next day's diff.
            try {
                redis.opsForValue().set(LAST_SUBSCRIBED_KEY, mapper.writeValueAsString(targetCodes));
            } catch (Exception e) {
                log.warn("[HOTSTOCKS-PSUB] failed to persist last-subscribed: {}", e.getMessage());
            }

            log.info("[HOTSTOCKS-PSUB] subscribed={} (added={}, idempotent={}) unsubscribed={} failed={} target={}",
                    subscribed, toAdd.size(), targetCodes.size() - toAdd.size(), unsubscribed, failed, targetCodes);
        } catch (Exception e) {
            log.error("[HOTSTOCKS-PSUB] cron failed", e);
        }
    }

    private Set<String> readLastSubscribed() {
        try {
            String json = redis.opsForValue().get(LAST_SUBSCRIBED_KEY);
            if (json == null || json.isBlank()) return new HashSet<>();
            return mapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<Set<String>>() {});
        } catch (Exception e) {
            log.warn("[HOTSTOCKS-PSUB] failed to read last-subscribed: {}", e.getMessage());
            return new HashSet<>();
        }
    }

    private StockMetrics findByScripCode(List<StockMetrics> list, String sc) {
        for (StockMetrics m : list) {
            if (sc.equals(m.getScripCode())) return m;
        }
        return null;
    }

    /**
     * Calls OptionProducer's /api/ws/priority-subscribe so the sub is pinned
     * with Priority.ACTIVE_TRADE — preserved by EOD cleaner + StalePrune.
     *
     * <p>Retries up to {@link #PRIORITY_SUBSCRIBE_MAX_ATTEMPTS} with
     * {@link #PRIORITY_SUBSCRIBE_BACKOFF_MS} between attempts. This survives
     * the 5paisa 09:00 IST WebSocket reconnect window in case clock skew
     * pushes our cron back into the disconnect.</p>
     */
    private boolean prioritySubscribe(String scripCode, String symbol) {
        Map<String, String> body = new HashMap<>();
        body.put("scripCode", scripCode);
        body.put("companyName", symbol != null ? symbol : scripCode);
        body.put("exch", "N");
        body.put("exchType", "C");
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, String>> req = new HttpEntity<>(body, h);

        String lastErr = null;
        for (int attempt = 1; attempt <= PRIORITY_SUBSCRIBE_MAX_ATTEMPTS; attempt++) {
            try {
                rest.postForObject(optionProducerBaseUrl + "/api/ws/priority-subscribe", req, String.class);
                if (attempt > 1) {
                    log.info("[HOTSTOCKS-PSUB] priority-subscribe OK for {} ({}) on attempt {}/{}",
                            scripCode, symbol, attempt, PRIORITY_SUBSCRIBE_MAX_ATTEMPTS);
                }
                return true;
            } catch (Exception e) {
                lastErr = e.getMessage();
                if (attempt < PRIORITY_SUBSCRIBE_MAX_ATTEMPTS) {
                    log.warn("[HOTSTOCKS-PSUB] priority-subscribe attempt {}/{} failed for {} ({}): {} — retrying in {}ms",
                            attempt, PRIORITY_SUBSCRIBE_MAX_ATTEMPTS, scripCode, symbol, lastErr,
                            PRIORITY_SUBSCRIBE_BACKOFF_MS);
                    try { Thread.sleep(PRIORITY_SUBSCRIBE_BACKOFF_MS); }
                    catch (InterruptedException ie) { Thread.currentThread().interrupt(); return false; }
                }
            }
        }
        log.warn("[HOTSTOCKS-PSUB] priority-subscribe failed for {} ({}) after {} attempts: {}",
                scripCode, symbol, PRIORITY_SUBSCRIBE_MAX_ATTEMPTS, lastErr);
        return false;
    }

    private static final int PRIORITY_SUBSCRIBE_MAX_ATTEMPTS = 3;
    private static final long PRIORITY_SUBSCRIBE_BACKOFF_MS = 5000L;

    /** Best-effort unsubscribe of yesterday's pick that didn't carry over. */
    private boolean unsubscribeBase(String scripCode) {
        try {
            Map<String, String> body = new HashMap<>();
            body.put("scripCode", scripCode);
            body.put("exch", "N");
            body.put("exchType", "C");
            HttpHeaders h = new HttpHeaders();
            h.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, String>> req = new HttpEntity<>(body, h);
            rest.postForObject(optionProducerBaseUrl + "/api/ws/unsubscribe", req, String.class);
            return true;
        } catch (Exception e) {
            log.debug("[HOTSTOCKS-PSUB] unsubscribe failed for {}: {}", scripCode, e.getMessage());
            return false;
        }
    }

    /** Test-only — invoke the cron directly. */
    public void runForTest() { run(); }
}
