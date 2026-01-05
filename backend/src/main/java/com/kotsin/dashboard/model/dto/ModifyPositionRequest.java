package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for modifying an existing virtual position.
 * Matches the ModifyPosition class in TradeExecutionModule.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ModifyPositionRequest {
    
    private Double sl;              // New Stop Loss
    private Double tp1;             // New Target 1
    private Double tp2;             // New Target 2
    private Double tp1ClosePercent; // % to close at TP1
    private String trailingType;    // NONE, FIXED, PCT
    private Double trailingValue;   // Trailing stop value
    private Double trailingStep;    // Step for trailing updates
    private Boolean trailingActive; // Enable/disable trailing
}
