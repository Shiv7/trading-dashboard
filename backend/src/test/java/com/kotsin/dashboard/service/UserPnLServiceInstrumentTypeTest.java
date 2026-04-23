package com.kotsin.dashboard.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Unit test for {@link UserPnLService#deriveInstrumentType}. This helper tags journal entries
 * with an instrumentType so the frontend can render option qty as "10 LOTS (750 qty)"
 * instead of the confusing raw equity-style "750 QTY".
 */
class UserPnLServiceInstrumentTypeTest {

    @Test
    void optionStrategies_mapToOption() {
        assertEquals("OPTION", UserPnLService.deriveInstrumentType("FUDKII", 75));
        assertEquals("OPTION", UserPnLService.deriveInstrumentType("FUDKOI", 75));
        assertEquals("OPTION", UserPnLService.deriveInstrumentType("FUKAA", 1));
        assertEquals("OPTION", UserPnLService.deriveInstrumentType("MICROALPHA", 1));
        assertEquals("OPTION", UserPnLService.deriveInstrumentType("MERE", 1));
    }

    @Test
    void equityStrategies_mapToEquity() {
        assertEquals("EQUITY", UserPnLService.deriveInstrumentType("HOTSTOCKS", 1));
        assertEquals("EQUITY", UserPnLService.deriveInstrumentType("PIVOT", 1));
        assertEquals("EQUITY", UserPnLService.deriveInstrumentType(null, 1));
    }

    @Test
    void unknownStrategy_fallsBackToLotSize() {
        assertEquals("OPTION", UserPnLService.deriveInstrumentType("UNKNOWN_STRAT", 50));
        assertEquals("EQUITY", UserPnLService.deriveInstrumentType("UNKNOWN_STRAT", 1));
    }

    @Test
    void caseInsensitive() {
        assertEquals("OPTION", UserPnLService.deriveInstrumentType("fudkii", 1));
        assertEquals("OPTION", UserPnLService.deriveInstrumentType("Fudkii", 1));
    }
}
