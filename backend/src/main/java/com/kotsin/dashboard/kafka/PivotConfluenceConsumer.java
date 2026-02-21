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
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Kafka consumer for Pivot Confluence signals.
 * Detects multi-timeframe pivot confluence with SMC zones.
 *
 * Consumes from: pivot-confluence-signals
 *
 * FIXES APPLIED:
 * - Signal TTL: Active triggers expire after configurable duration (default 30 min)
 * - Dedup: Prevents duplicate signal processing on Kafka replays (5 min window)
 * - Daily cap: Max signals per instrument per day (default 5)
 * - Redis persistence: Survives dashboard restart via Redis backup
 */
@Component
@Slf4j
public class PivotConfluenceConsumer {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final String REDIS_KEY = "dashboard:pivot:active-triggers";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${signal.pivot.ttl.minutes:30}")
    private int signalTtlMinutes;

    @Value("${signal.pivot.max.per.day:5}")
    private int maxSignalsPerDay;

    // Active triggers with TTL via Caffeine
    private Cache<String, Map<String, Object>> activeTriggers;

    // Cache latest Pivot signals (no TTL - informational only)
    private final Map<String, Map<String, Object>> latestPivotSignals = new ConcurrentHashMap<>();

    // Dedup cache
    private final Cache<String, Boolean> dedupCache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(10000)
            .build();

    // Daily signal counter
    private final Map<String, Integer> dailySignalCount = new ConcurrentHashMap<>();
    private volatile LocalDate currentTradeDate = LocalDate.now(IST);

    public PivotConfluenceConsumer(
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
                        log.info("Pivot signal expired: {} (TTL={}min)", key, signalTtlMinutes);
                    }
                })
                .build();

        restoreFromRedis();
    }

    @KafkaListener(
            topics = {"pivot-confluence-signals"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onPivotConfluence(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in Pivot Confluence message, skipping");
                return;
            }

            // --- DEDUP CHECK ---
            String triggerTimeStr = root.path("triggerTime").asText("");
            long timestamp = root.path("timestamp").asLong(0);
            String dedupKey = scripCode + "|" + triggerTimeStr + "|" + timestamp;
            if (dedupCache.getIfPresent(dedupKey) != null) {
                log.debug("Pivot dedup: skipping duplicate for {} at {}", scripCode, triggerTimeStr);
                return;
            }
            dedupCache.put(dedupKey, Boolean.TRUE);

            Map<String, Object> pivotData = parsePivotSignal(root);
            boolean triggered = Boolean.TRUE.equals(pivotData.get("triggered"));

            if (triggered) {
                // --- DAILY CAP CHECK ---
                resetDailyCounterIfNeeded();
                String dailyKey = scripCode + "|" + currentTradeDate;
                int todayCount = dailySignalCount.getOrDefault(dailyKey, 0);
                if (todayCount >= maxSignalsPerDay) {
                    log.warn("Pivot daily cap reached: {} has {} signals today (max={})",
                            scripCode, todayCount, maxSignalsPerDay);
                    return;
                }
                dailySignalCount.merge(dailyKey, 1, Integer::sum);

                String symbol = (String) pivotData.get("symbol");
                String companyName = (String) pivotData.get("companyName");
                String displayName = scripLookup.resolve(scripCode,
                        symbol != null && !symbol.isEmpty() ? symbol :
                        (companyName != null && !companyName.isEmpty() ? companyName : null));

                log.info("PIVOT CONFLUENCE: {} ({}) direction={} score={} R:R={} [signals today: {}]",
                        displayName,
                        scripCode,
                        pivotData.get("direction"),
                        String.format("%.1f", ((Number) pivotData.getOrDefault("score", 0)).doubleValue()),
                        String.format("%.2f", ((Number) pivotData.getOrDefault("riskReward", 0)).doubleValue()),
                        todayCount + 1);

                // Cache active trigger (with TTL)
                pivotData.put("cachedAt", Instant.now().toEpochMilli());
                activeTriggers.put(scripCode, pivotData);

                // Send notification
                String emoji = "BULLISH".equals(pivotData.get("direction")) ? "^" : "v";
                sessionManager.broadcastNotification("PIVOT_CONFLUENCE",
                        String.format("%s Pivot Confluence for %s! HTF: %s | LTF Confirmed | R:R=%.1f",
                                emoji,
                                displayName,
                                pivotData.get("htfDirection"),
                                ((Number) pivotData.getOrDefault("riskReward", 0)).doubleValue()));
            } else {
                activeTriggers.invalidate(scripCode);
            }

            // Cache latest
            latestPivotSignals.put(scripCode, pivotData);

            // Broadcast to WebSocket
            sessionManager.broadcastSignal(Map.of(
                    "type", "PIVOT_CONFLUENCE_UPDATE",
                    "scripCode", scripCode,
                    "triggered", triggered,
                    "data", pivotData
            ));

        } catch (Exception e) {
            log.error("Error processing Pivot Confluence: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parsePivotSignal(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        data.put("timestamp", LocalDateTime.ofInstant(
                Instant.ofEpochMilli(timestamp), IST).toString());
        data.put("timestampEpoch", timestamp);

        data.put("scripCode", root.path("scripCode").asText());
        data.put("symbol", root.path("symbol").asText(""));
        data.put("companyName", scripLookup.resolve(root.path("scripCode").asText(), root.path("companyName").asText("")));
        data.put("exchange", root.path("exchange").asText(""));
        data.put("triggered", root.path("triggered").asBoolean(false));
        data.put("direction", root.path("direction").asText("NEUTRAL"));
        data.put("reason", root.path("reason").asText(""));
        data.put("score", root.path("score").asDouble(0));
        data.put("triggerTime", root.path("triggerTime").asText());

        // HTF Bias details
        data.put("htfDirection", root.path("htfDirection").asText("NEUTRAL"));
        data.put("htfStrength", root.path("htfStrength").asDouble(0));
        data.put("htfBullishScore", root.path("htfBullishScore").asDouble(0));
        data.put("htfBearishScore", root.path("htfBearishScore").asDouble(0));
        data.put("htfReason", root.path("htfReason").asText(""));

        // LTF Confirmation
        data.put("ltfConfirmed", root.path("ltfConfirmed").asBoolean(false));
        data.put("ltfAlignmentScore", root.path("ltfAlignmentScore").asDouble(0));
        data.put("ltfReason", root.path("ltfReason").asText(""));

        // Pivot Analysis
        data.put("pivotCurrentPrice", root.path("pivotCurrentPrice").asDouble(0));
        data.put("pivotNearbyLevels", root.path("pivotNearbyLevels").asInt(0));
        data.put("cprPosition", root.path("cprPosition").asText(""));

        // SMC Analysis
        data.put("smcInOrderBlock", root.path("smcInOrderBlock").asBoolean(false));
        data.put("smcNearFVG", root.path("smcNearFVG").asBoolean(false));
        data.put("smcAtLiquidityZone", root.path("smcAtLiquidityZone").asBoolean(false));
        data.put("smcBias", root.path("smcBias").asText("NEUTRAL"));

        // Risk:Reward
        data.put("entryPrice", root.path("entryPrice").asDouble(0));
        data.put("stopLoss", root.path("stopLoss").asDouble(0));
        data.put("target", root.path("target").asDouble(0));
        data.put("riskReward", root.path("riskReward").asDouble(0));

        // Retest details
        data.put("hasConfirmedRetest", root.path("hasConfirmedRetest").asBoolean(false));
        data.put("hasActiveBreakout", root.path("hasActiveBreakout").asBoolean(false));
        data.put("retestLevel", root.path("retestLevel").asText(""));
        data.put("retestQuality", root.path("retestQuality").asText(""));
        data.put("firstRetest", root.path("firstRetest").asBoolean(false));

        // ML Enrichment (from Python fastAnalayticsKotsin via Redis → StreamingCandle)
        data.put("mlAvailable", root.path("mlAvailable").asBoolean(false));
        if (root.path("mlAvailable").asBoolean(false)) {
            data.put("mlPrediction", root.path("mlPrediction").asText("HOLD"));
            data.put("mlConfidence", root.path("mlConfidence").asDouble(0));
            data.put("mlRegime", root.path("mlRegime").asText("NEUTRAL_RANGE"));
            data.put("mlRegimeScore", root.path("mlRegimeScore").asDouble(0));
            data.put("mlRegimeConviction", root.path("mlRegimeConviction").asText("LOW"));
            data.put("mlBetSignal", root.path("mlBetSignal").asDouble(0));
            data.put("mlPositionSizeMultiplier", root.path("mlPositionSizeMultiplier").asDouble(0));
            data.put("mlVpinToxicity", root.path("mlVpinToxicity").asDouble(0));
            data.put("mlOrderFlowImbalance", root.path("mlOrderFlowImbalance").asDouble(0));
        }

        // Option enrichment fields (real LTP, strike, lot size from OptionDataEnricher)
        data.put("optionAvailable", root.path("optionAvailable").asBoolean(false));
        if (root.has("optionScripCode")) data.put("optionScripCode", root.path("optionScripCode").asText());
        if (root.has("optionSymbol")) data.put("optionSymbol", root.path("optionSymbol").asText());
        if (root.has("optionStrike")) data.put("optionStrike", root.path("optionStrike").asDouble());
        if (root.has("optionType")) data.put("optionType", root.path("optionType").asText());
        if (root.has("optionExpiry")) data.put("optionExpiry", root.path("optionExpiry").asText());
        if (root.has("optionLtp")) data.put("optionLtp", root.path("optionLtp").asDouble());
        if (root.has("optionLotSize")) data.put("optionLotSize", root.path("optionLotSize").asInt(1));
        if (root.has("optionMultiplier")) data.put("optionMultiplier", root.path("optionMultiplier").asInt(1));
        if (root.has("optionExchange")) data.put("optionExchange", root.path("optionExchange").asText());
        if (root.has("optionExchangeType")) data.put("optionExchangeType", root.path("optionExchangeType").asText());
        if (root.has("symbol")) data.put("symbol", root.path("symbol").asText());

        // Futures fallback fields (MCX instruments without options)
        data.put("futuresAvailable", root.path("futuresAvailable").asBoolean(false));
        if (root.has("futuresScripCode")) data.put("futuresScripCode", root.path("futuresScripCode").asText());
        if (root.has("futuresSymbol")) data.put("futuresSymbol", root.path("futuresSymbol").asText());
        if (root.has("futuresLtp")) data.put("futuresLtp", root.path("futuresLtp").asDouble());
        if (root.has("futuresLotSize")) data.put("futuresLotSize", root.path("futuresLotSize").asInt(1));
        if (root.has("futuresMultiplier")) data.put("futuresMultiplier", root.path("futuresMultiplier").asInt(1));
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
                return;
            }
            redisTemplate.delete(REDIS_KEY);
            for (Map.Entry<String, Map<String, Object>> entry : snapshot.entrySet()) {
                String json = objectMapper.writeValueAsString(entry.getValue());
                redisTemplate.opsForHash().put(REDIS_KEY, entry.getKey(), json);
            }
            redisTemplate.expire(REDIS_KEY, signalTtlMinutes, TimeUnit.MINUTES);
            log.info("Pivot persisted {} active triggers to Redis", snapshot.size());
        } catch (Exception e) {
            log.error("Failed to persist Pivot triggers to Redis: {}", e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void restoreFromRedis() {
        try {
            Map<Object, Object> entries = redisTemplate.opsForHash().entries(REDIS_KEY);
            if (entries == null || entries.isEmpty()) {
                log.info("Pivot: No persisted triggers found in Redis");
                return;
            }
            int restored = 0;
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
                    restored++;
                } catch (Exception e) {
                    log.warn("Failed to restore Pivot trigger {}: {}", entry.getKey(), e.getMessage());
                }
            }
            log.info("Pivot restored {} active triggers from Redis (skipped stale)", restored);
        } catch (Exception e) {
            log.error("Failed to restore Pivot triggers from Redis: {}", e.getMessage());
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
            currentTradeDate = today;
            log.info("Pivot daily signal counters reset for {}", today);
        }
    }

    // --- PUBLIC ACCESSORS ---

    public Map<String, Object> getLatestPivotSignal(String scripCode) {
        return latestPivotSignals.get(scripCode);
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
}
