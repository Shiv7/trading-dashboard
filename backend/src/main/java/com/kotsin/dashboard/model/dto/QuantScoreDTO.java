package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * DTO for QuantScore display on dashboard.
 * Contains the full composite quant score with 8-category breakdown.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QuantScoreDTO {

    // Identification
    private String familyId;
    private String symbol;
    private String scripCode;
    private long timestamp;
    private String timeframe;
    private String humanReadableTime;

    // Main Score
    private double quantScore;          // 0-100
    private String quantLabel;          // STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL
    private double confidence;          // 0-1
    private String direction;           // BULLISH/BEARISH/NEUTRAL
    private double directionalStrength; // -1 to +1

    // Score Breakdown (8 categories)
    private ScoreBreakdown breakdown;

    // Summaries
    private GreeksSummary greeksSummary;
    private IVSummary ivSummary;
    private MicrostructureSummary microstructureSummary;
    private OptionsFlowSummary optionsFlowSummary;
    private PriceActionSummary priceActionSummary;
    private VolumeProfileSummary volumeProfileSummary;

    // Warnings
    private List<Warning> warnings;

    // Actionability
    private boolean actionable;
    private String actionableReason;
    private double minActionableScore;

    // Data Quality
    private DataQuality dataQuality;

    // ========== Nested Classes ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ScoreBreakdown {
        private double greeksScore;         // 0-15
        private double ivSurfaceScore;      // 0-12
        private double microstructureScore; // 0-18
        private double optionsFlowScore;    // 0-15
        private double priceActionScore;    // 0-12
        private double volumeProfileScore;  // 0-8
        private double crossInstrumentScore;// 0-10
        private double confluenceScore;     // 0-10

        private double greeksPct;           // 0-100
        private double ivSurfacePct;
        private double microstructurePct;
        private double optionsFlowPct;
        private double priceActionPct;
        private double volumeProfilePct;
        private double crossInstrumentPct;
        private double confluencePct;

        private double rawScore;            // Sum before modifiers
        private double regimeModifier;      // 0.7-1.3
        private double confidenceModifier;  // 0.8-1.0
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GreeksSummary {
        private double totalDelta;
        private double totalGamma;
        private double totalVega;
        private double totalTheta;
        private boolean gammaSqueezeRisk;
        private double gammaSqueezeDistance;
        private double maxGammaStrike;
        private String deltaBias;       // BULLISH/BEARISH/NEUTRAL
        private String vegaStructure;   // LONG_VEGA/SHORT_VEGA/BALANCED
        private double riskScore;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class IVSummary {
        private double atmIV;
        private double ivRank;           // 0-1
        private String ivSignal;         // HIGH/LOW/MODERATE
        private boolean ivCrushRisk;
        private double ivVelocity;       // Rate of IV change
        private String smileShape;       // NORMAL/SMIRK/STEEP_SKEW
        private String termStructure;    // CONTANGO/BACKWARDATION/FLAT
        private double skew25Delta;      // 25-delta skew
        private double nearTermIV;
        private double farTermIV;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MicrostructureSummary {
        private double avgOFI;           // Order flow imbalance
        private double avgVPIN;          // Volume-synchronized probability
        private double avgDepthImbalance;
        private double avgKyleLambda;    // Price impact
        private double avgSpread;        // Average bid-ask spread
        private double aggressiveBuyRatio;
        private double aggressiveSellRatio;
        private String flowDirection;    // BUYING/SELLING/BALANCED
        private double flowStrength;     // 0-1
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OptionsFlowSummary {
        private double pcr;
        private double pcrChange;
        private String pcrSignal;        // EXTREME_FEAR/BEARISH/NEUTRAL/BULLISH/EXTREME_GREED
        private String oiBuildupType;    // LONG_BUILDUP/SHORT_BUILDUP/etc.
        private double oiMomentum;
        private String futuresBuildup;
        private double spotFuturePremium;

        // FIX: Add raw OI data for transparency
        private Long totalCallOI;
        private Long totalPutOI;
        private Long totalCallOIChange;
        private Long totalPutOIChange;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PriceActionSummary {
        private String candleSequencePattern;
        private String sequenceType;     // TREND/REVERSAL/V_PATTERN/CHOP
        private double reversalIndex;
        private double momentumSlope;
        private String wyckoffPhase;     // ACCUMULATION/MARKUP/DISTRIBUTION/MARKDOWN
        private double wyckoffStrength;
        private boolean pcrDivergence;
        private boolean oiDivergence;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class VolumeProfileSummary {
        private double poc;              // Point of control
        private double vah;              // Value area high
        private double val;              // Value area low
        private double pocMigration;
        private String pocTrend;         // RISING/FALLING/STABLE
        private boolean valueAreaExpanding;
        private boolean valueAreaContracting;
        private String valueAreaShift;   // UPWARD/DOWNWARD/NEUTRAL
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Warning {
        private String type;             // GAMMA_SQUEEZE_IMMINENT/IV_CRUSH_RISK/etc.
        private String severity;         // CRITICAL/HIGH/MEDIUM/LOW
        private String message;
        private String recommendation;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DataQuality {
        private boolean hasGreeks;
        private boolean hasIVSurface;
        private boolean hasMicrostructure;
        private boolean hasOptionsFlow;
        private boolean hasPriceAction;
        private boolean hasVolumeProfile;
        private boolean hasCrossInstrument;
        private double completenessScore; // 0-1
        private String qualityLevel;     // FULL/PARTIAL/MINIMAL
    }
}
