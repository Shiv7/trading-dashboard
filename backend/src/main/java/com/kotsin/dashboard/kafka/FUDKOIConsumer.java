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
 * Kafka consumer for FUDKOI signals (OI-filtered FUDKII).
 *
 * FUDKOI = FUDKII + Open Interest Filter.
 * Consumes from: kotsin_FUDKOI
 */
@Component
@Slf4j
public class FUDKOIConsumer implements OptionSwapAware {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;
    private final SignalConsumer signalConsumer;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final String REDIS_KEY = "dashboard:fudkoi:active-triggers";
    private static final String REDIS_KEY_ALL = "dashboard:fudkoi:all-latest";
    private static final String REDIS_KEY_HISTORY = "dashboard:fudkoi:signal-history";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${signal.fudkoi.ttl.minutes:30}")
    private int signalTtlMinutes;

    @Value("${signal.fudkoi.max.per.day:5}")
    private int maxSignalsPerDay;

    private Cache<String, Map<String, Object>> activeTriggers;

    private final Map<String, Map<String, Object>> latestFUDKOI = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> todaySignalHistory = new ConcurrentHashMap<>();

    private final Cache<String, Boolean> dedupCache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(10000)
            .build();

    private final Map<String, Integer> dailySignalCount = new ConcurrentHashMap<>();
    private volatile LocalDate currentTradeDate = LocalDate.now(IST);

    public FUDKOIConsumer(
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
                        log.info("FUDKOI signal expired: {} (TTL={}min)", key, signalTtlMinutes);
                    }
                })
                .build();

        restoreFromRedis();
    }

    @KafkaListener(
            topics = {"kotsin_FUDKOI"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onFUDKOI(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in FUDKOI message, skipping");
                return;
            }

            String triggerTimeStr = root.path("triggerTime").asText("");
            String dedupKey = scripCode + "|" + triggerTimeStr;
            if (dedupCache.getIfPresent(dedupKey) != null) {
                log.debug("FUDKOI dedup: skipping duplicate for {} at {}", scripCode, triggerTimeStr);
                return;
            }
            dedupCache.put(dedupKey, Boolean.TRUE);

            Map<String, Object> fudkoiData = parseFUDKOI(root);
            boolean triggered = Boolean.TRUE.equals(fudkoiData.get("triggered"));

            if (triggered) {
                resetDailyCounterIfNeeded();
                String dailyKey = scripCode + "|" + currentTradeDate;
                int todayCount = dailySignalCount.getOrDefault(dailyKey, 0);
                if (todayCount >= maxSignalsPerDay) {
                    log.warn("FUDKOI daily cap reached: {} has {} signals today (max={})",
                            scripCode, todayCount, maxSignalsPerDay);
                    return;
                }
                dailySignalCount.merge(dailyKey, 1, Integer::sum);

                String direction = (String) fudkoiData.get("direction");
                String symbol = (String) fudkoiData.get("symbol");
                String companyName = (String) fudkoiData.get("companyName");
                String displayName = scripLookup.resolve(scripCode,
                        symbol != null && !symbol.isEmpty() ? symbol :
                        (companyName != null && !companyName.isEmpty() ? companyName : null));

                log.info("FUDKOI TRIGGER: {} ({}) direction={} oiRatio={} oiLabel={} [signals today: {}]",
                        displayName, scripCode, direction,
                        fudkoiData.get("oiChangeRatio"),
                        fudkoiData.get("oiLabel"),
                        todayCount + 1);

                long cachedAtMs = Instant.now().toEpochMilli();
                fudkoiData.put("cachedAt", cachedAtMs);
                activeTriggers.put(scripCode, fudkoiData);

                long epoch = fudkoiData.containsKey("triggerTimeEpoch")
                        ? ((Number) fudkoiData.get("triggerTimeEpoch")).longValue()
                        : cachedAtMs;
                String historyKey = scripCode + "-" + epoch;
                fudkoiData.put("signalSource", "FUDKOI");
                fudkoiData.put("signalType", "FUDKOI");
                todaySignalHistory.put(historyKey, fudkoiData);

                double triggerPrice = ((Number) fudkoiData.getOrDefault("triggerPrice", 0)).doubleValue();
                double bbUpper = ((Number) fudkoiData.getOrDefault("bbUpper", 0)).doubleValue();
                double bbLower = ((Number) fudkoiData.getOrDefault("bbLower", 0)).doubleValue();
                double superTrend = ((Number) fudkoiData.getOrDefault("superTrend", 0)).doubleValue();
                double triggerScore = ((Number) fudkoiData.getOrDefault("triggerScore", 0)).doubleValue();
                double oiChangeRatio = ((Number) fudkoiData.getOrDefault("oiChangeRatio", 0)).doubleValue();

                double stopLoss = ((Number) fudkoiData.getOrDefault("stopLoss", 0)).doubleValue();
                double target1 = ((Number) fudkoiData.getOrDefault("target1", 0)).doubleValue();
                double riskReward = ((Number) fudkoiData.getOrDefault("riskReward", 0)).doubleValue();
                boolean pivotSource = Boolean.TRUE.equals(fudkoiData.get("pivotSource"));

                if (stopLoss == 0) {
                    stopLoss = "BULLISH".equals(direction) ? Math.min(bbLower, superTrend) : Math.max(bbUpper, superTrend);
                    target1 = "BULLISH".equals(direction)
                            ? triggerPrice + 2 * (triggerPrice - stopLoss)
                            : triggerPrice - 2 * (stopLoss - triggerPrice);
                    riskReward = stopLoss != triggerPrice
                            ? Math.abs((target1 - triggerPrice) / (triggerPrice - stopLoss)) : 0;
                    pivotSource = false;
                    log.warn("FUDKOI {} using BB/ST fallback SL (no pivot data in payload)", scripCode);
                }

                String slSource = pivotSource ? "PIVOT" : "BB/ST";
                String rationale = String.format("FUDKOI: OI=%.1f%% %s | Score=%.2f | SL=%.2f (%s) T1=%.2f RR=%.2f | BB[%.2f-%.2f] ST=%.2f",
                        oiChangeRatio, fudkoiData.get("oiLabel"),
                        triggerScore, stopLoss, slSource, target1, riskReward,
                        bbLower, bbUpper, superTrend);

                SignalDTO signalDTO = SignalDTO.builder()
                        .signalId(UUID.randomUUID().toString())
                        .scripCode(scripCode)
                        .companyName(displayName)
                        .timestamp(LocalDateTime.now(IST))
                        .signalSource("FUDKOI")
                        .signalSourceLabel("FUDKOI Trigger")
                        .signalType("FUDKOI")
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
                log.info("FUDKOI signal added to signals cache: {} {} @ {}", scripCode, direction, triggerPrice);

                String emoji = "BULLISH".equals(direction) ? "^" : "v";
                sessionManager.broadcastNotification("FUDKOI_TRIGGER",
                        String.format("%s %s FUDKOI (OI-confirmed) for %s @ %.2f | OI=%.1f%% %s",
                                emoji, direction, displayName, triggerPrice,
                                oiChangeRatio, fudkoiData.get("oiLabel")));

                latestFUDKOI.put(scripCode, fudkoiData);

                // Broadcast triggered signal to /topic/fudkoi (WebSocket push to frontend)
                sessionManager.broadcastFUDKOI(scripCode, fudkoiData);
            }

        } catch (Exception e) {
            log.error("Error processing FUDKOI: {}", e.getMessage(), e);
        }
    }

    private Map<String, Object> parseFUDKOI(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        data.put("scripCode", root.path("scripCode").asText());
        data.put("symbol", root.path("symbol").asText());
        data.put("companyName", scripLookup.resolve(root.path("scripCode").asText(), root.path("companyName").asText("")));
        data.put("exchange", root.path("exchange").asText());

        data.put("triggered", root.path("triggered").asBoolean(false));
        data.put("direction", root.path("direction").asText("NONE"));
        data.put("reason", root.path("reason").asText(""));
        double fudkoiTrigPrice = root.path("triggerPrice").asDouble(0);
        if (fudkoiTrigPrice <= 0) fudkoiTrigPrice = root.path("entryPrice").asDouble(0);
        data.put("triggerPrice", fudkoiTrigPrice);
        data.put("triggerScore", root.path("triggerScore").asDouble(0));

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

        // BB + SuperTrend
        data.put("bbUpper", root.path("bbUpper").asDouble(0));
        data.put("bbMiddle", root.path("bbMiddle").asDouble(0));
        data.put("bbLower", root.path("bbLower").asDouble(0));
        data.put("superTrend", root.path("superTrend").asDouble(0));
        data.put("trend", root.path("trend").asText("NONE"));
        data.put("trendChanged", root.path("trendChanged").asBoolean(false));
        data.put("pricePosition", root.path("pricePosition").asText("BETWEEN"));

        // Pivot-derived trade levels
        data.put("stopLoss", root.path("stopLoss").asDouble(0));
        data.put("target1", root.path("target1").asDouble(0));
        data.put("target2", root.path("target2").asDouble(0));
        data.put("target3", root.path("target3").asDouble(0));
        data.put("target4", root.path("target4").asDouble(0));
        data.put("riskReward", root.path("riskReward").asDouble(0));
        data.put("pivotSource", root.path("pivotSource").asBoolean(false));
        data.put("atr30m", root.path("atr30m").asDouble(0));

        // OI fields (primary for FUDKOI)
        data.put("oiChangeRatio", root.path("oiChangeRatio").asDouble(0));
        data.put("oiInterpretation", root.path("oiInterpretation").asText("NEUTRAL"));
        data.put("oiLabel", root.path("oiLabel").asText(""));

        // Option enrichment
        data.put("optionAvailable", root.path("optionAvailable").asBoolean(false));
        if (root.has("optionFailureReason")) data.put("optionFailureReason", root.path("optionFailureReason").asText());
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

        // ConfluentTargetEngine v2 metadata
        if (root.has("confluenceGrade")) data.put("confluenceGrade", root.path("confluenceGrade").asText(""));
        if (root.has("confluenceRejectReason")) data.put("confluenceRejectReason", root.path("confluenceRejectReason").asText(""));
        if (root.has("confluenceFortressScore")) data.put("confluenceFortressScore", root.path("confluenceFortressScore").asDouble(0));
        if (root.has("confluenceRoomRatio")) data.put("confluenceRoomRatio", root.path("confluenceRoomRatio").asDouble(0));
        if (root.has("confluenceEntryQuality")) data.put("confluenceEntryQuality", root.path("confluenceEntryQuality").asText(""));
        if (root.has("confluenceSlScore")) data.put("confluenceSlScore", root.path("confluenceSlScore").asDouble(0));
        if (root.has("confluenceT1Score")) data.put("confluenceT1Score", root.path("confluenceT1Score").asDouble(0));
        if (root.has("confluenceLotAllocation")) data.put("confluenceLotAllocation", root.path("confluenceLotAllocation").asText(""));
        if (root.has("confluenceZoneCount")) data.put("confluenceZoneCount", root.path("confluenceZoneCount").asInt(0));
        if (root.has("confluenceTimePhase")) data.put("confluenceTimePhase", root.path("confluenceTimePhase").asText(""));
        if (root.has("confluenceTimeSlMultiplier")) data.put("confluenceTimeSlMultiplier", root.path("confluenceTimeSlMultiplier").asDouble(1.0));
        if (root.has("confluenceT2Score")) data.put("confluenceT2Score", root.path("confluenceT2Score").asDouble(0));
        if (root.has("confluenceT3Score")) data.put("confluenceT3Score", root.path("confluenceT3Score").asDouble(0));
        if (root.has("confluenceT4Score")) data.put("confluenceT4Score", root.path("confluenceT4Score").asDouble(0));
        if (root.has("confluenceSL")) data.put("confluenceSL", root.path("confluenceSL").asDouble(0));
        if (root.has("confluenceT1")) data.put("confluenceT1", root.path("confluenceT1").asDouble(0));
        if (root.has("confluenceT2")) data.put("confluenceT2", root.path("confluenceT2").asDouble(0));
        if (root.has("confluenceT3")) data.put("confluenceT3", root.path("confluenceT3").asDouble(0));
        if (root.has("confluenceT4")) data.put("confluenceT4", root.path("confluenceT4").asDouble(0));
        if (root.has("confluenceRR")) data.put("confluenceRR", root.path("confluenceRR").asDouble(0));

        // Greek enrichment fields (Black-Scholes computed by Streaming Candle)
        if (root.has("greekEnriched")) data.put("greekEnriched", root.path("greekEnriched").asBoolean(false));
        if (root.has("greekDelta")) data.put("greekDelta", root.path("greekDelta").asDouble(0));
        if (root.has("greekGamma")) data.put("greekGamma", root.path("greekGamma").asDouble(0));
        if (root.has("greekTheta")) data.put("greekTheta", root.path("greekTheta").asDouble(0));
        if (root.has("greekVega")) data.put("greekVega", root.path("greekVega").asDouble(0));
        if (root.has("greekIV")) data.put("greekIV", root.path("greekIV").asDouble(0));
        if (root.has("greekDte")) data.put("greekDte", root.path("greekDte").asInt(0));
        if (root.has("greekMoneynessType")) data.put("greekMoneynessType", root.path("greekMoneynessType").asText("UNKNOWN"));
        if (root.has("greekThetaImpaired")) data.put("greekThetaImpaired", root.path("greekThetaImpaired").asBoolean(false));
        if (root.has("greekSlMethod")) data.put("greekSlMethod", root.path("greekSlMethod").asText());
        if (root.has("greekGammaBoost")) data.put("greekGammaBoost", root.path("greekGammaBoost").asDouble(0));
        if (root.has("optionRR")) data.put("optionRR", root.path("optionRR").asDouble(0));
        if (root.has("optionRRpassed")) data.put("optionRRpassed", root.path("optionRRpassed").asBoolean(false));
        if (root.has("optionSL")) data.put("optionSL", root.path("optionSL").asDouble(0));
        if (root.has("optionT1")) data.put("optionT1", root.path("optionT1").asDouble(0));
        if (root.has("optionT2")) data.put("optionT2", root.path("optionT2").asDouble(0));
        if (root.has("optionT3")) data.put("optionT3", root.path("optionT3").asDouble(0));
        if (root.has("optionT4")) data.put("optionT4", root.path("optionT4").asDouble(0));
        if (root.has("optionLotAllocation")) data.put("optionLotAllocation", root.path("optionLotAllocation").asText());

        // Futures fallback
        data.put("futuresAvailable", root.path("futuresAvailable").asBoolean(false));
        if (root.has("futuresScripCode")) data.put("futuresScripCode", root.path("futuresScripCode").asText());
        if (root.has("futuresSymbol")) data.put("futuresSymbol", root.path("futuresSymbol").asText());
        if (root.has("futuresLtp")) data.put("futuresLtp", root.path("futuresLtp").asDouble());
        if (root.has("futuresLotSize")) data.put("futuresLotSize", root.path("futuresLotSize").asInt(1));
        if (root.has("futuresMultiplier")) data.put("futuresMultiplier", root.path("futuresMultiplier").asInt(1));
        if (root.has("futuresExpiry")) data.put("futuresExpiry", root.path("futuresExpiry").asText());
        if (root.has("futuresExchange")) data.put("futuresExchange", root.path("futuresExchange").asText());
        if (root.has("futuresExchangeType")) data.put("futuresExchangeType", root.path("futuresExchangeType").asText());

        // Volume data (may still be present from FUDKII base)
        if (root.has("surgeT")) data.put("surgeT", root.path("surgeT").asDouble(0));
        if (root.has("avgVolume")) data.put("avgVolume", root.path("avgVolume").asDouble(0));

        // Retest enrichment fields
        if (root.has("retestActive")) data.put("retestActive", root.path("retestActive").asBoolean(false));
        if (root.has("retestLevel")) data.put("retestLevel", root.path("retestLevel").asDouble(0));
        if (root.has("retestSource")) data.put("retestSource", root.path("retestSource").asText(""));
        if (root.has("retestStage")) data.put("retestStage", root.path("retestStage").asText(""));
        if (root.has("retestDirectionAligned")) data.put("retestDirectionAligned", root.path("retestDirectionAligned").asBoolean(false));
        if (root.has("retestBoost")) data.put("retestBoost", root.path("retestBoost").asDouble(0));

        // Liquidity source (DIRECT / PROXY / ON_DEMAND / DISABLED)
        if (root.has("liquiditySource")) data.put("liquiditySource", root.path("liquiditySource").asText("DIRECT"));

        return data;
    }

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

            Map<String, Map<String, Object>> allSnapshot = new HashMap<>(latestFUDKOI);
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

            log.info("FUDKOI persisted {} active triggers, {} all-latest, {} history to Redis",
                    snapshot.size(), allSnapshot.size(), historySnapshot.size());
        } catch (Exception e) {
            log.error("Failed to persist FUDKOI triggers to Redis: {}", e.getMessage());
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
                        if (cachedAt > 0 && (now - cachedAt) > maxAgeMs) {
                            continue;
                        }
                        activeTriggers.put((String) entry.getKey(), data);
                        latestFUDKOI.put((String) entry.getKey(), data);
                        restoredActive++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUDKOI trigger {}: {}", entry.getKey(), e.getMessage());
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
                        latestFUDKOI.putIfAbsent((String) entry.getKey(), data);
                        restoredAll++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUDKOI all-latest {}: {}", entry.getKey(), e.getMessage());
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
                            latestFUDKOI.putIfAbsent(sc, data);
                        }
                        restoredHistory++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUDKOI history {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            log.info("FUDKOI restored {} active triggers + {} all-latest + {} history from Redis",
                    restoredActive, restoredAll, restoredHistory);
        } catch (Exception e) {
            log.error("Failed to restore FUDKOI triggers from Redis: {}", e.getMessage());
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
            latestFUDKOI.clear();
            currentTradeDate = today;
            log.info("FUDKOI daily counters, history and latest reset for {}", today);
        }
    }

    // --- PUBLIC ACCESSORS ---

    public Map<String, Object> getLatestFUDKOI(String scripCode) {
        return latestFUDKOI.get(scripCode);
    }

    public Map<String, Map<String, Object>> getActiveTriggers() {
        return new HashMap<>(activeTriggers.asMap());
    }

    public int getActiveTriggerCount() {
        return (int) activeTriggers.estimatedSize();
    }

    public Map<String, Map<String, Object>> getAllLatestSignals() {
        return new HashMap<>(latestFUDKOI);
    }

    public List<Map<String, Object>> getTodaySignalHistory() {
        return new ArrayList<>(todaySignalHistory.values());
    }

    public int getTodaySignalHistoryCount() {
        return todaySignalHistory.size();
    }

    @Override
    public void updateTradedOption(String underlyingScripCode, String strategy,
                                   String newScripCode, String newSymbol,
                                   double newStrike, double newLtp, String optionType) {
        if (!"FUDKOI".equals(strategy)) return;

        Map<String, Object> signal = latestFUDKOI.get(underlyingScripCode);
        if (signal != null) {
            signal.put("optionAvailable", true);
            signal.put("optionPendingSwap", false);
            signal.put("optionScripCode", newScripCode);
            signal.put("optionSymbol", newSymbol);
            signal.put("optionStrike", newStrike);
            signal.put("optionLtp", newLtp);
            signal.put("optionType", optionType);
            log.info("FUDKOI option swap applied to cached signal: scrip={} -> {}@{} strike={}",
                    underlyingScripCode, newSymbol, newLtp, newStrike);
            sessionManager.broadcastFUDKOI(underlyingScripCode, signal);
        }

        Map<String, Object> trigger = activeTriggers.getIfPresent(underlyingScripCode);
        if (trigger != null) {
            trigger.put("optionAvailable", true);
            trigger.put("optionPendingSwap", false);
            trigger.put("optionScripCode", newScripCode);
            trigger.put("optionSymbol", newSymbol);
            trigger.put("optionStrike", newStrike);
            trigger.put("optionLtp", newLtp);
            trigger.put("optionType", optionType);
        }
    }
}
