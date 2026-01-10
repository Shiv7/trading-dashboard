package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * PatternSignalDTO - Pattern recognition signal from SMTIS v2.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PatternSignalDTO {

    private String patternId;
    private String signalId;
    private String scripCode;
    private String companyName;

    // Pattern details
    private String patternType;      // BREAKOUT, BREAKDOWN, REVERSAL, TREND_CONTINUATION, etc.
    private String direction;        // BULLISH, BEARISH, NEUTRAL
    private String status;           // ACTIVE, COMPLETED_WIN, COMPLETED_LOSS, EXPIRED, INVALIDATED

    // Confidence and quality
    private double confidence;
    private int qualityScore;

    // Price levels
    private double entryPrice;
    private double stopLoss;
    private double target1;
    private double target2;
    private double riskRewardRatio;
    private double invalidationPrice;

    // Context
    private String timeframe;
    private String patternDescription;
    private String triggerCondition;
    private String gexRegime;
    private String session;
    private Integer daysToExpiry;

    // Timestamps
    private LocalDateTime triggeredAt;
    private LocalDateTime expiresAt;
    private LocalDateTime completedAt;

    // Outcome (for completed patterns)
    private Double actualPnl;
    private Double rMultiple;
}
