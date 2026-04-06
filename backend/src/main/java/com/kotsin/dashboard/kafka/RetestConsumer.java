package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import com.kotsin.dashboard.service.ScripLookupService;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Kafka consumer for standalone RETEST strategy signals.
 *
 * RETEST identifies instruments that have broken a key pivot level on the daily timeframe
 * and are now retesting that level on lower timeframes (5m confirmed).
 *
 * Topic: kotsin_RETEST
 */
@Component
@Slf4j
public class RetestConsumer {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final ObjectMapper mapper = new ObjectMapper();
    private static final String REDIS_KEY_ACTIVE = "dashboard:retest:active-triggers";
    private static final String REDIS_KEY_ALL = "dashboard:retest:all-latest";
    private static final String REDIS_KEY_HISTORY = "dashboard:retest:signal-history";

    private final StringRedisTemplate redis;
    private final WebSocketSessionManager sessionManager;
    private final ScripLookupService scripLookup;

    @Value("${retest.signal.ttl.minutes:30}")
    private int signalTtlMinutes;

    // Active triggers: key = scripCode
    private final Cache<String, Map<String, Object>> activeTriggers = Caffeine.newBuilder()
            .expireAfterWrite(30, TimeUnit.MINUTES)
            .maximumSize(500)
            .build();

    // All latest (no expiry within day): key = scripCode
    private final Map<String, Map<String, Object>> allLatest = new ConcurrentHashMap<>();

    // Today's signal history (immutable): key = "scripCode-epoch"
    private final Map<String, Map<String, Object>> todaySignalHistory = new ConcurrentHashMap<>();

    // Dedup cache
    private final Cache<String, Boolean> dedupCache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(1000)
            .build();

    private volatile String currentTradeDate = LocalDate.now(IST).toString();

    public RetestConsumer(StringRedisTemplate redis, WebSocketSessionManager sessionManager,
                          ScripLookupService scripLookup) {
        this.redis = redis;
        this.sessionManager = sessionManager;
        this.scripLookup = scripLookup;
    }

    @KafkaListener(
            topics = "kotsin_RETEST",
            groupId = "${app.kafka.consumer.retest-dashboard-group-id:retest-dashboard}"
    )
    public void processRetestSignal(String payload) {
        try {
            JsonNode root = mapper.readTree(payload);
            String scripCode = root.path("scripCode").asText("");
            if (scripCode.isEmpty()) return;

            // Dedup
            String dedupKey = scripCode + "|" + root.path("timestamp").asLong(0);
            if (dedupCache.getIfPresent(dedupKey) != null) return;
            dedupCache.put(dedupKey, Boolean.TRUE);

            Map<String, Object> data = parseRetest(root);
            boolean triggered = Boolean.TRUE.equals(data.get("triggered"));

            if (triggered) {
                String direction = (String) data.get("direction");
                String companyName = (String) data.get("companyName");
                String retestSource = (String) data.get("retestSource");

                log.info("RETEST TRIGGER: {} ({}) direction={} level={} source={} RT={} label={} [signals today: {}]",
                        companyName, scripCode, direction,
                        data.get("retestLevel"), retestSource,
                        data.get("rtScore"), data.getOrDefault("rtScoreLabel", ""),
                        todaySignalHistory.size());

                long cachedAtMs = System.currentTimeMillis();
                data.put("cachedAt", cachedAtMs);
                data.put("signalSource", "RETEST");

                activeTriggers.put(scripCode, data);
                allLatest.put(scripCode, data);

                long epoch = data.containsKey("triggerTimeEpoch")
                        ? ((Number) data.get("triggerTimeEpoch")).longValue()
                        : cachedAtMs;
                String historyKey = scripCode + "-" + epoch;
                todaySignalHistory.put(historyKey, data);

                // Broadcast via WebSocket
                sessionManager.broadcastSignal(data);
            }
        } catch (Exception e) {
            log.error("retest_dashboard_error: {}", e.getMessage());
        }
    }

    private Map<String, Object> parseRetest(JsonNode root) {
        Map<String, Object> data = new HashMap<>();
        data.put("scripCode", root.path("scripCode").asText());
        data.put("symbol", root.path("symbol").asText());
        data.put("companyName", scripLookup.resolve(root.path("scripCode").asText(), root.path("companyName").asText("")));
        data.put("exchange", root.path("exchange").asText());
        data.put("triggered", root.path("triggered").asBoolean(false));
        data.put("direction", root.path("direction").asText("NONE"));
        data.put("triggerPrice", root.path("triggerPrice").asDouble(0));
        data.put("stopLoss", root.path("stopLoss").asDouble(0));

        // Retest-specific fields
        data.put("retestLevel", root.path("retestLevel").asDouble(0));
        data.put("retestSource", root.path("retestSource").asText(""));
        data.put("retestStage", root.path("retestStage").asText(""));
        data.put("retestLevelScore", root.path("retestLevelScore").asDouble(0));
        data.put("retestDistancePct", root.path("retestDistancePct").asDouble(0));
        data.put("atr30m", root.path("atr30m").asDouble(0));
        data.put("signalType", root.path("signalType").asText("RETEST"));
        data.put("strategy", root.path("strategy").asText("RETEST"));

        // Targets
        if (root.has("target1")) data.put("target1", root.path("target1").asDouble());
        if (root.has("target2")) data.put("target2", root.path("target2").asDouble());
        if (root.has("target3")) data.put("target3", root.path("target3").asDouble());
        if (root.has("tradeGrade")) data.put("tradeGrade", root.path("tradeGrade").asText(""));
        if (root.has("riskReward")) data.put("riskReward", root.path("riskReward").asDouble(0));

        // Trigger time
        long ts = root.path("timestamp").asLong(System.currentTimeMillis());
        data.put("triggerTimeEpoch", ts);
        data.put("triggerTime", LocalDateTime.ofInstant(Instant.ofEpochMilli(ts), IST).toString());

        // RT Score
        if (root.has("rtScore")) data.put("rtScore", root.path("rtScore").asDouble(0));
        if (root.has("rtScoreLabel")) data.put("rtScoreLabel", root.path("rtScoreLabel").asText(""));

        // Narrative
        if (root.has("narrative")) data.put("narrative", root.path("narrative").asText(""));

        // Fortress / Confluence
        if (root.has("fortressScore")) data.put("fortressScore", root.path("fortressScore").asDouble(0));
        if (root.has("fortressLevels")) data.put("fortressLevels", root.path("fortressLevels").asText(""));
        if (root.has("fortressLevelCount")) data.put("fortressLevelCount", root.path("fortressLevelCount").asInt(0));
        if (root.has("roomRatio")) data.put("roomRatio", root.path("roomRatio").asDouble(0));
        if (root.has("zoneCount")) data.put("zoneCount", root.path("zoneCount").asInt(0));
        if (root.has("entryQualityDesc")) data.put("entryQualityDesc", root.path("entryQualityDesc").asText(""));
        if (root.has("confluenceRR")) data.put("confluenceRR", root.path("confluenceRR").asDouble(0));

        // Volume / Block trade
        if (root.has("volumeSurge")) data.put("volumeSurge", root.path("volumeSurge").asDouble(0));
        if (root.has("blockTradePct")) data.put("blockTradePct", root.path("blockTradePct").asDouble(0));
        if (root.has("blockTradeFlowLabel")) data.put("blockTradeFlowLabel", root.path("blockTradeFlowLabel").asText("NONE"));

        // VIX
        if (root.has("indiaVix")) data.put("indiaVix", root.path("indiaVix").asDouble(0));
        if (root.has("vixRegime")) data.put("vixRegime", root.path("vixRegime").asText(""));

        // Multi-level retest
        if (root.has("retestLevelCount")) data.put("retestLevelCount", root.path("retestLevelCount").asInt(1));
        if (root.has("retestAllLevels")) data.put("retestAllLevels", root.path("retestAllLevels").asText(""));

        // Option enrichment
        data.put("optionAvailable", root.path("optionAvailable").asBoolean(false));
        if (root.has("optionScripCode")) data.put("optionScripCode", root.path("optionScripCode").asText());
        if (root.has("optionSymbol")) data.put("optionSymbol", root.path("optionSymbol").asText());
        if (root.has("optionStrike")) data.put("optionStrike", root.path("optionStrike").asDouble());
        if (root.has("optionType")) data.put("optionType", root.path("optionType").asText());
        if (root.has("optionExpiry")) data.put("optionExpiry", root.path("optionExpiry").asText());
        if (root.has("optionLtp")) data.put("optionLtp", root.path("optionLtp").asDouble());
        if (root.has("optionLotSize")) data.put("optionLotSize", root.path("optionLotSize").asInt(1));

        // Liquidity source (DIRECT / PROXY / ON_DEMAND / DISABLED)
        if (root.has("liquiditySource")) data.put("liquiditySource", root.path("liquiditySource").asText("DIRECT"));

        return data;
    }

    // --- PUBLIC ACCESSORS ---

    public Map<String, Map<String, Object>> getActiveTriggers() {
        return new HashMap<>(activeTriggers.asMap());
    }

    public int getActiveTriggerCount() { return (int) activeTriggers.estimatedSize(); }

    public Map<String, Object> getLatestRetest(String scripCode) {
        return allLatest.get(scripCode);
    }

    public List<Map<String, Object>> getAllLatestList() {
        return new ArrayList<>(allLatest.values());
    }

    public List<Map<String, Object>> getTodaySignalHistory() {
        return new ArrayList<>(todaySignalHistory.values());
    }

    // --- REDIS PERSISTENCE (every 2 min) ---

    @Scheduled(fixedRate = 120000)
    public void persistToRedis() {
        try {
            String today = LocalDate.now(IST).toString();
            if (!today.equals(currentTradeDate)) {
                activeTriggers.invalidateAll();
                allLatest.clear();
                todaySignalHistory.clear();
                currentTradeDate = today;
                log.info("[RETEST] Daily reset — cleared all caches for new trading day");
            }

            // Persist active triggers
            Map<String, Map<String, Object>> active = getActiveTriggers();
            if (!active.isEmpty()) {
                Map<String, String> serialized = new HashMap<>();
                for (var e : active.entrySet()) {
                    serialized.put(e.getKey(), mapper.writeValueAsString(e.getValue()));
                }
                redis.delete(REDIS_KEY_ACTIVE);
                redis.opsForHash().putAll(REDIS_KEY_ACTIVE, serialized);
            }

            // Persist all-latest
            if (!allLatest.isEmpty()) {
                Map<String, String> serialized = new HashMap<>();
                for (var e : allLatest.entrySet()) {
                    serialized.put(e.getKey(), mapper.writeValueAsString(e.getValue()));
                }
                redis.delete(REDIS_KEY_ALL);
                redis.opsForHash().putAll(REDIS_KEY_ALL, serialized);
            }

            log.info("RETEST persisted {} active triggers, {} all-latest, {} history to Redis",
                    active.size(), allLatest.size(), todaySignalHistory.size());
        } catch (Exception e) {
            log.warn("[RETEST] Redis persist error: {}", e.getMessage());
        }
    }

    @PreDestroy
    public void onShutdown() {
        persistToRedis();
    }
}
