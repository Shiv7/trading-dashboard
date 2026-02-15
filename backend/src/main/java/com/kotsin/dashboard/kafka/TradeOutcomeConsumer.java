package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.PositionDTO;
import com.kotsin.dashboard.model.dto.TradeDTO;
import com.kotsin.dashboard.model.entity.UserTrade;
import com.kotsin.dashboard.service.UserPnLService;
import com.kotsin.dashboard.service.ScripLookupService;
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
    private final UserPnLService userPnLService;
    private final ScripLookupService scripLookup;
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

            // Record per-user trade if userId is present in the payload
            String userId = root.path("userId").asText(null);
            String walletType = root.path("walletType").asText("PAPER");
            if (userId != null && !userId.isEmpty()) {
                try {
                    UserTrade userTrade = UserTrade.builder()
                            .tradeId(trade.getTradeId())
                            .signalId(trade.getSignalId())
                            .scripCode(trade.getScripCode())
                            .symbol(trade.getScripCode())
                            .companyName(trade.getCompanyName())
                            .side(trade.getSide())
                            .entryPrice(trade.getEntryPrice())
                            .exitPrice(trade.getExitPrice())
                            .quantity(trade.getQuantity())
                            .stopLoss(trade.getStopLoss())
                            .target1(trade.getTarget1())
                            .pnl(trade.getPnl())
                            .pnlPercent(trade.getPnlPercent())
                            .rMultiple(trade.getRMultiple())
                            .entryTime(trade.getEntryTime())
                            .exitTime(trade.getExitTime())
                            .exitReason(trade.getExitReason())
                            .durationMinutes((int) trade.getDurationMinutes())
                            .strategy(root.path("strategy").asText(root.path("signalSource").asText("UNKNOWN")))
                            .netPnl(trade.getPnl())
                            .build();
                    userPnLService.recordTrade(userId, walletType, userTrade);
                } catch (Exception e) {
                    log.warn("Failed to record per-user trade: {}", e.getMessage());
                }
            }

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

        // FIX BUG #16: Properly read quantity with warning when missing
        int quantity = root.path("quantity").asInt(0);
        if (quantity == 0) {
            quantity = root.path("qty").asInt(0); // Try alternate field name
        }
        if (quantity <= 0) {
            log.warn("[TRADE_OUTCOME] {} - Missing quantity in trade outcome, defaulting to 1. P&L% may be wrong!",
                root.path("scripCode").asText());
            quantity = 1;
        }

        // FIX BUG #15: Correct P&L% calculation
        // BEFORE: pnlPercent = (pnl / entryPrice) * 100 - WRONG! Ignores quantity
        // AFTER: Calculate based on position cost (entryPrice * quantity)
        double positionCost = entryPrice * quantity;
        double pnlPercent = positionCost > 0 ? (pnl / positionCost) * 100 : 0;

        double stopLoss = root.path("stopLoss").asDouble(0);

        // FIX BUG #17: Calculate R-multiple properly
        double rMultiple = root.path("rMultiple").asDouble(0);
        if (rMultiple == 0 && stopLoss > 0 && entryPrice > 0) {
            double riskPerShare = Math.abs(entryPrice - stopLoss);
            double totalRisk = riskPerShare * quantity;
            rMultiple = totalRisk > 0 ? pnl / totalRisk : 0;
        } else if (rMultiple == 0 && entryPrice > 0) {
            // FIX: If no SL, use a default 2% risk estimate for R calculation
            log.debug("[TRADE_OUTCOME] {} - No stopLoss provided, using 2% risk estimate for R-multiple",
                root.path("scripCode").asText());
            double estimatedRisk = entryPrice * 0.02 * quantity;
            rMultiple = estimatedRisk > 0 ? pnl / estimatedRisk : 0;
        }

        // If side is SHORT and upstream sent naive P&L, correct the R-multiple sign
        String side = determineSide(root);
        if ("SHORT".equals(side) && isWin && rMultiple < 0) {
            rMultiple = Math.abs(rMultiple);
        } else if ("SHORT".equals(side) && !isWin && rMultiple > 0) {
            rMultiple = -Math.abs(rMultiple);
        }

        return TradeDTO.builder()
                .tradeId(root.path("tradeId").asText(root.path("signalId").asText()))
                .signalId(root.path("signalId").asText())
                .scripCode(root.path("scripCode").asText())
                .companyName(scripLookup.resolve(root.path("scripCode").asText(), root.path("companyName").asText("")))
                .side(determineSide(root))
                .status(status)
                .entryPrice(entryPrice)
                .entryTime(entryTime)
                .quantity(quantity) // FIX: Use properly parsed quantity
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

    /**
     * FIX BUG #18: Properly determine side with better fallback logic
     */
    private String determineSide(JsonNode root) {
        // First, try explicit side field
        String side = root.path("side").asText();
        if (side != null && !side.isEmpty() && !"null".equals(side)) {
            String normalized = side.toUpperCase();
            if (normalized.contains("BUY") || normalized.contains("LONG")) {
                return "LONG";
            } else if (normalized.contains("SELL") || normalized.contains("SHORT")) {
                return "SHORT";
            }
        }

        // Second, try direction field
        String direction = root.path("direction").asText();
        if (direction != null && !direction.isEmpty() && !"null".equals(direction)) {
            String normalized = direction.toUpperCase();
            if (normalized.contains("BULL") || normalized.contains("LONG") || normalized.contains("BUY")) {
                return "LONG";
            } else if (normalized.contains("BEAR") || normalized.contains("SHORT") || normalized.contains("SELL")) {
                return "SHORT";
            }
        }

        // Third, infer from entry/stop prices (only if stopLoss is explicitly provided)
        double entry = root.path("entryPrice").asDouble(0);
        double stop = root.path("stopLoss").asDouble(0);

        // FIX: Only use stop loss inference if stop is actually set (not 0)
        if (stop > 0 && entry > 0) {
            return entry > stop ? "LONG" : "SHORT";
        }

        // Default to LONG with warning
        log.warn("[TRADE_OUTCOME] {} - Could not determine side, defaulting to LONG",
            root.path("scripCode").asText());
        return "LONG";
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

