package com.kotsin.dashboard.service;

import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;

/**
 * Classifies the freshness state of a per-asset last-update timestamp.
 *
 * Categories and their "live" windows (IST):
 *   NSE_SESSION   — 09:15–15:30 IST Mon–Fri (non-holiday): Gift Nifty spot, India VIX, NIFTY spot, Advance/Decline
 *   US_SESSION    — 19:00–01:30 IST Mon–Fri (US regular hours mapped to IST): Dow, S&P, Nasdaq, US VIX, DXY
 *   GLOBAL_24X5   — 24h Mon–Fri: Crude, Brent, Gold, USD/INR
 *
 * A data point is LIVE if the update timestamp is within STALE_THRESHOLD_MIN
 * of "now" and the current wall clock is inside the asset's live window. If the
 * clock is inside the window but the data is older than STALE_THRESHOLD_MIN but
 * within SESSION_STALE_MIN, the state is STALE_SESSION (still in-session but
 * the scraper is lagging). Outside the window → CLOSED_AFTERHRS (or
 * CLOSED_HOLIDAY if today is an NSE holiday). If the data is older than
 * ERROR_THRESHOLD_HOURS across ALL states, return ERROR.
 */
@Component
public class MarketStateClassifier {

    public enum Category { NSE_SESSION, US_SESSION, GLOBAL_24X5 }

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final long STALE_THRESHOLD_MIN = 5;
    private static final long SESSION_STALE_MIN = 15;
    private static final long ERROR_THRESHOLD_HOURS = 48;

    private final NseHolidayCalendar holidays;

    public MarketStateClassifier(NseHolidayCalendar holidays) {
        this.holidays = holidays;
    }

    public MarketState classify(Category cat, long lastUpdateEpochMs) {
        LocalDateTime now = LocalDateTime.now(IST);
        long ageMin = (System.currentTimeMillis() - lastUpdateEpochMs) / 60_000L;
        if (lastUpdateEpochMs <= 0) return MarketState.ERROR;
        if (ageMin > ERROR_THRESHOLD_HOURS * 60) return MarketState.ERROR;

        LocalDate today = now.toLocalDate();
        boolean weekday = now.getDayOfWeek() != DayOfWeek.SATURDAY
                       && now.getDayOfWeek() != DayOfWeek.SUNDAY;
        boolean holiday = weekday && holidays.isHoliday(today);

        switch (cat) {
            case NSE_SESSION:
                return classifyNse(now, ageMin, weekday, holiday);
            case US_SESSION:
                return classifyUs(now, ageMin, weekday, holiday);
            case GLOBAL_24X5:
                return classifyGlobal(now, ageMin, weekday, holiday);
            default:
                return MarketState.ERROR;
        }
    }

    private MarketState classifyNse(LocalDateTime now, long ageMin, boolean weekday, boolean holiday) {
        if (!weekday) return MarketState.CLOSED_AFTERHRS;
        if (holiday) return MarketState.CLOSED_HOLIDAY;
        LocalTime t = now.toLocalTime();
        boolean inSession = !t.isBefore(LocalTime.of(9, 15)) && t.isBefore(LocalTime.of(15, 30));
        if (!inSession) return MarketState.CLOSED_AFTERHRS;
        if (ageMin <= STALE_THRESHOLD_MIN) return MarketState.LIVE;
        if (ageMin <= SESSION_STALE_MIN) return MarketState.STALE_SESSION;
        return MarketState.CLOSED_AFTERHRS;
    }

    private MarketState classifyUs(LocalDateTime now, long ageMin, boolean weekday, boolean holiday) {
        // US regular session 09:30 ET – 16:00 ET ≈ 19:00 IST – 01:30 IST next day.
        // We only mark LIVE during 19:00–23:59 Mon-Fri IST and 00:00–01:30 Tue-Sat IST.
        if (!weekday) return MarketState.CLOSED_AFTERHRS;
        LocalTime t = now.toLocalTime();
        boolean inSession = t.isAfter(LocalTime.of(18, 59)) || t.isBefore(LocalTime.of(1, 30));
        if (!inSession) return MarketState.CLOSED_AFTERHRS;
        if (ageMin <= STALE_THRESHOLD_MIN) return MarketState.LIVE;
        if (ageMin <= SESSION_STALE_MIN) return MarketState.STALE_SESSION;
        return MarketState.CLOSED_AFTERHRS;
    }

    private MarketState classifyGlobal(LocalDateTime now, long ageMin, boolean weekday, boolean holiday) {
        if (!weekday) return MarketState.CLOSED_AFTERHRS;
        if (ageMin <= STALE_THRESHOLD_MIN) return MarketState.LIVE;
        if (ageMin <= SESSION_STALE_MIN) return MarketState.STALE_SESSION;
        return MarketState.CLOSED_AFTERHRS;
    }

    /** Human-readable subtitle text for the UI. */
    public String subtitle(Category cat, MarketState state) {
        LocalDate today = LocalDate.now(IST);
        switch (state) {
            case LIVE: return "";
            case STALE_SESSION: return "lagging — retrying";
            case CLOSED_HOLIDAY:
                String name = holidays.holidayName(today);
                return name != null ? ("NSE holiday: " + name) : "NSE holiday";
            case CLOSED_AFTERHRS:
                return closedSubtitle(cat);
            case ERROR:
                return "no data > 48h";
            default:
                return "";
        }
    }

    private String closedSubtitle(Category cat) {
        LocalDateTime now = LocalDateTime.now(IST);
        DayOfWeek dow = now.getDayOfWeek();
        boolean weekend = dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY;
        switch (cat) {
            case NSE_SESSION:
                if (weekend) return "weekend — reopens Mon 09:15 IST";
                return "after hours — reopens 09:15 IST";
            case US_SESSION:
                if (weekend) return "weekend — US opens Mon 19:00 IST";
                return "US closed — reopens 19:00 IST";
            case GLOBAL_24X5:
                if (weekend) return "weekend — reopens Mon 06:00 IST";
                return "closed";
            default:
                return "closed";
        }
    }
}
