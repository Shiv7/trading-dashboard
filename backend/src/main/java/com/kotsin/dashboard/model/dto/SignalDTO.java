package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO representing a trading signal (curated).
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
    private double riskRewardRatio;
    
    // Scores at signal time
    private double vcpScore;
    private double ipuScore;
    private boolean xfactorFlag;
    private String regimeLabel;
    
    // Gate results
    private boolean allGatesPassed;
    private String gateFailReason;
    private double positionSizeMultiplier;
    
    // Outcome (if trade was taken)
    private String tradeStatus; // null, ACTIVE, CLOSED_WIN, CLOSED_LOSS
    private Double actualPnl;
    private Double rMultiple;
    private String exitReason;
}

