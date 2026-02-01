# COMPREHENSIVE REST MODULE SYNC PLAN

## Streaming Candle v2.0 Refactoring - Dashboard Backend Changes

**Date:** 2026-02-01
**Status:** IMPLEMENTATION GUIDE
**Scope:** All changes needed in trading-dashboard/backend to sync with streamingcandle refactoring

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [TechnicalIndicatorDTO Expansion](#2-technicalindicatordto-expansion)
3. [New DTOs to Create](#3-new-dtos-to-create)
4. [Service Layer Changes](#4-service-layer-changes)
5. [Redis Key Pattern Updates](#5-redis-key-pattern-updates)
6. [New REST Controllers](#6-new-rest-controllers)
7. [Kafka Consumer Updates](#7-kafka-consumer-updates)
8. [WebSocket Updates](#8-websocket-updates)
9. [Frontend Type Updates](#9-frontend-type-updates)
10. [Configuration Changes](#10-configuration-changes)
11. [Implementation Priority](#11-implementation-priority)

---

## 1. EXECUTIVE SUMMARY

### Current Gap Analysis

| Component | StreamingCandle (New) | Dashboard (Current) | Gap |
|-----------|----------------------|---------------------|-----|
| **TechnicalIndicators** | 50+ fields (RSI, MACD, ADX, Stochastic, MAs, Pivots) | 20 fields (BB, VWAP, SuperTrend only) | **CRITICAL** |
| **UnifiedCandle** | Full merged view (Tick+OB+OI) | Not available | **HIGH** |
| **StrategyState** | VCP, IPU, Pivot state persistence | Not available | **HIGH** |
| **Redis Keys** | New patterns (tick:, ob:, oi:, strategy:) | Only tech:indicator: | **MEDIUM** |
| **Kafka Topics** | New independent topics | Family candle topics | **MEDIUM** |

### Files to Modify

```
backend/src/main/java/com/kotsin/dashboard/
├── model/dto/
│   ├── TechnicalIndicatorDTO.java          [MAJOR UPDATE]
│   ├── UnifiedCandleDTO.java               [NEW FILE]
│   ├── TickCandleDTO.java                  [NEW FILE]
│   ├── OrderbookMetricsDTO.java            [NEW FILE]
│   ├── OIMetricsDTO.java                   [NEW FILE]
│   ├── StrategyStateDTO.java               [NEW FILE]
│   ├── VcpStateDTO.java                    [NEW FILE]
│   ├── IpuStateDTO.java                    [NEW FILE]
│   └── PivotStateDTO.java                  [NEW FILE]
├── service/
│   ├── TechnicalIndicatorService.java      [UPDATE]
│   ├── UnifiedCandleService.java           [NEW FILE]
│   ├── StrategyStateService.java           [NEW FILE]
│   └── TrendContextService.java            [NEW FILE]
├── controller/
│   ├── TechnicalIndicatorController.java   [UPDATE]
│   ├── UnifiedCandleController.java        [NEW FILE]
│   └── StrategyStateController.java        [NEW FILE]
├── kafka/
│   ├── TickCandleConsumer.java             [NEW FILE]
│   ├── OrderbookMetricsConsumer.java       [NEW FILE]
│   ├── OIMetricsConsumer.java              [NEW FILE]
│   └── StrategyStateConsumer.java          [UPDATE]
└── config/
    └── RedisConfig.java                    [UPDATE]
```

---

## 2. TECHNICALINDICATORDTO EXPANSION

### Current TechnicalIndicatorDTO (20 fields)

```java
// CURRENT - Only BB, VWAP, SuperTrend
private Double bbUpper, bbMiddle, bbLower, bbWidth, bbWidthPct, bbPercentB;
private Boolean bbSqueeze;
private Double vwap, vwapUpperBand, vwapLowerBand, vwapStdDev, vwapDeviation;
private String vwapSignal;
private Double superTrendValue, atr, atrPercent;
private String superTrendDirection;
private Boolean superTrendReversal;
private Integer candlesSinceFlip;
private Boolean dataQualitySufficient;
private Integer actualCandleCount, requiredCandleCount;
```

### New TechnicalIndicatorDTO (50+ fields)

**File:** `backend/src/main/java/com/kotsin/dashboard/model/dto/TechnicalIndicatorDTO.java`

```java
package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for technical indicators - EXPANDED to match StreamingCandle TechnicalIndicators model.
 *
 * Contains:
 * - Moving Averages (SMA, EMA, VWMA)
 * - Momentum (RSI, MACD, Stochastic)
 * - Volatility (Bollinger Bands, ATR)
 * - Trend (SuperTrend, ADX)
 * - Pivot Points
 * - Derived Signals
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TechnicalIndicatorDTO {

    // ==================== IDENTITY ====================
    private String scripCode;
    private String symbol;
    private String companyName;
    private String timeframe;
    private Long timestamp;
    private Double currentPrice;

    // ==================== MOVING AVERAGES (NEW) ====================
    private Double ema9;
    private Double ema21;
    private Double ema50;
    private Double ema200;
    private Double sma20;
    private Double sma50;
    private Double sma200;
    private Double vwma20;      // Volume Weighted MA

    // ==================== RSI (NEW) ====================
    private Double rsi14;
    private Double rsiSmoothed;
    private String rsiZone;     // "OVERSOLD", "NEUTRAL", "OVERBOUGHT"

    // ==================== MACD (NEW) ====================
    private Double macdLine;        // EMA12 - EMA26
    private Double macdSignal;      // EMA9 of MACD
    private Double macdHistogram;   // MACD - Signal
    private String macdCrossover;   // "BULLISH_CROSS", "BEARISH_CROSS", "BULLISH", "BEARISH", "NEUTRAL"

    // ==================== BOLLINGER BANDS (EXISTING) ====================
    private Double bbUpper;
    private Double bbMiddle;
    private Double bbLower;
    private Double bbWidth;
    private Double bbWidthPct;
    private Double bbPercentB;
    private Boolean bbSqueeze;
    private String bbPosition;      // NEW: "ABOVE_UPPER", "UPPER_HALF", "MIDDLE", "LOWER_HALF", "BELOW_LOWER"

    // ==================== VWAP (EXISTING) ====================
    private Double vwap;
    private Double vwapUpperBand;
    private Double vwapLowerBand;
    private Double vwapStdDev;
    private String vwapSignal;
    private Double vwapDeviation;

    // ==================== ATR (EXISTING - ENHANCED) ====================
    private Double atr;             // atr14
    private Double atrPercent;      // ATR as % of price
    private Double atrMultiple;     // NEW: Current range / ATR

    // ==================== SUPERTREND (EXISTING) ====================
    private Double superTrendValue;
    private String superTrendDirection;     // "UP", "DOWN" (or "BULLISH", "BEARISH")
    private Boolean superTrendReversal;     // superTrendFlip
    private Integer candlesSinceFlip;

    // ==================== ADX (NEW) ====================
    private Double adx14;
    private Double plusDI;
    private Double minusDI;
    private String trendStrength;   // "STRONG", "MODERATE", "WEAK", "NO_TREND"

    // ==================== STOCHASTIC (NEW) ====================
    private Double stochK;
    private Double stochD;
    private String stochZone;       // "OVERSOLD", "NEUTRAL", "OVERBOUGHT"

    // ==================== PIVOT POINTS (NEW) ====================
    private Double pivotPoint;
    private Double r1;              // Resistance 1
    private Double r2;              // Resistance 2
    private Double r3;              // Resistance 3
    private Double s1;              // Support 1
    private Double s2;              // Support 2
    private Double s3;              // Support 3

    // ==================== VOLUME (NEW) ====================
    private Double volume;
    private Double avgVolume20;
    private Double volumeRatio;     // Current volume / avg volume

    // ==================== DERIVED SIGNALS (NEW) ====================
    private Boolean goldenCross;            // EMA50 crosses above EMA200
    private Boolean deathCross;             // EMA50 crosses below EMA200
    private Boolean priceAboveEma21;
    private Boolean priceAboveEma50;
    private Boolean priceAboveSuperTrend;
    private Boolean macdBullish;
    private Boolean rsiBullish;

    // ==================== DATA QUALITY (EXISTING) ====================
    private Boolean dataQualitySufficient;
    private Integer actualCandleCount;
    private Integer requiredCandleCount;

    // ==================== COMPOSITE SIGNALS (NEW) ====================
    /**
     * Convenience method to check if overall trend is bullish.
     * At least 3 of: priceAboveEma21, priceAboveSuperTrend, macdBullish, rsiBullish
     */
    public boolean isBullish() {
        int count = 0;
        if (Boolean.TRUE.equals(priceAboveEma21)) count++;
        if (Boolean.TRUE.equals(priceAboveSuperTrend)) count++;
        if (Boolean.TRUE.equals(macdBullish)) count++;
        if (Boolean.TRUE.equals(rsiBullish)) count++;
        if (rsiZone != null && !"OVERBOUGHT".equals(rsiZone)) count++;
        return count >= 3;
    }

    /**
     * Check if in high volatility state.
     */
    public boolean isHighVolatility() {
        return (atrPercent != null && atrPercent > 2.0) ||
               (bbWidthPct != null && bbWidthPct > 4.0);
    }

    /**
     * Check if trending (ADX > 20).
     */
    public boolean isTrending() {
        return "STRONG".equals(trendStrength) || "MODERATE".equals(trendStrength);
    }
}
```

---

## 3. NEW DTOs TO CREATE

### 3.1 UnifiedCandleDTO

**File:** `backend/src/main/java/com/kotsin/dashboard/model/dto/UnifiedCandleDTO.java`

```java
package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;

/**
 * Unified candle DTO - merged view of Tick + Orderbook + OI data.
 * Computed at query time, not stored.
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

    // ==================== TICK DATA (Always present) ====================
    private Double open;
    private Double high;
    private Double low;
    private Double close;
    private Long volume;
    private Double value;               // volume * vwap
    private Double vwap;

    // Trade Classification
    private Long buyVolume;
    private Long sellVolume;
    private Long volumeDelta;           // buy - sell
    private Double buyPressure;         // buy / total
    private Double sellPressure;        // sell / total

    // Volume Profile
    private Double vpin;                // Informed trading probability
    private Double poc;                 // Point of Control
    private Double vah;                 // Value Area High
    private Double val;                 // Value Area Low

    // Imbalance
    private Double volumeImbalance;
    private Boolean vibTriggered;       // Volume Imbalance Bar
    private Boolean dibTriggered;       // Dollar Imbalance Bar

    // Tick Intensity
    private Integer tickCount;
    private Integer largeTradeCount;

    // ==================== ORDERBOOK DATA (Optional) ====================
    private Boolean hasOrderbook;
    private Double ofi;                 // Order Flow Imbalance
    private Double ofiMomentum;
    private Double kyleLambda;          // Price impact coefficient
    private Double microprice;          // Fair value estimate
    private Double bidAskSpread;
    private Double spreadPercent;
    private Double depthImbalance;      // (bid - ask) / (bid + ask)
    private Double avgBidDepth;
    private Double avgAskDepth;
    private Integer spoofingCount;
    private Boolean icebergDetected;

    // ==================== OI DATA (Optional, derivatives only) ====================
    private Boolean hasOI;
    private Long openInterest;
    private Long oiChange;
    private Double oiChangePercent;
    private String oiInterpretation;    // LONG_BUILDUP, SHORT_COVERING, SHORT_BUILDUP, LONG_UNWINDING, NEUTRAL
    private Double oiInterpretationConfidence;
    private Boolean oiSuggestsReversal;
    private Double oiVelocity;

    // ==================== OPTIONS DATA (Optional) ====================
    private Double strikePrice;
    private String optionType;          // CE, PE
    private String expiry;
    private Integer daysToExpiry;
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

    // ==================== AGGREGATION INFO ====================
    private Integer aggregatedCandleCount;
    private Integer expectedCandleCount;
    private Double completenessRatio;   // aggregated / expected

    // ==================== HELPER METHODS ====================

    public boolean isDerivative() {
        return "FUTURE".equals(instrumentType) ||
               "OPTION_CE".equals(instrumentType) ||
               "OPTION_PE".equals(instrumentType);
    }

    public boolean isOption() {
        return "OPTION_CE".equals(instrumentType) || "OPTION_PE".equals(instrumentType);
    }

    public Double getRange() {
        return (high != null && low != null) ? high - low : null;
    }

    public boolean isBullish() {
        return close != null && open != null && close > open;
    }

    public boolean isComplete() {
        return completenessRatio != null && completenessRatio >= 0.95;
    }

    public Double getNormalizedOfi() {
        if (ofi == null || avgBidDepth == null || avgAskDepth == null) return null;
        double avgDepth = (avgBidDepth + avgAskDepth) / 2;
        return avgDepth > 0 ? ofi / avgDepth : null;
    }
}
```

### 3.2 StrategyStateDTO

**File:** `backend/src/main/java/com/kotsin/dashboard/model/dto/StrategyStateDTO.java`

```java
package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;

/**
 * Strategy state DTO - contains VCP, IPU, and Pivot state.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StrategyStateDTO {

    private String symbol;
    private String scripCode;
    private String timeframe;
    private Instant lastUpdated;

    // VCP State
    private VcpStateDTO vcpState;

    // IPU State
    private IpuStateDTO ipuState;

    // Pivot State
    private PivotStateDTO pivotState;

    // Version for optimistic locking
    private Long version;
}
```

### 3.3 VcpStateDTO

**File:** `backend/src/main/java/com/kotsin/dashboard/model/dto/VcpStateDTO.java`

```java
package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.List;

/**
 * VCP (Volume Cluster Profile) state DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VcpStateDTO {

    private List<VolumeClusterDTO> supportClusters;     // Below current price (max 10)
    private List<VolumeClusterDTO> resistanceClusters;  // Above current price (max 10)
    private Double pocPrice;                            // Point of Control
    private Double valueAreaHigh;
    private Double valueAreaLow;
    private Double bullishRunway;                       // Support strength
    private Double bearishRunway;                       // Resistance strength
    private Integer lookbackCandles;
    private Instant calculatedAt;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class VolumeClusterDTO {
        private Double price;
        private Long volume;
        private Double volumePercent;           // % of total
        private Double ofiEnrichment;           // Order flow context
        private String significance;            // STRONG, MEDIUM, WEAK
        private Double distanceFromPrice;
        private Boolean isActive;
        private Instant timestamp;
    }
}
```

### 3.4 IpuStateDTO

**File:** `backend/src/main/java/com/kotsin/dashboard/model/dto/IpuStateDTO.java`

```java
package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.List;

/**
 * IPU (Institutional Participation & Urgency) state DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IpuStateDTO {

    private List<IpuSnapshotDTO> history;           // Rolling history (last 100)
    private Double currentIpuScore;                 // [0-1]
    private Double currentExhaustion;               // Reversal likelihood
    private String currentDirection;                // BULLISH, BEARISH, NEUTRAL
    private Double avgIpuScore10;                   // 10-bar rolling average
    private Double avgIpuScore20;                   // 20-bar rolling average
    private String momentumState;                   // ACCELERATING, DECELERATING, STEADY, EXHAUSTED
    private Instant calculatedAt;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class IpuSnapshotDTO {
        private Double ipuScore;
        private Double exhaustionScore;
        private String direction;
        private Double instProxy;               // Institutional activity
        private Double momentum;
        private Double urgency;
        private Instant timestamp;
    }
}
```

### 3.5 PivotStateDTO

**File:** `backend/src/main/java/com/kotsin/dashboard/model/dto/PivotStateDTO.java`

```java
package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.List;

/**
 * Pivot (Swing Points & Market Structure) state DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PivotStateDTO {

    private List<SwingLevelDTO> swingHighs;         // Last 20
    private List<SwingLevelDTO> swingLows;          // Last 20
    private List<PriceLevelDTO> supportLevels;      // Dynamic support
    private List<PriceLevelDTO> resistanceLevels;   // Dynamic resistance

    // Market Structure
    private String structure;                       // UPTREND, DOWNTREND, CONSOLIDATION, RANGE
    private Boolean higherHighs;
    private Boolean higherLows;
    private Boolean lowerHighs;
    private Boolean lowerLows;

    private SwingLevelDTO lastSwingHigh;
    private SwingLevelDTO lastSwingLow;
    private Instant calculatedAt;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SwingLevelDTO {
        private Double price;
        private Integer barIndex;
        private Instant timestamp;
        private Integer strength;               // N-bar confirmation
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PriceLevelDTO {
        private Double price;
        private String type;                    // SUPPORT, RESISTANCE
        private Double strength;
        private Integer touchCount;
        private Instant lastTouched;
    }
}
```

---

## 4. SERVICE LAYER CHANGES

### 4.1 Update TechnicalIndicatorService

**File:** `backend/src/main/java/com/kotsin/dashboard/service/TechnicalIndicatorService.java`

**Changes Required:**

1. Update JSON parsing to handle new fields
2. Add methods for new indicator groups
3. Support multiple Redis key patterns

```java
// ADD these new methods to existing TechnicalIndicatorService

/**
 * Get moving averages only (lightweight query).
 */
public Optional<Map<String, Double>> getMovingAverages(String scripCode, String timeframe) {
    return getIndicators(scripCode, timeframe)
        .map(ind -> Map.of(
            "ema9", ind.getEma9(),
            "ema21", ind.getEma21(),
            "ema50", ind.getEma50(),
            "ema200", ind.getEma200(),
            "sma20", ind.getSma20(),
            "sma50", ind.getSma50(),
            "sma200", ind.getSma200()
        ));
}

/**
 * Get momentum indicators (RSI, MACD, Stochastic).
 */
public Optional<Map<String, Object>> getMomentumIndicators(String scripCode, String timeframe) {
    return getIndicators(scripCode, timeframe)
        .map(ind -> Map.of(
            "rsi14", ind.getRsi14(),
            "rsiZone", ind.getRsiZone(),
            "macdLine", ind.getMacdLine(),
            "macdSignal", ind.getMacdSignal(),
            "macdHistogram", ind.getMacdHistogram(),
            "macdCrossover", ind.getMacdCrossover(),
            "stochK", ind.getStochK(),
            "stochD", ind.getStochD(),
            "stochZone", ind.getStochZone()
        ));
}

/**
 * Get trend indicators (SuperTrend, ADX).
 */
public Optional<Map<String, Object>> getTrendIndicators(String scripCode, String timeframe) {
    return getIndicators(scripCode, timeframe)
        .map(ind -> Map.of(
            "superTrendValue", ind.getSuperTrendValue(),
            "superTrendDirection", ind.getSuperTrendDirection(),
            "superTrendReversal", ind.getSuperTrendReversal(),
            "adx14", ind.getAdx14(),
            "plusDI", ind.getPlusDI(),
            "minusDI", ind.getMinusDI(),
            "trendStrength", ind.getTrendStrength()
        ));
}

/**
 * Get pivot points.
 */
public Optional<Map<String, Double>> getPivotPoints(String scripCode, String timeframe) {
    return getIndicators(scripCode, timeframe)
        .map(ind -> Map.of(
            "pivot", ind.getPivotPoint(),
            "r1", ind.getR1(),
            "r2", ind.getR2(),
            "r3", ind.getR3(),
            "s1", ind.getS1(),
            "s2", ind.getS2(),
            "s3", ind.getS3()
        ));
}

/**
 * Check if stock is in bullish setup.
 */
public boolean isBullishSetup(String scripCode, String timeframe) {
    return getIndicators(scripCode, timeframe)
        .map(TechnicalIndicatorDTO::isBullish)
        .orElse(false);
}
```

### 4.2 New UnifiedCandleService

**File:** `backend/src/main/java/com/kotsin/dashboard/service/UnifiedCandleService.java`

```java
package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.UnifiedCandleDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Service for fetching unified candles from Redis.
 *
 * ARCHITECTURE:
 * - StreamingCandle Service merges Tick + OB + OI and saves to Redis
 * - Dashboard reads from Redis for unified view
 *
 * Redis Key Patterns:
 * - unified:{symbol}:{tf}:latest     → Latest unified candle
 * - tick:{symbol}:{tf}:latest        → Latest tick candle
 * - ob:{symbol}:latest               → Latest orderbook metrics
 * - oi:{symbol}:latest               → Latest OI metrics
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class UnifiedCandleService {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Key prefixes (should match StreamingCandle)
    private static final String UNIFIED_PREFIX = "unified:";
    private static final String TICK_PREFIX = "tick:";
    private static final String OB_PREFIX = "ob:";
    private static final String OI_PREFIX = "oi:";

    /**
     * Get latest unified candle for a symbol and timeframe.
     */
    public Optional<UnifiedCandleDTO> getLatestCandle(String symbol, String timeframe) {
        // Try unified key first (pre-merged)
        String unifiedKey = UNIFIED_PREFIX + symbol + ":" + timeframe + ":latest";

        try {
            String json = redisTemplate.opsForValue().get(unifiedKey);
            if (json != null && !json.isEmpty()) {
                return Optional.of(objectMapper.readValue(json, UnifiedCandleDTO.class));
            }

            // Fallback: merge from individual sources
            return mergeFromSources(symbol, timeframe);

        } catch (Exception e) {
            log.error("Error fetching unified candle for {}:{}: {}", symbol, timeframe, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Merge candle from individual tick, OB, OI sources.
     */
    private Optional<UnifiedCandleDTO> mergeFromSources(String symbol, String timeframe) {
        try {
            // Get tick candle
            String tickKey = TICK_PREFIX + symbol + ":" + timeframe + ":latest";
            String tickJson = redisTemplate.opsForValue().get(tickKey);

            if (tickJson == null || tickJson.isEmpty()) {
                log.debug("No tick data for {}:{}", symbol, timeframe);
                return Optional.empty();
            }

            // Parse tick and build unified
            Map<String, Object> tick = objectMapper.readValue(tickJson, Map.class);
            UnifiedCandleDTO.UnifiedCandleDTOBuilder builder = UnifiedCandleDTO.builder()
                .symbol(symbol)
                .scripCode((String) tick.get("scripCode"))
                .timeframe(timeframe)
                .open(getDouble(tick, "open"))
                .high(getDouble(tick, "high"))
                .low(getDouble(tick, "low"))
                .close(getDouble(tick, "close"))
                .volume(getLong(tick, "volume"))
                .vwap(getDouble(tick, "vwap"))
                .buyVolume(getLong(tick, "buyVolume"))
                .sellVolume(getLong(tick, "sellVolume"))
                .vpin(getDouble(tick, "vpin"));

            // Try to get orderbook data
            String obKey = OB_PREFIX + symbol + ":latest";
            String obJson = redisTemplate.opsForValue().get(obKey);
            if (obJson != null && !obJson.isEmpty()) {
                Map<String, Object> ob = objectMapper.readValue(obJson, Map.class);
                builder.hasOrderbook(true)
                    .ofi(getDouble(ob, "ofi"))
                    .kyleLambda(getDouble(ob, "kyleLambda"))
                    .microprice(getDouble(ob, "microprice"))
                    .bidAskSpread(getDouble(ob, "bidAskSpread"))
                    .depthImbalance(getDouble(ob, "depthImbalance"));
            }

            // Try to get OI data (for derivatives)
            String oiKey = OI_PREFIX + symbol + ":latest";
            String oiJson = redisTemplate.opsForValue().get(oiKey);
            if (oiJson != null && !oiJson.isEmpty()) {
                Map<String, Object> oi = objectMapper.readValue(oiJson, Map.class);
                builder.hasOI(true)
                    .openInterest(getLong(oi, "openInterest"))
                    .oiChange(getLong(oi, "oiChange"))
                    .oiChangePercent(getDouble(oi, "oiChangePercent"))
                    .oiInterpretation((String) oi.get("oiInterpretation"));
            }

            return Optional.of(builder.build());

        } catch (Exception e) {
            log.error("Error merging candle sources for {}:{}: {}", symbol, timeframe, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Get candle history.
     */
    public List<UnifiedCandleDTO> getCandleHistory(String symbol, String timeframe, int limit) {
        String historyKey = TICK_PREFIX + symbol + ":" + timeframe + ":history";

        try {
            List<String> history = redisTemplate.opsForList().range(historyKey, 0, limit - 1);
            if (history == null || history.isEmpty()) {
                return Collections.emptyList();
            }

            List<UnifiedCandleDTO> candles = new ArrayList<>();
            for (String json : history) {
                try {
                    // Parse as tick candle and convert to unified
                    Map<String, Object> tick = objectMapper.readValue(json, Map.class);
                    candles.add(UnifiedCandleDTO.builder()
                        .symbol(symbol)
                        .timeframe(timeframe)
                        .open(getDouble(tick, "open"))
                        .high(getDouble(tick, "high"))
                        .low(getDouble(tick, "low"))
                        .close(getDouble(tick, "close"))
                        .volume(getLong(tick, "volume"))
                        .vwap(getDouble(tick, "vwap"))
                        .build());
                } catch (Exception e) {
                    log.warn("Failed to parse history entry: {}", e.getMessage());
                }
            }
            return candles;

        } catch (Exception e) {
            log.error("Error fetching candle history: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Get available symbols.
     */
    public Set<String> getAvailableSymbols(String timeframe) {
        Set<String> symbols = new HashSet<>();
        try {
            Set<String> keys = redisTemplate.keys(TICK_PREFIX + "*:" + timeframe + ":latest");
            if (keys != null) {
                for (String key : keys) {
                    // Extract symbol from: tick:{symbol}:{tf}:latest
                    String[] parts = key.split(":");
                    if (parts.length >= 2) {
                        symbols.add(parts[1]);
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error getting available symbols: {}", e.getMessage());
        }
        return symbols;
    }

    // Helper methods
    private Double getDouble(Map<String, Object> map, String key) {
        Object val = map.get(key);
        if (val == null) return null;
        if (val instanceof Number) return ((Number) val).doubleValue();
        return null;
    }

    private Long getLong(Map<String, Object> map, String key) {
        Object val = map.get(key);
        if (val == null) return null;
        if (val instanceof Number) return ((Number) val).longValue();
        return null;
    }
}
```

### 4.3 New StrategyStateService

**File:** `backend/src/main/java/com/kotsin/dashboard/service/StrategyStateService.java`

```java
package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Service for fetching strategy state (VCP, IPU, Pivot) from Redis.
 *
 * Redis Key Pattern: strategy:{symbol}:{type}:{tf}
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class StrategyStateService {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String STRATEGY_PREFIX = "strategy:";

    /**
     * Get VCP state for a symbol.
     */
    public Optional<VcpStateDTO> getVcpState(String symbol, String timeframe) {
        String key = STRATEGY_PREFIX + symbol + ":VCP:" + timeframe;
        return getState(key, VcpStateDTO.class);
    }

    /**
     * Get IPU state for a symbol.
     */
    public Optional<IpuStateDTO> getIpuState(String symbol, String timeframe) {
        String key = STRATEGY_PREFIX + symbol + ":IPU:" + timeframe;
        return getState(key, IpuStateDTO.class);
    }

    /**
     * Get Pivot state for a symbol.
     */
    public Optional<PivotStateDTO> getPivotState(String symbol, String timeframe) {
        String key = STRATEGY_PREFIX + symbol + ":PIVOT:" + timeframe;
        return getState(key, PivotStateDTO.class);
    }

    /**
     * Get full strategy state for a symbol.
     */
    public Optional<StrategyStateDTO> getFullState(String symbol, String timeframe) {
        Optional<VcpStateDTO> vcp = getVcpState(symbol, timeframe);
        Optional<IpuStateDTO> ipu = getIpuState(symbol, timeframe);
        Optional<PivotStateDTO> pivot = getPivotState(symbol, timeframe);

        if (vcp.isEmpty() && ipu.isEmpty() && pivot.isEmpty()) {
            return Optional.empty();
        }

        return Optional.of(StrategyStateDTO.builder()
            .symbol(symbol)
            .timeframe(timeframe)
            .vcpState(vcp.orElse(null))
            .ipuState(ipu.orElse(null))
            .pivotState(pivot.orElse(null))
            .build());
    }

    /**
     * Get symbols with high IPU score.
     */
    public List<String> getSymbolsWithHighIpu(String timeframe, double minScore) {
        List<String> result = new ArrayList<>();
        try {
            Set<String> keys = redisTemplate.keys(STRATEGY_PREFIX + "*:IPU:" + timeframe);
            if (keys != null) {
                for (String key : keys) {
                    try {
                        String json = redisTemplate.opsForValue().get(key);
                        if (json != null) {
                            IpuStateDTO state = objectMapper.readValue(json, IpuStateDTO.class);
                            if (state.getCurrentIpuScore() != null && state.getCurrentIpuScore() >= minScore) {
                                // Extract symbol from key
                                String[] parts = key.split(":");
                                if (parts.length >= 2) {
                                    result.add(parts[1]);
                                }
                            }
                        }
                    } catch (Exception e) {
                        log.warn("Failed to parse IPU state: {}", e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error getting high IPU symbols: {}", e.getMessage());
        }
        return result;
    }

    /**
     * Get symbols with active VCP setup.
     */
    public List<String> getSymbolsWithActiveVcp(String timeframe) {
        List<String> result = new ArrayList<>();
        try {
            Set<String> keys = redisTemplate.keys(STRATEGY_PREFIX + "*:VCP:" + timeframe);
            if (keys != null) {
                for (String key : keys) {
                    try {
                        String json = redisTemplate.opsForValue().get(key);
                        if (json != null) {
                            VcpStateDTO state = objectMapper.readValue(json, VcpStateDTO.class);
                            // Consider "active" if has both support and resistance clusters
                            if (state.getSupportClusters() != null && !state.getSupportClusters().isEmpty() &&
                                state.getResistanceClusters() != null && !state.getResistanceClusters().isEmpty()) {
                                String[] parts = key.split(":");
                                if (parts.length >= 2) {
                                    result.add(parts[1]);
                                }
                            }
                        }
                    } catch (Exception e) {
                        log.warn("Failed to parse VCP state: {}", e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error getting active VCP symbols: {}", e.getMessage());
        }
        return result;
    }

    /**
     * Get strategy state counts.
     */
    public Map<String, Long> getStateCounts(String timeframe) {
        Map<String, Long> counts = new HashMap<>();
        try {
            Set<String> vcpKeys = redisTemplate.keys(STRATEGY_PREFIX + "*:VCP:" + timeframe);
            Set<String> ipuKeys = redisTemplate.keys(STRATEGY_PREFIX + "*:IPU:" + timeframe);
            Set<String> pivotKeys = redisTemplate.keys(STRATEGY_PREFIX + "*:PIVOT:" + timeframe);

            counts.put("vcp", (long) (vcpKeys != null ? vcpKeys.size() : 0));
            counts.put("ipu", (long) (ipuKeys != null ? ipuKeys.size() : 0));
            counts.put("pivot", (long) (pivotKeys != null ? pivotKeys.size() : 0));
        } catch (Exception e) {
            log.error("Error getting state counts: {}", e.getMessage());
        }
        return counts;
    }

    // Generic helper
    private <T> Optional<T> getState(String key, Class<T> clazz) {
        try {
            String json = redisTemplate.opsForValue().get(key);
            if (json == null || json.isEmpty()) {
                return Optional.empty();
            }
            return Optional.of(objectMapper.readValue(json, clazz));
        } catch (Exception e) {
            log.error("Error reading state from Redis key {}: {}", key, e.getMessage());
            return Optional.empty();
        }
    }
}
```

---

## 5. REDIS KEY PATTERN UPDATES

### Current vs New Key Patterns

| Purpose | Current Key | New Key | Action |
|---------|-------------|---------|--------|
| Technical Indicators | `tech:indicator:{scripCode}:{tf}` | Same | Keep (verify format) |
| Technical History | `tech:indicator:history:{scripCode}:{tf}` | Same | Keep |
| Tick Candles | N/A | `tick:{symbol}:{tf}:latest` | **ADD** |
| Tick History | N/A | `tick:{symbol}:{tf}:history` | **ADD** |
| Orderbook | N/A | `ob:{symbol}:latest` | **ADD** |
| OI Metrics | N/A | `oi:{symbol}:latest` | **ADD** |
| Unified Candle | N/A | `unified:{symbol}:{tf}:latest` | **ADD** |
| VCP State | N/A | `strategy:{symbol}:VCP:{tf}` | **ADD** |
| IPU State | N/A | `strategy:{symbol}:IPU:{tf}` | **ADD** |
| Pivot State | N/A | `strategy:{symbol}:PIVOT:{tf}` | **ADD** |
| Family Score | `family:score:{familyId}` | Same | Keep |
| Quant Score | `quant:score:{familyId}` | Same | Keep |

### Configuration Update

**File:** `backend/src/main/resources/application.yml`

```yaml
# Add Redis key prefixes configuration
redis:
  key-prefixes:
    technical-indicator: "tech:indicator:"
    technical-indicator-history: "tech:indicator:history:"
    tick-candle: "tick:"
    orderbook: "ob:"
    oi-metrics: "oi:"
    unified-candle: "unified:"
    strategy-state: "strategy:"
    family-score: "family:score:"
    quant-score: "quant:score:"
  ttl:
    candle-latest: 300        # 5 minutes
    candle-history: 86400     # 24 hours
    strategy-state: 1800      # 30 minutes
```

---

## 6. NEW REST CONTROLLERS

### 6.1 Update TechnicalIndicatorController

**Add new endpoints:**

```java
// Add to TechnicalIndicatorController.java

/**
 * Get moving averages only.
 * GET /api/technical-indicators/{scripCode}/moving-averages?timeframe=5m
 */
@GetMapping("/{scripCode}/moving-averages")
public ResponseEntity<Map<String, Double>> getMovingAverages(
        @PathVariable String scripCode,
        @RequestParam(defaultValue = "5m") String timeframe) {
    return technicalIndicatorService.getMovingAverages(scripCode, timeframe)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
}

/**
 * Get momentum indicators (RSI, MACD, Stochastic).
 * GET /api/technical-indicators/{scripCode}/momentum?timeframe=5m
 */
@GetMapping("/{scripCode}/momentum")
public ResponseEntity<Map<String, Object>> getMomentumIndicators(
        @PathVariable String scripCode,
        @RequestParam(defaultValue = "5m") String timeframe) {
    return technicalIndicatorService.getMomentumIndicators(scripCode, timeframe)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
}

/**
 * Get trend indicators (SuperTrend, ADX).
 * GET /api/technical-indicators/{scripCode}/trend?timeframe=5m
 */
@GetMapping("/{scripCode}/trend")
public ResponseEntity<Map<String, Object>> getTrendIndicators(
        @PathVariable String scripCode,
        @RequestParam(defaultValue = "5m") String timeframe) {
    return technicalIndicatorService.getTrendIndicators(scripCode, timeframe)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
}

/**
 * Get pivot points.
 * GET /api/technical-indicators/{scripCode}/pivots?timeframe=5m
 */
@GetMapping("/{scripCode}/pivots")
public ResponseEntity<Map<String, Double>> getPivotPoints(
        @PathVariable String scripCode,
        @RequestParam(defaultValue = "5m") String timeframe) {
    return technicalIndicatorService.getPivotPoints(scripCode, timeframe)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
}

/**
 * Get bullish setups (filtered list).
 * GET /api/technical-indicators/bullish-setups?timeframe=5m
 */
@GetMapping("/bullish-setups")
public ResponseEntity<List<TechnicalIndicatorDTO>> getBullishSetups(
        @RequestParam(defaultValue = "5m") String timeframe,
        @RequestParam(defaultValue = "20") int limit) {
    Map<String, TechnicalIndicatorDTO> all = technicalIndicatorService.getAllIndicators(timeframe);
    List<TechnicalIndicatorDTO> bullish = all.values().stream()
            .filter(TechnicalIndicatorDTO::isBullish)
            .limit(limit)
            .toList();
    return ResponseEntity.ok(bullish);
}
```

### 6.2 New UnifiedCandleController

**File:** `backend/src/main/java/com/kotsin/dashboard/controller/UnifiedCandleController.java`

```java
package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.UnifiedCandleDTO;
import com.kotsin.dashboard.service.UnifiedCandleService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * REST API for unified candles (Tick + Orderbook + OI merged view).
 *
 * Endpoints:
 * - GET  /api/candles/{symbol}?timeframe=5m
 * - GET  /api/candles/{symbol}/history?timeframe=5m&limit=100
 * - POST /api/candles/batch?timeframe=5m
 * - GET  /api/candles/available?timeframe=5m
 */
@RestController
@RequestMapping("/api/candles")
@RequiredArgsConstructor
@Slf4j
public class UnifiedCandleController {

    private final UnifiedCandleService unifiedCandleService;

    /**
     * Get latest unified candle for a symbol.
     */
    @GetMapping("/{symbol}")
    public ResponseEntity<UnifiedCandleDTO> getLatestCandle(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {
        return unifiedCandleService.getLatestCandle(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get candle history.
     */
    @GetMapping("/{symbol}/history")
    public ResponseEntity<List<UnifiedCandleDTO>> getCandleHistory(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe,
            @RequestParam(defaultValue = "100") int limit) {
        List<UnifiedCandleDTO> history = unifiedCandleService.getCandleHistory(
                symbol, timeframe, Math.min(limit, 500));
        if (history.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(history);
    }

    /**
     * Batch fetch latest candles.
     */
    @PostMapping("/batch")
    public ResponseEntity<Map<String, UnifiedCandleDTO>> getBatchCandles(
            @RequestBody List<String> symbols,
            @RequestParam(defaultValue = "5m") String timeframe) {
        if (symbols == null || symbols.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        // Limit batch size
        if (symbols.size() > 100) {
            symbols = symbols.subList(0, 100);
        }
        Map<String, UnifiedCandleDTO> result = new java.util.HashMap<>();
        for (String symbol : symbols) {
            unifiedCandleService.getLatestCandle(symbol, timeframe)
                    .ifPresent(candle -> result.put(symbol, candle));
        }
        return ResponseEntity.ok(result);
    }

    /**
     * Get available symbols with candle data.
     */
    @GetMapping("/available")
    public ResponseEntity<Set<String>> getAvailableSymbols(
            @RequestParam(defaultValue = "5m") String timeframe) {
        return ResponseEntity.ok(unifiedCandleService.getAvailableSymbols(timeframe));
    }
}
```

### 6.3 New StrategyStateController

**File:** `backend/src/main/java/com/kotsin/dashboard/controller/StrategyStateController.java`

```java
package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.*;
import com.kotsin.dashboard.service.StrategyStateService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST API for strategy state (VCP, IPU, Pivot).
 */
@RestController
@RequestMapping("/api/strategy-state")
@RequiredArgsConstructor
@Slf4j
public class StrategyStateController {

    private final StrategyStateService strategyStateService;

    /**
     * Get VCP state for a symbol.
     */
    @GetMapping("/{symbol}/vcp")
    public ResponseEntity<VcpStateDTO> getVcpState(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {
        return strategyStateService.getVcpState(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get IPU state for a symbol.
     */
    @GetMapping("/{symbol}/ipu")
    public ResponseEntity<IpuStateDTO> getIpuState(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {
        return strategyStateService.getIpuState(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get Pivot state for a symbol.
     */
    @GetMapping("/{symbol}/pivot")
    public ResponseEntity<PivotStateDTO> getPivotState(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {
        return strategyStateService.getPivotState(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get full strategy state (VCP + IPU + Pivot).
     */
    @GetMapping("/{symbol}")
    public ResponseEntity<StrategyStateDTO> getFullState(
            @PathVariable String symbol,
            @RequestParam(defaultValue = "5m") String timeframe) {
        return strategyStateService.getFullState(symbol, timeframe)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Get symbols with high IPU score.
     */
    @GetMapping("/high-ipu")
    public ResponseEntity<List<String>> getHighIpuSymbols(
            @RequestParam(defaultValue = "5m") String timeframe,
            @RequestParam(defaultValue = "0.7") double minScore) {
        return ResponseEntity.ok(strategyStateService.getSymbolsWithHighIpu(timeframe, minScore));
    }

    /**
     * Get symbols with active VCP setup.
     */
    @GetMapping("/active-vcp")
    public ResponseEntity<List<String>> getActiveVcpSymbols(
            @RequestParam(defaultValue = "5m") String timeframe) {
        return ResponseEntity.ok(strategyStateService.getSymbolsWithActiveVcp(timeframe));
    }

    /**
     * Get strategy state counts.
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Long>> getStateCounts(
            @RequestParam(defaultValue = "5m") String timeframe) {
        return ResponseEntity.ok(strategyStateService.getStateCounts(timeframe));
    }
}
```

---

## 7. KAFKA CONSUMER UPDATES

### 7.1 New TickCandleConsumer (Optional)

If StreamingCandle publishes tick candles to Kafka (in addition to Redis):

**File:** `backend/src/main/java/com/kotsin/dashboard/kafka/TickCandleConsumer.java`

```java
package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Kafka consumer for tick candle updates.
 * Optional - only if real-time WebSocket broadcast is needed.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class TickCandleConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @KafkaListener(
        topics = {"tick-candles-1m"},
        groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onTickCandle(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            String symbol = root.path("symbol").asText();

            if (symbol == null || symbol.isEmpty()) {
                return;
            }

            // Broadcast to WebSocket for real-time charts
            sessionManager.broadcastCandleUpdate(symbol, root);

        } catch (Exception e) {
            log.error("Error processing tick candle: {}", e.getMessage());
        }
    }
}
```

### 7.2 Update FamilyCandleConsumer

**Changes:** Add new fields from streaming candle refactoring

```java
// In parseFamilyScore() method, ADD:

// MTIS fields (if available)
builder.mtis(root.path("mtis").asDouble(0))
       .mtisLabel(root.path("mtisLabel").asText("NEUTRAL"))
       .mtisTrend(root.path("mtisTrend").asText("STABLE"))
       .rawMtis(root.path("rawMtis").asDouble(0))
       .previousMtis(root.path("previousMtis").asDouble(0))
       .mtisChange(root.path("mtisChange").asDouble(0));

// Modifiers
builder.sessionModifier(root.path("sessionModifier").asDouble(1.0))
       .cprModifier(root.path("cprModifier").asDouble(1.0))
       .expiryModifier(root.path("expiryModifier").asDouble(1.0));

// Flags
builder.hasDivergence(root.path("hasDivergence").asBoolean(false))
       .hasExhaustion(root.path("hasExhaustion").asBoolean(false))
       .actionable(root.path("actionable").asBoolean(false))
       .fudkiiIgnition(root.path("fudkiiIgnition").asBoolean(false))
       .cprWidth(root.path("cprWidth").asText("NORMAL"))
       .expiryDay(root.path("expiryDay").asBoolean(false))
       .sessionPhase(root.path("sessionPhase").asText("TRADING"));
```

---

## 8. WEBSOCKET UPDATES

### 8.1 Add New Broadcast Methods

**File:** `backend/src/main/java/com/kotsin/dashboard/websocket/WebSocketSessionManager.java`

```java
// ADD these methods:

/**
 * Broadcast candle update (for real-time charts).
 */
public void broadcastCandleUpdate(String symbol, JsonNode candle) {
    Map<String, Object> message = Map.of(
        "type", "CANDLE_UPDATE",
        "symbol", symbol,
        "data", candle,
        "timestamp", System.currentTimeMillis()
    );
    broadcast("/topic/candles/" + symbol, message);
    broadcast("/topic/candles", message);
}

/**
 * Broadcast strategy state update.
 */
public void broadcastStrategyState(String symbol, String strategyType, Object state) {
    Map<String, Object> message = Map.of(
        "type", "STRATEGY_STATE",
        "symbol", symbol,
        "strategyType", strategyType,
        "data", state,
        "timestamp", System.currentTimeMillis()
    );
    broadcast("/topic/strategy/" + symbol + "/" + strategyType.toLowerCase(), message);
    broadcast("/topic/strategy/" + symbol, message);
}

/**
 * Broadcast technical indicators update.
 */
public void broadcastTechnicalIndicators(String scripCode, TechnicalIndicatorDTO indicators) {
    Map<String, Object> message = Map.of(
        "type", "TECHNICAL_INDICATORS",
        "scripCode", scripCode,
        "data", indicators,
        "timestamp", System.currentTimeMillis()
    );
    broadcast("/topic/technical-indicators/" + scripCode, message);
}
```

### 8.2 New WebSocket Topics

Add these topics to the documentation/config:

```
/topic/candles/{symbol}               → Real-time candle updates
/topic/candles                        → All candle updates
/topic/strategy/{symbol}/vcp          → VCP state updates
/topic/strategy/{symbol}/ipu          → IPU state updates
/topic/strategy/{symbol}/pivot        → Pivot state updates
/topic/strategy/{symbol}              → All strategy updates for symbol
/topic/technical-indicators/{scripCode} → Full technical indicators
```

---

## 9. FRONTEND TYPE UPDATES

### 9.1 Update TechnicalIndicatorDTO

**File:** `frontend/src/types/indicators.ts`

```typescript
// Expanded TechnicalIndicatorDTO to match backend
export interface TechnicalIndicatorDTO {
  scripCode: string;
  symbol: string;
  companyName: string;
  timeframe: string;
  timestamp: number;
  currentPrice: number;

  // ==================== MOVING AVERAGES (NEW) ====================
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  vwma20: number | null;

  // ==================== RSI (NEW) ====================
  rsi14: number | null;
  rsiSmoothed: number | null;
  rsiZone: 'OVERSOLD' | 'NEUTRAL' | 'OVERBOUGHT' | null;

  // ==================== MACD (NEW) ====================
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  macdCrossover: 'BULLISH_CROSS' | 'BEARISH_CROSS' | 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;

  // ==================== BOLLINGER BANDS ====================
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  bbWidthPct: number | null;
  bbPercentB: number | null;
  bbSqueeze: boolean | null;
  bbPosition: 'ABOVE_UPPER' | 'UPPER_HALF' | 'MIDDLE' | 'LOWER_HALF' | 'BELOW_LOWER' | null;

  // ==================== VWAP ====================
  vwap: number | null;
  vwapUpperBand: number | null;
  vwapLowerBand: number | null;
  vwapStdDev: number | null;
  vwapSignal: string | null;
  vwapDeviation: number | null;

  // ==================== ATR ====================
  atr: number | null;
  atrPercent: number | null;
  atrMultiple: number | null;

  // ==================== SUPERTREND ====================
  superTrendValue: number | null;
  superTrendDirection: 'UP' | 'DOWN' | 'BULLISH' | 'BEARISH' | null;
  superTrendReversal: boolean | null;
  candlesSinceFlip: number | null;

  // ==================== ADX (NEW) ====================
  adx14: number | null;
  plusDI: number | null;
  minusDI: number | null;
  trendStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NO_TREND' | null;

  // ==================== STOCHASTIC (NEW) ====================
  stochK: number | null;
  stochD: number | null;
  stochZone: 'OVERSOLD' | 'NEUTRAL' | 'OVERBOUGHT' | null;

  // ==================== PIVOT POINTS (NEW) ====================
  pivotPoint: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;

  // ==================== VOLUME (NEW) ====================
  volume: number | null;
  avgVolume20: number | null;
  volumeRatio: number | null;

  // ==================== DERIVED SIGNALS (NEW) ====================
  goldenCross: boolean | null;
  deathCross: boolean | null;
  priceAboveEma21: boolean | null;
  priceAboveEma50: boolean | null;
  priceAboveSuperTrend: boolean | null;
  macdBullish: boolean | null;
  rsiBullish: boolean | null;

  // ==================== DATA QUALITY ====================
  dataQualitySufficient: boolean | null;
  actualCandleCount: number | null;
  requiredCandleCount: number | null;
}
```

### 9.2 Add New Types

**File:** `frontend/src/types/candles.ts` (NEW FILE)

```typescript
export interface UnifiedCandleDTO {
  symbol: string;
  scripCode: string;
  exchange: string;
  exchangeType: string;
  companyName: string;
  instrumentType: 'INDEX' | 'EQUITY' | 'FUTURE' | 'OPTION_CE' | 'OPTION_PE';
  timeframe: string;

  // Timing
  timestamp: string;
  windowStart: string;
  windowEnd: string;

  // OHLCV
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  value: number;
  vwap: number;

  // Trade Classification
  buyVolume: number;
  sellVolume: number;
  volumeDelta: number;
  buyPressure: number;
  sellPressure: number;

  // Volume Profile
  vpin: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;

  // Orderbook (optional)
  hasOrderbook: boolean;
  ofi: number | null;
  kyleLambda: number | null;
  microprice: number | null;
  bidAskSpread: number | null;
  depthImbalance: number | null;

  // OI (optional)
  hasOI: boolean;
  openInterest: number | null;
  oiChange: number | null;
  oiChangePercent: number | null;
  oiInterpretation: 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWINDING' | 'NEUTRAL' | null;

  // Quality
  quality: string;
  completenessRatio: number;
}
```

### 9.3 Update API Service

**File:** `frontend/src/services/api.ts`

```typescript
// ADD new API clients

// Unified Candles API
export const candlesApi = {
  getLatest: (symbol: string, timeframe: string = '5m') =>
    fetchJson<UnifiedCandleDTO>(`/candles/${symbol}?timeframe=${timeframe}`),

  getHistory: (symbol: string, timeframe: string = '5m', limit: number = 100) =>
    fetchJson<UnifiedCandleDTO[]>(`/candles/${symbol}/history?timeframe=${timeframe}&limit=${limit}`),

  getBatch: (symbols: string[], timeframe: string = '5m') =>
    postJson<Record<string, UnifiedCandleDTO>>(`/candles/batch?timeframe=${timeframe}`, symbols),

  getAvailable: (timeframe: string = '5m') =>
    fetchJson<string[]>(`/candles/available?timeframe=${timeframe}`),
}

// Strategy State API
export const strategyStateApi = {
  getVcpState: (symbol: string, timeframe: string = '5m') =>
    fetchJson<VcpStateDTO>(`/strategy-state/${symbol}/vcp?timeframe=${timeframe}`),

  getIpuState: (symbol: string, timeframe: string = '5m') =>
    fetchJson<IpuStateDTO>(`/strategy-state/${symbol}/ipu?timeframe=${timeframe}`),

  getPivotState: (symbol: string, timeframe: string = '5m') =>
    fetchJson<PivotStateDTO>(`/strategy-state/${symbol}/pivot?timeframe=${timeframe}`),

  getFullState: (symbol: string, timeframe: string = '5m') =>
    fetchJson<StrategyStateDTO>(`/strategy-state/${symbol}?timeframe=${timeframe}`),

  getHighIpuSymbols: (timeframe: string = '5m', minScore: number = 0.7) =>
    fetchJson<string[]>(`/strategy-state/high-ipu?timeframe=${timeframe}&minScore=${minScore}`),

  getActiveVcpSymbols: (timeframe: string = '5m') =>
    fetchJson<string[]>(`/strategy-state/active-vcp?timeframe=${timeframe}`),

  getStats: (timeframe: string = '5m') =>
    fetchJson<Record<string, number>>(`/strategy-state/stats?timeframe=${timeframe}`),
}

// Enhanced Technical Indicators API
export const technicalIndicatorsApiV2 = {
  ...technicalIndicatorsApi,

  getMovingAverages: (scripCode: string, timeframe: string = '5m') =>
    fetchJson<Record<string, number>>(`/technical-indicators/${scripCode}/moving-averages?timeframe=${timeframe}`),

  getMomentum: (scripCode: string, timeframe: string = '5m') =>
    fetchJson<Record<string, any>>(`/technical-indicators/${scripCode}/momentum?timeframe=${timeframe}`),

  getTrend: (scripCode: string, timeframe: string = '5m') =>
    fetchJson<Record<string, any>>(`/technical-indicators/${scripCode}/trend?timeframe=${timeframe}`),

  getPivots: (scripCode: string, timeframe: string = '5m') =>
    fetchJson<Record<string, number>>(`/technical-indicators/${scripCode}/pivots?timeframe=${timeframe}`),

  getBullishSetups: (timeframe: string = '5m', limit: number = 20) =>
    fetchJson<TechnicalIndicatorDTO[]>(`/technical-indicators/bullish-setups?timeframe=${timeframe}&limit=${limit}`),
}
```

---

## 10. CONFIGURATION CHANGES

### 10.1 Application Properties

**File:** `backend/src/main/resources/application.yml`

```yaml
# StreamingCandle Integration
streaming-candle:
  redis:
    key-prefixes:
      tick: "tick:"
      orderbook: "ob:"
      oi: "oi:"
      unified: "unified:"
      strategy: "strategy:"
      technical: "tech:indicator:"
    ttl:
      latest: 300          # 5 minutes
      history: 86400       # 24 hours
      strategy: 1800       # 30 minutes

  kafka:
    topics:
      tick-candles: "tick-candles-1m"
      orderbook-metrics: "orderbook-metrics-1m"
      oi-metrics: "oi-metrics-1m"
      strategy-state: "strategy-state"
```

### 10.2 Kafka Consumer Configuration

If consuming new topics, update `KafkaConfig.java`:

```java
// Add topic listener configuration
@Bean
public ConcurrentKafkaListenerContainerFactory<String, String> batchKafkaListenerContainerFactory() {
    ConcurrentKafkaListenerContainerFactory<String, String> factory =
        new ConcurrentKafkaListenerContainerFactory<>();
    factory.setConsumerFactory(consumerFactory());
    factory.setBatchListener(true);  // For batch processing of candles
    factory.setConcurrency(3);
    return factory;
}
```

---

## 11. IMPLEMENTATION PRIORITY

### Phase 1: Critical (Week 1)

| Task | Files | Effort |
|------|-------|--------|
| Expand TechnicalIndicatorDTO | `TechnicalIndicatorDTO.java`, `indicators.ts` | 4h |
| Update TechnicalIndicatorService | `TechnicalIndicatorService.java` | 2h |
| Add new TechnicalIndicator endpoints | `TechnicalIndicatorController.java` | 2h |
| Update frontend normalizeIndicators() | `indicators.ts` | 2h |

### Phase 2: High (Week 2)

| Task | Files | Effort |
|------|-------|--------|
| Create UnifiedCandleDTO | `UnifiedCandleDTO.java` | 2h |
| Create UnifiedCandleService | `UnifiedCandleService.java` | 4h |
| Create UnifiedCandleController | `UnifiedCandleController.java` | 2h |
| Create frontend candles API | `api.ts`, `candles.ts` | 2h |

### Phase 3: Medium (Week 3)

| Task | Files | Effort |
|------|-------|--------|
| Create Strategy State DTOs | `VcpStateDTO.java`, `IpuStateDTO.java`, `PivotStateDTO.java` | 3h |
| Create StrategyStateService | `StrategyStateService.java` | 4h |
| Create StrategyStateController | `StrategyStateController.java` | 2h |
| Create frontend strategy API | `api.ts` | 2h |

### Phase 4: Low (Week 4)

| Task | Files | Effort |
|------|-------|--------|
| Add Kafka consumers (if needed) | `TickCandleConsumer.java` | 2h |
| Update WebSocket broadcasts | `WebSocketSessionManager.java` | 2h |
| Update FamilyCandleConsumer | `FamilyCandleConsumer.java` | 2h |
| Configuration updates | `application.yml` | 1h |

---

## SUMMARY

### Total Files to Modify/Create

| Category | New Files | Modified Files |
|----------|-----------|----------------|
| DTOs | 6 | 1 |
| Services | 2 | 1 |
| Controllers | 2 | 1 |
| Kafka Consumers | 1 (optional) | 1 |
| WebSocket | 0 | 1 |
| Frontend Types | 1 | 1 |
| Frontend API | 0 | 1 |
| Configuration | 0 | 1 |
| **TOTAL** | **12** | **8** |

### Estimated Total Effort

- Phase 1 (Critical): 10 hours
- Phase 2 (High): 10 hours
- Phase 3 (Medium): 11 hours
- Phase 4 (Low): 7 hours
- **Total**: ~38 hours / ~1 week full-time

---

*Document generated by Claude (Opus 4.5) - 2026-02-01*
