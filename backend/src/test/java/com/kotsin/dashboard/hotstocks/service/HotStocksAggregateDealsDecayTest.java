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
 * Unit tests for the time-decay step in HotStocksService.aggregateDeals:
 *   ≤1 day  →  1.00
 *   2-3     →  0.50
 *   4-5     →  0.25
 *   >5      →  0.00  (not in window, NOT in dealsSourceDates)
 */
class HotStocksAggregateDealsDecayTest {

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
        ReflectionTestUtils.setField(svc, "timeDecayEnabled", true);
    }

    private static MarketPulseRedisClient.Deal deal(LocalDate d, String buySell, double valueCr) {
        return new MarketPulseRedisClient.Deal(d, "SYM", "SYM LTD", "CLIENT " + d,
                buySell, 1000L, 100.0, valueCr, /*isBlock*/ false);
    }

    @Test
    void today_fullWeight() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(deal(today, "BUY", 100.0)), today);
        assertEquals(100.0, m.getSmartBuyCr(), 0.001);
        assertEquals(List.of(today.toString()), m.getDealsSourceDates());
        assertTrue(m.isDealsTodayPresent());
    }

    @Test
    void yesterday_fullWeight() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(deal(today.minusDays(1), "BUY", 100.0)), today);
        assertEquals(100.0, m.getSmartBuyCr(), 0.001, "T-1 keeps full weight (NSE publish lag)");
        assertFalse(m.isDealsTodayPresent(), "T-1 only → today's key not populated");
    }

    @Test
    void tMinus3_halfWeight() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(deal(today.minusDays(3), "BUY", 100.0)), today);
        assertEquals(50.0, m.getSmartBuyCr(), 0.001);
    }

    @Test
    void tMinus5_quarterWeight() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(deal(today.minusDays(5), "BUY", 100.0)), today);
        assertEquals(25.0, m.getSmartBuyCr(), 0.001);
    }

    @Test
    void tMinus6_outOfWindow() {
        StockMetrics m = new StockMetrics();
        svc.aggregateDeals(m, List.of(deal(today.minusDays(6), "BUY", 100.0)), today);
        assertEquals(0.0, m.getSmartBuyCr(), 0.001, "T-6 weights to 0");
        assertTrue(m.getDealsSourceDates().isEmpty(),
                "out-of-window dates not stamped in lineage");
    }

    @Test
    void mixedWindow_weightedSumCorrect() {
        StockMetrics m = new StockMetrics();
        // T: 40 (×1.0) + T-2: 40 (×0.5) + T-5: 40 (×0.25) + T-7: 100 (×0)
        svc.aggregateDeals(m, List.of(
                deal(today,              "BUY", 40.0),
                deal(today.minusDays(2), "BUY", 40.0),
                deal(today.minusDays(5), "BUY", 40.0),
                deal(today.minusDays(7), "BUY", 100.0)
        ), today);
        // 40 + 20 + 10 + 0 = 70
        assertEquals(70.0, m.getSmartBuyCr(), 0.001);
        // dealsSourceDates contains exactly the 3 in-window dates
        assertEquals(3, m.getDealsSourceDates().size());
        assertTrue(m.isDealsTodayPresent());
    }

    @Test
    void killSwitch_flatWeight_whenDisabled() {
        ReflectionTestUtils.setField(svc, "timeDecayEnabled", false);
        StockMetrics m = new StockMetrics();
        // Even T-8 counts at full weight when kill-switch OFF.
        svc.aggregateDeals(m, List.of(deal(today.minusDays(8), "BUY", 100.0)), today);
        assertEquals(100.0, m.getSmartBuyCr(), 0.001,
                "kill-switch OFF: every deal carries weight 1.0");
    }
}
