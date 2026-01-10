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
}

