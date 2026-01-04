package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO for VCP (Volume Cluster Profile) Signal 
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VCPSignalDTO {
    
    // Identity
    private String scripCode;
    private String companyName;
    private String timeframe;
    private LocalDateTime timestamp;
    
    // Overall VCP Score
    private Double vcpCombinedScore;      // 0-100 range
    private String vcpSignal;             // BULLISH/BEARISH/NEUTRAL
    
    //Cluster Data
    private List<VolumeCluster> clusters; // All volume clusters
    private VolumeCluster pocCluster;     // Point of Control (highest volume)
    private VolumeCluster vahCluster;     // Value Area High
    private VolumeCluster valCluster;     // Value Area Low
    
    // Scores
    private Double runwayScore;           // 0-1 How much room to move
    private Double structuralBias;        // -1 to +1 (support/resistance strength)
    private Double penetrationScore;      // 0-1 How well price penetrated clusters
    private Double alignmentScore;        // 0-1 Are clusters aligned with direction?
    
    // Price Context
    private Double currentPrice;
    private Double kyleLambda;            // Price impact coefficient (penetration difficulty)
    private String pricePosition;         // ABOVE_POC, BELOW_POC, AT_POC
    
    // Cluster Metrics
    private Integer totalClusters;
    private Double avgClusterStrength;
    private Boolean hasStrongSupport;     // Near strong demand cluster
    private Boolean hasStrongResistance;  // Near strong supply cluster
    
    // Volume Profile
    private Long totalVolume;
    private Double valueAreaHigh;        // Price where 70% value area starts
    private Double valueAreaLow;          // Price where 70% value area ends
    private Double pointOfControl;        // Price with highest volume
    
    // Nested Volume Cluster model
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class VolumeCluster {
        private Double price;
        private String type;              // SUPPLY, DEMAND, POC, VA_HIGH, VA_LOW
        private Long volume;
        private Double penetrationScore;  // 0-1 How well price penetrated this cluster
        private Double distanceFromPrice; // % distance from current price
        private Boolean isActive;         // Currently relevant for trading
        private String significance;      // STRONG, MEDIUM, WEAK
    }
}
