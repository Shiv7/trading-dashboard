package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import com.kotsin.dashboard.model.dto.SignalDTO;
import com.kotsin.dashboard.model.dto.StrategyTradeRequest;
import com.kotsin.dashboard.service.ScripLookupService;
import com.kotsin.dashboard.service.StrategyTradeExecutor;
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
 * Consumes from: kotsin_MERE, kotsin_MERE_SCALP, kotsin_MERE_SWING, kotsin_MERE_POSITIONAL
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

    @Value("${mere.auto.execute.enabled:false}")
    private boolean autoExecuteEnabled;

    @Value("${mere.auto.execute.max.positions:8}")
    private int autoExecuteMaxPositions;

    @Value("${mere.auto.execute.premium.sizing.percent:2.5}")
    private double premiumSizingPercent;

    private final StrategyTradeExecutor strategyTradeExecutor;

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
            ScripLookupService scripLookup,
            StrategyTradeExecutor strategyTradeExecutor) {
        this.sessionManager = sessionManager;
        this.redisTemplate = redisTemplate;
        this.signalConsumer = signalConsumer;
        this.scripLookup = scripLookup;
        this.strategyTradeExecutor = strategyTradeExecutor;
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
            topics = {"kotsin_MERE", "kotsin_MERE_SCALP", "kotsin_MERE_SWING", "kotsin_MERE_POSITIONAL"},
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

            // Dedup check — use scripCode + direction (not triggerTime) to catch cross-variant duplicates.
            // MERE v2, ScalpMERE, SwingMERE can all fire for the same scrip at the same M30 boundary
            // with slightly different triggerTime values. 5-min TTL prevents showing both.
            String triggerTimeStr = root.path("triggerTime").asText("");
            String dedupDir = root.path("direction").asText("UNKNOWN");
            String dedupKey = scripCode + "|" + dedupDir;
            if (dedupCache.getIfPresent(dedupKey) != null) {
                log.debug("MERE dedup: skipping cross-variant duplicate for {} {} (first variant already processed)",
                        scripCode, dedupDir);
                return;
            }
            dedupCache.put(dedupKey, Boolean.TRUE);

            Map<String, Object> mereData = parseMERE(root);
            boolean triggered = Boolean.TRUE.equals(mereData.get("triggered"));
            String variant = (String) mereData.getOrDefault("mereVariant", "MERE");

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

                String variantTag = "MERE".equals(variant) ? "" : " [" + variant + "]";
                log.info("MERE TRIGGER{}: {} ({}) direction={} score={} [L1={} L2={} L3={} bonus={}] [signals today: {}]",
                        variantTag, displayName, scripCode, direction,
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

                String horizon = switch (variant) {
                    case "MERE_SCALP" -> "SCALP";
                    case "MERE_SWING" -> "SWING";
                    case "MERE_POSITIONAL" -> "POSITIONAL";
                    default -> "INTRADAY";
                };
                String sourceLabel = switch (variant) {
                    case "MERE_SCALP" -> "Mean Reversion (Scalp)";
                    case "MERE_SWING" -> "Mean Reversion (Swing)";
                    case "MERE_POSITIONAL" -> "Mean Reversion (Positional)";
                    default -> "Mean Reversion";
                };

                SignalDTO signalDTO = SignalDTO.builder()
                        .signalId(UUID.randomUUID().toString())
                        .scripCode(scripCode)
                        .companyName(displayName)
                        .timestamp(LocalDateTime.now(IST))
                        .signalSource("MERE")
                        .signalSourceLabel(sourceLabel)
                        .signalType("MERE")
                        .horizon(horizon)
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

                // MERE v2 Auto-execution: if signal has autoExecute=true and config is enabled
                boolean autoExecute = mereData.containsKey("autoExecute") &&
                    Boolean.TRUE.equals(mereData.get("autoExecute"));
                if (autoExecuteEnabled && autoExecute) {
                    try {
                        autoExecuteTrade(mereData, scripCode, direction, triggerPrice);
                    } catch (Exception ex) {
                        log.error("MERE auto-execute failed for {}: {}", scripCode, ex.getMessage(), ex);
                    }
                }

                // Send notification
                String emoji = "BULLISH".equals(direction) ? "^" : "v";
                String notifLabel = "MERE".equals(variant) ? "MERE (mean reversion)"
                        : variant.replace("MERE_", "MERE ").toLowerCase() + " (mean reversion)";
                sessionManager.broadcastNotification("MERE_TRIGGER",
                        String.format("%s %s %s for %s @ %.2f | Score=%.0f",
                                emoji, direction, notifLabel, displayName, triggerPrice, mereScore));

                // Update latest
                latestMERE.put(scripCode, mereData);

                // Broadcast triggered signal to /topic/mere (WebSocket push to frontend)
                sessionManager.broadcastMERE(scripCode, mereData);
            }

        } catch (Exception e) {
            log.error("Error processing MERE: {}", e.getMessage(), e);
        }
    }

    /**
     * Auto-execute a MERE v2 trade via StrategyTradeExecutor.
     * Builds a StrategyTradeRequest from the signal payload and calls openTrade().
     * Gated by: config enabled, autoExecute flag, position count < max.
     */
    private void autoExecuteTrade(Map<String, Object> mereData, String scripCode,
                                   String direction, double triggerPrice) {
        // Check position count limit using existing getActiveStrategyTrades()
        long currentPositions = strategyTradeExecutor.getActiveStrategyTrades().stream()
            .filter(t -> "MERE".equals(t.get("strategy")))
            .count();
        if (currentPositions >= autoExecuteMaxPositions) {
            log.info("MERE auto-execute skipped for {}: positions={}/{}", scripCode,
                currentPositions, autoExecuteMaxPositions);
            return;
        }

        // Extract option data from signal
        boolean optionAvailable = Boolean.TRUE.equals(mereData.get("optionAvailable"));
        String optScripCode = optionAvailable ? String.valueOf(mereData.get("optionScripCode")) : null;
        String optSymbol = optionAvailable ? String.valueOf(mereData.getOrDefault("optionSymbol", "")) : null;
        String optType = optionAvailable ? String.valueOf(mereData.getOrDefault("optionType", "")) : null;
        double optStrike = optionAvailable ? toDouble(mereData.get("optionStrike")) : 0;
        double optLtp = toDouble(mereData.get("optionLtp"));
        int optLotSize = toInt(mereData.get("optionLotSize"));

        // Fallback to futures if no option
        boolean useFutures = !optionAvailable || optScripCode == null || optScripCode.isEmpty()
            || "null".equals(optScripCode);
        String futScripCode = useFutures ? String.valueOf(mereData.getOrDefault("futuresScripCode", "")) : null;
        String futSymbol = useFutures ? String.valueOf(mereData.getOrDefault("futuresSymbol", "")) : null;
        double futLtp = useFutures ? toDouble(mereData.get("futuresLtp")) : 0;
        int futLotSize = useFutures ? toInt(mereData.get("futuresLotSize")) : 0;

        String tradeScripCode = useFutures ? futScripCode : optScripCode;
        String tradeSymbol = useFutures ? futSymbol : optSymbol;
        String instrumentType = useFutures ? "FUTURES" : "OPTION";
        double tradeLtp = useFutures ? futLtp : optLtp;
        int lotSize = useFutures ? futLotSize : optLotSize;

        if (tradeScripCode == null || tradeScripCode.isEmpty() || "null".equals(tradeScripCode)) {
            log.warn("MERE auto-execute skipped for {}: no tradeable instrument", scripCode);
            return;
        }
        if (tradeLtp <= 0) {
            log.warn("MERE auto-execute skipped for {}: LTP not available", scripCode);
            return;
        }
        if (lotSize <= 0) lotSize = 1;

        // Compute quantity: premium sizing = 2.5% of wallet
        int lots = 1;  // Default 1 lot; StrategyTradeExecutor will handle sizing if needed
        int quantity = lots * lotSize;

        // Extract equity-level SL/targets for dual-level monitoring
        double equitySl = toDouble(mereData.get("equitySl"));
        double equityT1 = toDouble(mereData.get("equityT1"));
        double equityT2 = toDouble(mereData.get("equityT2"));
        double equityT3 = toDouble(mereData.get("equityT3"));
        double equityT4 = toDouble(mereData.get("equityT4"));
        double delta = toDouble(mereData.get("optionDelta"));
        double confidence = toDouble(mereData.get("mereScore")) / 100.0;

        StrategyTradeRequest req = StrategyTradeRequest.builder()
            .scripCode(tradeScripCode)
            .instrumentSymbol(tradeSymbol != null ? tradeSymbol : "")
            .instrumentType(instrumentType)
            .underlyingScripCode(scripCode)
            .underlyingSymbol(String.valueOf(mereData.getOrDefault("symbol", "")))
            .side("BUY")
            .quantity(quantity)
            .lots(lots)
            .lotSize(lotSize)
            .multiplier(1)
            .entryPrice(tradeLtp)
            .sl(tradeLtp * 0.7)  // 30% premium SL (will be overridden by equity-level monitoring)
            .t1(tradeLtp * 1.5)  // Option premium targets (approximate)
            .t2(tradeLtp * 2.0)
            .t3(tradeLtp * 2.5)
            .t4(tradeLtp * 3.0)
            .equitySpot(triggerPrice)
            .equitySl(equitySl)
            .equityT1(equityT1)
            .equityT2(equityT2)
            .equityT3(equityT3)
            .equityT4(equityT4)
            .delta(delta != 0 ? delta : (direction.equals("BULLISH") ? 0.4 : -0.4))
            .optionType(optType)
            .strike(optStrike)
            .strategy("MERE")
            .exchange(String.valueOf(mereData.getOrDefault("exchange", "N")))
            .direction(direction)
            .confidence(Math.min(1.0, confidence))
            .build();

        Map<String, Object> result = strategyTradeExecutor.openTrade(req);
        log.info("MERE auto-execute for {}: {} {} instrument={} ltp={} result={}",
            scripCode, direction, instrumentType, tradeScripCode, tradeLtp,
            result != null ? result.get("status") : "null");
    }

    private double toDouble(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (Exception e) { return 0; }
    }

    private int toInt(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).intValue();
        try { return Integer.parseInt(val.toString()); } catch (Exception e) { return 0; }
    }

    private Map<String, Object> parseMERE(JsonNode root) {
        Map<String, Object> data = new HashMap<>();

        // Detect variant (MTF strategies set "strategy" field)
        String strategy = root.path("strategy").asText("MERE");
        data.put("mereVariant", strategy);

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

        // MERE-specific scoring (base MERE field names)
        data.put("mereScore", root.path("mereScore").asInt(0));
        data.put("mereLayer1", root.path("mereLayer1").asInt(0));
        data.put("mereLayer2", root.path("mereLayer2").asInt(0));
        data.put("mereLayer3", root.path("mereLayer3").asInt(0));
        data.put("mereBonus", root.path("mereBonus").asInt(0));
        data.put("merePenalty", root.path("merePenalty").asInt(0));
        data.put("mereReasons", root.path("mereReasons").asText(""));

        // Bollinger Bands data (set defaults first, then variant normalization overwrites)
        data.put("bbUpper", root.path("bbUpper").asDouble(0));
        data.put("bbMiddle", root.path("bbMiddle").asDouble(0));
        data.put("bbLower", root.path("bbLower").asDouble(0));
        data.put("bbWidth", root.path("bbWidth").asDouble(0));
        data.put("percentB", root.path("percentB").asDouble(0));

        // Normalize variant-specific field names to standard MERE fields
        // MUST run AFTER BB defaults so variant-specific fields (daily_percentB etc.) overwrite
        if (!"MERE".equals(strategy)) {
            normalizeVariantFields(root, data, strategy);
        }

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

        // Block trade detection (MAD-based)
        data.put("blockTradeDetected", root.path("blockTradeDetected").asBoolean(false));
        if (root.has("blockTradeVol")) data.put("blockTradeVol", root.path("blockTradeVol").asLong(0));
        if (root.has("blockTradePct")) data.put("blockTradePct", root.path("blockTradePct").asDouble(0));

        // OI enrichment
        if (root.has("oiChangeAtT")) data.put("oiChangeAtT", root.path("oiChangeAtT").asLong(0));
        if (root.has("oiInterpretation")) data.put("oiInterpretation", root.path("oiInterpretation").asText("NEUTRAL"));
        if (root.has("oiLabel")) data.put("oiLabel", root.path("oiLabel").asText(""));

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

        // MERE v2 fields
        if (root.has("autoExecute")) data.put("autoExecute", root.path("autoExecute").asBoolean(false));
        if (root.has("tradeStatus")) data.put("tradeStatus", root.path("tradeStatus").asText());
        if (root.has("mereVersion")) data.put("mereVersion", root.path("mereVersion").asText());
        if (root.has("equitySl")) data.put("equitySl", root.path("equitySl").asDouble());
        if (root.has("equityT1")) data.put("equityT1", root.path("equityT1").asDouble());
        if (root.has("equityT2")) data.put("equityT2", root.path("equityT2").asDouble());
        if (root.has("equityT3")) data.put("equityT3", root.path("equityT3").asDouble());
        if (root.has("equityT4")) data.put("equityT4", root.path("equityT4").asDouble());
        if (root.has("optionDelta")) data.put("optionDelta", root.path("optionDelta").asDouble());
        if (root.has("rankScore")) data.put("rankScore", root.path("rankScore").asDouble());
        if (root.has("entryReason")) data.put("entryReason", root.path("entryReason").asText());
        if (root.has("confirmReasons")) data.put("confirmReasons", root.path("confirmReasons").asText());
        if (root.has("regime")) data.put("regime", root.path("regime").asText());

        // V2 layer breakdown (5-layer)
        if (root.has("mereL1Extension")) data.put("mereL1Extension", root.path("mereL1Extension").asInt());
        if (root.has("mereL2Exhaustion")) data.put("mereL2Exhaustion", root.path("mereL2Exhaustion").asInt());
        if (root.has("mereL3Options")) data.put("mereL3Options", root.path("mereL3Options").asInt());
        if (root.has("mereL4MultiTF")) data.put("mereL4MultiTF", root.path("mereL4MultiTF").asInt());
        if (root.has("mereL5EntryQuality")) data.put("mereL5EntryQuality", root.path("mereL5EntryQuality").asInt());
        if (root.has("mereAntiPatterns")) data.put("mereAntiPatterns", root.path("mereAntiPatterns").asInt());

        return data;
    }

    /**
     * Normalizes variant-specific payload field names to standard MERE fields.
     * MTF triggers (Scalp, Swing, Positional) use variant-prefixed field names
     * for scoring that differ from what the dashboard expects.
     */
    private void normalizeVariantFields(JsonNode root, Map<String, Object> data, String strategy) {
        switch (strategy) {
            case "MERE_SCALP" -> {
                data.put("mereScore", root.path("scalpScore").asInt(0));
                data.put("mereLayer1", root.path("scalpLayer1_30mContext").asInt(0));
                data.put("mereLayer2", root.path("scalpLayer2_30mTrend").asInt(0));
                data.put("mereLayer3", root.path("scalpLayer3_5mEntry").asInt(0));
                data.put("mereBonus", root.path("scalpLayer4_OIOptions").asInt(0)
                        + root.path("scalpTimeBonus").asInt(0));
                data.put("merePenalty", root.path("scalpPenalty").asInt(0));
                data.put("mereReasons", root.path("scalpReasons").asText(""));
                // BB/SuperTrend fields already use the same names as base MERE
            }
            case "MERE_SWING" -> {
                data.put("mereScore", root.path("swingMereScore").asInt(0));
                data.put("mereLayer1", root.path("swingLayer1").asInt(0));
                data.put("mereLayer2", root.path("swingLayer2").asInt(0));
                data.put("mereLayer3", root.path("swingLayer3").asInt(0));
                data.put("mereBonus", root.path("swingLayer4").asInt(0)
                        + root.path("swingLayer5").asInt(0));
                data.put("merePenalty", root.path("swingPenalty").asInt(0));
                data.put("mereReasons", root.path("swingReasons").asText(""));
                // Remap daily BB fields to standard names
                if (root.has("daily_bbUpper")) data.put("bbUpper", root.path("daily_bbUpper").asDouble(0));
                if (root.has("daily_bbMiddle")) data.put("bbMiddle", root.path("daily_bbMiddle").asDouble(0));
                if (root.has("daily_bbLower")) data.put("bbLower", root.path("daily_bbLower").asDouble(0));
                if (root.has("daily_percentB")) data.put("percentB", root.path("daily_percentB").asDouble(0));
                if (root.has("daily_bbBandwidth")) data.put("bbWidth", root.path("daily_bbBandwidth").asDouble(0));
            }
            case "MERE_POSITIONAL" -> {
                data.put("mereScore", root.path("positionalScore").asInt(0));
                data.put("mereLayer1", root.path("scoreLayer1_WeeklyContext").asInt(0));
                data.put("mereLayer2", root.path("scoreLayer2_DailySignal").asInt(0));
                data.put("mereLayer3", root.path("scoreLayer3_OIOptions").asInt(0));
                data.put("mereBonus", root.path("scoreLayer4_PivotStructure").asInt(0)
                        + root.path("scoreLayer5_H4Confirmation").asInt(0));
                data.put("merePenalty", root.path("scorePenalty").asInt(0));
                data.put("mereReasons", root.path("scoreReasons").asText(""));
                // Remap weekly BB fields to standard names
                if (root.has("weeklyBBUpper")) data.put("bbUpper", root.path("weeklyBBUpper").asDouble(0));
                if (root.has("weeklyBBMiddle")) data.put("bbMiddle", root.path("weeklyBBMiddle").asDouble(0));
                if (root.has("weeklyBBLower")) data.put("bbLower", root.path("weeklyBBLower").asDouble(0));
                if (root.has("weeklyPercentB")) data.put("percentB", root.path("weeklyPercentB").asDouble(0));
                if (root.has("weeklyBBWidth")) data.put("bbWidth", root.path("weeklyBBWidth").asDouble(0));
            }
            default -> log.warn("Unknown MERE variant: {}", strategy);
        }
        // Also update triggerScore to match normalized mereScore
        data.put("triggerScore", ((Number) data.get("mereScore")).doubleValue());
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
