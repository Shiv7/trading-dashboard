package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO representing an open position in the virtual wallet.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PositionDTO {
    
    private String positionId;
    private String signalId;
    private String scripCode;
    private String companyName;
    private String side; // LONG or SHORT
    private int quantity;
    private double avgEntryPrice;
    private double currentPrice;
    private double stopLoss;
    private double target1;
    private double target2;
    private double unrealizedPnl;
    private double unrealizedPnlPercent;
    private double realizedPnl;
    private boolean tp1Hit;
    private String status; // ACTIVE, PARTIAL_EXIT, CLOSED
    private String trailingType;
    private Double trailingStop;
    private LocalDateTime openedAt;
    private LocalDateTime lastUpdated;

    // Strategy
    private String strategy;
}

