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
     * - MTIS: Multi-Timeframe Intelligence Score (old system)
     * - MASTER_ARCH: Master Architecture FinalOpportunityScore (new system)
     * - VCP: Volume Cluster Pivot signal
     * - IPU: Institutional Participation signal
     * - FUDKII: BB+SuperTrend structural trigger
     * - BB_SUPERTREND: Direct BB+SuperTrend confluence
     * - CURATED: CuratedSignalProcessor combined signal
     */
    private String signalSource;
    
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
    
    // ========== Helper Methods ==========
    
    public String getSignalSourceDisplay() {
        if (signalSourceLabel != null && !signalSourceLabel.isEmpty()) {
            return signalSourceLabel;
        }
        if (signalSource == null) return "UNKNOWN";
        return switch (signalSource) {
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

