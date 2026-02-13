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
    private double entryLevel;
    private double keyLevel;
    private double target2;
    private double superTrendLevel;
    private double expectedRR;
    private long timestamp;
    // Strategy-specific context for display
    private String strategyContext;  // e.g., "HTF: BULLISH 85% · Daily R1 + Weekly P" or "Mode: TREND_FOLLOWING · Conv: 38/40"
    private String tradingMode;     // MicroAlpha trading mode (TREND_FOLLOWING, MEAN_REVERSION, etc.)
}
