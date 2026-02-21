package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Kafka consumer for MicroAlpha signals.
 * MicroAlpha is a microstructure alpha engine with regime-adaptive trading modes.
 *
 * Consumes from: microalpha-signals
 *
 * Features:
 * - Signal TTL: Active triggers expire after configurable duration (default 30 min)
 * - Dedup: Prevents duplicate signal processing on Kafka replays (5 min window)
 * - Daily cap: Max signals per instrument per day (default 5)
 * - Redis persistence: Survives dashboard restart via Redis backup
 */
@Component
@Slf4j
public class MicroAlphaConsumer {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final String REDIS_KEY = "dashboard:microalpha:active-triggers";
    private static final String REDIS_KEY_ALL = "dashboard:microalpha:all-latest";
    private static final String REDIS_KEY_HISTORY = "dashboard:microalpha:signal-history";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${signal.microalpha.ttl.minutes:30}")
    private int signalTtlMinutes;

    @Value("${signal.microalpha.max.per.day:5}")
    private int maxSignalsPerDay;

    // Active triggers with TTL via Caffeine
    private Cache<String, Map<String, Object>> activeTriggers;

    // Cache latest MicroAlpha signals (no TTL — informational only)
    private final Map<String, Map<String, Object>> latestSignals = new ConcurrentHashMap<>();

    // Signal history: key = "scripCode-triggerTimeEpoch", stores ALL triggered signals for today
    private final Map<String, Map<String, Object>> todaySignalHistory = new ConcurrentHashMap<>();

    // Dedup cache
    private final Cache<String, Boolean> dedupCache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(10000)
            .build();

    // Daily signal counter
    private final Map<String, Integer> dailySignalCount = new ConcurrentHashMap<>();
    private volatile LocalDate currentTradeDate = LocalDate.now(IST);

    public MicroAlphaConsumer(
            WebSocketSessionManager sessionManager,
            @Qualifier("redisTemplate") RedisTemplate<String, String> redisTemplate,
            ScripLookupService scripLookup) {
        this.sessionManager = sessionManager;
        this.redisTemplate = redisTemplate;
        this.scripLookup = scripLookup;
    }

    @PostConstruct
    public void init() {
        activeTriggers = Caffeine.newBuilder()
                .expireAfterWrite(signalTtlMinutes, TimeUnit.MINUTES)
                .maximumSize(500)
                .removalListener((key, value, cause) -> {
                    if (cause.wasEvicted()) {
                        log.info("MicroAlpha signal expired: {} (TTL={}min)", key, signalTtlMinutes);
                    }
                })
                .build();

        restoreFromRedis();
    }

    @KafkaListener(
            topics = {"microalpha-signals"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onMicroAlpha(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in MicroAlpha message, skipping");
                return;
            }

            // --- DEDUP CHECK ---
            String triggerTimeStr = root.path("triggerTime").asText("");
            String dedupKey = scripCode + "|" + triggerTimeStr;
            if (dedupCache.getIfPresent(dedupKey) != null) {
                log.debug("MicroAlpha dedup: skipping duplicate for {} at {}", scripCode, triggerTimeStr);
                return;
            }
            dedupCache.put(dedupKey, Boolean.TRUE);

            Map<String, Object> signalData = parseMicroAlpha(root);
            boolean triggered = Boolean.TRUE.equals(signalData.get("triggered"));

            if (triggered) {
                // --- DAILY CAP CHECK ---
                resetDailyCounterIfNeeded();
                String dailyKey = scripCode + "|" + currentTradeDate;
                int todayCount = dailySignalCount.getOrDefault(dailyKey, 0);
                if (todayCount >= maxSignalsPerDay) {
                    log.warn("MicroAlpha daily cap reached: {} has {} signals today (max={})",
                            scripCode, todayCount, maxSignalsPerDay);
                    return;
                }
                dailySignalCount.merge(dailyKey, 1, Integer::sum);

                String symbol = (String) signalData.get("symbol");
                String displayName = scripLookup.resolve(scripCode,
                        symbol != null && !symbol.isEmpty() ? symbol : null);

                log.info("MICROALPHA TRIGGER: {} ({}) direction={} mode={} conviction={} R:R={} [signals today: {}]",
                        displayName,
                        scripCode,
                        signalData.get("direction"),
                        signalData.get("tradingMode"),
                        String.format("%.1f", ((Number) signalData.getOrDefault("absConviction", 0)).doubleValue()),
                        String.format("%.2f", ((Number) signalData.getOrDefault("riskReward", 0)).doubleValue()),
                        todayCount + 1);

                // Cache active trigger (with TTL)
                long cachedAtMs = Instant.now().toEpochMilli();
                signalData.put("cachedAt", cachedAtMs);
                activeTriggers.put(scripCode, signalData);

                // Append to today's signal history (immutable)
                long epoch = signalData.containsKey("triggerTimeEpoch")
                        ? ((Number) signalData.get("triggerTimeEpoch")).longValue()
                        : cachedAtMs;
                String historyKey = scripCode + "-" + epoch;
                signalData.put("signalSource", "MICROALPHA");
                todaySignalHistory.put(historyKey, signalData);

                // Send notification
                String emoji = "BULLISH".equals(signalData.get("direction")) ? "^" : "v";
                sessionManager.broadcastNotification("MICROALPHA_TRIGGER",
                        String.format("%s MicroAlpha %s for %s | Mode: %s | Conv=%.0f%% | R:R=%.1f",
                                emoji,
                                signalData.get("direction"),
                                displayName,
                                signalData.get("tradingMode"),
                                ((Number) signalData.getOrDefault("absConviction", 0)).doubleValue(),
                                ((Number) signalData.getOrDefault("riskReward", 0)).doubleValue()));

                // Update latest
                latestSignals.put(scripCode, signalData);
            } else {
                activeTriggers.invalidate(scripCode);
            }

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "MICROALPHA_UPDATE",
                    "scripCode", scripCode,
                    "triggered", triggered,
                    "data", signalData
            ));

        } catch (Exception e) {
            log.error("Error processing MicroAlpha: {}", e.getMessage(), e);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseMicroAlpha(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        // Basic info
        data.put("scripCode", root.path("scripCode").asText());
        data.put("symbol", root.path("symbol").asText(""));
        data.put("exchange", root.path("exchange").asText(""));

        // Trigger info
        data.put("triggered", root.path("triggered").asBoolean(false));
        data.put("direction", root.path("direction").asText("NEUTRAL"));
        data.put("reason", root.path("reason").asText(""));
        data.put("strategy", root.path("strategy").asText("MICRO_ALPHA"));

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

        // MicroAlpha-specific fields
        data.put("score", root.path("score").asDouble(0));
        data.put("conviction", root.path("conviction").asDouble(0));
        data.put("absConviction", root.path("absConviction").asDouble(0));
        data.put("tradingMode", root.path("tradingMode").asText("UNKNOWN"));
        data.put("entryPrice", root.path("entryPrice").asDouble(0));
        data.put("stopLoss", root.path("stopLoss").asDouble(0));
        data.put("target", root.path("target").asDouble(0));
        data.put("riskReward", root.path("riskReward").asDouble(0));

        // Reasons list
        if (root.has("reasons") && root.path("reasons").isArray()) {
            List<String> reasons = new ArrayList<>();
            root.path("reasons").forEach(r -> reasons.add(r.asText()));
            data.put("reasons", reasons);
        }

        // Sub-scores breakdown
        if (root.has("subScores") && root.path("subScores").isObject()) {
            Map<String, Object> scores = new HashMap<>();
            root.path("subScores").fields().forEachRemaining(entry ->
                    scores.put(entry.getKey(), entry.getValue().asDouble(0)));
            data.put("subScores", scores);
        }

        // Data quality flags
        data.put("hasOrderbook", root.path("hasOrderbook").asBoolean(false));
        data.put("hasOI", root.path("hasOI").asBoolean(false));
        data.put("hasOptions", root.path("hasOptions").asBoolean(false));
        data.put("hasSession", root.path("hasSession").asBoolean(false));

        // Option enrichment fields (real LTP, strike, lot size from OptionDataEnricher)
        data.put("optionAvailable", root.path("optionAvailable").asBoolean(false));
        if (root.has("optionScripCode")) data.put("optionScripCode", root.path("optionScripCode").asText());
        if (root.has("optionSymbol")) data.put("optionSymbol", root.path("optionSymbol").asText());
        if (root.has("optionStrike")) data.put("optionStrike", root.path("optionStrike").asDouble());
        if (root.has("optionType")) data.put("optionType", root.path("optionType").asText());
        if (root.has("optionExpiry")) data.put("optionExpiry", root.path("optionExpiry").asText());
        if (root.has("optionLtp")) data.put("optionLtp", root.path("optionLtp").asDouble());
        if (root.has("optionLotSize")) data.put("optionLotSize", root.path("optionLotSize").asInt(1));
        if (root.has("optionExchange")) data.put("optionExchange", root.path("optionExchange").asText());
        if (root.has("optionExchangeType")) data.put("optionExchangeType", root.path("optionExchangeType").asText());

        return data;
    }

    // --- REDIS PERSISTENCE ---

    @PreDestroy
    public void persistToRedis() {
        try {
            // Persist active triggers
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

            // Persist all latest signals
            Map<String, Map<String, Object>> allSnapshot = new HashMap<>(latestSignals);
            if (!allSnapshot.isEmpty()) {
                redisTemplate.delete(REDIS_KEY_ALL);
                for (Map.Entry<String, Map<String, Object>> entry : allSnapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(REDIS_KEY_ALL, entry.getKey(), json);
                }
                redisTemplate.expire(REDIS_KEY_ALL, 24 * 60, TimeUnit.MINUTES);
            }

            // Persist today's signal history
            String historyRedisKey = REDIS_KEY_HISTORY + ":" + currentTradeDate;
            Map<String, Map<String, Object>> historySnapshot = new HashMap<>(todaySignalHistory);
            if (!historySnapshot.isEmpty()) {
                for (Map.Entry<String, Map<String, Object>> entry : historySnapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(historyRedisKey, entry.getKey(), json);
                }
                redisTemplate.expire(historyRedisKey, 24 * 60, TimeUnit.MINUTES);
            }

            log.info("MicroAlpha persisted {} active triggers, {} all-latest, {} history to Redis",
                    snapshot.size(), allSnapshot.size(), historySnapshot.size());
        } catch (Exception e) {
            log.error("Failed to persist MicroAlpha triggers to Redis: {}", e.getMessage());
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
                        latestSignals.put((String) entry.getKey(), data);
                        restoredActive++;
                    } catch (Exception e) {
                        log.warn("Failed to restore MicroAlpha trigger {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            // Restore all latest signals
            Map<Object, Object> allEntries = redisTemplate.opsForHash().entries(REDIS_KEY_ALL);
            int restoredAll = 0;
            if (allEntries != null && !allEntries.isEmpty()) {
                for (Map.Entry<Object, Object> entry : allEntries.entrySet()) {
                    try {
                        Map<String, Object> data = objectMapper.readValue(
                                (String) entry.getValue(), Map.class);
                        latestSignals.putIfAbsent((String) entry.getKey(), data);
                        restoredAll++;
                    } catch (Exception e) {
                        log.warn("Failed to restore MicroAlpha all-latest {}: {}", entry.getKey(), e.getMessage());
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
                        String sc = (String) data.get("scripCode");
                        if (sc != null && Boolean.TRUE.equals(data.get("triggered"))) {
                            latestSignals.putIfAbsent(sc, data);
                        }
                        restoredHistory++;
                    } catch (Exception e) {
                        log.warn("Failed to restore MicroAlpha history {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            log.info("MicroAlpha restored {} active triggers + {} all-latest + {} history from Redis",
                    restoredActive, restoredAll, restoredHistory);
        } catch (Exception e) {
            log.error("Failed to restore MicroAlpha triggers from Redis: {}", e.getMessage());
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
            latestSignals.clear();
            currentTradeDate = today;
            log.info("MicroAlpha daily counters, history and latest reset for {}", today);
        }
    }

    // --- PUBLIC ACCESSORS ---

    public Map<String, Object> getLatestSignal(String scripCode) {
        return latestSignals.get(scripCode);
    }

    public Map<String, Map<String, Object>> getAllLatestSignals() {
        return new HashMap<>(latestSignals);
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

    public List<Map<String, Object>> getTodaySignalHistory() {
        return new ArrayList<>(todaySignalHistory.values());
    }

    public int getTodaySignalHistoryCount() {
        return todaySignalHistory.size();
    }
}
