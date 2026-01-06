package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.dto.FamilyScoreDTO;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;

/**
 * Service for explaining stock scores.
 * Provides detailed breakdown of why a stock has its current score.
 */
@Service
@Slf4j
public class ScoreExplainerService {

    @Autowired
    private MongoTemplate mongoTemplate;

    // In-memory cache for latest scores (updated by Kafka consumer)
    private final Map<String, FamilyScoreDTO> latestScores = new HashMap<>();

    /**
     * Update cached score (called by Kafka consumer)
     */
    public void updateScore(String scripCode, FamilyScoreDTO score) {
        latestScores.put(scripCode, score);
    }

    /**
     * Get latest score for a stock
     */
    public Optional<FamilyScoreDTO> getLatestScore(String scripCode) {
        return Optional.ofNullable(latestScores.get(scripCode));
    }

    /**
     * Get all cached scores
     */
    public List<FamilyScoreDTO> getAllScores() {
        return new ArrayList<>(latestScores.values());
    }

    /**
     * Get top N scores by overall score
     */
    public List<FamilyScoreDTO> getTopScores(int limit) {
        return latestScores.values().stream()
                .sorted((a, b) -> Double.compare(b.getOverallScore(), a.getOverallScore()))
                .limit(limit)
                .toList();
    }

    /**
     * Search stocks by symbol or company name
     */
    public List<FamilyScoreDTO> searchStocks(String query, int limit) {
        if (query == null || query.isBlank()) {
            return List.of();
        }

        String q = query.toLowerCase().trim();

        return latestScores.values().stream()
                .filter(s -> {
                    // Match scripCode (e.g., "N:C:1234")
                    if (s.getScripCode() != null && s.getScripCode().toLowerCase().contains(q)) {
                        return true;
                    }
                    // Match company name
                    if (s.getCompanyName() != null && s.getCompanyName().toLowerCase().contains(q)) {
                        return true;
                    }
                    return false;
                })
                .sorted((a, b) -> {
                    // Prioritize exact matches
                    boolean aExact = a.getCompanyName() != null &&
                        a.getCompanyName().toLowerCase().startsWith(q);
                    boolean bExact = b.getCompanyName() != null &&
                        b.getCompanyName().toLowerCase().startsWith(q);
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                    // Then sort by score
                    return Double.compare(b.getOverallScore(), a.getOverallScore());
                })
                .limit(limit)
                .toList();
    }

    /**
     * Get score history for a stock from MongoDB
     */
    public List<FamilyScoreDTO> getScoreHistory(String scripCode, int limit) {
        List<FamilyScoreDTO> history = new ArrayList<>();
        
        try {
            mongoTemplate.getCollection("signal_history")
                    .find(new Document("scripCode", scripCode))
                    .sort(new Document("timestamp", -1))
                    .limit(limit)
                    .forEach(doc -> {
                        FamilyScoreDTO score = parseScoreFromHistory(doc);
                        if (score != null) {
                            history.add(score);
                        }
                    });
        } catch (Exception e) {
            log.error("Error getting score history: {}", e.getMessage());
        }
        
        return history;
    }

    /**
     * Generate explanation for a stock's score
     */
    public Map<String, Object> explainScore(String scripCode) {
        Map<String, Object> explanation = new LinkedHashMap<>();
        
        FamilyScoreDTO score = latestScores.get(scripCode);
        if (score == null) {
            explanation.put("error", "No score data available for " + scripCode);
            return explanation;
        }

        explanation.put("scripCode", scripCode);
        explanation.put("companyName", score.getCompanyName());
        explanation.put("overallScore", score.getOverallScore());
        explanation.put("direction", score.getDirection());
        explanation.put("timestamp", score.getTimestamp());

        // VCP Analysis
        Map<String, Object> vcpExplanation = new LinkedHashMap<>();
        vcpExplanation.put("combinedScore", score.getVcpCombinedScore());
        vcpExplanation.put("runway", score.getVcpRunway());
        vcpExplanation.put("structuralBias", score.getVcpStructuralBias());
        vcpExplanation.put("interpretation", interpretVCP(score));
        explanation.put("vcp", vcpExplanation);

        // IPU Analysis
        Map<String, Object> ipuExplanation = new LinkedHashMap<>();
        ipuExplanation.put("finalScore", score.getIpuFinalScore());
        ipuExplanation.put("institutionalProxy", score.getIpuInstProxy());
        ipuExplanation.put("momentum", score.getIpuMomentum());
        ipuExplanation.put("exhaustion", score.getIpuExhaustion());
        ipuExplanation.put("xfactor", score.isIpuXfactor());
        ipuExplanation.put("momentumState", score.getIpuMomentumState());
        ipuExplanation.put("interpretation", interpretIPU(score));
        explanation.put("ipu", ipuExplanation);

        // Regime Analysis
        Map<String, Object> regimeExplanation = new LinkedHashMap<>();
        regimeExplanation.put("indexLabel", score.getIndexRegimeLabel());
        regimeExplanation.put("indexStrength", score.getIndexRegimeStrength());
        regimeExplanation.put("securityLabel", score.getSecurityRegimeLabel());
        regimeExplanation.put("aligned", score.isSecurityAligned());
        regimeExplanation.put("interpretation", interpretRegime(score));
        explanation.put("regime", regimeExplanation);

        // OI/F&O Analysis
        Map<String, Object> oiExplanation = new LinkedHashMap<>();
        oiExplanation.put("signal", score.getOiSignal());
        oiExplanation.put("pcr", score.getPcr());
        oiExplanation.put("spotFuturePremium", score.getSpotFuturePremium());
        oiExplanation.put("futuresBuildup", score.getFuturesBuildup());
        oiExplanation.put("interpretation", interpretOI(score));
        explanation.put("oi", oiExplanation);

        // Gate Status
        Map<String, Object> gates = new LinkedHashMap<>();
        gates.put("hardGate", Map.of(
            "passed", score.isHardGatePassed(),
            "reason", score.getHardGateReason() != null ? score.getHardGateReason() : ""
        ));
        gates.put("mtfGate", Map.of(
            "passed", score.isMtfGatePassed(),
            "reason", score.getMtfGateReason() != null ? score.getMtfGateReason() : ""
        ));
        gates.put("qualityGate", Map.of(
            "passed", score.isQualityGatePassed(),
            "reason", score.getQualityGateReason() != null ? score.getQualityGateReason() : ""
        ));
        gates.put("statsGate", Map.of(
            "passed", score.isStatsGatePassed(),
            "reason", score.getStatsGateReason() != null ? score.getStatsGateReason() : ""
        ));
        explanation.put("gates", gates);

        // Summary - Use Kafka summary if available, else generate
        Map<String, Object> moduleDetails = score.getModuleDetails();
        if (moduleDetails != null && moduleDetails.containsKey("summary") && moduleDetails.get("summary") != null) {
            explanation.put("summary", moduleDetails.get("summary").toString());
        } else {
            explanation.put("summary", generateSummary(score));
        }

        // Contributors from family-score (if available)
        if (moduleDetails != null && moduleDetails.containsKey("contributors")) {
            explanation.put("contributors", moduleDetails.get("contributors"));
        }

        // Warnings from family-score (if available)
        if (moduleDetails != null && moduleDetails.containsKey("warnings")) {
            explanation.put("warnings", moduleDetails.get("warnings"));
        }

        return explanation;
    }

    private String interpretVCP(FamilyScoreDTO score) {
        double vcp = score.getVcpCombinedScore();
        double runway = score.getVcpRunway();
        
        if (vcp >= 0.7 && runway >= 0.6) {
            return "Strong volume cluster with good runway - favorable for entry";
        } else if (vcp >= 0.5) {
            return "Moderate volume cluster - some support/resistance confluence";
        } else if (vcp >= 0.3) {
            return "Weak volume cluster - limited institutional interest at current levels";
        } else {
            return "No significant volume cluster detected";
        }
    }

    private String interpretIPU(FamilyScoreDTO score) {
        double ipu = score.getIpuFinalScore();
        String momentumState = score.getIpuMomentumState();
        boolean xfactor = score.isIpuXfactor();
        
        StringBuilder sb = new StringBuilder();
        
        if (xfactor) {
            sb.append("X-Factor detected: Strong institutional footprint. ");
        }
        
        if (ipu >= 0.7) {
            sb.append("High institutional participation with strong conviction. ");
        } else if (ipu >= 0.5) {
            sb.append("Moderate institutional activity. ");
        } else {
            sb.append("Limited institutional participation. ");
        }
        
        if ("ACCELERATING".equals(momentumState)) {
            sb.append("Momentum is accelerating.");
        } else if ("EXHAUSTING".equals(momentumState)) {
            sb.append("Warning: Momentum showing exhaustion.");
        } else {
            sb.append("Momentum is stable.");
        }
        
        return sb.toString();
    }

    private String interpretRegime(FamilyScoreDTO score) {
        String indexLabel = score.getIndexRegimeLabel();
        boolean aligned = score.isSecurityAligned();
        
        if (aligned) {
            return String.format("Stock aligned with %s index regime - favorable for trend trades", indexLabel);
        } else {
            return String.format("Stock diverging from %s index regime - trade with caution", indexLabel);
        }
    }

    private String interpretOI(FamilyScoreDTO score) {
        String signal = score.getOiSignal();
        String buildup = score.getFuturesBuildup();
        
        if ("BULLISH_ACCUMULATION".equals(signal)) {
            return "Bullish OI accumulation detected - smart money building long positions";
        } else if ("BEARISH_DISTRIBUTION".equals(signal)) {
            return "Bearish OI distribution - smart money unwinding or shorting";
        } else if ("LONG_BUILDUP".equals(buildup)) {
            return "Long buildup in futures - bullish bias";
        } else if ("SHORT_BUILDUP".equals(buildup)) {
            return "Short buildup in futures - bearish bias";
        } else {
            return "Neutral OI signal - no clear directional bias from derivatives";
        }
    }

    private String generateSummary(FamilyScoreDTO score) {
        double overall = score.getOverallScore();
        String direction = score.getDirection();
        boolean signalEmitted = score.isSignalEmitted();
        
        if (signalEmitted) {
            return String.format("A %s signal was emitted with score %.1f/10. " +
                "All gates passed. Position sizing multiplier applied.", direction, overall);
        } else if (overall >= 7) {
            return String.format("Strong %s setup with score %.1f/10, but one or more gates failed.", 
                direction, overall);
        } else if (overall >= 5) {
            return String.format("Moderate %s setup with score %.1f/10. " +
                "Consider waiting for better conditions.", direction, overall);
        } else {
            return String.format("Weak setup with score %.1f/10. Not recommended for trading.", overall);
        }
    }

    private FamilyScoreDTO parseScoreFromHistory(Document doc) {
        try {
            Object timestampObj = doc.get("timestamp");
            LocalDateTime timestamp = null;
            if (timestampObj instanceof Long) {
                timestamp = LocalDateTime.ofInstant(
                    Instant.ofEpochMilli((Long) timestampObj), 
                    ZoneId.of("Asia/Kolkata")
                );
            }

            return FamilyScoreDTO.builder()
                    .scripCode(doc.getString("scripCode"))
                    .companyName(doc.getString("companyName"))
                    .timestamp(timestamp)
                    .vcpCombinedScore(getDouble(doc, "vcpCombined"))
                    .vcpRunway(getDouble(doc, "vcpRunway"))
                    .ipuFinalScore(getDouble(doc, "ipuFinalScore"))
                    .ipuXfactor(Boolean.TRUE.equals(doc.getBoolean("ipuXfactor")))
                    .indexRegimeLabel(doc.getString("indexRegimeLabel"))
                    .oiSignal(doc.getString("oiSignal"))
                    .direction(doc.getString("direction"))
                    .signalEmitted(Boolean.TRUE.equals(doc.getBoolean("signalEmitted")))
                    .overallScore(getDouble(doc, "overallScore"))
                    .build();
                    
        } catch (Exception e) {
            return null;
        }
    }

    private double getDouble(Document doc, String key) {
        Object val = doc.get(key);
        return val instanceof Number ? ((Number) val).doubleValue() : 0;
    }
}

