package com.kotsin.dashboard.hotstocks.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.kotsin.dashboard.hotstocks.data.MarketPulseRedisClient;
import com.kotsin.dashboard.hotstocks.data.StrategyCrossReferenceClient;
import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import com.kotsin.dashboard.hotstocks.metrics.DeliveryComputer;
import com.kotsin.dashboard.hotstocks.metrics.OiComputer;
import com.kotsin.dashboard.hotstocks.metrics.PriceFactsComputer;
import com.kotsin.dashboard.hotstocks.metrics.RegimeComputer;
import com.kotsin.dashboard.hotstocks.metrics.RelativeStrengthComputer;
import com.kotsin.dashboard.hotstocks.metrics.VolumeLiquidityComputer;
import com.kotsin.dashboard.hotstocks.model.CorporateEvent;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.narrative.HotStocksNarrator;
import com.kotsin.dashboard.hotstocks.repository.HotStockMetricsDoc;
import com.kotsin.dashboard.hotstocks.repository.HotStockMetricsRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Orchestrator: composes raw inputs (candles, deals, events, delivery%, strategies-watching)
 * into a fully enriched StockMetrics via the metric computers + narrator.
 *
 * Does NOT fetch data here — the caller (HotStocksEnrichmentJob, Section H) passes in
 * already-loaded inputs. This keeps the orchestrator pure-function and easy to unit-test.
 */
@Service
public class HotStocksService {
    private static final Logger log = LoggerFactory.getLogger(HotStocksService.class);
    private static final String REDIS_PREFIX = "hotstocks:v1:";
    // 72h TTL: survives one full cron-failure day. If Monday 05:45 cron fails, opener at
    // 09:15 still has Friday's/Saturday's ranked list as a fallback — stale but usable,
    // since the F&O universe rank doesn't shift dramatically over 2 days.
    private static final Duration REDIS_TTL = Duration.ofHours(72);

    private final PriceFactsComputer priceFactsComputer;
    private final VolumeLiquidityComputer volumeLiquidityComputer;
    private final DeliveryComputer deliveryComputer;
    private final RegimeComputer regimeComputer;
    private final RelativeStrengthComputer rsComputer;
    private final OiComputer oiComputer;
    private final HotStocksNarrator narrator;
    private final SectorMapService sectorMapService;
    private final StrategyCrossReferenceClient strategyClient;
    private final HotStockMetricsRepository repo;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public HotStocksService(PriceFactsComputer priceFactsComputer,
                            VolumeLiquidityComputer volumeLiquidityComputer,
                            DeliveryComputer deliveryComputer,
                            RegimeComputer regimeComputer,
                            RelativeStrengthComputer rsComputer,
                            OiComputer oiComputer,
                            HotStocksNarrator narrator,
                            SectorMapService sectorMapService,
                            StrategyCrossReferenceClient strategyClient,
                            HotStockMetricsRepository repo,
                            StringRedisTemplate redis) {
        this.priceFactsComputer = priceFactsComputer;
        this.volumeLiquidityComputer = volumeLiquidityComputer;
        this.deliveryComputer = deliveryComputer;
        this.regimeComputer = regimeComputer;
        this.rsComputer = rsComputer;
        this.oiComputer = oiComputer;
        this.narrator = narrator;
        this.sectorMapService = sectorMapService;
        this.strategyClient = strategyClient;
        this.repo = repo;
        this.redis = redis;
    }

    /**
     * Composes a fully enriched StockMetrics for one stock.
     *
     * @param scripCode      5paisa scrip code
     * @param symbol         NSE symbol (e.g., "RELIANCE")
     * @param fnoEligible    true if the stock is F&O eligible (derived from ScripGroup.futures.length)
     * @param candles        1D OHLCV candles (from FivePaisaHistoryClient)
     * @param deliveryPct    today's delivery % for this symbol (from MarketPulseRedisClient.fetchDeliveryBySymbol)
     * @param sector5dPct    5-day return of the sector index (0 if unknown)
     * @param nifty5dPct     5-day return of Nifty 50
     * @param oiChange5d     5-day OI change % for F&O stocks, null for cash
     * @param recentDeals    bulk+block deals for this symbol across the deal lookback window
     * @param events         corporate events for this symbol in the next 30 days
     */
    public StockMetrics computeFromInputs(
            String scripCode, String symbol, boolean fnoEligible,
            List<DailyCandle> candles,
            Double deliveryPct,
            double sector5dPct, double nifty5dPct,
            Double oiChange5d,
            List<MarketPulseRedisClient.Deal> recentDeals,
            List<CorporateEvent> events) {

        StockMetrics m = new StockMetrics();
        m.setScripCode(scripCode);
        m.setSymbol(symbol);
        m.setSector(sectorMapService.getSector(symbol));
        m.setFnoEligible(fnoEligible);
        m.setLastUpdatedIst(Instant.now());

        priceFactsComputer.compute(candles, m);
        volumeLiquidityComputer.compute(candles, m);

        // Delivery — compute from single-day value (5-day history not available from FastAnalytics Redis).
        // DeliveryComputer accepts a List<Double>; we pass a single-element list so latest == avg5 ==
        // deliveryPct. Trend defaults to STABLE for len < 3.
        if (deliveryPct != null) {
            deliveryComputer.compute(List.of(deliveryPct), m);
        }

        rsComputer.compute(m, sector5dPct, nifty5dPct);
        regimeComputer.compute(m);
        if (fnoEligible && oiChange5d != null) {
            oiComputer.compute(m, oiChange5d);
        }

        aggregateDeals(m, recentDeals);
        applyEvents(m, events);

        m.setStrategiesWatching(strategyClient.fetchWatchers(scripCode));
        narrator.enrich(m);

        return m;
    }

    private void aggregateDeals(StockMetrics m, List<MarketPulseRedisClient.Deal> deals) {
        if (deals == null || deals.isEmpty()) return;
        double buyCr = 0, sellCr = 0;
        Set<LocalDate> dealDates = new HashSet<>();
        int bulk = 0, block = 0;
        List<String> buyClients = new ArrayList<>();
        List<String> sellClients = new ArrayList<>();
        for (MarketPulseRedisClient.Deal d : deals) {
            double value = d.valueCr();  // pre-computed by FastAnalytics
            if ("BUY".equals(d.buySell())) {
                buyCr += value;
                buyClients.add(d.clientName());
            } else {
                sellCr += value;
                sellClients.add(d.clientName());
            }
            dealDates.add(d.date());
            if (d.isBlock()) block++; else bulk++;
        }
        m.setSmartBuyCr(buyCr);
        m.setSmartSellCr(sellCr);
        m.setDealDays(dealDates.size());
        m.setBulkDealCount(bulk);
        m.setBlockDealCount(block);
        m.setSmartBuyClients(buyClients.stream().distinct().toList());
        m.setSmartSellClients(sellClients.stream().distinct().toList());
        if (buyCr > sellCr * 1.2) m.setDominantFlow("DII_BUY");
        else if (sellCr > buyCr * 1.2) m.setDominantFlow("DII_SELL");
        else m.setDominantFlow("MIXED");
    }

    private void applyEvents(StockMetrics m, List<CorporateEvent> events) {
        if (events == null || events.isEmpty()) return;
        LocalDate today = LocalDate.now();
        List<CorporateEvent> upcoming = new ArrayList<>(events);
        upcoming.sort(Comparator.comparing(CorporateEvent::getEventDate));
        m.setUpcomingEvents(upcoming);

        CorporateEvent nearest = upcoming.get(0);
        int days = (int) Duration.between(today.atStartOfDay(), nearest.getEventDate().atStartOfDay()).toDays();
        m.setDaysToNearestEvent(days);
        m.setNearestEventType(nearest.getEventType());
        m.setEventWithin3Days(days >= 0 && days <= 3);
        for (CorporateEvent e : upcoming) {
            if ("SPLIT".equals(e.getEventType())) {
                m.setHasSplitAnnouncement(true);
                m.setNextCorporateActionLabel(e.getDetail() + " on " + e.getEventDate());
            }
            if ("BONUS".equals(e.getEventType())) m.setHasBonusAnnouncement(true);
            if ("DIVIDEND".equals(e.getEventType()) && days <= 10) m.setHasDividendExDate(true);
        }
    }

    /** Caches a single StockMetrics to Redis + writes a daily snapshot to Mongo. */
    public void cache(StockMetrics m) {
        try {
            String json = mapper.writeValueAsString(m);
            redis.opsForValue().set(REDIS_PREFIX + m.getScripCode(), json, REDIS_TTL);
            repo.save(new HotStockMetricsDoc(m.getScripCode(), LocalDate.now(), m));
        } catch (Exception e) {
            log.error("Failed to cache {}: {}", m.getScripCode(), e.getMessage());
        }
    }

    public Optional<StockMetrics> loadFromCache(String scripCode) {
        String json = redis.opsForValue().get(REDIS_PREFIX + scripCode);
        if (json == null) return Optional.empty();
        try {
            return Optional.of(mapper.readValue(json, StockMetrics.class));
        } catch (Exception e) {
            log.error("Failed to parse cache for {}: {}", scripCode, e.getMessage());
            return Optional.empty();
        }
    }

    public List<StockMetrics> loadRankedList() {
        String json = redis.opsForValue().get(REDIS_PREFIX + "universe");
        if (json == null) return Collections.emptyList();
        try {
            return mapper.readValue(json, new TypeReference<List<StockMetrics>>() {});
        } catch (Exception e) {
            log.error("Failed to parse ranked list: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    public void cacheRankedList(List<StockMetrics> ranked) {
        try {
            redis.opsForValue().set(REDIS_PREFIX + "universe", mapper.writeValueAsString(ranked), REDIS_TTL);
        } catch (Exception e) {
            log.error("Failed to cache ranked list: {}", e.getMessage());
        }
    }
}
