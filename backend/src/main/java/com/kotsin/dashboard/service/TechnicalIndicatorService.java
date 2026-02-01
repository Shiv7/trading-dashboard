package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.TechnicalIndicatorDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Service for fetching technical indicators from Redis.
 *
 * ARCHITECTURE:
 * - Streaming Candle Service calculates indicators and saves to Redis
 * - Dashboard Backend reads from Redis and displays to frontend
 * - This ensures strategy and dashboard see the SAME values
 *
 * Redis Key Pattern: tech:indicator:{scripCode}:{timeframe}
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class TechnicalIndicatorService {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String KEY_PREFIX = "tech:indicator:";

    /**
     * Get technical indicators for a scripCode and timeframe from Redis.
     */
    public Optional<TechnicalIndicatorDTO> getIndicators(String scripCode, String timeframe) {
        String key = KEY_PREFIX + scripCode + ":" + timeframe;

        try {
            String json = redisTemplate.opsForValue().get(key);

            if (json == null || json.isEmpty()) {
                log.debug("No indicator data in Redis for key: {}", key);
                return Optional.empty();
            }

            TechnicalIndicatorDTO dto = objectMapper.readValue(json, TechnicalIndicatorDTO.class);
            log.trace("Fetched indicator from Redis: {} -> {}", key, dto.getCurrentPrice());
            return Optional.of(dto);

        } catch (Exception e) {
            log.error("Error reading indicator from Redis key {}: {}", key, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Get indicator history for charts from Redis.
     * Key pattern: tech:indicator:history:{scripCode}:{timeframe}
     */
    public List<TechnicalIndicatorDTO> getIndicatorHistory(String scripCode, String timeframe, int limit) {
        String historyKey = "tech:indicator:history:" + scripCode + ":" + timeframe;

        try {
            // Try to get history list from Redis
            List<String> historyJson = redisTemplate.opsForList().range(historyKey, -limit, -1);

            if (historyJson == null || historyJson.isEmpty()) {
                // Fallback: return current indicator as single-item history
                return getIndicators(scripCode, timeframe)
                        .map(Collections::singletonList)
                        .orElse(Collections.emptyList());
            }

            List<TechnicalIndicatorDTO> history = new ArrayList<>();
            for (String json : historyJson) {
                try {
                    history.add(objectMapper.readValue(json, TechnicalIndicatorDTO.class));
                } catch (Exception e) {
                    log.warn("Failed to parse history entry: {}", e.getMessage());
                }
            }

            return history;

        } catch (Exception e) {
            log.error("Error reading indicator history from Redis: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Get batch indicators for multiple scripCodes.
     */
    public Map<String, TechnicalIndicatorDTO> getBatchIndicators(List<String> scripCodes, String timeframe) {
        Map<String, TechnicalIndicatorDTO> result = new HashMap<>();

        for (String scripCode : scripCodes) {
            getIndicators(scripCode, timeframe).ifPresent(ind -> result.put(scripCode, ind));
        }

        return result;
    }

    /**
     * Get all indicators for a given timeframe.
     * Used by GET /api/technical-indicators?timeframe=5m endpoint.
     */
    public Map<String, TechnicalIndicatorDTO> getAllIndicators(String timeframe) {
        Map<String, TechnicalIndicatorDTO> result = new HashMap<>();
        Set<String> scripCodes = getAvailableScripCodes(timeframe);

        log.debug("Getting all indicators for timeframe={}, found {} scripCodes", timeframe, scripCodes.size());

        for (String scripCode : scripCodes) {
            getIndicators(scripCode, timeframe).ifPresent(ind -> result.put(scripCode, ind));
        }

        return result;
    }

    /**
     * Get all available scripCodes that have indicator data for a timeframe.
     */
    public Set<String> getAvailableScripCodes(String timeframe) {
        Set<String> scripCodes = new HashSet<>();

        try {
            // Scan Redis for keys matching pattern
            String pattern = KEY_PREFIX + "*:" + timeframe;
            Set<String> keys = redisTemplate.keys(pattern);

            if (keys != null) {
                for (String key : keys) {
                    // Extract scripCode from key: tech:indicator:{scripCode}:{timeframe}
                    String[] parts = key.split(":");
                    if (parts.length >= 3) {
                        scripCodes.add(parts[2]);
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error scanning Redis for available scripCodes: {}", e.getMessage());
        }

        return scripCodes;
    }

    /**
     * Get cache statistics.
     */
    public Map<String, Object> getStats() {
        Map<String, Object> stats = new HashMap<>();

        try {
            // Count indicators by timeframe
            Map<String, Integer> byTimeframe = new HashMap<>();
            String[] timeframes = {"1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"};

            int total = 0;
            for (String tf : timeframes) {
                Set<String> keys = redisTemplate.keys(KEY_PREFIX + "*:" + tf);
                int count = keys != null ? keys.size() : 0;
                if (count > 0) {
                    byTimeframe.put(tf, count);
                    total += count;
                }
            }

            stats.put("source", "redis");
            stats.put("indicatorCacheSize", total);
            stats.put("byTimeframe", byTimeframe);
            stats.put("keyPattern", KEY_PREFIX + "{scripCode}:{timeframe}");

        } catch (Exception e) {
            log.error("Error getting Redis stats: {}", e.getMessage());
            stats.put("error", e.getMessage());
        }

        return stats;
    }

    // ==================== SPECIALIZED INDICATOR METHODS ====================

    /**
     * Get moving average data for a scripCode.
     * Returns a subset of TechnicalIndicatorDTO focused on MAs.
     */
    public Optional<Map<String, Object>> getMovingAverages(String scripCode, String timeframe) {
        return getIndicators(scripCode, timeframe).map(ind -> {
            Map<String, Object> mas = new HashMap<>();
            mas.put("scripCode", scripCode);
            mas.put("timeframe", timeframe);
            mas.put("currentPrice", ind.getCurrentPrice());

            // Simple Moving Averages
            mas.put("sma20", ind.getSma20());
            mas.put("sma50", ind.getSma50());
            mas.put("sma200", ind.getSma200());

            // Exponential Moving Averages
            mas.put("ema9", ind.getEma9());
            mas.put("ema21", ind.getEma21());
            mas.put("ema50", ind.getEma50());
            mas.put("ema200", ind.getEma200());

            // Volume Weighted MA
            mas.put("vwma20", ind.getVwma20());

            // MA Crossover Status
            mas.put("priceAboveSma20", ind.getCurrentPrice() != null && ind.getSma20() != null
                    && ind.getCurrentPrice() > ind.getSma20());
            mas.put("priceAboveSma50", ind.getCurrentPrice() != null && ind.getSma50() != null
                    && ind.getCurrentPrice() > ind.getSma50());
            mas.put("priceAboveSma200", ind.getCurrentPrice() != null && ind.getSma200() != null
                    && ind.getCurrentPrice() > ind.getSma200());
            mas.put("priceAboveEma21", ind.getPriceAboveEma21());
            mas.put("priceAboveEma50", ind.getPriceAboveEma50());
            mas.put("goldenCross", ind.getGoldenCross());
            mas.put("deathCross", ind.getDeathCross());

            return mas;
        });
    }

    /**
     * Get momentum indicators (RSI, Stochastic, MACD).
     */
    public Optional<Map<String, Object>> getMomentumIndicators(String scripCode, String timeframe) {
        return getIndicators(scripCode, timeframe).map(ind -> {
            Map<String, Object> momentum = new HashMap<>();
            momentum.put("scripCode", scripCode);
            momentum.put("timeframe", timeframe);

            // RSI
            momentum.put("rsi14", ind.getRsi14());
            momentum.put("rsiSmoothed", ind.getRsiSmoothed());
            momentum.put("rsiZone", ind.getRsiZone());
            momentum.put("rsiOverbought", ind.getRsi14() != null && ind.getRsi14() > 70);
            momentum.put("rsiOversold", ind.getRsi14() != null && ind.getRsi14() < 30);
            momentum.put("rsiBullish", ind.getRsiBullish());

            // Stochastic
            momentum.put("stochK", ind.getStochK());
            momentum.put("stochD", ind.getStochD());
            momentum.put("stochZone", ind.getStochZone());

            // MACD
            momentum.put("macdLine", ind.getMacdLine());
            momentum.put("macdSignal", ind.getMacdSignal());
            momentum.put("macdHistogram", ind.getMacdHistogram());
            momentum.put("macdCrossover", ind.getMacdCrossover());
            momentum.put("macdBullish", ind.getMacdBullish());

            return momentum;
        });
    }

    /**
     * Get trend indicators (ADX, Trend Strength, ATR).
     */
    public Optional<Map<String, Object>> getTrendIndicators(String scripCode, String timeframe) {
        return getIndicators(scripCode, timeframe).map(ind -> {
            Map<String, Object> trend = new HashMap<>();
            trend.put("scripCode", scripCode);
            trend.put("timeframe", timeframe);

            // ADX
            trend.put("adx14", ind.getAdx14());
            trend.put("plusDI", ind.getPlusDI());
            trend.put("minusDI", ind.getMinusDI());
            trend.put("trendStrength", ind.getTrendStrength());
            trend.put("trendingMarket", ind.getAdx14() != null && ind.getAdx14() > 25);
            trend.put("strongTrend", ind.getAdx14() != null && ind.getAdx14() > 40);

            // Trend Direction
            trend.put("trendDirection", ind.getTrendDirection());
            trend.put("bullishDi", ind.getPlusDI() != null && ind.getMinusDI() != null
                    && ind.getPlusDI() > ind.getMinusDI());

            // SuperTrend
            trend.put("superTrendValue", ind.getSuperTrendValue());
            trend.put("superTrendDirection", ind.getSuperTrendDirection());
            trend.put("superTrendReversal", ind.getSuperTrendReversal());
            trend.put("candlesSinceFlip", ind.getCandlesSinceFlip());
            trend.put("priceAboveSuperTrend", ind.getPriceAboveSuperTrend());

            // Volatility
            trend.put("atr", ind.getAtr());
            trend.put("atrPercent", ind.getAtrPercent());
            trend.put("atrMultiple", ind.getAtrMultiple());
            trend.put("avgVolume20", ind.getAvgVolume20());
            trend.put("volumeRatio", ind.getVolumeRatio());
            trend.put("highVolatility", ind.isHighVolatility());
            trend.put("lowVolatility", ind.isLowVolatility());

            // Bollinger Bands
            trend.put("bbUpper", ind.getBbUpper());
            trend.put("bbMiddle", ind.getBbMiddle());
            trend.put("bbLower", ind.getBbLower());
            trend.put("bbWidth", ind.getBbWidth());
            trend.put("bbWidthPct", ind.getBbWidthPct());
            trend.put("bbPercentB", ind.getBbPercentB());
            trend.put("bbSqueeze", ind.getBbSqueeze());
            trend.put("bbPosition", ind.getBbPosition());

            return trend;
        });
    }

    /**
     * Get pivot points.
     */
    public Optional<Map<String, Object>> getPivotPoints(String scripCode, String timeframe) {
        return getIndicators(scripCode, timeframe).map(ind -> {
            Map<String, Object> pivots = new HashMap<>();
            pivots.put("scripCode", scripCode);
            pivots.put("timeframe", timeframe);
            pivots.put("currentPrice", ind.getCurrentPrice());

            // Pivot Points
            pivots.put("pivotPoint", ind.getPivotPoint());
            pivots.put("r1", ind.getR1());
            pivots.put("r2", ind.getR2());
            pivots.put("r3", ind.getR3());
            pivots.put("s1", ind.getS1());
            pivots.put("s2", ind.getS2());
            pivots.put("s3", ind.getS3());

            // Nearest levels
            pivots.put("nearestSupport", ind.getNearestSupport());
            pivots.put("nearestResistance", ind.getNearestResistance());
            pivots.put("priceAbovePivot", ind.getCurrentPrice() != null && ind.getPivotPoint() != null
                    && ind.getCurrentPrice() > ind.getPivotPoint());

            return pivots;
        });
    }

    /**
     * Check if a scripCode has a bullish setup based on indicators.
     */
    public boolean isBullishSetup(String scripCode, String timeframe) {
        return getIndicators(scripCode, timeframe)
                .map(TechnicalIndicatorDTO::isBullish)
                .orElse(false);
    }

    /**
     * Check if a scripCode has a bearish setup based on indicators.
     */
    public boolean isBearishSetup(String scripCode, String timeframe) {
        return getIndicators(scripCode, timeframe)
                .map(TechnicalIndicatorDTO::isBearish)
                .orElse(false);
    }

    /**
     * Get scripCodes with bullish setups.
     */
    public List<String> getBullishSetups(String timeframe) {
        List<String> bullish = new ArrayList<>();
        for (String scripCode : getAvailableScripCodes(timeframe)) {
            if (isBullishSetup(scripCode, timeframe)) {
                bullish.add(scripCode);
            }
        }
        return bullish;
    }

    /**
     * Get scripCodes with bearish setups.
     */
    public List<String> getBearishSetups(String timeframe) {
        List<String> bearish = new ArrayList<>();
        for (String scripCode : getAvailableScripCodes(timeframe)) {
            if (isBearishSetup(scripCode, timeframe)) {
                bearish.add(scripCode);
            }
        }
        return bearish;
    }

    /**
     * Get scripCodes in strong trend (ADX > threshold).
     */
    public List<String> getTrendingSymbols(String timeframe, double minAdx) {
        List<String> trending = new ArrayList<>();
        for (String scripCode : getAvailableScripCodes(timeframe)) {
            getIndicators(scripCode, timeframe).ifPresent(ind -> {
                if (ind.getAdx14() != null && ind.getAdx14() >= minAdx) {
                    trending.add(scripCode);
                }
            });
        }
        return trending;
    }

    /**
     * Get scripCodes with high volume (volume ratio > threshold).
     */
    public List<String> getHighVolumeSymbols(String timeframe, double minVolumeRatio) {
        List<String> highVolume = new ArrayList<>();
        for (String scripCode : getAvailableScripCodes(timeframe)) {
            getIndicators(scripCode, timeframe).ifPresent(ind -> {
                if (ind.getVolumeRatio() != null && ind.getVolumeRatio() >= minVolumeRatio) {
                    highVolume.add(scripCode);
                }
            });
        }
        return highVolume;
    }

    /**
     * Get composite signal for a scripCode.
     */
    public Optional<String> getCompositeSignal(String scripCode, String timeframe) {
        return getIndicators(scripCode, timeframe).map(ind -> {
            int bullishCount = 0;
            int bearishCount = 0;

            // RSI
            if (ind.getRsi14() != null) {
                if (ind.getRsi14() < 30) bullishCount++;
                else if (ind.getRsi14() > 70) bearishCount++;
            }

            // MACD
            if (Boolean.TRUE.equals(ind.getMacdBullish())) bullishCount++;
            else if (Boolean.FALSE.equals(ind.getMacdBullish())) bearishCount++;

            // Price vs MA
            if (ind.getCurrentPrice() != null && ind.getSma50() != null) {
                if (ind.getCurrentPrice() > ind.getSma50()) bullishCount++;
                else bearishCount++;
            }

            // ADX + DI
            if (ind.getPlusDI() != null && ind.getMinusDI() != null) {
                if (ind.getPlusDI() > ind.getMinusDI()) bullishCount++;
                else bearishCount++;
            }

            // SuperTrend
            if ("UP".equals(ind.getSuperTrendDirection()) || "BULLISH".equals(ind.getSuperTrendDirection())) {
                bullishCount++;
            } else if ("DOWN".equals(ind.getSuperTrendDirection()) || "BEARISH".equals(ind.getSuperTrendDirection())) {
                bearishCount++;
            }

            if (bullishCount >= 4) return "STRONG_BUY";
            if (bullishCount >= 3) return "BUY";
            if (bearishCount >= 4) return "STRONG_SELL";
            if (bearishCount >= 3) return "SELL";
            return "NEUTRAL";
        });
    }
}
