package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.repository.TradeFillRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Detects and reports gaps between {@code virtual:positions:*} in Redis, {@code trade_outcomes}
 * in Mongo, and {@code trade_fills} in Mongo.
 *
 * Two jobs:
 *   1. Every 60s: for each active position that has had partial exits (qtyOpen &lt; totalQty),
 *      confirm we have at least one trade_fill doc for its signalId. Log WARN on mismatch.
 *   2. 23:35 IST weekdays: assert every trade_outcome from today has ≥1 trade_fill. Write any
 *      mismatches to Redis key {@code trade-fills:eod-alerts:{yyyy-MM-dd}} for next-morning review.
 *
 * This is a DIAGNOSTIC service. It never auto-heals — gaps indicate a real producer-side problem
 * that needs human investigation. The goal is simply to ensure no silent drift.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class TradeFillReconciliationService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final StringRedisTemplate redis;
    private final TradeFillRepository tradeFillRepository;
    private final MongoTemplate mongoTemplate;
    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * Every 60 seconds scan active virtual positions and verify we have fills for any position
     * that has had partial exits. Logs one line per mismatch at WARN level.
     */
    @Scheduled(fixedDelay = 60000, initialDelay = 120000)
    public void reconcileActivePositions() {
        try {
            Set<String> keys = redis.keys("virtual:positions:*");
            if (keys == null || keys.isEmpty()) {
                log.debug("[FILL_RECON] no active positions in Redis");
                return;
            }

            // Only reconcile positions updated TODAY. Historical CLOSED positions from before
            // the trade-fills pipeline went live are permanently out of scope — we have no way
            // to backfill them and flagging them every 60s is pure noise.
            long startOfTodayMs = LocalDate.now(IST).atStartOfDay(IST).toInstant().toEpochMilli();

            int checked = 0;
            int mismatches = 0;
            for (String posKey : keys) {
                try {
                    String posJson = redis.opsForValue().get(posKey);
                    if (posJson == null) continue;
                    JsonNode pos = mapper.readTree(posJson);

                    String signalId = text(pos, "signalId");
                    if (signalId == null) continue;

                    long updatedAt = pos.path("updatedAt").asLong(0);
                    if (updatedAt < startOfTodayMs) continue; // stale / pre-pipeline — skip

                    String status = pos.path("status").asText("");
                    // Live recon only checks STILL-OPEN positions with partial exits.
                    // Fully closed trades (CLOSED) are handled by endOfDayAssertion(), which
                    // walks trade_outcomes authoritatively. The 60s loop only catches the
                    // drift-window case: a position is partially filled in Redis but the
                    // corresponding fill events never made it to Mongo.
                    if ("CLOSED".equalsIgnoreCase(status)) continue;

                    int qtyOpen = pos.path("qtyOpen").asInt(0);
                    int totalQty = pos.path("qtyTotal").asInt(pos.path("quantity").asInt(0));
                    if (totalQty <= 0) continue;            // catalog row, not a real trade
                    if (qtyOpen >= totalQty) continue;      // no exits yet
                    // else: partial exit happened → we should have at least one trade_fill

                    checked++;
                    long fillCount = tradeFillRepository.countByTradeId(signalId);
                    if (fillCount == 0) {
                        mismatches++;
                        log.warn("[FILL_RECON] MISMATCH: position {} (signalId={}) has qtyOpen={}/{} but 0 trade_fills in Mongo",
                            pos.path("scripCode").asText(""), signalId, qtyOpen, totalQty);
                        try {
                            redis.opsForSet().add("trade-fills:recon-alerts:" + today(), signalId);
                            redis.expire("trade-fills:recon-alerts:" + today(), Duration.ofDays(7));
                        } catch (Exception ignored) {}
                    }
                } catch (Exception e) {
                    log.debug("[FILL_RECON] skip key {}: {}", posKey, e.getMessage());
                }
            }
            if (mismatches > 0 || checked > 20) {
                log.info("[FILL_RECON] checked={} mismatches={}", checked, mismatches);
            }
        } catch (Exception e) {
            log.error("[FILL_RECON] fatal error in recon loop: {}", e.getMessage());
        }
    }

    /**
     * End-of-day assertion at 23:35 IST: for every trade_outcome persisted today, confirm we have
     * at least one trade_fill document referencing its signalId. Mismatches are written to
     * {@code trade-fills:eod-alerts:{yyyy-MM-dd}} in Redis for the next-morning operator review.
     *
     * Runs weekdays only (Mon-Fri). MCX can trade up to 23:30 so we run after the last possible
     * exit.
     */
    @Scheduled(cron = "0 35 23 * * MON-FRI", zone = "Asia/Kolkata")
    public void endOfDayAssertion() {
        try {
            LocalDate today = LocalDate.now(IST);
            Date startOfDay = Date.from(today.atStartOfDay(IST).toInstant());

            // Filter by exitTime — a trade that exited today is what we care about (whether or
            // not it entered today). Trades still open carry over to tomorrow's assertion.
            List<Document> outcomes = mongoTemplate.getCollection("trade_outcomes").find(
                new Document("exitTime", new Document("$gte", startOfDay))
            ).into(new ArrayList<>());

            int total = outcomes.size();
            if (total == 0) {
                log.info("[FILL_RECON_EOD] no trade_outcomes for {} — nothing to assert", today);
                return;
            }

            int missing = 0;
            List<String> missingIds = new ArrayList<>();
            for (Document outcome : outcomes) {
                String signalId = outcome.getString("signalId");
                if (signalId == null) continue;
                long fills = tradeFillRepository.countByTradeId(signalId);
                if (fills == 0) {
                    missing++;
                    missingIds.add(signalId);
                }
            }

            String redisKey = "trade-fills:eod-alerts:" + today;
            if (missing > 0) {
                log.error("[FILL_RECON_EOD] {} of {} trade_outcomes have NO trade_fills for {}. Missing signalIds: {}",
                    missing, total, today,
                    missingIds.size() > 10 ? missingIds.subList(0, 10) + "... (" + missingIds.size() + " total)" : missingIds);
                try {
                    for (String id : missingIds) {
                        redis.opsForSet().add(redisKey, id);
                    }
                    redis.expire(redisKey, Duration.ofDays(30));
                } catch (Exception e) {
                    log.error("[FILL_RECON_EOD] failed to write alert key: {}", e.getMessage());
                }
            } else {
                log.info("[FILL_RECON_EOD] PASS: all {} trade_outcomes for {} have at least one trade_fill",
                    total, today);
                try { redis.opsForValue().set(redisKey + ":status", "PASS", Duration.ofDays(30)); }
                catch (Exception ignored) {}
            }
        } catch (Exception e) {
            log.error("[FILL_RECON_EOD] fatal error: {}", e.getMessage(), e);
        }
    }

    private String today() {
        return LocalDate.now(IST).toString();
    }

    private String text(JsonNode n, String field) {
        JsonNode v = n.path(field);
        if (v.isNull() || v.isMissingNode()) return null;
        String t = v.asText(null);
        return (t == null || "null".equals(t)) ? null : t;
    }
}
