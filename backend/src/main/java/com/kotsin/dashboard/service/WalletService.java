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
 * - Redis: Real-time positions (virtual:positions:*) from TradeExecutionModule VirtualEngineService
 * - Redis: Virtual orders (virtual:orders:*) for trade counts
 * - MongoDB: Trade history (backtest_trades collection) for historical stats
 */
@Service
@Slf4j
public class WalletService {

    @Autowired
    private MongoTemplate mongoTemplate;

    @Autowired
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
     * Get positions from Redis (virtual:positions:*)
     * FIX: Changed from wallet:positions:* to virtual:positions:* where actual position data is stored
     */
    private List<PositionDTO> getPositionsFromRedis() {
        List<PositionDTO> positions = new ArrayList<>();

        if (redisTemplate == null) {
            log.warn("WALLET: RedisTemplate is NULL - Redis not available, returning empty positions");
            return positions;
        }

        try {
            // FIX: Read from virtual:positions:* where VirtualEngineService stores positions
            Set<String> keys = redisTemplate.keys("virtual:positions:*");
            log.info("WALLET: Found {} keys matching virtual:positions:*", keys != null ? keys.size() : 0);
            if (keys == null || keys.isEmpty()) {
                log.info("WALLET: No positions found in Redis (virtual:positions:*)");
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

            log.debug("Found {} open positions in Redis", positions.size());

        } catch (Exception e) {
            log.error("Error getting positions from Redis: {}", e.getMessage());
        }

        return positions;
    }

    /**
     * Parse position from Redis JSON (VirtualPosition format)
     * FIX: Updated to match VirtualPosition field names from TradeExecutionModule
     */
    private PositionDTO parseRedisPosition(String key, String json) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> data = objectMapper.readValue(json, Map.class);

            // FIX: scripCode field name is correct
            String scripCode = (String) data.get("scripCode");
            if (scripCode == null) {
                scripCode = key.replace("virtual:positions:", "");
            }

            // FIX: VirtualPosition uses 'qtyOpen' not 'qty'
            int qtyOpen = data.get("qtyOpen") != null ? ((Number) data.get("qtyOpen")).intValue() : 0;

            // FIX: VirtualPosition uses 'avgEntry' not 'avgPrice'
            double avgEntry = data.get("avgEntry") != null ? ((Number) data.get("avgEntry")).doubleValue() : 0;

            // FIX: Read actual side from data instead of hardcoding
            String side = data.get("side") != null ? data.get("side").toString() : "LONG";

            // FIX: Read SL, TP1, TP2 values
            double sl = data.get("sl") != null ? ((Number) data.get("sl")).doubleValue() : 0;
            double tp1 = data.get("tp1") != null ? ((Number) data.get("tp1")).doubleValue() : 0;
            double tp2 = data.get("tp2") != null ? ((Number) data.get("tp2")).doubleValue() : 0;

            // FIX: Read tp1Hit flag
            boolean tp1Hit = data.get("tp1Hit") != null && Boolean.TRUE.equals(data.get("tp1Hit"));

            // FIX: Read trailing stop configuration
            String trailingType = data.get("trailingType") != null ? data.get("trailingType").toString() : "NONE";
            Double trailingStop = data.get("trailingStop") != null ? ((Number) data.get("trailingStop")).doubleValue() : null;

            // FIX: Read realized P&L
            double realizedPnl = data.get("realizedPnl") != null ? ((Number) data.get("realizedPnl")).doubleValue() : 0;

            // FIX: Read signal ID for linking
            String signalId = (String) data.get("signalId");

            // FIX: Read timestamps
            long openedAtMs = data.get("openedAt") != null ? ((Number) data.get("openedAt")).longValue() : System.currentTimeMillis();
            long updatedAtMs = data.get("updatedAt") != null ? ((Number) data.get("updatedAt")).longValue() : System.currentTimeMillis();

            LocalDateTime openedAt = LocalDateTime.ofInstant(
                Instant.ofEpochMilli(openedAtMs), ZoneId.of("Asia/Kolkata"));
            LocalDateTime lastUpdated = LocalDateTime.ofInstant(
                Instant.ofEpochMilli(updatedAtMs), ZoneId.of("Asia/Kolkata"));

            // Use avgEntry as currentPrice fallback (unrealized P&L = 0 until we get live prices)
            // In a complete implementation, we'd fetch live price from a price service
            double currentPrice = avgEntry;
            double unrealizedPnl = 0;
            double unrealizedPnlPercent = 0;

            // Calculate unrealized P&L if we have trailing stop (use it as proxy for current price movement)
            if (trailingStop != null && trailingStop > 0 && qtyOpen > 0) {
                // Estimate current price from trailing stop movement
                if ("LONG".equals(side)) {
                    // For LONG, trailingStop moves up as price increases
                    unrealizedPnl = (trailingStop - avgEntry) * qtyOpen * 0.5; // Conservative estimate
                } else {
                    unrealizedPnl = (avgEntry - trailingStop) * qtyOpen * 0.5;
                }
                if (avgEntry > 0) {
                    unrealizedPnlPercent = (unrealizedPnl / (avgEntry * qtyOpen)) * 100;
                }
            }

            return PositionDTO.builder()
                    .positionId(key)
                    .signalId(signalId)
                    .scripCode(scripCode)
                    .companyName(scripCode) // Will be enriched by company name service
                    .side(side)
                    .quantity(qtyOpen)
                    .avgEntryPrice(avgEntry)
                    .currentPrice(currentPrice)
                    .stopLoss(sl)
                    .target1(tp1)
                    .target2(tp2)
                    .unrealizedPnl(unrealizedPnl)
                    .unrealizedPnlPercent(unrealizedPnlPercent)
                    .realizedPnl(realizedPnl)
                    .tp1Hit(tp1Hit)
                    .status(qtyOpen > 0 ? "ACTIVE" : "CLOSED")
                    .trailingType(trailingType)
                    .trailingStop(trailingStop)
                    .openedAt(openedAt)
                    .lastUpdated(lastUpdated)
                    .build();

        } catch (Exception e) {
            log.warn("Error parsing Redis position {}: {}", key, e.getMessage());
            return null;
        }
    }

    /**
     * Get trade statistics from both Redis and MongoDB
     * FIX: Now also reads from virtual:orders:* and virtual:positions:* for P&L
     */
    private TradeStats getTradeStatsFromMongo() {
        TradeStats stats = new TradeStats();

        // First, try to get stats from Redis (virtual:orders:* and virtual:positions:*)
        try {
            if (redisTemplate != null) {
                // Count filled orders from Redis
                Set<String> orderKeys = redisTemplate.keys("virtual:orders:*");
                int redisOrderCount = 0;
                int redisWins = 0;

                if (orderKeys != null) {
                    for (String key : orderKeys) {
                        try {
                            String value = redisTemplate.opsForValue().get(key);
                            if (value != null) {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> order = objectMapper.readValue(value, Map.class);
                                String status = order.get("status") != null ? order.get("status").toString() : "";
                                if ("FILLED".equals(status) || "COMPLETED".equals(status)) {
                                    redisOrderCount++;
                                }
                            }
                        } catch (Exception e) {
                            // Skip unparseable orders
                        }
                    }
                }

                // Get realized P&L from positions
                Set<String> positionKeys = redisTemplate.keys("virtual:positions:*");
                double redisRealizedPnl = 0;
                if (positionKeys != null) {
                    for (String key : positionKeys) {
                        try {
                            String value = redisTemplate.opsForValue().get(key);
                            if (value != null) {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> pos = objectMapper.readValue(value, Map.class);
                                Double pnl = pos.get("realizedPnl") != null ? ((Number) pos.get("realizedPnl")).doubleValue() : 0;
                                redisRealizedPnl += pnl;
                                if (pnl > 0) redisWins++;
                            }
                        } catch (Exception e) {
                            // Skip unparseable positions
                        }
                    }
                }

                stats.totalTrades = redisOrderCount;
                stats.totalPnl = redisRealizedPnl;
                stats.wins = redisWins;
                stats.losses = Math.max(0, (positionKeys != null ? positionKeys.size() : 0) - redisWins);

                log.debug("Redis stats: {} orders, {} realized P&L from {} positions",
                    redisOrderCount, redisRealizedPnl, positionKeys != null ? positionKeys.size() : 0);
            }
        } catch (Exception e) {
            log.warn("Error getting stats from Redis: {}", e.getMessage());
        }

        // Then augment/fallback with MongoDB stats
        try {
            long mongoTrades = mongoTemplate.getCollection("backtest_trades").countDocuments();

            long mongoWins = mongoTemplate.getCollection("backtest_trades")
                    .countDocuments(new Document("$or", List.of(
                        new Document("isWin", true),
                        new Document("pnl", new Document("$gt", 0))
                    )));

            // Use max of Redis and MongoDB counts
            stats.totalTrades = Math.max(stats.totalTrades, (int) mongoTrades);
            stats.wins = Math.max(stats.wins, (int) mongoWins);
            stats.losses = Math.max(0, stats.totalTrades - stats.wins);
            stats.winRate = stats.totalTrades > 0 ? (double) stats.wins / stats.totalTrades * 100 : 0;

            // Sum total P&L from MongoDB and add to Redis P&L
            double mongoPnl = 0;
            for (Document doc : mongoTemplate.getCollection("backtest_trades").find()) {
                Double pnl = doc.getDouble("pnl");
                if (pnl != null) {
                    mongoPnl += pnl;
                }
            }

            // Use whichever P&L is non-zero (prefer Redis as it's more real-time)
            if (stats.totalPnl == 0) {
                stats.totalPnl = mongoPnl;
            }

            // Calculate day P&L
            stats.dayPnl = calculateDayPnl();

            log.debug("Combined stats: {} trades, {} wins, P&L={}",
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
