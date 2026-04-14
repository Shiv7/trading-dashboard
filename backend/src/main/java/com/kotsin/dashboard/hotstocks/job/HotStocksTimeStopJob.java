package com.kotsin.dashboard.hotstocks.job;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Set;

/**
 * Closes HOTSTOCKS virtual positions that are at least 5 trading days old.
 *
 * Runs at 15:20 IST Monday–Friday (5 minutes before NSE no-trade window).
 * Scans Redis `virtual:positions:*` for entries with signalSource=HOTSTOCKS,
 * then calls trade-exec's existing close endpoint for each stale position.
 *
 * Time stop is enforced here (not in trade-exec) because the trade-exec
 * StrategyTradeRequest DTO has no timeStopDays field.
 *
 * Note: virtual:positions entries are stored by trade-exec as JSON strings
 * (not Redis hashes). Read via GET + parse.
 */
@Component
public class HotStocksTimeStopJob {
    private static final Logger log = LoggerFactory.getLogger(HotStocksTimeStopJob.class);
    private static final int TIME_STOP_DAYS = 5;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final StringRedisTemplate redis;
    private final RestTemplate rest;
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String tradeExecUrl;

    public HotStocksTimeStopJob(StringRedisTemplate redis,
                                @Qualifier("hotStocksRestTemplate") RestTemplate rest) {
        this.redis = redis;
        this.rest = rest;
    }

    @Scheduled(cron = "0 20 15 * * MON-FRI", zone = "Asia/Kolkata")
    public void closeStalePositions() {
        log.info("HotStocksTimeStopJob starting");
        Set<String> keys = redis.keys("virtual:positions:*");
        if (keys == null || keys.isEmpty()) {
            log.info("HotStocksTimeStopJob: no virtual:positions:* keys found");
            return;
        }

        int closed = 0;
        int skipped = 0;
        int nonHotStocks = 0;
        int failed = 0;
        for (String key : keys) {
            try {
                String json = redis.opsForValue().get(key);
                if (json == null || json.isBlank()) continue;

                JsonNode pos = mapper.readTree(json);
                String source = pos.path("signalSource").asText("");
                if (!"HOTSTOCKS".equals(source)) {
                    nonHotStocks++;
                    continue;
                }
                String status = pos.path("status").asText("");
                int qtyOpen = pos.path("qtyOpen").asInt(0);
                if ("CLOSED".equals(status) || qtyOpen <= 0) {
                    skipped++;
                    continue;
                }
                if (!isStale(pos)) {
                    skipped++;
                    continue;
                }
                String scripCode = pos.path("scripCode").asText(null);
                if (scripCode == null || scripCode.isBlank()) {
                    // Fallback: parse "virtual:positions:{scripCode}" pattern
                    int idx = key.lastIndexOf(':');
                    scripCode = idx >= 0 ? key.substring(idx + 1) : null;
                }
                if (scripCode == null) {
                    log.warn("HotStocksTimeStopJob: cannot determine scripCode for {}", key);
                    failed++;
                    continue;
                }
                closeOne(scripCode);
                closed++;
            } catch (Exception e) {
                failed++;
                log.warn("HotStocksTimeStopJob: error on {}: {}", key, e.getMessage());
            }
        }
        log.info("HotStocksTimeStopJob complete: closed={}, skipped={}, nonHotStocks={}, failed={}",
            closed, skipped, nonHotStocks, failed);
    }

    private boolean isStale(JsonNode pos) {
        JsonNode openedAt = pos.path("openedAt");
        if (openedAt.isMissingNode() || openedAt.isNull()) openedAt = pos.path("entryTime");
        if (openedAt.isMissingNode() || openedAt.isNull()) return false;
        try {
            long val = openedAt.asLong(0);
            if (val <= 0) return false;
            // Accept either seconds or milliseconds (Redis varies by pipeline)
            long epochSec = val > 100_000_000_000L ? val / 1000L : val;
            LocalDate openDate = Instant.ofEpochSecond(epochSec).atZone(IST).toLocalDate();
            long ageDays = ChronoUnit.DAYS.between(openDate, LocalDate.now(IST));
            return ageDays >= TIME_STOP_DAYS;
        } catch (Exception e) {
            return false;
        }
    }

    private void closeOne(String scripCode) {
        String url = tradeExecUrl + "/api/strategy-trades/" + scripCode + "/close";
        try {
            rest.postForEntity(url, null, Map.class);
            log.info("HotStocksTimeStopJob: closed {}", scripCode);
        } catch (Exception e) {
            log.warn("HotStocksTimeStopJob: close failed for {}: {}", scripCode, e.getMessage());
            throw e;
        }
    }
}
