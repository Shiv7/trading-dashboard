package com.kotsin.dashboard.service;

import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

/**
 * Hardcoded NSE holiday calendar for 2026. Purposeful simplicity: if holidays
 * shift, update this file and restart. For production-grade use, replace with
 * a scraper of NSE's official calendar page.
 */
@Component
public class NseHolidayCalendar {

    private static final Map<LocalDate, String> HOLIDAYS_2026 = new HashMap<>();

    static {
        // Placeholder list — update with the actual 2026 NSE calendar before production.
        HOLIDAYS_2026.put(LocalDate.of(2026, 1, 26), "Republic Day");
        HOLIDAYS_2026.put(LocalDate.of(2026, 3, 4), "Holi");
        HOLIDAYS_2026.put(LocalDate.of(2026, 3, 17), "Good Friday observed");
        HOLIDAYS_2026.put(LocalDate.of(2026, 4, 3), "Good Friday");
        HOLIDAYS_2026.put(LocalDate.of(2026, 5, 1), "Maharashtra Day");
        HOLIDAYS_2026.put(LocalDate.of(2026, 8, 15), "Independence Day");
        HOLIDAYS_2026.put(LocalDate.of(2026, 10, 2), "Gandhi Jayanti");
        HOLIDAYS_2026.put(LocalDate.of(2026, 11, 9), "Diwali Laxmi Pujan");
        HOLIDAYS_2026.put(LocalDate.of(2026, 11, 10), "Diwali Balipratipada");
        HOLIDAYS_2026.put(LocalDate.of(2026, 12, 25), "Christmas");
    }

    public boolean isHoliday(LocalDate date) {
        return HOLIDAYS_2026.containsKey(date);
    }

    public String holidayName(LocalDate date) {
        return HOLIDAYS_2026.get(date);
    }
}
