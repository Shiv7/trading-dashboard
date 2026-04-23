package com.kotsin.dashboard.healthcheck;

import org.junit.jupiter.api.Test;

import java.time.*;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guard tests for HealthJobRegistry — the tests exist so that a copy-paste
 * mistake (like pointing a "bhavcopy" entry at the "delivery-data" endpoint)
 * gets caught at build time instead of at 09:16 IST on a Monday morning.
 */
class HealthJobRegistryTest {

    // ══════════════════════ Uniqueness + completeness ══════════════════════

    @Test
    void allJobIdsAreUnique() {
        Set<String> seen = new HashSet<>();
        for (HealthJobRegistry.HealthJob job : HealthJobRegistry.JOBS) {
            assertTrue(seen.add(job.id), "Duplicate job id: " + job.id);
        }
    }

    @Test
    void allTriggerEndpointsAreUnique() {
        Set<String> seen = new HashSet<>();
        for (HealthJobRegistry.HealthJob job : HealthJobRegistry.JOBS) {
            if (job.triggerEndpoint == null) continue;
            assertTrue(seen.add(job.triggerEndpoint),
                "Duplicate trigger endpoint: " + job.triggerEndpoint + " (would cause cross-wiring)");
        }
    }

    @Test
    void allRedisKeysAreUnique_perEpochFreshnessSource() {
        Map<String, String> seen = new HashMap<>();
        for (HealthJobRegistry.HealthJob job : HealthJobRegistry.JOBS) {
            if (job.statusSource != HealthJobRegistry.StatusSource.REDIS_EPOCH_FRESHNESS) continue;
            String prior = seen.put(job.statusRedisKey, job.id);
            assertNull(prior, "Two jobs point at the same Redis freshness key: "
                + prior + " and " + job.id + " → one would mask the other's status.");
        }
    }

    // ══════════════════════ Each job's contract is coherent ══════════════════════

    @Test
    void everyJobHasRequiredFields() {
        for (HealthJobRegistry.HealthJob job : HealthJobRegistry.JOBS) {
            assertNotNull(job.id, "null id");
            assertNotNull(job.name, "null name for " + job.id);
            assertNotNull(job.purpose, "null purpose for " + job.id);
            assertNotNull(job.category, "null category for " + job.id);
            assertNotNull(job.serviceName, "null serviceName for " + job.id);
            assertNotNull(job.statusSource, "null statusSource for " + job.id);
            assertNotNull(job.affectedStrategies, "null affectedStrategies for " + job.id);
            assertFalse(job.affectedStrategies.isEmpty(), "empty affectedStrategies for " + job.id);
        }
    }

    @Test
    void redisSourcesHaveRedisKey() {
        for (HealthJobRegistry.HealthJob job : HealthJobRegistry.JOBS) {
            if (job.statusSource == HealthJobRegistry.StatusSource.REDIS_EPOCH_FRESHNESS
             || job.statusSource == HealthJobRegistry.StatusSource.REDIS_DATED_PAYLOAD) {
                assertNotNull(job.statusRedisKey, "REDIS source without key: " + job.id);
                assertFalse(job.statusRedisKey.isBlank());
            }
        }
    }

    @Test
    void epochFreshnessSourcesHaveStaleness() {
        for (HealthJobRegistry.HealthJob job : HealthJobRegistry.JOBS) {
            if (job.statusSource == HealthJobRegistry.StatusSource.REDIS_EPOCH_FRESHNESS) {
                assertTrue(job.stalenessSec > 0,
                    "REDIS_EPOCH_FRESHNESS without stalenessSec: " + job.id);
            }
        }
    }

    @Test
    void logSourcesHaveLogFileAndPattern() {
        for (HealthJobRegistry.HealthJob job : HealthJobRegistry.JOBS) {
            if (job.statusSource == HealthJobRegistry.StatusSource.LOG_PATTERN) {
                assertNotNull(job.logFile, "LOG_PATTERN without file: " + job.id);
                assertNotNull(job.logPattern, "LOG_PATTERN without pattern: " + job.id);
            }
        }
    }

    @Test
    void triggerEndpointsUseKnownServices() {
        Set<String> known = Set.of("fastanalytics", "dashboard");
        for (HealthJobRegistry.HealthJob job : HealthJobRegistry.JOBS) {
            if (job.triggerEndpoint != null) {
                assertTrue(known.contains(job.triggerService),
                    "Unknown trigger service for " + job.id + ": " + job.triggerService);
                assertTrue(job.triggerEndpoint.startsWith("/api/"),
                    "Trigger endpoint must be absolute path: " + job.triggerEndpoint);
            }
        }
    }

    // ══════════════════════ Cross-wiring regression guards ══════════════════════

    @Test
    void bhavcopyTriggerRoutesToBhavcopyEndpoint_notDelivery() {
        HealthJobRegistry.HealthJob bhav = findJob("bhavcopy-ohlcv");
        assertNotNull(bhav);
        assertEquals("/api/market-pulse/bhavcopy-ohlcv/backfill", bhav.triggerEndpoint,
            "bhavcopy job must not point at delivery/corp-events/bulk/block/fii-dii endpoint");
        assertFalse(bhav.triggerEndpoint.contains("delivery"));
        assertFalse(bhav.triggerEndpoint.contains("corporate"));
        assertTrue(bhav.triggerEndpoint.contains("bhavcopy"));
    }

    @Test
    void deliveryTriggerRoutesToDeliveryEndpoint() {
        HealthJobRegistry.HealthJob d = findJob("delivery-data");
        assertNotNull(d);
        assertEquals("/api/market-pulse/refresh/delivery-data", d.triggerEndpoint);
    }

    @Test
    void corpEventsTriggerRoutesToCorpEventsEndpoint() {
        HealthJobRegistry.HealthJob c = findJob("corporate-events");
        assertNotNull(c);
        assertEquals("/api/market-pulse/refresh/corporate-events", c.triggerEndpoint);
    }

    @Test
    void refreshScrapersAllUseCorrectTypeSuffix() {
        // Guard: /refresh/{type} endpoints must end with exactly the job-id's data type,
        // matching FastAnalytics marketPulseController.refresh() switch-case.
        java.util.Map<String, String> expected = java.util.Map.of(
            "block-deals", "/api/market-pulse/refresh/block-deals",
            "bulk-deals", "/api/market-pulse/refresh/bulk-deals",
            "fii-dii", "/api/market-pulse/refresh/fii-dii",
            "corporate-events", "/api/market-pulse/refresh/corporate-events",
            "delivery-data", "/api/market-pulse/refresh/delivery-data"
        );
        for (var e : expected.entrySet()) {
            HealthJobRegistry.HealthJob j = findJob(e.getKey());
            assertNotNull(j);
            assertEquals(e.getValue(), j.triggerEndpoint,
                "Trigger for " + e.getKey() + " must route to " + e.getValue());
        }
    }

    @Test
    void nonFnoScanTriggerRoutesToHotStocksAdminEndpoint() {
        HealthJobRegistry.HealthJob j = findJob("hotstocks-nonfno-scan");
        assertNotNull(j);
        assertEquals("/api/hot-stocks/admin/run-nonfno-scan", j.triggerEndpoint);
        assertEquals("dashboard", j.triggerService);
        assertEquals(HealthJobRegistry.StatusSource.LOG_PATTERN, j.statusSource);
        assertNotNull(j.logFile);
        assertNotNull(j.logPattern);
    }

    @Test
    void shortSellingHasNoTriggerEndpoint() {
        // FastAnalytics scheduler calls fetch_short_selling() internally but exposes no HTTP
        // trigger. Must be null to avoid 404s from the health-check trigger.
        HealthJobRegistry.HealthJob s = findJob("short-selling");
        assertNotNull(s);
        assertNull(s.triggerEndpoint,
            "short-selling has no HTTP trigger endpoint — must remain null");
    }

    @Test
    void hotStocksOpenerCannotBeTriggered() {
        // Trading-day job at 09:15 — should NOT expose a manual trigger
        HealthJobRegistry.HealthJob o = findJob("hotstocks-opener");
        assertNotNull(o);
        assertNull(o.triggerEndpoint,
            "HotStocks opener must NOT be manually triggerable — live trading side-effects");
    }

    @Test
    void eodJobsCannotBeTriggered() {
        for (String id : new String[]{"eod-nse", "eod-mcx"}) {
            HealthJobRegistry.HealthJob j = findJob(id);
            assertNotNull(j);
            assertNull(j.triggerEndpoint,
                "EOD exit jobs must NOT be manually triggerable — would close live positions");
        }
    }

    @Test
    void walletDailyResetCannotBeTriggered() {
        HealthJobRegistry.HealthJob w = findJob("wallet-daily-reset");
        assertNotNull(w);
        assertNull(w.triggerEndpoint,
            "Wallet reset must NOT be manually triggerable — resets circuit breakers and daily limits");
    }

    // ══════════════════════ Schedule math ══════════════════════

    @Test
    void computeNextRun_beforeTodaysTime_returnsToday() {
        HealthJobRegistry.HealthJob job = findJob("wallet-daily-reset"); // fires 08:55 IST
        ZonedDateTime ref = ZonedDateTime.of(
            LocalDate.of(2026, 4, 23), LocalTime.of(7, 0), ZoneId.of("Asia/Kolkata"));
        ZonedDateTime next = HealthJobRegistry.computeNextRun(job, ref);
        assertEquals(LocalDate.of(2026, 4, 23), next.toLocalDate());
        assertEquals(LocalTime.of(8, 55), next.toLocalTime());
    }

    @Test
    void computeNextRun_afterTodaysTime_returnsNextTradingDay() {
        HealthJobRegistry.HealthJob job = findJob("wallet-daily-reset");
        // Friday evening past 08:55
        ZonedDateTime ref = ZonedDateTime.of(
            LocalDate.of(2026, 4, 24), LocalTime.of(22, 0), ZoneId.of("Asia/Kolkata"));
        assertEquals(DayOfWeek.FRIDAY, ref.getDayOfWeek());
        ZonedDateTime next = HealthJobRegistry.computeNextRun(job, ref);
        // Next trading day = Monday 2026-04-27
        assertEquals(DayOfWeek.MONDAY, next.getDayOfWeek());
        assertEquals(LocalDate.of(2026, 4, 27), next.toLocalDate());
        assertEquals(LocalTime.of(8, 55), next.toLocalTime());
    }

    @Test
    void computeNextRun_recurringFeed_returnsNearFuture() {
        HealthJobRegistry.HealthJob job = findJob("global-indices");
        ZonedDateTime ref = ZonedDateTime.now(ZoneId.of("Asia/Kolkata"));
        ZonedDateTime next = HealthJobRegistry.computeNextRun(job, ref);
        // Recurring feed = ref + 1 minute (approximate)
        long deltaSec = next.toEpochSecond() - ref.toEpochSecond();
        assertTrue(deltaSec <= 65, "recurring feed next-run should be near future, was " + deltaSec + "s");
    }

    // ══════════════════════ Affected-strategy coverage ══════════════════════

    @Test
    void everyHotStocksDependencyIsMarkedAffectingHOTSTOCKS() {
        // All bhavcopy / delivery / HotStocks-direct jobs must declare HOTSTOCKS in affectedStrategies
        String[] hsFeeders = {"bhavcopy-ohlcv", "delivery-data", "block-deals", "bulk-deals",
            "short-selling", "hotstocks-enrichment", "hotstocks-nonfno-scan",
            "hotstocks-opener", "hotstocks-kill-switch"};
        for (String id : hsFeeders) {
            HealthJobRegistry.HealthJob job = findJob(id);
            assertNotNull(job, "Missing job: " + id);
            assertTrue(job.affectedStrategies.contains("HOTSTOCKS"),
                job.id + " should declare HOTSTOCKS in affectedStrategies");
        }
    }

    // ──

    private HealthJobRegistry.HealthJob findJob(String id) {
        return HealthJobRegistry.JOBS.stream()
            .filter(j -> j.id.equals(id))
            .findFirst()
            .orElse(null);
    }
}
