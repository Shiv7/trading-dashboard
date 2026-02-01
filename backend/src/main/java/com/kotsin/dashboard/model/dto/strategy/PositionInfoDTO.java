package com.kotsin.dashboard.model.dto.strategy;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * PositionInfoDTO - Position details when in POSITIONED state.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PositionInfoDTO {
    private String direction;  // LONG or SHORT
    private double entryPrice;
    private double currentPrice;
    private double stopLoss;
    private double takeProfit;
    private double unrealizedPnl;
    private double unrealizedPnlPercent;
    private long entryTime;
    private long holdingDurationMs;
    private String strategyId;
    private String signalId;
}
