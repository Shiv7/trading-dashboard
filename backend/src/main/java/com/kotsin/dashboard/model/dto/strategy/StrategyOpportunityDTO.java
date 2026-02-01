package com.kotsin.dashboard.model.dto.strategy;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * StrategyOpportunityDTO - Represents an instrument close to triggering a signal.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StrategyOpportunityDTO {
    private String scripCode;
    private String companyName;
    private String strategyId;
    private String direction;
    private double opportunityScore;
    private List<ConditionCheckDTO> conditions;
    private String nextConditionNeeded;
    private String estimatedTimeframe;
    private double currentPrice;
    private double keyLevel;
    private long timestamp;
}
