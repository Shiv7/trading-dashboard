package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

public class StrategyWalletDTO {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class StrategySummary {
        private String strategy;
        private String displayName;
        private double initialCapital;
        private double currentCapital;
        private double totalPnl;
        private double totalPnlPercent;
        private int totalTrades;
        private int wins;
        private int losses;
        private double winRate;
        private double availableMargin;
        private double usedMargin;
        private double mcxUsedMargin;
        private double dayPnl;
        private boolean circuitBreakerTripped;
        private double peakBalance;
        private double maxDrawdown;
        private double maxDailyLoss;
        private double maxDrawdownPercent;
        private double maxDailyLossPercent;
        private double profitFactor;
        private double avgWin;
        private double avgLoss;
        private String circuitBreakerReason;
        private double unrealizedPnl;
        private int dayTradeCount;
        private int dayWinCount;
        private int dayLossCount;
        private int maxOpenPositions;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class StrategyTrade {
        private String tradeId;
        private String scripCode;
        private String companyName;
        private String side;
        private String direction;
        private double entryPrice;
        private double exitPrice;
        private String exitReason;
        private boolean target1Hit;
        private boolean target2Hit;
        private boolean target3Hit;
        private boolean target4Hit;
        private boolean stopHit;
        private int quantity;
        private double capitalEmployed;
        private double pnl;
        private double pnlPercent;
        private LocalDateTime entryTime;
        private LocalDateTime exitTime;
        private String strategy;
        private String variant;         // Sub-strategy variant (e.g., MERE_SCALP, MERE_SWING)
        private String executionMode;  // "AUTO" or "MANUAL"
        private String exchange;

        // Price levels
        private Double stopLoss;
        private Double target1;
        private Double target2;
        private Double target3;
        private Double target4;

        // Dual-leg levels (equity/FUT leg)
        private Double equitySl;
        private Double equityT1;
        private Double equityT2;
        private Double equityT3;
        private Double equityT4;

        // Dual-leg levels (option leg)
        private Double optionSl;
        private Double optionT1;
        private Double optionT2;
        private Double optionT3;
        private Double optionT4;

        // Instrument metadata
        private String instrumentType;      // "OPTION" / "FUTURES" / null
        private String instrumentSymbol;    // e.g. "NATGASMINI FEB 275PE"

        // Analytics
        private Double rMultiple;
        private Double confidence;
        private Long durationMinutes;

        // Transaction charges (Zerodha round-trip)
        private Double totalCharges;

        // Signal-level metrics (for correlation analytics)
        private Double atr;
        private Double volumeSurge;
        private Double oiChangePercent;
        private Double blockDealPercent;
        private Double riskReward;
    }
}
