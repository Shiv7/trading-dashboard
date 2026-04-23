package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class HotStocksPositionGateTest {

    private StringRedisTemplate redis;
    private HotStocksPositionGate gate;

    @BeforeEach
    void setUp() {
        redis = mock(StringRedisTemplate.class);
        gate = new HotStocksPositionGate(redis);
    }

    @Test
    void mayOpen_trueWhenNotHeld() {
        StockMetrics m = new StockMetrics();
        m.setScripCode("4684");
        m.setAlreadyHeld(false);
        m.setHasNewDealToday(false);
        assertTrue(gate.mayOpen(m));
    }

    @Test
    void mayOpen_trueWhenHeldButFreshDealToday() {
        StockMetrics m = new StockMetrics();
        m.setScripCode("4684");
        m.setAlreadyHeld(true);
        m.setHasNewDealToday(true);
        assertTrue(gate.mayOpen(m), "held + fresh deal → gate passes (opener re-evaluates)");
    }

    @Test
    void mayOpen_falseWhenHeldWithoutFreshDeal() {
        StockMetrics m = new StockMetrics();
        m.setScripCode("4684");
        m.setAlreadyHeld(true);
        m.setHasNewDealToday(false);
        assertFalse(gate.mayOpen(m), "held + no new deal → skip to avoid duplicate entry");
    }

    @Test
    void mayOpen_falseOnNullInput() {
        assertFalse(gate.mayOpen(null), "null metrics → conservative reject");
    }

    @Test
    void fetchHeldScripCodes_stripsPrefix() {
        when(redis.keys(anyString()))
                .thenReturn(Set.of(
                        "virtual:positions:HOTSTOCKS:4684",
                        "virtual:positions:HOTSTOCKS:24445",
                        "virtual:positions:HOTSTOCKS:1000"));
        Set<String> held = gate.fetchHeldScripCodes();
        assertEquals(3, held.size());
        assertTrue(held.contains("4684"));
        assertTrue(held.contains("24445"));
        assertTrue(held.contains("1000"));
        assertFalse(held.stream().anyMatch(k -> k.startsWith("virtual:")),
                "prefix must be stripped");
    }

    @Test
    void fetchHeldScripCodes_emptyOnRedisFailure() {
        when(redis.keys(anyString())).thenThrow(new RuntimeException("down"));
        assertTrue(gate.fetchHeldScripCodes().isEmpty(),
                "Redis failure → empty (permissive, opener retries on its own)");
    }

    @Test
    void fetchHeldScripCodes_emptyWhenNoKeys() {
        when(redis.keys(anyString())).thenReturn(Set.of());
        assertTrue(gate.fetchHeldScripCodes().isEmpty());
    }
}
