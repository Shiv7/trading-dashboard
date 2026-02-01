package com.kotsin.dashboard.model.dto.strategy;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * ActiveSetupInfoDTO - Information about an active setup being watched.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ActiveSetupInfoDTO {
    private String strategyId;
    private String setupDescription;
    private String direction;
    private double keyLevel;
    private long watchingStartTime;
    private long watchingDurationMs;
    private List<ConditionCheckDTO> conditions;
    private int progressPercent;
    private String blockingCondition;

    // Extended transparency fields
    private List<StrategyConditionDTO> detailedConditions;
    private MtfAnalysisDTO mtfAnalysis;
    private String qualityTier;
    private boolean readyForEntry;
    private String notReadyReason;
}
