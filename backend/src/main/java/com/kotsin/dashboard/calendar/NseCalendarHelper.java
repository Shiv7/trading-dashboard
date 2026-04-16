package com.kotsin.dashboard.calendar;

import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Set;

/**
 * NSE trading-day calendar helper.
 *
 * <p>Holiday set kept in sync with {@code tradeExcutionModule.TradingCalendarService.NSE_HOLIDAYS_2026}
 * and {@code streamingcandle.TradingCalendarService}. If you update this list, update those two too.</p>
 *
 * <p>Semantics of {@link #countTradingDays(LocalDate, LocalDate)}: counts trading days STRICTLY AFTER
 * {@code from} up to and including {@code to}. This matches streamingcandle's behavior so holding-period
 * math ("5 trading days since entry") works identically across services.</p>
 */
@Component
public class NseCalendarHelper {

    /**
     * NSE holidays 2026 — morning session (9AM-5PM) closed.
     * All 16 dates where NSE equity/F&O does not trade.
     *
     * Copied verbatim from tradeExcutionModule TradingCalendarService.NSE_HOLIDAYS_2026.
     */
    private static final Set<LocalDate> NSE_HOLIDAYS_2026 = Set.of(
        LocalDate.of(2026, 1, 15),  // Municipal Corporation Election - Maharashtra
        LocalDate.of(2026, 1, 26),  // Republic Day
        LocalDate.of(2026, 3, 3),   // Holi
        LocalDate.of(2026, 3, 26),  // Shri Ram Navami
        LocalDate.of(2026, 3, 31),  // Shri Mahavir Jayanti
        LocalDate.of(2026, 4, 3),   // Good Friday
        LocalDate.of(2026, 4, 14),  // Dr. Baba Saheb Ambedkar Jayanti
        LocalDate.of(2026, 5, 1),   // Maharashtra Day
        LocalDate.of(2026, 5, 28),  // Bakri Id
        LocalDate.of(2026, 6, 26),  // Muharram
        LocalDate.of(2026, 9, 14),  // Ganesh Chaturthi
        LocalDate.of(2026, 10, 2),  // Mahatma Gandhi Jayanti
        LocalDate.of(2026, 10, 20), // Dussehra
        LocalDate.of(2026, 11, 10), // Diwali-Balipratipada
        LocalDate.of(2026, 11, 24), // Prakash Gurpurb Sri Guru Nanak Dev
        LocalDate.of(2026, 12, 25)  // Christmas
    );

    public boolean isTradingDay(LocalDate d) {
        if (d == null) return false;
        DayOfWeek dow = d.getDayOfWeek();
        if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) return false;
        return !NSE_HOLIDAYS_2026.contains(d);
    }

    /** Trading days strictly after {@code from}, up to and including {@code to}. */
    public int countTradingDays(LocalDate from, LocalDate to) {
        if (from == null || to == null || !to.isAfter(from)) return 0;
        int count = 0;
        LocalDate d = from.plusDays(1);
        while (!d.isAfter(to)) {
            if (isTradingDay(d)) count++;
            d = d.plusDays(1);
        }
        return count;
    }
}
