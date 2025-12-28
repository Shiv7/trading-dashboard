package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO representing a completed or active trade.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TradeDTO {
    
    private String tradeId;
    private String signalId;
    private String scripCode;
    private String companyName;
    private String side; // LONG or SHORT
    private String status; // ACTIVE, CLOSED_WIN, CLOSED_LOSS, CLOSED_TRAILING
    
    // Entry details
    private double entryPrice;
    private LocalDateTime entryTime;
    private int quantity;
    
    // Exit details (if closed)
    private Double exitPrice;
    private LocalDateTime exitTime;
    private String exitReason;
    
    // Levels
    private double stopLoss;
    private double target1;
    private Double target2;
    private Double trailingStop;
    
    // P&L
    private double pnl;
    private double pnlPercent;
    private double rMultiple;
    
    // Duration
    private long durationMinutes;
}

