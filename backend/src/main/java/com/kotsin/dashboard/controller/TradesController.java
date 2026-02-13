package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.TradeDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * REST controller for trade history endpoints.
 */
@RestController
@RequestMapping("/api/trades")
@RequiredArgsConstructor
@Slf4j
public class TradesController {

    private final MongoTemplate mongoTemplate;

    /**
     * Get all trades
     */
    @GetMapping
    public ResponseEntity<List<TradeDTO>> getTrades(
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String status) {
        
        List<TradeDTO> trades = new ArrayList<>();
        
        try {
            Document query = new Document();
            if (status != null && !status.isEmpty()) {
                query.append("status", status);
            }
            
            mongoTemplate.getCollection("trade_outcomes")
                    .find(query)
                    .sort(new Document("exitTime", -1))
                    .limit(limit)
                    .forEach(doc -> {
                        TradeDTO trade = parseTrade(doc);
                        if (trade != null) {
                            trades.add(trade);
                        }
                    });
        } catch (Exception e) {
            log.error("Error getting trades: {}", e.getMessage());
        }
        
        return ResponseEntity.ok(trades);
    }

    /**
     * Get trade statistics
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getTradeStats() {
        try {
            long total = mongoTemplate.getCollection("trade_outcomes").countDocuments();
            long wins = mongoTemplate.getCollection("trade_outcomes")
                    .countDocuments(new Document("isWin", true));
            long losses = total - wins;
            
            // Calculate total P&L
            double totalPnl = 0;
            double totalRMultiple = 0;
            int count = 0;
            
            for (Document doc : mongoTemplate.getCollection("trade_outcomes").find()) {
                Double pnl = doc.getDouble("pnl");
                Double rMult = doc.getDouble("rMultiple");
                if (pnl != null) totalPnl += pnl;
                if (rMult != null) {
                    totalRMultiple += rMult;
                    count++;
                }
            }
            
            double avgRMultiple = count > 0 ? totalRMultiple / count : 0;
            double winRate = total > 0 ? (double) wins / total * 100 : 0;
            
            return ResponseEntity.ok(Map.of(
                "totalTrades", total,
                "wins", wins,
                "losses", losses,
                "winRate", winRate,
                "totalPnl", totalPnl,
                "avgRMultiple", avgRMultiple
            ));
            
        } catch (Exception e) {
            log.error("Error getting trade stats: {}", e.getMessage());
            return ResponseEntity.ok(Map.of(
                "totalTrades", 0,
                "wins", 0,
                "losses", 0,
                "winRate", 0.0,
                "totalPnl", 0.0,
                "avgRMultiple", 0.0
            ));
        }
    }

    /**
     * Get trade by ID
     */
    @GetMapping("/{tradeId}")
    public ResponseEntity<TradeDTO> getTradeById(@PathVariable String tradeId) {
        try {
            Document doc = mongoTemplate.getCollection("trade_outcomes")
                    .find(new Document("signalId", tradeId))
                    .first();
            
            if (doc != null) {
                TradeDTO trade = parseTrade(doc);
                if (trade != null) {
                    return ResponseEntity.ok(trade);
                }
            }
            return ResponseEntity.notFound().build();
            
        } catch (Exception e) {
            log.error("Error getting trade: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    private TradeDTO parseTrade(Document doc) {
        try {
            LocalDateTime entryTime = parseDateTime(doc.get("entryTime"));
            LocalDateTime exitTime = parseDateTime(doc.get("exitTime"));
            
            double entryPrice = getDouble(doc, "entryPrice");
            double exitPrice = getDouble(doc, "exitPrice");
            double pnl = getDouble(doc, "pnl");
            boolean isWin = Boolean.TRUE.equals(doc.getBoolean("isWin")) || pnl > 0;
            
            String exitReason = doc.getString("exitReason");
            String status;
            if (exitReason != null && exitReason.contains("TARGET")) {
                status = "CLOSED_WIN";
            } else if (exitReason != null && exitReason.contains("TRAIL")) {
                status = "CLOSED_TRAILING";
            } else {
                status = isWin ? "CLOSED_WIN" : "CLOSED_LOSS";
            }

            long durationMinutes = 0;
            if (entryTime != null && exitTime != null) {
                durationMinutes = ChronoUnit.MINUTES.between(entryTime, exitTime);
            }

            double pnlPercent = entryPrice > 0 ? (pnl / entryPrice) * 100 : 0;

            // Extract strategy with fallback chain: signalSource -> strategy -> signalType -> UNKNOWN
            String strategy = doc.getString("signalSource");
            if (strategy == null || strategy.isEmpty()) {
                strategy = doc.getString("strategy");
            }
            if (strategy == null || strategy.isEmpty()) {
                strategy = doc.getString("signalType");
            }
            if (strategy == null || strategy.isEmpty()) {
                strategy = "UNKNOWN";
            }

            return TradeDTO.builder()
                    .tradeId(doc.getString("signalId"))
                    .signalId(doc.getString("signalId"))
                    .scripCode(doc.getString("scripCode"))
                    .companyName(doc.getString("companyName"))
                    .side(determineSide(doc))
                    .status(status)
                    .entryPrice(entryPrice)
                    .entryTime(entryTime)
                    .quantity(doc.getInteger("quantity", 1))
                    .exitPrice(exitPrice)
                    .exitTime(exitTime)
                    .exitReason(exitReason)
                    .stopLoss(getDouble(doc, "stopLoss"))
                    .target1(getDouble(doc, "target"))
                    .pnl(pnl)
                    .pnlPercent(pnlPercent)
                    .rMultiple(getDouble(doc, "rMultiple"))
                    .durationMinutes(durationMinutes)
                    .strategy(strategy)
                    .build();
                    
        } catch (Exception e) {
            log.warn("Error parsing trade: {}", e.getMessage());
            return null;
        }
    }

    private String determineSide(Document doc) {
        double entry = getDouble(doc, "entryPrice");
        double stop = getDouble(doc, "stopLoss");
        return entry > stop ? "LONG" : "SHORT";
    }

    private LocalDateTime parseDateTime(Object obj) {
        if (obj == null) return null;
        try {
            if (obj instanceof Long) {
                return LocalDateTime.ofInstant(Instant.ofEpochMilli((Long) obj), ZoneId.of("Asia/Kolkata"));
            } else if (obj instanceof java.util.Date) {
                return LocalDateTime.ofInstant(((java.util.Date) obj).toInstant(), ZoneId.of("Asia/Kolkata"));
            } else if (obj instanceof String) {
                return LocalDateTime.parse((String) obj);
            }
        } catch (Exception e) {
            // Ignore
        }
        return null;
    }

    private double getDouble(Document doc, String key) {
        Object val = doc.get(key);
        return val instanceof Number ? ((Number) val).doubleValue() : 0;
    }
}

