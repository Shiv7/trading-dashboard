package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.TradeDTO;
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
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka consumer for trade-results topic from TradeExecutionModule.
 *
 * Consumes: trade-results
 * Contains: Completed trade results with entry/exit prices, P&L, R-multiple
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class TradeResultsConsumer {

    private final WebSocketSessionManager sessionManager;
    private final WalletService walletService;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache recent trades for API access
    private final Map<String, TradeDTO> recentTrades = new ConcurrentHashMap<>();

    @KafkaListener(
            topics = "trade-results",
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onTradeResult(String payload) {
        try {
            log.info("Received trade result from Kafka");
            JsonNode root = objectMapper.readTree(payload);

            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.warn("Trade result has no scripCode, skipping");
                return;
            }

            TradeDTO trade = parseTrade(root);

            // Cache the trade
            recentTrades.put(trade.getTradeId(), trade);

            // Broadcast trade update via WebSocket
            sessionManager.broadcastTradeUpdate(trade);

            // Refresh wallet and broadcast
            walletService.refreshWallet();
            sessionManager.broadcastWalletUpdate(walletService.getWallet());

            // Send notification
            String emoji = trade.getPnl() >= 0 ? "✅" : "❌";
            String pnlStr = trade.getPnl() >= 0 ?
                    String.format("+₹%.2f", trade.getPnl()) :
                    String.format("-₹%.2f", Math.abs(trade.getPnl()));
            String message = String.format("%s %s: %s (%.2fR) | %s",
                    emoji, trade.getCompanyName(), pnlStr, trade.getRMultiple(), trade.getExitReason());
            sessionManager.broadcastNotification(
                    trade.getPnl() >= 0 ? "TRADE_WIN" : "TRADE_LOSS",
                    message);

            log.info("Trade result processed: {} {} P&L={} R={}",
                    trade.getCompanyName(), trade.getStatus(), trade.getPnl(), trade.getRMultiple());

        } catch (Exception e) {
            log.error("Error processing trade result: {}", e.getMessage(), e);
        }
    }

    private TradeDTO parseTrade(JsonNode root) {
        LocalDateTime entryTime = parseDateTime(root.path("entryTime"));
        LocalDateTime exitTime = parseDateTime(root.path("exitTime"));

        double entryPrice = root.path("entryPrice").asDouble(0);
        double exitPrice = root.path("exitPrice").asDouble(0);
        double pnl = root.path("pnl").asDouble(0);
        double rMultiple = root.path("rMultiple").asDouble(0);
        double stopLoss = root.path("stopLoss").asDouble(0);
        int quantity = root.path("quantity").asInt(root.path("positionSize").asInt(1));
        String exitReason = root.path("exitReason").asText("UNKNOWN");

        // R-multiple fallback calculation when not provided by upstream
        if (rMultiple == 0 && entryPrice > 0 && stopLoss > 0) {
            double riskPerShare = Math.abs(entryPrice - stopLoss);
            double totalRisk = riskPerShare * quantity;
            if (totalRisk > 0) {
                rMultiple = pnl / totalRisk;
            }
        }

        // Determine status
        String status;
        if (pnl > 0) {
            if (exitReason.contains("TARGET")) {
                status = "CLOSED_WIN";
            } else if (exitReason.contains("TRAIL")) {
                status = "CLOSED_TRAILING";
            } else {
                status = "CLOSED_WIN"; // Any profitable exit is a win
            }
        } else if (pnl < 0) {
            status = "CLOSED_LOSS";
        } else {
            status = "CLOSED_BREAKEVEN";
        }

        long durationMinutes = 0;
        if (entryTime != null && exitTime != null) {
            durationMinutes = ChronoUnit.MINUTES.between(entryTime, exitTime);
        }

        double positionCost = entryPrice * quantity;
        double pnlPercent = positionCost > 0 ? (pnl / positionCost) * 100 : 0;

        // Extract signal source/strategy
        String signalSource = root.path("signalSource").asText(
                root.path("strategy").asText(
                        root.path("signalType").asText("UNKNOWN")));

        return TradeDTO.builder()
                .tradeId(root.path("tradeId").asText(root.path("signalId").asText()))
                .signalId(root.path("signalId").asText())
                .scripCode(root.path("scripCode").asText())
                .companyName(scripLookup.resolve(root.path("scripCode").asText(), root.path("companyName").asText("")))
                .side(determineSide(root))
                .status(status)
                .entryPrice(entryPrice)
                .entryTime(entryTime)
                .quantity(quantity)
                .exitPrice(exitPrice)
                .exitTime(exitTime)
                .exitReason(exitReason)
                .stopLoss(stopLoss)
                .target1(root.path("target1").asDouble(root.path("target").asDouble(0)))
                .target2(root.path("target2").isNull() ? null : root.path("target2").asDouble())
                .pnl(pnl)
                .pnlPercent(pnlPercent)
                .rMultiple(rMultiple)
                .durationMinutes(durationMinutes)
                .strategy(signalSource)
                .build();
    }

    private String determineSide(JsonNode root) {
        String side = root.path("side").asText();
        if (side != null && !side.isEmpty() && !"null".equalsIgnoreCase(side)) {
            return side.toUpperCase().contains("BUY") || side.toUpperCase().contains("LONG")
                    ? "LONG" : "SHORT";
        }

        // Infer from entry/stop prices
        double entry = root.path("entryPrice").asDouble(0);
        double stop = root.path("stopLoss").asDouble(0);
        if (entry > 0 && stop > 0) {
            return entry > stop ? "LONG" : "SHORT";
        }
        return "LONG"; // Safe default when data is insufficient
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

    /**
     * Get recent trades (for REST API)
     */
    public Map<String, TradeDTO> getRecentTrades() {
        return new ConcurrentHashMap<>(recentTrades);
    }

    /**
     * Get trade by ID
     */
    public TradeDTO getTrade(String tradeId) {
        return recentTrades.get(tradeId);
    }
}
