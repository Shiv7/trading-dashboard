package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.dto.SignalDTO;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Service for signal history from MongoDB.
 */
@Service
@Slf4j
public class SignalHistoryService {

    @Autowired
    private MongoTemplate mongoTemplate;

    /**
     * Get paginated signal history
     */
    public Page<SignalDTO> getSignals(Pageable pageable, String scripCode, Boolean emittedOnly) {
        try {
            Query query = new Query();
            
            if (scripCode != null && !scripCode.isEmpty()) {
                query.addCriteria(Criteria.where("scripCode").is(scripCode));
            }
            
            if (Boolean.TRUE.equals(emittedOnly)) {
                query.addCriteria(Criteria.where("signalEmitted").is(true));
            }

            long total = mongoTemplate.count(query, "signal_history");
            
            query.with(pageable);
            
            List<SignalDTO> signals = new ArrayList<>();
            mongoTemplate.getCollection("signal_history")
                    .find()
                    .sort(new Document("timestamp", -1))
                    .skip((int) pageable.getOffset())
                    .limit(pageable.getPageSize())
                    .forEach(doc -> {
                        SignalDTO signal = parseSignal(doc);
                        if (signal != null) {
                            signals.add(signal);
                        }
                    });

            return new PageImpl<>(signals, pageable, total);
            
        } catch (Exception e) {
            log.error("Error getting signals: {}", e.getMessage());
            return Page.empty(pageable);
        }
    }

    /**
     * Get signal by ID
     */
    public Optional<SignalDTO> getSignalById(String signalId) {
        try {
            Document doc = mongoTemplate.getCollection("signal_history")
                    .find(new Document("signalId", signalId))
                    .first();
            
            if (doc != null) {
                return Optional.ofNullable(parseSignal(doc));
            }
            return Optional.empty();
            
        } catch (Exception e) {
            log.error("Error getting signal by ID: {}", e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Get signals for a specific stock
     */
    public List<SignalDTO> getSignalsForStock(String scripCode, int limit) {
        List<SignalDTO> signals = new ArrayList<>();
        
        try {
            mongoTemplate.getCollection("signal_history")
                    .find(new Document("scripCode", scripCode))
                    .sort(new Document("timestamp", -1))
                    .limit(limit)
                    .forEach(doc -> {
                        SignalDTO signal = parseSignal(doc);
                        if (signal != null) {
                            signals.add(signal);
                        }
                    });
        } catch (Exception e) {
            log.error("Error getting signals for stock: {}", e.getMessage());
        }
        
        return signals;
    }

    private SignalDTO parseSignal(Document doc) {
        try {
            Object timestampObj = doc.get("timestamp");
            LocalDateTime timestamp = null;
            if (timestampObj instanceof Long) {
                timestamp = LocalDateTime.ofInstant(
                    Instant.ofEpochMilli((Long) timestampObj), 
                    ZoneId.of("Asia/Kolkata")
                );
            } else if (timestampObj instanceof java.util.Date) {
                timestamp = LocalDateTime.ofInstant(
                    ((java.util.Date) timestampObj).toInstant(), 
                    ZoneId.of("Asia/Kolkata")
                );
            }

            String gateFailReason = null;
            if (!Boolean.TRUE.equals(doc.getBoolean("hardGatePassed"))) {
                gateFailReason = "Hard Gate: " + doc.getString("hardGateReason");
            } else if (!Boolean.TRUE.equals(doc.getBoolean("mtfGatePassed"))) {
                gateFailReason = "MTF Gate: " + doc.getString("mtfGateReason");
            } else if (!Boolean.TRUE.equals(doc.getBoolean("qualityGatePassed"))) {
                gateFailReason = "Quality Gate: " + doc.getString("qualityGateReason");
            } else if (!Boolean.TRUE.equals(doc.getBoolean("statsGatePassed"))) {
                gateFailReason = "Stats Gate: " + doc.getString("statsGateReason");
            }

            return SignalDTO.builder()
                    .signalId(doc.getString("signalId"))
                    .scripCode(doc.getString("scripCode"))
                    .companyName(doc.getString("companyName"))
                    .timestamp(timestamp)
                    .signalType(doc.getString("signalType"))
                    .direction(doc.getString("direction"))
                    .confidence(getDoubleOrDefault(doc, "confidence", 0))
                    .rationale(doc.getString("rationale"))
                    .entryPrice(getDoubleOrDefault(doc, "entryPrice", 0))
                    .stopLoss(getDoubleOrDefault(doc, "stopLoss", 0))
                    .target1(getDoubleOrDefault(doc, "target1", 0))
                    .target2(getDoubleOrDefault(doc, "target2", 0))
                    .riskRewardRatio(getDoubleOrDefault(doc, "riskRewardRatio", 0))
                    .vcpScore(getDoubleOrDefault(doc, "vcpCombined", 0))
                    .ipuScore(getDoubleOrDefault(doc, "ipuFinalScore", 0))
                    .xfactorFlag(Boolean.TRUE.equals(doc.getBoolean("ipuXfactor")))
                    .regimeLabel(doc.getString("indexRegimeLabel"))
                    .allGatesPassed(Boolean.TRUE.equals(doc.getBoolean("signalEmitted")))
                    .gateFailReason(gateFailReason)
                    .positionSizeMultiplier(getDoubleOrDefault(doc, "positionMultiplier", 1.0))
                    .tradeStatus(determineTradeStatus(doc))
                    .actualPnl(doc.getDouble("rMultiple") != null ? doc.getDouble("rMultiple") : null)
                    .rMultiple(doc.getDouble("rMultiple"))
                    .exitReason(doc.getString("exitReason"))
                    .build();
                    
        } catch (Exception e) {
            log.warn("Error parsing signal: {}", e.getMessage());
            return null;
        }
    }

    private double getDoubleOrDefault(Document doc, String key, double defaultValue) {
        Object val = doc.get(key);
        if (val instanceof Number) {
            return ((Number) val).doubleValue();
        }
        return defaultValue;
    }

    private String determineTradeStatus(Document doc) {
        if (!Boolean.TRUE.equals(doc.getBoolean("signalEmitted"))) {
            return null; // Not traded
        }
        
        Double rMultiple = doc.getDouble("rMultiple");
        if (rMultiple == null) {
            return "ACTIVE";
        }
        
        return rMultiple > 0 ? "CLOSED_WIN" : "CLOSED_LOSS";
    }
}

