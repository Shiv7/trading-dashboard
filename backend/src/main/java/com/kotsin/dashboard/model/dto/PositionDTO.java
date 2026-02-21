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

    // Dual equity/option levels for strategy trades
    private Double equitySl;
    private Double equityT1;
    private Double equityT2;
    private Double equityT3;
    private Double equityT4;
    private Double optionSl;
    private Double optionT1;
    private Double optionT2;
    private Double optionT3;
    private Double optionT4;
    private Double target3;
    private Double target4;

    // Target hit tracking
    private Boolean t1Hit;
    private Boolean t2Hit;
    private Boolean t3Hit;
    private Boolean t4Hit;
    private Boolean slHit;

    // Instrument type
    private String instrumentType;  // OPTION, FUTURES, or null for legacy
    private Double delta;

    // Exit info (for closed positions)
    private String exitReason;      // T1-OP, T2-EQ, SL-OP, EOD, MANUAL_CLOSE, etc.
    private Double equityLtp;       // Current equity/futures LTP for dual display

    // Exit history: per-target exit events [{level, lots, qty, price, timestamp, source}]
    private java.util.List<java.util.Map<String, Object>> exitHistory;
}

