package com.kotsin.dashboard.service;

import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Service;

import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * SlippageBackfillService — Retroactively computes slippage estimates for existing trades
 * by joining trade_outcomes against orderbook_metrics_1m and tick_candles_1m.
 *
 * Uses 4-tier fallback:
 *   FULL:        spread + depth + Kyle's Lambda (from orderbook_metrics_1m)
 *   SPREAD_ONLY: spread only (partial orderbook data)
 *   VOLUME_ONLY: volume proxy (from tick_candles_1m)
 *   STATIC:      static tick model (no matching data)
 *
 * Run via: POST /api/admin/backfill-slippage
 */
@Service
@Slf4j
public class SlippageBackfillService {

    private static final String LOG_PREFIX = "[SLIPPAGE-BACKFILL]";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Autowired
    private MongoTemplate mongoTemplate;

    /**
     * Backfill slippage for all trades that don't have it yet.
     * Returns count of trades updated.
     */
    public int backfillAll() {
        // Find trades without slippage data
        Query query = new Query(new Criteria().orOperator(
                Criteria.where("estimatedSlippagePct").is(null),
                Criteria.where("estimatedSlippagePct").exists(false)
        ));
        List<Document> trades = mongoTemplate.find(query, Document.class, "trade_outcomes");

        log.info("{} Found {} trades without slippage data", LOG_PREFIX, trades.size());

        AtomicInteger updated = new AtomicInteger(0);
        AtomicInteger full = new AtomicInteger(0);
        AtomicInteger spreadOnly = new AtomicInteger(0);
        AtomicInteger volumeOnly = new AtomicInteger(0);
        AtomicInteger staticFallback = new AtomicInteger(0);
        AtomicInteger skipped = new AtomicInteger(0);

        for (Document trade : trades) {
            try {
                boolean result = backfillTrade(trade, full, spreadOnly, volumeOnly, staticFallback);
                if (result) updated.incrementAndGet();
                else skipped.incrementAndGet();
            } catch (Exception e) {
                log.debug("{} Error processing trade {}: {}", LOG_PREFIX,
                        trade.getString("signalId"), e.getMessage());
                skipped.incrementAndGet();
            }
        }

        log.info("{} Backfill complete: updated={} skipped={} " +
                "(FULL={} SPREAD_ONLY={} VOLUME_ONLY={} STATIC={})",
                LOG_PREFIX, updated.get(), skipped.get(),
                full.get(), spreadOnly.get(), volumeOnly.get(), staticFallback.get());

        return updated.get();
    }

    private boolean backfillTrade(Document trade, AtomicInteger full, AtomicInteger spreadOnly,
                                   AtomicInteger volumeOnly, AtomicInteger staticFallback) {
        String scripCode = trade.getString("scripCode");
        String signalId = trade.getString("signalId");
        if (scripCode == null || signalId == null) return false;

        double entryPrice = getDouble(trade, "entryPrice");
        double exitPrice = getDouble(trade, "exitPrice");
        int quantity = getInt(trade, "quantity");
        String exchange = trade.getString("exchange");
        if (exchange == null) exchange = "N";

        if (entryPrice <= 0 || quantity <= 0) return false;

        // Parse entry/exit times
        Instant entryInstant = parseTime(trade.get("entryTime"));
        Instant exitInstant = parseTime(trade.get("exitTime"));
        if (entryInstant == null) return false;

        // ── Try orderbook_metrics_1m for entry window ──
        Document entryOb = findNearestOrderbookMetrics(scripCode, entryInstant);
        Document exitOb = exitInstant != null ? findNearestOrderbookMetrics(scripCode, exitInstant) : null;

        // ── Try tick_candles_1m for volume data ──
        Document entryCandle = findNearestTickCandle(scripCode, entryInstant);

        // ── Compute slippage by tier ──
        double entrySlippagePerUnit;
        double exitSlippagePerUnit;
        double roundTripPerUnit;
        String tier;

        if (entryOb != null && getDouble(entryOb, "bidAskSpread") > 0
                && getDouble(entryOb, "avgAskDepth") > 0
                && getDouble(entryOb, "kyleLambda") > 0) {
            // FULL tier
            tier = "FULL";
            entrySlippagePerUnit = computeFullSlippage(entryOb, quantity);
            exitSlippagePerUnit = exitOb != null ? computeFullSlippage(exitOb, quantity) : entrySlippagePerUnit;
            full.incrementAndGet();
        } else if (entryOb != null && getDouble(entryOb, "bidAskSpread") > 0) {
            // SPREAD_ONLY tier
            tier = "SPREAD_ONLY";
            double halfSpread = getDouble(entryOb, "bidAskSpread") / 2.0;
            double avgVol = entryCandle != null ? getDouble(entryCandle, "volume") : 0;
            double impactProxy = avgVol > 0 ? halfSpread * Math.min(quantity / (avgVol * 2), 3.0) : 0;
            entrySlippagePerUnit = halfSpread + impactProxy;
            exitSlippagePerUnit = entrySlippagePerUnit;
            spreadOnly.incrementAndGet();
        } else if (entryCandle != null && getDouble(entryCandle, "volume") > 0) {
            // VOLUME_ONLY tier
            tier = "VOLUME_ONLY";
            double avgVol = getDouble(entryCandle, "volume");
            double participationRate = avgVol > 0 ? quantity / (avgVol * 2) : 1.0;
            double impactFactor = 0.001 * (1 + Math.min(participationRate, 5.0));
            entrySlippagePerUnit = entryPrice * impactFactor;
            exitSlippagePerUnit = entrySlippagePerUnit;
            volumeOnly.incrementAndGet();
        } else {
            // STATIC fallback
            tier = "STATIC";
            double tickSize = resolveTickSize(scripCode, exchange);
            int ticks = entryPrice < 5 ? 3 : entryPrice < 50 ? 2 : 1;
            entrySlippagePerUnit = ticks * tickSize;
            entrySlippagePerUnit = Math.max(entrySlippagePerUnit, tickSize); // floor: 1 tick
            exitSlippagePerUnit = entrySlippagePerUnit;
            staticFallback.incrementAndGet();
        }

        // Cap per-unit slippage at 1% of entry price
        entrySlippagePerUnit = Math.min(entrySlippagePerUnit, entryPrice * 0.01);
        exitSlippagePerUnit = Math.min(exitSlippagePerUnit, entryPrice * 0.01);
        roundTripPerUnit = entrySlippagePerUnit + exitSlippagePerUnit;
        double totalSlippage = roundTripPerUnit * quantity;
        double slippagePct = entryPrice > 0 ? (roundTripPerUnit / entryPrice) * 100 : 0;

        // ── Write back to trade_outcomes ──
        Query updateQuery = new Query(Criteria.where("signalId").is(signalId));
        Update update = new Update()
                .set("estimatedEntrySlippage", entrySlippagePerUnit)
                .set("estimatedEntrySlippageTotal", totalSlippage)
                .set("estimatedSlippagePct", slippagePct)
                .set("slippageTier", tier);
        mongoTemplate.updateFirst(updateQuery, update, "trade_outcomes");

        log.debug("{} Backfilled {} tier={} slippage={}% total={}",
                LOG_PREFIX, signalId, tier, String.format("%.3f", slippagePct),
                String.format("%.2f", totalSlippage));

        return true;
    }

    private double computeFullSlippage(Document ob, int quantity) {
        double halfSpread = getDouble(ob, "bidAskSpread") / 2.0;
        double askDepth = getDouble(ob, "avgAskDepth");
        double depthRatio = askDepth > 0 ? quantity / askDepth : 1.0;
        double depthImpact;
        if (depthRatio <= 0.1) depthImpact = halfSpread * depthRatio * 0.5;
        else if (depthRatio <= 1.0) depthImpact = halfSpread * depthRatio;
        else depthImpact = halfSpread * depthRatio * 1.5;

        // Square-root market impact model, capped at 2× halfSpread
        double lambdaCost = Math.min(getDouble(ob, "kyleLambda") * Math.sqrt(quantity), halfSpread * 2);
        return halfSpread + depthImpact + lambdaCost;
    }

    /**
     * Find the nearest orderbook_metrics_1m document within ±2 minutes of target time.
     */
    private Document findNearestOrderbookMetrics(String scripCode, Instant target) {
        Instant windowStart = target.minusSeconds(120);
        Instant windowEnd = target.plusSeconds(120);
        Query query = new Query(Criteria.where("scripCode").is(scripCode)
                .and("timestamp").gte(windowStart).lte(windowEnd))
                .limit(1);
        query.with(org.springframework.data.domain.Sort.by(
                org.springframework.data.domain.Sort.Direction.DESC, "timestamp"));
        return mongoTemplate.findOne(query, Document.class, "orderbook_metrics_1m");
    }

    /**
     * Find the nearest tick_candles_1m document within ±2 minutes of target time.
     */
    private Document findNearestTickCandle(String scripCode, Instant target) {
        Instant windowStart = target.minusSeconds(120);
        Instant windowEnd = target.plusSeconds(120);
        Query query = new Query(Criteria.where("scripCode").is(scripCode)
                .and("timestamp").gte(windowStart).lte(windowEnd))
                .limit(1);
        query.with(org.springframework.data.domain.Sort.by(
                org.springframework.data.domain.Sort.Direction.DESC, "timestamp"));
        return mongoTemplate.findOne(query, Document.class, "tick_candles_1m");
    }

    private Instant parseTime(Object timeObj) {
        if (timeObj == null) return null;
        if (timeObj instanceof java.util.Date d) return d.toInstant();
        try {
            String timeStr = timeObj.toString();
            // Handle ISO_LOCAL_DATE_TIME format (e.g., "2026-03-30T13:26:05")
            LocalDateTime ldt = LocalDateTime.parse(timeStr, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            return ldt.atZone(IST).toInstant();
        } catch (Exception e) {
            try {
                return Instant.parse(timeObj.toString());
            } catch (Exception e2) {
                return null;
            }
        }
    }

    private double getDouble(Document doc, String field) {
        Object val = doc.get(field);
        if (val instanceof Number n) return n.doubleValue();
        return 0;
    }

    private int getInt(Document doc, String field) {
        Object val = doc.get(field);
        if (val instanceof Number n) return n.intValue();
        return 0;
    }

    private double resolveTickSize(String scripCode, String exchange) {
        try {
            Document doc = mongoTemplate.getCollection("scripData")
                    .find(new Document("ScripCode", Integer.parseInt(scripCode)))
                    .first();
            if (doc == null) {
                doc = mongoTemplate.getCollection("scripData")
                        .find(new Document("ScripCode", scripCode))
                        .first();
            }
            if (doc != null) {
                Object ts = doc.get("TickSize");
                if (ts != null) {
                    double tick = Double.parseDouble(ts.toString());
                    if (tick > 0) return tick;
                }
            }
        } catch (Exception e) {
            // fall through to defaults
        }
        // Exchange defaults
        if ("M".equals(exchange)) return 0.05;
        if ("C".equals(exchange) || "U".equals(exchange)) return 0.0025;
        return 0.05; // NSE
    }
}
