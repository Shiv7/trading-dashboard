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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.TimeUnit;

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

    @Autowired(required = false)
    private ClientQualityClassifier clientQualityClassifier;

    @Autowired(required = false)
    private HotStocksPositionGate positionGate;

    @Value("${hotstocks.aggregate.time.decay.enabled:true}")
    private boolean timeDecayEnabled;

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
        return computeFromInputs(scripCode, symbol, fnoEligible, candles, deliveryPct,
                sector5dPct, nifty5dPct, oiChange5d, recentDeals, events,
                Collections.emptySet());
    }

    /**
     * Overload that accepts the pre-fetched HOTSTOCKS-wallet held scripCodes.
     * The enrichment job calls {@link #fetchActivePositions()} once per run and
     * threads the result here for per-stock stamping — avoids an N-way Redis
     * round-trip in a 200+ scrip universe.
     */
    public StockMetrics computeFromInputs(
            String scripCode, String symbol, boolean fnoEligible,
            List<DailyCandle> candles,
            Double deliveryPct,
            double sector5dPct, double nifty5dPct,
            Double oiChange5d,
            List<MarketPulseRedisClient.Deal> recentDeals,
            List<CorporateEvent> events,
            Set<String> heldScripCodes) {

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

        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        aggregateDeals(m, recentDeals, today);
        stampHoldingsContext(m, heldScripCodes, recentDeals, today);
        applyEvents(m, events);

        m.setStrategiesWatching(strategyClient.fetchWatchers(scripCode));
        narrator.enrich(m);

        return m;
    }

    /**
     * Time-decay weight by calendar-age of the deal date:
     *   ≤1 day   →  1.00  (today or T-1 — NSE publishes T-1 bulk/block deals post-close)
     *   2-3 days →  0.50
     *   4-5 days →  0.25
     *   >5 days  →  0.00  (out of window — deal ignored)
     *
     * Future-dated rows are ignored (negative age). When the kill switch
     * {@code hotstocks.aggregate.time.decay.enabled=false} is set, every deal
     * carries weight 1.0 (pre-2026-04-23 behavior) so we can roll back without
     * a code change if the decay schedule misbehaves.
     */
    double decayWeight(LocalDate dealDate, LocalDate today) {
        if (!timeDecayEnabled) return 1.0;
        if (dealDate == null || today == null) return 0.0;
        long ageDays = ChronoUnit.DAYS.between(dealDate, today);
        if (ageDays < 0) return 0.0;
        if (ageDays <= 1) return 1.00;
        if (ageDays <= 3) return 0.50;
        if (ageDays <= 5) return 0.25;
        return 0.0;
    }

    // Shadow-mode Redis log TTL: 30 days.
    private static final long SHADOW_CLIENT_QUALITY_TTL_SECONDS = 30L * 24 * 60 * 60;

    /**
     * Aggregate bulk + block (+ short-sell, when present) deals into StockMetrics
     * with:
     *   - time-decayed buy/sell sums
     *   - rotation-aware {@code scripDealFlow} label
     *   - {@code conviction} = |net| / gross in [0,1]
     *   - lineage stamps: {@code dealsSourceDates}, {@code dealsTodayPresent}
     *   - shadow client-quality aggregates (SMART/NEUTRAL/SHELL counts and
     *     shadow-weighted buy/sell Cr), plus a per-deal Redis LPUSH audit
     *     trail so we can calibrate weights offline before flipping live.
     *
     * Deals list may include short-selling disclosures (Agent B ships the
     * Redis reader changes). Short-sells arrive with {@code buySell="SELL"}
     * and flow into {@code weightedSellCr} naturally; no special handling.
     */
    void aggregateDeals(StockMetrics m, List<MarketPulseRedisClient.Deal> deals) {
        aggregateDeals(m, deals, LocalDate.now(ZoneId.of("Asia/Kolkata")));
    }

    /** Test-visible overload — callers pin {@code today} for deterministic decay tests. */
    void aggregateDeals(StockMetrics m, List<MarketPulseRedisClient.Deal> deals, LocalDate today) {
        if (deals == null || deals.isEmpty()) {
            m.setScripDealFlow("INSUFFICIENT");
            m.setDominantFlow("MIXED");
            return;
        }
        double buyCr = 0, sellCr = 0;
        Set<LocalDate> dealDates = new HashSet<>();
        Set<LocalDate> contributingDates = new TreeSet<>(Comparator.reverseOrder()); // newest first
        int bulk = 0, block = 0;
        List<String> buyClients = new ArrayList<>();
        List<String> sellClients = new ArrayList<>();
        boolean dealsTodayPresent = false;
        boolean hasNewDealToday = false;

        // Shadow client-quality aggregates
        int smartCount = 0, neutralCount = 0, shellCount = 0;
        double shadowBuyCr = 0.0, shadowSellCr = 0.0;

        for (MarketPulseRedisClient.Deal d : deals) {
            double w = decayWeight(d.date(), today);
            if (w <= 0.0) continue;  // out-of-window; do NOT include in lineage

            double value = d.valueCr();
            double weighted = value * w;
            boolean isBuy = "BUY".equals(d.buySell());

            if (isBuy) {
                buyCr += weighted;
                buyClients.add(d.clientName());
            } else {
                sellCr += weighted;
                sellClients.add(d.clientName());
            }
            dealDates.add(d.date());
            contributingDates.add(d.date());
            if (d.isBlock()) block++; else bulk++;

            // Lineage / freshness stamping
            if (d.date() != null && d.date().equals(today)) {
                dealsTodayPresent = true;
                hasNewDealToday = true;
            }

            // Shadow client-quality tiering (OPT-IN via bean wiring)
            if (clientQualityClassifier != null) {
                ClientQualityClassifier.Tier tier = clientQualityClassifier.classify(d.clientName());
                double tierWeight = clientQualityClassifier.shadowWeightFor(tier);
                switch (tier) {
                    case SMART -> smartCount++;
                    case SHELL -> shellCount++;
                    default    -> neutralCount++;
                }
                double shadowWeighted = weighted * tierWeight;
                if (isBuy) shadowBuyCr += shadowWeighted; else shadowSellCr += shadowWeighted;
                logShadowClientQuality(m.getScripCode(), d, tier, value, today);
            }
        }

        m.setSmartBuyCr(buyCr);
        m.setSmartSellCr(sellCr);
        m.setDealDays(dealDates.size());
        m.setBulkDealCount(bulk);
        m.setBlockDealCount(block);
        m.setSmartBuyClients(buyClients.stream().distinct().toList());
        m.setSmartSellClients(sellClients.stream().distinct().toList());

        // Conviction + scripDealFlow labeling (rotation-aware)
        double net = buyCr - sellCr;
        double gross = buyCr + sellCr;
        double conviction = gross > 0 ? Math.abs(net) / gross : 0.0;
        m.setConviction(conviction);

        String scripDealFlow;
        // Threshold expressed in INR units (5 Cr). Gross/net here are in Cr already.
        if (gross < 5.0) scripDealFlow = "INSUFFICIENT";
        else if (conviction < 0.30) scripDealFlow = "ROTATION";
        else if (net > 0) scripDealFlow = "DEAL_NET_BUY";
        else scripDealFlow = "DEAL_NET_SELL";
        m.setScripDealFlow(scripDealFlow);

        // Back-compat dominantFlow — keep a best-effort legacy mapping so old
        // UIs don't break until they switch to scripDealFlow.
        if (scripDealFlow.equals("DEAL_NET_BUY")) m.setDominantFlow("DII_BUY");
        else if (scripDealFlow.equals("DEAL_NET_SELL")) m.setDominantFlow("DII_SELL");
        else m.setDominantFlow("MIXED");

        // Lineage stamps
        List<String> lineage = new ArrayList<>(contributingDates.size());
        for (LocalDate d : contributingDates) lineage.add(d.format(DateTimeFormatter.ISO_LOCAL_DATE));
        m.setDealsSourceDates(lineage);
        m.setDealsTodayPresent(dealsTodayPresent);
        m.setHasNewDealToday(hasNewDealToday);

        // Smart-money-exit flag: a sell-side deal today on a currently-held
        // position is a red flag. alreadyHeld is stamped by the orchestrator
        // (stampHoldingsContext) — evaluated here against the dealsTodayPresent
        // we just computed. If alreadyHeld wasn't set yet (e.g., unit test), we
        // conservatively skip stamping; the orchestrator re-evaluates after held.
        if (m.isAlreadyHeld() && dealsTodayPresent) {
            // Check whether today's deals include any SELL
            for (MarketPulseRedisClient.Deal d : deals) {
                if (today.equals(d.date()) && !"BUY".equals(d.buySell())) {
                    m.setSmartMoneyExit(true);
                    break;
                }
            }
        }

        // Shadow client-quality persistence onto the metric
        m.setShadowSmartClientDeals(smartCount);
        m.setShadowNeutralClientDeals(neutralCount);
        m.setShadowShellClientDeals(shellCount);
        m.setShadowSmartBuyCr(shadowBuyCr);
        m.setShadowSmartSellCr(shadowSellCr);
    }

    /**
     * Bulk-fetch the HOTSTOCKS-wallet held scripCodes once per enrichment run
     * and let the caller pass it into the per-stock {@code stampHoldingsContext}
     * flow. Falls back to an empty set on any Redis issue.
     */
    public Set<String> fetchActivePositions() {
        if (positionGate == null) return Collections.emptySet();
        return positionGate.fetchHeldScripCodes();
    }

    /**
     * Stamp alreadyHeld + smart-money-exit on the metrics row once per
     * enrichment run. Called by the orchestrator AFTER {@code aggregateDeals}
     * because smart-money-exit is the conjunction (held ∧ today-sell), which
     * needs both signals resolved.
     */
    public void stampHoldingsContext(StockMetrics m, Set<String> heldScripCodes,
                                     List<MarketPulseRedisClient.Deal> deals, LocalDate today) {
        if (m == null) return;
        boolean held = m.getScripCode() != null && heldScripCodes != null
                && heldScripCodes.contains(m.getScripCode());
        m.setAlreadyHeld(held);
        if (!held || deals == null || deals.isEmpty()) return;
        for (MarketPulseRedisClient.Deal d : deals) {
            if (today.equals(d.date()) && !"BUY".equals(d.buySell())) {
                m.setSmartMoneyExit(true);
                break;
            }
        }
    }

    private void logShadowClientQuality(String scripCode,
                                        MarketPulseRedisClient.Deal d,
                                        ClientQualityClassifier.Tier tier,
                                        double valueCr,
                                        LocalDate today) {
        try {
            String key = "hotstocks:shadow:client-quality:" + today.format(DateTimeFormatter.ISO_LOCAL_DATE);
            String payload = String.format(
                    "{\"scripCode\":\"%s\",\"clientName\":%s,\"tier\":\"%s\",\"dealValueCr\":%.4f,\"buySell\":\"%s\"}",
                    scripCode == null ? "" : scripCode,
                    mapper.writeValueAsString(d.clientName() == null ? "" : d.clientName()),
                    tier.name(),
                    valueCr,
                    d.buySell() == null ? "" : d.buySell());
            redis.opsForList().leftPush(key, payload);
            redis.expire(key, SHADOW_CLIENT_QUALITY_TTL_SECONDS, TimeUnit.SECONDS);
        } catch (Exception e) {
            log.debug("shadow client-quality log failed for {}: {}", scripCode, e.getMessage());
        }
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

    /**
     * Merged ranked list consumed by {@link com.kotsin.dashboard.hotstocks.job.HotStocksPositionOpenerJob}.
     *
     * Combines the F&O-Tier-1 universe (written at 00:15 IST by enrichment cron) with the
     * non-F&O Tier-2 picks (written at 17:45 IST by {@code HotStocksNonFnoScanJob}).
     *
     * Pre-2026-04-23: only F&O universe was returned → non-F&O picks died in the scan
     * job's log output and never produced trades (zero non-F&O opens across many days).
     *
     * Sort is by v2Score descending so budget allocation in the opener is quality-ordered.
     */
    public List<StockMetrics> loadRankedList() {
        List<StockMetrics> fno = loadList(REDIS_PREFIX + "universe");
        List<StockMetrics> nonFno = loadList(REDIS_PREFIX + "universe:nonfno");
        if (fno.isEmpty() && nonFno.isEmpty()) return Collections.emptyList();
        List<StockMetrics> merged = new ArrayList<>(fno.size() + nonFno.size());
        merged.addAll(fno);
        merged.addAll(nonFno);
        merged.sort((a, b) -> Integer.compare(b.getV2Score(), a.getV2Score()));
        return merged;
    }

    /** Cache the F&O-Tier-1 ranked list (unchanged writer). */
    public void cacheRankedList(List<StockMetrics> ranked) {
        cacheList(REDIS_PREFIX + "universe", ranked);
    }

    /**
     * Cache the non-F&O Tier-2 ranked list (2026-04-23 fix). Written by
     * {@link com.kotsin.dashboard.hotstocks.job.HotStocksNonFnoScanJob} at 17:45 IST.
     * Read by {@link #loadRankedList()} and merged with F&O picks so the opener
     * sees a unified candidate list at 09:15 IST the next day.
     */
    public void cacheNonFnoRankedList(List<StockMetrics> ranked) {
        cacheList(REDIS_PREFIX + "universe:nonfno", ranked);
    }

    private List<StockMetrics> loadList(String key) {
        String json = redis.opsForValue().get(key);
        if (json == null) return Collections.emptyList();
        try {
            return mapper.readValue(json, new TypeReference<List<StockMetrics>>() {});
        } catch (Exception e) {
            log.error("Failed to parse list at {}: {}", key, e.getMessage());
            return Collections.emptyList();
        }
    }

    private void cacheList(String key, List<StockMetrics> ranked) {
        try {
            redis.opsForValue().set(key, mapper.writeValueAsString(ranked), REDIS_TTL);
        } catch (Exception e) {
            log.error("Failed to cache list at {}: {}", key, e.getMessage());
        }
    }
}
