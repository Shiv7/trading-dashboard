package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.UnifiedCandleDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;

/**
 * Service for fetching unified candles from Redis.
 *
 * ARCHITECTURE:
 * - StreamingCandle Service stores Tick, Orderbook, OI separately in Redis
 * - This service merges them at query time for unified view
 * - Avoids complex Kafka joins and ensures data freshness
 *
 * Redis Key Patterns:
 * - tick:{symbol}:{tf}:latest        → Latest tick candle
 * - tick:{symbol}:{tf}:history       → List of tick candles
 * - ob:{symbol}:latest               → Latest orderbook metrics
 * - oi:{symbol}:latest               → Latest OI metrics
 * - unified:{symbol}:{tf}:latest     → Pre-merged unified candle (optional)
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class UnifiedCandleService {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Key prefixes (match StreamingCandle)
    private static final String TICK_PREFIX = "tick:";
    private static final String OB_PREFIX = "ob:";
    private static final String OI_PREFIX = "oi:";
    private static final String UNIFIED_PREFIX = "unified:";

    /**
     * Get latest unified candle for a symbol and timeframe.
     */
    public Optional<UnifiedCandleDTO> getLatestCandle(String symbol, String timeframe) {
        // Try pre-merged unified key first
        String unifiedKey = UNIFIED_PREFIX + symbol + ":" + timeframe + ":latest";

        try {
            String json = redisTemplate.opsForValue().get(unifiedKey);
            if (json != null && !json.isEmpty()) {
                log.trace("Found pre-merged unified candle for {}:{}", symbol, timeframe);
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
            // Get tick candle (required)
            String tickKey = TICK_PREFIX + symbol + ":" + timeframe + ":latest";
            String tickJson = redisTemplate.opsForValue().get(tickKey);

            if (tickJson == null || tickJson.isEmpty()) {
                log.debug("No tick data for {}:{}", symbol, timeframe);
                return Optional.empty();
            }

            // Parse tick data
            JsonNode tick = objectMapper.readTree(tickJson);
            UnifiedCandleDTO.UnifiedCandleDTOBuilder builder = UnifiedCandleDTO.builder()
                    .symbol(symbol)
                    .scripCode(getTextOrNull(tick, "scripCode"))
                    .companyName(getTextOrNull(tick, "companyName"))
                    .exchange(getTextOrNull(tick, "exchange"))
                    .exchangeType(getTextOrNull(tick, "exchangeType"))
                    .instrumentType(getTextOrNull(tick, "instrumentType"))
                    .timeframe(timeframe)
                    .timestamp(parseInstant(tick, "timestamp"))
                    .windowStart(parseInstant(tick, "windowStart"))
                    .windowEnd(parseInstant(tick, "windowEnd"))
                    .windowEndMillis(getLongOrNull(tick, "windowEndMillis"))
                    // OHLCV
                    .open(getDoubleOrNull(tick, "open"))
                    .high(getDoubleOrNull(tick, "high"))
                    .low(getDoubleOrNull(tick, "low"))
                    .close(getDoubleOrNull(tick, "close"))
                    .volume(getLongOrNull(tick, "volume"))
                    .value(getDoubleOrNull(tick, "value"))
                    .vwap(getDoubleOrNull(tick, "vwap"))
                    .typicalPrice(getDoubleOrNull(tick, "typicalPrice"))
                    // Trade Classification
                    .buyVolume(getLongOrNull(tick, "buyVolume"))
                    .sellVolume(getLongOrNull(tick, "sellVolume"))
                    .midpointVolume(getLongOrNull(tick, "midpointVolume"))
                    .volumeDelta(getLongOrNull(tick, "volumeDelta"))
                    .buyPressure(getDoubleOrNull(tick, "buyPressure"))
                    .sellPressure(getDoubleOrNull(tick, "sellPressure"))
                    // Volume Profile
                    .vpin(getDoubleOrNull(tick, "vpin"))
                    .vpinBucketSize(getIntOrNull(tick, "vpinBucketSize"))
                    .poc(getDoubleOrNull(tick, "poc"))
                    .vah(getDoubleOrNull(tick, "vah"))
                    .val(getDoubleOrNull(tick, "val"))
                    // Imbalance
                    .volumeImbalance(getDoubleOrNull(tick, "volumeImbalance"))
                    .dollarImbalance(getDoubleOrNull(tick, "dollarImbalance"))
                    .tickRuns(getIntOrNull(tick, "tickRuns"))
                    .vibTriggered(getBooleanOrNull(tick, "vibTriggered"))
                    .dibTriggered(getBooleanOrNull(tick, "dibTriggered"))
                    // Tick Intensity
                    .tickCount(getIntOrNull(tick, "tickCount"))
                    .ticksPerSecond(getDoubleOrNull(tick, "ticksPerSecond"))
                    .largeTradeCount(getIntOrNull(tick, "largeTradeCount"))
                    // Quality
                    .quality(getTextOrNull(tick, "quality"))
                    .processingLatencyMs(getLongOrNull(tick, "processingLatencyMs"));

            // Try to get orderbook data (optional)
            String obKey = OB_PREFIX + symbol + ":latest";
            String obJson = redisTemplate.opsForValue().get(obKey);
            if (obJson != null && !obJson.isEmpty()) {
                JsonNode ob = objectMapper.readTree(obJson);
                builder.hasOrderbook(true)
                        .ofi(getDoubleOrNull(ob, "ofi"))
                        .ofiMomentum(getDoubleOrNull(ob, "ofiMomentum"))
                        .kyleLambda(getDoubleOrNull(ob, "kyleLambda"))
                        .microprice(getDoubleOrNull(ob, "microprice"))
                        .bidAskSpread(getDoubleOrNull(ob, "bidAskSpread"))
                        .spreadPercent(getDoubleOrNull(ob, "spreadPercent"))
                        .spreadVolatility(getDoubleOrNull(ob, "spreadVolatility"))
                        .tightSpreadPercent(getDoubleOrNull(ob, "tightSpreadPercent"))
                        .depthImbalance(getDoubleOrNull(ob, "depthImbalance"))
                        .weightedDepthImbalance(getDoubleOrNull(ob, "weightedDepthImbalance"))
                        .avgBidDepth(getDoubleOrNull(ob, "avgBidDepth"))
                        .avgAskDepth(getDoubleOrNull(ob, "avgAskDepth"))
                        .bidDepthSlope(getDoubleOrNull(ob, "bidDepthSlope"))
                        .askDepthSlope(getDoubleOrNull(ob, "askDepthSlope"))
                        .depthConcentration(getDoubleOrNull(ob, "depthConcentration"))
                        .spoofingCount(getIntOrNull(ob, "spoofingCount"))
                        .icebergDetected(getBooleanOrNull(ob, "icebergDetected"))
                        .cancelRate(getDoubleOrNull(ob, "cancelRate"))
                        .orderbookUpdateCount(getIntOrNull(ob, "updateCount"))
                        .lastOrderbookUpdate(parseInstant(ob, "lastUpdateTimestamp"));

                // Calculate staleness
                Instant obTime = parseInstant(ob, "timestamp");
                if (obTime != null) {
                    builder.orderbookStaleness(Instant.now().toEpochMilli() - obTime.toEpochMilli());
                }
            } else {
                builder.hasOrderbook(false);
            }

            // Try to get OI data (optional, for derivatives)
            String oiKey = OI_PREFIX + symbol + ":latest";
            String oiJson = redisTemplate.opsForValue().get(oiKey);
            if (oiJson != null && !oiJson.isEmpty()) {
                JsonNode oi = objectMapper.readTree(oiJson);
                builder.hasOI(true)
                        .openInterest(getLongOrNull(oi, "openInterest"))
                        .oiChange(getLongOrNull(oi, "oiChange"))
                        .oiChangePercent(getDoubleOrNull(oi, "oiChangePercent"))
                        .oiInterpretation(getTextOrNull(oi, "oiInterpretation"))
                        .oiInterpretationConfidence(getDoubleOrNull(oi, "oiInterpretationConfidence"))
                        .oiSuggestsReversal(getBooleanOrNull(oi, "suggestsReversal"))
                        .oiVelocity(getDoubleOrNull(oi, "oiVelocity"))
                        .oiAcceleration(getDoubleOrNull(oi, "oiAcceleration"))
                        .previousDayOI(getLongOrNull(oi, "previousDayOI"))
                        .dailyOIChange(getLongOrNull(oi, "dailyOIChange"))
                        .dailyOIChangePercent(getDoubleOrNull(oi, "dailyOIChangePercent"));

                // Options data
                builder.strikePrice(getDoubleOrNull(oi, "strikePrice"))
                        .optionType(getTextOrNull(oi, "optionType"))
                        .expiry(getTextOrNull(oi, "expiry"))
                        .daysToExpiry(getIntOrNull(oi, "daysToExpiry"));

                // Calculate staleness
                Instant oiTime = parseInstant(oi, "timestamp");
                if (oiTime != null) {
                    builder.oiStaleness(Instant.now().toEpochMilli() - oiTime.toEpochMilli());
                }
            } else {
                builder.hasOI(false);
            }

            // Calculate tick staleness
            Instant tickTime = parseInstant(tick, "timestamp");
            if (tickTime != null) {
                builder.tickStaleness(Instant.now().toEpochMilli() - tickTime.toEpochMilli());
            }

            return Optional.of(builder.build());

        } catch (Exception e) {
            log.error("Error merging candle sources for {}:{}: {}", symbol, timeframe, e.getMessage(), e);
            return Optional.empty();
        }
    }

    /**
     * Get candle history for a symbol.
     */
    public List<UnifiedCandleDTO> getCandleHistory(String symbol, String timeframe, int limit) {
        String historyKey = TICK_PREFIX + symbol + ":" + timeframe + ":history";

        try {
            List<String> history = redisTemplate.opsForList().range(historyKey, 0, limit - 1);
            if (history == null || history.isEmpty()) {
                // Try to return latest as single-item history
                return getLatestCandle(symbol, timeframe)
                        .map(Collections::singletonList)
                        .orElse(Collections.emptyList());
            }

            List<UnifiedCandleDTO> candles = new ArrayList<>();
            for (String json : history) {
                try {
                    JsonNode tick = objectMapper.readTree(json);
                    candles.add(UnifiedCandleDTO.builder()
                            .symbol(symbol)
                            .scripCode(getTextOrNull(tick, "scripCode"))
                            .timeframe(timeframe)
                            .timestamp(parseInstant(tick, "timestamp"))
                            .open(getDoubleOrNull(tick, "open"))
                            .high(getDoubleOrNull(tick, "high"))
                            .low(getDoubleOrNull(tick, "low"))
                            .close(getDoubleOrNull(tick, "close"))
                            .volume(getLongOrNull(tick, "volume"))
                            .vwap(getDoubleOrNull(tick, "vwap"))
                            .buyVolume(getLongOrNull(tick, "buyVolume"))
                            .sellVolume(getLongOrNull(tick, "sellVolume"))
                            .vpin(getDoubleOrNull(tick, "vpin"))
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
     * Get latest candles for multiple symbols (batch).
     */
    public Map<String, UnifiedCandleDTO> getBatchCandles(List<String> symbols, String timeframe) {
        Map<String, UnifiedCandleDTO> result = new HashMap<>();
        for (String symbol : symbols) {
            getLatestCandle(symbol, timeframe).ifPresent(candle -> result.put(symbol, candle));
        }
        return result;
    }

    /**
     * Get available symbols with candle data.
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

    /**
     * Check if data exists for a symbol.
     */
    public boolean hasData(String symbol, String timeframe) {
        String tickKey = TICK_PREFIX + symbol + ":" + timeframe + ":latest";
        return Boolean.TRUE.equals(redisTemplate.hasKey(tickKey));
    }

    /**
     * Get cache statistics.
     */
    public Map<String, Object> getStats() {
        Map<String, Object> stats = new HashMap<>();
        String[] timeframes = {"1m", "5m", "15m", "30m", "1h", "4h", "1d"};

        Map<String, Integer> byTimeframe = new HashMap<>();
        int total = 0;

        for (String tf : timeframes) {
            Set<String> keys = redisTemplate.keys(TICK_PREFIX + "*:" + tf + ":latest");
            int count = keys != null ? keys.size() : 0;
            if (count > 0) {
                byTimeframe.put(tf, count);
                total += count;
            }
        }

        stats.put("source", "redis");
        stats.put("totalCandles", total);
        stats.put("byTimeframe", byTimeframe);
        stats.put("keyPatterns", Map.of(
                "tick", TICK_PREFIX + "{symbol}:{tf}:latest",
                "orderbook", OB_PREFIX + "{symbol}:latest",
                "oi", OI_PREFIX + "{symbol}:latest"
        ));

        return stats;
    }

    // ==================== HELPER METHODS ====================

    private String getTextOrNull(JsonNode node, String field) {
        JsonNode child = node.path(field);
        return child.isTextual() ? child.asText() : null;
    }

    private Double getDoubleOrNull(JsonNode node, String field) {
        JsonNode child = node.path(field);
        return child.isNumber() ? child.asDouble() : null;
    }

    private Long getLongOrNull(JsonNode node, String field) {
        JsonNode child = node.path(field);
        return child.isNumber() ? child.asLong() : null;
    }

    private Integer getIntOrNull(JsonNode node, String field) {
        JsonNode child = node.path(field);
        return child.isNumber() ? child.asInt() : null;
    }

    private Boolean getBooleanOrNull(JsonNode node, String field) {
        JsonNode child = node.path(field);
        return child.isBoolean() ? child.asBoolean() : null;
    }

    private Instant parseInstant(JsonNode node, String field) {
        JsonNode child = node.path(field);
        if (child.isNumber()) {
            return Instant.ofEpochMilli(child.asLong());
        } else if (child.isTextual()) {
            try {
                return Instant.parse(child.asText());
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }
}
