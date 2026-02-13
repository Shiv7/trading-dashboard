package com.kotsin.dashboard.model.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "user_trades")
@CompoundIndexes({
        @CompoundIndex(name = "user_exit_time", def = "{'userId': 1, 'exitTime': -1}"),
        @CompoundIndex(name = "user_wallet_exit", def = "{'userId': 1, 'walletType': 1, 'exitTime': -1}"),
        @CompoundIndex(name = "user_scrip", def = "{'userId': 1, 'scripCode': 1}")
})
public class UserTrade {

    @Id
    private String id;

    private String userId;
    private String tradeId;
    private String signalId;

    private String scripCode;
    private String symbol;
    private String companyName;
    private String exchange;

    private String side; // LONG, SHORT
    private String walletType; // PAPER, REAL

    private double entryPrice;
    private double exitPrice;
    private int quantity;

    private double stopLoss;
    private double target1;
    private double target2;

    private double pnl;
    private double pnlPercent;
    private double rMultiple;
    private double fees;
    private double netPnl;

    private LocalDateTime entryTime;
    private LocalDateTime exitTime;

    private String exitReason; // TARGET_1, TARGET_2, STOP_LOSS, TRAILING_SL, MANUAL
    private int durationMinutes;

    private String strategy; // CURATED_SIGNAL, IPU, VCP, AUTO
    private String notes;

    @Builder.Default
    private List<String> tags = new ArrayList<>();

    private String status; // OPEN, CLOSED_WIN, CLOSED_LOSS, CLOSED_BREAKEVEN

    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
