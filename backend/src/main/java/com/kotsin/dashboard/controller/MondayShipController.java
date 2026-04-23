package com.kotsin.dashboard.controller;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

/**
 * MondayShipController — unified view for the Monday 2026-04-20 ship:
 *   - NIFTY Index Day Trader live state + recent signals
 *   - Nifty50 Basket 49-stock grid
 *   - RETEST v2 gated signals
 *   - PivotBoss + BB sidebar per scrip
 *
 * Reads directly from {@code signal_rich_audit} collection written by the
 * new consumers. No existing controllers modified.
 */
@RestController
@RequestMapping("/api/monday-ship")
@Slf4j
public class MondayShipController {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Autowired
    private MongoTemplate mongoTemplate;

    @GetMapping(value = "/signals", produces = MediaType.APPLICATION_JSON_VALUE)
    public List<Map<String, Object>> getSignals(
        @RequestParam(value = "strategy", required = false) String strategy,
        @RequestParam(value = "date", required = false) String dateStr,
        @RequestParam(value = "limit", defaultValue = "200") int limit) {

        LocalDate date = dateStr != null ? LocalDate.parse(dateStr) : LocalDate.now(IST);
        Instant startOfDay = date.atStartOfDay(IST).toInstant();
        Instant endOfDay = date.plusDays(1).atStartOfDay(IST).toInstant();

        Query q = new Query();
        q.addCriteria(Criteria.where("entryTime").gte(startOfDay).lt(endOfDay));
        if (strategy != null && !strategy.isEmpty()) {
            q.addCriteria(Criteria.where("strategy").is(strategy));
        }
        q.with(Sort.by(Sort.Direction.DESC, "entryTime"));
        q.limit(Math.min(limit, 500));

        return mongoTemplate.find(q, Map.class, "signal_rich_audit")
            .stream()
            .map(doc -> {
                Map<String, Object> out = new LinkedHashMap<>();
                for (Object k : doc.keySet()) {
                    out.put(String.valueOf(k), doc.get(k));
                }
                return out;
            })
            .collect(java.util.stream.Collectors.toList());
    }

    @GetMapping(value = "/summary", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> getSummary(
        @RequestParam(value = "date", required = false) String dateStr) {

        LocalDate date = dateStr != null ? LocalDate.parse(dateStr) : LocalDate.now(IST);
        Instant startOfDay = date.atStartOfDay(IST).toInstant();
        Instant endOfDay = date.plusDays(1).atStartOfDay(IST).toInstant();

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("date", date.toString());

        for (String strategy : List.of("NIFTY_INDEX_TRADER", "NIFTY50_BASKET", "RETEST_V2")) {
            Query q = new Query();
            q.addCriteria(Criteria.where("strategy").is(strategy));
            q.addCriteria(Criteria.where("entryTime").gte(startOfDay).lt(endOfDay));
            long count = mongoTemplate.count(q, "signal_rich_audit");

            Query qLong = new Query();
            qLong.addCriteria(Criteria.where("strategy").is(strategy));
            qLong.addCriteria(Criteria.where("entryTime").gte(startOfDay).lt(endOfDay));
            qLong.addCriteria(Criteria.where("direction").is("LONG"));
            long longs = mongoTemplate.count(qLong, "signal_rich_audit");

            Map<String, Object> strategySummary = new LinkedHashMap<>();
            strategySummary.put("total_signals", count);
            strategySummary.put("long_signals", longs);
            strategySummary.put("short_signals", count - longs);
            summary.put(strategy, strategySummary);
        }

        return summary;
    }

    /**
     * PivotBoss + BB sidebar for a given scrip.
     * Reads latest state from pivotIndicatorData / pivotboss_day_context collections
     * that already exist.
     */
    /**
     * Shadow-gate live stats (2026-04-23). Reads from signal_pipeline_audit — the composite
     * gate runs in SignalBufferService, persists compositeScore + decision to this collection.
     * Groups today's FUDKII/FUDKOI/FUKAA/MICROALPHA signals by composite decision + source,
     * plus a divergence-vs-RR-gate breakdown so the trader can see where the composite WOULD
     * have made different calls than the current enforcing RR gate.
     */
    @GetMapping(value = "/shadow-stats", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> getShadowStats(
        @RequestParam(value = "date", required = false) String dateStr) {

        LocalDate date = dateStr != null ? LocalDate.parse(dateStr) : LocalDate.now(IST);
        Instant startOfDay = date.atStartOfDay(IST).toInstant();
        Instant endOfDay = date.plusDays(1).atStartOfDay(IST).toInstant();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("date", date.toString());

        Query withScore = new Query();
        withScore.addCriteria(Criteria.where("firstSeenAt").gte(startOfDay).lt(endOfDay));
        withScore.addCriteria(Criteria.where("compositeScore").exists(true));

        long totalWithComposite = mongoTemplate.count(withScore, "signal_pipeline_audit");
        out.put("totalWithCompositeScore", totalWithComposite);

        // Per-source decision breakdown
        Map<String, Map<String, Long>> perSource = new LinkedHashMap<>();
        for (String source : List.of("FUDKII", "FUDKOI", "FUKAA", "MICROALPHA", "MERE")) {
            Map<String, Long> byDecision = new LinkedHashMap<>();
            for (String dec : List.of("PASS_T2", "PASS_T1", "REJECT", "ERROR")) {
                Query q = new Query()
                    .addCriteria(Criteria.where("firstSeenAt").gte(startOfDay).lt(endOfDay))
                    .addCriteria(Criteria.where("strategy").is(source))
                    .addCriteria(Criteria.where("compositeDecision").is(dec));
                long c = mongoTemplate.count(q, "signal_pipeline_audit");
                if (c > 0) byDecision.put(dec, c);
            }
            if (!byDecision.isEmpty()) perSource.put(source, byDecision);
        }
        out.put("perSource", perSource);

        // Average score per source
        Map<String, Object> avgScores = new LinkedHashMap<>();
        for (String source : List.of("FUDKII", "FUDKOI", "FUKAA", "MICROALPHA")) {
            org.springframework.data.mongodb.core.aggregation.Aggregation agg =
                org.springframework.data.mongodb.core.aggregation.Aggregation.newAggregation(
                    org.springframework.data.mongodb.core.aggregation.Aggregation.match(
                        Criteria.where("firstSeenAt").gte(startOfDay).lt(endOfDay)
                            .and("strategy").is(source)
                            .and("compositeScore").exists(true)),
                    org.springframework.data.mongodb.core.aggregation.Aggregation.group()
                        .count().as("n").avg("compositeScore").as("avgScore"));
            Map r = mongoTemplate.aggregate(agg, "signal_pipeline_audit", Map.class)
                .getUniqueMappedResult();
            if (r != null && r.get("n") != null) {
                avgScores.put(source, Map.of(
                    "n", r.get("n"),
                    "avgScore", Math.round(((Number) r.get("avgScore")).doubleValue() * 10.0) / 10.0));
            }
        }
        out.put("avgScoresPerSource", avgScores);

        // Recent 10 shadow decisions (latest first) — dashboard shows a live feed
        Query recent = new Query()
            .addCriteria(Criteria.where("firstSeenAt").gte(startOfDay).lt(endOfDay))
            .addCriteria(Criteria.where("compositeScore").exists(true))
            .with(Sort.by(Sort.Direction.DESC, "firstSeenAt"))
            .limit(15);
        List<Map<String, Object>> recentList = new ArrayList<>();
        for (Map<?, ?> d : mongoTemplate.find(recent, Map.class, "signal_pipeline_audit")) {
            Map<String, Object> row = new LinkedHashMap<>();
            for (String k : List.of("firstSeenAt", "strategy", "scripCode", "symbol",
                    "optionType", "compositeScore", "compositeDecision", "compositeReason",
                    "batchOutcome")) {
                Object v = d.get(k);
                if (v != null) row.put(k, v);
            }
            recentList.add(row);
        }
        out.put("recent", recentList);
        return out;
    }

    @GetMapping(value = "/pivotboss-sidebar/{scripCode}", produces = MediaType.APPLICATION_JSON_VALUE)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public Map<String, Object> getPivotBossSidebar(@PathVariable String scripCode) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("scripCode", scripCode);

        // Pivot indicator data
        Query pivotQ = new Query();
        pivotQ.addCriteria(Criteria.where("_id").is(scripCode));
        Map pivotDoc = mongoTemplate.findOne(pivotQ, Map.class, "pivotIndicatorData");
        if (pivotDoc != null) {
            out.put("pivotIndicatorData", pivotDoc.get("pivotIndicatorData"));
        }

        // PivotBoss day context (today)
        LocalDate today = LocalDate.now(IST);
        Query ctxQ = new Query();
        ctxQ.addCriteria(Criteria.where("scripCode").is(scripCode));
        ctxQ.addCriteria(Criteria.where("date").is(today.toString()));
        Map ctxDoc = mongoTemplate.findOne(ctxQ, Map.class, "pivotboss_day_context");
        if (ctxDoc != null) {
            out.put("pivotBossDayContext", ctxDoc);
        }

        // Latest signal rich audit for this scrip (last 7 days)
        Instant since = today.minusDays(7).atStartOfDay(IST).toInstant();
        Query recentQ = new Query();
        recentQ.addCriteria(Criteria.where("scripCode").is(scripCode));
        recentQ.addCriteria(Criteria.where("entryTime").gte(since));
        recentQ.with(Sort.by(Sort.Direction.DESC, "entryTime"));
        recentQ.limit(20);
        List<Map> recent = mongoTemplate.find(recentQ, Map.class, "signal_rich_audit");
        out.put("recentSignals", recent);

        return out;
    }
}
