package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.SignalDTO;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka consumer for trading signals (both raw and curated).
 * Parses signals, stores in memory, and broadcasts to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class SignalConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // In-memory signal storage for REST API
    private final Map<String, SignalDTO> signalCache = new ConcurrentHashMap<>();
    private final Map<String, Map<String, SignalDTO>> signalsByStock = new ConcurrentHashMap<>();

    @KafkaListener(topics = {"trading-signals", "trading-signals-curated"}, groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onSignal(String payload) {
        try {
            log.info("📥 Received signal from Kafka: {}", payload.substring(0, Math.min(150, payload.length())));
            JsonNode root = objectMapper.readTree(payload);
            
            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.warn("Signal has no scripCode, skipping");
                return;
            }

            // Skip NO_SIGNAL signals
            String signalType = root.path("signal").asText(root.path("signalType").asText(""));
            if ("NO_SIGNAL".equals(signalType)) {
                log.debug("Skipping NO_SIGNAL for {}", scripCode);
                return;
            }

            SignalDTO dto = parseSignal(root);
            
            // Store in cache for REST API
            String signalId = dto.getSignalId();
            if (signalId == null || signalId.isEmpty()) {
                signalId = UUID.randomUUID().toString();
                dto.setSignalId(signalId);
            }
            signalCache.put(signalId, dto);
            signalsByStock.computeIfAbsent(scripCode, k -> new ConcurrentHashMap<>()).put(signalId, dto);
            
            // Broadcast to WebSocket
            sessionManager.broadcastSignal(dto);
            
            // Also send a notification
            String direction = dto.getDirection();
            String emoji = "BULLISH".equals(direction) ? "📈" : "📉";
            sessionManager.broadcastNotification("SIGNAL", 
                String.format("%s New %s signal for %s @ %.2f", emoji, direction, dto.getCompanyName(), dto.getEntryPrice()));

            log.info("🎯 Signal stored & broadcasted: {} {} {} @ {}", 
                dto.getScripCode(), dto.getSignalType(), dto.getDirection(), dto.getEntryPrice());

        } catch (Exception e) {
            log.error("Error processing signal: {}", e.getMessage(), e);
        }
    }

    /**
     * Parse signal from JSON - handles BOTH raw TradingSignal and CuratedSignal formats
     */
    private SignalDTO parseSignal(JsonNode root) {
        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        
        // Parse entry details - try nested "entry" object first (CuratedSignal), then root (TradingSignal)
        JsonNode entry = root.path("entry");
        double entryPrice = entry.path("entryPrice").asDouble(root.path("entryPrice").asDouble(0));
        double stopLoss = entry.path("stopLoss").asDouble(root.path("stopLoss").asDouble(0));
        double target1 = entry.path("target").asDouble(root.path("target1").asDouble(0));
        double target2 = root.path("target2").asDouble(0);
        double riskReward = entry.path("riskReward").asDouble(root.path("riskRewardRatio").asDouble(0));

        // FIX: Raw TradingSignal uses "signal" field, CuratedSignal uses "signalType"
        String signalType = root.path("signal").asText();
        if (signalType == null || signalType.isEmpty() || "null".equals(signalType)) {
            signalType = root.path("signalType").asText("UNKNOWN");
        }

        return SignalDTO.builder()
                .signalId(root.path("signalId").asText(UUID.randomUUID().toString()))
                .scripCode(root.path("scripCode").asText())
                .companyName(root.path("companyName").asText(root.path("scripCode").asText()))
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .signalType(signalType)
                .direction(determineDirection(root))
                .confidence(root.path("confidence").asDouble(0))
                .rationale(root.path("rationale").asText(""))
                .entryPrice(entryPrice)
                .stopLoss(stopLoss)
                .target1(target1)
                .target2(target2)
                .riskRewardRatio(riskReward)
                .vcpScore(root.path("vcpCombinedScore").asDouble(0))
                .ipuScore(root.path("ipuFinalScore").asDouble(0))
                .xfactorFlag(root.path("xfactorFlag").asBoolean(false))
                .regimeLabel(root.path("indexRegimeLabel").asText("UNKNOWN"))
                .allGatesPassed(!root.path("warningSignal").asBoolean(false))
                .positionSizeMultiplier(root.path("positionSizeMultiplier").asDouble(1.0))
                .build();
    }

    /**
     * Determine direction from JSON - handles both formats
     */
    private String determineDirection(JsonNode root) {
        // TradingSignal has "direction" as enum (BULLISH/BEARISH)
        String direction = root.path("direction").asText();
        if (direction != null && !direction.isEmpty() && !"null".equals(direction)) {
            return direction.toUpperCase();
        }
        
        // Infer from signal type
        String signal = root.path("signal").asText();
        if (signal != null) {
            if (signal.contains("LONG") || signal.contains("BULLISH")) {
                return "BULLISH";
            }
            if (signal.contains("SHORT") || signal.contains("BEARISH")) {
                return "BEARISH";
            }
        }
        
        // Infer from entry vs stopLoss
        double entryPrice = root.path("entryPrice").asDouble(0);
        double stopLoss = root.path("stopLoss").asDouble(0);
        double target = root.path("target1").asDouble(0);
        
        if (entryPrice > 0 && stopLoss > 0) {
            return entryPrice > stopLoss ? "BULLISH" : "BEARISH";
        }
        if (entryPrice > 0 && target > 0) {
            return target > entryPrice ? "BULLISH" : "BEARISH";
        }
        
        return "NEUTRAL";
    }

    // ========== REST API Support ==========
    
    public Map<String, SignalDTO> getAllSignals() {
        return signalCache;
    }

    public Map<String, SignalDTO> getSignalsForStock(String scripCode) {
        return signalsByStock.getOrDefault(scripCode, Map.of());
    }
}

