package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;

/**
 * Strategy state DTO - container for VCP, IPU, and Pivot state.
 *
 * Provides unified access to all strategy state for a symbol/timeframe.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StrategyStateDTO {

    // Identity
    private String symbol;
    private String scripCode;
    private String companyName;
    private String timeframe;

    // Strategy States
    private VcpStateDTO vcpState;
    private IpuStateDTO ipuState;
    private PivotStateDTO pivotState;

    // Metadata
    private Instant lastUpdated;
    private Long version;                       // For optimistic locking

    // Availability Flags
    private Boolean hasVcpState;
    private Boolean hasIpuState;
    private Boolean hasPivotState;

    // Composite Scores
    private Double compositeScore;              // Combined score from all strategies
    private String compositeDirection;          // Aggregate direction
    private String compositeSignal;             // STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL

    // ==================== HELPER METHODS ====================

    /**
     * Check if all strategy states are available.
     */
    public boolean isComplete() {
        return Boolean.TRUE.equals(hasVcpState) &&
               Boolean.TRUE.equals(hasIpuState) &&
               Boolean.TRUE.equals(hasPivotState);
    }

    /**
     * Check if at least one strategy state is available.
     */
    public boolean hasAnyState() {
        return Boolean.TRUE.equals(hasVcpState) ||
               Boolean.TRUE.equals(hasIpuState) ||
               Boolean.TRUE.equals(hasPivotState);
    }

    /**
     * Calculate composite direction from all strategies.
     */
    public String calculateCompositeDirection() {
        int bullishCount = 0;
        int bearishCount = 0;

        // VCP direction
        if (vcpState != null) {
            if (vcpState.isBullishSetup()) bullishCount++;
            else if (vcpState.isBearishSetup()) bearishCount++;
        }

        // IPU direction
        if (ipuState != null) {
            if ("BULLISH".equals(ipuState.getCurrentDirection())) bullishCount++;
            else if ("BEARISH".equals(ipuState.getCurrentDirection())) bearishCount++;
        }

        // Pivot/Structure direction
        if (pivotState != null) {
            if (pivotState.isUptrend()) bullishCount++;
            else if (pivotState.isDowntrend()) bearishCount++;
        }

        if (bullishCount > bearishCount) return "BULLISH";
        if (bearishCount > bullishCount) return "BEARISH";
        return "NEUTRAL";
    }

    /**
     * Calculate composite score from all strategies.
     */
    public Double calculateCompositeScore() {
        double score = 0.0;
        int count = 0;

        // VCP contribution
        if (vcpState != null && vcpState.getBias() != null) {
            score += (vcpState.getBias() + 1) / 2;  // Convert -1 to 1 -> 0 to 1
            count++;
        }

        // IPU contribution
        if (ipuState != null && ipuState.getCurrentIpuScore() != null) {
            double ipuContribution = ipuState.getCurrentIpuScore();
            if ("BEARISH".equals(ipuState.getCurrentDirection())) {
                ipuContribution = 1 - ipuContribution;  // Invert for bearish
            }
            score += ipuContribution;
            count++;
        }

        // Structure contribution
        if (pivotState != null) {
            Double bias = pivotState.getStructureBias();
            if (bias != null) {
                score += (bias + 1) / 2;  // Convert -1 to 1 -> 0 to 1
                count++;
            }
        }

        return count > 0 ? score / count : null;
    }

    /**
     * Determine signal from composite score.
     */
    public String calculateCompositeSignal() {
        Double score = calculateCompositeScore();
        if (score == null) return "UNKNOWN";

        if (score >= 0.8) return "STRONG_BUY";
        if (score >= 0.6) return "BUY";
        if (score <= 0.2) return "STRONG_SELL";
        if (score <= 0.4) return "SELL";
        return "NEUTRAL";
    }

    /**
     * Check if actionable (good IPU + clear structure).
     */
    public boolean isActionable() {
        // Need IPU state with good score
        if (ipuState == null || !ipuState.isActionable()) return false;

        // Need clear structure
        if (pivotState == null) return true;  // Allow if no pivot state
        return !pivotState.isConsolidating();
    }

    /**
     * Get VCP runway in direction of trade.
     */
    public Double getRunwayInDirection(String direction) {
        if (vcpState == null) return null;
        if ("BULLISH".equals(direction) || "LONG".equals(direction)) {
            return vcpState.getBullishRunway();
        } else if ("BEARISH".equals(direction) || "SHORT".equals(direction)) {
            return vcpState.getBearishRunway();
        }
        return null;
    }

    /**
     * Check if momentum supports direction.
     */
    public boolean momentumSupports(String direction) {
        if (ipuState == null) return true;  // Assume yes if no IPU

        String ipuDir = ipuState.getCurrentDirection();
        if ("BULLISH".equals(direction) || "LONG".equals(direction)) {
            return "BULLISH".equals(ipuDir) && !ipuState.isDecelerating();
        } else if ("BEARISH".equals(direction) || "SHORT".equals(direction)) {
            return "BEARISH".equals(ipuDir) && !ipuState.isDecelerating();
        }
        return false;
    }
}
