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

    // ==================== MOVING AVERAGES ====================
    private Double ema9;
    private Double ema21;
    private Double ema50;
    private Double ema200;
    private Double sma20;
    private Double sma50;
    private Double sma200;
    private Double vwma20;      // Volume Weighted MA

    // ==================== RSI ====================
    private Double rsi14;
    private Double rsiSmoothed;
    private String rsiZone;     // "OVERSOLD", "NEUTRAL", "OVERBOUGHT"

    // ==================== MACD ====================
    private Double macdLine;        // EMA12 - EMA26
    private Double macdSignal;      // EMA9 of MACD
    private Double macdHistogram;   // MACD - Signal
    private String macdCrossover;   // "BULLISH_CROSS", "BEARISH_CROSS", "BULLISH", "BEARISH", "NEUTRAL"

    // ==================== BOLLINGER BANDS ====================
    private Double bbUpper;
    private Double bbMiddle;
    private Double bbLower;
    private Double bbWidth;
    private Double bbWidthPct;
    private Double bbPercentB;
    private Boolean bbSqueeze;
    private String bbPosition;      // "ABOVE_UPPER", "UPPER_HALF", "MIDDLE", "LOWER_HALF", "BELOW_LOWER"

    // ==================== VWAP ====================
    private Double vwap;
    private Double vwapUpperBand;
    private Double vwapLowerBand;
    private Double vwapStdDev;
    private String vwapSignal;      // ABOVE_UPPER, ABOVE_VWAP, BELOW_VWAP, BELOW_LOWER, NEUTRAL
    private Double vwapDeviation;

    // ==================== ATR ====================
    private Double atr;             // atr14
    private Double atrPercent;      // ATR as % of price
    private Double atrMultiple;     // Current range / ATR

    // ==================== SUPERTREND ====================
    private Double superTrendValue;
    private String superTrendDirection;     // "UP", "DOWN" (or "BULLISH", "BEARISH")
    private Boolean superTrendReversal;     // superTrendFlip
    private Integer candlesSinceFlip;

    // ==================== ADX ====================
    private Double adx14;
    private Double plusDI;
    private Double minusDI;
    private String trendStrength;   // "STRONG", "MODERATE", "WEAK", "NO_TREND"

    // ==================== STOCHASTIC ====================
    private Double stochK;
    private Double stochD;
    private String stochZone;       // "OVERSOLD", "NEUTRAL", "OVERBOUGHT"

    // ==================== PIVOT POINTS ====================
    private Double pivotPoint;
    private Double r1;              // Resistance 1
    private Double r2;              // Resistance 2
    private Double r3;              // Resistance 3
    private Double s1;              // Support 1
    private Double s2;              // Support 2
    private Double s3;              // Support 3

    // ==================== VOLUME ====================
    private Double volume;
    private Double avgVolume20;
    private Double volumeRatio;     // Current volume / avg volume

    // ==================== DERIVED SIGNALS ====================
    private Boolean goldenCross;            // EMA50 crosses above EMA200
    private Boolean deathCross;             // EMA50 crosses below EMA200
    private Boolean priceAboveEma21;
    private Boolean priceAboveEma50;
    private Boolean priceAboveSuperTrend;
    private Boolean macdBullish;
    private Boolean rsiBullish;

    // ==================== DATA QUALITY ====================
    private Boolean dataQualitySufficient;
    private Integer actualCandleCount;
    private Integer requiredCandleCount;

    // ==================== HELPER METHODS ====================

    /**
     * Check if overall trend is bullish.
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
     * Check if overall trend is bearish.
     */
    public boolean isBearish() {
        int count = 0;
        if (Boolean.FALSE.equals(priceAboveEma21) || priceAboveEma21 == null) count++;
        if (Boolean.FALSE.equals(priceAboveSuperTrend) || priceAboveSuperTrend == null) count++;
        if (Boolean.FALSE.equals(macdBullish) || macdBullish == null) count++;
        if (Boolean.FALSE.equals(rsiBullish) || rsiBullish == null) count++;
        if (rsiZone != null && !"OVERSOLD".equals(rsiZone)) count++;
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
     * Check if in low volatility state (squeeze).
     */
    public boolean isLowVolatility() {
        return (atrPercent != null && atrPercent < 0.5) ||
               (bbWidthPct != null && bbWidthPct < 2.0) ||
               Boolean.TRUE.equals(bbSqueeze);
    }

    /**
     * Check if trending (ADX > 20).
     */
    public boolean isTrending() {
        return "STRONG".equals(trendStrength) || "MODERATE".equals(trendStrength);
    }

    /**
     * Get trend direction based on ADX +DI/-DI.
     */
    public String getTrendDirection() {
        if (!isTrending()) return "SIDEWAYS";
        if (plusDI != null && minusDI != null) {
            return plusDI > minusDI ? "BULLISH" : "BEARISH";
        }
        return "UNKNOWN";
    }

    /**
     * Check if RSI is in oversold territory.
     */
    public boolean isOversold() {
        return "OVERSOLD".equals(rsiZone) || "OVERSOLD".equals(stochZone);
    }

    /**
     * Check if RSI is in overbought territory.
     */
    public boolean isOverbought() {
        return "OVERBOUGHT".equals(rsiZone) || "OVERBOUGHT".equals(stochZone);
    }

    /**
     * Get nearest support level.
     */
    public Double getNearestSupport() {
        if (currentPrice == null) return s1;
        if (s1 != null && currentPrice > s1) return s1;
        if (s2 != null && currentPrice > s2) return s2;
        if (s3 != null && currentPrice > s3) return s3;
        return null;
    }

    /**
     * Get nearest resistance level.
     */
    public Double getNearestResistance() {
        if (currentPrice == null) return r1;
        if (r1 != null && currentPrice < r1) return r1;
        if (r2 != null && currentPrice < r2) return r2;
        if (r3 != null && currentPrice < r3) return r3;
        return null;
    }
}
