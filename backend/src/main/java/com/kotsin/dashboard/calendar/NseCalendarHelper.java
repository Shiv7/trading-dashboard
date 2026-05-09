package com.kotsin.dashboard.calendar;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * NSE trading-day calendar helper.
 *
 * Refactored 2026-05-04: delegates to {@link TradingCalendarService} (single source
 * of truth, loaded from /home/ubuntu/.shared/holidays/calendar.json). Previously
 * had its own embedded NSE_HOLIDAYS_2026 set that drifted from streamingcandle/tradeExec.
 *
 * <p>Semantics of {@link #countTradingDays(LocalDate, LocalDate)}: counts trading days
 * STRICTLY AFTER {@code from} up to and including {@code to}. This matches
 * streamingcandle's behaviour so holding-period math works identically across services.</p>
 */
@Component
public class NseCalendarHelper {

    private final TradingCalendarService calendar;

    @Autowired
    public NseCalendarHelper(TradingCalendarService calendar) {
        this.calendar = calendar;
    }

    public boolean isTradingDay(LocalDate d) {
        return calendar.isTradingDay(d, "N");
    }

    public int countTradingDays(LocalDate from, LocalDate to) {
        return calendar.countTradingDays(from, to, "N");
    }
}
