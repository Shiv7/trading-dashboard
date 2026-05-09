package com.kotsin.dashboard.model.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * Persistent record of every MCX_BB_30 trigger consumed from the
 * {@code kotsin_MCX_BB_30} Kafka topic. Until 2026-05-01, MCX_BB_30 signals
 * lived only in a 30-minute Caffeine in-memory cache, so the dashboard
 * showed nothing 30 minutes after a signal fired and historical analysis
 * was impossible. This collection makes them durable.
 *
 * One document per trigger event. Indexed on {@code consumedAt} so the
 * /strategy-state/mcxbb30/history endpoint can range-scan efficiently;
 * indexed on {@code dedupKey} (scripCode|triggerTime) for upsert-by-key
 * to absorb duplicate Kafka deliveries.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "mcx_bb_30_signals")
public class McxBb30SignalEntity {

    @Id
    private String id;

    /** Composite of scripCode + triggerTime, unique per logical trigger event. */
    @Indexed(unique = true)
    private String dedupKey;

    private String scripCode;
    private String symbol;
    private String companyName;
    private String exchange;
    private String direction;        // BULLISH / BEARISH

    private double triggerPrice;
    private double triggerScore;
    private double bbUpper;
    private double bbLower;
    private double bbMiddle;
    private double atr30m;

    private double surgeT;
    private long volumeT;
    private double oiChangeRatio;
    private double expansionRate;
    private double bodyOutsideRatio;

    private double stopLoss;
    private double target1;
    private double target2;
    private double riskReward;

    private int technicalScore;
    private int institutionalScore;
    private String institutionalClass;
    private double combinedConviction;
    private String sizeClass;

    private String triggerTime;      // raw triggerTime string from payload
    /** Source timestamp from streamingcandle (ms epoch). Used by stale-replay gate. */
    private long sourceTimestampMs;

    /** When this consumer wrote the document. */
    @Indexed
    private Instant consumedAt;
}
