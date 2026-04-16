package com.kotsin.dashboard.calendar;

import org.junit.jupiter.api.Test;
import java.time.LocalDate;
import static org.junit.jupiter.api.Assertions.*;

class NseCalendarHelperTest {
    NseCalendarHelper helper = new NseCalendarHelper();

    @Test
    void countsBusinessDays_excludingWeekends() {
        // Mon 2026-04-20 (from) exclusive, to Fri 2026-04-24 inclusive
        // Tue 21, Wed 22, Thu 23, Fri 24 = 4 trading days (none of these are holidays)
        int n = helper.countTradingDays(LocalDate.of(2026, 4, 20), LocalDate.of(2026, 4, 24));
        assertEquals(4, n);
    }

    @Test
    void excludesWeekendsFromRange() {
        // Fri 2026-04-17 (from) exclusive, to Mon 2026-04-20 inclusive
        // Sat, Sun skipped, Mon is trading = 1
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
        // 2026-05-01 = Maharashtra Day — confirmed in NSE_HOLIDAYS_2026
        assertFalse(helper.isTradingDay(LocalDate.of(2026, 5, 1)));
    }

    @Test
    void countTradingDays_excludesMidWeekHoliday() {
        // 2026-05-01 (Friday) = Maharashtra Day holiday
        // from Mon 2026-04-27 (exclusive) to Mon 2026-05-04 (inclusive)
        // Candidates: Tue 28, Wed 29, Thu 30, Fri 01 (HOLIDAY), Mon 04 = 4 trading days
        int n = helper.countTradingDays(LocalDate.of(2026, 4, 27), LocalDate.of(2026, 5, 4));
        assertEquals(4, n);
    }
}
