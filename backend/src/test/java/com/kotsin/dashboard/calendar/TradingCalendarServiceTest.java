package com.kotsin.dashboard.calendar;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Dashboard's canonical TradingCalendarService — single source of truth for
 * NseCalendarHelper + NseHolidayCalendar (both refactored 2026-05-04 to delegate here).
 */
class TradingCalendarServiceTest {

    private TradingCalendarService svc;

    @BeforeEach
    void setUp() {
        svc = new TradingCalendarService();
        ReflectionTestUtils.setField(svc, "canonicalJsonPath", "/tmp/__cal_test_nonexistent.json");
        svc.load();
    }

    @Test
    void nse2026_correctHolidays_replacesPreviousWrongDates() {
        // The previous NseHolidayCalendar had Holi=Mar 4 (WRONG; real = Mar 3) and a
        // fabricated "Good Friday observed" Mar 17 entry. These regression tests pin
        // the corrected dates.
        assertTrue(svc.isHoliday(LocalDate.of(2026, 3, 3), "N"));    // Holi (correct)
        assertFalse(svc.isHoliday(LocalDate.of(2026, 3, 4), "N"));   // Was wrongly listed
        assertFalse(svc.isHoliday(LocalDate.of(2026, 3, 17), "N"));  // Fake "Good Friday observed"
        assertTrue(svc.isHoliday(LocalDate.of(2026, 4, 3), "N"));    // real Good Friday
    }

    @Test
    void nse2026_previouslyMissingHolidays_nowPresent() {
        // 6 holidays were missing from the old NseHolidayCalendar
        assertTrue(svc.isHoliday(LocalDate.of(2026, 3, 26), "N"));   // Ram Navami
        assertTrue(svc.isHoliday(LocalDate.of(2026, 3, 31), "N"));   // Mahavir Jayanti
        assertTrue(svc.isHoliday(LocalDate.of(2026, 4, 14), "N"));   // Ambedkar
        assertTrue(svc.isHoliday(LocalDate.of(2026, 5, 28), "N"));   // Bakri Id
        assertTrue(svc.isHoliday(LocalDate.of(2026, 6, 26), "N"));   // Muharram
        assertTrue(svc.isHoliday(LocalDate.of(2026, 9, 14), "N"));   // Ganesh Chaturthi
        assertTrue(svc.isHoliday(LocalDate.of(2026, 10, 20), "N"));  // Dussehra
    }

    @Test
    void mcx_jan1_isHoliday() {
        assertTrue(svc.isHoliday(LocalDate.of(2026, 1, 1), "M"));
        assertFalse(svc.isHoliday(LocalDate.of(2026, 1, 1), "N"));
    }

    @Test
    void prevTradingDay_walksMay1() {
        assertEquals(LocalDate.of(2026, 4, 30),
            svc.getPreviousTradingDay(LocalDate.of(2026, 5, 4), "N"));
    }

    @Test
    void holidayName_returnsKnownLabel() {
        // Backward-compat with old NseHolidayCalendar.holidayName(date)
        String name = svc.holidayName(LocalDate.of(2026, 5, 1), "N");
        assertNotNull(name);
        assertTrue(name.toLowerCase().contains("maharashtra"));
    }

    @Test
    void holidayName_nullForTradingDay() {
        assertNull(svc.holidayName(LocalDate.of(2026, 4, 22), "N"));
    }

    @Test
    void nse2027_loaded() {
        assertTrue(svc.isHoliday(LocalDate.of(2027, 1, 26), "N"));
        assertTrue(svc.isHoliday(LocalDate.of(2027, 12, 25), "N"));
    }
}
