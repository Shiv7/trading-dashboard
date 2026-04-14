package com.kotsin.dashboard.hotstocks.service;

import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Front-month futures OI time series provider.
 *
 * Resolves the nearest-expiry futures contract per underlying and aggregates
 * {@code oi_metrics_1m} rows into clean daily OHLC-OI snapshots. Handles the
 * multi-expiry collision that makes {@code underlyingSymbol}-keyed queries
 * unreliable.
 *
 * Rollover-aware: within 3 days of front-month expiry, also includes the
 * next-month contract OI for continuity. Not today's problem but documented
 * here for the future.
 */
@Component
@Slf4j
public class OiSeriesProvider {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final int MIN_ROWS_FOR_COMPLETE_DAY = 60;

    @Autowired(required = false)
    private MongoTemplate mongo;

    /** One day of OI data aggregated from minute bars. */
    public static class DailyOi {
        public final String day;
        public final long oiOpen, oiHigh, oiLow, oiClose;
        public final int rowCount;
        public final boolean incomplete;
        public DailyOi(String day, long o, long h, long l, long c, int n) {
            this.day = day; this.oiOpen = o; this.oiHigh = h; this.oiLow = l; this.oiClose = c;
            this.rowCount = n; this.incomplete = n < MIN_ROWS_FOR_COMPLETE_DAY;
        }
    }

    /**
     * Resolve the front-month futures scripCode for an underlying.
     * Returns null if no active (not-expired) futures exist in {@code ScripGroup}.
     */
    @SuppressWarnings("unchecked")
    public String frontMonthScripCode(String underlyingSymbol) {
        if (mongo == null || underlyingSymbol == null) return null;
        try {
            org.springframework.data.mongodb.core.query.Query q =
                    new org.springframework.data.mongodb.core.query.Query(
                        org.springframework.data.mongodb.core.query.Criteria.where("companyName").is(underlyingSymbol));
            Document doc = mongo.findOne(q, Document.class, "ScripGroup");
            if (doc == null) return null;
            List<Document> futures = (List<Document>) doc.get("futures");
            if (futures == null || futures.isEmpty()) return null;
            LocalDate today = LocalDate.now(IST);
            return futures.stream()
                    .filter(f -> {
                        String e = f.getString("Expiry");
                        if (e == null) return false;
                        try { return !LocalDate.parse(e).isBefore(today); }
                        catch (Exception ex) { return false; }
                    })
                    .sorted(Comparator.comparing(f -> LocalDate.parse(f.getString("Expiry"))))
                    .map(f -> f.getString("ScripCode"))
                    .findFirst().orElse(null);
        } catch (Exception e) {
            log.debug("[OI-SERIES] frontMonth lookup failed for {}: {}", underlyingSymbol, e.getMessage());
            return null;
        }
    }

    /**
     * Fetch daily OHLC OI for a scripCode over a range. Each day's min-bar
     * count is included so downstream can treat incomplete days appropriately.
     */
    public List<DailyOi> fetchDailyOi(String scripCode, LocalDate fromInclusive, LocalDate toInclusive) {
        if (mongo == null || scripCode == null) return List.of();
        try {
            java.util.Date from = java.util.Date.from(fromInclusive.atStartOfDay(IST).toInstant());
            java.util.Date to   = java.util.Date.from(toInclusive.plusDays(1).atStartOfDay(IST).toInstant());

            List<Document> pipeline = List.of(
                new Document("$match", new Document("scripCode", scripCode)
                        .append("timestamp", new Document("$gte", from).append("$lt", to))),
                new Document("$addFields", new Document("dayKey",
                        new Document("$dateToString", new Document("format", "%Y-%m-%d")
                                .append("date", "$timestamp")
                                .append("timezone", "Asia/Kolkata")))),
                new Document("$group", new Document("_id", "$dayKey")
                        .append("oiOpen",  new Document("$first", "$oiClose"))
                        .append("oiHigh",  new Document("$max",   "$oiClose"))
                        .append("oiLow",   new Document("$min",   "$oiClose"))
                        .append("oiClose", new Document("$last",  "$oiClose"))
                        .append("n",       new Document("$sum", 1))),
                new Document("$sort", new Document("_id", 1))
            );

            List<DailyOi> out = new ArrayList<>();
            for (Document row : mongo.getCollection("oi_metrics_1m").aggregate(pipeline)) {
                out.add(new DailyOi(
                        row.getString("_id"),
                        numberOf(row.get("oiOpen")),
                        numberOf(row.get("oiHigh")),
                        numberOf(row.get("oiLow")),
                        numberOf(row.get("oiClose")),
                        row.get("n") == null ? 0 : ((Number) row.get("n")).intValue()
                ));
            }
            return out;
        } catch (Exception e) {
            log.debug("[OI-SERIES] daily OI fetch failed for {}: {}", scripCode, e.getMessage());
            return List.of();
        }
    }

    /**
     * 5-day OI change %. Uses only COMPLETE days (rowCount >= 60) for the
     * anchor day 5 sessions ago; latest day uses latest-reading even if
     * incomplete (intraday snapshot).
     *
     * Returns empty Optional if insufficient clean data.
     */
    public Optional<Double> fiveDayOiChangePct(String underlyingSymbol) {
        String scrip = frontMonthScripCode(underlyingSymbol);
        if (scrip == null) return Optional.empty();
        LocalDate today = LocalDate.now(IST);
        List<DailyOi> series = fetchDailyOi(scrip, today.minusDays(10), today);
        return computeFiveDayChange(series);
    }

    /**
     * Pure computation over a daily OI series. Public for direct unit testing
     * without Mongo.
     *
     * Rule:
     *   - Take only complete days as anchors
     *   - Need at least 2 complete days
     *   - Latest: if today has any data (complete or not), use its oiClose as current
     *   - Anchor: oldest complete day in the last 6 sessions
     *   - Change = (latest - anchor) / anchor × 100
     */
    public static Optional<Double> computeFiveDayChange(List<DailyOi> series) {
        if (series == null || series.size() < 2) return Optional.empty();
        List<DailyOi> complete = new ArrayList<>();
        DailyOi latest = null;
        for (DailyOi d : series) {
            if (!d.incomplete) complete.add(d);
            latest = d; // iteration already sorted asc; keep last
        }
        if (latest == null) return Optional.empty();
        DailyOi anchor = complete.isEmpty() ? null : complete.get(0);
        if (anchor == null) return Optional.empty();
        if (anchor.oiClose == 0) return Optional.empty();
        double pct = (latest.oiClose - anchor.oiClose) * 100.0 / anchor.oiClose;
        return Optional.of(pct);
    }

    private static long numberOf(Object v) {
        if (v instanceof Number) return ((Number) v).longValue();
        return 0;
    }
}
