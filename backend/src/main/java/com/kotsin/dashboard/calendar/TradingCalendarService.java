package com.kotsin.dashboard.calendar;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

/**
 * Exchange-aware trading calendar — shared canonical implementation across all Kotsin services.
 *
 * Canonical holiday data lives at /home/ubuntu/.shared/holidays/calendar.json.
 * Loaded at @PostConstruct; falls back to embedded constants if JSON is unreadable.
 *
 * Replaces dashboard's previously-divergent NseHolidayCalendar (which had wrong
 * dates: Holi=Mar 4 instead of Mar 3, fake "Good Friday observed Mar 17", missing
 * 6 holidays). NseHolidayCalendar + NseCalendarHelper now delegate here.
 */
@Service
@Slf4j
public class TradingCalendarService {

    private static final String LOG_PREFIX = "[TRADING-CALENDAR]";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${trading.calendar.canonical.path:/home/ubuntu/.shared/holidays/calendar.json}")
    private String canonicalJsonPath;

    private static final Set<LocalDate> NSE_HOLIDAYS_2026_EMBEDDED = Set.of(
        LocalDate.of(2026, 1, 15),
        LocalDate.of(2026, 1, 26),
        LocalDate.of(2026, 3, 3),
        LocalDate.of(2026, 3, 26),
        LocalDate.of(2026, 3, 31),
        LocalDate.of(2026, 4, 3),
        LocalDate.of(2026, 4, 14),
        LocalDate.of(2026, 5, 1),
        LocalDate.of(2026, 5, 28),
        LocalDate.of(2026, 6, 26),
        LocalDate.of(2026, 9, 14),
        LocalDate.of(2026, 10, 2),
        LocalDate.of(2026, 10, 20),
        LocalDate.of(2026, 11, 10),
        LocalDate.of(2026, 11, 24),
        LocalDate.of(2026, 12, 25)
    );

    private static final Set<LocalDate> NSE_HOLIDAYS_2027_EMBEDDED = Set.of(
        LocalDate.of(2027, 1, 26),
        LocalDate.of(2027, 3, 5),
        LocalDate.of(2027, 3, 22),
        LocalDate.of(2027, 3, 26),
        LocalDate.of(2027, 4, 14),
        LocalDate.of(2027, 4, 15),
        LocalDate.of(2027, 4, 20),
        LocalDate.of(2027, 5, 17),
        LocalDate.of(2027, 6, 15),
        LocalDate.of(2027, 8, 15),
        LocalDate.of(2027, 10, 2),
        LocalDate.of(2027, 10, 9),
        LocalDate.of(2027, 10, 29),
        LocalDate.of(2027, 11, 14),
        LocalDate.of(2027, 12, 25)
    );

    private static final Set<LocalDate> MCX_HOLIDAYS_2026_EMBEDDED = Set.of(
        LocalDate.of(2026, 1, 1),
        LocalDate.of(2026, 1, 26),
        LocalDate.of(2026, 4, 3),
        LocalDate.of(2026, 10, 2),
        LocalDate.of(2026, 12, 25)
    );

    private static final Set<LocalDate> MCX_HOLIDAYS_2027_EMBEDDED = Set.of(
        LocalDate.of(2027, 1, 1),
        LocalDate.of(2027, 1, 26),
        LocalDate.of(2027, 3, 26),
        LocalDate.of(2027, 10, 2),
        LocalDate.of(2027, 12, 25)
    );

    // 2026 holiday names — embedded fallback. The JSON overlay supplies authoritative names.
    private static final Map<LocalDate, String> NSE_NAMES_EMBEDDED;
    static {
        Map<LocalDate, String> m = new HashMap<>();
        m.put(LocalDate.of(2026, 1, 15), "Municipal Corporation Election - Maharashtra");
        m.put(LocalDate.of(2026, 1, 26), "Republic Day");
        m.put(LocalDate.of(2026, 3, 3), "Holi");
        m.put(LocalDate.of(2026, 3, 26), "Shri Ram Navami");
        m.put(LocalDate.of(2026, 3, 31), "Shri Mahavir Jayanti");
        m.put(LocalDate.of(2026, 4, 3), "Good Friday");
        m.put(LocalDate.of(2026, 4, 14), "Dr. Baba Saheb Ambedkar Jayanti");
        m.put(LocalDate.of(2026, 5, 1), "Maharashtra Day");
        m.put(LocalDate.of(2026, 5, 28), "Bakri Id");
        m.put(LocalDate.of(2026, 6, 26), "Muharram");
        m.put(LocalDate.of(2026, 9, 14), "Ganesh Chaturthi");
        m.put(LocalDate.of(2026, 10, 2), "Mahatma Gandhi Jayanti");
        m.put(LocalDate.of(2026, 10, 20), "Dussehra");
        m.put(LocalDate.of(2026, 11, 10), "Diwali-Balipratipada");
        m.put(LocalDate.of(2026, 11, 24), "Prakash Gurpurb Sri Guru Nanak Dev");
        m.put(LocalDate.of(2026, 12, 25), "Christmas");
        NSE_NAMES_EMBEDDED = Map.copyOf(m);
    }

    private final Set<LocalDate> nseHolidays = new HashSet<>();
    private final Set<LocalDate> mcxHolidays = new HashSet<>();
    private final Map<LocalDate, String> nseHolidayNames = new HashMap<>();
    private final Map<LocalDate, String> mcxHolidayNames = new HashMap<>();

    {
        nseHolidays.addAll(NSE_HOLIDAYS_2026_EMBEDDED);
        nseHolidays.addAll(NSE_HOLIDAYS_2027_EMBEDDED);
        mcxHolidays.addAll(MCX_HOLIDAYS_2026_EMBEDDED);
        mcxHolidays.addAll(MCX_HOLIDAYS_2027_EMBEDDED);
        nseHolidayNames.putAll(NSE_NAMES_EMBEDDED);
    }

    @PostConstruct
    public void load() {
        boolean jsonLoaded = loadFromCanonicalJson();

        int year = ZonedDateTime.now(IST).getYear();
        long nseForYear = nseHolidays.stream().filter(d -> d.getYear() == year).count();
        if (nseForYear < 10) {
            log.error("ERR {} year={} has only {} NSE holidays loaded", LOG_PREFIX, year, nseForYear);
        }
        log.info("{} loaded — jsonLoaded={} nseTotal={} mcxTotal={} year={} nseForYear={}",
            LOG_PREFIX, jsonLoaded, nseHolidays.size(), mcxHolidays.size(), year, nseForYear);
    }

    private boolean loadFromCanonicalJson() {
        try {
            File f = new File(canonicalJsonPath);
            if (!f.exists() || !f.canRead()) {
                log.warn("{} canonical JSON not readable at {} — using embedded constants only", LOG_PREFIX, canonicalJsonPath);
                return false;
            }
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(f);
            int parsedNse = parseExchangeYears(root.get("nse"), nseHolidays, nseHolidayNames);
            int parsedMcx = parseExchangeYears(root.get("mcx"), mcxHolidays, mcxHolidayNames);
            log.info("{} canonical JSON loaded path={} nseDates={} mcxDates={}",
                LOG_PREFIX, canonicalJsonPath, parsedNse, parsedMcx);
            return true;
        } catch (Exception e) {
            log.error("ERR {} failed to read canonical JSON {}: {}", LOG_PREFIX, canonicalJsonPath, e.getMessage());
            return false;
        }
    }

    private int parseExchangeYears(JsonNode exchNode, Set<LocalDate> dst, Map<LocalDate, String> namesDst) {
        if (exchNode == null) return 0;
        int count = 0;
        Iterator<Map.Entry<String, JsonNode>> years = exchNode.fields();
        while (years.hasNext()) {
            Map.Entry<String, JsonNode> entry = years.next();
            if (entry.getKey().startsWith("_")) continue;
            JsonNode arr = entry.getValue();
            if (!arr.isArray()) continue;
            for (JsonNode item : arr) {
                String dateStr = item.path("date").asText(null);
                String name = item.path("name").asText("");
                if (dateStr == null) continue;
                try {
                    LocalDate d = LocalDate.parse(dateStr);
                    dst.add(d);
                    namesDst.put(d, name);
                    count++;
                } catch (Exception ignore) { }
            }
        }
        return count;
    }

    public boolean isHoliday(LocalDate date, String exchange) {
        if (date == null) return false;
        if ("M".equals(exchange)) return mcxHolidays.contains(date);
        return nseHolidays.contains(date);
    }

    public boolean isHoliday(LocalDate date) {
        return isHoliday(date, "N");
    }

    public String holidayName(LocalDate date, String exchange) {
        if (date == null) return null;
        if ("M".equals(exchange)) return mcxHolidayNames.get(date);
        return nseHolidayNames.get(date);
    }

    public String holidayName(LocalDate date) {
        return holidayName(date, "N");
    }

    public boolean isWeekend(LocalDate date) {
        if (date == null) return false;
        DayOfWeek dow = date.getDayOfWeek();
        return dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY;
    }

    public boolean isTradingDay(LocalDate date, String exchange) {
        return date != null && !isWeekend(date) && !isHoliday(date, exchange);
    }

    public boolean isTradingDay(LocalDate date) {
        return isTradingDay(date, "N");
    }

    /** Trading days strictly after {@code from}, up to and including {@code to}. */
    public int countTradingDays(LocalDate from, LocalDate to, String exchange) {
        if (from == null || to == null || !to.isAfter(from)) return 0;
        int count = 0;
        LocalDate d = from.plusDays(1);
        while (!d.isAfter(to)) {
            if (isTradingDay(d, exchange)) count++;
            d = d.plusDays(1);
        }
        return count;
    }

    public int countTradingDays(LocalDate from, LocalDate to) {
        return countTradingDays(from, to, "N");
    }

    public LocalDate getPreviousTradingDay(LocalDate date, String exchange) {
        if (date == null) return null;
        LocalDate result = date.minusDays(1);
        while (!isTradingDay(result, exchange)) {
            result = result.minusDays(1);
        }
        return result;
    }

    public LocalDate getPreviousTradingDay(LocalDate date) {
        return getPreviousTradingDay(date, "N");
    }
}
