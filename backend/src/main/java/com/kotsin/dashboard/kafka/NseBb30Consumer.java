package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import com.kotsin.dashboard.model.dto.SignalDTO;
import com.kotsin.dashboard.service.ScripLookupService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Kafka consumer for NSE-BB-30 signals (NSE Bollinger Band 30-min breakout strategy).
 * Displays signals on dashboard and broadcasts via WebSocket.
 */
@Component
@Slf4j
public class NseBb30Consumer implements OptionSwapAware {

    private final WebSocketSessionManager sessionManager;
    private final SignalConsumer signalConsumer;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${nsebb30.signal.ttl.minutes:30}")
    private long signalTtlMinutes;

    @Value("${nsebb30.max.signals.per.day:10}")
    private int maxSignalsPerDay;

    private Cache<String, Boolean> dedupCache;
    private Cache<String, Map<String, Object>> activeTriggers;
    private final ConcurrentHashMap<String, Map<String, Object>> latestNseBb30 = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Integer> dailySignalCount = new ConcurrentHashMap<>();
    private String currentTradeDate = "";

    public NseBb30Consumer(WebSocketSessionManager sessionManager,
                           SignalConsumer signalConsumer,
                           ScripLookupService scripLookup) {
        this.sessionManager = sessionManager;
        this.signalConsumer = signalConsumer;
        this.scripLookup = scripLookup;
    }

    @PostConstruct
    public void init() {
        activeTriggers = Caffeine.newBuilder()
                .expireAfterWrite(signalTtlMinutes, TimeUnit.MINUTES)
                .maximumSize(200)
                .build();
        dedupCache = Caffeine.newBuilder()
                .expireAfterWrite(5, TimeUnit.MINUTES)
                .maximumSize(1000)
                .build();
    }

    @KafkaListener(
            topics = {"kotsin_NSE_BB_30"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onNseBb30(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) return;

            String triggerTimeStr = root.path("triggerTime").asText("");
            String dedupKey = scripCode + "|" + triggerTimeStr;
            if (dedupCache.getIfPresent(dedupKey) != null) return;
            dedupCache.put(dedupKey, Boolean.TRUE);

            boolean triggered = root.path("triggered").asBoolean(false);
            if (!triggered) return;

            // Daily cap
            resetDailyCounterIfNeeded();
            String dailyKey = scripCode + "|" + currentTradeDate;
            int todayCount = dailySignalCount.getOrDefault(dailyKey, 0);
            if (todayCount >= maxSignalsPerDay) return;
            dailySignalCount.merge(dailyKey, 1, Integer::sum);

            String direction = root.path("direction").asText("NONE");
            String symbol = root.path("symbol").asText("");
            String companyName = root.path("companyName").asText("");
            String displayName = scripLookup.resolve(scripCode,
                    !symbol.isEmpty() ? symbol : (!companyName.isEmpty() ? companyName : null));

            double triggerPrice = root.path("triggerPrice").asDouble(0);
            double triggerScore = root.path("triggerScore").asDouble(0);
            double bbUpper = root.path("bbUpper").asDouble(0);
            double bbLower = root.path("bbLower").asDouble(0);
            double surgeT = root.path("surgeT").asDouble(0);
            double oiChangeRatio = root.path("oiChangeRatio").asDouble(0);
            double stopLoss = root.path("stopLoss").asDouble(0);
            double target1 = root.path("target1").asDouble(0);
            double riskReward = root.path("riskReward").asDouble(0);

            log.info("NSE-BB-30 TRIGGER: {} ({}) {} @ {} | surge={}x oiChg={}% score={}",
                    displayName, scripCode, direction, triggerPrice, surgeT, oiChangeRatio, triggerScore);

            // Build data map for WebSocket broadcast
            Map<String, Object> data = new HashMap<>();
            data.put("scripCode", scripCode);
            data.put("symbol", symbol);
            data.put("companyName", displayName);
            data.put("exchange", root.path("exchange").asText("N"));
            data.put("triggered", true);
            data.put("direction", direction);
            data.put("triggerPrice", triggerPrice);
            data.put("triggerScore", triggerScore);
            data.put("bbUpper", bbUpper);
            data.put("bbLower", bbLower);
            data.put("surgeT", surgeT);
            data.put("oiChangeRatio", oiChangeRatio);
            data.put("stopLoss", stopLoss);
            data.put("target1", target1);
            data.put("riskReward", riskReward);
            data.put("signalSource", "NSE_BB_30");
            data.put("triggerTime", triggerTimeStr);
            data.put("timestamp", root.path("timestamp").asLong(System.currentTimeMillis()));

            // Rich insight fields
            data.put("target2", root.path("target2").asDouble(0));
            data.put("bbMiddle", root.path("bbMiddle").asDouble(0));
            data.put("atr30m", root.path("atr30m").asDouble(0));
            data.put("volumeT", root.path("volumeT").asLong(0));
            data.put("expansionRate", root.path("expansionRate").asDouble(0));
            data.put("bodyOutsideRatio", root.path("bodyOutsideRatio").asDouble(0));
            data.put("technicalScore", root.path("technicalScore").asInt(0));
            data.put("institutionalScore", root.path("institutionalScore").asInt(0));
            data.put("institutionalClass", root.path("institutionalClass").asText("UNKNOWN"));
            data.put("combinedConviction", root.path("combinedConviction").asDouble(0));
            data.put("sizeClass", root.path("sizeClass").asText("MINIMUM"));
            data.put("sessionType", root.path("sessionType").asText(""));
            data.put("sessionWeight", root.path("sessionWeight").asDouble(1.0));
            data.put("oiInterpretation", root.path("oiInterpretation").asText(""));
            data.put("instFlowScore", root.path("instFlowScore").asInt(0));
            data.put("instSizeScore", root.path("instSizeScore").asInt(0));
            data.put("instStealthScore", root.path("instStealthScore").asInt(0));
            data.put("instOiScore", root.path("instOiScore").asInt(0));

            // Greek enrichment
            if (root.has("greekEnriched")) data.put("greekEnriched", root.path("greekEnriched").asBoolean(false));
            if (root.has("greekDelta")) data.put("greekDelta", root.path("greekDelta").asDouble());
            if (root.has("greekGamma")) data.put("greekGamma", root.path("greekGamma").asDouble());
            if (root.has("greekTheta")) data.put("greekTheta", root.path("greekTheta").asDouble());
            if (root.has("greekVega")) data.put("greekVega", root.path("greekVega").asDouble());
            if (root.has("greekIV")) data.put("greekIV", root.path("greekIV").asDouble());
            if (root.has("greekDte")) data.put("greekDte", root.path("greekDte").asInt());
            if (root.has("greekMoneynessType")) data.put("greekMoneynessType", root.path("greekMoneynessType").asText());
            if (root.has("greekThetaImpaired")) data.put("greekThetaImpaired", root.path("greekThetaImpaired").asBoolean());
            if (root.has("greekSlMethod")) data.put("greekSlMethod", root.path("greekSlMethod").asText());

            // Option data
            data.put("optionAvailable", root.path("optionAvailable").asBoolean(false));
            if (root.has("optionScripCode")) data.put("optionScripCode", root.path("optionScripCode").asText());
            if (root.has("optionStrike")) data.put("optionStrike", root.path("optionStrike").asDouble());
            if (root.has("optionType")) data.put("optionType", root.path("optionType").asText());
            if (root.has("optionLtp")) data.put("optionLtp", root.path("optionLtp").asDouble());
            if (root.has("optionExpiry")) data.put("optionExpiry", root.path("optionExpiry").asText());
            if (root.has("optionLotSize")) data.put("optionLotSize", root.path("optionLotSize").asInt(1));
            if (root.has("optionMultiplier")) data.put("optionMultiplier", root.path("optionMultiplier").asInt(1));
            if (root.has("optionExchange")) data.put("optionExchange", root.path("optionExchange").asText());
            if (root.has("optionExchangeType")) data.put("optionExchangeType", root.path("optionExchangeType").asText());

            activeTriggers.put(scripCode, data);
            latestNseBb30.put(scripCode, data);

            // Register as signal on dashboard
            String rationale = String.format("NSE-BB-30: %s BB breakout | surge=%.1fx oiChg=%.1f%%",
                    direction, surgeT, oiChangeRatio);

            SignalDTO signalDTO = SignalDTO.builder()
                    .signalId(UUID.randomUUID().toString())
                    .scripCode(scripCode)
                    .companyName(displayName)
                    .timestamp(LocalDateTime.now(IST))
                    .signalSource("NSE_BB_30")
                    .signalSourceLabel("NSE-BB-30")
                    .signalType("NSE_BB_30")
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

            // Broadcast notification
            String emoji = "BULLISH".equals(direction) ? "^" : "v";
            sessionManager.broadcastNotification("NSE_BB_30_TRIGGER",
                    String.format("%s %s NSE-BB-30 for %s @ %.2f | surge=%.1fx oiChg=%.1f%%",
                            emoji, direction, displayName, triggerPrice, surgeT, oiChangeRatio));

        } catch (Exception e) {
            log.error("Error processing NSE-BB-30: {}", e.getMessage(), e);
        }
    }

    private void resetDailyCounterIfNeeded() {
        String today = LocalDate.now(IST).toString();
        if (!today.equals(currentTradeDate)) {
            currentTradeDate = today;
            dailySignalCount.clear();
        }
    }

    public Map<String, Map<String, Object>> getActiveTriggers() {
        return activeTriggers.asMap();
    }

    public Map<String, Map<String, Object>> getLatestNseBb30() {
        return Collections.unmodifiableMap(latestNseBb30);
    }

    @Override
    public void updateTradedOption(String underlyingScripCode, String strategy,
                                   String newScripCode, String newSymbol,
                                   double newStrike, double newLtp, String optionType) {
        if (!"NSE_BB_30".equals(strategy)) return;

        Map<String, Object> signal = latestNseBb30.get(underlyingScripCode);
        if (signal != null) {
            signal.put("optionAvailable", true);
            signal.put("optionPendingSwap", false);
            signal.put("optionScripCode", newScripCode);
            signal.put("optionSymbol", newSymbol);
            signal.put("optionStrike", newStrike);
            signal.put("optionLtp", newLtp);
            signal.put("optionType", optionType);
            log.info("NSE_BB_30 option swap applied to cached signal: scrip={} -> {}@{} strike={}",
                    underlyingScripCode, newSymbol, newLtp, newStrike);
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
