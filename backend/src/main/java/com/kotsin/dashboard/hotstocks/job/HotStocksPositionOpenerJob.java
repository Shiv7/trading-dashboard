package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.calendar.NseCalendarHelper;
import com.kotsin.dashboard.hotstocks.data.ConfluenceTargetsClient;
import com.kotsin.dashboard.hotstocks.data.EquityScripCodeResolver;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksPositionGate;
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

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

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
    // Dynamic sizing: perPosition = currentBalance / MAX_CONCURRENT, clamped to [MIN, MAX].
    // Old model was a fixed ₹1.5 L per position; new model lets wallet growth scale position size
    // and wallet drawdown shrink it, naturally self-regulating across the 30-slot concurrent cap.
    private static final double DEFAULT_PER_POSITION_RUPEES = 150_000.0; // used when wallet read fails
    private static final double MIN_PER_POSITION_RUPEES = 25_000.0;
    private static final double MAX_PER_POSITION_RUPEES = 300_000.0;
    // Positional strategy: up to MAX_NEW_FNO_PER_DAY + MAX_NEW_NONFNO_PER_DAY NEW entries per day,
    // up to MAX_CONCURRENT concurrent active positions.
    // Split budgets (vs single MAX_NEW_PER_DAY) so F&O doesn't starve non-F&O Tier-2 picks —
    // before the split, F&O always filled the 6-slot cap and non-F&O never opened.
    static final int MAX_CONCURRENT = 30;
    private static final String HOTSTOCKS_WALLET_KEY = "wallet:entity:strategy-wallet-HOTSTOCKS";
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
    private final NseCalendarHelper calendar;
    private final com.kotsin.dashboard.hotstocks.service.LiveLtpResolver liveLtpResolver;

    // Optional — legacy ctor (tests) wires null; enrichment-path ctor wires bean.
    private HotStocksPositionGate positionGate;

    @Value("${hotstocks.position.gate.alreadyheld.enabled:true}")
    private boolean positionGateEnabled;

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String tradeExecUrl;

    // F&O daily new-entry budget. Default 6 preserves pre-split behaviour.
    @Value("${hotstocks.opener.max.new.fno.per.day:6}")
    private int maxNewFnoPerDay;

    // Non-F&O (Tier-2 cash equity) daily new-entry budget. Default 2 — small because Tier-2 is
    // newer + analytically lower conviction than F&O Tier-1. Zero disables non-F&O opens.
    @Value("${hotstocks.opener.max.new.nonfno.per.day:2}")
    private int maxNewNonFnoPerDay;

    /**
     * 2026-05-07 (HOTSTOCKS-4): pre-flight tick freshness gate. When enabled,
     * openOne() requires trade-tick:{scripCode} in Redis to be < maxAgeMs old.
     * Catches the case where subscription hasn't yet started streaming for a pick.
     */
    @Value("${hotstocks.preflight.tick.freshness.enabled:true}")
    private boolean preflightTickFreshnessEnabled;

    @Value("${hotstocks.preflight.tick.max.age.ms:60000}")
    private long preflightTickMaxAgeMs;

    public HotStocksPositionOpenerJob(HotStocksService service,
                                      StringRedisTemplate redis,
                                      @Qualifier("hotStocksRestTemplate") RestTemplate rest,
                                      EquityScripCodeResolver scripCodeResolver,
                                      ConfluenceTargetsClient confluenceClient,
                                      NseCalendarHelper calendar,
                                      com.kotsin.dashboard.hotstocks.service.LiveLtpResolver liveLtpResolver) {
        this.service = service;
        this.redis = redis;
        this.rest = rest;
        this.scripCodeResolver = scripCodeResolver;
        this.confluenceClient = confluenceClient;
        this.calendar = calendar;
        this.liveLtpResolver = liveLtpResolver;
    }

    /**
     * Spring setter-injects the gate so the legacy test ctor still compiles
     * without a gate. When the gate bean is present and
     * {@code hotstocks.position.gate.alreadyheld.enabled=true}, the opener
     * skips held scrips that haven't printed a fresh deal today.
     */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setPositionGate(HotStocksPositionGate positionGate) {
        this.positionGate = positionGate;
    }

    // Scrips whose 09:15 1m candle VWAP was unavailable at the primary 09:16:10 pass.
    // Drained by {@link #retryPendingWithLiveLtp()} at 09:17:10 IST using live LTP.
    // JVM-local — retry is best-effort; a dashboard restart in the 60s window between
    // passes is acceptable (missed retries just skip the scrip for the day).
    private final Map<String, StockMetrics> pendingRetry = new ConcurrentHashMap<>();

    /**
     * Primary open pass at 09:16:10 IST — the 09:15 1m candle is guaranteed to have
     * closed by :16:00, so we can read its VWAP as the canonical open-auction price.
     * Moved from 09:15:00 exactly because that raced the first-tick arrival per scrip
     * and fell back to Thursday close on a subset of names (2026-04-24 observation:
     * 3 of 12 positions opened at stale ltpYesterday).
     */
    @Scheduled(cron = "10 16 9 * * MON-FRI", zone = "Asia/Kolkata")
    public void openPositions() {
        openPositions(false);
    }

    /**
     * Retry pass at 09:17:10 IST — drains {@link #pendingRetry} using live LTP
     * for scrips whose 09:15 VWAP wasn't available. Live LTP by 09:17 is
     * ~2 minutes after open, so any scrip that trades at all has ticks by now.
     * Scrips still missing LTP are skipped for the day.
     */
    @Scheduled(cron = "10 17 9 * * MON-FRI", zone = "Asia/Kolkata")
    public void retryPendingWithLiveLtp() {
        if (pendingRetry.isEmpty()) return;
        log.info("{} retry-pass starting: pending={}", LOG_PREFIX, pendingRetry.size());
        double perPositionRupees = resolvePerPositionRupees();
        // Snapshot + clear so a subsequent primary pass doesn't double-fire.
        Map<String, StockMetrics> batch = new HashMap<>(pendingRetry);
        pendingRetry.clear();
        batch.entrySet().parallelStream().forEach(e -> {
            String scripCode = e.getKey();
            StockMetrics m = e.getValue();
            try {
                // S36 fix 2026-04-26: pass 0 as fallback so stale yesterday-close is
                // NEVER used as entry. If live feed is still missing at 09:17:10, skip
                // the scrip — opening at ltpYesterday was the root cause of ONESOURCE
                // entry=1611 on 2026-04-24 (actual open 1777).
                double live = liveLtpResolver.readLivePrice(scripCode, "N").orElse(0.0);
                if (live <= 0) {
                    log.warn("{} retry SKIP scrip={} symbol={} — no live LTP at 09:17 (ltpYesterday fallback disabled)",
                        LOG_PREFIX, scripCode, m.getSymbol());
                    return;
                }
                openOne(m, scripCode, live, perPositionRupees, "LIVE_LTP_0917");
            } catch (Exception ex) {
                log.warn("{} retry FAIL scrip={} reason={}", LOG_PREFIX, scripCode, ex.getMessage());
            }
        });
    }

    /**
     * @param force  if true, skip the NSE trading-day guard. Default path (cron + non-forced admin
     *               trigger) refuses to open positions on weekends or NSE holidays because entry
     *               would be pinned to last-close with no live feed to drive exits — producing
     *               zero-PnL artifacts that pollute wallet state (root cause of the 15 Sat-opened
     *               positions cleaned up 2026-04-18).
     */
    public void openPositions(boolean force) {
        log.info("HotStocksPositionOpenerJob starting (force={})", force);

        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        if (!force && !calendar.isTradingDay(today)) {
            log.warn("{} strategy=HOTSTOCKS action=SKIP reason=non_trading_day date={} — pass force=true to override",
                LOG_PREFIX, today);
            return;
        }

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
        int totalCap = maxNewFnoPerDay + maxNewNonFnoPerDay;
        double perPositionRupees = resolvePerPositionRupees();
        log.info("{} strategy=HOTSTOCKS action=START concurrentBefore={} maxConcurrent={} fnoCap={} nonFnoCap={} totalCap={} perPositionRupees={} rankedCount={}",
            LOG_PREFIX, concurrentBefore, MAX_CONCURRENT, maxNewFnoPerDay, maxNewNonFnoPerDay,
            totalCap, String.format("%.0f", perPositionRupees), ranked.size());

        // Phase 1 (sequential): walk the ranked list, apply caps/budgets/dedup, build the
        // to-open queue. Cap advancement must be serialized so F&O and non-F&O budgets stay
        // consistent, but the *expensive* work (VWAP read + HTTP POST) happens in phase 2.
        List<PreparedEntry> toOpen = new ArrayList<>();
        int openedFno = 0;
        int openedNonFno = 0;
        int skippedDedup = 0;
        int skippedCapReached = 0;
        int skippedNoScripCode = 0;
        int skippedBudgetFull = 0;
        for (StockMetrics m : ranked) {
            if (toOpen.size() >= totalCap) {
                log.info("{} strategy=HOTSTOCKS action=STOP_DAILY_CAP queued={} fno={} nonFno={} totalCap={}",
                    LOG_PREFIX, toOpen.size(), openedFno, openedNonFno, totalCap);
                break;
            }
            if (concurrentBefore + toOpen.size() >= MAX_CONCURRENT) {
                skippedCapReached++;
                log.warn("{} strategy=HOTSTOCKS scrip={} symbol={} action=SKIP reason=concurrent_max_{} concurrentNow={}",
                    LOG_PREFIX, m.getScripCode(), m.getSymbol(), MAX_CONCURRENT,
                    concurrentBefore + toOpen.size());
                break;
            }

            boolean isFno = m.isFnoEligible();
            if (isFno && openedFno >= maxNewFnoPerDay) {
                skippedBudgetFull++;
                continue;
            }
            if (!isFno && openedNonFno >= maxNewNonFnoPerDay) {
                skippedBudgetFull++;
                continue;
            }

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

            if (positionGate != null && positionGateEnabled && !positionGate.mayOpen(m)) {
                skippedDedup++;
                log.info("{} skip scrip={} — already held with no fresh deal today",
                    LOG_PREFIX, tradableScripCode);
                continue;
            }

            toOpen.add(new PreparedEntry(m, tradableScripCode));
            if (isFno) openedFno++; else openedNonFno++;
        }

        // Phase 2 (parallel): resolve VWAP + POST for each queued entry. VWAP misses are
        // enqueued into pendingRetry for the 09:17:10 live-LTP pass.
        java.util.concurrent.atomic.AtomicInteger openedVwap = new java.util.concurrent.atomic.AtomicInteger(0);
        java.util.concurrent.atomic.AtomicInteger pendingCount = new java.util.concurrent.atomic.AtomicInteger(0);
        java.util.concurrent.atomic.AtomicInteger failed = new java.util.concurrent.atomic.AtomicInteger(0);
        toOpen.parallelStream().forEach(pe -> {
            try {
                Optional<Double> vwap = resolveOpen915Vwap(pe.scripCode());
                if (vwap.isPresent() && vwap.get() > 0) {
                    openOne(pe.metrics(), pe.scripCode(), vwap.get(), perPositionRupees, "VWAP_0915");
                    openedVwap.incrementAndGet();
                } else {
                    pendingRetry.put(pe.scripCode(), pe.metrics());
                    pendingCount.incrementAndGet();
                    log.info("{} scrip={} symbol={} VWAP unavailable at 09:16:10 — queued for 09:17 live-LTP retry",
                        LOG_PREFIX, pe.scripCode(), pe.metrics().getSymbol());
                }
            } catch (Exception e) {
                failed.incrementAndGet();
                log.warn("{} strategy=HOTSTOCKS scrip={} symbol={} action=FAIL reason={}",
                    LOG_PREFIX, pe.scripCode(), pe.metrics().getSymbol(), e.getMessage());
            }
        });

        log.info("{} strategy=HOTSTOCKS action=COMPLETE queued={} (fno={} nonFno={}) openedVwap={} pendingRetry={} skippedDedup={} skippedCapReached={} skippedNoScripCode={} skippedBudgetFull={} failed={} concurrentAfter={}",
            LOG_PREFIX, toOpen.size(), openedFno, openedNonFno, openedVwap.get(), pendingCount.get(),
            skippedDedup, skippedCapReached, skippedNoScripCode, skippedBudgetFull,
            failed.get(), concurrentBefore + openedVwap.get());
    }

    /** Pre-filtered entry ready for parallel VWAP resolution + POST. */
    private record PreparedEntry(StockMetrics metrics, String scripCode) {}

    /**
     * Test-visible helper. Fires both the primary 09:16:10 pass and the retry pass
     * that in production runs from a separate @Scheduled cron. Production code
     * should never call this — use the cron triggers.
     */
    void openPositionsAndDrainRetry(boolean force) {
        openPositions(force);
        retryPendingWithLiveLtp();
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

    /**
     * Opens one position with a pre-resolved entry price and dynamic sizing.
     *
     * Entry-price source is determined by caller:
     *   - {@code VWAP_0915}: primary path — 09:15 1m candle volume-weighted average
     *   - {@code LIVE_LTP_0917}: retry pass at 09:17 when VWAP unavailable
     *
     * Removed the legacy {@code liveLtpResolver.resolveEntry(...ltpYesterday)} path which
     * raced first-tick arrival and silently fell back to Thursday close for ~25% of picks
     * (2026-04-24 observation). Callers now pre-resolve and skip the scrip explicitly
     * rather than opening at a stale overnight price.
     */
    void openOne(StockMetrics m, String tradableScripCode,
                         double entry, double perPositionRupees, String entrySource) {
        if (entry <= 0) {
            throw new IllegalStateException("invalid entry price: " + entry);
        }
        int qty = (int) Math.floor(perPositionRupees / entry);
        if (qty <= 0) {
            throw new IllegalStateException(
                "computed qty <= 0 for entry=" + entry + " perPositionRupees=" + perPositionRupees);
        }

        // 2026-05-07 (HOTSTOCKS-4): pre-flight tick freshness gate.
        // Prevents opening into a known-dead feed. Last 30 days saw 30 positions
        // ORPHAN-killed within 89s of open because subscriptions hadn't yet started
        // streaming. Now we check trade-tick:{scripCode} (per-tick freshness key
        // written by streamingcandle's TickAggregator) and abort if stale > maxAgeMs.
        // Threshold default 60s — gives a wide margin vs the orphan service's 89s.
        if (preflightTickFreshnessEnabled && tradableScripCode != null) {
            try {
                String tickStr = redis.opsForValue().get("trade-tick:" + tradableScripCode);
                long ageMs = -1;
                if (tickStr != null) {
                    try {
                        long lastMs = Long.parseLong(tickStr);
                        ageMs = System.currentTimeMillis() - lastMs;
                    } catch (NumberFormatException ignore) {}
                }
                if (ageMs < 0 || ageMs > preflightTickMaxAgeMs) {
                    log.warn("HotStocks pre-flight ABORT scrip={} sym={} ageMs={} threshold={} reason={} — skipping open",
                            tradableScripCode, m.getSymbol(), ageMs, preflightTickMaxAgeMs,
                            ageMs < 0 ? "NO_TICK" : "STALE_TICK");
                    throw new IllegalStateException(
                        "pre-flight tick freshness gate: ageMs=" + ageMs
                        + " > " + preflightTickMaxAgeMs + "ms — feed not ready");
                }
                log.info("HotStocks pre-flight OK scrip={} sym={} ageMs={}",
                        tradableScripCode, m.getSymbol(), ageMs);
            } catch (IllegalStateException ise) {
                throw ise;
            } catch (Exception e) {
                log.debug("HotStocks pre-flight check error scrip={}: {} — proceeding (best-effort gate)",
                        tradableScripCode, e.getMessage());
            }
        }

        // 2026-05-07 (HOTSTOCKS-5): pivot-based targets for ALL HOTSTOCKS picks
        // (F&O + non-F&O alike). Previously F&O picks used a hardcoded staircase
        // (T1=2%/T2=5%/T3=8%/T4=12%) but those targets were rarely hit in production
        // (zero T1-T4 hits in 30 days observed 2026-05-07). Pivot-based SL/T1-T4 from
        // ConfluentTargetEngine reflect actual confluence levels for the underlying
        // and produce achievable targets. Staircase remains as a last-resort fallback
        // when confluence is unavailable (network failure, no pivots cached for scrip).
        double sl, t1, t2, t3, t4;
        String targetSource;
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
            // Confluence unavailable — fall back to % staircase so the trade still proceeds.
            sl = m.getSuggestedSlPrice() > 0 ? m.getSuggestedSlPrice() : entry * (1 - SL_PCT);
            t1 = entry * (1 + T1_PCT);
            t2 = entry * (1 + T2_PCT);
            t3 = entry * (1 + T3_PCT);
            t4 = entry * (1 + T4_PCT);
            targetSource = m.isFnoEligible() ? "STAIRCASE_FALLBACK_FNO" : "STAIRCASE_FALLBACK_NONFNO";
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
        // Single-char "N" matches the convention used by every other write+read site.
        // Using "NSE" here caused WsOrphanService's HOTSTOCKS-on-NSE gate to misfire and
        // force-exit every multi-day position at 15:36 IST on 2026-04-23.
        payload.put("exchange", "N");
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
        log.info("{} scrip={} symbol={} fnoEligible={} qty={} entry={} entrySource={} perPositionRupees={} sl={} t1={} t2={} t3={} t4={} targetSource={} status={}",
            LOG_PREFIX, tradableScripCode, m.getSymbol(), m.isFnoEligible(),
            qty, entry, entrySource, String.format("%.0f", perPositionRupees),
            sl, t1, t2, t3, t4, targetSource, response.getStatusCode());
    }

    /**
     * Reads the 09:15 1m candle VWAP for today from {@code tick:{scripCode}:1m:history}.
     * Returns {@link Optional#empty()} if the candle isn't present yet (rare — call site
     * should enqueue for retry) or if Redis read fails.
     *
     * The 1m candle list is a LIFO list of up to 500 candles written by streamingcandle's
     * TickAggregator. Candles are JSON-serialized Jackson-typed arrays:
     * {@code ["com.kotsin.consumer.model.TickCandle", {...payload...}]}.
     */
    Optional<Double> resolveOpen915Vwap(String scripCode) {
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        // 09:15:00 IST = 03:45:00 UTC — matches streamingcandle's `windowStart` format.
        String targetWindowStart = today.toString() + "T03:45:00Z";
        try {
            // Scan the most recent ~80 candles — covers the first ~80 min of the session.
            // Good headroom for the 09:16:10 primary pass (expect index ≈ 0 or 1).
            List<String> recent = redis.opsForList().range("tick:" + scripCode + ":1m:history", 0, 80);
            if (recent == null || recent.isEmpty()) return Optional.empty();
            com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
            for (String raw : recent) {
                if (raw == null || raw.isEmpty()) continue;
                try {
                    com.fasterxml.jackson.databind.JsonNode node = om.readTree(raw);
                    // Candle is either ["className", {...payload}] (Jackson typed) or a bare object.
                    com.fasterxml.jackson.databind.JsonNode candle =
                        node.isArray() && node.size() > 1 ? node.get(1) : node;
                    String ws = candle.path("windowStart").asText("");
                    if (targetWindowStart.equals(ws)) {
                        double vwap = candle.path("vwap").asDouble(0);
                        return vwap > 0 ? Optional.of(vwap) : Optional.empty();
                    }
                } catch (Exception ignore) {
                    // malformed entry — continue scanning
                }
            }
            return Optional.empty();
        } catch (Exception e) {
            log.debug("{} VWAP read failed for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Computes dynamic per-position sizing: {@code currentBalance / MAX_CONCURRENT}
     * clamped to [{@link #MIN_PER_POSITION_RUPEES}, {@link #MAX_PER_POSITION_RUPEES}].
     *
     * Reads HotStocks wallet JSON from Redis; on any failure falls back to
     * {@link #DEFAULT_PER_POSITION_RUPEES} to keep the opener running rather than
     * blocking a whole day's entries on transient infra errors.
     */
    double resolvePerPositionRupees() {
        try {
            String json = redis.opsForValue().get(HOTSTOCKS_WALLET_KEY);
            if (json != null && !json.isBlank()) {
                com.fasterxml.jackson.databind.JsonNode node =
                    new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
                double currentBalance = node.path("currentBalance").asDouble(0);
                if (currentBalance > 0) {
                    double raw = currentBalance / (double) MAX_CONCURRENT;
                    return Math.max(MIN_PER_POSITION_RUPEES,
                                    Math.min(MAX_PER_POSITION_RUPEES, raw));
                }
            }
        } catch (Exception e) {
            log.debug("{} wallet read failed, using default sizing: {}", LOG_PREFIX, e.getMessage());
        }
        return DEFAULT_PER_POSITION_RUPEES;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Map<String, Object> fetchSlippage(String scripCode, String symbol, int qty, double price) {
        Map<String, Object> req = new HashMap<>();
        req.put("scripCode", scripCode);
        req.put("qty", qty);
        req.put("price", price);
        req.put("exchange", "N");
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
