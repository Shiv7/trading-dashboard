package com.kotsin.dashboard.healthcheck;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Arrays;
import java.util.List;

/**
 * Hand-curated inventory of the 17 most operationally critical scheduled jobs
 * across FastAnalytics, dashboard, streamingcandle, tradeExec, optionProducer.
 *
 * NOT auto-discovered — Spring @Scheduled and Python APScheduler have no unified
 * introspection surface. When a new cron is added, its HealthJob entry must be
 * added here manually.
 *
 * For each job we capture enough to answer:
 *   - Did today's run succeed?  (via a {@link StatusSource})
 *   - Is it retrying or done?
 *   - When does it next fire?
 *   - Which strategies suffer if it fails?
 *   - Can we manually re-trigger it?
 */
public final class HealthJobRegistry {

    public enum Category { SCRAPER, HOTSTOCKS, TRADE_EXEC, LIVE_FEED, PLANNED }

    /** How to determine "did today's run succeed". */
    public enum StatusSource {
        /** Redis has key {@code market-pulse:{feed}:{today_iso}} OR last-fetch epoch is within window. */
        REDIS_DATED_PAYLOAD,
        /** Redis last-update-epoch key is younger than stalenessSec. */
        REDIS_EPOCH_FRESHNESS,
        /**
         * Verifies {@code dataKeyPattern} formatted with today's (latest) NSE trading date
         * actually exists AND contains ≥1 row. An explicit empty JSON array {@code []}
         * is treated as EMPTY_BY_DESIGN — the scraper ran and NSE genuinely had zero
         * records for the day. Distinguishes "scraper didn't run" from "no records
         * published today".
         */
        DATA_KEY_PRESENT,
        /** Log pattern match in nohup.out since last restart. */
        LOG_PATTERN,
        // ── v2 tier-1 sources (evaluated only when health-check.v2.enabled=true) ──
        /** {@code extraConfig=port} must be bound — verified via {@code ss -tlnp}. */
        PORT_BOUND,
        /** {@code extraConfig=pathTemplate} with {@code {yesterday}} placeholder must exist on disk. */
        FILE_EXISTS,
        /**
         * HTTP GET {@code extraConfig=url}. FRESH if 200 and, when {@code jsonPath+threshold}
         * provided, the parsed integer field exceeds / falls below the threshold as required.
         */
        HTTP_GET_JSON,
        /** Redis key present and parseable int {@code < threshold} (stored in {@code extraConfig}). */
        REDIS_KEY_INT_LT,
        /** Redis key present (any value) — used for daily-reset-style sentinel keys. */
        REDIS_KEY_EXISTS,
        /** Redis key empty array {@code []} or unset — used for build-drift sentinel. */
        REDIS_KEY_EMPTY_ARRAY
    }

    public static final class HealthJob {
        public final String id;
        public final String name;
        public final String purpose;
        public final Category category;
        public final String serviceName;       // tradeExec, dashboard, fastanalytics, …
        public final String cronExpression;    // Spring cron OR human-readable for Python
        public final String humanSchedule;     // "every 30 min 17:00-22:00 IST" etc
        public final StatusSource statusSource;
        /** Primary Redis key used to check freshness. May include {{today}} placeholder. */
        public final String statusRedisKey;
        /** Window in seconds for REDIS_EPOCH_FRESHNESS. Unused for other sources. */
        public final long stalenessSec;
        /** Log pattern for LOG_PATTERN sources. */
        public final String logPattern;
        public final String logFile;
        public final List<String> affectedStrategies;
        /** Trigger endpoint path (relative to FastAnalytics or dashboard), or null if not supported. */
        public final String triggerEndpoint;
        public final String triggerService;    // "fastanalytics" or "dashboard"
        /** Next-run computation: HH:MM IST the job expects to start today (or tomorrow if past). */
        public final LocalTime nextRunTime;
        /** Whether this job only runs on NSE trading days. */
        public final boolean tradingDayOnly;
        /** True if this job is the "start of today's retry window" (i.e. first attempt of the day). */
        public final LocalTime retryWindowStart;
        public final LocalTime retryWindowEnd;
        /**
         * Format string with a single {@code %s} placeholder filled by the latest NSE
         * trading date (ISO yyyy-MM-dd) for {@link StatusSource#DATA_KEY_PRESENT} jobs.
         * Example: {@code "market-pulse:block-deals:%s"}. Unused for other sources.
         */
        public final String dataKeyPattern;
        /**
         * Tier — 1 = existing v1 jobs (always evaluated). 2 = v2 Tier-1 critical-path jobs
         * gated by {@code health-check.v2.enabled}. Default 1 for back-compat.
         */
        public final int tier;
        /**
         * Free-form config bag for v2 sources. Keys used:
         *   port      — integer port for {@link StatusSource#PORT_BOUND}
         *   path      — file path template (may contain {yesterday}) for {@link StatusSource#FILE_EXISTS}
         *   url       — absolute URL for {@link StatusSource#HTTP_GET_JSON}
         *   jsonPath  — dot path like "headroom" or "lag.maxAcrossTopics" for HTTP_GET_JSON
         *   threshold — integer threshold (< for INT_LT, > for HTTP_GET_JSON jsonPath)
         *   redisKey  — Redis key pattern ({today}, {yesterday} supported)
         */
        public final java.util.Map<String, String> extraConfig;

        HealthJob(String id, String name, String purpose, Category category,
                  String serviceName, String cronExpression, String humanSchedule,
                  StatusSource statusSource, String statusRedisKey, long stalenessSec,
                  String logPattern, String logFile,
                  List<String> affectedStrategies, String triggerEndpoint, String triggerService,
                  LocalTime nextRunTime, boolean tradingDayOnly,
                  LocalTime retryWindowStart, LocalTime retryWindowEnd) {
            this(id, name, purpose, category, serviceName, cronExpression, humanSchedule,
                statusSource, statusRedisKey, stalenessSec, logPattern, logFile,
                affectedStrategies, triggerEndpoint, triggerService,
                nextRunTime, tradingDayOnly, retryWindowStart, retryWindowEnd,
                /* dataKeyPattern */ null, /* tier */ 1, /* extraConfig */ java.util.Collections.emptyMap());
        }

        HealthJob(String id, String name, String purpose, Category category,
                  String serviceName, String cronExpression, String humanSchedule,
                  StatusSource statusSource, String statusRedisKey, long stalenessSec,
                  String logPattern, String logFile,
                  List<String> affectedStrategies, String triggerEndpoint, String triggerService,
                  LocalTime nextRunTime, boolean tradingDayOnly,
                  LocalTime retryWindowStart, LocalTime retryWindowEnd,
                  String dataKeyPattern) {
            this(id, name, purpose, category, serviceName, cronExpression, humanSchedule,
                statusSource, statusRedisKey, stalenessSec, logPattern, logFile,
                affectedStrategies, triggerEndpoint, triggerService,
                nextRunTime, tradingDayOnly, retryWindowStart, retryWindowEnd,
                dataKeyPattern, /* tier */ 1, /* extraConfig */ java.util.Collections.emptyMap());
        }

        HealthJob(String id, String name, String purpose, Category category,
                  String serviceName, String cronExpression, String humanSchedule,
                  StatusSource statusSource, String statusRedisKey, long stalenessSec,
                  String logPattern, String logFile,
                  List<String> affectedStrategies, String triggerEndpoint, String triggerService,
                  LocalTime nextRunTime, boolean tradingDayOnly,
                  LocalTime retryWindowStart, LocalTime retryWindowEnd,
                  String dataKeyPattern, int tier, java.util.Map<String, String> extraConfig) {
            this.id = id;
            this.name = name;
            this.purpose = purpose;
            this.category = category;
            this.serviceName = serviceName;
            this.cronExpression = cronExpression;
            this.humanSchedule = humanSchedule;
            this.statusSource = statusSource;
            this.statusRedisKey = statusRedisKey;
            this.stalenessSec = stalenessSec;
            this.logPattern = logPattern;
            this.logFile = logFile;
            this.affectedStrategies = affectedStrategies;
            this.triggerEndpoint = triggerEndpoint;
            this.triggerService = triggerService;
            this.nextRunTime = nextRunTime;
            this.tradingDayOnly = tradingDayOnly;
            this.retryWindowStart = retryWindowStart;
            this.retryWindowEnd = retryWindowEnd;
            this.dataKeyPattern = dataKeyPattern;
            this.tier = tier;
            this.extraConfig = extraConfig == null ? java.util.Collections.emptyMap() : extraConfig;
        }
    }

    /** Tier-2 (v2) job factory — always sets {@code tier=2}. */
    private static HealthJob v2(String id, String name, String purpose, Category category,
                                String serviceName, String humanSchedule,
                                StatusSource statusSource,
                                List<String> affectedStrategies,
                                LocalTime nextRunTime, boolean tradingDayOnly,
                                LocalTime retryWindowStart, LocalTime retryWindowEnd,
                                java.util.Map<String, String> extraConfig,
                                String logPattern, String logFile) {
        return new HealthJob(id, name, purpose, category, serviceName,
            /* cronExpression */ null, humanSchedule,
            statusSource, /* statusRedisKey */ null, /* stalenessSec */ 0,
            logPattern, logFile,
            affectedStrategies, /* triggerEndpoint */ null, /* triggerService */ null,
            nextRunTime, tradingDayOnly, retryWindowStart, retryWindowEnd,
            /* dataKeyPattern */ null, /* tier */ 2, extraConfig);
    }

    private static java.util.Map<String, String> cfg(String... kv) {
        java.util.LinkedHashMap<String, String> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    // ══════════════════════ REGISTRY ══════════════════════
    public static final List<HealthJob> JOBS = Arrays.asList(
        // ── Market-pulse scrapers (FastAnalytics) ──
        new HealthJob("bhavcopy-ohlcv",
            "Bhavcopy OHLCV",
            "60-day per-symbol candles — feeds HotStocks v2 scoring (momentum, RS, volume buckets).",
            Category.SCRAPER, "fastanalytics",
            "every 30 min 17:00-22:00 IST",
            "Every 30 min 17:00-22:00 IST until today-confirmed",
            StatusSource.REDIS_EPOCH_FRESHNESS,
            "nse:bhavcopy:ohlcv:_last_fetch", 8 * 3600,
            null, null,
            Arrays.asList("HOTSTOCKS"),
            "/api/market-pulse/bhavcopy-ohlcv/backfill", "fastanalytics",
            LocalTime.of(17, 0), true,
            LocalTime.of(17, 0), LocalTime.of(22, 0)
        ),
        new HealthJob("delivery-data",
            "Delivery % by sector",
            "NSE bhavcopy delivery percentage aggregated by sector — HotStocks delivery bucket.",
            Category.SCRAPER, "fastanalytics",
            "every 30 min 16:40-22:00 IST",
            "Every 30 min 16:40-22:00 IST until today-confirmed",
            StatusSource.REDIS_EPOCH_FRESHNESS,
            "market-pulse:last-fetch:delivery-data", 8 * 3600,
            null, null,
            Arrays.asList("HOTSTOCKS"),
            "/api/market-pulse/refresh/delivery-data", "fastanalytics",
            LocalTime.of(16, 40), true,
            LocalTime.of(16, 40), LocalTime.of(22, 0)
        ),
        new HealthJob("corporate-events",
            "Corporate Events",
            "Board meetings, ex-dividend dates, splits, bonuses — HotStocks eventWithin3Days flag.",
            Category.SCRAPER, "fastanalytics",
            "every 30 min 08:25-10:00 IST",
            "Every 30 min 08:25-10:00 IST until status=ok",
            StatusSource.REDIS_EPOCH_FRESHNESS,
            "market-pulse:last-fetch:corporate-events", 24 * 3600,
            null, null,
            Arrays.asList("HOTSTOCKS", "ALL_POSITIONAL"),
            "/api/market-pulse/refresh/corporate-events", "fastanalytics",
            LocalTime.of(8, 25), true,
            LocalTime.of(8, 25), LocalTime.of(10, 0)
        ),
        new HealthJob("block-deals",
            "Block Deals",
            "NSE block deals (>5L shares or >₹5 Cr) — HotStocks institutional flow bucket.",
            Category.SCRAPER, "fastanalytics",
            "every 15 min 09:30-15:40 IST",
            "Every 15 min in-session",
            StatusSource.DATA_KEY_PRESENT,
            "market-pulse:block-deals:%s", 0,
            null, null,
            Arrays.asList("HOTSTOCKS"),
            "/api/market-pulse/refresh/block-deals", "fastanalytics",
            LocalTime.of(9, 30), true,
            LocalTime.of(9, 30), LocalTime.of(15, 40),
            "market-pulse:block-deals:%s"
        ),
        new HealthJob("bulk-deals",
            "Bulk Deals",
            "NSE bulk deals (>0.5% equity or >₹2 Cr) — HotStocks institutional flow bucket.",
            Category.SCRAPER, "fastanalytics",
            "every 15 min 16:30-20:00 IST",
            "Every 15 min until today-confirmed",
            StatusSource.DATA_KEY_PRESENT,
            "market-pulse:bulk-deals:%s", 0,
            null, null,
            Arrays.asList("HOTSTOCKS"),
            "/api/market-pulse/refresh/bulk-deals", "fastanalytics",
            LocalTime.of(16, 30), true,
            LocalTime.of(16, 30), LocalTime.of(20, 0),
            "market-pulse:bulk-deals:%s"
        ),
        new HealthJob("fii-dii",
            "FII/DII Flow",
            "Foreign + Domestic institutional net buy/sell — Insights dashboard narrative.",
            Category.SCRAPER, "fastanalytics",
            "every 15 min 16:00-19:00 IST",
            "Every 15 min until today-confirmed",
            StatusSource.REDIS_EPOCH_FRESHNESS,
            "market-pulse:last-fetch:fii-dii", 8 * 3600,
            null, null,
            Arrays.asList("ALL_STRATEGIES"),
            "/api/market-pulse/refresh/fii-dii", "fastanalytics",
            LocalTime.of(16, 0), true,
            LocalTime.of(16, 0), LocalTime.of(19, 0)
        ),
        new HealthJob("short-selling",
            "Short Selling",
            "NSE short selling data — HotStocks shortInterestDelta5d feature.",
            Category.SCRAPER, "fastanalytics",
            "every 15 min 18:00-21:00 IST",
            "Every 15 min until today-confirmed",
            StatusSource.DATA_KEY_PRESENT,
            "market-pulse:short-selling:%s", 0,
            null, null,
            Arrays.asList("HOTSTOCKS"),
            null, null,
            LocalTime.of(18, 0), true,
            LocalTime.of(18, 0), LocalTime.of(21, 0),
            "market-pulse:short-selling:%s"
        ),
        // ── HotStocks (dashboard backend) ──
        new HealthJob("hotstocks-enrichment",
            "HotStocks Enrichment",
            "Scores every F&O + non-F&O candidate, produces ranked list for tomorrow's opener.",
            Category.HOTSTOCKS, "dashboard",
            "0 45 5 * * MON-FRI",
            "Daily 05:45 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            null, 0,
            "HotStocksEnrichmentJob complete:",
            "/home/ubuntu/trading-dashboard/backend/nohup.out",
            Arrays.asList("HOTSTOCKS"),
            null, null,   // No re-trigger — enrichment runs daily, opener depends on it
            LocalTime.of(5, 45), true,
            null, null
        ),
        new HealthJob("hotstocks-nonfno-scan",
            "HotStocks Non-F&O Scan",
            "Scores non-F&O universe from bulk/block deals — feeds next day's enrichment inputs.",
            Category.HOTSTOCKS, "dashboard",
            "0 45 17 * * MON-FRI",
            "Daily 17:45 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            null, 0,
            "HS-NONFNO-SCAN.*complete.*scored=",
            "/home/ubuntu/trading-dashboard/backend/nohup.out",
            Arrays.asList("HOTSTOCKS"),
            "/api/hot-stocks/admin/run-nonfno-scan", "dashboard",
            LocalTime.of(17, 45), true,
            LocalTime.of(17, 45), LocalTime.of(22, 0)
        ),
        new HealthJob("hotstocks-opener",
            "HotStocks Opener",
            "Opens up to 6 F&O + 6 non-F&O positions at NSE open. Core of HOTSTOCKS strategy.",
            Category.HOTSTOCKS, "dashboard",
            "0 15 9 * * MON-FRI",
            "Daily 09:15 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            null, 0,
            "HotStocksPositionOpenerJob.*action=COMPLETE",
            "/home/ubuntu/trading-dashboard/backend/nohup.out",
            Arrays.asList("HOTSTOCKS"),
            null, null,
            LocalTime.of(9, 15), true,
            null, null
        ),
        new HealthJob("hotstocks-kill-switch",
            "HotStocks Kill Switch",
            "Trips at 3% daily wallet drawdown — blocks new HOTSTOCKS opens.",
            Category.HOTSTOCKS, "dashboard",
            "0 */5 9-15 * * MON-FRI",
            "Every 5 min 09:00-15:59 IST",
            StatusSource.LOG_PATTERN,
            null, 0,
            "HotStocksKillSwitchJob",
            "/home/ubuntu/trading-dashboard/backend/nohup.out",
            Arrays.asList("HOTSTOCKS"),
            null, null,
            LocalTime.of(9, 0), true,
            LocalTime.of(9, 0), LocalTime.of(16, 0)
        ),
        // ── Trade execution (tradeExec) ──
        new HealthJob("wallet-daily-reset",
            "Wallet Daily Reset",
            "Resets daily loss limits to 10% of current balance + clears circuit breakers.",
            Category.TRADE_EXEC, "tradeExec",
            "0 55 8 * * MON-FRI",
            "Daily 08:55 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            null, 0,
            "WALLET-RESET.*strategy-wallet-",
            "/home/ubuntu/tradeExcutionModule/nohup.out",
            Arrays.asList("ALL_STRATEGIES"),
            null, null,
            LocalTime.of(8, 55), true,
            null, null
        ),
        new HealthJob("wallet-margin-reconcile",
            "Wallet Margin Reconcile",
            "Reconciles usedMargin vs active positions sum — prevents margin drift.",
            Category.TRADE_EXEC, "tradeExec",
            "0 50 8 * * MON-FRI",
            "Daily 08:50 IST Mon-Fri (+17:05 + 23:59)",
            StatusSource.LOG_PATTERN,
            null, 0,
            "MARGIN-RECONCILE",
            "/home/ubuntu/tradeExcutionModule/nohup.out",
            Arrays.asList("ALL_STRATEGIES"),
            null, null,
            LocalTime.of(8, 50), true,
            null, null
        ),
        new HealthJob("eod-nse",
            "EOD NSE Exit",
            "Force-closes all active NSE positions at 15:25 IST before NSE close 15:30.",
            Category.TRADE_EXEC, "tradeExec",
            "0 25 15 * * MON-FRI",
            "Daily 15:25 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            null, 0,
            "EOD exit complete",
            "/home/ubuntu/tradeExcutionModule/nohup.out",
            Arrays.asList("FUDKII", "FUKAA", "FUDKOI", "MICROALPHA", "MERE", "RETEST"),
            null, null,
            LocalTime.of(15, 25), true,
            null, null
        ),
        new HealthJob("eod-mcx",
            "EOD MCX Exit",
            "Force-closes all active MCX positions at 23:25 (DST) or 23:50 (standard) IST.",
            Category.TRADE_EXEC, "tradeExec",
            "0 50 23 * * MON-FRI",
            "Daily 23:25 or 23:50 IST (seasonal)",
            StatusSource.LOG_PATTERN,
            null, 0,
            "EOD exit.*MCX",
            "/home/ubuntu/tradeExcutionModule/nohup.out",
            Arrays.asList("QUANT", "MCX_BB_15", "MCX_BB_30"),
            null, null,
            LocalTime.of(23, 50), true,
            null, null
        ),
        // ── Live feeds ──
        new HealthJob("global-indices",
            "Global Indices (FTSE / DAX / Nikkei / …)",
            "Polls yfinance every 60s via FastAnalytics — feeds Insights macro panel.",
            Category.LIVE_FEED, "dashboard",
            "fixedDelay 60000ms",
            "Every 60s",
            StatusSource.REDIS_EPOCH_FRESHNESS,
            "global:indices:nikkei:lastUpdateMs", 15 * 60,   // 15 min staleness
            null, null,
            Arrays.asList("INSIGHTS_PAGE"),
            null, null,
            null, false,
            null, null
        ),
        // gift-nifty removed 2026-04-24: feed isn't implemented in FastAnalytics (no scraper
        // code, Redis key never populated). Model is also wrong for the health-check batch
        // pattern — gift-nifty would need an every-second realtime feed, not a 15-min scrape.
        // Re-add when either a streamingcandle WebSocket sub or a dedicated FA realtime task
        // is wired up and the key {@code gift-nifty:last-update-ms} starts writing.

        // ═════════════════════════════════════════════════════════════════════
        // v2 TIER-1 (20 critical-path jobs, gated by health-check.v2.enabled)
        // When the flag is false, compute() short-circuits tier==2 jobs to PENDING
        // regardless of StatusSource. When flag is true, they evaluate normally.
        // ═════════════════════════════════════════════════════════════════════

        // 1. OTM pre-warm morning bootstrap (streamingcandle)
        v2("otm-prewarm-morning-bootstrap",
            "OTM Pre-warm Morning Bootstrap",
            "Subscribes full OTM option chain before market open — gates NSE F&O liquidity at 09:15.",
            Category.TRADE_EXEC, "streamingcandle",
            "Daily 08:45 IST Mon-Fri (retry until 09:00)",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA", "MERE"),
            LocalTime.of(8, 45), true,
            LocalTime.of(8, 45), LocalTime.of(9, 0),
            java.util.Collections.emptyMap(),
            "\\[OPTION-PREWARM\\].*morning bootstrap starting",
            "/home/ubuntu/streamingcandle/nohup.out"
        ),
        // 2. OTM resub boundary (streamingcandle) — fires at NSE boundary-minus-5 throughout session
        v2("otm-prewarm-boundary-resub",
            "OTM Pre-warm Boundary Resub",
            "Re-diffs OTM subscription set every 30m at NSE boundary-5 — keeps strike selection current.",
            Category.TRADE_EXEC, "streamingcandle",
            "09:40, 10:10, 10:40, … 15:10 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA"),
            LocalTime.of(9, 40), true,
            LocalTime.of(9, 40), LocalTime.of(15, 15),
            java.util.Collections.emptyMap(),
            "\\[OPTION-PREWARM\\] Pre-warm complete: exchange=N",
            "/home/ubuntu/streamingcandle/nohup.out"
        ),
        // 3. ATM fallback counter — Redis daily counter must stay < 500
        v2("atm-fallback-counter",
            "ATM Fallback Counter",
            "Count of trades that fell back to ATM when OTM swap failed. Spikes mean OTM chain is thin.",
            Category.TRADE_EXEC, "streamingcandle",
            "Checked 12:00 IST — threshold 500/day",
            StatusSource.REDIS_KEY_INT_LT,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA"),
            LocalTime.of(12, 0), true,
            LocalTime.of(9, 15), LocalTime.of(15, 30),
            cfg("redisKey", "option.swap.atm_fallback:daily:{today}", "threshold", "500"),
            null, null
        ),
        // 4. NO_LIQUID_OTM counter — Redis daily counter must stay < 200
        v2("no-liquid-otm-counter",
            "NO_LIQUID_OTM Counter",
            "Count of signals that found no liquid OTM strike. Spikes indicate LiquidityGate starvation.",
            Category.TRADE_EXEC, "streamingcandle",
            "Checked 12:00 IST — threshold 200/day",
            StatusSource.REDIS_KEY_INT_LT,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA"),
            LocalTime.of(12, 0), true,
            LocalTime.of(9, 15), LocalTime.of(15, 30),
            cfg("redisKey", "option.swap.no_liquid_otm:daily:{today}", "threshold", "200"),
            null, null
        ),
        // 5. FUDKII Pool-8 executor init — verified on streamingcandle startup
        v2("fudkii-pool8-init",
            "FUDKII Pool-8 Executor Init",
            "Confirms fudkiiTriggerExecutor has 8 threads at startup — gates parallel 30m boundary dispatch.",
            Category.TRADE_EXEC, "streamingcandle",
            "Once on streamingcandle startup",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII"),
            null, false,
            null, null,
            java.util.Collections.emptyMap(),
            "fudkiiTriggerExecutor initialized with 8 threads",
            "/home/ubuntu/streamingcandle/nohup.out"
        ),
        // 6. HotStocks VWAP cron fire at 09:16 IST
        v2("hotstocks-vwap-cron",
            "HotStocks VWAP Cron",
            "Computes 09:15 Open×VWAP anchor for HotStocks entries — must log between 09:16-09:17.",
            Category.HOTSTOCKS, "dashboard",
            "Daily 09:16 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("HOTSTOCKS"),
            LocalTime.of(9, 16), true,
            LocalTime.of(9, 16), LocalTime.of(9, 18),
            java.util.Collections.emptyMap(),
            "\\[VWAP-ENTRY\\]|resolveOpen915Vwap",
            "/home/ubuntu/trading-dashboard/backend/nohup.out"
        ),
        // 7. HotStocks max-hold cron fires 15:20 IST
        v2("hotstocks-max-hold-cron",
            "HotStocks Max-Hold Cron",
            "Force-exits HotStocks positions at 15:20 IST — shipped 2026-04-23.",
            Category.HOTSTOCKS, "dashboard",
            "Daily 15:20 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("HOTSTOCKS"),
            LocalTime.of(15, 20), true,
            LocalTime.of(15, 20), LocalTime.of(15, 22),
            java.util.Collections.emptyMap(),
            "HotStocks max-hold check at 15:20",
            "/home/ubuntu/trading-dashboard/backend/nohup.out"
        ),
        // 8. Pre-EOD options close at 15:20 IST (tradeExec)
        v2("pre-eod-options-close",
            "Pre-EOD Options Close",
            "Closes all active NSE option positions at 15:20 IST (non-HOTSTOCKS), before EOD exit at 15:25. Cron lives in dashboard-backend StrategyTradeExecutor — was misregistered under tradeExec until 2026-04-26 fix.",
            Category.TRADE_EXEC, "dashboard",
            "Daily 15:20 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA", "MERE"),
            LocalTime.of(15, 20), true,
            LocalTime.of(15, 20), LocalTime.of(15, 22),
            java.util.Collections.emptyMap(),
            "Pre-EOD options close triggered at 15:20",
            "/home/ubuntu/trading-dashboard/backend/nohup.out"
        ),
        // 9. NSE EOD exit at 15:25 IST — log text observed in tradeExec
        v2("nse-eod-exit-v2",
            "NSE EOD Auto-Exit (v2)",
            "EOD auto-exit logs 15:25 IST for NSE — shadows v1 eod-nse but uses tighter log pattern.",
            Category.TRADE_EXEC, "tradeExec",
            "Daily 15:25 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII", "FUKAA", "FUDKOI", "MICROALPHA", "MERE", "RETEST"),
            LocalTime.of(15, 25), true,
            LocalTime.of(15, 25), LocalTime.of(15, 27),
            java.util.Collections.emptyMap(),
            "EOD auto-exit triggered at 15:25 IST \\(NSE\\)",
            "/home/ubuntu/tradeExcutionModule/nohup.out"
        ),
        // 10. CDS EOD unsub at 17:05 IST
        v2("cds-eod-unsub",
            "CDS EOD Unsub",
            "Releases CDS option subscriptions at 17:05 IST — frees cap headroom for post-session universe.",
            Category.TRADE_EXEC, "optionProducer",
            "Daily 17:05 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA"),
            LocalTime.of(17, 5), true,
            LocalTime.of(17, 5), LocalTime.of(17, 10),
            java.util.Collections.emptyMap(),
            "\\[EOD-CLEANUP\\].*exchange=CDS",
            "/home/ubuntu/optionProducerJava/nohup.out"
        ),
        // 11. MCX EOD unsub (seasonal) — 23:35 (DST) or 00:05 (standard)
        v2("mcx-eod-unsub",
            "MCX EOD Unsub (seasonal)",
            "Releases MCX option subscriptions after MCX close — 23:35 IST DST / 00:05 IST standard.",
            Category.TRADE_EXEC, "optionProducer",
            "Daily 23:35 or 00:05 IST (seasonal)",
            StatusSource.LOG_PATTERN,
            Arrays.asList("QUANT", "MCX_BB_15", "MCX_BB_30"),
            LocalTime.of(23, 35), true,
            LocalTime.of(23, 30), LocalTime.of(23, 59),
            java.util.Collections.emptyMap(),
            "\\[EOD-CLEANUP\\].*exchange=MCX",
            "/home/ubuntu/optionProducerJava/nohup.out"
        ),
        // 12. Subscription cap headroom — HTTP_GET_JSON against optionProducer
        v2("subscription-cap-headroom",
            "Subscription Cap Headroom",
            "optionProducer WS headroom must stay > 500 during session — below signals cap exhaustion.",
            Category.LIVE_FEED, "optionProducer",
            "Polled on-demand — threshold headroom > 500",
            StatusSource.HTTP_GET_JSON,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA", "MERE", "HOTSTOCKS"),
            null, false,
            null, null,
            cfg("url", "http://localhost:8208/api/ws/ws-health", "jsonPath", "headroom", "threshold", "500", "comparator", "gt"),
            null, null
        ),
        // 13. Kafka consumer lag — HTTP_GET_JSON; pending until endpoint ships (S10)
        v2("kafka-consumer-lag",
            "Kafka Consumer Lag",
            "Max per-topic lag across consumer groups. PENDING until /api/admin/kafka-lag ships (S10).",
            Category.LIVE_FEED, "dashboard",
            "Polled on-demand — threshold max-lag < 1000",
            StatusSource.HTTP_GET_JSON,
            Arrays.asList("ALL_STRATEGIES"),
            null, false,
            null, null,
            cfg("url", "http://localhost:8085/api/admin/kafka-lag", "jsonPath", "maxLagAcrossTopics", "threshold", "1000", "comparator", "lt"),
            null, null
        ),
        // 14. Daily build sentinel — kotsin:build:drift must be empty
        v2("daily-build-sentinel",
            "Daily Build Sentinel",
            "Cron 05:00 IST Mon-Fri compiles all repos. Drift list must be empty [] by 05:10.",
            Category.LIVE_FEED, "system",
            "Daily 05:00 IST Mon-Fri",
            StatusSource.REDIS_KEY_EMPTY_ARRAY,
            Arrays.asList("ALL_STRATEGIES"),
            LocalTime.of(5, 0), true,
            LocalTime.of(5, 0), LocalTime.of(5, 30),
            cfg("redisKey", "kotsin:build:drift"),
            null, null
        ),
        // 15. streamingcandle port 8081
        v2("port-streamingcandle-8081",
            "Port 8081 (streamingcandle)",
            "streamingcandle Spring Boot must bind port 8081 during session.",
            Category.LIVE_FEED, "streamingcandle",
            "Always — checked on every health poll",
            StatusSource.PORT_BOUND,
            Arrays.asList("ALL_STRATEGIES"),
            null, false,
            null, null,
            cfg("port", "8081"),
            null, null
        ),
        // 16. tradeExec port 8089
        v2("port-tradeexec-8089",
            "Port 8089 (tradeExec)",
            "tradeExcutionModule Spring Boot must bind port 8089 during session.",
            Category.LIVE_FEED, "tradeExec",
            "Always — checked on every health poll",
            StatusSource.PORT_BOUND,
            Arrays.asList("ALL_STRATEGIES"),
            null, false,
            null, null,
            cfg("port", "8089"),
            null, null
        ),
        // 17. dashboard-backend port 8085
        v2("port-dashboard-8085",
            "Port 8085 (dashboard)",
            "trading-dashboard backend must bind port 8085 — frontend depends on it.",
            Category.LIVE_FEED, "dashboard",
            "Always — checked on every health poll",
            StatusSource.PORT_BOUND,
            Arrays.asList("ALL_STRATEGIES"),
            null, false,
            null, null,
            cfg("port", "8085"),
            null, null
        ),
        // 18. ScripFinder port 8102
        v2("port-scripfinder-8102",
            "Port 8102 (ScripFinder)",
            "ScripFinder must bind 8102 — exposes /getDesiredWebSocket for OptionProducer ingestion.",
            Category.LIVE_FEED, "scripFinder",
            "Always — checked on every health poll",
            StatusSource.PORT_BOUND,
            Arrays.asList("ALL_STRATEGIES"),
            null, false,
            null, null,
            cfg("port", "8102"),
            null, null
        ),
        // 19. OptionProducer port 8208
        v2("port-optionproducer-8208",
            "Port 8208 (OptionProducer)",
            "optionProducerJava must bind 8208 — gates every option subscription.",
            Category.LIVE_FEED, "optionProducer",
            "Always — checked on every health poll",
            StatusSource.PORT_BOUND,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA", "MERE"),
            null, false,
            null, null,
            cfg("port", "8208"),
            null, null
        ),
        // 20. Daily ships audit ran yesterday
        v2("daily-ships-audit",
            "Daily Ships Audit",
            "Yesterday's audit file must exist at /home/ubuntu/docs/audits/ships-{yesterday}.json.",
            Category.LIVE_FEED, "system",
            "Daily — file exists for yesterday",
            StatusSource.FILE_EXISTS,
            Arrays.asList("ALL_STRATEGIES"),
            null, false,
            null, null,
            cfg("path", "/home/ubuntu/docs/audits/ships-{yesterday}.json"),
            null, null
        ),

        // ═══════════════════════ 2026-04-26 SATURDAY ADDITIONS ═══════════════════════
        // 22. HotStocks multi-day exemption at 15:25 IST EOD — proves Option B is active.
        v2("hotstocks-multiday-exemption",
            "HotStocks Multi-Day Exemption",
            "At 15:25 IST NSE EOD, HOTSTOCKS positions MUST be skipped (they ride overnight). " +
                "Log signature proves the exemption branch fired — absence implies Option B is off.",
            Category.HOTSTOCKS, "dashboard",
            "Daily 15:25 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("HOTSTOCKS"),
            LocalTime.of(15, 25), true,
            LocalTime.of(15, 25), LocalTime.of(15, 30),
            java.util.Collections.emptyMap(),
            "skipped \\(HOTSTOCKS multi-day\\)",
            "/home/ubuntu/trading-dashboard/backend/nohup.out"
        ),
        // 23. Forward-P&L aggregator — afternoon cron (16:10 IST)
        v2("shadow-pnl-aggregator-afternoon",
            "Shadow P&L Aggregator (afternoon)",
            "Resolves forwardPnL for matrix_shadow_log rows whose ts+30min lies in the past. " +
                "Anchor is underlyingSpotAtSignal (post-2026-04-26 fix) vs tick_candles_1m close.",
            Category.TRADE_EXEC, "streamingcandle",
            "Daily 16:10 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII", "FUKAA", "FUDKOI"),
            LocalTime.of(16, 10), true,
            LocalTime.of(16, 10), LocalTime.of(16, 15),
            java.util.Collections.emptyMap(),
            "\\[SHADOW-PNL\\] cycle='afternoon'",
            "/home/ubuntu/streamingcandle/nohup.out"
        ),
        // 24. Forward-P&L aggregator — evening cron (20:00 IST)
        v2("shadow-pnl-aggregator-evening",
            "Shadow P&L Aggregator (evening)",
            "Second daily pass for late MCX signals whose T+30 window ends after 16:10 IST.",
            Category.TRADE_EXEC, "streamingcandle",
            "Daily 20:00 IST Mon-Fri",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII", "FUKAA", "FUDKOI"),
            LocalTime.of(20, 0), true,
            LocalTime.of(20, 0), LocalTime.of(20, 5),
            java.util.Collections.emptyMap(),
            "\\[SHADOW-PNL\\] cycle='evening'",
            "/home/ubuntu/streamingcandle/nohup.out"
        ),
        // 25. /ws-audit route reachable (#47 fix) — regression sentinel
        v2("ws-audit-route-reachable",
            "/ws-audit Page Reachable",
            "Vite proxy '/ws' was prefix-matching '/ws-audit' pre-2026-04-26. Regex fix (^/ws($|/)) " +
                "applied. This probe re-fails if someone reverts the vite.config or adds another /ws* route.",
            Category.LIVE_FEED, "dashboard",
            "continuous — 60s probe",
            StatusSource.HTTP_GET_JSON,
            Arrays.asList("FUDKII", "FUDKOI", "FUKAA", "MERE", "HOTSTOCKS"),
            null, false, null, null,
            cfg("url", "http://localhost:3001/ws-audit"),
            null, null
        ),
        // 26. Matrix shadow log freshness — rows being written today proves logger is alive
        v2("matrix-shadow-log-freshness",
            "Matrix Shadow Log Freshness",
            "At least one matrix_shadow_log row written today. Absent = A7 shadow logger is silent; " +
                "regime analysis will have no fresh data. Catches the pre-2026-04-26 bug where " +
                "gapRatio/sectorAlignPct telemetry produced all-NO_GAP/SAME_DIR rows.",
            Category.TRADE_EXEC, "streamingcandle",
            "continuous — writes per FUDKII signal",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII"),
            null, false,
            LocalTime.of(9, 45), LocalTime.of(15, 30),
            java.util.Collections.emptyMap(),
            "\\[MATRIX-SHADOW\\] sym=",
            "/home/ubuntu/streamingcandle/nohup.out"
        ),

        // ═══════════════════════ PLANNED / DEFERRED WORK ═══════════════════════
        // Not shipped yet. Show as MISSING — serves as an operational queue visible on the
        // /health-check page alongside live crons. When shipped, these entries either get
        // removed (if integrated into another job) or converted to an active health check.
        v2("planned-fukaa-inline-dispatch",
            "[PLANNED] FUKAA Inline-Dispatch Redesign",
            "Remove Top-N accumulator; dispatch FUKAA/FUDKOI inline with FUDKII when " +
                "volSurge > 6x AND OIChange% > 200%. Target latency: FUKAA p95 249s → ~40s. " +
                "Week of 2026-04-28.",
            Category.PLANNED, "streamingcandle",
            "planned — week of 2026-04-28",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUKAA", "FUDKOI"),
            null, false, null, null,
            java.util.Collections.emptyMap(),
            "[FUKAA-INLINE-DISPATCH] not-yet-shipped-sentinel-never-matches",
            "/home/ubuntu/streamingcandle/nohup.out"
        ),
        v2("planned-stage2-confluence",
            "[PLANNED] Stage 2 Confluence Pre-Compute",
            "Pre-compute confluence scores at boundary-5 min so signal-fire path stays <20ms. " +
                "Part of unified pipeline Stage 2-5 deferred from 2026-04-23.",
            Category.PLANNED, "streamingcandle",
            "planned — Sun/Mon",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII", "FUKAA", "FUDKOI", "RETEST"),
            null, false, null, null,
            java.util.Collections.emptyMap(),
            "[CONFLUENCE-PRECOMPUTE] not-yet-shipped-sentinel-never-matches",
            "/home/ubuntu/streamingcandle/nohup.out"
        ),
        v2("planned-microalpha-106-rejected",
            "[PLANNED] MICROALPHA 106-REJECTED Root Cause",
            "106 MICROALPHA signals marked REJECTED last session — reason unknown. " +
                "Needs audit trace for a rejected signal's decision path. Mon morning investigation.",
            Category.PLANNED, "tradeExec",
            "planned — 2026-04-28 morning",
            StatusSource.LOG_PATTERN,
            Arrays.asList("MICROALPHA"),
            null, false, null, null,
            java.util.Collections.emptyMap(),
            "[MICROALPHA-REJECTED-ROOT-CAUSE] not-yet-shipped-sentinel-never-matches",
            "/home/ubuntu/tradeExcutionModule/nohup.out"
        ),
        v2("planned-hotstocks-dashboard-filter-bug",
            "[PLANNED] HotStocks 7-vs-12 Dashboard Filter Bug",
            "Dashboard 'Today's Trades' filter showed 7 HotStocks while Redis held 12 on 2026-04-24. " +
                "Frontend or backend filter mismatch — needs repro + fix.",
            Category.PLANNED, "dashboard",
            "planned — 2026-04-28",
            StatusSource.LOG_PATTERN,
            Arrays.asList("HOTSTOCKS"),
            null, false, null, null,
            java.util.Collections.emptyMap(),
            "[HOTSTOCKS-FILTER-FIX] not-yet-shipped-sentinel-never-matches",
            "/home/ubuntu/trading-dashboard/backend/nohup.out"
        ),
        v2("planned-matrix-telemetry-regression-analysis",
            "[PLANNED] Matrix-Shadow-Log Regime Analysis (after 1 week clean data)",
            "Re-run S8 regime × avgFwdPnL analysis after 1 week of post-#46/#48 clean data. " +
                "Flip CONVICTION_SKIP regimes where avgFwdPnL > 0 across 20+ obs.",
            Category.PLANNED, "streamingcandle",
            "planned — 2026-05-04 (after 1 wk of clean shadow data)",
            StatusSource.LOG_PATTERN,
            Arrays.asList("FUDKII"),
            null, false, null, null,
            java.util.Collections.emptyMap(),
            "[MATRIX-REGIME-FLIP] not-yet-shipped-sentinel-never-matches",
            "/home/ubuntu/streamingcandle/nohup.out"
        )
    );

    /**
     * Resolve the "latest trading date" as of {@code now} in the given zone.
     *
     * <p>If {@code now} is a trading day (Mon-Fri, not an NSE holiday), the latest
     * trading date is today. Otherwise it walks backward until it finds a trading
     * day. This intentionally does NOT gate on market hours — for scraper health
     * checks we want the <em>calendar</em> date that should carry today's feed,
     * which is simply the most recent NSE trading date.</p>
     *
     * <p>Weekends (Saturday, Sunday) and NSE-2026 holidays are skipped. The holiday
     * set is kept in sync with {@link com.kotsin.dashboard.calendar.NseCalendarHelper}.</p>
     */
    public static LocalDate resolveLatestTradingDate(ZoneId zone) {
        return resolveLatestTradingDate(ZonedDateTime.now(zone).toLocalDate());
    }

    /** Walk back from {@code from} (inclusive) to the nearest NSE trading day. */
    static LocalDate resolveLatestTradingDate(LocalDate from) {
        LocalDate d = from;
        int guard = 30;   // upper bound — no realistic run of 30 consecutive non-trading days
        while (guard-- > 0) {
            if (isNseTradingDay(d)) return d;
            d = d.minusDays(1);
        }
        return from;   // fallback — should never hit in practice
    }

    private static boolean isNseTradingDay(LocalDate d) {
        if (d == null) return false;
        DayOfWeek dow = d.getDayOfWeek();
        if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) return false;
        return !NSE_HOLIDAYS_2026.contains(d);
    }

    /** NSE holidays 2026 — MUST match NseCalendarHelper / TradingCalendarService. */
    private static final java.util.Set<LocalDate> NSE_HOLIDAYS_2026 = java.util.Set.of(
        LocalDate.of(2026, 1, 15),
        LocalDate.of(2026, 1, 26),
        LocalDate.of(2026, 3, 3),
        LocalDate.of(2026, 3, 26),
        LocalDate.of(2026, 3, 31),
        LocalDate.of(2026, 4, 3),
        LocalDate.of(2026, 4, 14),
        LocalDate.of(2026, 5, 1),
        LocalDate.of(2026, 5, 28),
        LocalDate.of(2026, 6, 26),
        LocalDate.of(2026, 9, 14),
        LocalDate.of(2026, 10, 2),
        LocalDate.of(2026, 10, 20),
        LocalDate.of(2026, 11, 10),
        LocalDate.of(2026, 11, 24),
        LocalDate.of(2026, 12, 25)
    );

    /**
     * Compute the next-run {@link ZonedDateTime} for a given job at {@code ref}.
     * If {@code nextRunTime} is null (recurring feeds), returns {@code ref + 1 minute}.
     * If {@code tradingDayOnly} and ref is weekend, returns next Monday {@code nextRunTime}.
     * Otherwise if ref is past today's {@code nextRunTime}, returns tomorrow's.
     */
    public static ZonedDateTime computeNextRun(HealthJob job, ZonedDateTime ref) {
        if (job.nextRunTime == null) {
            return ref.plusMinutes(1);   // recurring short-interval
        }
        ZonedDateTime today = ref.with(job.nextRunTime);
        ZonedDateTime candidate = ref.isBefore(today) ? today : today.plusDays(1);
        // Trading-day-only check
        if (job.tradingDayOnly) {
            while (candidate.getDayOfWeek() == DayOfWeek.SATURDAY
                || candidate.getDayOfWeek() == DayOfWeek.SUNDAY) {
                candidate = candidate.plusDays(1);
            }
        }
        return candidate;
    }

    private HealthJobRegistry() {}
}
