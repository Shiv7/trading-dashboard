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
 * Kafka consumer for MCX-BB signals (MCX Bollinger Band breakout strategy).
 * Displays signals on dashboard and broadcasts via WebSocket.
 */
@Component
@Slf4j
public class McxBbConsumer implements OptionSwapAware {

    private final WebSocketSessionManager sessionManager;
    private final SignalConsumer signalConsumer;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Value("${mcxbb.signal.ttl.minutes:30}")
    private long signalTtlMinutes;

    @Value("${mcxbb.max.signals.per.day:10}")
    private int maxSignalsPerDay;

    private Cache<String, Boolean> dedupCache;
    private Cache<String, Map<String, Object>> activeTriggers;
    private final ConcurrentHashMap<String, Map<String, Object>> latestMcxBb = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Integer> dailySignalCount = new ConcurrentHashMap<>();
    private String currentTradeDate = "";

    public McxBbConsumer(WebSocketSessionManager sessionManager,
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
            topics = {"kotsin_MCX_BB"},
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onMcxBb(String payload) {
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

            log.info("MCX-BB TRIGGER: {} ({}) {} @ {} | surge={}x oiChg={}% score={}",
                    displayName, scripCode, direction, triggerPrice, surgeT, oiChangeRatio, triggerScore);

            // Build data map for WebSocket broadcast
            Map<String, Object> data = new HashMap<>();
            data.put("scripCode", scripCode);
            data.put("symbol", symbol);
            data.put("companyName", displayName);
            data.put("exchange", root.path("exchange").asText("M"));
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
            data.put("signalSource", "MCX_BB");

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
            latestMcxBb.put(scripCode, data);

            // Register as signal on dashboard
            String rationale = String.format("MCX-BB: %s BB breakout | surge=%.1fx oiChg=%.1f%%",
                    direction, surgeT, oiChangeRatio);

            SignalDTO signalDTO = SignalDTO.builder()
                    .signalId(UUID.randomUUID().toString())
                    .scripCode(scripCode)
                    .companyName(displayName)
                    .timestamp(LocalDateTime.now(IST))
                    .signalSource("MCX_BB")
                    .signalSourceLabel("MCX-BB")
                    .signalType("MCX_BB")
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
            sessionManager.broadcastNotification("MCX_BB_TRIGGER",
                    String.format("%s %s MCX-BB for %s @ %.2f | surge=%.1fx oiChg=%.1f%%",
                            emoji, direction, displayName, triggerPrice, surgeT, oiChangeRatio));

        } catch (Exception e) {
            log.error("Error processing MCX-BB: {}", e.getMessage(), e);
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

    public Map<String, Map<String, Object>> getLatestMcxBb() {
        return Collections.unmodifiableMap(latestMcxBb);
    }

    @Override
    public void updateTradedOption(String underlyingScripCode, String strategy,
                                   String newScripCode, String newSymbol,
                                   double newStrike, double newLtp, String optionType) {
        if (!"MCX_BB".equals(strategy)) return;

        Map<String, Object> signal = latestMcxBb.get(underlyingScripCode);
        if (signal != null) {
            signal.put("optionAvailable", true);
            signal.put("optionPendingSwap", false);
            signal.put("optionScripCode", newScripCode);
            signal.put("optionSymbol", newSymbol);
            signal.put("optionStrike", newStrike);
            signal.put("optionLtp", newLtp);
            signal.put("optionType", optionType);
            log.info("MCX_BB option swap applied to cached signal: scrip={} -> {}@{} strike={}",
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
