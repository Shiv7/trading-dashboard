package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * DTO representing the family score for a stock.
 * Contains all module outputs for transparency.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FamilyScoreDTO {

    private String scripCode;
    private String companyName;
    private String timeframe;
    private LocalDateTime timestamp;
    private String humanReadableTime;
    private String triggerTimeframe;

    // ==================== MTIS SCORE ====================
    private double mtis;                // -100 to +100
    private String mtisLabel;           // "STRONG_BULLISH", "BEARISH", etc.
    private String mtisTrend;           // "RISING", "FALLING", "STABLE"
    private double previousMtis;
    private double mtisChange;
    private double rawMtis;             // Before modifiers

    // Modifiers
    private double sessionModifier;     // 0.5 to 1.1
    private double cprModifier;         // 0.7 to 1.3
    private double expiryModifier;      // 0.7 to 1.0

    // Price data
    private double open;
    private double high;
    private double low;
    private double close;
    private long volume;
    private double vwap;

    // VCP Module
    private double vcpCombinedScore;
    private double vcpRunway;
    private double vcpStructuralBias;
    private double vcpSupportScore;
    private double vcpResistanceScore;

    // IPU Module
    private double ipuFinalScore;
    private double ipuInstProxy;
    private double ipuMomentum;
    private double ipuExhaustion;
    private double ipuUrgency;
    private double ipuDirectionalConviction;
    private boolean ipuXfactor;
    private String ipuMomentumState;

    // Regime
    private String indexRegimeLabel;
    private double indexRegimeStrength;
    private String securityRegimeLabel;
    private boolean securityAligned;

    // OI/F&O
    private String oiSignal;
    private Double pcr;
    private Double spotFuturePremium;
    private String futuresBuildup;

    // Gate Status
    private boolean hardGatePassed;
    private String hardGateReason;
    private boolean mtfGatePassed;
    private String mtfGateReason;
    private boolean qualityGatePassed;
    private String qualityGateReason;
    private boolean statsGatePassed;
    private String statsGateReason;

    // Overall / Legacy compatibility
    private double overallScore;
    private String direction;
    private boolean signalEmitted;

    // ==================== FLAGS ====================
    private boolean hasDivergence;
    private boolean hasExhaustion;
    private boolean actionable;
    private boolean fudkiiIgnition;
    private String cprWidth;            // "NARROW", "NORMAL", "WIDE"
    private boolean expiryDay;
    private String sessionPhase;        // "OPENING", "MORNING", etc.

    // ==================== WARNINGS ====================
    @Builder.Default
    private List<Warning> warnings = new ArrayList<>();

    // ==================== CONTRIBUTORS ====================
    @Builder.Default
    private List<ScoreContributor> contributors = new ArrayList<>();
    private String summary;

    // ==================== BREAKDOWN ====================
    private ScoreBreakdown breakdown;

    // Additional module scores (for expandable details)
    private Map<String, Object> moduleDetails;

    // ==================== NESTED CLASSES ====================

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Warning {
        private String type;        // "DIVERGENCE", "EXHAUSTION", etc.
        private String severity;    // "HIGH", "MEDIUM", "LOW"
        private String message;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ScoreContributor {
        private String category;    // "IPU_EXHAUSTION", "FUDKII_IGNITION", etc.
        private double points;      // +15, -8, etc.
        private String reason;
        private String dataSource;
        private String rawValue;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ScoreBreakdown {
        private double priceScore;
        private double foAlignmentScore;
        private double ipuScore;
        private double fudkiiBonus;
        private double microstructureScore;
        private double orderbookScore;
        private double mtfRegimeScore;
        private double patternBonus;
        private double levelRetestBonus;
        private double relativeStrengthBonus;
        private double mtisMomentumBonus;

        private Map<String, TFScoreDetail> tfScores;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TFScoreDetail {
        private String timeframe;
        private double score;
        private double weight;
        private double weightedScore;
        private long lastUpdated;
        private boolean stale;
    }
}

