package com.kotsin.dashboard.healthcheck;

import com.kotsin.dashboard.healthcheck.HealthCheckService.JobStatus;
import com.kotsin.dashboard.healthcheck.HealthCheckService.Status;
import com.kotsin.dashboard.healthcheck.HealthJobRegistry.HealthJob;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Guards the {@code DATA_KEY_PRESENT} StatusSource added 2026-04-23.
 *
 * <p>Before this fix, the four NSE scraper jobs checked only
 * {@code market-pulse:last-fetch:{feed}} — a timestamp bump that could be FRESH
 * even when the actual per-date key was missing (verified 2026-04-23: last-fetch
 * marker pointed at a valid epoch while {@code market-pulse:block-deals:2026-04-23}
 * was absent → health showed FRESH but HotStocks got zero deals). These tests pin
 * the resolver so the three outcomes stay distinguishable:</p>
 *
 * <ul>
 *   <li>FRESH — ≥1 row</li>
 *   <li>EMPTY_BY_DESIGN — explicit {@code []}</li>
 *   <li>MISSING — key absent</li>
 * </ul>
 */
class HealthCheckDataKeyPresentTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private HealthCheckService svc;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        svc = new HealthCheckService(redis);
    }

    /** Pick the live block-deals job; guarantees we're exercising the real production definition. */
    private HealthJob blockDealsJob() {
        return HealthJobRegistry.JOBS.stream()
            .filter(j -> j.id.equals("block-deals")).findFirst().orElseThrow();
    }

    @Test
    void dataKeyPresent_returnsFresh_whenKeyHasRows() {
        LocalDate latest = HealthJobRegistry.resolveLatestTradingDate(IST);
        String key = "market-pulse:block-deals:" + latest;
        when(ops.get(key)).thenReturn("[{\"symbol\":\"RELIANCE\",\"qty\":100}]");

        List<JobStatus> all = svc.computeAll();
        JobStatus bd = findJob(all, "block-deals");
        assertEquals(Status.FRESH, bd.status, "JSON array with 1+ rows → FRESH");
        assertTrue(bd.statusReason.contains("1 rows"),
            "reason should count rows, got: " + bd.statusReason);
        assertTrue(bd.statusReason.contains(latest.toString()));
    }

    @Test
    void dataKeyPresent_returnsEmptyByDesign_whenKeyIsExplicitEmptyArray() {
        LocalDate latest = HealthJobRegistry.resolveLatestTradingDate(IST);
        String key = "market-pulse:block-deals:" + latest;
        when(ops.get(key)).thenReturn("[]");

        JobStatus bd = findJob(svc.computeAll(), "block-deals");
        assertEquals(Status.EMPTY_BY_DESIGN, bd.status,
            "[] means the scraper confirmed 0 records — not MISSING");
        assertTrue(bd.statusReason.contains("empty array") || bd.statusReason.contains("empty"),
            "reason should explain empty-by-design, got: " + bd.statusReason);
    }

    @Test
    void dataKeyPresent_returnsMissing_whenKeyDoesNotExist() {
        LocalDate latest = HealthJobRegistry.resolveLatestTradingDate(IST);
        String key = "market-pulse:block-deals:" + latest;
        when(ops.get(key)).thenReturn(null);

        JobStatus bd = findJob(svc.computeAll(), "block-deals");
        assertEquals(Status.MISSING, bd.status, "absent key → MISSING, NOT FRESH");
        assertTrue(bd.statusReason.contains("no key") || bd.statusReason.toLowerCase().contains("missing")
                   || bd.statusReason.contains(key),
            "reason should mention the missing key, got: " + bd.statusReason);
    }

    @Test
    void dataKeyPresent_returnsUnknown_whenJsonUnparseable() {
        LocalDate latest = HealthJobRegistry.resolveLatestTradingDate(IST);
        String key = "market-pulse:block-deals:" + latest;
        when(ops.get(key)).thenReturn("{not valid json at all");

        JobStatus bd = findJob(svc.computeAll(), "block-deals");
        assertEquals(Status.UNKNOWN, bd.status, "unparseable JSON → UNKNOWN (not FRESH, not MISSING)");
        assertTrue(bd.statusReason.toLowerCase().contains("unparseable")
            || bd.statusReason.toLowerCase().contains("parse"),
            "reason should mention parse failure, got: " + bd.statusReason);
    }

    @Test
    void resolveLatestTradingDate_skipsWeekend() {
        // Sunday 2026-04-26 → should walk back to Friday 2026-04-24
        LocalDate sunday = LocalDate.of(2026, 4, 26);
        assertEquals(DayOfWeek.SUNDAY, sunday.getDayOfWeek());
        LocalDate resolved = HealthJobRegistry.resolveLatestTradingDate(sunday);
        assertEquals(LocalDate.of(2026, 4, 24), resolved,
            "Sunday → previous Friday");
        assertEquals(DayOfWeek.FRIDAY, resolved.getDayOfWeek());

        LocalDate saturday = LocalDate.of(2026, 4, 25);
        assertEquals(LocalDate.of(2026, 4, 24),
            HealthJobRegistry.resolveLatestTradingDate(saturday),
            "Saturday → previous Friday");
    }

    @Test
    void resolveLatestTradingDate_skipsHoliday_walksBackToTradingDay() {
        // Good Friday 2026-04-03 is a holiday; Thursday 2026-04-02 is a trading day.
        LocalDate goodFriday = LocalDate.of(2026, 4, 3);
        assertEquals(LocalDate.of(2026, 4, 2),
            HealthJobRegistry.resolveLatestTradingDate(goodFriday),
            "Good Friday holiday → previous Thursday");
    }

    @Test
    void resolveLatestTradingDate_tradingDayReturnsItself() {
        // Wednesday 2026-04-22 is a plain trading day.
        LocalDate wed = LocalDate.of(2026, 4, 22);
        assertEquals(wed, HealthJobRegistry.resolveLatestTradingDate(wed));
    }

    @Test
    void dataKeyPresent_worksFor_bulkDeals_shortSelling_too() {
        // All three per-date scraper jobs should behave identically.
        LocalDate latest = HealthJobRegistry.resolveLatestTradingDate(IST);
        when(ops.get("market-pulse:bulk-deals:" + latest))
            .thenReturn("[{\"symbol\":\"X\"}]");
        when(ops.get("market-pulse:short-selling:" + latest))
            .thenReturn("[]");
        when(ops.get("market-pulse:block-deals:" + latest))
            .thenReturn(null);

        List<JobStatus> all = svc.computeAll();
        assertEquals(Status.FRESH, findJob(all, "bulk-deals").status);
        assertEquals(Status.EMPTY_BY_DESIGN, findJob(all, "short-selling").status);
        assertEquals(Status.MISSING, findJob(all, "block-deals").status);
    }

    @Test
    void configuredScraperJobs_useDataKeyPresent_andHaveDataKeyPattern() {
        List<String> expected = List.of("block-deals", "bulk-deals", "short-selling");
        for (String id : expected) {
            HealthJob j = HealthJobRegistry.JOBS.stream()
                .filter(x -> x.id.equals(id)).findFirst().orElseThrow();
            assertEquals(HealthJobRegistry.StatusSource.DATA_KEY_PRESENT, j.statusSource,
                id + " should use DATA_KEY_PRESENT");
            assertNotNull(j.dataKeyPattern, id + " must have dataKeyPattern");
            assertTrue(j.dataKeyPattern.contains("%s"),
                id + " dataKeyPattern should contain %s placeholder");
        }
    }

    private static JobStatus findJob(List<JobStatus> all, String id) {
        return all.stream()
            .filter(j -> j.id.equals(id))
            .findFirst()
            .orElseThrow(() -> new AssertionError("job " + id + " missing from computeAll()"));
    }
}
