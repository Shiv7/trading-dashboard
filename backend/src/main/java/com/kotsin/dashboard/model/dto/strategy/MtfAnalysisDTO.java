package com.kotsin.dashboard.model.dto.strategy;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * MtfAnalysisDTO - Complete MTF (Multi-Timeframe) analysis for dashboard transparency.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MtfAnalysisDTO {
    // Hierarchical Analysis
    private String htfTimeframe;
    private String ltfTimeframe;
    private String htfBias;
    private String ltfBias;
    private boolean biasAligned;
    private String htfStructure;
    private String ltfStructure;

    // Swing Range
    private double swingHigh;
    private double swingLow;
    private double equilibrium;
    private String zonePosition;
    private double rangePositionPercent;
    private double swingSizePercent;
    private boolean isUpswing;

    // Flow Alignment
    private String flowStatus;
    private String flowInterpretation;
    private String flowReason;
    private Double flowConfidence;

    // Entry Sequence
    private int completedSteps;
    private int totalSteps;
    private List<String> completedStepNames;
    private List<String> missingStepNames;
    private boolean coreRequirementsMet;
    private boolean fullSequenceMet;

    // Quality
    private String qualityTier;
    private String qualityTierDisplay;
    private String qualitySummary;
    private List<String> qualityReasons;
    private int qualityScore;

    // SMC Details
    private boolean atHtfDemand;
    private boolean atHtfSupply;
    private boolean ltfSweepDetected;
    private String ltfSweepSide;
    private boolean ltfChochDetected;
    private String ltfChochDirection;
    private boolean ltfBosDetected;
    private String ltfBosDirection;
}
