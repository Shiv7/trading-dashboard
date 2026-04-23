package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.data.MarketPulseRedisClient;
import com.kotsin.dashboard.hotstocks.metrics.DeliveryComputer;
import com.kotsin.dashboard.hotstocks.metrics.OiComputer;
import com.kotsin.dashboard.hotstocks.metrics.PriceFactsComputer;
import com.kotsin.dashboard.hotstocks.metrics.RegimeComputer;
import com.kotsin.dashboard.hotstocks.metrics.RelativeStrengthComputer;
import com.kotsin.dashboard.hotstocks.metrics.VolumeLiquidityComputer;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.narrative.HotStocksNarrator;
import com.kotsin.dashboard.hotstocks.repository.HotStockMetricsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/**
 * Rotation-awareness tests — conviction = |net|/gross, scripDealFlow labeling,
 * INSUFFICIENT threshold at gross < 5 Cr.
 */
class HotStocksAggregateDealsRotationTest {

    private HotStocksService svc;
    private final LocalDate today = LocalDate.of(2026, 4, 23);

    @BeforeEach
    void setUp() {
        svc = new HotStocksService(
                mock(PriceFactsComputer.class),
                mock(VolumeLiquidityComputer.class),
                mock(DeliveryComputer.class),
                mock(RegimeComputer.class),
                mock(RelativeStrengthComputer.class),
                mock(OiComputer.class),
                mock(HotStocksNarrator.class),
                mock(SectorMapService.class),
                mock(com.kotsin.dashboard.hotstocks.data.StrategyCrossReferenceClient.class),
                mock(HotStockMetricsRepository.class),
                mock(StringRedisTemplate.class));
        ReflectionTestUtils.setField(svc, "timeDecayEnabled", false); // isolate rotation logic from decay
    }

    private static MarketPulseRedisClient.Deal deal(String buySell, double valueCr, LocalDate d) {
        return new MarketPulseRedisClient.Deal(d, "SYM", "SYM LTD", "C-" + valueCr,
                buySell, 1000L, 100.0, valueCr, /*isBlock*/ false);
    }

    @Test
    void pureConviction_buyOnly() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(deal("BUY", 50.0, today)), today);
        assertEquals(1.0, m.getConviction(), 1e-6, "pure one-sided buy → conviction 1.0");
        assertEquals("DEAL_NET_BUY", m.getScripDealFlow());
    }

    @Test
    void perfectRotation() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(
                deal("BUY", 100.0, today),
                deal("SELL", 100.0, today)
        ), today);
        assertEquals(0.0, m.getConviction(), 1e-6, "equal buy/sell → conviction 0");
        assertEquals("ROTATION", m.getScripDealFlow());
    }

    @Test
    void mixed300Buy250Sell_rotationLabel() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(
                deal("BUY", 300.0, today),
                deal("SELL", 250.0, today)
        ), today);
        assertEquals(50.0 / 550.0, m.getConviction(), 1e-6);
        assertEquals("ROTATION", m.getScripDealFlow(),
                "300 vs 250 → conviction ~0.09 → ROTATION");
    }

    @Test
    void insufficientLabel_whenGrossBelow5Cr() {
        StockMetrics m = new StockMetrics();
        // Total gross = 4 Cr (2 BUY + 2 SELL) — below 5 Cr threshold.
        svc.aggregateDeals(m, List.of(
                deal("BUY", 2.0, today),
                deal("SELL", 2.0, today)
        ), today);
        assertEquals("INSUFFICIENT", m.getScripDealFlow(),
                "below-threshold gross → INSUFFICIENT, regardless of conviction");
    }

    @Test
    void netSellLabel_whenConvictionHighAndSellsDominate() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(
                deal("BUY", 10.0, today),
                deal("SELL", 90.0, today)
        ), today);
        // conviction = 80/100 = 0.8, gross = 100 (above 5 Cr)
        assertEquals("DEAL_NET_SELL", m.getScripDealFlow());
        assertTrue(m.getConviction() >= 0.5);
    }

    @Test
    void noDeals_insufficientLabel() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(), today);
        assertEquals("INSUFFICIENT", m.getScripDealFlow());
    }

    @Test
    void legacyDominantFlow_backCompatMapping() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(deal("BUY", 50.0, today)), today);
        assertEquals("DII_BUY", m.getDominantFlow(),
                "DEAL_NET_BUY maps to legacy DII_BUY for UI back-compat");
    }
}
