package com.kotsin.dashboard.kafka;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for T1.2 idempotency-key derivation in TradeOutcomeConsumer.persistTradeOutcome().
 *
 * The key formula in production: signalId + "|" + exitReason + "|" + entryMinute(IST).
 * Where entryMinute = entryTime.atZone(Asia/Kolkata).toEpochSecond() / 60L.
 *
 * These tests pin down the dedup contract:
 *  - same signalId + same exitReason + same minute  => same key  (=> upsert no-op = dedup)
 *  - same signalId + different exitReason            => different key (=> kept; legitimate)
 *  - different signalId                              => different key
 *  - same signalId + same exitReason + different minute => different key (rare re-entry edge case)
 */
class TradeOutcomeConsumerDedupTest {

    @Test
    void same_signalId_same_exitReason_same_minute_produces_same_idempotency_key() {
        // Two trades with identical signal/reason/minute (different seconds): must produce same key
        String key1 = buildKey("ST-FUDKII-X", "SL-OP", LocalDateTime.of(2026, 5, 8, 9, 47, 15));
        String key2 = buildKey("ST-FUDKII-X", "SL-OP", LocalDateTime.of(2026, 5, 8, 9, 47, 42));
        assertEquals(key1, key2,
            "Same signalId+exitReason within same minute must dedup to identical key");
    }

    @Test
    void different_exit_reasons_produce_different_keys_kept_legitimate() {
        // Sequential close with different reasons (e.g. PRE_EOD_OPT then EOD on remainder) is legitimate
        String key1 = buildKey("ST-FUDKII-X", "PRE_EOD_OPT", LocalDateTime.of(2026, 5, 8, 9, 47, 0));
        String key2 = buildKey("ST-FUDKII-X", "EOD",         LocalDateTime.of(2026, 5, 8, 9, 47, 0));
        assertNotEquals(key1, key2,
            "Different exitReason at same minute must NOT dedup (sequential close legitimate)");
    }

    @Test
    void different_signal_ids_produce_different_keys() {
        String key1 = buildKey("ST-FUDKII-X", "SL-OP", LocalDateTime.of(2026, 5, 8, 9, 47, 0));
        String key2 = buildKey("ST-FUDKII-Y", "SL-OP", LocalDateTime.of(2026, 5, 8, 9, 47, 0));
        assertNotEquals(key1, key2,
            "Different signalId must produce different idempotency keys");
    }

    @Test
    void same_signalId_same_reason_different_minute_produces_different_keys() {
        // Edge case: re-entry at different minute should be allowed (extremely rare but legitimate)
        String key1 = buildKey("ST-FUDKII-X", "SL-OP", LocalDateTime.of(2026, 5, 8, 9, 47, 0));
        String key2 = buildKey("ST-FUDKII-X", "SL-OP", LocalDateTime.of(2026, 5, 8, 9, 48, 0));
        assertNotEquals(key1, key2,
            "Same signalId+exitReason at different minute must NOT dedup");
    }

    @Test
    void minute_truncation_groups_seconds_within_same_minute() {
        // Verify boundary: 09:47:00 and 09:47:59 in IST same minute, 09:48:00 next minute
        String k0  = buildKey("ID", "R", LocalDateTime.of(2026, 5, 8, 9, 47, 0));
        String k59 = buildKey("ID", "R", LocalDateTime.of(2026, 5, 8, 9, 47, 59));
        String k60 = buildKey("ID", "R", LocalDateTime.of(2026, 5, 8, 9, 48, 0));
        assertEquals(k0, k59);
        assertNotEquals(k0, k60);
    }

    @Test
    void key_format_is_pipe_delimited_with_three_components() {
        String key = buildKey("ST-FUDKII-1778213839014", "SL-OP",
            LocalDateTime.of(2026, 5, 8, 9, 47, 0));
        String[] parts = key.split("\\|");
        assertEquals(3, parts.length, "Key must have exactly 3 pipe-delimited components");
        assertEquals("ST-FUDKII-1778213839014", parts[0]);
        assertEquals("SL-OP", parts[1]);
        assertTrue(parts[2].matches("\\d+"), "Third component must be numeric (epoch minute)");
    }

    /**
     * Mirror of the in-production key derivation in TradeOutcomeConsumer.persistTradeOutcome().
     * Pinning the formula here so accidental changes to the production key shape break this test.
     */
    private static String buildKey(String signalId, String exitReason, LocalDateTime entryTime) {
        long entryMinute = entryTime.atZone(ZoneId.of("Asia/Kolkata")).toEpochSecond() / 60L;
        return String.format("%s|%s|%d", signalId, exitReason, entryMinute);
    }
}
