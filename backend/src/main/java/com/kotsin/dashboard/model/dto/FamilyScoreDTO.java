package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * DTO representing the family score for a stock.
 * Contains all module outputs for transparency.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FamilyScoreDTO {
    
    private String scripCode;
    private String companyName;
    private String timeframe;
    private LocalDateTime timestamp;
    
    // Price data
    private double open;
    private double high;
    private double low;
    private double close;
    private long volume;
    private double vwap;
    
    // VCP Module
    private double vcpCombinedScore;
    private double vcpRunway;
    private double vcpStructuralBias;
    private double vcpSupportScore;
    private double vcpResistanceScore;
    
    // IPU Module
    private double ipuFinalScore;
    private double ipuInstProxy;
    private double ipuMomentum;
    private double ipuExhaustion;
    private double ipuUrgency;
    private double ipuDirectionalConviction;
    private boolean ipuXfactor;
    private String ipuMomentumState;
    
    // Regime
    private String indexRegimeLabel;
    private double indexRegimeStrength;
    private String securityRegimeLabel;
    private boolean securityAligned;
    
    // OI/F&O
    private String oiSignal;
    private Double pcr;
    private Double spotFuturePremium;
    private String futuresBuildup;
    
    // Gate Status
    private boolean hardGatePassed;
    private String hardGateReason;
    private boolean mtfGatePassed;
    private String mtfGateReason;
    private boolean qualityGatePassed;
    private String qualityGateReason;
    private boolean statsGatePassed;
    private String statsGateReason;
    
    // Overall
    private double overallScore;
    private String direction;
    private boolean signalEmitted;
    
    // Additional module scores (for expandable details)
    private Map<String, Object> moduleDetails;
}

