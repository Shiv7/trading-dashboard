package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.TradingSignalDTO;
import com.kotsin.dashboard.model.dto.TradingSignalDTO.ConfirmationStatus;
import com.kotsin.dashboard.service.ScripLookupService;
import com.kotsin.dashboard.service.TradingSignalService;
import com.kotsin.dashboard.websocket.DashboardWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Map;

/**
 * Kafka consumer for trading signals from StreamingCandle module.
 * Consumes from 'trading-signals-v2' topic and stores for user confirmation.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class TradingSignalConsumer {

    private final TradingSignalService tradingSignalService;
    private final DashboardWebSocketHandler webSocketHandler;
    private final ObjectMapper objectMapper;
    private final ScripLookupService scripLookup;

    @KafkaListener(
            topics = "${kafka.topic.trading-signals:trading-signals-v2}",
            groupId = "${kafka.group.trading-signals:dashboard-signal-consumer}",
            containerFactory = "kafkaListenerContainerFactory"
    )
    public void consumeTradingSignal(String message) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = objectMapper.readValue(message, Map.class);

            TradingSignalDTO signal = mapToSignalDTO(payload);

            // Only process ACTIVE signals for confirmation
            if ("ACTIVE".equals(signal.getState()) || "ACTIVE_TRIGGERED".equals(signal.getEvent())) {
                signal.setConfirmationStatus(ConfirmationStatus.PENDING);
                signal.setReceivedAt(LocalDateTime.now());

                // Store for confirmation
                tradingSignalService.addPendingSignal(signal);

                // Send to WebSocket for real-time update
                webSocketHandler.broadcastSignal(signal);

                log.info("SIGNAL_RECEIVED: {} {} {} score={} entry={} sl={} tp1={}",
                        signal.getDirection(),
                        signal.getScripCode(),
                        signal.getCompanyName(),
                        signal.getCompositeScore(),
                        signal.getEntryPrice(),
                        signal.getStopLoss(),
                        signal.getTarget1());
            } else {
                // Non-active signals (WATCH, EXPIRED, etc.) - just broadcast for monitoring
                webSocketHandler.broadcastSignalUpdate(signal);
                log.debug("SIGNAL_UPDATE: {} {} state={} event={}",
                        signal.getScripCode(), signal.getDirection(),
                        signal.getState(), signal.getEvent());
            }

        } catch (Exception e) {
            log.error("Error consuming trading signal: {}", e.getMessage(), e);
        }
    }

    private TradingSignalDTO mapToSignalDTO(Map<String, Object> payload) {
        return TradingSignalDTO.builder()
                .signalId(getString(payload, "signalId"))
                .symbol(getString(payload, "symbol"))
                .scripCode(getString(payload, "scripCode"))
                .exchange(getString(payload, "exchange"))
                .companyName(scripLookup.resolve(getString(payload, "scripCode"), getString(payload, "companyName")))
                .timeframe(getString(payload, "timeframe"))
                .state(getString(payload, "state"))
                .event(getString(payload, "event"))
                .direction(getString(payload, "direction"))
                .currentPrice(getDouble(payload, "currentPrice"))
                .entryPrice(getDouble(payload, "entryPrice"))
                .stopLoss(getDouble(payload, "stopLoss"))
                .target1(getDouble(payload, "target1"))
                .target2(getDouble(payload, "target2"))
                .actualExit(getDouble(payload, "actualExit"))
                .compositeScore(getDouble(payload, "compositeScore"))
                .confidence(getDouble(payload, "confidence"))
                .scoreDirection(getString(payload, "scoreDirection"))
                .isWatchSetup(getBoolean(payload, "isWatchSetup"))
                .isActiveTrigger(getBoolean(payload, "isActiveTrigger"))
                .reason(getString(payload, "reason"))
                .exitReason(getString(payload, "exitReason"))
                .createdAt(parseInstant(getString(payload, "createdAt")))
                .watchedAt(parseInstant(getString(payload, "watchedAt")))
                .triggeredAt(parseInstant(getString(payload, "triggeredAt")))
                .completedAt(parseInstant(getString(payload, "completedAt")))
                .publishedAt(parseInstant(getString(payload, "publishedAt")))
                .build();
    }

    private String getString(Map<String, Object> map, String key) {
        Object val = map.get(key);
        return val != null ? val.toString() : null;
    }

    private Double getDouble(Map<String, Object> map, String key) {
        Object val = map.get(key);
        if (val == null) return null;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try {
            return Double.parseDouble(val.toString());
        } catch (Exception e) {
            return null;
        }
    }

    private Boolean getBoolean(Map<String, Object> map, String key) {
        Object val = map.get(key);
        if (val == null) return null;
        if (val instanceof Boolean) return (Boolean) val;
        return Boolean.parseBoolean(val.toString());
    }

    private Instant parseInstant(String value) {
        if (value == null || value.isEmpty()) return null;
        try {
            return Instant.parse(value);
        } catch (Exception e) {
            return null;
        }
    }
}
