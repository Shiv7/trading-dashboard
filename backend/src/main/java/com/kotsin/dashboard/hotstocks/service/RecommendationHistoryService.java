package com.kotsin.dashboard.hotstocks.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.util.List;

/**
 * Tracks, per scripCode, a rolling history of dates on which the HotStocks
 * enrichment job recommended it. Used by the dashboard card to show a
 * "Recommended Nx in last 10d" badge when N >= 2.
 *
 * Storage: Redis list `hotstocks:v1:recommendation_history:{scripCode}` of
 * ISO-8601 date strings (yyyy-MM-dd), trimmed to the last 10 entries with
 * a 15-day TTL so stale stocks expire naturally.
 */
@Service
public class RecommendationHistoryService {

    private static final Logger log = LoggerFactory.getLogger(RecommendationHistoryService.class);
    private static final String KEY_PREFIX = "hotstocks:v1:recommendation_history:";
    private static final int MAX_ENTRIES = 10;
    private static final Duration TTL = Duration.ofDays(15);

    private final StringRedisTemplate redis;

    public RecommendationHistoryService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /**
     * Record that {@code scripCode} was recommended on {@code date}. Pushes the
     * ISO date onto the left of the Redis list, trims to {@link #MAX_ENTRIES},
     * and refreshes the {@link #TTL}.
     */
    public void record(String scripCode, LocalDate date) {
        if (scripCode == null || scripCode.isBlank() || date == null) {
            log.warn("[HOTSTOCKS-RECHIST] skip=invalid_args scripCode={} date={}", scripCode, date);
            return;
        }
        String key = KEY_PREFIX + scripCode;
        String value = date.toString();
        try {
            ListOperations<String, String> list = redis.opsForList();
            list.leftPush(key, value);
            list.trim(key, 0, MAX_ENTRIES - 1);
            redis.expire(key, TTL);
            log.debug("[HOTSTOCKS-RECHIST] action=record scripCode={} date={} key={}",
                scripCode, value, key);
        } catch (Exception e) {
            log.warn("[HOTSTOCKS-RECHIST] action=record status=failed scripCode={} error={}",
                scripCode, e.getMessage());
        }
    }

    /**
     * Count the entries for {@code scripCode} whose date is within the last
     * {@code n} days (inclusive cutoff = today.minusDays(n-1)). Returns 0 on
     * any Redis or parse failure.
     */
    public int countInLastNDays(String scripCode, int n) {
        if (scripCode == null || scripCode.isBlank() || n <= 0) {
            return 0;
        }
        String key = KEY_PREFIX + scripCode;
        try {
            List<String> entries = redis.opsForList().range(key, 0, -1);
            if (entries == null || entries.isEmpty()) return 0;
            LocalDate cutoff = LocalDate.now().minusDays((long) n - 1);
            int count = 0;
            for (String entry : entries) {
                try {
                    LocalDate d = LocalDate.parse(entry);
                    if (!d.isBefore(cutoff)) count++;
                } catch (Exception parseEx) {
                    log.warn("[HOTSTOCKS-RECHIST] action=count status=parse_skip scripCode={} entry={}",
                        scripCode, entry);
                }
            }
            return count;
        } catch (Exception e) {
            log.warn("[HOTSTOCKS-RECHIST] action=count status=failed scripCode={} error={}",
                scripCode, e.getMessage());
            return 0;
        }
    }
}
