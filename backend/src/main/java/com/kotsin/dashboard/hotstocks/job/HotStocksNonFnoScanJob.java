package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import com.kotsin.dashboard.hotstocks.data.BhavcopyRedisClient;
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
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

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
 * Tier-2 picks are ANALYTICAL ONLY — non-F&O equities have no tradable option chain so
 * next-day option subscription is not applicable. The ranked list lives in Redis via
 * {@link HotStocksService#cache(StockMetrics)} for the frontend watchlist.
 */
@Component
@Slf4j
public class HotStocksNonFnoScanJob {

    private final HotStocksService service;
    private final HotStocksRanker ranker;
    private final BhavcopyRedisClient bhavcopyClient;
    private final MarketPulseRedisClient marketPulseClient;
    private final MongoTemplate mongo;

    @Value("${hotstocks.nonfno.topN:10}")
    private int topN;

    @Value("${hotstocks.nonfno.scan.enabled:true}")
    private boolean enabled;

    @Value("${hotstocks.nonfno.min.candles:60}")
    private int minCandles;

    @Autowired
    public HotStocksNonFnoScanJob(HotStocksService service,
                                   HotStocksRanker ranker,
                                   BhavcopyRedisClient bhavcopyClient,
                                   MarketPulseRedisClient marketPulseClient,
                                   MongoTemplate mongo) {
        this.service = service;
        this.ranker = ranker;
        this.bhavcopyClient = bhavcopyClient;
        this.marketPulseClient = marketPulseClient;
        this.mongo = mongo;
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
            List<String> universe = loadNonFnoEquityUniverse();
            log.info("[HS-NONFNO-SCAN] universe size={}", universe.size());
            if (universe.isEmpty()) return;

            Map<String, List<DailyCandle>> candleMap = bhavcopyClient.fetchBulk(universe);
            log.info("[HS-NONFNO-SCAN] bhavcopy candles resolved for {} / {} symbols (min={} required)",
                candleMap.size(), universe.size(), minCandles);

            List<MarketPulseRedisClient.Deal> allDeals = marketPulseClient.fetchDeals(
                java.time.LocalDate.now().minusDays(10), java.time.LocalDate.now());
            Map<String, List<MarketPulseRedisClient.Deal>> dealsBySymbol = allDeals.stream()
                .collect(Collectors.groupingBy(MarketPulseRedisClient.Deal::symbol));
            List<CorporateEvent> events = marketPulseClient.fetchCorporateEvents();
            Map<String, List<CorporateEvent>> eventsBySymbol = events.stream()
                .collect(Collectors.groupingBy(CorporateEvent::getSymbol));
            Map<String, Double> deliveryBySymbol = marketPulseClient.fetchDeliveryBySymbol();

            List<StockMetrics> computed = new ArrayList<>();
            int skippedInsufficient = 0;
            int skippedError = 0;
            for (String symbol : universe) {
                try {
                    List<DailyCandle> candles = candleMap.get(symbol);
                    if (candles == null || candles.size() < minCandles) { skippedInsufficient++; continue; }
                    // scripCode=null: non-F&O has no tradable 5paisa derivative chain. Analytical only.
                    StockMetrics m = service.computeFromInputs(
                        /*scripCode*/ null, symbol, /*fnoEligible*/ false,
                        candles, deliveryBySymbol.get(symbol),
                        0.0, 0.0, null,
                        dealsBySymbol.getOrDefault(symbol, List.of()),
                        eventsBySymbol.getOrDefault(symbol, List.of()));
                    ranker.enrichWithV2Score(m);
                    computed.add(m);
                    service.cache(m);
                } catch (Exception e) {
                    skippedError++;
                    log.debug("[HS-NONFNO-SCAN] skip {}: {}", symbol, e.getMessage());
                }
            }

            List<StockMetrics> top = ranker.rank(computed, topN, /*fnoOnly=*/false);
            long ms = System.currentTimeMillis() - start;
            log.info("[HS-NONFNO-SCAN] complete: universe={} withCandles={} insufficient={} errors={} scored={} top={} ms={}",
                universe.size(), candleMap.size(), skippedInsufficient, skippedError,
                computed.size(), top.size(), ms);
            top.forEach(s -> log.info("[HS-NONFNO-SCAN] pick sym={} score={} net={}Cr",
                s.getSymbol(), s.getV2Score(),
                s.getV2NetInstitutionalCr() != null ? String.format("%+.0f", s.getV2NetInstitutionalCr()) : "?"));
        } catch (Exception e) {
            log.error("[HS-NONFNO-SCAN] failed", e);
        }
    }

    /**
     * Non-F&O universe = symbols with recent bulk/block deal activity over the past 10 sessions
     * that are NOT in the F&O universe. ScripGroup is curated to F&O-only today, so the non-F&O
     * source is deal-activity-driven.
     *
     * Returns bare symbols (uppercased) — no scripCode resolution. Non-F&O equities are scored
     * analytically via NSE bhavcopy, keyed by SYMBOL. No tradable option chain means no need
     * to look up 5paisa scripCodes.
     */
    private List<String> loadNonFnoEquityUniverse() {
        Query fnoQ = new Query(Criteria.where("tradingType").is("EQUITY")
            .and("futures.0").exists(true));
        Set<String> fnoSymbols = new HashSet<>();
        for (Document d : mongo.find(fnoQ, Document.class, "ScripGroup")) {
            String n = d.getString("companyName");
            if (n != null) fnoSymbols.add(n.trim().toUpperCase());
        }

        List<MarketPulseRedisClient.Deal> recentDeals = marketPulseClient.fetchDeals(
            java.time.LocalDate.now().minusDays(10), java.time.LocalDate.now());
        Set<String> dealSymbols = new HashSet<>();
        for (MarketPulseRedisClient.Deal d : recentDeals) {
            if (d.symbol() != null) dealSymbols.add(d.symbol().trim().toUpperCase());
        }

        List<String> out = new ArrayList<>();
        for (String sym : dealSymbols) {
            if (fnoSymbols.contains(sym)) continue;
            out.add(sym);
        }
        return out;
    }
}
