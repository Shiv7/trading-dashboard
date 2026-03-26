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
public class FUDKIIConsumer implements OptionSwapAware {

    private final WebSocketSessionManager sessionManager;
    private final RedisTemplate<String, String> redisTemplate;
    private final SignalConsumer signalConsumer;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final String REDIS_KEY = "dashboard:fudkii:active-triggers";
    private static final String REDIS_KEY_ALL = "dashboard:fudkii:all-latest";
    private static final String REDIS_KEY_HISTORY = "dashboard:fudkii:signal-history";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${signal.fudkii.ttl.minutes:30}")
    private int signalTtlMinutes;

    @Value("${signal.fudkii.max.per.day:5}")
    private int maxSignalsPerDay;

    // Active triggers with TTL via Caffeine
    private Cache<String, Map<String, Object>> activeTriggers;

    // Cache latest FUDKII signals (no TTL needed - informational only)
    private final Map<String, Map<String, Object>> latestFUDKII = new ConcurrentHashMap<>();

    // Signal history: key = "scripCode-triggerTimeEpoch", stores ALL triggered signals for today
    // This is the immutable history — entries are never overwritten or removed (except daily reset)
    private final Map<String, Map<String, Object>> todaySignalHistory = new ConcurrentHashMap<>();

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

            // --- NSE TRADING HOURS FILTER (checks signal's own trigger time, not wall clock) ---
            String exchange = root.path("exchange").asText("");
            if ("N".equals(exchange)) {
                long triggerEpoch = root.path("triggerTimeEpoch").asLong(0);
                if (triggerEpoch > 0) {
                    java.time.LocalTime triggerIST = Instant.ofEpochMilli(triggerEpoch).atZone(IST).toLocalTime();
                    if (triggerIST.isBefore(java.time.LocalTime.of(9, 15)) || triggerIST.isAfter(java.time.LocalTime.of(15, 30))) {
                        log.debug("FUDKII skipping NSE signal outside trading hours: {} triggerTime={}", scripCode, triggerIST);
                        return;
                    }
                }
            }

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
                long cachedAtMs = Instant.now().toEpochMilli();
                fudkiiData.put("cachedAt", cachedAtMs);
                activeTriggers.put(scripCode, fudkiiData);

                // Append to today's signal history (immutable — never overwritten)
                long epoch = fudkiiData.containsKey("triggerTimeEpoch")
                        ? ((Number) fudkiiData.get("triggerTimeEpoch")).longValue()
                        : cachedAtMs;
                String historyKey = scripCode + "-" + epoch;
                fudkiiData.put("signalSource", "FUDKII");
                todaySignalHistory.put(historyKey, fudkiiData);

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
                // Update latest (only triggered signals update the latest map)
                latestFUDKII.put(scripCode, fudkiiData);

                // Broadcast triggered signal to /topic/fudkii (WebSocket push to frontend)
                sessionManager.broadcastFUDKII(scripCode, fudkiiData);
            } else {
                // Remove from active triggers if no longer triggered
                activeTriggers.invalidate(scripCode);
                // NOTE: Do NOT overwrite latestFUDKII — preserve the last triggered state
            }

        } catch (Exception e) {
            log.error("Error processing FUDKII: {}", e.getMessage(), e);
        }
    }

    /**
     * Check if a signal is an NSE signal with triggerTimeEpoch outside NSE trading hours (9:15-15:30 IST).
     */
    private boolean isNseOutsideHours(Map<String, Object> data) {
        String exch = (String) data.get("exchange");
        if (!"N".equals(exch)) return false;
        Object epochObj = data.get("triggerTimeEpoch");
        if (epochObj == null) return false;
        long epoch = ((Number) epochObj).longValue();
        java.time.LocalTime triggerIST = Instant.ofEpochMilli(epoch)
                .atZone(IST).toLocalTime();
        return triggerIST.isBefore(java.time.LocalTime.of(9, 15))
                || triggerIST.isAfter(java.time.LocalTime.of(15, 30));
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

        // OI enrichment fields
        if (root.has("oiChangeRatio")) data.put("oiChangeRatio", root.path("oiChangeRatio").asDouble(0));
        if (root.has("oiInterpretation")) data.put("oiInterpretation", root.path("oiInterpretation").asText("NEUTRAL"));
        if (root.has("oiLabel")) data.put("oiLabel", root.path("oiLabel").asText(""));

        // Volume surge fields (real data from FUKAA-style calculation)
        if (root.has("surgeT")) data.put("surgeT", root.path("surgeT").asDouble(0));
        if (root.has("surgeTMinus1")) data.put("surgeTMinus1", root.path("surgeTMinus1").asDouble(0));
        if (root.has("volumeT")) data.put("volumeT", root.path("volumeT").asLong(0));
        if (root.has("volumeTMinus1")) data.put("volumeTMinus1", root.path("volumeTMinus1").asLong(0));
        if (root.has("avgVolume")) data.put("avgVolume", root.path("avgVolume").asDouble(0));

        // OI Buildup % (cumulative OI vs yesterday's close)
        if (root.has("oiBuildupPct")) data.put("oiBuildupPct", root.path("oiBuildupPct").asDouble(0));

        // Block trade detection (MAD-based)
        data.put("blockTradeDetected", root.path("blockTradeDetected").asBoolean(false));
        if (root.has("blockTradeVol")) data.put("blockTradeVol", root.path("blockTradeVol").asLong(0));
        if (root.has("blockTradePct")) data.put("blockTradePct", root.path("blockTradePct").asDouble(0));
        if (root.has("blockTradeFlowLabel")) data.put("blockTradeFlowLabel", root.path("blockTradeFlowLabel").asText("NONE"));

        // KII quality adjustment fields (from MarketContextService in StreamingCandle)
        if (root.has("effectiveKii")) data.put("effectiveKii", root.path("effectiveKii").asDouble(0));
        if (root.has("rawKii")) data.put("rawKii", root.path("rawKii").asDouble(0));
        if (root.has("gapFactor")) data.put("gapFactor", root.path("gapFactor").asDouble(1.0));
        if (root.has("expiryFactor")) data.put("expiryFactor", root.path("expiryFactor").asDouble(1.0));
        if (root.has("gapPct")) data.put("gapPct", root.path("gapPct").asDouble(0));
        if (root.has("excessGapPct")) data.put("excessGapPct", root.path("excessGapPct").asDouble(0));
        if (root.has("niftyGapPct")) data.put("niftyGapPct", root.path("niftyGapPct").asDouble(0));
        if (root.has("alignmentScore")) data.put("alignmentScore", root.path("alignmentScore").asDouble(0));
        if (root.has("kiiLabel")) data.put("kiiLabel", root.path("kiiLabel").asText(""));
        if (root.has("volumeLabel")) data.put("volumeLabel", root.path("volumeLabel").asText(""));
        if (root.has("oiChangeLabel")) data.put("oiChangeLabel", root.path("oiChangeLabel").asText(""));
        if (root.has("oiBuildupLabel")) data.put("oiBuildupLabel", root.path("oiBuildupLabel").asText(""));
        if (root.has("gapWarning")) data.put("gapWarning", root.path("gapWarning").asText(""));
        if (root.has("expiryWarning")) data.put("expiryWarning", root.path("expiryWarning").asText(""));
        if (root.has("vixContext")) data.put("vixContext", root.path("vixContext").asText(""));
        if (root.has("indiaVix")) data.put("indiaVix", root.path("indiaVix").asDouble(0));
        if (root.has("vixRegime")) data.put("vixRegime", root.path("vixRegime").asText(""));
        if (root.has("vixAmplifier")) data.put("vixAmplifier", root.path("vixAmplifier").asDouble(1.0));
        if (root.has("vixCoupling")) data.put("vixCoupling", root.path("vixCoupling").asDouble(0.8));
        if (root.has("giftNiftyOvernightChangePct")) data.put("giftNiftyOvernightChangePct", root.path("giftNiftyOvernightChangePct").asDouble(0));

        // Greek enrichment from OptionDataEnricher (Black-Scholes computed)
        data.put("greekEnriched", root.path("greekEnriched").asBoolean(false));
        if (root.has("greekDelta")) data.put("greekDelta", root.path("greekDelta").asDouble(0));
        if (root.has("greekGamma")) data.put("greekGamma", root.path("greekGamma").asDouble(0));
        if (root.has("greekTheta")) data.put("greekTheta", root.path("greekTheta").asDouble(0));
        if (root.has("greekVega")) data.put("greekVega", root.path("greekVega").asDouble(0));
        if (root.has("greekIV")) data.put("greekIV", root.path("greekIV").asDouble(0));
        if (root.has("greekDte")) data.put("greekDte", root.path("greekDte").asInt(0));
        if (root.has("greekMoneynessType")) data.put("greekMoneynessType", root.path("greekMoneynessType").asText(""));
        if (root.has("greekThetaImpaired")) data.put("greekThetaImpaired", root.path("greekThetaImpaired").asBoolean(false));
        if (root.has("greekSlMethod")) data.put("greekSlMethod", root.path("greekSlMethod").asText(""));
        if (root.has("greekGammaBoost")) data.put("greekGammaBoost", root.path("greekGammaBoost").asDouble(0));

        // Cross-instrumental option targets (from OptionDataEnricher)
        if (root.has("optionSL")) data.put("optionSL", root.path("optionSL").asDouble(0));
        if (root.has("optionT1")) data.put("optionT1", root.path("optionT1").asDouble(0));
        if (root.has("optionT2")) data.put("optionT2", root.path("optionT2").asDouble(0));
        if (root.has("optionT3")) data.put("optionT3", root.path("optionT3").asDouble(0));
        if (root.has("optionT4")) data.put("optionT4", root.path("optionT4").asDouble(0));
        if (root.has("optionRR")) data.put("optionRR", root.path("optionRR").asDouble(0));
        if (root.has("optionRRpassed")) data.put("optionRRpassed", root.path("optionRRpassed").asBoolean(true));
        if (root.has("optionLotAllocation")) data.put("optionLotAllocation", root.path("optionLotAllocation").asText("40,30,20,10"));

        // ConfluentTargetEngine v2 metadata (trade quality grading + confluence analysis)
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
        // Confluence-computed equity levels + R:R
        if (root.has("confluenceSL")) data.put("confluenceSL", root.path("confluenceSL").asDouble(0));
        if (root.has("confluenceT1")) data.put("confluenceT1", root.path("confluenceT1").asDouble(0));
        if (root.has("confluenceT2")) data.put("confluenceT2", root.path("confluenceT2").asDouble(0));
        if (root.has("confluenceT3")) data.put("confluenceT3", root.path("confluenceT3").asDouble(0));
        if (root.has("confluenceT4")) data.put("confluenceT4", root.path("confluenceT4").asDouble(0));
        if (root.has("confluenceRR")) data.put("confluenceRR", root.path("confluenceRR").asDouble(0));
        // Part B: Option confluence targets
        if (root.has("confluenceOptSL")) data.put("confluenceOptSL", root.path("confluenceOptSL").asDouble(0));
        if (root.has("confluenceOptT1")) data.put("confluenceOptT1", root.path("confluenceOptT1").asDouble(0));
        if (root.has("confluenceOptT2")) data.put("confluenceOptT2", root.path("confluenceOptT2").asDouble(0));
        if (root.has("confluenceOptT3")) data.put("confluenceOptT3", root.path("confluenceOptT3").asDouble(0));
        if (root.has("confluenceOptT4")) data.put("confluenceOptT4", root.path("confluenceOptT4").asDouble(0));
        if (root.has("confluenceOptRR")) data.put("confluenceOptRR", root.path("confluenceOptRR").asDouble(0));
        if (root.has("confluenceOptSlScore")) data.put("confluenceOptSlScore", root.path("confluenceOptSlScore").asDouble(0));
        if (root.has("confluenceOptT1Score")) data.put("confluenceOptT1Score", root.path("confluenceOptT1Score").asDouble(0));
        if (root.has("confluenceOptT2Score")) data.put("confluenceOptT2Score", root.path("confluenceOptT2Score").asDouble(0));
        if (root.has("confluenceOptT3Score")) data.put("confluenceOptT3Score", root.path("confluenceOptT3Score").asDouble(0));
        if (root.has("confluenceOptT4Score")) data.put("confluenceOptT4Score", root.path("confluenceOptT4Score").asDouble(0));
        if (root.has("confluenceOptZoneCount")) data.put("confluenceOptZoneCount", root.path("confluenceOptZoneCount").asInt(0));

        // Cross-instrumental futures targets (for MCX/commodity)
        if (root.has("futuresSL")) data.put("futuresSL", root.path("futuresSL").asDouble(0));
        if (root.has("futuresT1")) data.put("futuresT1", root.path("futuresT1").asDouble(0));
        if (root.has("futuresT2")) data.put("futuresT2", root.path("futuresT2").asDouble(0));
        if (root.has("futuresT3")) data.put("futuresT3", root.path("futuresT3").asDouble(0));
        if (root.has("futuresT4")) data.put("futuresT4", root.path("futuresT4").asDouble(0));

        // Option enrichment fields (real LTP, strike, lot size from OptionDataEnricher)
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

        // Futures fallback fields (currency/MCX instruments without options)
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

            // Persist today's signal history (immutable records — survives restart)
            String historyRedisKey = REDIS_KEY_HISTORY + ":" + currentTradeDate;
            Map<String, Map<String, Object>> historySnapshot = new HashMap<>(todaySignalHistory);
            if (!historySnapshot.isEmpty()) {
                for (Map.Entry<String, Map<String, Object>> entry : historySnapshot.entrySet()) {
                    String json = objectMapper.writeValueAsString(entry.getValue());
                    redisTemplate.opsForHash().put(historyRedisKey, entry.getKey(), json);
                }
                // Expire after 24h (auto-cleanup old days)
                redisTemplate.expire(historyRedisKey, 24 * 60, TimeUnit.MINUTES);
            }

            log.info("FUDKII persisted {} active triggers, {} all-latest, {} history to Redis",
                    snapshot.size(), allSnapshot.size(), historySnapshot.size());
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
                        // Skip NSE signals outside trading hours
                        if (isNseOutsideHours(data)) {
                            log.info("FUDKII restore skipping stale NSE signal: {}", entry.getKey());
                            continue;
                        }
                        latestFUDKII.putIfAbsent((String) entry.getKey(), data);
                        restoredAll++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUDKII all-latest {}: {}", entry.getKey(), e.getMessage());
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
                        // Skip NSE signals outside trading hours
                        if (isNseOutsideHours(data)) {
                            continue;
                        }
                        todaySignalHistory.putIfAbsent((String) entry.getKey(), data);
                        // Also ensure latestFUDKII has this triggered signal
                        String sc = (String) data.get("scripCode");
                        if (sc != null && Boolean.TRUE.equals(data.get("triggered"))) {
                            latestFUDKII.putIfAbsent(sc, data);
                        }
                        restoredHistory++;
                    } catch (Exception e) {
                        log.warn("Failed to restore FUDKII history {}: {}", entry.getKey(), e.getMessage());
                    }
                }
            }

            log.info("FUDKII restored {} active triggers + {} all-latest + {} history from Redis",
                    restoredActive, restoredAll, restoredHistory);
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
            todaySignalHistory.clear();
            latestFUDKII.clear();
            currentTradeDate = today;
            log.info("FUDKII daily counters, history and latest reset for {}", today);
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

    @Override
    public void updateTradedOption(String underlyingScripCode, String strategy,
                                   String newScripCode, String newSymbol,
                                   double newStrike, double newLtp, String optionType) {
        if (!"FUDKII".equals(strategy)) return;

        Map<String, Object> signal = latestFUDKII.get(underlyingScripCode);
        if (signal != null) {
            signal.put("optionAvailable", true);
            signal.put("optionPendingSwap", false);
            signal.put("optionScripCode", newScripCode);
            signal.put("optionSymbol", newSymbol);
            signal.put("optionStrike", newStrike);
            signal.put("optionLtp", newLtp);
            signal.put("optionType", optionType);
            log.info("FUDKII OTM option applied to cached signal: scrip={} → {}@{} strike={}",
                    underlyingScripCode, newSymbol, newLtp, newStrike);
            sessionManager.broadcastFUDKII(underlyingScripCode, signal);
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
