package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * PatternSignalDTO - Pattern recognition signal from SMTIS v2.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PatternSignalDTO {

    private String patternId;
    private String signalId;
    private String scripCode;
    private String companyName;
    private String symbol;          // Ticker name (e.g., "ADANIGREEN") — distinct from companyName
    private String exchange;        // N=NSE, M=MCX, C=Currency

    // Pattern details
    private String patternType;      // BREAKOUT, BREAKDOWN, REVERSAL, TREND_CONTINUATION, etc.
    private String direction;        // BULLISH, BEARISH, NEUTRAL
    private String status;           // ACTIVE, COMPLETED_WIN, COMPLETED_LOSS, EXPIRED, INVALIDATED

    // Confidence and quality
    private double confidence;
    private int qualityScore;

    // Price levels
    private double entryPrice;
    private Double stopLoss;
    private Double target1;
    private Double target2;
    private Double target3;
    private Double target4;
    private Double riskRewardRatio;
    private double invalidationPrice;

    // Context
    private String timeframe;
    private String patternDescription;
    private String triggerCondition;
    private String gexRegime;
    private String session;
    private Integer daysToExpiry;

    // Timestamps
    private LocalDateTime triggeredAt;
    private LocalDateTime expiresAt;
    private LocalDateTime completedAt;

    // Outcome (for completed patterns)
    private Double actualPnl;
    private Double rMultiple;

    // Volume gate (from StreamingCandle PatternAnalyzer)
    private Boolean volumeConfirmed;    // true = volume expanded + directional pressure aligned
    private Double volumeRatio;         // current volume / 20-period avg volume

    // Option/futures enrichment (populated by OptionDataEnricher in streaming candle)
    private Boolean optionAvailable;
    private String optionFailureReason;
    private String optionScripCode;
    private String optionSymbol;
    private Double optionStrike;
    private String optionType;          // CE or PE
    private String optionExpiry;
    private Double optionLtp;
    private Integer optionLotSize;
    private Integer optionMultiplier;
    private Boolean futuresAvailable;
    private String futuresScripCode;
    private String futuresSymbol;
    private Double futuresLtp;
    private Integer futuresLotSize;
    private Integer futuresMultiplier;
    private String futuresExpiry;
}
