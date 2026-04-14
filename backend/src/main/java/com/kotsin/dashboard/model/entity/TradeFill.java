package com.kotsin.dashboard.model.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * TradeFill — one document per partial fill (T1/T2/T3/T4/SL/TRAILING/MANUAL/TIME_STOP/DD/OI/EOD).
 *
 * Written by {@code TradeFillConsumer} listening to Kafka topic {@code trade-fills}.
 * The producer lives in the execution module ({@code FillEventPublisher}).
 *
 * Idempotency: compound unique index on (orderId, totalFilledQty) — the same fill cannot
 * be inserted twice even if the producer retries. A retry produces identical key → dup-key
 * exception which is caught and ignored.
 */
@Document(collection = "trade_fills")
@CompoundIndexes({
    @CompoundIndex(name = "uniq_fill", def = "{'orderId': 1, 'totalFilledQty': 1}", unique = true)
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TradeFill {

    @Id
    private String id;

    @Indexed
    private String tradeId;          // alias of signalId — what the UI groups by
    @Indexed
    private String signalId;
    private String orderId;
    @Indexed
    private String scripCode;
    private String symbol;
    private String exchange;
    private String instrumentType;   // EQUITY / OPTION / FUTURES
    private String strategy;
    private String side;             // BUY / SELL
    private String orderType;        // ENTRY / EXIT

    private String exitLevel;        // "T1","T2","T3","T4","SL","TRAILING_SL","MANUAL","EOD","TIME_STOP","DD_ZONE_A","DD_ZONE_B","OI_EXIT"

    private double entryPrice;       // weighted avg entry used to compute PnL on this fill
    private double fillPrice;
    private int fillQty;             // qty of THIS fill
    private int totalFilledQty;      // cumulative filled qty on this order (idempotency key)
    private int remainingQty;        // open qty remaining on the position after this fill
    private double weightedAvgFillPrice;
    private boolean isFinal;

    private int lotSize;
    private double targetPrice;      // original target for audit

    private double thisFillPnl;      // P&L realized by THIS fill only (gross, pre-charges)
    private double cumulativePnl;    // cumulative realized P&L on the position after this fill
    private double chargesAccrued;   // cumulative charges at time of this fill

    @Indexed
    private Instant fillTime;
    private long fillTimeMs;

    @Indexed
    private Instant receivedAt;      // when the consumer persisted this record (for latency audit)
}
