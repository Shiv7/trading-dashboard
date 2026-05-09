package com.kotsin.dashboard.pivotboss;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

import java.time.Instant;

/**
 * Read-only projection of {@code signal_rich_audit} written by trade-exec
 * {@code Nifty50BasketSignalConsumer}. Surfaces under the PivotBoss sidebar's
 * "Nifty50 Basket Retest" tab.
 *
 * <p>Same Mongo collection used by trade-exec but a separate POJO here — keeps
 * the dashboard read-only, avoids coupling to trade-exec's full schema, and
 * lets us evolve the dashboard view independently.
 */
@Data
@Document(collection = "signal_rich_audit")
@JsonIgnoreProperties(ignoreUnknown = true)
public class BasketAuditDoc {

    @Id
    private String id;

    private String strategy;       // "NIFTY50_BASKET"
    private String path;           // "RETEST" | "TREND"
    private String scripCode;
    private String symbol;
    private String exchange;
    private String direction;      // LONG | SHORT
    private Instant entryTime;
    private Instant breakTime;
    private Instant retestTime;
    private Double triggerPrice;
    private Double entryPrice;
    private Double stopLoss;
    private Double target1;
    private Double riskPoints;
    private Double t1RMultiple;
    private Double ibh;
    private Double ibl;
    private Double ibRange;
    private Integer dayOfWeek;
    private String executionMode; // PAPER | LIVE
    private String state;          // PENDING | ENTERED | T1_HIT | SL_HIT | EXPIRED
    @Field("kafkaTopic")
    private String kafkaTopic;
    private Instant createdAt;
    private Instant updatedAt;

    // Phase 1 enrichment (2026-04-27)
    private Double convictionScore;
    private String convictionGrade;       // A | B | C | F
    private java.util.Map<String, Double> convictionComponents;
    private String convictionRationale;
    private Boolean enrichmentDataAvailable;
    private Double ofi;
    private Double vpin;
    private Double depthImbalance;
    private Double buyPressure;
    private Double volumeMultiplier;
    private Integer largeTradeCount;
    private String oiInterpretation;
    private java.util.List<String> pivotConfluenceLabels;
}
