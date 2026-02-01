package com.kotsin.dashboard.model.dto.strategy;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * StrategyConditionDTO - Extended condition details for dashboard transparency.
 * Shows CURRENT vs REQUIRED values for each strategy condition.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StrategyConditionDTO {
    private String name;
    private String category;  // REQUIRED, OPTIMAL, BONUS
    private boolean passed;
    private String currentValue;
    private String requiredValue;
    private String explanation;
    private int progressPercent;
    private String source;  // HTF, LTF, FLOW, ZONE, TECHNICAL
    private String timeframe;
    private String notes;
}
