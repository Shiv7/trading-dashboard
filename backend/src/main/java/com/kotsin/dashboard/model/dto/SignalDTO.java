package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO representing a trading signal.
 * Supports multiple signal sources from streamingcandle module.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SignalDTO {
    
    private String signalId;
    private String scripCode;
    private String companyName;
    private LocalDateTime timestamp;
    
    // ========== Signal Source (NEW) ==========
    
    /**
     * Signal source/generator type:
     * - PATTERN: Pattern recognition signals
     * - SETUP: Setup-based signals
     * - FORECAST: Forecast-based signals
     * - INTELLIGENCE: Intelligence-based signals
     * - QUANT: Quant score processor signals
     * (Legacy: MTIS, MASTER_ARCH, VCP, IPU, FUDKII, BB_SUPERTREND, CURATED)
     */
    private String signalSource;

    /**
     * Signal category (SMTIS v2.0):
     * BREAKOUT, BREAKDOWN, REVERSAL, TREND_CONTINUATION, MOMENTUM, MEAN_REVERSION
     */
    private String category;

    /**
     * Trading horizon:
     * SCALP, INTRADAY, SWING, POSITIONAL
     */
    private String horizon;

    /**
     * Quality score (0-100)
     */
    private Integer qualityScore;
    
    /** Human-readable signal source label */
    private String signalSourceLabel;
    
    /** Is this from the new MASTER ARCHITECTURE? */
    private boolean isMasterArch;
    
    // Signal details
    private String signalType;
    private String direction; // BULLISH or BEARISH
    private double confidence;
    private String rationale;
    
    // Entry/Exit levels
    private double entryPrice;
    private double stopLoss;
    private double target1;
    private double target2;
    private double target3;  // NEW: Third target for MASTER_ARCH
    private double riskRewardRatio;
    
    // Scores at signal time
    private double vcpScore;
    private double ipuScore;
    private boolean xfactorFlag;
    private String regimeLabel;
    
    // ========== MASTER ARCH specific (NEW) ==========
    
    /** Final opportunity score from MASTER ARCH [-1, +1] */
    private Double finalOpportunityScore;
    
    /** Direction confidence [0, 1] */
    private Double directionConfidence;
    
    /** Trade decision: ENTER_NOW, WATCHLIST, MONITOR, REJECT */
    private String tradeDecision;
    
    /** Recommended lots (0-2) */
    private Integer recommendedLots;
    
    /** Hedge recommendation */
    private Boolean hedgeRecommended;
    
    // Gate results
    private boolean allGatesPassed;
    private String gateFailReason;
    private double positionSizeMultiplier;
    
    // Outcome (if trade was taken)
    private String tradeStatus; // null, ACTIVE, CLOSED_WIN, CLOSED_LOSS
    private Double actualPnl;
    private Double rMultiple;
    private String exitReason;

    // ========== SMTIS v2.0 Enrichment Fields ==========

    /** Pattern ID if signal from pattern recognition */
    private String patternId;

    /** Setup ID if signal from setup tracker */
    private String setupId;

    /** Signal narrative context */
    private String narrative;

    /** Signal expiry timestamp */
    private LocalDateTime expiresAt;

    /** List of predicted events */
    private java.util.List<String> predictions;

    /** List of invalidation conditions to watch */
    private java.util.List<String> invalidationWatch;

    /** GEX regime at signal generation */
    private String gexRegime;

    /** Trading session at signal */
    private String session;

    /** Days to expiry at signal */
    private Integer daysToExpiry;

    /** Is at confluence zone */
    private Boolean atConfluenceZone;

    // ========== SESSION CONTEXT (Context-Aware Enhancement) ==========

    /** Position in session range (0-100) */
    private Double sessionPosition;

    /** Session position description (AT_SESSION_LOW, MIDDLE, AT_SESSION_HIGH) */
    private String sessionPositionDesc;

    /** V-bottom detected (reversal signal) */
    private Boolean vBottomDetected;

    /** V-top detected (distribution signal) */
    private Boolean vTopDetected;

    /** Failed breakout count (resistance holding) */
    private Integer failedBreakoutCount;

    /** Failed breakdown count (support holding) */
    private Integer failedBreakdownCount;

    // ========== FAMILY CONTEXT (Multi-Instrument Analysis) ==========

    /** Family bias (BULLISH, BEARISH, WEAK_BULLISH, WEAK_BEARISH, NEUTRAL) */
    private String familyBias;

    /** Bullish alignment percentage (0-100) */
    private Double bullishAlignment;

    /** Bearish alignment percentage (0-100) */
    private Double bearishAlignment;

    /** Is family fully aligned (equity + future + options all agree) */
    private Boolean fullyAligned;

    /** Has divergence detected (options vs price) */
    private Boolean hasDivergence;

    /** Divergence details */
    private java.util.List<String> divergences;

    /** Short squeeze setup detected */
    private Boolean shortSqueezeSetup;

    /** Long squeeze setup detected */
    private Boolean longSqueezeSetup;

    /** Family context interpretation (human readable) */
    private String familyInterpretation;

    // ========== EVENT TRACKING (Adaptive Learning) ==========

    /** Detected events that triggered this signal */
    private java.util.List<String> detectedEvents;

    /** Number of events detected */
    private Integer eventCount;

    /** Matched events from pattern/setup */
    private java.util.List<String> matchedEvents;

    /** Confirmed events count (from outcome tracking) */
    private Integer confirmedEvents;

    /** Failed events count */
    private Integer failedEvents;

    /** Event confirmation rate (0-100) */
    private Double eventConfirmationRate;

    // ========== ADAPTIVE MODIFIERS ==========

    /** Combined confidence modifier applied */
    private Double combinedModifier;

    /** Modifier breakdown explanation */
    private String modifierBreakdown;

    /** Original confidence before modifiers */
    private Double originalConfidence;

    // ========== TECHNICAL CONTEXT ==========

    /** SuperTrend direction at signal */
    private String superTrendDirection;

    /** SuperTrend just flipped */
    private Boolean superTrendFlip;

    /** Bollinger Band %B position */
    private Double bbPercentB;

    /** BB squeeze detected */
    private Boolean bbSqueeze;

    /** Nearest support level */
    private Double nearestSupport;

    /** Nearest resistance level */
    private Double nearestResistance;

    /** Daily pivot level */
    private Double dailyPivot;

    /** Max pain level (options) */
    private Double maxPainLevel;

    // ========== Helper Methods ==========
    
    public String getSignalSourceDisplay() {
        if (signalSourceLabel != null && !signalSourceLabel.isEmpty()) {
            return signalSourceLabel;
        }
        if (signalSource == null) return "UNKNOWN";
        return switch (signalSource) {
            // SMTIS v2.0 sources
            case "PATTERN" -> "Pattern Signal";
            case "SETUP" -> "Setup Signal";
            case "FORECAST" -> "Forecast Signal";
            case "INTELLIGENCE" -> "Intelligence Signal";
            case "QUANT" -> "Quant Signal";
            // Legacy sources
            case "MASTER_ARCH" -> "Master Architecture";
            case "MTIS" -> "MTIS Score";
            case "VCP" -> "Volume Cluster Pivot";
            case "IPU" -> "Institutional Participation";
            case "FUDKII" -> "BB+SuperTrend Trigger";
            case "BB_SUPERTREND" -> "BB+SuperTrend";
            case "CURATED" -> "Curated Signal";
            default -> signalSource;
        };
    }

    /**
     * Get session position as display text
     */
    public String getSessionPositionDisplay() {
        if (sessionPosition == null) return "Unknown";
        if (sessionPosition <= 10) return "At Session Low (" + String.format("%.0f", sessionPosition) + "%)";
        if (sessionPosition <= 30) return "Near Support (" + String.format("%.0f", sessionPosition) + "%)";
        if (sessionPosition >= 90) return "At Session High (" + String.format("%.0f", sessionPosition) + "%)";
        if (sessionPosition >= 70) return "Near Resistance (" + String.format("%.0f", sessionPosition) + "%)";
        return "Mid-Range (" + String.format("%.0f", sessionPosition) + "%)";
    }

    /**
     * Get family bias with emoji indicator
     */
    public String getFamilyBiasDisplay() {
        if (familyBias == null) return "⚪ Unknown";
        return switch (familyBias) {
            case "BULLISH" -> "🟢 Bullish";
            case "WEAK_BULLISH" -> "🟡 Weak Bullish";
            case "BEARISH" -> "🔴 Bearish";
            case "WEAK_BEARISH" -> "🟠 Weak Bearish";
            case "NEUTRAL" -> "⚪ Neutral";
            default -> "⚪ " + familyBias;
        };
    }

    /**
     * Check if signal has strong context support
     */
    public boolean hasStrongContext() {
        return Boolean.TRUE.equals(fullyAligned) &&
               eventConfirmationRate != null && eventConfirmationRate >= 60 &&
               combinedModifier != null && combinedModifier >= 1.0;
    }

    /**
     * Get context quality score (0-100)
     */
    public int getContextQualityScore() {
        int score = 0;

        // Family alignment (max 30)
        if (Boolean.TRUE.equals(fullyAligned)) score += 30;
        else if (bullishAlignment != null && bullishAlignment >= 60) score += 20;
        else if (bearishAlignment != null && bearishAlignment >= 60) score += 20;

        // Event confirmation (max 30)
        if (eventConfirmationRate != null) {
            score += (int) (eventConfirmationRate * 0.3);
        }

        // Session position (max 20)
        if (sessionPosition != null) {
            // Reward extreme positions for reversals, middle for continuation
            if ("REVERSAL".equals(category)) {
                if (sessionPosition <= 15 || sessionPosition >= 85) score += 20;
            } else {
                if (sessionPosition >= 30 && sessionPosition <= 70) score += 20;
            }
        }

        // V-pattern detection (max 10)
        if (Boolean.TRUE.equals(vBottomDetected) || Boolean.TRUE.equals(vTopDetected)) score += 10;

        // Technical confluence (max 10)
        if (Boolean.TRUE.equals(atConfluenceZone)) score += 10;

        return Math.min(100, score);
    }
}

