package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * DTO for risk events received from Kafka.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RiskEventDTO {

    private String eventId;
    private String walletId;
    private String eventType;
    private String severity; // INFO, WARNING, CRITICAL
    private String message;

    // Current state
    private Double currentValue;
    private Double limitValue;
    private Double thresholdPercent;

    // Context
    private String scripCode;
    private String orderId;
    private String positionId;

    // Wallet snapshot
    private Double currentBalance;
    private Double availableMargin;
    private Double dayPnl;
    private Double drawdown;

    private Instant timestamp;
    private Boolean requiresAction;
}
