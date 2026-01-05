package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for creating a new virtual order.
 * Matches the CreateOrder class in TradeExecutionModule.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateOrderRequest {
    
    private String scripCode;
    private String side;         // BUY or SELL
    private String type;         // MARKET or LIMIT
    private int qty;
    private Double limitPrice;   // Required for LIMIT orders
    private Double sl;           // Stop Loss
    private Double tp1;          // Target 1
    private Double tp2;          // Target 2
    private Double tp1ClosePercent;  // % to close at TP1 (default 50%)
    private String trailingType;     // NONE, FIXED, PCT
    private Double trailingValue;    // Trailing stop value
    private Double trailingStep;     // Step for trailing updates
}
