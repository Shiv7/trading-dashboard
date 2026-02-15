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
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Kafka consumer for FUDKII signals based on SuperTrend flip + Bollinger Band breakout.
 *
 * TRIGGER CONDITIONS (from FudkiiSignalTrigger):
 * - BULLISH: SuperTrend flips from DOWN to UP AND close > BB_UPPER
 * - BEARISH: SuperTrend flips from UP to DOWN AND close < BB_LOWER
 *
 * Consumes from: kotsin_FUDKII
 *
 * FIXES APPLIED:
 * - Signal TTL: Active triggers expire after configurable duration (default 30 min)
 * - Dedup: Prevents duplicate signal processing on Kafka replays (5 min window)
 * - Daily cap: Max signals per instrument per day (default 5)
 * - Redis persistence: Survives dashboard restart via Redis backup
 */
@Component
@Slf4j
public class FUDKIIConsumer {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;
    private final SignalConsumer signalConsumer;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final String REDIS_KEY = "dashboard:fudkii:active-triggers";
    private static final String REDIS_KEY_ALL = "dashboard:fudkii:all-latest";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${signal.fudkii.ttl.minutes:30}")
    private int signalTtlMinutes;

    @Value("${signal.fudkii.max.per.day:5}")
    private int maxSignalsPerDay;

    // Active triggers with TTL via Caffeine
    private Cache<String, Map<String, Object>> activeTriggers;

    // Cache latest FUDKII signals (no TTL needed - informational only)
    private final Map<String, Map<String, Object>> latestFUDKII = new ConcurrentHashMap<>();

    // Dedup cache: key = scripCode|timestamp, prevents replay duplicates
    private final Cache<String, Boolean> dedupCache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(10000)
            .build();

    // Daily signal counter: key = scripCode|date
    private final Map<String, Integer> dailySignalCount = new ConcurrentHashMap<>();
    private volatile LocalDate currentTradeDate = LocalDate.now(IST);

    public FUDKIIConsumer(
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
        // Build TTL cache
        activeTriggers = Caffeine.newBuilder()
                .expireAfterWrite(signalTtlMinutes, TimeUnit.MINUTES)
                .maximumSize(500)
                .removalListener((key, value, cause) -> {
                    if (cause.wasEvicted()) {
                        log.info("FUDKII signal expired: {} (TTL={}min)", key, signalTtlMinutes);
                    }
                })
                .build();

        // Restore from Redis on startup
        restoreFromRedis();
    }

    @KafkaListener(
            topics = {"kotsin_FUDKII"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onFUDKII(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in FUDKII message, skipping");
                return;
            }

            // --- DEDUP CHECK ---
            String triggerTimeStr = root.path("triggerTime").asText("");
            String dedupKey = scripCode + "|" + triggerTimeStr;
            if (dedupCache.getIfPresent(dedupKey) != null) {
                log.debug("FUDKII dedup: skipping duplicate for {} at {}", scripCode, triggerTimeStr);
                return;
            }
            dedupCache.put(dedupKey, Boolean.TRUE);

            Map<String, Object> fudkiiData = parseFUDKII(root);
            boolean triggered = Boolean.TRUE.equals(fudkiiData.get("triggered"));

            if (triggered) {
                // --- DAILY CAP CHECK ---
                resetDailyCounterIfNeeded();
                String dailyKey = scripCode + "|" + currentTradeDate;
                int todayCount = dailySignalCount.getOrDefault(dailyKey, 0);
                if (todayCount >= maxSignalsPerDay) {
                    log.warn("FUDKII daily cap reached: {} has {} signals today (max={})",
                            scripCode, todayCount, maxSignalsPerDay);
                    return;
                }
                dailySignalCount.merge(dailyKey, 1, Integer::sum);

                String direction = (String) fudkiiData.get("direction");
                String symbol = (String) fudkiiData.get("symbol");
                String companyName = (String) fudkiiData.get("companyName");
                String displayName = scripLookup.resolve(scripCode,
                        symbol != null && !symbol.isEmpty() ? symbol :
                        (companyName != null && !companyName.isEmpty() ? companyName : null));

                log.info("FUDKII TRIGGER: {} ({}) direction={} reason={} price={} score={} [signals today: {}]",
                        displayName,
                        scripCode,
                        direction,
                        fudkiiData.get("reason"),
                        fudkiiData.get("triggerPrice"),
                        fudkiiData.get("triggerScore"),
                        todayCount + 1);

                // Cache active trigger (with TTL)
                fudkiiData.put("cachedAt", Instant.now().toEpochMilli());
                activeTriggers.put(scripCode, fudkiiData);

                // Send notification
                String emoji = "BULLISH".equals(direction) ? "^" : "v";
                sessionManager.broadcastNotification("FUDKII_TRIGGER",
                        String.format("%s %s FUDKII for %s @ %.2f | ST %s + BB %s",
                                emoji,
                                direction,
                                displayName,
                                ((Number) fudkiiData.get("triggerPrice")).doubleValue(),
                                fudkiiData.get("trend"),
                                fudkiiData.get("pricePosition")));

                // Register as main trading signal on the dashboard
                double triggerPrice = ((Number) fudkiiData.get("triggerPrice")).doubleValue();
                double bbUpper = ((Number) fudkiiData.get("bbUpper")).doubleValue();
                double bbLower = ((Number) fudkiiData.get("bbLower")).doubleValue();
                double superTrend = ((Number) fudkiiData.get("superTrend")).doubleValue();
                double triggerScore = ((Number) fudkiiData.get("triggerScore")).doubleValue();

                // Calculate stop loss and target from BB/ST levels
                double stopLoss = "BULLISH".equals(direction) ? Math.min(bbLower, superTrend) : Math.max(bbUpper, superTrend);
                double target1 = "BULLISH".equals(direction) ? triggerPrice + 2 * (triggerPrice - stopLoss) : triggerPrice - 2 * (stopLoss - triggerPrice);
                double riskReward = stopLoss != triggerPrice ? Math.abs((target1 - triggerPrice) / (triggerPrice - stopLoss)) : 0;

                String rationale = String.format("FUDKII: ST %s + BB %s | Score=%.2f | BB[%.2f-%.2f] ST=%.2f",
                        fudkiiData.get("trend"), fudkiiData.get("pricePosition"),
                        triggerScore, bbLower, bbUpper, superTrend);

                SignalDTO signalDTO = SignalDTO.builder()
                        .signalId(UUID.randomUUID().toString())
                        .scripCode(scripCode)
                        .companyName(displayName)
                        .timestamp(LocalDateTime.now(IST))
                        .signalSource("FUDKII")
                        .signalSourceLabel("FUDKII Trigger")
                        .signalType("FUDKII")
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
                log.info("FUDKII signal added to signals cache: {} {} @ {}", scripCode, direction, triggerPrice);
            } else {
                // Remove from active triggers if no longer triggered
                activeTriggers.invalidate(scripCode);
            }

            // Cache latest
            latestFUDKII.put(scripCode, fudkiiData);

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "FUDKII_UPDATE",
                    "scripCode", scripCode,
                    "triggered", triggered,
                    "data", fudkiiData
            ));

        } catch (Exception e) {
            log.error("Error processing FUDKII: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parseFUDKII(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        // Basic info
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
                data.put("triggerTime", LocalDateTime.ofInstant(
                        triggerTime, IST).toString());
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

        // Enriched pivot/target fields (from FudkiiSignalTrigger.enrichWithPivotTargets)
        if (root.has("target1") && !root.path("target1").isNull()) {
            data.put("target1", root.path("target1").asDouble());
        }
        if (root.has("target2") && !root.path("target2").isNull()) {
            data.put("target2", root.path("target2").asDouble());
        }
        if (root.has("target3") && !root.path("target3").isNull()) {
            data.put("target3", root.path("target3").asDouble());
        }
        if (root.has("target4") && !root.path("target4").isNull()) {
            data.put("target4", root.path("target4").asDouble());
        }
        if (root.has("stopLoss")) {
            data.put("stopLoss", root.path("stopLoss").asDouble());
        }
        if (root.has("riskReward")) {
            data.put("riskReward", root.path("riskReward").asDouble());
        }
        if (root.has("pivotSource")) {
            data.put("pivotSource", root.path("pivotSource").asBoolean(false));
        }

        return data;
    }

    // --- REDIS PERSISTENCE ---

    @PreDestroy
    public void persistToRedis() {
        try {
            // Persist active triggers (with TTL)
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

            // Persist all latest signals (no TTL — frontend shows today's signals)
            Map<String, Map<String, Object>> allSnapshot = new HashMap<>(latestFUDKII);
            if (!allSnapshot.isEmpty()) {
                redisTemplate.delete(REDIS_KEY_ALL);
                for (Map.Entry<String, Map<String, Object>> entry : allSnapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(REDIS_KEY_ALL, entry.getKey(), json);
                }
                // Expire at end of day (24h max)
                redisTemplate.expire(REDIS_KEY_ALL, 24 * 60, TimeUnit.MINUTES);
            }

            log.info("FUDKII persisted {} active triggers, {} all-latest to Redis",
                    snapshot.size(), allSnapshot.size());
        } catch (Exception e) {
            log.error("Failed to persist FUDKII triggers to Redis: {}", e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void restoreFromRedis() {
        try {
            // Restore active triggers
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
                        latestFUDKII.put((String) entry.getKey(), data);
                        restoredActive++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUDKII trigger {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            // Restore all latest signals (for the FUDKII tab)
            Map<Object, Object> allEntries = redisTemplate.opsForHash().entries(REDIS_KEY_ALL);
            int restoredAll = 0;
            if (allEntries != null && !allEntries.isEmpty()) {
                for (Map.Entry<Object, Object> entry : allEntries.entrySet()) {
                    try {
                        Map<String, Object> data = objectMapper.readValue(
                                (String) entry.getValue(), Map.class);
                        latestFUDKII.putIfAbsent((String) entry.getKey(), data);
                        restoredAll++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUDKII all-latest {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            log.info("FUDKII restored {} active triggers + {} all-latest from Redis",
                    restoredActive, restoredAll);
        } catch (Exception e) {
            log.error("Failed to restore FUDKII triggers from Redis: {}", e.getMessage());
        }
    }

    // Periodic Redis backup every 2 minutes
    @Scheduled(fixedRate = 120000)
    public void periodicPersist() {
        persistToRedis();
    }

    private void resetDailyCounterIfNeeded() {
        LocalDate today = LocalDate.now(IST);
        if (!today.equals(currentTradeDate)) {
            dailySignalCount.clear();
            currentTradeDate = today;
            log.info("FUDKII daily signal counters reset for {}", today);
        }
    }

    // --- PUBLIC ACCESSORS ---

    public Map<String, Object> getLatestFUDKII(String scripCode) {
        return latestFUDKII.get(scripCode);
    }

    public Map<String, Map<String, Object>> getAllLatestSignals() {
        return new HashMap<>(latestFUDKII);
    }

    public Map<String, Map<String, Object>> getActiveTriggers() {
        return new HashMap<>(activeTriggers.asMap());
    }

    public int getActiveTriggerCount() {
        return (int) activeTriggers.estimatedSize();
    }

    public Map<String, Map<String, Object>> getActiveIgnitions() {
        return getActiveTriggers();
    }

    public int getActiveIgnitionCount() {
        return getActiveTriggerCount();
    }

    public String getDirectionForScrip(String scripCode) {
        Map<String, Object> data = activeTriggers.getIfPresent(scripCode);
        return data != null ? (String) data.get("direction") : null;
    }

    public int getDailySignalCount(String scripCode) {
        String dailyKey = scripCode + "|" + currentTradeDate;
        return dailySignalCount.getOrDefault(dailyKey, 0);
    }
}
