package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;

/**
 * Unified candle DTO - merged view of Tick + Orderbook + OI data.
 * Computed at query time from independent data sources.
 *
 * Architecture:
 * - StreamingCandle stores Tick, Orderbook, OI separately in Redis
 * - Dashboard merges them at query time for unified view
 * - This avoids complex Kafka joins and ensures data freshness
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UnifiedCandleDTO {

    // ==================== IDENTITY ====================
    private String symbol;
    private String scripCode;
    private String exchange;
    private String exchangeType;
    private String companyName;
    private String instrumentType;      // INDEX, EQUITY, FUTURE, OPTION_CE, OPTION_PE
    private String timeframe;

    // ==================== TIMING ====================
    private Instant timestamp;
    private Instant windowStart;
    private Instant windowEnd;
    private Long windowEndMillis;       // For compatibility

    // ==================== TICK DATA (Always present) ====================
    // OHLCV
    private Double open;
    private Double high;
    private Double low;
    private Double close;
    private Long volume;
    private Double value;               // volume * vwap
    private Double vwap;
    private Double typicalPrice;        // (H+L+C)/3

    // Trade Classification
    private Long buyVolume;
    private Long sellVolume;
    private Long midpointVolume;
    private Long volumeDelta;           // buy - sell
    private Double buyPressure;         // buy / total
    private Double sellPressure;        // sell / total

    // Volume Profile
    private Double vpin;                // Informed trading probability (0-1)
    private Integer vpinBucketSize;
    private Double poc;                 // Point of Control
    private Double vah;                 // Value Area High
    private Double val;                 // Value Area Low

    // Imbalance Bars
    private Double volumeImbalance;
    private Double dollarImbalance;
    private Integer tickRuns;
    private Boolean vibTriggered;       // Volume Imbalance Bar
    private Boolean dibTriggered;       // Dollar Imbalance Bar

    // Tick Intensity
    private Integer tickCount;
    private Double ticksPerSecond;
    private Integer largeTradeCount;

    // ==================== ORDERBOOK DATA (Optional) ====================
    private Boolean hasOrderbook;

    // Order Flow Imbalance
    private Double ofi;
    private Double ofiMomentum;         // Change from previous

    // Kyle's Lambda (Price Impact)
    private Double kyleLambda;

    // Microprice (Fair Value)
    private Double microprice;

    // Spread Metrics
    private Double bidAskSpread;
    private Double spreadPercent;
    private Double spreadVolatility;
    private Double tightSpreadPercent;

    // Depth Analysis
    private Double depthImbalance;      // (bid - ask) / (bid + ask)
    private Double weightedDepthImbalance;
    private Double avgBidDepth;
    private Double avgAskDepth;
    private Double bidDepthSlope;
    private Double askDepthSlope;
    private Double depthConcentration;

    // Anomaly Detection
    private Integer spoofingCount;
    private Boolean icebergDetected;
    private Double cancelRate;

    // Update Info
    private Integer orderbookUpdateCount;
    private Instant lastOrderbookUpdate;

    // ==================== OI DATA (Optional, derivatives only) ====================
    private Boolean hasOI;

    // OI Core
    private Long openInterest;
    private Long oiChange;
    private Double oiChangePercent;

    // OI Interpretation
    private String oiInterpretation;    // LONG_BUILDUP, SHORT_COVERING, SHORT_BUILDUP, LONG_UNWINDING, NEUTRAL
    private Double oiInterpretationConfidence;
    private Boolean oiSuggestsReversal;

    // OI Velocity
    private Double oiVelocity;          // Change per minute
    private Double oiAcceleration;

    // Previous Day Reference
    private Long previousDayOI;
    private Long dailyOIChange;
    private Double dailyOIChangePercent;

    // ==================== OPTIONS DATA (Optional) ====================
    private Double strikePrice;
    private String optionType;          // CE, PE
    private String expiry;
    private Integer daysToExpiry;

    // Greeks
    private Double delta;
    private Double gamma;
    private Double theta;
    private Double vega;
    private Double impliedVolatility;

    // ==================== DATA QUALITY ====================
    private String quality;             // VALID, STALE, PARTIAL, INSUFFICIENT
    private Long tickStaleness;         // ms since last tick
    private Long orderbookStaleness;    // ms since last OB update
    private Long oiStaleness;           // ms since last OI update
    private Long processingLatencyMs;

    // ==================== AGGREGATION INFO ====================
    private Integer aggregatedCandleCount;
    private Integer expectedCandleCount;
    private Double completenessRatio;   // aggregated / expected

    // ==================== HELPER METHODS ====================

    /**
     * Check if this is a derivative instrument.
     */
    public boolean isDerivative() {
        return "FUTURE".equals(instrumentType) ||
               "OPTION_CE".equals(instrumentType) ||
               "OPTION_PE".equals(instrumentType);
    }

    /**
     * Check if this is an option.
     */
    public boolean isOption() {
        return "OPTION_CE".equals(instrumentType) || "OPTION_PE".equals(instrumentType);
    }

    /**
     * Get candle range (high - low).
     */
    public Double getRange() {
        return (high != null && low != null) ? high - low : null;
    }

    /**
     * Check if bullish candle (close > open).
     */
    public boolean isBullishCandle() {
        return close != null && open != null && close > open;
    }

    /**
     * Check if bearish candle (close < open).
     */
    public boolean isBearishCandle() {
        return close != null && open != null && close < open;
    }

    /**
     * Check if doji (small body relative to range).
     */
    public boolean isDoji() {
        if (open == null || close == null || high == null || low == null) return false;
        double body = Math.abs(close - open);
        double range = high - low;
        return range > 0 && (body / range) < 0.1;
    }

    /**
     * Check if all data sources are fresh.
     */
    public boolean isAllDataFresh() {
        boolean tickFresh = tickStaleness == null || tickStaleness < 10000;  // 10 seconds
        boolean obFresh = !Boolean.TRUE.equals(hasOrderbook) ||
                         orderbookStaleness == null || orderbookStaleness < 10000;
        boolean oiFresh = !Boolean.TRUE.equals(hasOI) ||
                         oiStaleness == null || oiStaleness < 30000;  // 30 seconds for OI
        return tickFresh && obFresh && oiFresh;
    }

    /**
     * Check if candle is complete (sufficient data).
     */
    public boolean isComplete() {
        return completenessRatio != null && completenessRatio >= 0.95;
    }

    /**
     * Get average depth (bid + ask) / 2.
     */
    public Double getAvgDepth() {
        if (avgBidDepth == null || avgAskDepth == null) return null;
        return (avgBidDepth + avgAskDepth) / 2;
    }

    /**
     * Get normalized OFI (OFI / avgDepth).
     */
    public Double getNormalizedOfi() {
        if (ofi == null) return null;
        Double avgDepth = getAvgDepth();
        return avgDepth != null && avgDepth > 0 ? ofi / avgDepth : null;
    }

    /**
     * Get body percentage (body / range).
     */
    public Double getBodyPercent() {
        if (open == null || close == null || high == null || low == null) return null;
        double range = high - low;
        if (range <= 0) return 0.0;
        return Math.abs(close - open) / range * 100;
    }

    /**
     * Get upper wick percentage.
     */
    public Double getUpperWickPercent() {
        if (open == null || close == null || high == null || low == null) return null;
        double range = high - low;
        if (range <= 0) return 0.0;
        double upperWick = high - Math.max(open, close);
        return upperWick / range * 100;
    }

    /**
     * Get lower wick percentage.
     */
    public Double getLowerWickPercent() {
        if (open == null || close == null || high == null || low == null) return null;
        double range = high - low;
        if (range <= 0) return 0.0;
        double lowerWick = Math.min(open, close) - low;
        return lowerWick / range * 100;
    }

    /**
     * Check if high volume (> 1.5x average).
     */
    public boolean isHighVolume() {
        // Assuming volumeRatio would be calculated externally
        // For now, check if buy + sell volume is significant
        if (buyVolume == null || sellVolume == null || volume == null) return false;
        return (buyVolume + sellVolume) > volume * 0.8;  // 80%+ classified = high activity
    }

    /**
     * Get net buying pressure (-1 to +1).
     */
    public Double getNetBuyingPressure() {
        if (buyPressure == null || sellPressure == null) return null;
        return buyPressure - sellPressure;
    }
}
