package com.kotsin.dashboard.healthcheck;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guards the two-format log parser in {@link HealthCheckService#tailGrep}.
 *
 * Services in this project log in one of two formats:
 *   (a) "yyyy-MM-dd HH:mm:ss.SSS …"   — streamingcandle
 *   (b) "HH:mm:ss.SSS …"              — dashboard backend, trade-exec
 *
 * Format (b) carries no date, so the parser uses the file's last-modified
 * date as the today-gate. The tests below exercise both paths plus the
 * mtime-gate negative case.
 */
class HealthCheckServiceTailGrepTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Test
    void startsWithTimePrefix_detectsHhmmss() {
        assertTrue(HealthCheckService.startsWithTimePrefix("17:45:12.006 INFO [x] foo"));
        assertTrue(HealthCheckService.startsWithTimePrefix("00:00:00 bar"));
    }

    @Test
    void startsWithTimePrefix_rejectsNonTimeLines() {
        assertFalse(HealthCheckService.startsWithTimePrefix("2026-04-22 17:45:12 INFO …"));
        assertFalse(HealthCheckService.startsWithTimePrefix("[INFO] Scanning projects"));
        assertFalse(HealthCheckService.startsWithTimePrefix(""));
        assertFalse(HealthCheckService.startsWithTimePrefix("12:34 short"));
    }

    @Test
    void tailGrep_matchesFullDatePrefix(@TempDir Path dir) throws IOException {
        LocalDate today = ZonedDateTime.now(IST).toLocalDate();
        Path log = dir.resolve("streamingcandle.log");
        Files.write(log, List.of(
            today + " 09:16:00.123 INFO [pool] [FUDKII] complete action=ok",
            "2020-01-01 00:00:00 stale old line"
        ));
        assertTrue(HealthCheckService.tailGrep(log.toString(),
            "\\[FUDKII\\].*complete", today, 100));
    }

    @Test
    void tailGrep_matchesTimeOnlyPrefix_whenLineUtcConvertsToTodayIst(@TempDir Path dir) throws IOException {
        // Dashboard logs write UTC HH:mm:ss. Use "now" UTC so the inferred IST
        // date matches today IST regardless of when the test runs.
        LocalDate today = ZonedDateTime.now(IST).toLocalDate();
        java.time.ZonedDateTime nowUtc = ZonedDateTime.now(java.time.ZoneOffset.UTC);
        String hhmmss = String.format("%02d:%02d:%02d.000",
            nowUtc.getHour(), nowUtc.getMinute(), nowUtc.getSecond());
        Path log = dir.resolve("dashboard.log");
        Files.write(log, List.of(
            hhmmss + " INFO [http-nio] [HS-NONFNO-SCAN] complete: universe=115 withCandles=82 scored=68 top=2"
        ));
        assertTrue(HealthCheckService.tailGrep(log.toString(),
            "HS-NONFNO-SCAN.*complete.*scored=", today, 100));
    }

    @Test
    void tailGrep_rejectsTimeOnlyPrefix_whenFileIsFromYesterday(@TempDir Path dir) throws IOException {
        LocalDate today = ZonedDateTime.now(IST).toLocalDate();
        Path log = dir.resolve("stale-dashboard.log");
        Files.write(log, List.of(
            "17:45:12.006 INFO [http-nio] [HS-NONFNO-SCAN] complete: scored=68"
        ));
        // Force file mtime back 2 days so the today-gate rejects the match.
        long twoDaysAgoMs = System.currentTimeMillis() - 2L * 24 * 3600 * 1000;
        Files.setLastModifiedTime(log, java.nio.file.attribute.FileTime.fromMillis(twoDaysAgoMs));
        assertFalse(HealthCheckService.tailGrep(log.toString(),
            "HS-NONFNO-SCAN.*complete.*scored=", today, 100));
    }

    @Test
    void tailGrep_returnsFalseForMissingFile() throws IOException {
        LocalDate today = ZonedDateTime.now(IST).toLocalDate();
        assertFalse(HealthCheckService.tailGrep("/no/such/path.log",
            "anything", today, 100));
    }

    @Test
    void toIstDate_utcBeforeEightThirty_keepsSameDay() {
        LocalDate utc = LocalDate.of(2026, 4, 22);
        assertEquals(utc, HealthCheckService.toIstDate(utc, "00:05:00"));
        assertEquals(utc, HealthCheckService.toIstDate(utc, "17:00:00"));
        assertEquals(utc, HealthCheckService.toIstDate(utc, "18:29:59"));
    }

    @Test
    void toIstDate_utcAfterEighteenThirty_rollsToNextIstDay() {
        LocalDate utc = LocalDate.of(2026, 4, 22);
        assertEquals(utc.plusDays(1), HealthCheckService.toIstDate(utc, "18:30:00"));
        assertEquals(utc.plusDays(1), HealthCheckService.toIstDate(utc, "23:59:59"));
    }

    @Test
    void computeTimeLineIstDates_inferBackwardFromMtime() {
        // File mtime 2026-04-22 18:47 UTC  →  00:17 IST Apr 23.
        java.time.ZonedDateTime mtime = java.time.ZonedDateTime.of(
            2026, 4, 22, 18, 47, 0, 0, java.time.ZoneOffset.UTC);
        // Log with UTC-timestamped lines spanning across UTC midnight + IST midnight.
        String[] lines = {
            "00:18:38.513 INFO enrichment complete",    // 00:18 UTC Apr 22 = 05:48 IST Apr 22
            "03:45:00.175 INFO opener complete",        // 03:45 UTC Apr 22 = 09:15 IST Apr 22
            "12:56:51.867 INFO nonfno scan complete",   // 12:56 UTC Apr 22 = 18:26 IST Apr 22
            "18:30:00.000 INFO crosses IST midnight",   // 18:30 UTC Apr 22 = 00:00 IST Apr 23
            "18:47:12.728 INFO close to mtime"          // 18:47 UTC Apr 22 = 00:17 IST Apr 23
        };
        LocalDate[] out = HealthCheckService.computeTimeLineIstDates(lines, mtime);
        assertEquals(LocalDate.of(2026, 4, 22), out[0]);  // enrichment is "yesterday" IST
        assertEquals(LocalDate.of(2026, 4, 22), out[1]);
        assertEquals(LocalDate.of(2026, 4, 22), out[2]);
        assertEquals(LocalDate.of(2026, 4, 23), out[3]);  // crosses IST midnight
        assertEquals(LocalDate.of(2026, 4, 23), out[4]);
    }

    @Test
    void computeTimeLineIstDates_acrossUtcMidnight() {
        // File mtime 2026-04-23 02:00 UTC = 07:30 IST Apr 23. Log contains
        // lines from before AND after UTC midnight on Apr 22→23. IST date
        // should correctly account for both boundaries.
        java.time.ZonedDateTime mtime = java.time.ZonedDateTime.of(
            2026, 4, 23, 2, 0, 0, 0, java.time.ZoneOffset.UTC);
        String[] lines = {
            "22:00:00.000 INFO before UTC midnight",   // 22:00 UTC Apr 22 = 03:30 IST Apr 23
            "23:59:59.900 INFO last UTC line of Apr22",// 23:59 UTC Apr 22 = 05:29 IST Apr 23
            "00:00:10.000 INFO first UTC line of Apr23",// 00:00 UTC Apr 23 = 05:30 IST Apr 23
            "01:30:00.000 INFO mid-morning",            // 01:30 UTC Apr 23 = 07:00 IST Apr 23
            "02:00:00.100 INFO at mtime"                // 02:00 UTC Apr 23 = 07:30 IST Apr 23
        };
        LocalDate[] out = HealthCheckService.computeTimeLineIstDates(lines, mtime);
        // All 5 lines fall on IST 2026-04-23 because of IST+5:30 offset.
        for (LocalDate d : out) {
            assertEquals(LocalDate.of(2026, 4, 23), d);
        }
    }

    @Test
    void tailGrep_rejectsTimeOnlyMatch_fromPriorIstDay(@TempDir Path dir) throws IOException {
        // Simulates the post-IST-midnight-scenario: file is actively written
        // past midnight IST, contains yesterday's HotStocks log, but nothing
        // from today IST yet → PENDING is the correct answer.
        LocalDate today = LocalDate.of(2026, 4, 23);
        Path log = dir.resolve("cross-ist-midnight.log");
        Files.write(log, List.of(
            "00:18:38.513 INFO HotStocksEnrichmentJob complete: 217 computed", // Apr 22 IST
            "03:45:00.175 INFO [HOTSTOCKS-OPENER] action=COMPLETE opened=6",    // Apr 22 IST
            "18:47:12.728 INFO just a heartbeat"  // 00:17 IST Apr 23, no match
        ));
        // Force mtime to 2026-04-22 18:47 UTC (= 00:17 IST Apr 23).
        long mtimeMs = java.time.ZonedDateTime.of(
            2026, 4, 22, 18, 47, 0, 0, java.time.ZoneOffset.UTC)
            .toInstant().toEpochMilli();
        Files.setLastModifiedTime(log, java.nio.file.attribute.FileTime.fromMillis(mtimeMs));
        assertFalse(HealthCheckService.tailGrep(log.toString(),
            "HotStocksEnrichmentJob complete:", today, 100));
        assertFalse(HealthCheckService.tailGrep(log.toString(),
            "HOTSTOCKS-OPENER.*action=COMPLETE", today, 100));
    }

    @Test
    void tailGrep_ignoresBlankAndNoPrefixLines(@TempDir Path dir) throws IOException {
        LocalDate today = ZonedDateTime.now(IST).toLocalDate();
        java.time.ZonedDateTime nowUtc = ZonedDateTime.now(java.time.ZoneOffset.UTC);
        String hhmmss = String.format("%02d:%02d:%02d.000",
            nowUtc.getHour(), nowUtc.getMinute(), nowUtc.getSecond());
        Path log = dir.resolve("mixed.log");
        Files.write(log, List.of(
            "",
            "[INFO] Scanning for projects...",
            "--- some divider ---",
            hhmmss + " INFO [x] [HS-NONFNO-SCAN] complete: scored=68"
        ));
        assertTrue(HealthCheckService.tailGrep(log.toString(),
            "HS-NONFNO-SCAN.*complete", today, 100));
    }
}
