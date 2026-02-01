package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.List;

/**
 * IPU (Institutional Participation & Urgency) state DTO.
 *
 * Tracks institutional activity through:
 * - Large trade concentration
 * - Volume spikes and patterns
 * - Order flow imbalance velocity
 * - Price impact coefficients
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IpuStateDTO {

    // Current State
    private Double currentIpuScore;                 // [0-1] overall IPU score
    private Double currentExhaustion;               // Reversal likelihood [0-1]
    private String currentDirection;                // BULLISH, BEARISH, NEUTRAL
    private String momentumState;                   // ACCELERATING, DECELERATING, STEADY, EXHAUSTED

    // Rolling Averages
    private Double avgIpuScore10;                   // 10-bar rolling average
    private Double avgIpuScore20;                   // 20-bar rolling average
    private Double ipuMomentum;                     // Rate of change in IPU

    // Component Scores (each 0-1)
    private Double volumeScore;                     // Volume concentration score
    private Double priceActionScore;                // Price movement quality
    private Double institutionalProxy;              // Large trade indicator
    private Double urgencyScore;                    // Speed of movement
    private Double flowScore;                       // Order flow quality

    // X-Factor Triggers
    private Boolean dibTriggered;                   // Dollar Imbalance Bar
    private Boolean vibTriggered;                   // Volume Imbalance Bar
    private Boolean hasXFactor;                     // Any X-factor triggered

    // Volume Metrics
    private Long aggressiveBuyVolume;
    private Long aggressiveSellVolume;
    private Double aggressiveVolumeRatio;           // aggressive / total
    private Double volumeExpansionPct;              // vs 20-period average

    // Directional Conviction
    private Double directionalConviction;           // -1 to +1
    private Double volumeDeltaPct;                  // (buy - sell) / total

    // OFI Metrics
    private Double ofiPressure;
    private String ofiSignal;                       // STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL
    private Double ofiVelocity;
    private Double ofiAcceleration;

    // Adjustments
    private String gapStatus;                       // GAP_UP, GAP_DOWN, NO_GAP
    private Double gapConvictionMultiplier;
    private String liquidityTier;                   // HIGH, MEDIUM, LOW
    private Double liquidityPenalty;

    // Price Efficiency
    private Double priceEfficiency;                 // How well price follows volume
    private Boolean runBarTriggered;                // Strong momentum bar

    // History
    private List<IpuSnapshotDTO> history;           // Rolling history (last 100)
    private Instant calculatedAt;

    /**
     * IPU Snapshot DTO - single point in time.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class IpuSnapshotDTO {
        private Double ipuScore;
        private Double exhaustionScore;
        private String direction;
        private Double instProxy;               // Institutional activity proxy
        private Double momentum;                // Price momentum
        private Double urgency;                 // Movement urgency
        private Double volumeScore;
        private Double flowScore;
        private Instant timestamp;
    }

    // ==================== HELPER METHODS ====================

    /**
     * Check if IPU indicates strong institutional buying.
     */
    public boolean isStrongBuying() {
        return currentIpuScore != null && currentIpuScore >= 0.7 &&
               "BULLISH".equals(currentDirection);
    }

    /**
     * Check if IPU indicates strong institutional selling.
     */
    public boolean isStrongSelling() {
        return currentIpuScore != null && currentIpuScore >= 0.7 &&
               "BEARISH".equals(currentDirection);
    }

    /**
     * Check if showing exhaustion signals.
     */
    public boolean isExhausted() {
        return "EXHAUSTED".equals(momentumState) ||
               (currentExhaustion != null && currentExhaustion >= 0.7);
    }

    /**
     * Check if momentum is accelerating.
     */
    public boolean isAccelerating() {
        return "ACCELERATING".equals(momentumState);
    }

    /**
     * Check if momentum is decelerating.
     */
    public boolean isDecelerating() {
        return "DECELERATING".equals(momentumState);
    }

    /**
     * Get trend from IPU history.
     */
    public String getIpuTrend() {
        if (avgIpuScore10 == null || avgIpuScore20 == null) return "UNKNOWN";
        double diff = avgIpuScore10 - avgIpuScore20;
        if (diff > 0.05) return "RISING";
        if (diff < -0.05) return "FALLING";
        return "STABLE";
    }

    /**
     * Check if actionable signal (high IPU + accelerating + direction aligned).
     */
    public boolean isActionable() {
        return currentIpuScore != null && currentIpuScore >= 0.6 &&
               !isExhausted() &&
               (isAccelerating() || "STEADY".equals(momentumState));
    }

    /**
     * Get conviction strength description.
     */
    public String getConvictionLabel() {
        if (directionalConviction == null) return "UNKNOWN";
        double abs = Math.abs(directionalConviction);
        if (abs >= 0.7) return "VERY_STRONG";
        if (abs >= 0.5) return "STRONG";
        if (abs >= 0.3) return "MODERATE";
        if (abs >= 0.1) return "WEAK";
        return "NEUTRAL";
    }
}
