package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksScoringEngine.FlowInput;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the 4 new clamps added 2026-04-15 night:
 *   SMART_BUY_TAPE_SELL_DIVERGENCE
 *   LOW_DELIVERY_SPECULATION
 *   ROTATION_NOT_ACCUMULATION
 *   PRE_EVENT_BLACKOUT_{TYPE}
 *
 * Each test constructs a minimal StockMetrics + FlowInput that triggers (or
 * deliberately does NOT trigger) exactly one clamp, so failures are surgical.
 */
class HotStocksScoringEngineClampsTest {

    // ─── Helpers ────────────────────────────────────────────────────────────
    private static StockMetrics baseMetrics() {
        StockMetrics m = new StockMetrics();
        m.setSymbol("TEST");
        m.setPriceRegime("NEUTRAL");
        m.setChange1dPct(0.0);
        m.setChange5dPct(0.0);
        m.setChange20dPct(0.0);
        m.setWeekly52PositionPct(50.0);
        m.setVolumeRegime("NORMAL");
        m.setSmartBuyClients(new ArrayList<>());
        m.setSmartSellClients(new ArrayList<>());
        return m;
    }

    private static List<String> runClamps(int startScore, StockMetrics m, FlowInput flow) {
        List<String> clamps = new ArrayList<>();
        HotStocksScoringEngine.applyClamps(startScore, m, flow, clamps);
        return clamps;
    }

    // ─── SMART_BUY_TAPE_SELL_DIVERGENCE ─────────────────────────────────────

    @Test
    void divergence_fires_whenSmartBuysAloneButNetStronglyNegative() {
        // DELHIVERY-style: Nippon+Edelweiss+ICICI buy 302 Cr, no smart sellers,
        // tape aggregate is -259 Cr (sellCr > buyCr but less than 2×).
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(302.0);
        m.setSmartSellCr(0.0);
        FlowInput flow = new FlowInput(732.6, 991.7, 3);  // net = -259

        List<String> clamps = runClamps(20, m, flow);
        assertTrue(clamps.contains("SMART_BUY_TAPE_SELL_DIVERGENCE"),
            "expected divergence clamp to fire on DELHIVERY-style setup; got=" + clamps);
    }

    @Test
    void divergence_doesNotFire_whenNetSlightlyNegative() {
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(50.0);
        m.setSmartSellCr(0.0);
        FlowInput flow = new FlowInput(100.0, 150.0, 2);  // net = -50 (above threshold)

        List<String> clamps = runClamps(20, m, flow);
        assertFalse(clamps.contains("SMART_BUY_TAPE_SELL_DIVERGENCE"));
    }

    @Test
    void divergence_doesNotFire_whenBothSmartAndTapeNegative() {
        // Clear distribution — DISTRIBUTION clamp may handle this; divergence
        // clamp should not ALSO fire.
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(0.0);
        m.setSmartSellCr(100.0);
        FlowInput flow = new FlowInput(50.0, 200.0, 3);

        List<String> clamps = runClamps(20, m, flow);
        assertFalse(clamps.contains("SMART_BUY_TAPE_SELL_DIVERGENCE"));
    }

    // ─── LOW_DELIVERY_SPECULATION ───────────────────────────────────────────

    @Test
    void lowDelivery_fires_whenBullishScoreBackedByLowDelivery() {
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(30.0);
        m.setDeliveryPctLatest(18.0);  // speculative territory
        FlowInput flow = new FlowInput(30.0, 0.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertTrue(clamps.contains("LOW_DELIVERY_SPECULATION"));
    }

    @Test
    void lowDelivery_doesNotFire_whenDeliveryHealthy() {
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(30.0);
        m.setDeliveryPctLatest(55.0);  // strong
        FlowInput flow = new FlowInput(30.0, 0.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertFalse(clamps.contains("LOW_DELIVERY_SPECULATION"));
    }

    @Test
    void lowDelivery_doesNotFire_whenScoreAlreadyNegative() {
        // Don't punish bearish signals with LOW_DELIVERY (meaningless)
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(30.0);
        m.setDeliveryPctLatest(18.0);
        FlowInput flow = new FlowInput(30.0, 0.0, 1);

        List<String> clamps = runClamps(-20, m, flow);
        assertFalse(clamps.contains("LOW_DELIVERY_SPECULATION"));
    }

    @Test
    void lowDelivery_doesNotFire_whenDeliveryPctIsZero_unreported() {
        // deliveryPctLatest=0 may mean "not reported" not actually zero
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(30.0);
        m.setDeliveryPctLatest(0.0);
        FlowInput flow = new FlowInput(30.0, 0.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertFalse(clamps.contains("LOW_DELIVERY_SPECULATION"));
    }

    // ─── ROTATION_NOT_ACCUMULATION ──────────────────────────────────────────

    @Test
    void rotation_fires_whenSameClientOnBothSides() {
        StockMetrics m = baseMetrics();
        m.setSmartBuyClients(List.of("NIPPON INDIA MUTUAL FUND", "ICICI PRUDENTIAL"));
        m.setSmartSellClients(List.of("EDELWEISS MUTUAL FUND", "NIPPON INDIA MUTUAL FUND"));
        FlowInput flow = new FlowInput(100.0, 80.0, 3);

        List<String> clamps = runClamps(25, m, flow);
        assertTrue(clamps.contains("ROTATION_NOT_ACCUMULATION"));
    }

    @Test
    void rotation_doesNotFire_whenDisjoint() {
        StockMetrics m = baseMetrics();
        m.setSmartBuyClients(List.of("NIPPON", "ICICI"));
        m.setSmartSellClients(List.of("EDELWEISS", "HDFC"));
        FlowInput flow = new FlowInput(100.0, 80.0, 3);

        List<String> clamps = runClamps(25, m, flow);
        assertFalse(clamps.contains("ROTATION_NOT_ACCUMULATION"));
    }

    @Test
    void rotation_doesNotFire_whenOneSideEmpty() {
        StockMetrics m = baseMetrics();
        m.setSmartBuyClients(List.of("NIPPON"));
        m.setSmartSellClients(new ArrayList<>());  // no sellers at all
        FlowInput flow = new FlowInput(50.0, 0.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertFalse(clamps.contains("ROTATION_NOT_ACCUMULATION"));
    }

    // ─── PRE_EVENT_BLACKOUT ─────────────────────────────────────────────────

    @Test
    void preEvent_fires_whenEarningsIn3Days() {
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(30.0);
        m.setDaysToNearestEvent(3);
        m.setNearestEventType("EARNINGS");
        FlowInput flow = new FlowInput(50.0, 10.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertTrue(clamps.stream().anyMatch(c -> c.startsWith("PRE_EVENT_BLACKOUT_")));
    }

    @Test
    void preEvent_fires_onResults() {
        StockMetrics m = baseMetrics();
        m.setDaysToNearestEvent(1);
        m.setNearestEventType("RESULTS");
        FlowInput flow = new FlowInput(50.0, 10.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertTrue(clamps.contains("PRE_EVENT_BLACKOUT_RESULTS"));
    }

    @Test
    void preEvent_doesNotFire_onDividend() {
        // Dividend/split/bonus are corporate actions, not information events.
        StockMetrics m = baseMetrics();
        m.setDaysToNearestEvent(2);
        m.setNearestEventType("DIVIDEND");
        FlowInput flow = new FlowInput(50.0, 10.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertFalse(clamps.stream().anyMatch(c -> c.startsWith("PRE_EVENT_BLACKOUT_")));
    }

    @Test
    void preEvent_doesNotFire_whenEventBeyond5Days() {
        StockMetrics m = baseMetrics();
        m.setDaysToNearestEvent(7);
        m.setNearestEventType("EARNINGS");
        FlowInput flow = new FlowInput(50.0, 10.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertFalse(clamps.stream().anyMatch(c -> c.startsWith("PRE_EVENT_BLACKOUT_")));
    }

    @Test
    void preEvent_doesNotFire_whenNoEventData() {
        StockMetrics m = baseMetrics();
        // daysToNearestEvent=null, nearestEventType=null
        FlowInput flow = new FlowInput(50.0, 10.0, 1);

        List<String> clamps = runClamps(25, m, flow);
        assertFalse(clamps.stream().anyMatch(c -> c.startsWith("PRE_EVENT_BLACKOUT_")));
    }

    @Test
    void preEvent_doesNotFire_onAlreadyBearishScore() {
        StockMetrics m = baseMetrics();
        m.setDaysToNearestEvent(2);
        m.setNearestEventType("EARNINGS");
        FlowInput flow = new FlowInput(50.0, 10.0, 1);

        List<String> clamps = runClamps(-10, m, flow);
        assertFalse(clamps.stream().anyMatch(c -> c.startsWith("PRE_EVENT_BLACKOUT_")),
            "should not clamp SHORT signals — blackout only suppresses BUY decisions");
    }

    // ─── Integration: DELHIVERY reconstruction ─────────────────────────────

    @Test
    void delhivery_reconstruction_getsMultipleClampsStacked() {
        // Recreate the April 13 DELHIVERY setup:
        //   smartBuy: 302 Cr (Nippon + Edelweiss + ICICI)
        //   smartSell: 0
        //   netCr: -259
        //   delivery: assume LOW (speculative), say 18%
        //   no event, no rotation
        // Expected: DIVERGENCE fires. LOW_DELIVERY fires (if bullish).
        // Together they drop the score by ~35 points.
        StockMetrics m = baseMetrics();
        m.setSmartBuyCr(302.0);
        m.setSmartSellCr(0.0);
        m.setSmartBuyClients(List.of("NIPPON INDIA MUTUAL FUND", "EDELWEISS MUTUAL FUND", "ICICI PRUDENTIAL"));
        m.setSmartSellClients(new ArrayList<>());
        m.setDeliveryPctLatest(18.0);
        FlowInput flow = new FlowInput(732.6, 991.7, 3);

        List<String> clamps = runClamps(25, m, flow);
        assertTrue(clamps.contains("SMART_BUY_TAPE_SELL_DIVERGENCE"), "got=" + clamps);
        assertTrue(clamps.contains("LOW_DELIVERY_SPECULATION"), "got=" + clamps);
        assertFalse(clamps.contains("ROTATION_NOT_ACCUMULATION"));
        assertFalse(clamps.stream().anyMatch(c -> c.startsWith("PRE_EVENT_BLACKOUT_")));
    }
}
