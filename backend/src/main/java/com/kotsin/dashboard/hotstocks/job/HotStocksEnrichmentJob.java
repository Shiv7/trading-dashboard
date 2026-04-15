package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.data.FivePaisaHistoryClient;
import com.kotsin.dashboard.hotstocks.data.MarketPulseRedisClient;
import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import com.kotsin.dashboard.hotstocks.model.CorporateEvent;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksRanker;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import com.kotsin.dashboard.hotstocks.service.RecommendationHistoryService;
import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Daily 05:45 IST job that rebuilds the Hot Stocks universe:
 *  1. Loads the F&O universe from MongoDB ScripGroup (derives fnoEligible from futures.length)
 *  2. Bulk-fetches 1-year daily candles from 5paisa (via FastAnalytics)
 *  3. Reads pre-populated market-pulse data from Redis (deals, events, delivery bySymbol)
 *  4. Composes per-stock enriched StockMetrics via HotStocksService
 *  5. Ranks top 6 F&O and caches to Redis for the frontend + position opener
 *
 * Runs Monday–Friday only (markets closed on weekends).
 */
@Component
public class HotStocksEnrichmentJob {
    private static final Logger log = LoggerFactory.getLogger(HotStocksEnrichmentJob.class);
    private static final String NIFTY_SCRIP_CODE = "999920000";
    private static final int DEAL_LOOKBACK_DAYS = 10;

    private final HotStocksService service;
    private final HotStocksRanker ranker;
    private final FivePaisaHistoryClient historyClient;
    private final MarketPulseRedisClient marketPulseClient;
    private final MongoTemplate mongo;
    private final RecommendationHistoryService recommendationHistoryService;
    private final com.kotsin.dashboard.hotstocks.service.OiSeriesProvider oiSeriesProvider;

    public HotStocksEnrichmentJob(HotStocksService service,
                                  HotStocksRanker ranker,
                                  FivePaisaHistoryClient historyClient,
                                  MarketPulseRedisClient marketPulseClient,
                                  MongoTemplate mongo,
                                  RecommendationHistoryService recommendationHistoryService,
                                  com.kotsin.dashboard.hotstocks.service.OiSeriesProvider oiSeriesProvider) {
        this.service = service;
        this.ranker = ranker;
        this.historyClient = historyClient;
        this.marketPulseClient = marketPulseClient;
        this.mongo = mongo;
        this.recommendationHistoryService = recommendationHistoryService;
        this.oiSeriesProvider = oiSeriesProvider;
    }

    @Scheduled(cron = "0 45 5 * * MON-FRI", zone = "Asia/Kolkata")
    public void run() {
        long start = System.currentTimeMillis();
        log.info("HotStocksEnrichmentJob starting");
        try {
            List<ScripInfo> universe = loadFnoUniverse();
            log.info("HotStocksEnrichmentJob: F&O universe size={}", universe.size());
            if (universe.isEmpty()) {
                log.warn("HotStocksEnrichmentJob: empty universe, aborting");
                return;
            }

            List<String> scripCodes = universe.stream().map(s -> s.scripCode).toList();

            // Step 1: bulk-fetch candles (1 year of 1D history)
            Map<String, List<DailyCandle>> candleMap = historyClient.fetchBulk(
                "N", "C", scripCodes,
                LocalDate.now().minusYears(1), LocalDate.now());
            log.info("HotStocksEnrichmentJob: fetched candles for {}/{} scrips",
                candleMap.size(), scripCodes.size());

            // Step 2: load market-pulse data from Redis (populated by FastAnalytics)
            LocalDate dealFrom = LocalDate.now().minusDays(DEAL_LOOKBACK_DAYS);
            LocalDate dealTo = LocalDate.now();
            List<MarketPulseRedisClient.Deal> allDeals = marketPulseClient.fetchDeals(dealFrom, dealTo);
            Map<String, List<MarketPulseRedisClient.Deal>> dealsBySymbol = allDeals.stream()
                .collect(Collectors.groupingBy(MarketPulseRedisClient.Deal::symbol));

            List<CorporateEvent> allEvents = marketPulseClient.fetchCorporateEvents();
            Map<String, List<CorporateEvent>> eventsBySymbol = allEvents.stream()
                .collect(Collectors.groupingBy(CorporateEvent::getSymbol));

            Map<String, Double> deliveryBySymbol = marketPulseClient.fetchDeliveryBySymbol();

            // Smart-money hedging indicators (2026-04-15):
            //  - Short-interest delta: recent 5-day sum vs prior 5-day sum
            //  - (Per-symbol PCR delta populated below per-stock via OiSeriesProvider)
            Map<String, Double> shortInterestDelta = marketPulseClient.fetchShortInterestDelta5d();
            log.info("HotStocksEnrichmentJob: short-interest symbols with delta data = {}", shortInterestDelta.size());

            // Step 3: Nifty benchmark 5d return
            double nifty5d = benchmark5d(NIFTY_SCRIP_CODE);
            log.info("HotStocksEnrichmentJob: deals={}, events={}, delivery_symbols={}, nifty5d={}",
                allDeals.size(), allEvents.size(), deliveryBySymbol.size(), String.format("%.2f%%", nifty5d));

            // Step 4: compute per-stock StockMetrics
            List<StockMetrics> computed = new ArrayList<>();
            int failed = 0;
            for (ScripInfo info : universe) {
                try {
                    List<DailyCandle> candles = candleMap.get(info.scripCode);
                    if (candles == null || candles.size() < 60) {
                        // PriceFactsComputer needs >= 60 candles for trend state — skip stocks
                        // with insufficient history (newly listed)
                        continue;
                    }
                    Double deliveryPct = deliveryBySymbol.get(info.symbol);
                    List<MarketPulseRedisClient.Deal> deals = dealsBySymbol.getOrDefault(info.symbol, List.of());
                    List<CorporateEvent> events = eventsBySymbol.getOrDefault(info.symbol, List.of());

                    StockMetrics m = service.computeFromInputs(
                        info.scripCode, info.symbol, info.fnoEligible,
                        candles, deliveryPct,
                        /*sector5dPct=*/ 0.0,  // TODO Phase 1b: per-sector index 5d return
                        nifty5d,
                        /*oiChange5d=*/ null,  // TODO Phase 1b: load from oi_metrics_1m
                        deals, events);
                    // Smart-money hedging populate: short-interest delta (from Redis)
                    // and PCR 5d delta (from options OI aggregation). Both nullable —
                    // null when data absent (non-F&O, new listing, or thin OI history).
                    Double siDelta = shortInterestDelta.get(info.symbol);
                    if (siDelta != null) m.setShortInterestDelta5d(siDelta);
                    if (info.fnoEligible) {
                        java.util.Optional<Double> pcrDelta = oiSeriesProvider.fivePcrDeltaTrend(info.symbol);
                        pcrDelta.ifPresent(m::setPcrDelta5d);
                    }
                    service.cache(m);
                    computed.add(m);
                } catch (Exception e) {
                    failed++;
                    log.warn("HotStocksEnrichmentJob: failed to compute {} ({}): {}",
                        info.symbol, info.scripCode, e.getMessage());
                }
            }

            // Step 5: rank and cache top list
            // Cache a wider pool (20 F&O) so the 09:15 opener can advance past
            // already-held names via dedup and still reach MAX_NEW_PER_DAY=6 fresh
            // entries. UI + refresh job cap display at 6 via stream.limit(6).
            // (2026-04-15: previously hard-capped at 6 — caused under-opening on
            //  days with overlap between today's ranked list and existing holdings.)
            List<StockMetrics> top6Fno = ranker.rank(computed, 20, true);
            service.cacheRankedList(top6Fno);

            // Task 8 wiring: record each recommended scripCode into the 10-day rolling
            // history so the dashboard card can render a "Recommended Nx in last 10d" badge.
            LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
            for (StockMetrics m : top6Fno) {
                recommendationHistoryService.record(m.getScripCode(), today);
            }

            long elapsed = System.currentTimeMillis() - start;
            log.info("HotStocksEnrichmentJob complete: {} computed, {} failed, {} ranked, elapsed={}ms",
                computed.size(), failed, top6Fno.size(), elapsed);
        } catch (Exception e) {
            log.error("HotStocksEnrichmentJob failed", e);
        }
    }

    /** In-memory record of one F&O stock's basic identity (scrip+symbol+fno flag). */
    private record ScripInfo(String scripCode, String symbol, boolean fnoEligible) {}

    /**
     * Loads the F&O-eligible EQUITY universe from ScripGroup.
     * Uses `_id` for scripCode, `companyName` for symbol, and `futures.0` exists
     * to derive fnoEligible.
     */
    private List<ScripInfo> loadFnoUniverse() {
        Query q = new Query(Criteria.where("tradingType").is("EQUITY")
            .and("futures.0").exists(true));
        List<Document> docs = mongo.find(q, Document.class, "ScripGroup");
        List<ScripInfo> out = new ArrayList<>();
        for (Document d : docs) {
            String scripCode = d.get("_id") == null ? null : d.get("_id").toString();
            String symbol = d.getString("companyName");
            if (scripCode == null || symbol == null || symbol.isBlank()) continue;
            out.add(new ScripInfo(scripCode, symbol.trim().toUpperCase(), true));
        }
        return out;
    }

    private double benchmark5d(String scripCode) {
        try {
            Map<String, List<DailyCandle>> map = historyClient.fetchBulk(
                "N", "C", List.of(scripCode),
                LocalDate.now().minusDays(20), LocalDate.now());
            List<DailyCandle> cs = map.get(scripCode);
            if (cs == null || cs.size() < 6) return 0.0;
            double last = cs.get(cs.size() - 1).close();
            double prev = cs.get(cs.size() - 6).close();
            return (last - prev) / prev * 100.0;
        } catch (Exception e) {
            log.warn("HotStocksEnrichmentJob: Nifty benchmark fetch failed: {}", e.getMessage());
            return 0.0;
        }
    }
}
