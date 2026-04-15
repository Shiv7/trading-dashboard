package com.kotsin.dashboard.hotstocks.job;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Daily 09:14 IST refresh job (1 min before HotStocksPositionOpenerJob at 09:15).
 *
 * Refreshes currentPrice + unrealizedPnl for every active HOTSTOCKS virtual
 * position, and fetches LTP for today's top-6 ranked candidates (for downstream
 * display use — candidates without positions are NOT written back).
 *
 * LTP source: Redis key {@code ltp:{scripCode}} (populated by streaming candle).
 * This matches the pattern already used by {@code RetestReEntryService} in
 * trade-exec. No HTTP call to trade-exec required.
 *
 * Writes {@code hotstocks:v1:refresh:last_run} (millis) after completion so
 * downstream can verify freshness.
 */
@Component
public class HotStocksDailyRefreshJob {
    private static final Logger log = LoggerFactory.getLogger(HotStocksDailyRefreshJob.class);
    private static final String LOG_PREFIX = "[HOTSTOCKS-REFRESH]";
    private static final String POSITIONS_KEY_PREFIX = "virtual:positions:";
    private static final String LTP_KEY_PREFIX = "ltp:";
    private static final String LAST_RUN_KEY = "hotstocks:v1:refresh:last_run";
    private static final int CANDIDATE_LIMIT = 6;

    private final HotStocksService service;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();

    public HotStocksDailyRefreshJob(HotStocksService service, StringRedisTemplate redis) {
        this.service = service;
        this.redis = redis;
    }

    @Scheduled(cron = "0 14 9 * * MON-FRI", zone = "Asia/Kolkata")
    public void refresh() {
        long start = System.currentTimeMillis();
        log.info("{} action=START", LOG_PREFIX);

        // 1. Enumerate active HOTSTOCKS position scripCodes
        Set<String> activeScripCodes = collectActiveHotStocksScripCodes();

        // 2. Enumerate today's top-6 candidates
        Set<String> candidateScripCodes = new LinkedHashSet<>();
        try {
            List<StockMetrics> ranked = service.loadRankedList();
            if (ranked != null) {
                ranked.stream().limit(CANDIDATE_LIMIT)
                    .map(StockMetrics::getScripCode)
                    .filter(s -> s != null && !s.isBlank())
                    .forEach(candidateScripCodes::add);
            }
        } catch (Exception e) {
            log.warn("{} action=LOAD_RANKED_FAILED err={}", LOG_PREFIX, e.getMessage());
        }

        // 3. No-op short-circuit
        if (activeScripCodes.isEmpty() && candidateScripCodes.isEmpty()) {
            log.info("{} action=COMPLETE activePositions=0 candidates=0 updated=0 skipped=0 elapsedMs={}",
                LOG_PREFIX, System.currentTimeMillis() - start);
            writeLastRun();
            return;
        }

        // 4. Union
        Set<String> union = new LinkedHashSet<>();
        union.addAll(activeScripCodes);
        union.addAll(candidateScripCodes);

        int updated = 0, skipped = 0, candidatesFetched = 0, failed = 0;
        for (String scripCode : union) {
            try {
                Double ltp = fetchLtp(scripCode);
                if (ltp == null) {
                    log.info("{} scrip={} action=SKIP_NO_LTP", LOG_PREFIX, scripCode);
                    skipped++;
                    continue;
                }
                if (activeScripCodes.contains(scripCode)) {
                    if (updatePositionLtpAndPnL(scripCode, ltp)) {
                        updated++;
                    } else {
                        skipped++;
                    }
                } else {
                    // Candidate-only — LTP fetched for display, not persisted to position
                    log.info("{} scrip={} action=CANDIDATE_LTP ltp={}", LOG_PREFIX, scripCode, ltp);
                    candidatesFetched++;
                }
            } catch (Exception e) {
                failed++;
                log.warn("{} scrip={} action=REFRESH_FAILED err={}", LOG_PREFIX, scripCode, e.getMessage());
            }
        }

        writeLastRun();
        log.info("{} action=COMPLETE activePositions={} candidates={} updated={} candidatesFetched={} skipped={} failed={} elapsedMs={}",
            LOG_PREFIX, activeScripCodes.size(), candidateScripCodes.size(),
            updated, candidatesFetched, skipped, failed, System.currentTimeMillis() - start);
    }

    private Set<String> collectActiveHotStocksScripCodes() {
        Set<String> out = new HashSet<>();
        Set<String> keys;
        try {
            keys = redis.keys(POSITIONS_KEY_PREFIX + "*");
        } catch (Exception e) {
            log.warn("{} action=KEYS_FAILED err={}", LOG_PREFIX, e.getMessage());
            return out;
        }
        if (keys == null || keys.isEmpty()) return out;
        for (String key : keys) {
            try {
                String json = redis.opsForValue().get(key);
                if (json == null || json.isBlank()) continue;
                JsonNode pos = mapper.readTree(json);
                if (!"HOTSTOCKS".equals(pos.path("signalSource").asText(""))) continue;
                String status = pos.path("status").asText("");
                int qtyOpen = pos.path("qtyOpen").asInt(0);
                if ("CLOSED".equals(status) || qtyOpen <= 0) continue;
                String scripCode = pos.path("scripCode").asText(null);
                if (scripCode == null || scripCode.isBlank()) {
                    int idx = key.lastIndexOf(':');
                    scripCode = idx >= 0 ? key.substring(idx + 1) : null;
                }
                if (scripCode != null && !scripCode.isBlank()) out.add(scripCode);
            } catch (Exception e) {
                log.warn("{} action=PARSE_POS_FAILED key={} err={}", LOG_PREFIX, key, e.getMessage());
            }
        }
        return out;
    }

    /** Fetches LTP from Redis {@code ltp:{scripCode}}. Returns null on any failure. */
    Double fetchLtp(String scripCode) {
        try {
            String val = redis.opsForValue().get(LTP_KEY_PREFIX + scripCode);
            if (val == null || val.isBlank()) return null;
            double parsed = Double.parseDouble(val.trim());
            return parsed > 0 ? parsed : null;
        } catch (Exception e) {
            log.warn("{} scrip={} action=LTP_FETCH_FAILED err={}", LOG_PREFIX, scripCode, e.getMessage());
            return null;
        }
    }

    /**
     * Reads the position JSON, updates currentPrice, unrealizedPnl, lastRefreshAt,
     * and writes back. Returns true if the write succeeded.
     *
     * HOTSTOCKS positions are LONG only — unrealizedPnl = (ltp - entryPrice) * qtyOpen.
     */
    boolean updatePositionLtpAndPnL(String scripCode, double ltp) {
        String key = POSITIONS_KEY_PREFIX + scripCode;
        try {
            String json = redis.opsForValue().get(key);
            if (json == null || json.isBlank()) return false;
            JsonNode node = mapper.readTree(json);
            if (!(node instanceof ObjectNode)) return false;
            ObjectNode pos = (ObjectNode) node;

            double entryPrice = pos.path("entryPrice").asDouble(0.0);
            int qtyOpen = pos.path("qtyOpen").asInt(0);
            double unrealizedPnl = (ltp - entryPrice) * qtyOpen;

            pos.put("currentPrice", ltp);
            pos.put("unrealizedPnl", unrealizedPnl);
            pos.put("lastRefreshAt", System.currentTimeMillis());

            redis.opsForValue().set(key, mapper.writeValueAsString(pos));
            log.info("{} scrip={} action=POSITION_UPDATED ltp={} entryPrice={} qtyOpen={} unrealizedPnl={}",
                LOG_PREFIX, scripCode, ltp, entryPrice, qtyOpen, unrealizedPnl);
            return true;
        } catch (Exception e) {
            log.warn("{} scrip={} action=UPDATE_FAILED err={}", LOG_PREFIX, scripCode, e.getMessage());
            return false;
        }
    }

    private void writeLastRun() {
        try {
            redis.opsForValue().set(LAST_RUN_KEY, Long.toString(System.currentTimeMillis()));
        } catch (Exception e) {
            log.warn("{} action=LAST_RUN_WRITE_FAILED err={}", LOG_PREFIX, e.getMessage());
        }
    }
}
