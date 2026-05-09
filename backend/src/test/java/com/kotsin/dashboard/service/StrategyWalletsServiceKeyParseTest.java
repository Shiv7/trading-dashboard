package com.kotsin.dashboard.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * BUG-A5 regression — extractScripCodeFromKey must recover the real scripCode
 * from both legacy and per-strategy Redis key shapes when JSON's scripCode field
 * is missing. Pre-fix, the dashboard left "FUDKII:176923" in the scripCode slot
 * and every downstream lookup (companyName, exchange, lotSize) failed silently.
 */
class StrategyWalletsServiceKeyParseTest {

    @Test
    void perStrategyKey_returnsScripCodeOnly() {
        assertEquals("176923",
                StrategyWalletsService.extractScripCodeFromKey("virtual:positions:FUDKII:176923"));
        assertEquals("11630",
                StrategyWalletsService.extractScripCodeFromKey("virtual:positions:HOTSTOCKS:11630"));
        assertEquals("80712",
                StrategyWalletsService.extractScripCodeFromKey("virtual:positions:MICROALPHA:80712"));
    }

    @Test
    void legacyKey_returnsScripCodeOnly() {
        assertEquals("438",
                StrategyWalletsService.extractScripCodeFromKey("virtual:positions:438"));
        assertEquals("176923",
                StrategyWalletsService.extractScripCodeFromKey("virtual:positions:176923"));
    }

    @Test
    void unrecognizedShapesGetReasonableFallback() {
        // Without the virtual:positions: prefix, still strip the last colon-segment —
        // covers a STRATEGY:scrip-style raw key reasonably and never crashes.
        assertEquals("176923",
                StrategyWalletsService.extractScripCodeFromKey("FUDKII:176923"));
        // No colon → return verbatim.
        assertEquals("plain",
                StrategyWalletsService.extractScripCodeFromKey("plain"));
    }

    @Test
    void nullKey_returnsNull() {
        assertNull(StrategyWalletsService.extractScripCodeFromKey(null));
    }
}
