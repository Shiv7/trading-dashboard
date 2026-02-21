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
 * Kafka consumer for MERE signals (Mean Reversion strategy).
 *
 * MERE detects mean reversion setups where price has deviated from BB bands
 * and conditions favor a snap-back to the mean.
 *
 * Consumes from: kotsin_MERE
 */
@Component
@Slf4j
public class MereConsumer {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;
    private final SignalConsumer signalConsumer;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final String REDIS_KEY = "dashboard:mere:active-triggers";
    private static final String REDIS_KEY_ALL = "dashboard:mere:all-latest";
    private static final String REDIS_KEY_HISTORY = "dashboard:mere:signal-history";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${signal.mere.ttl.minutes:30}")
    private int signalTtlMinutes;

    @Value("${signal.mere.max.per.day:5}")
    private int maxSignalsPerDay;

    private Cache<String, Map<String, Object>> activeTriggers;
    private final Map<String, Map<String, Object>> latestMERE = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> todaySignalHistory = new ConcurrentHashMap<>();

    private final Cache<String, Boolean> dedupCache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(10000)
            .build();

    private final Map<String, Integer> dailySignalCount = new ConcurrentHashMap<>();
    private volatile LocalDate currentTradeDate = LocalDate.now(IST);

    public MereConsumer(
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
                        log.info("MERE signal expired: {} (TTL={}min)", key, signalTtlMinutes);
                    }
                })
                .build();

        restoreFromRedis();
    }

    @KafkaListener(
            topics = {"kotsin_MERE"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onMERE(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in MERE message, skipping");
                return;
            }

            // Dedup check
            String triggerTimeStr = root.path("triggerTime").asText("");
            String dedupKey = scripCode + "|" + triggerTimeStr;
            if (dedupCache.getIfPresent(dedupKey) != null) {
                log.debug("MERE dedup: skipping duplicate for {} at {}", scripCode, triggerTimeStr);
                return;
            }
            dedupCache.put(dedupKey, Boolean.TRUE);

            Map<String, Object> mereData = parseMERE(root);
            boolean triggered = Boolean.TRUE.equals(mereData.get("triggered"));

            if (triggered) {
                // Daily cap check
                resetDailyCounterIfNeeded();
                String dailyKey = scripCode + "|" + currentTradeDate;
                int todayCount = dailySignalCount.getOrDefault(dailyKey, 0);
                if (todayCount >= maxSignalsPerDay) {
                    log.warn("MERE daily cap reached: {} has {} signals today (max={})",
                            scripCode, todayCount, maxSignalsPerDay);
                    return;
                }
                dailySignalCount.merge(dailyKey, 1, Integer::sum);

                String direction = (String) mereData.get("direction");
                String symbol = (String) mereData.get("symbol");
                String companyName = (String) mereData.get("companyName");
                String displayName = scripLookup.resolve(scripCode,
                        symbol != null && !symbol.isEmpty() ? symbol :
                        (companyName != null && !companyName.isEmpty() ? companyName : null));

                log.info("MERE TRIGGER: {} ({}) direction={} score={} [L1={} L2={} L3={} bonus={}] [signals today: {}]",
                        displayName, scripCode, direction,
                        mereData.get("mereScore"),
                        mereData.get("mereLayer1"),
                        mereData.get("mereLayer2"),
                        mereData.get("mereLayer3"),
                        mereData.get("mereBonus"),
                        todayCount + 1);

                // Cache active trigger
                long cachedAtMs = Instant.now().toEpochMilli();
                mereData.put("cachedAt", cachedAtMs);
                activeTriggers.put(scripCode, mereData);

                // Append to history
                long epoch = mereData.containsKey("triggerTimeEpoch")
                        ? ((Number) mereData.get("triggerTimeEpoch")).longValue()
                        : cachedAtMs;
                String historyKey = scripCode + "-" + epoch;
                mereData.put("signalSource", "MERE");
                todaySignalHistory.put(historyKey, mereData);

                // Register as main trading signal
                double triggerPrice = ((Number) mereData.getOrDefault("triggerPrice", 0)).doubleValue();
                double stopLoss = ((Number) mereData.getOrDefault("stopLoss", 0)).doubleValue();
                double target1 = ((Number) mereData.getOrDefault("target1", 0)).doubleValue();
                double riskReward = ((Number) mereData.getOrDefault("riskReward", 0)).doubleValue();
                double mereScore = ((Number) mereData.getOrDefault("mereScore", 0)).doubleValue();
                boolean pivotSource = Boolean.TRUE.equals(mereData.get("pivotSource"));

                String slSource = mereData.containsKey("mereSLSource") ? "BB" : (pivotSource ? "PIVOT" : "BB/ST");
                String rationale = String.format("MERE: Mean Reversion | Score=%.0f [L1=%s L2=%s L3=%s B=%s] | SL=%.2f (%s) T1=%.2f RR=%.2f | %%B=%s",
                        mereScore,
                        mereData.get("mereLayer1"), mereData.get("mereLayer2"),
                        mereData.get("mereLayer3"), mereData.get("mereBonus"),
                        stopLoss, slSource, target1, riskReward,
                        mereData.get("percentB"));

                SignalDTO signalDTO = SignalDTO.builder()
                        .signalId(UUID.randomUUID().toString())
                        .scripCode(scripCode)
                        .companyName(displayName)
                        .timestamp(LocalDateTime.now(IST))
                        .signalSource("MERE")
                        .signalSourceLabel("Mean Reversion")
                        .signalType("MERE")
                        .direction(direction)
                        .confidence(Math.min(1.0, mereScore / 100.0))
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
                log.info("MERE signal added to signals cache: {} {} @ {}", scripCode, direction, triggerPrice);

                // Send notification
                String emoji = "BULLISH".equals(direction) ? "^" : "v";
                sessionManager.broadcastNotification("MERE_TRIGGER",
                        String.format("%s %s MERE (mean reversion) for %s @ %.2f | Score=%.0f",
                                emoji, direction, displayName, triggerPrice, mereScore));

                // Update latest
                latestMERE.put(scripCode, mereData);
            }

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "MERE_UPDATE",
                    "scripCode", scripCode,
                    "triggered", triggered,
                    "data", mereData
            ));

        } catch (Exception e) {
            log.error("Error processing MERE: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parseMERE(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        // Basic info
        data.put("scripCode", root.path("scripCode").asText());
        data.put("symbol", root.path("symbol").asText());
        data.put("companyName", scripLookup.resolve(root.path("scripCode").asText(), root.path("companyName").asText("")));
        data.put("exchange", root.path("exchange").asText());

        // Trigger info
        data.put("triggered", root.path("triggered").asBoolean(false));
        data.put("direction", root.path("direction").asText("NONE"));
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

        // MERE-specific scoring
        data.put("mereScore", root.path("mereScore").asInt(0));
        data.put("mereLayer1", root.path("mereLayer1").asInt(0));
        data.put("mereLayer2", root.path("mereLayer2").asInt(0));
        data.put("mereLayer3", root.path("mereLayer3").asInt(0));
        data.put("mereBonus", root.path("mereBonus").asInt(0));
        data.put("merePenalty", root.path("merePenalty").asInt(0));
        data.put("mereReasons", root.path("mereReasons").asText(""));

        // Bollinger Bands data
        data.put("bbUpper", root.path("bbUpper").asDouble(0));
        data.put("bbMiddle", root.path("bbMiddle").asDouble(0));
        data.put("bbLower", root.path("bbLower").asDouble(0));
        data.put("bbWidth", root.path("bbWidth").asDouble(0));
        data.put("percentB", root.path("percentB").asDouble(0));

        // SuperTrend data
        data.put("superTrend", root.path("superTrend").asDouble(0));
        data.put("trend", root.path("trend").asText("NONE"));
        data.put("trendChanged", root.path("trendChanged").asBoolean(false));
        data.put("pricePosition", root.path("pricePosition").asText("BETWEEN"));
        data.put("isSqueezing", root.path("isSqueezing").asBoolean(false));
        data.put("barsInTrend", root.path("barsInTrend").asInt(0));
        data.put("trendStrength", root.path("trendStrength").asDouble(0));

        // Trade levels
        data.put("stopLoss", root.path("stopLoss").asDouble(0));
        data.put("target1", root.path("target1").asDouble(0));
        data.put("target2", root.path("target2").asDouble(0));
        data.put("target3", root.path("target3").asDouble(0));
        data.put("target4", root.path("target4").asDouble(0));
        data.put("riskReward", root.path("riskReward").asDouble(0));
        data.put("pivotSource", root.path("pivotSource").asBoolean(false));
        data.put("atr30m", root.path("atr30m").asDouble(0));
        if (root.has("mereSLSource")) data.put("mereSLSource", root.path("mereSLSource").asText());

        // Volume data
        data.put("volumeT", root.path("volumeT").asLong(0));
        data.put("volumeTMinus1", root.path("volumeTMinus1").asLong(0));
        data.put("avgVolume", root.path("avgVolume").asDouble(0));
        data.put("surgeT", root.path("surgeT").asDouble(0));
        data.put("surgeTMinus1", root.path("surgeTMinus1").asDouble(0));

        // OI enrichment
        if (root.has("oiChangeAtT")) data.put("oiChangeAtT", root.path("oiChangeAtT").asLong(0));
        if (root.has("oiInterpretation")) data.put("oiInterpretation", root.path("oiInterpretation").asText("NEUTRAL"));
        if (root.has("oiLabel")) data.put("oiLabel", root.path("oiLabel").asText(""));

        // Option enrichment
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

        // Futures fallback
        data.put("futuresAvailable", root.path("futuresAvailable").asBoolean(false));
        if (root.has("futuresScripCode")) data.put("futuresScripCode", root.path("futuresScripCode").asText());
        if (root.has("futuresSymbol")) data.put("futuresSymbol", root.path("futuresSymbol").asText());
        if (root.has("futuresLtp")) data.put("futuresLtp", root.path("futuresLtp").asDouble());
        if (root.has("futuresLotSize")) data.put("futuresLotSize", root.path("futuresLotSize").asInt(1));
        if (root.has("futuresExpiry")) data.put("futuresExpiry", root.path("futuresExpiry").asText());
        if (root.has("futuresExchange")) data.put("futuresExchange", root.path("futuresExchange").asText());
        if (root.has("futuresExchangeType")) data.put("futuresExchangeType", root.path("futuresExchangeType").asText());

        return data;
    }

    // --- REDIS PERSISTENCE ---

    @PreDestroy
    public void persistToRedis() {
        try {
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

            Map<String, Map<String, Object>> allSnapshot = new HashMap<>(latestMERE);
            if (!allSnapshot.isEmpty()) {
                redisTemplate.delete(REDIS_KEY_ALL);
                for (Map.Entry<String, Map<String, Object>> entry : allSnapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(REDIS_KEY_ALL, entry.getKey(), json);
                }
                redisTemplate.expire(REDIS_KEY_ALL, 24 * 60, TimeUnit.MINUTES);
            }

            String historyRedisKey = REDIS_KEY_HISTORY + ":" + currentTradeDate;
            Map<String, Map<String, Object>> historySnapshot = new HashMap<>(todaySignalHistory);
            if (!historySnapshot.isEmpty()) {
                for (Map.Entry<String, Map<String, Object>> entry : historySnapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(historyRedisKey, entry.getKey(), json);
                }
                redisTemplate.expire(historyRedisKey, 24 * 60, TimeUnit.MINUTES);
            }

            log.info("MERE persisted {} active, {} all-latest, {} history to Redis",
                    snapshot.size(), allSnapshot.size(), historySnapshot.size());
        } catch (Exception e) {
            log.error("Failed to persist MERE triggers to Redis: {}", e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void restoreFromRedis() {
        try {
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
                        if (cachedAt > 0 && (now - cachedAt) > maxAgeMs) continue;
                        activeTriggers.put((String) entry.getKey(), data);
                        latestMERE.put((String) entry.getKey(), data);
                        restoredActive++;
                    } catch (Exception e) {
                        log.warn("Failed to restore MERE trigger {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            Map<Object, Object> allEntries = redisTemplate.opsForHash().entries(REDIS_KEY_ALL);
            int restoredAll = 0;
            if (allEntries != null && !allEntries.isEmpty()) {
                for (Map.Entry<Object, Object> entry : allEntries.entrySet()) {
                    try {
                        Map<String, Object> data = objectMapper.readValue(
                                (String) entry.getValue(), Map.class);
                        latestMERE.putIfAbsent((String) entry.getKey(), data);
                        restoredAll++;
                    } catch (Exception e) {
                        log.warn("Failed to restore MERE all-latest {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

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
                            latestMERE.putIfAbsent(sc, data);
                        }
                        restoredHistory++;
                    } catch (Exception e) {
                        log.warn("Failed to restore MERE history {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            log.info("MERE restored {} active + {} all-latest + {} history from Redis",
                    restoredActive, restoredAll, restoredHistory);
        } catch (Exception e) {
            log.error("Failed to restore MERE triggers from Redis: {}", e.getMessage());
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
            latestMERE.clear();
            currentTradeDate = today;
            log.info("MERE daily counters, history and latest reset for {}", today);
        }
    }

    // --- PUBLIC ACCESSORS ---

    public Map<String, Object> getLatestMERE(String scripCode) {
        return latestMERE.get(scripCode);
    }

    public Map<String, Map<String, Object>> getActiveTriggers() {
        return new HashMap<>(activeTriggers.asMap());
    }

    public int getActiveTriggerCount() {
        return (int) activeTriggers.estimatedSize();
    }

    public Map<String, Map<String, Object>> getAllLatestSignals() {
        return new HashMap<>(latestMERE);
    }

    public List<Map<String, Object>> getTodaySignalHistory() {
        return new ArrayList<>(todaySignalHistory.values());
    }

    public int getTodaySignalHistoryCount() {
        return todaySignalHistory.size();
    }
}
