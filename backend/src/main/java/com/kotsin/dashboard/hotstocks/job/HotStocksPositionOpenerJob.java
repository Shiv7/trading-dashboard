package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.data.ConfluenceTargetsClient;
import com.kotsin.dashboard.hotstocks.data.EquityScripCodeResolver;
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
import java.util.Optional;

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
    private static final String LOG_PREFIX = "[HOTSTOCKS-OPENER]";
    private static final double POSITION_SIZE_RUPEES = 150_000.0;  // 1.5 L per position
    // Positional strategy: up to 6 NEW entries per day, up to 50 concurrent active positions.
    // Replaces legacy MAX_POSITIONS=6 which capped TOTAL active — wrong for positional multi-day holds.
    static final int MAX_NEW_PER_DAY = 6;
    static final int MAX_CONCURRENT = 50;
    private static final double SL_PCT = 0.05;     // 5% stop loss
    // Staircase tuned from retrospective backtest (2026-04-15):
    // 17 real picks showed 88% forward-positive but ZERO hit +5% within 10 days.
    // Mean outcome +1.27%/trade. Lowering T1 to +2% locks in the typical grinding
    // winner; T2-T4 capture breakouts.
    private static final double T1_PCT = 0.02;     // 2% — catches typical grinder
    private static final double T2_PCT = 0.05;     // 5% — gap/breakout tier
    private static final double T3_PCT = 0.08;     // 8% — strong trender
    private static final double T4_PCT = 0.12;     // 12% — exceptional run
    private static final String KILL_SWITCH_KEY = "hotstocks:v1:kill_switch";
    private static final String POSITIONS_KEY_PREFIX = "virtual:positions:";

    private final HotStocksService service;
    private final StringRedisTemplate redis;
    private final RestTemplate rest;
    private final EquityScripCodeResolver scripCodeResolver;
    private final ConfluenceTargetsClient confluenceClient;

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String tradeExecUrl;

    public HotStocksPositionOpenerJob(HotStocksService service,
                                      StringRedisTemplate redis,
                                      @Qualifier("hotStocksRestTemplate") RestTemplate rest,
                                      EquityScripCodeResolver scripCodeResolver,
                                      ConfluenceTargetsClient confluenceClient) {
        this.service = service;
        this.redis = redis;
        this.rest = rest;
        this.scripCodeResolver = scripCodeResolver;
        this.confluenceClient = confluenceClient;
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

        int concurrentBefore = countActiveHotStocksPositions();
        log.info("{} strategy=HOTSTOCKS action=START concurrentBefore={} maxConcurrent={} maxNewPerDay={} rankedCount={}",
            LOG_PREFIX, concurrentBefore, MAX_CONCURRENT, MAX_NEW_PER_DAY, ranked.size());

        int opened = 0;
        int skippedDedup = 0;
        int skippedCapReached = 0;
        int skippedNoScripCode = 0;
        int failed = 0;
        for (StockMetrics m : ranked) {
            if (opened >= MAX_NEW_PER_DAY) {
                log.info("{} strategy=HOTSTOCKS action=STOP_DAILY_CAP opened={} maxNewPerDay={}",
                    LOG_PREFIX, opened, MAX_NEW_PER_DAY);
                break;
            }
            if (concurrentBefore + opened >= MAX_CONCURRENT) {
                skippedCapReached++;
                log.warn("{} strategy=HOTSTOCKS scrip={} symbol={} action=SKIP reason=concurrent_max_{} concurrentNow={}",
                    LOG_PREFIX, m.getScripCode(), m.getSymbol(), MAX_CONCURRENT, concurrentBefore + opened);
                break;
            }

            // Resolve a tradable scripCode. F&O picks already carry one in the metrics
            // (set during Tier-1 scan via FivePaisaHistoryClient). Non-F&O picks arrive with
            // scripCode=null from HotStocksNonFnoScanJob and need a cash-equity lookup against
            // the 5paisa master (scripData collection).
            String tradableScripCode = m.getScripCode();
            if (tradableScripCode == null || tradableScripCode.isBlank()) {
                Optional<String> resolved = scripCodeResolver.resolve(m.getSymbol());
                if (resolved.isEmpty()) {
                    skippedNoScripCode++;
                    log.info("{} strategy=HOTSTOCKS symbol={} action=SKIP reason=no_scrip_code_master",
                        LOG_PREFIX, m.getSymbol());
                    continue;
                }
                tradableScripCode = resolved.get();
            }

            if (hotStocksPositionExists(tradableScripCode)) {
                skippedDedup++;
                log.info("{} strategy=HOTSTOCKS scrip={} symbol={} action=SKIP reason=already_held",
                    LOG_PREFIX, tradableScripCode, m.getSymbol());
                continue;
            }
            try {
                openOne(m, tradableScripCode);
                opened++;
            } catch (Exception e) {
                failed++;
                log.warn("{} strategy=HOTSTOCKS scrip={} symbol={} action=FAIL reason={}",
                    LOG_PREFIX, tradableScripCode, m.getSymbol(), e.getMessage());
            }
        }
        log.info("{} strategy=HOTSTOCKS action=COMPLETE opened={} skippedDedup={} skippedCapReached={} skippedNoScripCode={} failed={} concurrentAfter={}",
            LOG_PREFIX, opened, skippedDedup, skippedCapReached, skippedNoScripCode, failed, concurrentBefore + opened);
    }

    /**
     * Counts currently active HOTSTOCKS positions (qtyOpen>0, not CLOSED). Enforces the
     * MAX_CONCURRENT cap so accumulated positions across multiple days don't blow past
     * the risk limit.
     *
     * Returns 0 on Redis failure — conservative: lets the opener proceed but the cap
     * check will still trigger mid-loop. A hard failure here would block a whole day's
     * entries, which is worse than under-counting.
     */
    int countActiveHotStocksPositions() {
        try {
            java.util.Set<String> keys = redis.keys(POSITIONS_KEY_PREFIX + "*");
            if (keys == null || keys.isEmpty()) return 0;
            com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
            int n = 0;
            for (String key : keys) {
                String json = redis.opsForValue().get(key);
                if (json == null || json.isBlank()) continue;
                try {
                    com.fasterxml.jackson.databind.JsonNode node = om.readTree(json);
                    String source = node.path("signalSource").asText("");
                    String status = node.path("status").asText("");
                    int qtyOpen = node.path("qtyOpen").asInt(0);
                    if ("HOTSTOCKS".equals(source) && qtyOpen > 0 && !"CLOSED".equals(status)) n++;
                } catch (Exception ignore) {
                    // malformed JSON on a single position key — log but do not fail the whole count
                    log.debug("{} scrip={} action=PARSE_FAIL reason=malformed_json", LOG_PREFIX, key);
                }
            }
            return n;
        } catch (Exception e) {
            log.warn("{} action=COUNT_FAIL reason={} — returning 0 (permissive)", LOG_PREFIX, e.getMessage());
            return 0;
        }
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

    private void openOne(StockMetrics m, String tradableScripCode) {
        double entry = m.getLtpYesterday();
        if (entry <= 0) {
            throw new IllegalStateException("invalid entry price: " + entry);
        }
        int qty = (int) Math.floor(POSITION_SIZE_RUPEES / entry);
        if (qty <= 0) {
            throw new IllegalStateException("computed qty <= 0 for entry=" + entry);
        }

        // Target computation:
        //   - F&O-eligible picks → hardcoded % staircase (calibrated from Apr-15 backtest: +1.27%/trade mean).
        //   - Non-F&O picks → ConfluentTargetEngine via streamingcandle HTTP. Pivot-confluence SL/T1-T4.
        //     Falls back to the same % staircase if confluence is unavailable (network / no pivots cached).
        double sl, t1, t2, t3, t4;
        String targetSource;
        if (!m.isFnoEligible()) {
            Optional<ConfluenceTargetsClient.EquityTargets> targets =
                confluenceClient.computeEquityTargets(tradableScripCode, entry, /*isLong*/ true);
            if (targets.isPresent() && targets.get().isActionable()) {
                ConfluenceTargetsClient.EquityTargets t = targets.get();
                sl = t.stopLoss();
                t1 = t.target1();
                t2 = t.target2() != null ? t.target2() : entry * (1 + T2_PCT);
                t3 = t.target3() != null ? t.target3() : entry * (1 + T3_PCT);
                t4 = t.target4() != null ? t.target4() : entry * (1 + T4_PCT);
                targetSource = "CONFLUENCE_" + (t.tradeGrade() != null ? t.tradeGrade() : "?");
            } else {
                // Confluence unavailable — use the same % staircase as F&O so the trade still proceeds.
                sl = m.getSuggestedSlPrice() > 0 ? m.getSuggestedSlPrice() : entry * (1 - SL_PCT);
                t1 = entry * (1 + T1_PCT);
                t2 = entry * (1 + T2_PCT);
                t3 = entry * (1 + T3_PCT);
                t4 = entry * (1 + T4_PCT);
                targetSource = "STAIRCASE_FALLBACK";
            }
        } else {
            sl = m.getSuggestedSlPrice() > 0 ? m.getSuggestedSlPrice() : entry * (1 - SL_PCT);
            t1 = entry * (1 + T1_PCT);
            t2 = entry * (1 + T2_PCT);
            t3 = entry * (1 + T3_PCT);
            t4 = entry * (1 + T4_PCT);
            targetSource = "STAIRCASE_FNO";
        }

        // Fetch slippage estimate from trade-exec. Required by StrategyTradeExecutor;
        // missing field triggers NPE on Math.abs(req.getEstimatedEntrySlippage()).
        Map<String, Object> slip = fetchSlippage(tradableScripCode, m.getSymbol(), qty, entry);

        Map<String, Object> payload = new HashMap<>();
        // identity
        payload.put("scripCode", tradableScripCode);
        payload.put("instrumentSymbol", m.getSymbol());
        payload.put("instrumentType", "EQUITY");
        payload.put("underlyingScripCode", tradableScripCode);
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
        payload.put("t2", t2);
        payload.put("t3", t3);
        payload.put("t4", t4);

        // equity mirroring
        payload.put("equitySpot", entry);
        payload.put("equitySl", sl);
        payload.put("equityT1", t1);
        payload.put("equityT2", t2);
        payload.put("equityT3", t3);
        payload.put("equityT4", t4);

        // Partial-exit scaffolding (provision only — wiring of per-target partial sizing
        // lands when the exit allocator is ready). For now: single 100% exit at T1.
        payload.put("partialExits", java.util.List.of(
            java.util.Map.of("level", "T1", "qtyPct", 100)));

        // deltas + strategy routing
        payload.put("delta", 1.0);
        payload.put("strategy", "HOTSTOCKS");  // wallet routing key
        payload.put("exchange", "NSE");
        payload.put("direction", "LONG");
        payload.put("confidence", 0.75);
        payload.put("executionMode", "AUTO");
        payload.put("tradeLabel", m.isFnoEligible() ? "HOTSTOCKS_POSITIONAL" : "HOTSTOCKS_NONFNO_EQUITY");
        payload.put("targetSource", targetSource);
        payload.put("fnoEligible", m.isFnoEligible());

        // Slippage fields — REQUIRED by StrategyTradeExecutor (unboxed via Math.abs).
        payload.put("estimatedEntrySlippage",
            ((Number) slip.getOrDefault("estimatedEntrySlippage", 0.0)).doubleValue());
        payload.put("estimatedEntrySlippageTotal",
            ((Number) slip.getOrDefault("estimatedEntrySlippageTotal", 0.0)).doubleValue());
        payload.put("estimatedSlippagePct",
            ((Number) slip.getOrDefault("estimatedSlippagePct", 0.0)).doubleValue());
        payload.put("slippageTier", slip.getOrDefault("slippageTier", "STATIC"));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);

        ResponseEntity<Map> response = rest.postForEntity(
            tradeExecUrl + "/api/strategy-trades", request, Map.class);
        log.info("{} scrip={} symbol={} fnoEligible={} qty={} entry={} sl={} t1={} t2={} t3={} t4={} targetSource={} status={}",
            LOG_PREFIX, tradableScripCode, m.getSymbol(), m.isFnoEligible(),
            qty, entry, sl, t1, t2, t3, t4, targetSource, response.getStatusCode());
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Map<String, Object> fetchSlippage(String scripCode, String symbol, int qty, double price) {
        Map<String, Object> req = new HashMap<>();
        req.put("scripCode", scripCode);
        req.put("qty", qty);
        req.put("price", price);
        req.put("exchange", "NSE");
        req.put("lotSize", 1);
        req.put("instrumentType", "EQUITY");
        req.put("symbol", symbol);
        req.put("side", "BUY");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            ResponseEntity<Map> resp = rest.postForEntity(
                tradeExecUrl + "/api/slippage/estimate",
                new HttpEntity<>(req, headers), Map.class);
            Map body = resp.getBody();
            return body != null ? (Map<String, Object>) body : new HashMap<>();
        } catch (Exception e) {
            log.warn("HotStocksPositionOpenerJob: slippage estimate failed for {} ({}): {} — defaulting to zero",
                symbol, scripCode, e.getMessage());
            return new HashMap<>();
        }
    }
}
