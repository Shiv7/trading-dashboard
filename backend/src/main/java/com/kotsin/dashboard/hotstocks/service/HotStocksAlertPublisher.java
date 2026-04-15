package com.kotsin.dashboard.hotstocks.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;

/**
 * Publishes HotStocks alerts onto a Redis list consumed by the frontend.
 *
 * Key: dashboard:alerts:hotstocks (LIST, newest entry at index 0 via LPUSH)
 * TTL: 24h — rolling, refreshed on each publish.
 *
 * Consumers: GET /api/hot-stocks/alerts (returns the recent entries as raw JSON strings).
 *
 * Emission of INSUFFICIENT_FUNDS_NEXT_SESSION is wired in Task 6
 * (hotstocks lifecycle plan) — this class only ships the plumbing.
 */
@Service
public class HotStocksAlertPublisher {
    private static final Logger log = LoggerFactory.getLogger(HotStocksAlertPublisher.class);
    private static final String LOG_PREFIX = "[HOTSTOCKS-ALERT]";
    private static final String KEY = "dashboard:alerts:hotstocks";
    private static final Duration TTL = Duration.ofHours(24);

    private final StringRedisTemplate redis;

    public HotStocksAlertPublisher(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void publishInsufficientFunds(double freeBalance, double required) {
        String payload = String.format(
            "{\"type\":\"INSUFFICIENT_FUNDS_NEXT_SESSION\",\"strategy\":\"HOTSTOCKS\",\"freeBalance\":%.2f,\"required\":%.2f,\"at\":%d}",
            freeBalance, required, System.currentTimeMillis());
        try {
            redis.opsForList().leftPush(KEY, payload);
            redis.expire(KEY, TTL);
            log.info("{} action=PUBLISH type=INSUFFICIENT_FUNDS_NEXT_SESSION free={} required={}",
                LOG_PREFIX, freeBalance, required);
        } catch (Exception e) {
            log.error("ERR {} action=PUBLISH_FAIL reason={}", LOG_PREFIX, e.getMessage());
        }
    }

    public List<String> readRecent(int limit) {
        try {
            List<String> out = redis.opsForList().range(KEY, 0, limit - 1);
            return out == null ? List.of() : out;
        } catch (Exception e) {
            log.error("ERR {} action=READ_FAIL reason={}", LOG_PREFIX, e.getMessage());
            return List.of();
        }
    }
}
