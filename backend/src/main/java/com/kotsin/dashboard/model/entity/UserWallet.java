package com.kotsin.dashboard.model.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "user_wallets")
@CompoundIndex(name = "user_wallet_unique", def = "{'userId': 1, 'walletType': 1}", unique = true)
public class UserWallet {

    @Id
    private String id;

    private String userId;
    private String walletType; // PAPER, REAL

    @Builder.Default
    private double initialCapital = 100000;
    @Builder.Default
    private double currentCapital = 100000;

    private double realizedPnl;
    private double unrealizedPnl;
    private double totalFees;

    private double dayPnl;
    private double weekPnl;
    private double monthPnl;

    private int totalTradesCount;
    private int winCount;
    private int lossCount;
    private double winRate;

    private LocalDateTime lastUpdated;

    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
