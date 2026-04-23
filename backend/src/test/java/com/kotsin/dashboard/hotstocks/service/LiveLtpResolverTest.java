package com.kotsin.dashboard.hotstocks.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for the live-LTP resolver used by HotStocks opener (2026-04-23 fix).
 *
 * Contract:
 *   resolveEntryPrice(liveLtp, ltpYesterday) →
 *     1. If liveLtp > 0 and not obviously stale → return liveLtp
 *     2. Else if ltpYesterday > 0 → return ltpYesterday (last-resort fallback)
 *     3. Else → throw IllegalStateException (no valid entry price)
 *
 * The pure function is tested here; the Redis read side (key lookup +
 * serialization) is tested via the opener integration in LiveLtpResolver.
 */
class LiveLtpResolverTest {

    @Test
    void usesLiveLtpWhenFresh() {
        double entry = LiveLtpResolver.resolveEntryPrice(404.00, 405.40);
        assertEquals(404.00, entry, 0.0001, "live LTP must be preferred when positive");
    }

    @Test
    void fallsBackToYesterdayWhenLiveZero() {
        double entry = LiveLtpResolver.resolveEntryPrice(0.0, 405.40);
        assertEquals(405.40, entry, 0.0001, "yesterday's close is last resort when live feed missing");
    }

    @Test
    void fallsBackToYesterdayWhenLiveNegative() {
        double entry = LiveLtpResolver.resolveEntryPrice(-1.0, 405.40);
        assertEquals(405.40, entry, 0.0001, "negative live LTP is invalid, fall back");
    }

    @Test
    void throwsWhenBothInvalid() {
        assertThrows(IllegalStateException.class,
            () -> LiveLtpResolver.resolveEntryPrice(0.0, 0.0),
            "no valid price anywhere → must throw");
    }

    @Test
    void throwsWhenBothNegative() {
        assertThrows(IllegalStateException.class,
            () -> LiveLtpResolver.resolveEntryPrice(-1.0, -1.0));
    }

    @Test
    void tinyPositiveLtpIsAccepted() {
        // Options contracts can trade at ₹0.05 — must not be treated as invalid
        double entry = LiveLtpResolver.resolveEntryPrice(0.05, 10.0);
        assertEquals(0.05, entry, 0.0001);
    }

    @Test
    void parseLivePriceString_handlesValidNumber() {
        assertEquals(402.35, LiveLtpResolver.parseLivePrice("402.35").orElse(-1.0), 0.0001);
        assertEquals(0.05,   LiveLtpResolver.parseLivePrice("0.05").orElse(-1.0),   0.0001);
    }

    @Test
    void parseLivePriceString_rejectsInvalid() {
        assertTrue(LiveLtpResolver.parseLivePrice(null).isEmpty());
        assertTrue(LiveLtpResolver.parseLivePrice("").isEmpty());
        assertTrue(LiveLtpResolver.parseLivePrice("   ").isEmpty());
        assertTrue(LiveLtpResolver.parseLivePrice("abc").isEmpty());
        assertTrue(LiveLtpResolver.parseLivePrice("0").isEmpty(), "zero is not a valid price");
        assertTrue(LiveLtpResolver.parseLivePrice("-1.5").isEmpty(), "negative is not a valid price");
    }

    @Test
    void buildPriceKey_nseDefault() {
        assertEquals("price:N:11630", LiveLtpResolver.buildPriceKey("11630", null));
        assertEquals("price:N:11630", LiveLtpResolver.buildPriceKey("11630", ""));
        assertEquals("price:N:11630", LiveLtpResolver.buildPriceKey("11630", "N"));
    }

    @Test
    void buildPriceKey_respectsExchange() {
        assertEquals("price:M:563278", LiveLtpResolver.buildPriceKey("563278", "M"));
        assertEquals("price:C:999", LiveLtpResolver.buildPriceKey("999", "C"));
    }
}
