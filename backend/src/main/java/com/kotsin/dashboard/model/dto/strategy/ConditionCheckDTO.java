package com.kotsin.dashboard.model.dto.strategy;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * ConditionCheckDTO - Basic condition status.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ConditionCheckDTO {
    private String conditionName;
    private boolean passed;
    private double currentValue;
    private double requiredValue;
    private String comparison;
    private int progressPercent;
    private String displayValue;
}
