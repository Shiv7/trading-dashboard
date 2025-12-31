package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.WalletDTO;
import com.kotsin.dashboard.service.WalletService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * ProfitLossConsumer - Consumes P&L events from tradeExecutionModule
 * 
 * Listens to: profit-loss
 * 
 * Event Types:
 * - TRADE_ENTRY: New trade opened
 * - TRADE_EXIT: Trade closed with P&L
 * - TRADE_REPLACEMENT: Trade replaced by better signal
 * - PORTFOLIO_UPDATE: Overall portfolio metrics
 * 
 * Updates:
 * - In-memory wallet state
 * - Broadcasts to WebSocket for real-time UI updates
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class ProfitLossConsumer {

    private final WebSocketSessionManager sessionManager;
    private final WalletService walletService;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Real-time P&L tracking
    private final AtomicReference<Double> realtimePnl = new AtomicReference<>(0.0);
    private final AtomicReference<Double> dayPnl = new AtomicReference<>(0.0);
    private final AtomicReference<Integer> totalTrades = new AtomicReference<>(0);
    private final AtomicReference<Integer> dayTrades = new AtomicReference<>(0);
    
    // Trade tracking by scripCode
    private final Map<String, TradeInfo> activeTrades = new ConcurrentHashMap<>();

    @lombok.Data
    @lombok.Builder
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    public static class TradeInfo {
        private String tradeId;
        private String scripCode;
        private String companyName;
        private String signalType;
        private String strategy;
        private double entryPrice;
        private int positionSize;
        private double stopLoss;
        private double target1;
        private double target2;
        private LocalDateTime entryTime;
        private double currentPnl;
    }

    /**
     * Main Kafka listener for profit-loss topic
     */
    @KafkaListener(
            topics = "profit-loss",
            groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onProfitLoss(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            String eventType = root.path("eventType").asText();

            switch (eventType) {
                case "TRADE_ENTRY" -> handleTradeEntry(root);
                case "TRADE_EXIT" -> handleTradeExit(root);
                case "TRADE_REPLACEMENT" -> handleTradeReplacement(root);
                case "PORTFOLIO_UPDATE" -> handlePortfolioUpdate(root);
                default -> log.debug("Unknown P&L event type: {}", eventType);
            }

        } catch (Exception e) {
            log.error("Error processing profit-loss event: {}", e.getMessage(), e);
        }
    }

    /**
     * Handle new trade entry
     */
    private void handleTradeEntry(JsonNode root) {
        String tradeId = root.path("tradeId").asText();
        String scripCode = root.path("scripCode").asText();
        String companyName = root.path("companyName").asText(scripCode);
        String signalType = root.path("signal").asText("UNKNOWN");
        double entryPrice = root.path("entryPrice").asDouble(0);
        int positionSize = root.path("positionSize").asInt(1);

        TradeInfo trade = TradeInfo.builder()
                .tradeId(tradeId)
                .scripCode(scripCode)
                .companyName(companyName)
                .signalType(signalType)
                .strategy(root.path("strategy").asText(""))
                .entryPrice(entryPrice)
                .positionSize(positionSize)
                .stopLoss(root.path("stopLoss").asDouble(0))
                .target1(root.path("target1").asDouble(0))
                .target2(root.path("target2").asDouble(0))
                .entryTime(LocalDateTime.now())
                .currentPnl(0)
                .build();

        activeTrades.put(scripCode, trade);
        dayTrades.updateAndGet(v -> v + 1);
        totalTrades.updateAndGet(v -> v + 1);

        log.info("📈 [P&L] TRADE_ENTRY: {} {} @ ₹{} (size={})", 
                signalType, companyName, entryPrice, positionSize);

        // Broadcast to WebSocket
        broadcastTradeEvent("ENTRY", trade, 0);
        
        // Send notification
        sessionManager.broadcastNotification("TRADE_ENTRY",
                String.format("📈 New %s trade: %s @ ₹%.2f", signalType, companyName, entryPrice));
    }

    /**
     * Handle trade exit with P&L
     */
    private void handleTradeExit(JsonNode root) {
        String scripCode = root.path("scripCode").asText();
        String companyName = root.path("companyName").asText(scripCode);
        double entryPrice = root.path("entryPrice").asDouble(0);
        double exitPrice = root.path("exitPrice").asDouble(0);
        double profitLoss = root.path("profitLoss").asDouble(0);
        String exitReason = root.path("exitReason").asText("UNKNOWN");
        double roi = root.path("roi").asDouble(0);

        // Update totals
        realtimePnl.updateAndGet(v -> v + profitLoss);
        dayPnl.updateAndGet(v -> v + profitLoss);

        // Remove from active trades
        TradeInfo trade = activeTrades.remove(scripCode);
        if (trade != null) {
            trade.setCurrentPnl(profitLoss);
        }

        String emoji = profitLoss >= 0 ? "💰" : "💸";
        log.info("{} [P&L] TRADE_EXIT: {} @ ₹{} | P&L: ₹{:.2f} | Reason: {}",
                emoji, companyName, exitPrice, profitLoss, exitReason);

        // Broadcast to WebSocket
        broadcastTradeEvent("EXIT", trade, profitLoss);

        // Send notification
        String pnlStr = profitLoss >= 0 ? 
                String.format("+₹%.2f", profitLoss) : 
                String.format("-₹%.2f", Math.abs(profitLoss));
        sessionManager.broadcastNotification(profitLoss >= 0 ? "TRADE_WIN" : "TRADE_LOSS",
                String.format("%s %s closed: %s (%s)", emoji, companyName, pnlStr, exitReason));

        // Refresh wallet and broadcast
        refreshAndBroadcastWallet();
    }

    /**
     * Handle trade replacement
     */
    private void handleTradeReplacement(JsonNode root) {
        String oldScripCode = root.path("oldScripCode").asText();
        String newScripCode = root.path("newScripCode").asText();
        double oldRR = root.path("oldRiskReward").asDouble(0);
        double newRR = root.path("newRiskReward").asDouble(0);

        log.info("🔄 [P&L] TRADE_REPLACEMENT: {} (R:R {:.2f}) → {} (R:R {:.2f})",
                oldScripCode, oldRR, newScripCode, newRR);

        // Remove old trade
        activeTrades.remove(oldScripCode);

        // Broadcast notification
        sessionManager.broadcastNotification("TRADE_REPLACEMENT",
                String.format("🔄 Replaced %s → %s (Better R:R: %.2f)", oldScripCode, newScripCode, newRR));
    }

    /**
     * Handle portfolio update
     */
    private void handlePortfolioUpdate(JsonNode root) {
        double currentCapital = root.path("currentCapital").asDouble(0);
        double totalProfitLoss = root.path("totalProfitLoss").asDouble(0);
        double roi = root.path("roi").asDouble(0);

        log.info("📊 [P&L] PORTFOLIO_UPDATE: Capital=₹{:.2f}, P&L=₹{:.2f}, ROI={:.2f}%",
                currentCapital, totalProfitLoss, roi);

        // Update real-time totals
        realtimePnl.set(totalProfitLoss);

        // Broadcast wallet update with real-time data
        refreshAndBroadcastWallet();
    }

    /**
     * Broadcast trade event to WebSocket
     */
    private void broadcastTradeEvent(String type, TradeInfo trade, double pnl) {
        if (trade == null) return;

        Map<String, Object> event = Map.of(
                "type", type,
                "tradeId", trade.getTradeId() != null ? trade.getTradeId() : "",
                "scripCode", trade.getScripCode(),
                "companyName", trade.getCompanyName(),
                "signalType", trade.getSignalType(),
                "entryPrice", trade.getEntryPrice(),
                "positionSize", trade.getPositionSize(),
                "pnl", pnl,
                "timestamp", System.currentTimeMillis()
        );

        sessionManager.broadcastTradeUpdate(event);
    }

    /**
     * Refresh wallet from MongoDB and broadcast with real-time overlay
     */
    private void refreshAndBroadcastWallet() {
        try {
            walletService.refreshWallet();
            WalletDTO wallet = walletService.getWallet();

            // Overlay real-time P&L data
            if (wallet != null) {
                // Add real-time P&L if MongoDB data is stale
                double realtimeTotal = realtimePnl.get();
                if (realtimeTotal != 0 && wallet.getTotalPnl() == 0) {
                    wallet.setTotalPnl(realtimeTotal);
                }
                
                double dayTotal = dayPnl.get();
                if (dayTotal != 0 && wallet.getDayPnl() == 0) {
                    wallet.setDayPnl(dayTotal);
                }

                // Update trade counts
                wallet.setTotalTradesCount(Math.max(wallet.getTotalTradesCount(), totalTrades.get()));
            }

            sessionManager.broadcastWalletUpdate(wallet);
            
        } catch (Exception e) {
            log.error("Error refreshing/broadcasting wallet: {}", e.getMessage());
        }
    }

    // ========== REST API Support ==========

    public Map<String, TradeInfo> getActiveTrades() {
        return new ConcurrentHashMap<>(activeTrades);
    }

    public double getRealtimePnl() {
        return realtimePnl.get();
    }

    public double getDayPnl() {
        return dayPnl.get();
    }

    public int getDayTradesCount() {
        return dayTrades.get();
    }

    /**
     * Reset day counters (call at market open)
     */
    public void resetDayCounters() {
        dayPnl.set(0.0);
        dayTrades.set(0);
        log.info("Day P&L counters reset");
    }
}
