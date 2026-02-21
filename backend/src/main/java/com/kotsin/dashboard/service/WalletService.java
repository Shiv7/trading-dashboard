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

    @Autowired
    private ScripLookupService scripLookup;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // FIX BUG #28: Add synchronization to prevent race conditions
    private volatile WalletDTO cachedWallet;
    private volatile long lastRefreshTime = 0;
    private static final long CACHE_TTL_MS = 5000; // 5 second cache
    private final Object cacheLock = new Object();

    // Configuration
    private static final double INITIAL_CAPITAL = 100000.0;

    /**
     * Get current wallet state
     * FIX BUG #28: Thread-safe cache access
     */
    public WalletDTO getWallet() {
        // Fast path: check if cache is valid without locking
        if (cachedWallet != null && System.currentTimeMillis() - lastRefreshTime <= CACHE_TTL_MS) {
            return cachedWallet;
        }

        // Slow path: refresh with lock to prevent concurrent refreshes
        synchronized (cacheLock) {
            // Double-check after acquiring lock
            if (cachedWallet == null || System.currentTimeMillis() - lastRefreshTime > CACHE_TTL_MS) {
                refreshWallet();
            }
        }
        return cachedWallet;
    }

    /**
     * Refresh wallet from Redis (positions) and MongoDB (trade history)
     */
    public void refreshWallet() {
        try {
            // Get positions from Redis (single source of truth for live positions)
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
                        if (pos != null) {
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

            // Read unrealized P&L from trade execution (updated every 500ms)
            double storedUnrealizedPnl = data.get("unrealizedPnl") != null ?
                ((Number) data.get("unrealizedPnl")).doubleValue() : 0;

            // FIX: Read signal ID for linking
            String signalId = (String) data.get("signalId");

            // Extract strategy with fallback chain: signalSource -> strategy -> signalType -> UNKNOWN
            String strategy = data.get("signalSource") != null ? data.get("signalSource").toString() : null;
            if (strategy == null || strategy.isEmpty()) {
                strategy = data.get("strategy") != null ? data.get("strategy").toString() : null;
            }
            if (strategy == null || strategy.isEmpty()) {
                strategy = data.get("signalType") != null ? data.get("signalType").toString() : null;
            }
            if (strategy == null || strategy.isEmpty()) {
                strategy = "UNKNOWN";
            }

            // FIX: Read timestamps
            long openedAtMs = data.get("openedAt") != null ? ((Number) data.get("openedAt")).longValue() : System.currentTimeMillis();
            long updatedAtMs = data.get("updatedAt") != null ? ((Number) data.get("updatedAt")).longValue() : System.currentTimeMillis();

            LocalDateTime openedAt = LocalDateTime.ofInstant(
                Instant.ofEpochMilli(openedAtMs), ZoneId.of("Asia/Kolkata"));
            LocalDateTime lastUpdated = LocalDateTime.ofInstant(
                Instant.ofEpochMilli(updatedAtMs), ZoneId.of("Asia/Kolkata"));

            // FIX BUG #2, #1: Get current price from Redis data or use trailing stop as proxy
            // Read currentPrice from Redis if available
            Double storedCurrentPrice = data.get("currentPrice") != null ?
                ((Number) data.get("currentPrice")).doubleValue() : null;

            // FIX: Normalize side - convert BUY/SELL to LONG/SHORT for consistent handling
            String normalizedSide = normalizeSide(side);

            double currentPrice;
            double unrealizedPnl = 0;
            double unrealizedPnlPercent = 0;

            // Priority: 1) Stored currentPrice, 2) Live tick from Redis, 3) Trailing stop estimate, 4) Entry price
            if (storedCurrentPrice != null && storedCurrentPrice > 0) {
                currentPrice = storedCurrentPrice;
            } else {
                // Try to get live price from tick data in Redis (streaming candle stores this)
                Double tickPrice = getLatestTickPrice(scripCode);
                if (tickPrice != null && tickPrice > 0) {
                    currentPrice = tickPrice;
                } else if (trailingStop != null && trailingStop > 0) {
                    if ("LONG".equals(normalizedSide)) {
                        currentPrice = trailingStop * 1.01;
                    } else {
                        currentPrice = trailingStop * 0.99;
                    }
                } else {
                    currentPrice = avgEntry;
                    log.debug("No live price for {} - using entry price as fallback", scripCode);
                }
            }

            // Calculate unrealized P&L - prefer trade execution's value, fallback to our calculation
            if (qtyOpen > 0 && avgEntry > 0) {
                if (storedUnrealizedPnl != 0) {
                    // Use the value from trade execution (updated every 500ms with real LTP)
                    unrealizedPnl = storedUnrealizedPnl;
                } else if ("LONG".equals(normalizedSide)) {
                    unrealizedPnl = (currentPrice - avgEntry) * qtyOpen;
                } else {
                    unrealizedPnl = (avgEntry - currentPrice) * qtyOpen;
                }
                // P&L percent: positive means profit for both LONG and SHORT
                double positionCost = avgEntry * qtyOpen;
                unrealizedPnlPercent = positionCost > 0 ? (unrealizedPnl / positionCost) * 100 : 0;
            }

            // Read dual equity/option levels for strategy trades
            Double equitySl = data.get("equitySl") != null ? ((Number) data.get("equitySl")).doubleValue() : null;
            Double equityT1 = data.get("equityT1") != null ? ((Number) data.get("equityT1")).doubleValue() : null;
            Double equityT2 = data.get("equityT2") != null ? ((Number) data.get("equityT2")).doubleValue() : null;
            Double equityT3 = data.get("equityT3") != null ? ((Number) data.get("equityT3")).doubleValue() : null;
            Double equityT4 = data.get("equityT4") != null ? ((Number) data.get("equityT4")).doubleValue() : null;
            Double optionSl = data.get("optionSl") != null ? ((Number) data.get("optionSl")).doubleValue() : null;
            Double optionT1 = data.get("optionT1") != null ? ((Number) data.get("optionT1")).doubleValue() : null;
            Double optionT2 = data.get("optionT2") != null ? ((Number) data.get("optionT2")).doubleValue() : null;
            Double optionT3 = data.get("optionT3") != null ? ((Number) data.get("optionT3")).doubleValue() : null;
            Double optionT4 = data.get("optionT4") != null ? ((Number) data.get("optionT4")).doubleValue() : null;
            Double target3 = data.get("target3") != null ? ((Number) data.get("target3")).doubleValue() : null;
            Double target4 = data.get("target4") != null ? ((Number) data.get("target4")).doubleValue() : null;
            Boolean t1HitFlag = data.get("t1Hit") != null ? Boolean.TRUE.equals(data.get("t1Hit")) : null;
            Boolean t2Hit = data.get("t2Hit") != null ? Boolean.TRUE.equals(data.get("t2Hit")) : null;
            Boolean t3Hit = data.get("t3Hit") != null ? Boolean.TRUE.equals(data.get("t3Hit")) : null;
            Boolean t4Hit = data.get("t4Hit") != null ? Boolean.TRUE.equals(data.get("t4Hit")) : null;
            Boolean slHit = data.get("slHit") != null ? Boolean.TRUE.equals(data.get("slHit")) : null;
            String instrumentType = data.get("instrumentType") != null ? data.get("instrumentType").toString() : null;
            Double delta = data.get("delta") != null ? ((Number) data.get("delta")).doubleValue() : null;
            String exitReason = data.get("exitReason") != null ? data.get("exitReason").toString() : null;
            Double equityLtp = data.get("equityLtp") != null ? ((Number) data.get("equityLtp")).doubleValue() : null;

            // Exit history: per-target exit events
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> exitHistory = data.get("exitHistory") != null
                ? (List<Map<String, Object>>) data.get("exitHistory") : null;

            // Use instrumentSymbol for display if available (strategy trades)
            String displayName = data.get("instrumentSymbol") != null
                ? data.get("instrumentSymbol").toString()
                : resolveCompanyName(scripCode);

            return PositionDTO.builder()
                    .positionId(key)
                    .signalId(signalId)
                    .scripCode(scripCode)
                    .companyName(displayName)
                    .side(normalizedSide) // FIX BUG #6: Use normalized side (LONG/SHORT)
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
                    .strategy(strategy)
                    // Strategy trade dual levels
                    .equitySl(equitySl)
                    .equityT1(equityT1)
                    .equityT2(equityT2)
                    .equityT3(equityT3)
                    .equityT4(equityT4)
                    .optionSl(optionSl)
                    .optionT1(optionT1)
                    .optionT2(optionT2)
                    .optionT3(optionT3)
                    .optionT4(optionT4)
                    .target3(target3)
                    .target4(target4)
                    .t1Hit(t1HitFlag)
                    .t2Hit(t2Hit)
                    .t3Hit(t3Hit)
                    .t4Hit(t4Hit)
                    .slHit(slHit)
                    .instrumentType(instrumentType)
                    .delta(delta)
                    .exitReason(exitReason)
                    .equityLtp(equityLtp)
                    .exitHistory(exitHistory)
                    .build();

        } catch (Exception e) {
            log.warn("Error parsing Redis position {}: {}", key, e.getMessage());
            return null;
        }
    }

    /**
     * Get trade statistics from MongoDB (backtest_trades) as single source of truth,
     * supplemented by Redis closed positions for realized P&L.
     *
     * FIX BUG #1: Use MongoDB backtest_trades as the sole source for win/loss/winRate
     *   instead of mixing Redis orders with MongoDB trades.
     * FIX BUG #2: Count completed round-trip trades from backtest_trades (each document
     *   is one round-trip trade), not individual order legs from virtual:orders:*.
     */
    private TradeStats getTradeStatsFromMongo() {
        TradeStats stats = new TradeStats();

        // Get realized P&L from Redis closed positions (supplements MongoDB P&L)
        double redisClosedPnl = 0;
        try {
            if (redisTemplate != null) {
                Set<String> positionKeys = redisTemplate.keys("virtual:positions:*");
                if (positionKeys != null) {
                    for (String key : positionKeys) {
                        try {
                            String value = redisTemplate.opsForValue().get(key);
                            if (value != null) {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> pos = objectMapper.readValue(value, Map.class);
                                Double pnl = pos.get("realizedPnl") != null ? ((Number) pos.get("realizedPnl")).doubleValue() : 0;
                                int qtyOpen = pos.get("qtyOpen") != null ? ((Number) pos.get("qtyOpen")).intValue() : 0;
                                String status = pos.get("status") != null ? pos.get("status").toString() : "";

                                // Only add realized P&L from closed positions
                                boolean isClosed = qtyOpen == 0 || "CLOSED".equals(status);
                                if (isClosed && pnl != 0) {
                                    redisClosedPnl += pnl;
                                }
                            }
                        } catch (Exception e) {
                            // Skip unparseable positions
                        }
                    }
                }
                log.debug("Redis closed positions realized P&L: {}", redisClosedPnl);
            }
        } catch (Exception e) {
            log.warn("Error getting P&L from Redis positions: {}", e.getMessage());
        }

        // Use MongoDB backtest_trades as single source of truth for trade counts and win rate
        try {
            // Each document in backtest_trades represents one completed round-trip trade
            long mongoTrades = mongoTemplate.getCollection("backtest_trades").countDocuments();

            long mongoWins = mongoTemplate.getCollection("backtest_trades")
                    .countDocuments(new Document("$or", List.of(
                        new Document("isWin", true),
                        new Document("pnl", new Document("$gt", 0))
                    )));

            stats.totalTrades = (int) mongoTrades;
            stats.wins = (int) mongoWins;
            stats.losses = Math.max(0, stats.totalTrades - stats.wins);
            stats.winRate = stats.totalTrades > 0 ? (double) stats.wins / stats.totalTrades * 100 : 0;

            // Sum total P&L from MongoDB
            double mongoPnl = 0;
            for (Document doc : mongoTemplate.getCollection("backtest_trades").find()) {
                Double pnl = doc.getDouble("pnl");
                if (pnl != null) {
                    mongoPnl += pnl;
                }
            }

            // Combine MongoDB P&L with Redis closed-position P&L (for trades not yet persisted to Mongo)
            stats.totalPnl = mongoPnl + redisClosedPnl;

            // Calculate day P&L
            stats.dayPnl = calculateDayPnl();

            log.debug("Trade stats: {} trades, {} wins, winRate={}%, P&L={} (mongo={}, redis={})",
                stats.totalTrades, stats.wins, stats.winRate, stats.totalPnl, mongoPnl, redisClosedPnl);

        } catch (Exception e) {
            log.error("Error getting trade stats from MongoDB: {}", e.getMessage());
        }

        return stats;
    }

    /**
     * Get all positions from Redis (single source of truth)
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

    /**
     * FIX BUG #19: Calculate margin using CURRENT price (mark-to-market), not entry price
     * This gives accurate available margin for new trades.
     */
    private double calculateMarginUsed(List<PositionDTO> positions) {
        return positions.stream()
                .filter(p -> p.getQuantity() > 0)
                .mapToDouble(p -> {
                    // Use current price for mark-to-market margin calculation
                    double price = p.getCurrentPrice() > 0 ? p.getCurrentPrice() : p.getAvgEntryPrice();
                    return price * p.getQuantity();
                })
                .sum();
    }

    /**
     * FIX BUG #20: Calculate day P&L including both realized (closed today) and unrealized (opened today)
     * FIX BUG #3: Include Redis-closed trades in day P&L (trades closed via virtual engine
     *   that may not yet be persisted to MongoDB)
     */
    private double calculateDayPnl() {
        try {
            LocalDateTime startOfDay = LocalDateTime.now()
                    .withHour(0).withMinute(0).withSecond(0);
            long startOfDayMs = startOfDay.atZone(ZoneId.of("Asia/Kolkata"))
                    .toInstant().toEpochMilli();

            double dayPnl = 0;

            // 1. Get realized P&L from trades closed today (MongoDB)
            Document closedTodayQuery = new Document("exitTime",
                new Document("$gte", startOfDayMs));

            for (Document doc : mongoTemplate.getCollection("backtest_trades").find(closedTodayQuery)) {
                Double pnl = doc.getDouble("pnl");
                if (pnl != null) {
                    dayPnl += pnl;
                }
            }

            // 2. Get realized P&L from Redis-closed positions that closed today
            //    These are trades closed via the virtual trading engine that may not
            //    yet be written to MongoDB.
            if (redisTemplate != null) {
                Set<String> positionKeys = redisTemplate.keys("virtual:positions:*");
                if (positionKeys != null) {
                    for (String key : positionKeys) {
                        try {
                            String value = redisTemplate.opsForValue().get(key);
                            if (value != null) {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> pos = objectMapper.readValue(value, Map.class);
                                int qtyOpen = pos.get("qtyOpen") != null ? ((Number) pos.get("qtyOpen")).intValue() : 0;
                                String status = pos.get("status") != null ? pos.get("status").toString() : "";
                                Double pnl = pos.get("realizedPnl") != null ? ((Number) pos.get("realizedPnl")).doubleValue() : null;

                                boolean isClosed = qtyOpen == 0 || "CLOSED".equals(status);
                                if (isClosed && pnl != null && pnl != 0) {
                                    // Check if this position was closed today using updatedAt timestamp
                                    long updatedAtMs = pos.get("updatedAt") != null ?
                                            ((Number) pos.get("updatedAt")).longValue() : 0;
                                    if (updatedAtMs >= startOfDayMs) {
                                        dayPnl += pnl;
                                    }
                                }
                            }
                        } catch (Exception e) {
                            // Skip unparseable positions
                        }
                    }
                }
            }

            // 3. Add unrealized P&L from positions opened today
            List<PositionDTO> positions = getPositionsFromRedis();
            for (PositionDTO pos : positions) {
                if (pos.getQuantity() > 0 && pos.getOpenedAt() != null) {
                    // Check if position was opened today
                    long posOpenedMs = pos.getOpenedAt().atZone(ZoneId.of("Asia/Kolkata"))
                            .toInstant().toEpochMilli();
                    if (posOpenedMs >= startOfDayMs) {
                        dayPnl += pos.getUnrealizedPnl();
                    }
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
     * Get latest price from tick candle data in Redis.
     * Streaming candle stores latest 1m candle at tick:{scripCode}:1m:latest
     * Format: ["com.kotsin.consumer.model.TickCandle", { "close": 320.25, ... }]
     */
    private Double getLatestTickPrice(String scripCode) {
        try {
            String tickKey = "tick:" + scripCode + ":1m:latest";
            String tickJson = redisTemplate.opsForValue().get(tickKey);
            if (tickJson != null && !tickJson.isEmpty()) {
                // Parse Jackson polymorphic array: [className, {data}]
                Object parsed = objectMapper.readValue(tickJson, Object.class);
                if (parsed instanceof List) {
                    List<?> arr = (List<?>) parsed;
                    if (arr.size() >= 2 && arr.get(1) instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> tickData = (Map<String, Object>) arr.get(1);
                        Object closeVal = tickData.get("close");
                        if (closeVal instanceof Number) {
                            return ((Number) closeVal).doubleValue();
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Could not get tick price for {}: {}", scripCode, e.getMessage());
        }
        return null;
    }

    /**
     * FIX BUG #6: Normalize side from BUY/SELL to LONG/SHORT
     * This ensures consistent handling regardless of how the side was stored.
     */
    private String normalizeSide(String side) {
        if (side == null) return "LONG";
        switch (side.toUpperCase()) {
            case "BUY":
            case "LONG":
                return "LONG";
            case "SELL":
            case "SHORT":
                return "SHORT";
            default:
                log.warn("Unknown side '{}', defaulting to LONG", side);
                return "LONG";
        }
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

    private String resolveCompanyName(String scripCode) {
        return scripLookup.resolve(scripCode);
    }
}
