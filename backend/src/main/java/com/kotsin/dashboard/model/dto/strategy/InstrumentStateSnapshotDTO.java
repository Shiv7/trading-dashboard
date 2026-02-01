package com.kotsin.dashboard.model.dto.strategy;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * InstrumentStateSnapshotDTO - Complete snapshot of an instrument's current state.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InstrumentStateSnapshotDTO {
    private String scripCode;
    private String companyName;
    private String state;  // IDLE, WATCHING, READY, POSITIONED, COOLDOWN
    private long stateTimestamp;
    private long stateEntryTime;
    private long stateDurationMs;

    // Market Data
    private double currentPrice;
    private double ofiZscore;
    private double atr;
    private double vpin;
    private boolean superTrendBullish;
    private boolean superTrendFlip;
    private double bbPercentB;
    private boolean bbSqueezing;

    // Active Setups
    private List<ActiveSetupInfoDTO> activeSetups;

    // Position Info
    private PositionInfoDTO position;

    // Cooldown
    private long cooldownRemainingMs;

    // Stats
    private int signalsToday;
    private int maxSignalsPerDay;
}
