package com.kotsin.dashboard.model.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * Entity mapped to the paper_trades collection written by StreamingCandle's paper trading engine.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "paper_trades")
public class PaperTrade {

    @Id
    private String id;

    private String tradeId;
    private String symbol;
    private String signalId;
    private String signalType;   // PIVOT_CONFLUENCE, FUDKII
    private String direction;    // LONG, SHORT

    private int quantity;
    private int lotSize;
    private double positionValue;
    private double entryPrice;
    private double exitPrice;
    private double averagePrice;
    private double currentPrice;
    private double targetPrice;
    private double stopLoss;
    private double trailingStop;

    private Instant createdAt;
    private Instant entryTime;
    private Instant exitTime;
    private Instant lastUpdated;
    private long holdingPeriodMs;

    private double unrealizedPnL;
    private double realizedPnL;
    private double unrealizedPnLPercent;
    private double realizedPnLPercent;
    private double maxProfit;
    private double maxLoss;
    private double commission;

    private String status;       // OPEN, CLOSED
    private String exitReason;   // STOP_HIT, TARGET_HIT, TRAILING_SL, etc.

    private int fillCount;
    private double riskAmount;
    private double riskPercent;
    private double riskRewardRatio;
    private boolean isTrailingActive;
    private double trailingPercent;
}
