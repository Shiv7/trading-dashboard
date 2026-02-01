package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.List;

/**
 * Pivot (Swing Points & Market Structure) state DTO.
 *
 * Tracks:
 * - Swing highs and lows
 * - Market structure (uptrend, downtrend, consolidation)
 * - Dynamic support and resistance levels
 * - Structure breaks (BOS)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PivotStateDTO {

    // Swing Points
    private List<SwingLevelDTO> swingHighs;         // Last 20 swing highs
    private List<SwingLevelDTO> swingLows;          // Last 20 swing lows
    private SwingLevelDTO lastSwingHigh;
    private SwingLevelDTO lastSwingLow;

    // Dynamic Levels
    private List<PriceLevelDTO> supportLevels;      // Dynamic support zones
    private List<PriceLevelDTO> resistanceLevels;   // Dynamic resistance zones

    // Daily Pivot Points (Classic)
    private Double dailyPivot;
    private Double dailyR1;
    private Double dailyR2;
    private Double dailyR3;
    private Double dailyS1;
    private Double dailyS2;
    private Double dailyS3;

    // Weekly Pivot Points
    private Double weeklyPivot;
    private Double weeklyR1;
    private Double weeklyR2;
    private Double weeklyS1;
    private Double weeklyS2;

    // Market Structure
    private String structure;                       // UPTREND, DOWNTREND, CONSOLIDATION, RANGE
    private Boolean higherHighs;                    // Making HH
    private Boolean higherLows;                     // Making HL
    private Boolean lowerHighs;                     // Making LH
    private Boolean lowerLows;                      // Making LL

    // Structure Breaks
    private Boolean structureBreakDetected;         // Recent BOS
    private String structureBreakType;              // BULLISH_BOS, BEARISH_BOS
    private Double structureBreakPrice;
    private Instant structureBreakTime;

    // Current Context
    private Double currentPrice;
    private String nearestLevelType;                // SUPPORT, RESISTANCE, PIVOT
    private Double distanceToNearestLevel;
    private Double distancePercent;

    // Retest History
    private List<RetestEventDTO> recentRetests;     // Last 10 retests

    private Instant calculatedAt;

    /**
     * Swing Level DTO.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SwingLevelDTO {
        private Double price;
        private Integer barIndex;                   // Bar where swing occurred
        private Instant timestamp;
        private Integer strength;                   // N-bar confirmation (higher = stronger)
        private Boolean isValid;                    // Still valid (not broken)
        private Integer testCount;                  // Times price tested this level
        private Instant lastTest;
    }

    /**
     * Price Level DTO (Support/Resistance).
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PriceLevelDTO {
        private Double price;
        private String type;                        // SUPPORT, RESISTANCE
        private String source;                      // SWING, PIVOT, VOLUME_CLUSTER, ROUND_NUMBER
        private Double strength;                    // 0-1 strength score
        private Integer touchCount;                 // Times price touched
        private Instant firstTouch;
        private Instant lastTouched;
        private Boolean isActive;                   // Still relevant
        private Double width;                       // Zone width (if applicable)
    }

    /**
     * Retest Event DTO.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RetestEventDTO {
        private String levelType;                   // SUPPORT, RESISTANCE, PIVOT
        private Double levelPrice;
        private Instant retestTime;
        private Double retestPrice;
        private Boolean bounced;                    // Did price bounce?
        private Boolean broke;                      // Did price break through?
        private Double bouncePercent;               // % move after bounce
        private String outcome;                     // HELD, BROKE, WICKED_THROUGH
    }

    // ==================== HELPER METHODS ====================

    /**
     * Check if in uptrend (HH + HL).
     */
    public boolean isUptrend() {
        return "UPTREND".equals(structure) ||
               (Boolean.TRUE.equals(higherHighs) && Boolean.TRUE.equals(higherLows));
    }

    /**
     * Check if in downtrend (LH + LL).
     */
    public boolean isDowntrend() {
        return "DOWNTREND".equals(structure) ||
               (Boolean.TRUE.equals(lowerHighs) && Boolean.TRUE.equals(lowerLows));
    }

    /**
     * Check if consolidating.
     */
    public boolean isConsolidating() {
        return "CONSOLIDATION".equals(structure) || "RANGE".equals(structure);
    }

    /**
     * Get nearest support level.
     */
    public PriceLevelDTO getNearestSupport() {
        if (supportLevels == null || supportLevels.isEmpty()) return null;
        if (currentPrice == null) return supportLevels.get(0);

        return supportLevels.stream()
                .filter(l -> l.getPrice() != null && l.getPrice() < currentPrice)
                .max((a, b) -> Double.compare(a.getPrice(), b.getPrice()))
                .orElse(null);
    }

    /**
     * Get nearest resistance level.
     */
    public PriceLevelDTO getNearestResistance() {
        if (resistanceLevels == null || resistanceLevels.isEmpty()) return null;
        if (currentPrice == null) return resistanceLevels.get(0);

        return resistanceLevels.stream()
                .filter(l -> l.getPrice() != null && l.getPrice() > currentPrice)
                .min((a, b) -> Double.compare(a.getPrice(), b.getPrice()))
                .orElse(null);
    }

    /**
     * Check if price is near a key level.
     */
    public boolean isNearKeyLevel() {
        return distancePercent != null && distancePercent < 0.5;  // Within 0.5%
    }

    /**
     * Get bullish bias based on structure.
     */
    public Double getStructureBias() {
        if (isUptrend()) return 1.0;
        if (isDowntrend()) return -1.0;
        if (Boolean.TRUE.equals(higherLows) && !Boolean.TRUE.equals(lowerHighs)) return 0.5;
        if (Boolean.TRUE.equals(lowerHighs) && !Boolean.TRUE.equals(higherLows)) return -0.5;
        return 0.0;
    }

    /**
     * Check if recent bullish structure break.
     */
    public boolean hasBullishBOS() {
        return Boolean.TRUE.equals(structureBreakDetected) &&
               "BULLISH_BOS".equals(structureBreakType);
    }

    /**
     * Check if recent bearish structure break.
     */
    public boolean hasBearishBOS() {
        return Boolean.TRUE.equals(structureBreakDetected) &&
               "BEARISH_BOS".equals(structureBreakType);
    }
}
