package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import com.kotsin.dashboard.model.dto.SignalDTO;
import com.kotsin.dashboard.service.ScripLookupService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Kafka consumer for FUKAA signals (volume-filtered FUDKII).
 *
 * FUKAA = FUDKII + Volume Surge Filter.
 * Filters FUDKII signals based on volume surge criteria:
 * - Immediate pass: T-1 or T candle volume > 2x avg of last 6 candles
 * - Watching mode: Neither passes, signal re-evaluated at T+1
 * - T+1 pass: T+1 candle volume > 2x avg
 *
 * Consumes from: kotsin_FUKAA
 */
@Component
@Slf4j
public class FUKAAConsumer {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;
    private final SignalConsumer signalConsumer;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final String REDIS_KEY = "dashboard:fukaa:active-triggers";
    private static final String REDIS_KEY_ALL = "dashboard:fukaa:all-latest";
    private static final String REDIS_KEY_HISTORY = "dashboard:fukaa:signal-history";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${signal.fukaa.ttl.minutes:30}")
    private int signalTtlMinutes;

    @Value("${signal.fukaa.max.per.day:5}")
    private int maxSignalsPerDay;

    // Active triggers with TTL via Caffeine
    private Cache<String, Map<String, Object>> activeTriggers;

    // Cache latest FUKAA signals per instrument (no TTL - informational only)
    private final Map<String, Map<String, Object>> latestFUKAA = new ConcurrentHashMap<>();

    // Signal history: key = "scripCode-triggerTimeEpoch", stores ALL triggered signals for today
    // Immutable history — entries are never overwritten or removed (except daily reset)
    private final Map<String, Map<String, Object>> todaySignalHistory = new ConcurrentHashMap<>();

    // Dedup cache: key = scripCode|timestamp, prevents replay duplicates
    private final Cache<String, Boolean> dedupCache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(10000)
            .build();

    // Daily signal counter: key = scripCode|date
    private final Map<String, Integer> dailySignalCount = new ConcurrentHashMap<>();
    private volatile LocalDate currentTradeDate = LocalDate.now(IST);

    public FUKAAConsumer(
            WebSocketSessionManager sessionManager,
            @Qualifier("redisTemplate") RedisTemplate<String, String> redisTemplate,
            SignalConsumer signalConsumer,
            ScripLookupService scripLookup) {
        this.sessionManager = sessionManager;
        this.redisTemplate = redisTemplate;
        this.signalConsumer = signalConsumer;
        this.scripLookup = scripLookup;
    }

    @PostConstruct
    public void init() {
        activeTriggers = Caffeine.newBuilder()
                .expireAfterWrite(signalTtlMinutes, TimeUnit.MINUTES)
                .maximumSize(500)
                .removalListener((key, value, cause) -> {
                    if (cause.wasEvicted()) {
                        log.info("FUKAA signal expired: {} (TTL={}min)", key, signalTtlMinutes);
                    }
                })
                .build();

        restoreFromRedis();
    }

    @KafkaListener(
            topics = {"kotsin_FUKAA"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onFUKAA(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in FUKAA message, skipping");
                return;
            }

            // --- DEDUP CHECK ---
            String triggerTimeStr = root.path("triggerTime").asText("");
            String fukaaEmittedAt = root.path("fukaaEmittedAt").asText("");
            String dedupKey = scripCode + "|" + triggerTimeStr + "|" + fukaaEmittedAt;
            if (dedupCache.getIfPresent(dedupKey) != null) {
                log.debug("FUKAA dedup: skipping duplicate for {} at {}", scripCode, triggerTimeStr);
                return;
            }
            dedupCache.put(dedupKey, Boolean.TRUE);

            Map<String, Object> fukaaData = parseFUKAA(root);
            boolean triggered = Boolean.TRUE.equals(fukaaData.get("triggered"));

            if (triggered) {
                // --- DAILY CAP CHECK ---
                resetDailyCounterIfNeeded();
                String dailyKey = scripCode + "|" + currentTradeDate;
                int todayCount = dailySignalCount.getOrDefault(dailyKey, 0);
                if (todayCount >= maxSignalsPerDay) {
                    log.warn("FUKAA daily cap reached: {} has {} signals today (max={})",
                            scripCode, todayCount, maxSignalsPerDay);
                    return;
                }
                dailySignalCount.merge(dailyKey, 1, Integer::sum);

                String direction = (String) fukaaData.get("direction");
                String symbol = (String) fukaaData.get("symbol");
                String companyName = (String) fukaaData.get("companyName");
                String displayName = scripLookup.resolve(scripCode,
                        symbol != null && !symbol.isEmpty() ? symbol :
                        (companyName != null && !companyName.isEmpty() ? companyName : null));

                log.info("FUKAA TRIGGER: {} ({}) direction={} outcome={} passedCandle={} rank={} [signals today: {}]",
                        displayName, scripCode, direction,
                        fukaaData.get("fukaaOutcome"),
                        fukaaData.get("passedCandle"),
                        fukaaData.get("rank"),
                        todayCount + 1);

                // Cache active trigger (with TTL)
                long cachedAtMs = Instant.now().toEpochMilli();
                fukaaData.put("cachedAt", cachedAtMs);
                activeTriggers.put(scripCode, fukaaData);

                // Append to today's signal history (immutable — never overwritten)
                long epoch = fukaaData.containsKey("triggerTimeEpoch")
                        ? ((Number) fukaaData.get("triggerTimeEpoch")).longValue()
                        : cachedAtMs;
                String historyKey = scripCode + "-" + epoch;
                fukaaData.put("signalSource", "FUKAA");
                todaySignalHistory.put(historyKey, fukaaData);

                // Register as main trading signal on the dashboard
                double triggerPrice = ((Number) fukaaData.getOrDefault("triggerPrice", 0)).doubleValue();
                double bbUpper = ((Number) fukaaData.getOrDefault("bbUpper", 0)).doubleValue();
                double bbLower = ((Number) fukaaData.getOrDefault("bbLower", 0)).doubleValue();
                double superTrend = ((Number) fukaaData.getOrDefault("superTrend", 0)).doubleValue();
                double triggerScore = ((Number) fukaaData.getOrDefault("triggerScore", 0)).doubleValue();
                double rank = ((Number) fukaaData.getOrDefault("rank", 0)).doubleValue();

                // Use pivot-derived levels from producer (the source of truth)
                double stopLoss = ((Number) fukaaData.getOrDefault("stopLoss", 0)).doubleValue();
                double target1 = ((Number) fukaaData.getOrDefault("target1", 0)).doubleValue();
                double riskReward = ((Number) fukaaData.getOrDefault("riskReward", 0)).doubleValue();
                boolean pivotSource = Boolean.TRUE.equals(fukaaData.get("pivotSource"));

                // Fallback to old formula ONLY if producer didn't provide levels (backward compat)
                if (stopLoss == 0) {
                    stopLoss = "BULLISH".equals(direction) ? Math.min(bbLower, superTrend) : Math.max(bbUpper, superTrend);
                    target1 = "BULLISH".equals(direction)
                            ? triggerPrice + 2 * (triggerPrice - stopLoss)
                            : triggerPrice - 2 * (stopLoss - triggerPrice);
                    riskReward = stopLoss != triggerPrice
                            ? Math.abs((target1 - triggerPrice) / (triggerPrice - stopLoss)) : 0;
                    pivotSource = false;
                    log.warn("FUKAA {} using BB/ST fallback SL (no pivot data in payload)", scripCode);
                }

                String slSource = pivotSource ? "PIVOT" : "BB/ST";
                String rationale = String.format("FUKAA: %s via %s | Rank=%.2f Score=%.2f | SL=%.2f (%s) T1=%.2f RR=%.2f | BB[%.2f-%.2f] ST=%.2f",
                        fukaaData.get("fukaaOutcome"), fukaaData.get("passedCandle"),
                        rank, triggerScore, stopLoss, slSource, target1, riskReward,
                        bbLower, bbUpper, superTrend);

                SignalDTO signalDTO = SignalDTO.builder()
                        .signalId(UUID.randomUUID().toString())
                        .scripCode(scripCode)
                        .companyName(displayName)
                        .timestamp(LocalDateTime.now(IST))
                        .signalSource("FUKAA")
                        .signalSourceLabel("FUKAA Trigger")
                        .signalType("FUKAA")
                        .direction(direction)
                        .confidence(Math.min(1.0, triggerScore / 100.0))
                        .rationale(rationale)
                        .narrative(rationale)
                        .entryPrice(triggerPrice)
                        .stopLoss(stopLoss)
                        .target1(target1)
                        .riskRewardRatio(riskReward)
                        .allGatesPassed(true)
                        .positionSizeMultiplier(1.0)
                        .build();

                signalConsumer.addExternalSignal(signalDTO);
                log.info("FUKAA signal added to signals cache: {} {} @ {}", scripCode, direction, triggerPrice);

                // Send notification
                String emoji = "BULLISH".equals(direction) ? "^" : "v";
                sessionManager.broadcastNotification("FUKAA_TRIGGER",
                        String.format("%s %s FUKAA (vol-confirmed) for %s @ %.2f | %s via %s",
                                emoji, direction, displayName,
                                ((Number) fukaaData.getOrDefault("triggerPrice", 0)).doubleValue(),
                                fukaaData.get("fukaaOutcome"),
                                fukaaData.get("passedCandle")));

                // Update latest (only triggered signals update the latest map)
                latestFUKAA.put(scripCode, fukaaData);
            }
            // NOTE: Do NOT overwrite latestFUKAA with non-triggered data

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "FUKAA_UPDATE",
                    "scripCode", scripCode,
                    "triggered", triggered,
                    "data", fukaaData
            ));

        } catch (Exception e) {
            log.error("Error processing FUKAA: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parseFUKAA(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        // Basic info (same as FUDKII)
        data.put("scripCode", root.path("scripCode").asText());
        data.put("symbol", root.path("symbol").asText());
        data.put("companyName", scripLookup.resolve(root.path("scripCode").asText(), root.path("companyName").asText("")));
        data.put("exchange", root.path("exchange").asText());

        // Trigger info
        data.put("triggered", root.path("triggered").asBoolean(false));
        data.put("direction", root.path("direction").asText("NONE"));
        data.put("reason", root.path("reason").asText(""));
        data.put("triggerPrice", root.path("triggerPrice").asDouble(0));
        data.put("triggerScore", root.path("triggerScore").asDouble(0));

        // Trigger time
        String triggerTimeStr = root.path("triggerTime").asText();
        if (triggerTimeStr != null && !triggerTimeStr.isEmpty()) {
            try {
                Instant triggerTime = Instant.parse(triggerTimeStr);
                data.put("triggerTime", LocalDateTime.ofInstant(triggerTime, IST).toString());
                data.put("triggerTimeEpoch", triggerTime.toEpochMilli());
            } catch (Exception e) {
                data.put("triggerTime", triggerTimeStr);
                data.put("triggerTimeEpoch", System.currentTimeMillis());
            }
        } else {
            data.put("triggerTime", LocalDateTime.now(IST).toString());
            data.put("triggerTimeEpoch", System.currentTimeMillis());
        }

        // Bollinger Bands data
        data.put("bbUpper", root.path("bbUpper").asDouble(0));
        data.put("bbMiddle", root.path("bbMiddle").asDouble(0));
        data.put("bbLower", root.path("bbLower").asDouble(0));

        // SuperTrend data
        data.put("superTrend", root.path("superTrend").asDouble(0));
        data.put("trend", root.path("trend").asText("NONE"));
        data.put("trendChanged", root.path("trendChanged").asBoolean(false));
        data.put("pricePosition", root.path("pricePosition").asText("BETWEEN"));

        // ==================== PIVOT-DERIVED TRADE LEVELS (from producer) ====================
        data.put("stopLoss", root.path("stopLoss").asDouble(0));
        data.put("target1", root.path("target1").asDouble(0));
        data.put("target2", root.path("target2").asDouble(0));
        data.put("target3", root.path("target3").asDouble(0));
        data.put("target4", root.path("target4").asDouble(0));
        data.put("riskReward", root.path("riskReward").asDouble(0));
        data.put("pivotSource", root.path("pivotSource").asBoolean(false));
        data.put("atr30m", root.path("atr30m").asDouble(0));

        // ==================== FUKAA-SPECIFIC FIELDS ====================
        data.put("fukaaOutcome", root.path("fukaaOutcome").asText("UNKNOWN"));
        data.put("passedCandle", root.path("passedCandle").asText("NONE"));
        data.put("rank", root.path("rank").asDouble(0));

        // Volume data
        data.put("volumeTMinus1", root.path("volumeTMinus1").asLong(0));
        data.put("volumeT", root.path("volumeT").asLong(0));
        data.put("volumeTPlus1", root.path("volumeTPlus1").asLong(0));
        data.put("avgVolume", root.path("avgVolume").asDouble(0));

        // Surge ratios
        data.put("surgeTMinus1", root.path("surgeTMinus1").asDouble(0));
        data.put("surgeT", root.path("surgeT").asDouble(0));
        data.put("surgeTPlus1", root.path("surgeTPlus1").asDouble(0));

        // FUKAA emission time
        String fukaaEmittedAt = root.path("fukaaEmittedAt").asText();
        if (fukaaEmittedAt != null && !fukaaEmittedAt.isEmpty()) {
            try {
                Instant emittedTime = Instant.parse(fukaaEmittedAt);
                data.put("fukaaEmittedAt", LocalDateTime.ofInstant(emittedTime, IST).toString());
            } catch (Exception e) {
                data.put("fukaaEmittedAt", fukaaEmittedAt);
            }
        }

        return data;
    }

    // --- REDIS PERSISTENCE ---

    @PreDestroy
    public void persistToRedis() {
        try {
            // Persist active triggers (Caffeine TTL cache)
            Map<String, Map<String, Object>> snapshot = new HashMap<>(activeTriggers.asMap());
            if (snapshot.isEmpty()) {
                redisTemplate.delete(REDIS_KEY);
            } else {
                redisTemplate.delete(REDIS_KEY);
                for (Map.Entry<String, Map<String, Object>> entry : snapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(REDIS_KEY, entry.getKey(), json);
                }
                redisTemplate.expire(REDIS_KEY, signalTtlMinutes, TimeUnit.MINUTES);
            }

            // Persist all latest signals (per-instrument, no TTL — survives restart)
            Map<String, Map<String, Object>> allSnapshot = new HashMap<>(latestFUKAA);
            if (!allSnapshot.isEmpty()) {
                redisTemplate.delete(REDIS_KEY_ALL);
                for (Map.Entry<String, Map<String, Object>> entry : allSnapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(REDIS_KEY_ALL, entry.getKey(), json);
                }
                redisTemplate.expire(REDIS_KEY_ALL, 24 * 60, TimeUnit.MINUTES);
            }

            // Persist today's signal history (immutable records — survives restart)
            String historyRedisKey = REDIS_KEY_HISTORY + ":" + currentTradeDate;
            Map<String, Map<String, Object>> historySnapshot = new HashMap<>(todaySignalHistory);
            if (!historySnapshot.isEmpty()) {
                for (Map.Entry<String, Map<String, Object>> entry : historySnapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(historyRedisKey, entry.getKey(), json);
                }
                redisTemplate.expire(historyRedisKey, 24 * 60, TimeUnit.MINUTES);
            }

            log.info("FUKAA persisted {} active triggers, {} all-latest, {} history to Redis",
                    snapshot.size(), allSnapshot.size(), historySnapshot.size());
        } catch (Exception e) {
            log.error("Failed to persist FUKAA triggers to Redis: {}", e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void restoreFromRedis() {
        try {
            // Restore active triggers (Caffeine cache)
            Map<Object, Object> entries = redisTemplate.opsForHash().entries(REDIS_KEY);
            int restoredActive = 0;
            if (entries != null && !entries.isEmpty()) {
                long now = System.currentTimeMillis();
                long maxAgeMs = signalTtlMinutes * 60_000L;
                for (Map.Entry<Object, Object> entry : entries.entrySet()) {
                    try {
                        Map<String, Object> data = objectMapper.readValue(
                                (String) entry.getValue(), Map.class);
                        long cachedAt = data.containsKey("cachedAt")
                                ? ((Number) data.get("cachedAt")).longValue() : 0;
                        if (cachedAt > 0 && (now - cachedAt) > maxAgeMs) {
                            continue;
                        }
                        activeTriggers.put((String) entry.getKey(), data);
                        latestFUKAA.put((String) entry.getKey(), data);
                        restoredActive++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUKAA trigger {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            // Restore all latest signals (for the FUKAA tab)
            Map<Object, Object> allEntries = redisTemplate.opsForHash().entries(REDIS_KEY_ALL);
            int restoredAll = 0;
            if (allEntries != null && !allEntries.isEmpty()) {
                for (Map.Entry<Object, Object> entry : allEntries.entrySet()) {
                    try {
                        Map<String, Object> data = objectMapper.readValue(
                                (String) entry.getValue(), Map.class);
                        latestFUKAA.putIfAbsent((String) entry.getKey(), data);
                        restoredAll++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUKAA all-latest {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            // Restore today's signal history
            String historyRedisKey = REDIS_KEY_HISTORY + ":" + currentTradeDate;
            Map<Object, Object> historyEntries = redisTemplate.opsForHash().entries(historyRedisKey);
            int restoredHistory = 0;
            if (historyEntries != null && !historyEntries.isEmpty()) {
                for (Map.Entry<Object, Object> entry : historyEntries.entrySet()) {
                    try {
                        Map<String, Object> data = objectMapper.readValue(
                                (String) entry.getValue(), Map.class);
                        todaySignalHistory.putIfAbsent((String) entry.getKey(), data);
                        // Also ensure latestFUKAA has this triggered signal
                        String sc = (String) data.get("scripCode");
                        if (sc != null && Boolean.TRUE.equals(data.get("triggered"))) {
                            latestFUKAA.putIfAbsent(sc, data);
                        }
                        restoredHistory++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUKAA history {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            log.info("FUKAA restored {} active triggers + {} all-latest + {} history from Redis",
                    restoredActive, restoredAll, restoredHistory);
        } catch (Exception e) {
            log.error("Failed to restore FUKAA triggers from Redis: {}", e.getMessage());
        }
    }

    @Scheduled(fixedRate = 120000)
    public void periodicPersist() {
        persistToRedis();
    }

    private void resetDailyCounterIfNeeded() {
        LocalDate today = LocalDate.now(IST);
        if (!today.equals(currentTradeDate)) {
            dailySignalCount.clear();
            todaySignalHistory.clear();
            latestFUKAA.clear();
            currentTradeDate = today;
            log.info("FUKAA daily counters, history and latest reset for {}", today);
        }
    }

    // --- PUBLIC ACCESSORS ---

    public Map<String, Object> getLatestFUKAA(String scripCode) {
        return latestFUKAA.get(scripCode);
    }

    public Map<String, Map<String, Object>> getActiveTriggers() {
        return new HashMap<>(activeTriggers.asMap());
    }

    public int getActiveTriggerCount() {
        return (int) activeTriggers.estimatedSize();
    }

    public String getDirectionForScrip(String scripCode) {
        Map<String, Object> data = activeTriggers.getIfPresent(scripCode);
        return data != null ? (String) data.get("direction") : null;
    }

    public int getDailySignalCount(String scripCode) {
        String dailyKey = scripCode + "|" + currentTradeDate;
        return dailySignalCount.getOrDefault(dailyKey, 0);
    }

    /**
     * Get all latest FUKAA signals (per-instrument, only triggered=true entries).
     * Survives restart via Redis persistence.
     */
    public Map<String, Map<String, Object>> getAllLatestSignals() {
        return new HashMap<>(latestFUKAA);
    }

    /**
     * Get today's full signal history — ALL triggered signals, never overwritten.
     * Survives restart via Redis persistence.
     */
    public List<Map<String, Object>> getTodaySignalHistory() {
        return new ArrayList<>(todaySignalHistory.values());
    }

    public int getTodaySignalHistoryCount() {
        return todaySignalHistory.size();
    }
}
