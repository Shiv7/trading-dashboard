package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.dto.PositionDTO;
import com.kotsin.dashboard.model.dto.WalletDTO;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Service for wallet and position data from MongoDB.
 */
@Service
@Slf4j
public class WalletService {

    @Autowired
    private MongoTemplate mongoTemplate;

    private WalletDTO cachedWallet;
    private long lastRefreshTime = 0;
    private static final long CACHE_TTL_MS = 5000; // 5 second cache

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
     * Refresh wallet from MongoDB
     */
    public void refreshWallet() {
        try {
            // Get wallet settings
            Document settings = mongoTemplate.getCollection("virtual_settings")
                    .find().first();
            
            double initialCapital = 1000000.0; // Default 10 lakh
            double currentCapital = initialCapital;
            
            if (settings != null) {
                initialCapital = settings.getDouble("initialCapital") != null 
                    ? settings.getDouble("initialCapital") : initialCapital;
                currentCapital = settings.getDouble("accountValue") != null 
                    ? settings.getDouble("accountValue") : initialCapital;
            }

            // Get positions
            List<PositionDTO> positions = getPositions();
            int openPositions = (int) positions.stream()
                    .filter(p -> p.getQuantity() > 0)
                    .count();

            // Calculate P&L from positions
            double unrealizedPnl = positions.stream()
                    .mapToDouble(PositionDTO::getUnrealizedPnl)
                    .sum();
            double realizedPnl = positions.stream()
                    .mapToDouble(PositionDTO::getRealizedPnl)
                    .sum();

            // Get trade stats
            long totalTrades = mongoTemplate.getCollection("trade_outcomes").countDocuments();
            long wins = mongoTemplate.getCollection("trade_outcomes")
                    .countDocuments(new Document("isWin", true));
            
            double winRate = totalTrades > 0 ? (double) wins / totalTrades * 100 : 0;

            cachedWallet = WalletDTO.builder()
                    .walletId("virtual-wallet-1")
                    .initialCapital(initialCapital)
                    .currentCapital(currentCapital)
                    .availableMargin(currentCapital - calculateMarginUsed(positions))
                    .realizedPnl(realizedPnl)
                    .unrealizedPnl(unrealizedPnl)
                    .totalPnl(realizedPnl + unrealizedPnl)
                    .dayPnl(calculateDayPnl())
                    .openPositionsCount(openPositions)
                    .totalTradesCount((int) totalTrades)
                    .winCount((int) wins)
                    .lossCount((int) (totalTrades - wins))
                    .winRate(winRate)
                    .lastUpdated(LocalDateTime.now())
                    .positions(positions)
                    .build();

            lastRefreshTime = System.currentTimeMillis();
            
        } catch (Exception e) {
            log.error("Error refreshing wallet: {}", e.getMessage());
            // Return empty wallet if error
            if (cachedWallet == null) {
                cachedWallet = WalletDTO.builder()
                        .walletId("virtual-wallet-1")
                        .initialCapital(1000000.0)
                        .currentCapital(1000000.0)
                        .positions(new ArrayList<>())
                        .lastUpdated(LocalDateTime.now())
                        .build();
            }
        }
    }

    /**
     * Get all positions
     */
    public List<PositionDTO> getPositions() {
        List<PositionDTO> positions = new ArrayList<>();
        
        try {
            mongoTemplate.getCollection("virtual_positions")
                    .find()
                    .forEach(doc -> {
                        PositionDTO pos = parsePosition(doc);
                        if (pos != null) {
                            positions.add(pos);
                        }
                    });
        } catch (Exception e) {
            log.error("Error getting positions: {}", e.getMessage());
        }
        
        return positions;
    }

    /**
     * Get open positions only
     */
    public List<PositionDTO> getOpenPositions() {
        return getPositions().stream()
                .filter(p -> p.getQuantity() > 0)
                .toList();
    }

    private PositionDTO parsePosition(Document doc) {
        try {
            String scripCode = doc.getString("scripCode");
            String side = doc.getString("side");
            int qty = doc.getInteger("qtyOpen", 0);
            double avgEntry = doc.getDouble("avgEntry") != null ? doc.getDouble("avgEntry") : 0;
            double currentPrice = avgEntry; // Will be updated by price feed
            double sl = doc.getDouble("sl") != null ? doc.getDouble("sl") : 0;
            double tp1 = doc.getDouble("tp1") != null ? doc.getDouble("tp1") : 0;
            double tp2 = doc.getDouble("tp2") != null ? doc.getDouble("tp2") : 0;
            double realizedPnl = doc.getDouble("realizedPnl") != null ? doc.getDouble("realizedPnl") : 0;
            
            // Calculate unrealized P&L
            double unrealizedPnl = 0;
            if (qty > 0 && avgEntry > 0) {
                if ("LONG".equalsIgnoreCase(side)) {
                    unrealizedPnl = (currentPrice - avgEntry) * qty;
                } else {
                    unrealizedPnl = (avgEntry - currentPrice) * qty;
                }
            }
            
            double unrealizedPnlPercent = avgEntry > 0 ? (unrealizedPnl / (avgEntry * qty)) * 100 : 0;
            
            Long openedAt = doc.getLong("openedAt");
            LocalDateTime openedAtTime = openedAt != null 
                ? LocalDateTime.ofInstant(Instant.ofEpochMilli(openedAt), ZoneId.of("Asia/Kolkata"))
                : null;

            return PositionDTO.builder()
                    .positionId(doc.getString("id"))
                    .signalId(doc.getString("signalId"))
                    .scripCode(scripCode)
                    .companyName(doc.getString("companyName"))
                    .side(side)
                    .quantity(qty)
                    .avgEntryPrice(avgEntry)
                    .currentPrice(currentPrice)
                    .stopLoss(sl)
                    .target1(tp1)
                    .target2(tp2)
                    .unrealizedPnl(unrealizedPnl)
                    .unrealizedPnlPercent(unrealizedPnlPercent)
                    .realizedPnl(realizedPnl)
                    .tp1Hit(Boolean.TRUE.equals(doc.getBoolean("tp1Hit")))
                    .status(qty > 0 ? "ACTIVE" : "CLOSED")
                    .trailingType(doc.getString("trailingType"))
                    .trailingStop(doc.getDouble("trailingStop"))
                    .openedAt(openedAtTime)
                    .lastUpdated(LocalDateTime.now())
                    .build();
                    
        } catch (Exception e) {
            log.warn("Error parsing position: {}", e.getMessage());
            return null;
        }
    }

    private double calculateMarginUsed(List<PositionDTO> positions) {
        return positions.stream()
                .filter(p -> p.getQuantity() > 0)
                .mapToDouble(p -> p.getAvgEntryPrice() * p.getQuantity())
                .sum();
    }

    private double calculateDayPnl() {
        // Get today's trades and sum P&L
        try {
            LocalDateTime startOfDay = LocalDateTime.now()
                    .withHour(0).withMinute(0).withSecond(0);
            long startOfDayMs = startOfDay.atZone(ZoneId.of("Asia/Kolkata"))
                    .toInstant().toEpochMilli();
            
            Document query = new Document("exitTime", 
                new Document("$gte", startOfDayMs));
            
            double dayPnl = 0;
            for (Document doc : mongoTemplate.getCollection("trade_outcomes").find(query)) {
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
}

