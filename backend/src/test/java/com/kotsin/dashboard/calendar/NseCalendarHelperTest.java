package com.kotsin.dashboard.calendar;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies NseCalendarHelper delegates to TradingCalendarService correctly.
 *
 * Refactored 2026-05-04 — helper used to own its own holiday set; now it
 * delegates. Tests construct the helper with a real TradingCalendarService.
 */
class NseCalendarHelperTest {

    private NseCalendarHelper helper;

    @BeforeEach
    void setUp() {
        TradingCalendarService cal = new TradingCalendarService();
        // Force embedded-only mode for test determinism.
        ReflectionTestUtils.setField(cal, "canonicalJsonPath", "/tmp/__cal_test_nonexistent.json");
        cal.load();
        helper = new NseCalendarHelper(cal);
    }

    @Test
    void countsBusinessDays_excludingWeekends() {
        // Mon 2026-04-20 (from) exclusive, to Fri 2026-04-24 inclusive
        int n = helper.countTradingDays(LocalDate.of(2026, 4, 20), LocalDate.of(2026, 4, 24));
        assertEquals(4, n);
    }

    @Test
    void excludesWeekendsFromRange() {
        int n = helper.countTradingDays(LocalDate.of(2026, 4, 17), LocalDate.of(2026, 4, 20));
        assertEquals(1, n);
    }

    @Test
    void returnsZero_whenFromEqualsTo() {
        int n = helper.countTradingDays(LocalDate.of(2026, 4, 15), LocalDate.of(2026, 4, 15));
        assertEquals(0, n);
    }

    @Test
    void returnsZero_whenToIsBeforeFrom() {
        int n = helper.countTradingDays(LocalDate.of(2026, 4, 20), LocalDate.of(2026, 4, 15));
        assertEquals(0, n);
    }

    @Test
    void returnsZero_whenEitherIsNull() {
        assertEquals(0, helper.countTradingDays(null, LocalDate.of(2026, 4, 15)));
        assertEquals(0, helper.countTradingDays(LocalDate.of(2026, 4, 15), null));
        assertEquals(0, helper.countTradingDays(null, null));
    }

    @Test
    void isTradingDay_trueForMondayToFriday_falseForWeekend() {
        assertTrue(helper.isTradingDay(LocalDate.of(2026, 4, 13)));   // Mon
        assertTrue(helper.isTradingDay(LocalDate.of(2026, 4, 17)));   // Fri
        assertFalse(helper.isTradingDay(LocalDate.of(2026, 4, 18))); // Sat
        assertFalse(helper.isTradingDay(LocalDate.of(2026, 4, 19))); // Sun
    }

    @Test
    void isTradingDay_falseForKnownNseHoliday() {
        assertFalse(helper.isTradingDay(LocalDate.of(2026, 5, 1)));
    }

    @Test
    void countTradingDays_excludesMidWeekHoliday() {
        // from Mon 2026-04-27 (exclusive) to Mon 2026-05-04 (inclusive)
        // Candidates: Tue 28, Wed 29, Thu 30, Fri 01 (HOLIDAY), Mon 04 = 4 trading days
        int n = helper.countTradingDays(LocalDate.of(2026, 4, 27), LocalDate.of(2026, 5, 4));
        assertEquals(4, n);
    }
}
