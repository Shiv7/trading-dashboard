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
@Document(collection = "user_orders")
@CompoundIndex(name = "user_orders_idx", def = "{'userId': 1, 'createdAt': -1}")
public class UserOrder {

    @Id
    private String id;

    private String userId;
    private String orderId;
    private String walletType; // PAPER, REAL

    private String scripCode;
    private String side; // BUY, SELL
    private String type; // MARKET, LIMIT

    private int quantity;
    private double limitPrice;
    private double currentPrice;

    private double stopLoss;
    private double target1;
    private double target2;

    private String trailingType;
    private double trailingValue;

    private String status; // PENDING, FILLED, CANCELLED, REJECTED

    private double filledPrice;
    private LocalDateTime filledAt;

    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
