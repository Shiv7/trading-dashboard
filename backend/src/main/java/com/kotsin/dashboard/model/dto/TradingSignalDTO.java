package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDateTime;

/**
 * DTO for trading signals from StreamingCandle module.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TradingSignalDTO {

    private String signalId;
    private String symbol;
    private String scripCode;
    private String exchange;
    private String companyName;
    private String timeframe;

    // Signal State
    private String state;           // IDLE, WATCH, ACTIVE, COMPLETE, EXPIRED
    private String event;           // WATCH_ENTERED, ACTIVE_TRIGGERED, TARGET_HIT, etc.
    private String direction;       // BULLISH, BEARISH, NEUTRAL

    // Prices
    private Double currentPrice;
    private Double entryPrice;
    private Double stopLoss;
    private Double target1;
    private Double target2;
    private Double actualExit;

    // Score
    private Double compositeScore;
    private Double confidence;
    private String scoreDirection;
    private Boolean isWatchSetup;
    private Boolean isActiveTrigger;
    private String reason;

    // Exit info
    private String exitReason;      // STOP_HIT, TARGET_HIT, TIME_EXPIRY, REVERSAL

    // Timestamps
    private Instant createdAt;
    private Instant watchedAt;
    private Instant triggeredAt;
    private Instant completedAt;
    private Instant publishedAt;
    private LocalDateTime receivedAt;

    // Confirmation state (for dashboard)
    private ConfirmationStatus confirmationStatus;
    private LocalDateTime confirmedAt;
    private String confirmedBy;
    private String executionOrderId;

    public enum ConfirmationStatus {
        PENDING,        // Waiting for user confirmation
        CONFIRMED,      // User confirmed, executing
        REJECTED,       // User rejected
        EXECUTED,       // Order placed
        EXPIRED         // Confirmation timeout
    }

    /**
     * Check if signal is actionable (can be confirmed/rejected)
     */
    public boolean isActionable() {
        return "ACTIVE".equals(state) &&
               (confirmationStatus == null || confirmationStatus == ConfirmationStatus.PENDING);
    }

    /**
     * Calculate risk/reward ratio
     */
    public Double getRiskRewardRatio() {
        if (entryPrice == null || stopLoss == null || target1 == null) {
            return null;
        }
        double risk = Math.abs(entryPrice - stopLoss);
        double reward = Math.abs(target1 - entryPrice);
        return risk > 0 ? reward / risk : 0;
    }

    /**
     * Get signal age in seconds
     */
    public long getAgeSeconds() {
        if (publishedAt == null) return 0;
        return Instant.now().getEpochSecond() - publishedAt.getEpochSecond();
    }
}
