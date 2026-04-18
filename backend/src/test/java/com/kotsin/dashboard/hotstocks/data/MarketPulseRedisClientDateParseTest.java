package com.kotsin.dashboard.hotstocks.data;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pins dual-format date parsing for NSE deal rows.
 *
 * NSE's bulk/block deal feed has used two formats over time:
 * <ul>
 *   <li>Legacy CSV era (pre-Apr 2026): {@code 17-APR-2026} — DD-MMM-YYYY uppercased</li>
 *   <li>Modern JSON era (Apr 2026+): {@code 2026-04-17} — ISO yyyy-MM-dd</li>
 * </ul>
 *
 * Before 2026-04-18 the client only accepted the legacy format → every ISO-dated deal
 * silently dropped → HotStocksNonFnoScanJob's universe collapsed to 1 (the one lucky row
 * that still carried the legacy format). Regression coverage prevents that recurrence.
 */
class MarketPulseRedisClientDateParseTest {

    @Test
    void parseDealDate_acceptsIsoFormat() {
        assertEquals(LocalDate.of(2026, 4, 17),
            MarketPulseRedisClient.parseDealDate("2026-04-17"));
    }

    @Test
    void parseDealDate_acceptsLegacyUppercase() {
        assertEquals(LocalDate.of(2026, 4, 17),
            MarketPulseRedisClient.parseDealDate("17-APR-2026"));
    }

    @Test
    void parseDealDate_acceptsLegacyMixedCase() {
        assertEquals(LocalDate.of(2026, 4, 17),
            MarketPulseRedisClient.parseDealDate("17-Apr-2026"));
    }

    @Test
    void parseDealDate_acceptsLegacyLowercase() {
        assertEquals(LocalDate.of(2026, 4, 17),
            MarketPulseRedisClient.parseDealDate("17-apr-2026"));
    }

    @Test
    void parseDealDate_nullBlankReturnNull() {
        assertNull(MarketPulseRedisClient.parseDealDate(null));
        assertNull(MarketPulseRedisClient.parseDealDate(""));
        assertNull(MarketPulseRedisClient.parseDealDate("  "));
    }

    @Test
    void parseDealDate_garbageReturnsNull() {
        assertNull(MarketPulseRedisClient.parseDealDate("not-a-date"));
        assertNull(MarketPulseRedisClient.parseDealDate("2026/04/17"));
        assertNull(MarketPulseRedisClient.parseDealDate("17/04/2026"));
    }
}
