package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Opens virtual positions for the top-ranked Hot Stocks picks at market open.
 *
 * Runs at 09:15 IST Monday–Friday. Reads the ranked list from Redis (populated
 * by HotStocksEnrichmentJob at 05:45 IST), caps at MAX_POSITIONS, and POSTs
 * a StrategyTradeRequest-shaped payload to trade-exec's /api/strategy-trades.
 *
 * Honors HotStocksKillSwitchJob: if the kill switch is tripped, opens nothing.
 */
@Component
public class HotStocksPositionOpenerJob {
    private static final Logger log = LoggerFactory.getLogger(HotStocksPositionOpenerJob.class);
    private static final double POSITION_SIZE_RUPEES = 150_000.0;  // 1.5 L per position
    private static final int MAX_POSITIONS = 6;
    private static final double SL_PCT = 0.05;     // 5% stop loss
    private static final double T1_PCT = 0.05;     // 5% first target
    private static final String KILL_SWITCH_KEY = "hotstocks:v1:kill_switch";

    private final HotStocksService service;
    private final StringRedisTemplate redis;
    private final RestTemplate rest;

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String tradeExecUrl;

    public HotStocksPositionOpenerJob(HotStocksService service,
                                      StringRedisTemplate redis,
                                      @Qualifier("hotStocksRestTemplate") RestTemplate rest) {
        this.service = service;
        this.redis = redis;
        this.rest = rest;
    }

    @Scheduled(cron = "0 15 9 * * MON-FRI", zone = "Asia/Kolkata")
    public void openPositions() {
        log.info("HotStocksPositionOpenerJob starting");

        if ("TRIPPED".equals(redis.opsForValue().get(KILL_SWITCH_KEY))) {
            log.warn("HotStocksPositionOpenerJob: kill switch TRIPPED — skipping all position opens");
            return;
        }

        List<StockMetrics> ranked = service.loadRankedList();
        if (ranked.isEmpty()) {
            log.warn("HotStocksPositionOpenerJob: ranked list empty — enrichment cron did not populate?");
            return;
        }

        int opened = 0;
        int skipped = 0;
        int failed = 0;
        for (StockMetrics m : ranked) {
            if (opened >= MAX_POSITIONS) break;
            if (!m.isFnoEligible()) continue;
            if (hotStocksPositionExists(m.getScripCode())) {
                skipped++;
                log.info("HotStocksPositionOpenerJob: {} ({}) already has HOTSTOCKS position — skipping",
                    m.getSymbol(), m.getScripCode());
                continue;
            }
            try {
                openOne(m);
                opened++;
            } catch (Exception e) {
                failed++;
                log.warn("HotStocksPositionOpenerJob: failed to open {} ({}): {}",
                    m.getSymbol(), m.getScripCode(), e.getMessage());
            }
        }
        log.info("HotStocksPositionOpenerJob complete: {} opened, {} skipped (dedup), {} failed",
            opened, skipped, failed);
    }

    /**
     * Returns true if an active virtual:positions entry already exists for this scripCode
     * with signalSource=HOTSTOCKS. Trade-exec stores positions as JSON strings (not hashes),
     * so we GET and parse the signalSource + status fields. Dedup guard for idempotent
     * cron + manual triggers.
     */
    private boolean hotStocksPositionExists(String scripCode) {
        String key = "virtual:positions:" + scripCode;
        String json = redis.opsForValue().get(key);
        if (json == null || json.isBlank()) return false;
        try {
            com.fasterxml.jackson.databind.JsonNode n =
                new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
            String source = n.path("signalSource").asText("");
            String status = n.path("status").asText("");
            int qtyOpen = n.path("qtyOpen").asInt(0);
            return "HOTSTOCKS".equals(source) && qtyOpen > 0 && !"CLOSED".equals(status);
        } catch (Exception e) {
            log.debug("HotStocksPositionOpenerJob: dedup parse failed for {}: {}", scripCode, e.getMessage());
            return false;
        }
    }

    private void openOne(StockMetrics m) {
        double entry = m.getLtpYesterday();
        if (entry <= 0) {
            throw new IllegalStateException("invalid entry price: " + entry);
        }
        int qty = (int) Math.floor(POSITION_SIZE_RUPEES / entry);
        if (qty <= 0) {
            throw new IllegalStateException("computed qty <= 0 for entry=" + entry);
        }
        // Use SL from the enriched action cue if available, else fall back to percentage stop
        double sl = m.getSuggestedSlPrice() > 0 ? m.getSuggestedSlPrice() : entry * (1 - SL_PCT);
        double t1 = entry * (1 + T1_PCT);

        Map<String, Object> payload = new HashMap<>();
        // identity
        payload.put("scripCode", m.getScripCode());
        payload.put("instrumentSymbol", m.getSymbol());
        payload.put("instrumentType", "EQUITY");
        payload.put("underlyingScripCode", m.getScripCode());
        payload.put("underlyingSymbol", m.getSymbol());

        // side + sizing
        payload.put("side", "BUY");
        payload.put("quantity", qty);
        payload.put("lots", 1);
        payload.put("lotSize", 1);
        payload.put("multiplier", 1);

        // prices (note: sl and t1, NOT stopLoss and target)
        payload.put("entryPrice", entry);
        payload.put("sl", sl);
        payload.put("t1", t1);
        payload.put("t2", 0.0);
        payload.put("t3", 0.0);
        payload.put("t4", 0.0);

        // equity mirroring
        payload.put("equitySpot", entry);
        payload.put("equitySl", sl);
        payload.put("equityT1", t1);
        payload.put("equityT2", 0.0);
        payload.put("equityT3", 0.0);
        payload.put("equityT4", 0.0);

        // deltas + strategy routing
        payload.put("delta", 1.0);
        payload.put("strategy", "HOTSTOCKS");  // wallet routing key
        payload.put("exchange", "NSE");
        payload.put("direction", "LONG");
        payload.put("confidence", 0.75);
        payload.put("executionMode", "AUTO");
        payload.put("tradeLabel", "HOTSTOCKS_POSITIONAL");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);

        ResponseEntity<Map> response = rest.postForEntity(
            tradeExecUrl + "/api/strategy-trades", request, Map.class);
        log.info("HotStocksPositionOpenerJob: opened {} qty={} entry={} sl={} t1={} status={}",
            m.getSymbol(), qty, entry, sl, t1, response.getStatusCode());
    }
}
