package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.PositionDTO;
import com.kotsin.dashboard.model.dto.WalletDTO;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;

/**
 * Service for wallet and position data.
 *
 * Data Sources:
 * - Redis: Real-time positions (wallet:positions:*) from TradeExecutionModule
 * - MongoDB: Trade history (backtest_trades collection)
 */
@Service
@Slf4j
public class WalletService {

    @Autowired
    private MongoTemplate mongoTemplate;

    @Autowired(required = false)
    private RedisTemplate<String, String> redisTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private WalletDTO cachedWallet;
    private long lastRefreshTime = 0;
    private static final long CACHE_TTL_MS = 5000; // 5 second cache

    // Configuration
    private static final double INITIAL_CAPITAL = 100000.0;

    /**
     * Get current wallet state
     */
    public WalletDTO getWallet() {
        if (cachedWallet == null || System.currentTimeMillis() - lastRefreshTime > CACHE_TTL_MS) {
            refreshWallet();
        }
        return cachedWallet;
    }

    /**
     * Refresh wallet from Redis (positions) and MongoDB (trade history)
     */
    public void refreshWallet() {
        try {
            // Get positions from Redis
            List<PositionDTO> positions = getPositionsFromRedis();

            int openPositions = (int) positions.stream()
                    .filter(p -> p.getQuantity() > 0)
                    .count();

            // Calculate P&L from positions
            double unrealizedPnl = positions.stream()
                    .mapToDouble(PositionDTO::getUnrealizedPnl)
                    .sum();

            // Get trade stats from MongoDB (backtest_trades collection)
            TradeStats stats = getTradeStatsFromMongo();

            double currentCapital = INITIAL_CAPITAL + stats.totalPnl;

            cachedWallet = WalletDTO.builder()
                    .walletId("virtual-wallet-1")
                    .initialCapital(INITIAL_CAPITAL)
                    .currentCapital(currentCapital)
                    .availableMargin(currentCapital - calculateMarginUsed(positions))
                    .realizedPnl(stats.totalPnl)
                    .unrealizedPnl(unrealizedPnl)
                    .totalPnl(stats.totalPnl + unrealizedPnl)
                    .dayPnl(stats.dayPnl)
                    .openPositionsCount(openPositions)
                    .totalTradesCount(stats.totalTrades)
                    .winCount(stats.wins)
                    .lossCount(stats.losses)
                    .winRate(stats.winRate)
                    .lastUpdated(LocalDateTime.now())
                    .positions(positions)
                    .build();

            lastRefreshTime = System.currentTimeMillis();
            log.debug("Wallet refreshed: {} positions, {} trades, P&L={}",
                openPositions, stats.totalTrades, stats.totalPnl);

        } catch (Exception e) {
            log.error("Error refreshing wallet: {}", e.getMessage(), e);
            // Return empty wallet if error
            if (cachedWallet == null) {
                cachedWallet = createEmptyWallet();
            }
        }
    }

    /**
     * Get positions from Redis (wallet:positions:*)
     */
    private List<PositionDTO> getPositionsFromRedis() {
        List<PositionDTO> positions = new ArrayList<>();

        if (redisTemplate == null) {
            log.warn("Redis not available, returning empty positions");
            return positions;
        }

        try {
            Set<String> keys = redisTemplate.keys("wallet:positions:*");
            if (keys == null || keys.isEmpty()) {
                log.debug("No positions found in Redis");
                return positions;
            }

            for (String key : keys) {
                try {
                    String value = redisTemplate.opsForValue().get(key);
                    if (value != null) {
                        PositionDTO pos = parseRedisPosition(key, value);
                        if (pos != null && pos.getQuantity() > 0) {
                            positions.add(pos);
                        }
                    }
                } catch (Exception e) {
                    log.warn("Error parsing position {}: {}", key, e.getMessage());
                }
            }

            log.debug("Found {} positions in Redis", positions.size());

        } catch (Exception e) {
            log.error("Error getting positions from Redis: {}", e.getMessage());
        }

        return positions;
    }

    /**
     * Parse position from Redis JSON
     */
    private PositionDTO parseRedisPosition(String key, String json) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> data = objectMapper.readValue(json, Map.class);

            String scripCode = (String) data.get("scripCode");
            if (scripCode == null) {
                scripCode = key.replace("wallet:positions:", "");
            }

            int qty = data.get("qty") != null ? ((Number) data.get("qty")).intValue() : 0;
            double avgPrice = data.get("avgPrice") != null ? ((Number) data.get("avgPrice")).doubleValue() : 0;

            // For now, we don't have current price from Redis, so P&L is 0
            // This will be updated when we receive price updates via Kafka

            return PositionDTO.builder()
                    .positionId(key)
                    .scripCode(scripCode)
                    .companyName(scripCode) // Will be enriched later
                    .side("LONG") // Default, can be improved
                    .quantity(qty)
                    .avgEntryPrice(avgPrice)
                    .currentPrice(avgPrice) // Will be updated with live prices
                    .unrealizedPnl(0)
                    .unrealizedPnlPercent(0)
                    .status(qty > 0 ? "ACTIVE" : "CLOSED")
                    .lastUpdated(LocalDateTime.now())
                    .build();

        } catch (Exception e) {
            log.warn("Error parsing Redis position: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Get trade statistics from MongoDB (backtest_trades collection)
     */
    private TradeStats getTradeStatsFromMongo() {
        TradeStats stats = new TradeStats();

        try {
            // Query backtest_trades collection (used by TradeExecutionModule)
            long totalTrades = mongoTemplate.getCollection("backtest_trades").countDocuments();

            // Count wins (where pnl > 0 or isWin = true)
            long wins = mongoTemplate.getCollection("backtest_trades")
                    .countDocuments(new Document("$or", List.of(
                        new Document("isWin", true),
                        new Document("pnl", new Document("$gt", 0))
                    )));

            stats.totalTrades = (int) totalTrades;
            stats.wins = (int) wins;
            stats.losses = (int) (totalTrades - wins);
            stats.winRate = totalTrades > 0 ? (double) wins / totalTrades * 100 : 0;

            // Sum total P&L
            for (Document doc : mongoTemplate.getCollection("backtest_trades").find()) {
                Double pnl = doc.getDouble("pnl");
                if (pnl != null) {
                    stats.totalPnl += pnl;
                }
            }

            // Calculate day P&L
            stats.dayPnl = calculateDayPnl();

            log.debug("Trade stats: {} trades, {} wins, P&L={}",
                stats.totalTrades, stats.wins, stats.totalPnl);

        } catch (Exception e) {
            log.error("Error getting trade stats from MongoDB: {}", e.getMessage());
        }

        return stats;
    }

    /**
     * Get all positions (for API)
     */
    public List<PositionDTO> getPositions() {
        return getPositionsFromRedis();
    }

    /**
     * Get open positions only
     */
    public List<PositionDTO> getOpenPositions() {
        return getPositions().stream()
                .filter(p -> p.getQuantity() > 0)
                .toList();
    }

    private double calculateMarginUsed(List<PositionDTO> positions) {
        return positions.stream()
                .filter(p -> p.getQuantity() > 0)
                .mapToDouble(p -> p.getAvgEntryPrice() * p.getQuantity())
                .sum();
    }

    private double calculateDayPnl() {
        try {
            LocalDateTime startOfDay = LocalDateTime.now()
                    .withHour(0).withMinute(0).withSecond(0);
            long startOfDayMs = startOfDay.atZone(ZoneId.of("Asia/Kolkata"))
                    .toInstant().toEpochMilli();

            Document query = new Document("exitTime",
                new Document("$gte", startOfDayMs));

            double dayPnl = 0;
            for (Document doc : mongoTemplate.getCollection("backtest_trades").find(query)) {
                Double pnl = doc.getDouble("pnl");
                if (pnl != null) {
                    dayPnl += pnl;
                }
            }
            return dayPnl;

        } catch (Exception e) {
            log.warn("Error calculating day P&L: {}", e.getMessage());
            return 0;
        }
    }

    private WalletDTO createEmptyWallet() {
        return WalletDTO.builder()
                .walletId("virtual-wallet-1")
                .initialCapital(INITIAL_CAPITAL)
                .currentCapital(INITIAL_CAPITAL)
                .availableMargin(INITIAL_CAPITAL)
                .positions(new ArrayList<>())
                .lastUpdated(LocalDateTime.now())
                .build();
    }

    /**
     * Helper class for trade statistics
     */
    private static class TradeStats {
        int totalTrades = 0;
        int wins = 0;
        int losses = 0;
        double winRate = 0;
        double totalPnl = 0;
        double dayPnl = 0;
    }
}
