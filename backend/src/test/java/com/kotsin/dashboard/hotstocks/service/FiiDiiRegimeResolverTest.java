package com.kotsin.dashboard.hotstocks.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.service.FiiDiiRegimeResolver.Regime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class FiiDiiRegimeResolverTest {

    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private FiiDiiRegimeResolver resolver;

    @BeforeEach
    void setUp() {
        redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> opsMock = mock(ValueOperations.class);
        ops = opsMock;
        when(redis.opsForValue()).thenReturn(ops);
        resolver = new FiiDiiRegimeResolver(redis, new ObjectMapper());
    }

    // ── Pure classifier ─────────────────────────────────────────────────────

    @Test
    void classify_bothBuy_whenBothAboveThreshold() {
        assertEquals(Regime.BOTH_BUY, resolver.classify(700.0, 600.0));
    }

    @Test
    void classify_bothSell_whenBothBelowNegativeThreshold() {
        assertEquals(Regime.BOTH_SELL, resolver.classify(-800.0, -700.0));
    }

    @Test
    void classify_fiiDiverge_whenFiiStrongBuyDiiStrongSell() {
        assertEquals(Regime.FII_DIVERGE, resolver.classify(700.0, -600.0));
    }

    @Test
    void classify_diiDiverge_whenDiiStrongBuyFiiStrongSell() {
        assertEquals(Regime.DII_DIVERGE, resolver.classify(-600.0, 600.0));
    }

    @Test
    void classify_flat_whenBothBelowThreshold() {
        assertEquals(Regime.FLAT, resolver.classify(200.0, 300.0));
        assertEquals(Regime.FLAT, resolver.classify(-100.0, 250.0));
    }

    @Test
    void classify_flat_onEdgeBelowThreshold() {
        // STRONG_FLOW_CR = 500 — exactly 499 on either side should not qualify.
        assertEquals(Regime.FLAT, resolver.classify(499.0, 499.0));
    }

    // ── Multiplier mapping ──────────────────────────────────────────────────

    @Test
    void multiplier_tailwindForBothBuy() {
        assertEquals(FiiDiiRegimeResolver.MULT_TAILWIND,
                resolver.multiplierFor(Regime.BOTH_BUY), 1e-9);
    }

    @Test
    void multiplier_headwindForBothSell() {
        assertEquals(FiiDiiRegimeResolver.MULT_HEADWIND,
                resolver.multiplierFor(Regime.BOTH_SELL), 1e-9);
    }

    @Test
    void multiplier_neutralForDivergeAndFlat() {
        assertEquals(1.0, resolver.multiplierFor(Regime.FII_DIVERGE), 1e-9);
        assertEquals(1.0, resolver.multiplierFor(Regime.DII_DIVERGE), 1e-9);
        assertEquals(1.0, resolver.multiplierFor(Regime.FLAT), 1e-9);
    }

    // ── Redis resolution ────────────────────────────────────────────────────

    @Test
    void resolveLatest_missingRedis_returnsFlat() {
        when(ops.get(anyString())).thenReturn(null);
        assertEquals(Regime.FLAT, resolver.resolveLatestRegime(),
                "no redis data within lookback → FLAT");
    }

    @Test
    void resolveLatest_readsCurrentDayWhenAvailable() {
        String today = LocalDate.now(ZoneId.of("Asia/Kolkata")).format(DateTimeFormatter.ISO_LOCAL_DATE);
        String json = "{\"FII\":{\"netValue\":700.0},\"DII\":{\"netValue\":800.0}}";
        when(ops.get("market-pulse:fii-dii:" + today)).thenReturn(json);
        assertEquals(Regime.BOTH_BUY, resolver.resolveLatestRegime());
    }

    @Test
    void resolveLatest_parseErrorReturnsFlat() {
        String today = LocalDate.now(ZoneId.of("Asia/Kolkata")).format(DateTimeFormatter.ISO_LOCAL_DATE);
        when(ops.get("market-pulse:fii-dii:" + today)).thenReturn("{ malformed json");
        assertEquals(Regime.FLAT, resolver.resolveLatestRegime(),
                "parse failure must not propagate — FLAT multiplier is safe default");
    }
}
