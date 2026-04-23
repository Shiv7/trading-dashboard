package com.kotsin.dashboard.healthcheck;

import com.kotsin.dashboard.healthcheck.HealthJobRegistry.HealthJob;
import com.kotsin.dashboard.healthcheck.HealthJobRegistry.StatusSource;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.ArrayDeque;

/**
 * Computes live health status for the {@link HealthJobRegistry} inventory.
 *
 * Status semantics per job (resolved for today):
 *   FRESH   — data is confirmed for today's date or the live feed is within staleness window
 *   RETRYING — within the retry window AND not yet fresh (expected transient state)
 *   STALE    — past the retry cutoff without confirmation (actionable failure)
 *   MISSING  — no evidence of a run today (job may not have fired yet — or broken)
 *   PENDING  — job's scheduled time has not arrived today
 *   UNKNOWN  — couldn't resolve (Redis down, log missing)
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class HealthCheckService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final StringRedisTemplate redis;
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${fastanalytics.base-url:http://localhost:8002}")
    private String fastAnalyticsBaseUrl;

    public enum Status { FRESH, RETRYING, STALE, MISSING, PENDING, UNKNOWN }

    public static final class JobStatus {
        public String id;
        public String name;
        public String purpose;
        public String category;
        public String serviceName;
        public String humanSchedule;
        public List<String> affectedStrategies;
        public Status status;
        public String statusReason;
        public Long lastRunEpochMs;
        public Long nextRunEpochMs;
        public boolean canTrigger;
        public String triggerEndpoint;   // relative path the frontend can POST
        public Integer attemptsToday;    // best-effort, may be null
    }

    public List<JobStatus> computeAll() {
        ZonedDateTime now = ZonedDateTime.now(IST);
        LocalDate today = now.toLocalDate();
        List<JobStatus> out = new ArrayList<>();
        for (HealthJob job : HealthJobRegistry.JOBS) {
            out.add(compute(job, now, today));
        }
        return out;
    }

    private JobStatus compute(HealthJob job, ZonedDateTime now, LocalDate today) {
        JobStatus js = new JobStatus();
        js.id = job.id;
        js.name = job.name;
        js.purpose = job.purpose;
        js.category = job.category.name();
        js.serviceName = job.serviceName;
        js.humanSchedule = job.humanSchedule;
        js.affectedStrategies = job.affectedStrategies;
        js.canTrigger = job.triggerEndpoint != null;
        js.triggerEndpoint = job.triggerEndpoint != null
            ? "/api/health-check/trigger/" + job.id : null;
        js.nextRunEpochMs = HealthJobRegistry.computeNextRun(job, now)
            .toInstant().toEpochMilli();

        try {
            switch (job.statusSource) {
                case REDIS_EPOCH_FRESHNESS:
                    resolveFromEpochKey(job, js, now);
                    break;
                case REDIS_DATED_PAYLOAD:
                    resolveFromDatedPayload(job, js, today);
                    break;
                case LOG_PATTERN:
                    resolveFromLog(job, js, today);
                    break;
            }
        } catch (Exception e) {
            js.status = Status.UNKNOWN;
            js.statusReason = "resolve error: " + e.getMessage();
        }
        return js;
    }

    /** REDIS_EPOCH_FRESHNESS: key stores a Unix epoch (seconds or millis).
     *  Status = FRESH if age < stalenessSec; RETRYING/STALE based on retry window.
     */
    private void resolveFromEpochKey(HealthJob job, JobStatus js, ZonedDateTime now) {
        String raw = redis.opsForValue().get(job.statusRedisKey);
        if (raw == null || raw.isBlank()) {
            // Decide PENDING vs MISSING vs STALE by schedule window
            js.status = classifyBeforeFirstRun(job, now);
            js.statusReason = "no data in Redis (" + job.statusRedisKey + ")";
            return;
        }
        long epoch;
        try {
            epoch = Long.parseLong(raw.trim());
            if (epoch < 1_000_000_000_000L) epoch *= 1000; // sec → ms
        } catch (NumberFormatException ex) {
            js.status = Status.UNKNOWN;
            js.statusReason = "unparseable epoch: " + raw;
            return;
        }
        js.lastRunEpochMs = epoch;
        long ageSec = (now.toInstant().toEpochMilli() - epoch) / 1000L;
        if (ageSec < job.stalenessSec) {
            js.status = Status.FRESH;
            js.statusReason = "age " + humanDuration(ageSec);
        } else {
            // Past staleness — is it inside retry window, or past cutoff?
            js.status = classifyBeyondStaleness(job, now, ageSec);
            js.statusReason = "stale by " + humanDuration(ageSec - job.stalenessSec)
                + " past " + humanDuration(job.stalenessSec) + " threshold";
        }
    }

    private void resolveFromDatedPayload(HealthJob job, JobStatus js, LocalDate today) {
        String key = job.statusRedisKey.replace("{{today}}", today.toString());
        String raw = redis.opsForValue().get(key);
        if (raw == null) {
            js.status = Status.STALE;
            js.statusReason = "key absent for today (" + key + ")";
        } else {
            js.status = Status.FRESH;
            js.statusReason = "today's payload present";
        }
    }

    private void resolveFromLog(HealthJob job, JobStatus js, LocalDate today) {
        if (job.logFile == null || job.logPattern == null) {
            js.status = Status.UNKNOWN;
            js.statusReason = "log config incomplete";
            return;
        }
        try {
            // Dashboard nohup.out accumulates ~500k lines / day across restarts;
            // need a big enough window to cover a full IST day.
            boolean matched = tailGrep(job.logFile, job.logPattern, today, 800_000);
            if (matched) {
                js.status = Status.FRESH;
                js.statusReason = "log pattern matched today";
            } else {
                js.status = today.atTime(java.time.LocalTime.MAX).atZone(IST)
                    .isAfter(java.time.ZonedDateTime.now(IST))
                    ? Status.PENDING : Status.STALE;
                js.statusReason = "no log match for today";
            }
        } catch (IOException ioe) {
            js.status = Status.UNKNOWN;
            js.statusReason = "log unreadable: " + ioe.getMessage();
        }
    }

    /** Scan last N lines of a log file for any line dated today matching pattern.
     *
     *  Supports TWO line-prefix formats observed across services:
     *    (a) "yyyy-MM-dd HH:mm:ss…"  — streamingcandle, most standard layouts.
     *    (b) "HH:mm:ss.SSS …"        — dashboard backend + tradeExcutionModule.
     *
     *  For (b), the line itself carries no date, so we gate the whole match on
     *  the file's last-modified time being within today's IST day. This is a
     *  safe approximation — nohup.out is append-only and any line matching
     *  today within a file last-written today is definitionally from today.
     */
    static boolean tailGrep(String path, String regex, LocalDate today, int tailLines) throws IOException {
        Path p = Path.of(path);
        if (!Files.exists(p)) return false;
        String todayPrefix = today.toString();   // yyyy-MM-dd
        java.util.regex.Pattern pat = java.util.regex.Pattern.compile(regex);
        // Stream lines through a fixed-size ring buffer: O(filesize) read,
        // O(tailLines) memory. Avoids OOM on multi-hundred-MB nohup.out files.
        ArrayDeque<String> ring = new ArrayDeque<>(tailLines);
        try (java.io.BufferedReader br = Files.newBufferedReader(p)) {
            String line;
            while ((line = br.readLine()) != null) {
                if (ring.size() == tailLines) ring.pollFirst();
                ring.addLast(line);
            }
        }
        String[] arr = ring.toArray(new String[0]);
        // For time-only log files (dashboard + tradeExec write HH:mm:ss in the
        // JVM's local TZ, which is UTC in our deployment), we infer each
        // line's absolute UTC date by walking backward from the file's mtime
        // and counting midnight rollovers (a later HH:mm:ss earlier in the
        // file ⇒ one UTC day earlier). We then convert (UTC date, HH:mm:ss)
        // to an IST date and compare to `today` (IST).
        long mtimeMs = Files.getLastModifiedTime(p).toMillis();
        java.time.ZonedDateTime mtimeUtc = java.time.Instant.ofEpochMilli(mtimeMs)
            .atZone(java.time.ZoneOffset.UTC);
        LocalDate[] timeLineIstDate = computeTimeLineIstDates(arr, mtimeUtc);
        for (int i = 0; i < arr.length; i++) {
            String line = arr[i];
            if (line == null || line.isEmpty()) continue;
            // (a) Full date prefix — definitive regardless of slicing.
            if (line.startsWith(todayPrefix) && pat.matcher(line).find()) return true;
            // (b) Time-only prefix — match only when inferred IST date == today.
            if (startsWithTimePrefix(line) && timeLineIstDate[i] != null
                && timeLineIstDate[i].equals(today)
                && pat.matcher(line).find()) return true;
        }
        return false;
    }

    /** For each line that starts with a HH:mm:ss prefix, infer the IST calendar
     *  date at which it was written by walking backward from the file's mtime.
     *
     *  Algorithm:
     *    - Start at the end. The newest time-prefixed line is assumed to be on
     *      the same UTC day as the file mtime.
     *    - Walk backward: each time an earlier line's HH:mm:ss > the next-seen
     *      line's HH:mm:ss, we've crossed UTC midnight going backward — decrement
     *      the inferred UTC day.
     *    - Convert (UTC day, HH:mm:ss) to IST: if UTC hour*3600 + min*60 + sec
     *      >= 18:30:00 then IST day = UTC day + 1, else same.
     *
     *  Non-time-prefixed lines get null (they're not matched in branch (b)).
     */
    static LocalDate[] computeTimeLineIstDates(String[] lines, java.time.ZonedDateTime fileMtimeUtc) {
        LocalDate[] out = new LocalDate[lines.length];
        LocalDate inferredUtcDay = fileMtimeUtc.toLocalDate();
        String nextTime = null; // the later (in file order) line's HH:mm:ss
        for (int i = lines.length - 1; i >= 0; i--) {
            String line = lines[i];
            if (line == null || !startsWithTimePrefix(line)) continue;
            String cur = line.substring(0, 8);
            if (nextTime != null && cur.compareTo(nextTime) > 0) {
                // current line comes earlier in the file but has a later time
                // than the line after it → crossed UTC midnight going backward.
                inferredUtcDay = inferredUtcDay.minusDays(1);
            }
            out[i] = toIstDate(inferredUtcDay, cur);
            nextTime = cur;
        }
        return out;
    }

    /** UTC midnight falls at 05:30 the previous day IST — but since we're
     *  converting a UTC wall-clock into IST: any UTC time ≥ 18:30 lands on
     *  the next IST calendar day.
     */
    static LocalDate toIstDate(LocalDate utcDay, String hhmmss) {
        int hh = Integer.parseInt(hhmmss.substring(0, 2));
        int mm = Integer.parseInt(hhmmss.substring(3, 5));
        int totalMin = hh * 60 + mm;
        return totalMin >= (18 * 60 + 30) ? utcDay.plusDays(1) : utcDay;
    }

    /** Does the line start with HH:mm:ss or HH:mm:ss.SSS (and not a full date)? */
    static boolean startsWithTimePrefix(String line) {
        if (line.length() < 8) return false;
        return Character.isDigit(line.charAt(0)) && Character.isDigit(line.charAt(1))
            && line.charAt(2) == ':'
            && Character.isDigit(line.charAt(3)) && Character.isDigit(line.charAt(4))
            && line.charAt(5) == ':'
            && Character.isDigit(line.charAt(6)) && Character.isDigit(line.charAt(7));
    }

    /** When Redis epoch key is missing, classify by whether window is yet to start / past cutoff. */
    private Status classifyBeforeFirstRun(HealthJob job, ZonedDateTime now) {
        if (job.retryWindowStart == null) return Status.MISSING;
        java.time.LocalTime t = now.toLocalTime();
        if (t.isBefore(job.retryWindowStart)) return Status.PENDING;
        if (job.retryWindowEnd != null && t.isAfter(job.retryWindowEnd)) return Status.STALE;
        return Status.RETRYING;
    }

    /** When data exists but is past staleness. Distinguish "retrying in window" vs "cutoff passed". */
    private Status classifyBeyondStaleness(HealthJob job, ZonedDateTime now, long ageSec) {
        if (job.retryWindowEnd == null) return Status.STALE;
        java.time.LocalTime t = now.toLocalTime();
        if (job.retryWindowStart != null && t.isBefore(job.retryWindowStart)) return Status.PENDING;
        if (t.isAfter(job.retryWindowEnd)) return Status.STALE;
        return Status.RETRYING;
    }

    private static String humanDuration(long seconds) {
        if (seconds < 60) return seconds + "s";
        if (seconds < 3600) return (seconds / 60) + "m";
        if (seconds < 86400) return String.format("%dh %dm", seconds / 3600, (seconds % 3600) / 60);
        return (seconds / 86400) + "d";
    }

    // ══════════════════════ Trigger ══════════════════════

    public TriggerResult trigger(String jobId) {
        HealthJob job = HealthJobRegistry.JOBS.stream()
            .filter(j -> j.id.equals(jobId)).findFirst().orElse(null);
        if (job == null) {
            return new TriggerResult(false, "unknown job id: " + jobId);
        }
        if (job.triggerEndpoint == null) {
            return new TriggerResult(false, "manual trigger not supported for " + job.id);
        }
        String url = buildTriggerUrl(job);
        try {
            String resp = restTemplate.postForObject(url, null, String.class);
            log.info("[HEALTH-CHECK] manual trigger {} → {}: {}", jobId, url,
                resp != null ? resp.substring(0, Math.min(resp.length(), 200)) : "null");
            return new TriggerResult(true, resp != null ? resp : "ok");
        } catch (Exception e) {
            log.error("[HEALTH-CHECK] trigger {} failed: {}", jobId, e.getMessage());
            return new TriggerResult(false, "trigger failed: " + e.getMessage());
        }
    }

    private String buildTriggerUrl(HealthJob job) {
        String base = "fastanalytics".equals(job.triggerService)
            ? fastAnalyticsBaseUrl
            : "http://localhost:8085";   // dashboard self-ref
        return base + job.triggerEndpoint;
    }

    public record TriggerResult(boolean success, String message) {}
}
