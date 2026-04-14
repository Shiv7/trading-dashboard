package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import com.kotsin.dashboard.hotstocks.data.FivePaisaHistoryClient;
import com.kotsin.dashboard.hotstocks.data.MarketPulseRedisClient;
import com.kotsin.dashboard.hotstocks.model.CorporateEvent;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksRanker;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Tier 2: scans the NSE 500 non-F&O equity universe at EOD (17:45 IST), scoring
 * stocks with the v2 engine and flagging next-day subscription candidates.
 *
 * Rationale: Tier 2 picks are chosen purely from EOD signals (bulk/block deals,
 * daily candles, delivery). We scan AFTER close so data is clean and we don't
 * impact the realtime options pipeline during market hours.
 *
 * Flagged picks are written to Redis key {@code hotstocks:next-day-subscription:{date}}
 * so ScripFinder / OptionProducer can subscribe them at the pre-market slot.
 */
@Component
@Slf4j
public class HotStocksNonFnoScanJob {

    private static final String NEXT_DAY_SUB_KEY = "hotstocks:next-day-subscription:";

    private final HotStocksService service;
    private final HotStocksRanker ranker;
    private final FivePaisaHistoryClient historyClient;
    private final MarketPulseRedisClient marketPulseClient;
    private final MongoTemplate mongo;
    private final StringRedisTemplate redis;

    @Value("${hotstocks.nonfno.topN:10}")
    private int topN;

    @Value("${hotstocks.nonfno.scan.enabled:true}")
    private boolean enabled;

    @Autowired
    public HotStocksNonFnoScanJob(HotStocksService service,
                                   HotStocksRanker ranker,
                                   FivePaisaHistoryClient historyClient,
                                   MarketPulseRedisClient marketPulseClient,
                                   MongoTemplate mongo,
                                   StringRedisTemplate redis) {
        this.service = service;
        this.ranker = ranker;
        this.historyClient = historyClient;
        this.marketPulseClient = marketPulseClient;
        this.mongo = mongo;
        this.redis = redis;
    }

    /**
     * Runs at 17:45 IST on weekdays — 2h 15m after NSE close (15:30). Gives
     * enough buffer for FastAnalytics to publish the day's bulk/block deals
     * and delivery data.
     */
    @Scheduled(cron = "0 45 17 * * MON-FRI", zone = "Asia/Kolkata")
    public void run() {
        if (!enabled) { log.info("[HS-NONFNO-SCAN] disabled by flag"); return; }
        long start = System.currentTimeMillis();
        log.info("[HS-NONFNO-SCAN] starting");
        try {
            List<ScripInfo> universe = loadNonFnoEquityUniverse();
            log.info("[HS-NONFNO-SCAN] universe size={}", universe.size());
            if (universe.isEmpty()) return;

            List<String> scripCodes = universe.stream().map(s -> s.scripCode).toList();
            Map<String, List<DailyCandle>> candleMap = historyClient.fetchBulk(
                "N", "C", scripCodes,
                LocalDate.now().minusYears(1), LocalDate.now());

            List<MarketPulseRedisClient.Deal> allDeals = marketPulseClient.fetchDeals(
                LocalDate.now().minusDays(10), LocalDate.now());
            Map<String, List<MarketPulseRedisClient.Deal>> dealsBySymbol = allDeals.stream()
                .collect(Collectors.groupingBy(MarketPulseRedisClient.Deal::symbol));
            List<CorporateEvent> events = marketPulseClient.fetchCorporateEvents();
            Map<String, List<CorporateEvent>> eventsBySymbol = events.stream()
                .collect(Collectors.groupingBy(CorporateEvent::getSymbol));
            Map<String, Double> deliveryBySymbol = marketPulseClient.fetchDeliveryBySymbol();

            List<StockMetrics> computed = new ArrayList<>();
            int skipped = 0;
            for (ScripInfo info : universe) {
                try {
                    List<DailyCandle> candles = candleMap.get(info.scripCode);
                    if (candles == null || candles.size() < 60) { skipped++; continue; }
                    StockMetrics m = service.computeFromInputs(
                        info.scripCode, info.symbol, false,
                        candles, deliveryBySymbol.get(info.symbol),
                        0.0, 0.0, null,
                        dealsBySymbol.getOrDefault(info.symbol, List.of()),
                        eventsBySymbol.getOrDefault(info.symbol, List.of()));
                    ranker.enrichWithV2Score(m);
                    computed.add(m);
                    service.cache(m);
                } catch (Exception e) {
                    skipped++;
                    log.debug("[HS-NONFNO-SCAN] skip {}: {}", info.symbol, e.getMessage());
                }
            }

            // Top-N non-F&O picks + write next-day subscription list
            List<StockMetrics> top = ranker.rank(computed, topN, /*fnoOnly=*/false);
            String dayKey = LocalDate.now().plusDays(1).toString();
            String redisKey = NEXT_DAY_SUB_KEY + dayKey;
            List<String> picks = top.stream().map(StockMetrics::getScripCode).toList();
            if (!picks.isEmpty()) {
                redis.opsForValue().set(redisKey, String.join(",", picks));
                // 24h expiry — consumed by pre-market subscription job tomorrow
                redis.expire(redisKey, java.time.Duration.ofHours(24));
            }

            long ms = System.currentTimeMillis() - start;
            log.info("[HS-NONFNO-SCAN] complete: scanned={} scored={} top={} redis={} ms={}",
                universe.size(), computed.size(), top.size(), redisKey, ms);
            top.forEach(s -> log.info("[HS-NONFNO-SCAN] pick sym={} score={} net={}Cr",
                s.getSymbol(), s.getV2Score(),
                s.getV2NetInstitutionalCr() != null ? String.format("%+.0f", s.getV2NetInstitutionalCr()) : "?"));
        } catch (Exception e) {
            log.error("[HS-NONFNO-SCAN] failed", e);
        }
    }

    /**
     * Non-F&O universe = symbols with recent bulk/block deal activity over the
     * past 10 sessions that are NOT in the F&O universe. ScripGroup is curated
     * to F&O-only today; so our non-F&O source is deal-activity-driven.
     *
     * We resolve each symbol to a scripCode via two paths:
     *   1. ScripGroup by companyName (unlikely to hit for non-F&O)
     *   2. `nseEquityMetadata` collection if present (future hook)
     *
     * Symbols without a resolvable scripCode are logged and skipped — can't
     * fetch candles or trade them without one.
     */
    private List<ScripInfo> loadNonFnoEquityUniverse() {
        // Collect all F&O scripCodes to EXCLUDE
        Query fnoQ = new Query(Criteria.where("tradingType").is("EQUITY")
            .and("futures.0").exists(true));
        java.util.Set<String> fnoScripCodes = new java.util.HashSet<>();
        java.util.Set<String> fnoSymbols = new java.util.HashSet<>();
        for (Document d : mongo.find(fnoQ, Document.class, "ScripGroup")) {
            Object id = d.get("_id");
            if (id != null) fnoScripCodes.add(id.toString());
            String n = d.getString("companyName");
            if (n != null) fnoSymbols.add(n.trim().toUpperCase());
        }

        // Pull symbols with recent deal activity
        List<MarketPulseRedisClient.Deal> recentDeals = marketPulseClient.fetchDeals(
            LocalDate.now().minusDays(10), LocalDate.now());
        java.util.Set<String> dealSymbols = new java.util.HashSet<>();
        for (MarketPulseRedisClient.Deal d : recentDeals) {
            if (d.symbol() != null) dealSymbols.add(d.symbol().trim().toUpperCase());
        }

        // Non-F&O candidates = deal symbols minus F&O symbols
        List<ScripInfo> out = new ArrayList<>();
        int skippedNoScripCode = 0;
        for (String sym : dealSymbols) {
            if (fnoSymbols.contains(sym)) continue; // exclude F&O — handled by Tier 1
            // Resolve scripCode via ScripGroup (some may exist with tradingType!=EQUITY)
            Document doc = mongo.findOne(
                new Query(Criteria.where("companyName").is(sym)), Document.class, "ScripGroup");
            if (doc == null || doc.get("_id") == null) { skippedNoScripCode++; continue; }
            String scripCode = doc.get("_id").toString();
            if (fnoScripCodes.contains(scripCode)) continue;
            out.add(new ScripInfo(scripCode, sym));
        }
        if (skippedNoScripCode > 0) {
            log.info("[HS-NONFNO-SCAN] {} deal-symbols had no ScripGroup match (not tradable)", skippedNoScripCode);
        }
        return out;
    }

    private record ScripInfo(String scripCode, String symbol) {}
}
