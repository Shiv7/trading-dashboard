package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO representing the virtual wallet state for the dashboard.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WalletDTO {
    
    private String walletId;
    private double initialCapital;
    private double currentCapital;
    private double availableMargin;
    private double realizedPnl;
    private double unrealizedPnl;
    private double totalPnl;
    private double dayPnl;
    private int openPositionsCount;
    private int totalTradesCount;
    private int winCount;
    private int lossCount;
    private double winRate;
    private LocalDateTime lastUpdated;
    private List<PositionDTO> positions;
}

