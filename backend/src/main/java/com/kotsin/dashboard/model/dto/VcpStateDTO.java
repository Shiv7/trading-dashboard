package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.List;

/**
 * VCP (Volume Cluster Profile) state DTO.
 *
 * Contains:
 * - Support and resistance clusters based on volume concentration
 * - Point of Control (POC) and Value Area (VAH/VAL)
 * - Runway scores indicating support/resistance strength
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VcpStateDTO {

    // Cluster lists
    private List<VolumeClusterDTO> supportClusters;     // Below current price (max 10)
    private List<VolumeClusterDTO> resistanceClusters;  // Above current price (max 10)

    // Volume Profile Levels
    private Double pocPrice;                            // Point of Control
    private Double valueAreaHigh;
    private Double valueAreaLow;
    private Double valueAreaPercent;                    // % of volume in value area (typically 70%)

    // Runway Scores (0-1)
    private Double bullishRunway;                       // Support strength / room to run up
    private Double bearishRunway;                       // Resistance strength / room to run down
    private Double netRunway;                           // bullishRunway - bearishRunway

    // Analysis Info
    private Integer lookbackCandles;
    private Long totalVolume;
    private Integer totalClusters;
    private Instant calculatedAt;

    // Current Price Context
    private Double currentPrice;
    private String pricePosition;                       // ABOVE_POC, BELOW_POC, AT_POC, IN_VALUE_AREA

    // Derived Metrics
    private Double avgClusterStrength;
    private Boolean hasStrongSupport;                   // At least one strong support cluster
    private Boolean hasStrongResistance;                // At least one strong resistance cluster

    /**
     * Volume Cluster DTO.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class VolumeClusterDTO {
        private Double price;                           // Cluster price level
        private Long volume;                            // Total volume at level
        private Double volumePercent;                   // % of total volume
        private String type;                            // SUPPLY, DEMAND, POC, VA_HIGH, VA_LOW
        private String significance;                    // STRONG, MEDIUM, WEAK
        private Integer touchCount;                     // Number of times price touched this level
        private Instant firstTouch;
        private Instant lastTouch;
        private Double distanceFromPrice;               // Distance from current price
        private Double distancePercent;                 // Distance as % of price
        private Boolean isActive;                       // Recently touched

        // OFI Enrichment
        private Double ofiAtLevel;                      // Order flow imbalance at this level
        private Double avgOfiAtLevel;                   // Average OFI when price at this level

        // Orderbook Context
        private Double depthAtLevel;                    // Orderbook depth at this level
        private Double bidAskRatioAtLevel;              // Bid/Ask ratio when near this level
    }

    // ==================== HELPER METHODS ====================

    /**
     * Get the nearest support cluster.
     */
    public VolumeClusterDTO getNearestSupport() {
        if (supportClusters == null || supportClusters.isEmpty()) return null;
        return supportClusters.stream()
                .filter(c -> c.getDistanceFromPrice() != null)
                .min((a, b) -> Double.compare(
                        Math.abs(a.getDistanceFromPrice()),
                        Math.abs(b.getDistanceFromPrice())))
                .orElse(supportClusters.get(0));
    }

    /**
     * Get the nearest resistance cluster.
     */
    public VolumeClusterDTO getNearestResistance() {
        if (resistanceClusters == null || resistanceClusters.isEmpty()) return null;
        return resistanceClusters.stream()
                .filter(c -> c.getDistanceFromPrice() != null)
                .min((a, b) -> Double.compare(
                        Math.abs(a.getDistanceFromPrice()),
                        Math.abs(b.getDistanceFromPrice())))
                .orElse(resistanceClusters.get(0));
    }

    /**
     * Check if price is in value area.
     */
    public boolean isInValueArea() {
        return "IN_VALUE_AREA".equals(pricePosition) ||
               (currentPrice != null && valueAreaLow != null && valueAreaHigh != null &&
                currentPrice >= valueAreaLow && currentPrice <= valueAreaHigh);
    }

    /**
     * Get bullish bias (positive = bullish, negative = bearish).
     */
    public Double getBias() {
        if (bullishRunway == null || bearishRunway == null) return null;
        return bullishRunway - bearishRunway;
    }

    /**
     * Check if setup is bullish (more support than resistance).
     */
    public boolean isBullishSetup() {
        Double bias = getBias();
        return bias != null && bias > 0.1;
    }

    /**
     * Check if setup is bearish (more resistance than support).
     */
    public boolean isBearishSetup() {
        Double bias = getBias();
        return bias != null && bias < -0.1;
    }
}
