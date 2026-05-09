package com.kotsin.dashboard.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * BUG-A2 — verifies the lightweight JSON updatedAt extractor used by
 * PositionBroadcastService to avoid a full Jackson parse on every poll cycle.
 * The extractor must be tolerant of field ordering and whitespace, and must
 * return null on malformed input so the broadcaster never crashes the loop.
 */
class PositionBroadcastServiceTest {

    @Test
    void extractsUpdatedAt_simple() {
        String json = "{\"scripCode\":\"176923\",\"updatedAt\":1714780000000,\"qtyOpen\":10}";
        assertEquals(1714780000000L, PositionBroadcastService.extractUpdatedAt(json));
    }

    @Test
    void extractsUpdatedAt_withWhitespace() {
        String json = "{\"updatedAt\" :  1714780123456 }";
        assertEquals(1714780123456L, PositionBroadcastService.extractUpdatedAt(json));
    }

    @Test
    void extractsUpdatedAt_lateField() {
        String json = "{\"a\":1,\"b\":2,\"c\":\"foo\",\"updatedAt\":999}";
        assertEquals(999L, PositionBroadcastService.extractUpdatedAt(json));
    }

    @Test
    void noField_returnsNull() {
        assertNull(PositionBroadcastService.extractUpdatedAt("{\"scripCode\":\"X\",\"qty\":1}"));
    }

    @Test
    void nonNumericValue_returnsNull() {
        assertNull(PositionBroadcastService.extractUpdatedAt("{\"updatedAt\":\"oops\"}"));
    }

    @Test
    void emptyString_returnsNull() {
        assertNull(PositionBroadcastService.extractUpdatedAt(""));
    }

    @Test
    void scripFromPerStrategyKey() {
        assertEquals("176923",
                PositionBroadcastService.extractScripCodeFromKey("virtual:positions:FUDKII:176923"));
    }

    @Test
    void scripFromLegacyKey() {
        assertEquals("438",
                PositionBroadcastService.extractScripCodeFromKey("virtual:positions:438"));
    }

    @Test
    void scripFromUnknownShape_stripsLastColon() {
        // Without the virtual:positions: prefix, last-colon split still recovers a
        // sensible scripCode for STRATEGY:scrip-style raw keys.
        assertEquals("176923",
                PositionBroadcastService.extractScripCodeFromKey("FUDKII:176923"));
    }
}
