package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.PositionDTO;
import com.kotsin.dashboard.model.dto.TradeDTO;
import com.kotsin.dashboard.service.WalletService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

/**
 * Kafka consumer for trade outcome events.
 * Updates wallet state and broadcasts to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class TradeOutcomeConsumer {

    private final WebSocketSessionManager sessionManager;
    private final WalletService walletService;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @KafkaListener(topics = "trade-outcomes", groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onTradeOutcome(String payload) {
        try {
            log.info("Received trade outcome from Kafka");
            JsonNode root = objectMapper.readTree(payload);
            
            String signalId = root.path("signalId").asText();
            String scripCode = root.path("scripCode").asText();
            
            if (scripCode == null || scripCode.isEmpty()) {
                log.warn("Trade outcome has no scripCode, skipping");
                return;
            }

            TradeDTO trade = parseTrade(root);
            
            // Broadcast trade update
            sessionManager.broadcastTradeUpdate(trade);
            
            // Update wallet and broadcast
            walletService.refreshWallet();
            sessionManager.broadcastWalletUpdate(walletService.getWallet());

            // Send notification
            String status = trade.getStatus();
            String emoji = status.contains("WIN") ? "✅" : (status.contains("LOSS") ? "❌" : "📊");
            String message = String.format("%s Trade %s: %s %.2f (%.2f%%)", 
                emoji, status, trade.getCompanyName(), trade.getPnl(), trade.getPnlPercent());
            sessionManager.broadcastNotification("TRADE", message);

            log.info("Trade outcome processed: {} {} PnL={}", 
                trade.getCompanyName(), trade.getStatus(), trade.getPnl());

        } catch (Exception e) {
            log.error("Error processing trade outcome: {}", e.getMessage(), e);
        }
    }

    private TradeDTO parseTrade(JsonNode root) {
        LocalDateTime entryTime = parseDateTime(root.path("entryTime"));
        LocalDateTime exitTime = parseDateTime(root.path("exitTime"));
        
        double entryPrice = root.path("entryPrice").asDouble(0);
        double exitPrice = root.path("exitPrice").asDouble(0);
        double pnl = root.path("pnl").asDouble(0);
        boolean isWin = root.path("isWin").asBoolean(pnl > 0);
        
        String status;
        String exitReason = root.path("exitReason").asText("UNKNOWN");
        if (exitReason.contains("TARGET") || exitReason.contains("TP")) {
            status = "CLOSED_WIN";
        } else if (exitReason.contains("STOP") || exitReason.contains("SL")) {
            status = isWin ? "CLOSED_WIN" : "CLOSED_LOSS";
        } else if (exitReason.contains("TRAIL")) {
            status = "CLOSED_TRAILING";
        } else {
            status = isWin ? "CLOSED_WIN" : "CLOSED_LOSS";
        }

        long durationMinutes = 0;
        if (entryTime != null && exitTime != null) {
            durationMinutes = ChronoUnit.MINUTES.between(entryTime, exitTime);
        }

        double pnlPercent = entryPrice > 0 ? (pnl / entryPrice) * 100 : 0;
        double stopLoss = root.path("stopLoss").asDouble(0);
        double rMultiple = root.path("rMultiple").asDouble(0);
        if (rMultiple == 0 && stopLoss > 0 && entryPrice > 0) {
            double risk = Math.abs(entryPrice - stopLoss);
            rMultiple = risk > 0 ? pnl / risk : 0;
        }

        return TradeDTO.builder()
                .tradeId(root.path("tradeId").asText(root.path("signalId").asText()))
                .signalId(root.path("signalId").asText())
                .scripCode(root.path("scripCode").asText())
                .companyName(root.path("companyName").asText(root.path("scripCode").asText()))
                .side(determineSide(root))
                .status(status)
                .entryPrice(entryPrice)
                .entryTime(entryTime)
                .quantity(root.path("quantity").asInt(1))
                .exitPrice(exitPrice)
                .exitTime(exitTime)
                .exitReason(exitReason)
                .stopLoss(stopLoss)
                .target1(root.path("target").asDouble(root.path("target1").asDouble(0)))
                .target2(root.path("target2").isNull() ? null : root.path("target2").asDouble())
                .pnl(pnl)
                .pnlPercent(pnlPercent)
                .rMultiple(rMultiple)
                .durationMinutes(durationMinutes)
                .build();
    }

    private String determineSide(JsonNode root) {
        String side = root.path("side").asText();
        if (side != null && !side.isEmpty()) {
            return side.toUpperCase().contains("BUY") || side.toUpperCase().contains("LONG") 
                ? "LONG" : "SHORT";
        }
        
        // Infer from entry/exit prices
        double entry = root.path("entryPrice").asDouble(0);
        double stop = root.path("stopLoss").asDouble(0);
        return entry > stop ? "LONG" : "SHORT";
    }

    private LocalDateTime parseDateTime(JsonNode node) {
        if (node.isNull() || node.isMissingNode()) {
            return null;
        }
        try {
            if (node.isTextual()) {
                return LocalDateTime.parse(node.asText());
            } else if (node.isNumber()) {
                return LocalDateTime.ofInstant(
                    Instant.ofEpochMilli(node.asLong()), 
                    ZoneId.of("Asia/Kolkata")
                );
            }
        } catch (Exception e) {
            // Ignore parse errors
        }
        return null;
    }
}

