package com.kotsin.dashboard.service;

import com.kotsin.dashboard.calendar.TradingCalendarService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * Dashboard NSE holiday lookup. Used by MarketStateClassifier.
 *
 * Refactored 2026-05-04: delegates to {@link TradingCalendarService} (single source
 * of truth). Previous in-class HOLIDAYS_2026 map had 10 entries with 2 wrong dates
 * (Holi=Mar 4 should be Mar 3; "Good Friday observed" Mar 17 was fabricated) and
 * was missing 6 dates (Ram Navami, Mahavir Jayanti, Ambedkar, Bakri Id, Muharram,
 * Ganesh Chaturthi, Dussehra, Gurpurb). MarketStateClassifier silently
 * mis-classified those dates as trading days.
 */
@Component
public class NseHolidayCalendar {

    private final TradingCalendarService calendar;

    @Autowired
    public NseHolidayCalendar(TradingCalendarService calendar) {
        this.calendar = calendar;
    }

    public boolean isHoliday(LocalDate date) {
        return calendar.isHoliday(date, "N");
    }

    public String holidayName(LocalDate date) {
        return calendar.holidayName(date, "N");
    }
}
