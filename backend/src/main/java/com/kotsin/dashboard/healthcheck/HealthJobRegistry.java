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

    public enum Category { SCRAPER, HOTSTOCKS, TRADE_EXEC, LIVE_FEED }

    /** How to determine "did today's run succeed" — four flavors fit all 17 jobs. */
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
        LOG_PATTERN
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
                /* dataKeyPattern */ null);
        }

        HealthJob(String id, String name, String purpose, Category category,
                  String serviceName, String cronExpression, String humanSchedule,
                  StatusSource statusSource, String statusRedisKey, long stalenessSec,
                  String logPattern, String logFile,
                  List<String> affectedStrategies, String triggerEndpoint, String triggerService,
                  LocalTime nextRunTime, boolean tradingDayOnly,
                  LocalTime retryWindowStart, LocalTime retryWindowEnd,
                  String dataKeyPattern) {
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
        }
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
        new HealthJob("gift-nifty",
            "GIFT Nifty",
            "Live last-trade scrape for pre-market Nifty50 direction prediction.",
            Category.LIVE_FEED, "streamingcandle",
            "fixedDelay 60000ms",
            "Every 60s",
            StatusSource.REDIS_EPOCH_FRESHNESS,
            "gift-nifty:last-update-ms", 5 * 60,
            null, null,
            Arrays.asList("INSIGHTS_PAGE", "MARKET_PULSE"),
            null, null,
            null, false,
            null, null
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
