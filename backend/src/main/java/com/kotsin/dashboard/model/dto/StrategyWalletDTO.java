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
        private String exchange;
    }
}
