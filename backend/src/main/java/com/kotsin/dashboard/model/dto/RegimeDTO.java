package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO representing index regime state.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RegimeDTO {
    
    private String indexName;
    private String scripCode;
    private LocalDateTime timestamp;
    
    // Regime state
    private String label; // STRONG_BULLISH, BULLISH, NEUTRAL, BEARISH, STRONG_BEARISH
    private double regimeStrength;
    private double regimeCoherence;
    private int flowAgreement; // -1, 0, 1
    private String volatilityState; // LOW, NORMAL, HIGH, EXTREME
    
    // Timeframe components
    private String tf1DLabel;
    private double tf1DStrength;
    private String tf2HLabel;
    private double tf2HStrength;
    private String tf30mLabel;
    private double tf30mStrength;
}

