package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * DTO for MASTER ARCHITECTURE FinalOpportunityScore.
 * Contains the final trade decision with all supporting scores.
 * 
 * Received from topic: score-final-opportunity
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FinalOpportunityScoreDTO {
    
    // ========== Identification ==========
    private String scripCode;
    private String companyName;
    private LocalDateTime timestamp;
    
    // ========== Component Scores ==========
    
    /** Index Context Score [-1.0, +1.0] */
    private double indexContextScore;
    
    /** Security Context Score [-1.0, +1.0] */
    private double securityContextScore;
    
    /** Signal Strength Score [0.0, 1.0] */
    private double signalStrengthScore;
    
    /** Direction Confidence [0.0, 1.0] */
    private double directionConfidence;
    
    // ========== Final Score ==========
    
    /** Current final score [-1.0, +1.0] */
    private double finalScore;
    
    /** Previous final score (for delta) */
    private double previousScore;
    
    /** Score change (delta) */
    private double scoreDelta;
    
    // ========== Decision ==========
    
    /** Trade decision: ENTER_NOW, WATCHLIST, MONITOR, REJECT */
    private String decision;
    
    /** Human-readable decision reason */
    private String decisionReason;
    
    /** Direction: BULLISH, BEARISH, NEUTRAL */
    private String direction;
    
    /** Is this an actionable signal (ENTER_NOW)? */
    private boolean actionable;
    
    // ========== Position Sizing ==========
    
    /** Recommended lot count (0-2) */
    private int recommendedLots;
    
    /** Is hedge recommended? */
    private boolean hedgeRecommended;
    
    /** Is hedge optional? */
    private boolean hedgeOptional;
    
    /** Hedge type if applicable: DIRECTIONAL, DELTA_NEUTRAL */
    private String hedgeType;
    
    // ========== Entry/Exit Levels ==========
    
    private double entryPrice;
    private double stopLoss;
    private double target1;
    private double target2;
    private double target3;
    private double riskRewardRatio;
    
    // ========== Score Decay ==========
    
    /** Bars since signal without follow-through */
    private int barsWithoutFollowThrough;
    
    /** Has decay been applied? */
    private boolean decayApplied;
    
    /** Number of decay applications */
    private int decayCount;
    
    // ========== Validation ==========
    
    /** Is the score valid? */
    private boolean valid;
    
    /** Reason if invalid */
    private String invalidReason;
    
    // ========== Module Details ==========
    
    /** Expandable details for each module */
    private Map<String, Object> moduleDetails;
}
