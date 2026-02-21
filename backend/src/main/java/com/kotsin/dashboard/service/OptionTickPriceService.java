package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;

/**
 * Manages dynamic WebSocket subscriptions for option contracts via optionProducerJava API,
 * and provides Redis read helpers for OI metrics, pivot levels, and candle history.
 *
 * When StrategyTradeExecutor opens a trade for an option, this service ensures:
 * 1. The option contract is subscribed on the 5Paisa broker WebSocket (tick data flows)
 * 2. OI data subscription is active for the contract
 *
 * Redis read helpers:
 * - readOiMetrics()       — Read OI interpretation from oi:{scripCode}:latest
 * - readPivotState()      — Read multi-TF pivot levels from pivot:mtf:{scripCode}
 * - readSwingLevels()     — Detect swing highs/lows from tick:{scripCode}:1m:history
 */
@Service
@Slf4j
public class OptionTickPriceService {

    private static final String LOG_PREFIX = "[TICK-PRICE]";

    @Value("${optionproducer.api.base:http://localhost:8208}")
    private String optionProducerBase;

    @Autowired
    @Qualifier("executionRestTemplate")
    private RestTemplate restTemplate;

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // ==================== WEBSOCKET SUBSCRIPTION ====================

    /**
     * Ensure the scrip code is subscribed on the broker WebSocket via optionProducerJava API.
     * Idempotent — safe to call even if already subscribed.
     */
    public void ensureSubscribed(String exchange, String exchangeType, String scripCode, String companyName) {
        try {
            String url = optionProducerBase + "/api/ws/subscribe";
            Map<String, String> req = Map.of(
                "exch", exchange != null ? exchange : "N",
                "exchType", exchangeType != null ? exchangeType : "D",
                "scripCode", scripCode,
                "companyName", companyName != null ? companyName : ""
            );
            restTemplate.postForEntity(url, req, String.class);
            log.info("{} WebSocket subscription ensured for {} ({}:{}:{})",
                LOG_PREFIX, companyName, exchange, exchangeType, scripCode);
        } catch (Exception e) {
            log.warn("{} Failed to subscribe {} on WebSocket: {}", LOG_PREFIX, scripCode, e.getMessage());
        }
    }

    /**
     * Ensure OI subscription for an option scrip code.
     * OI data is used for monitoring OI patterns that may trigger early exit.
     */
    public void ensureOiSubscribed(String exchange, String exchangeType, String scripCode, String companyName) {
        try {
            String url = optionProducerBase + "/api/ws/subscribe-oi";
            Map<String, String> req = Map.of(
                "exch", exchange != null ? exchange : "N",
                "exchType", exchangeType != null ? exchangeType : "D",
                "scripCode", scripCode,
                "companyName", companyName != null ? companyName : ""
            );
            restTemplate.postForEntity(url, req, String.class);
            log.info("{} OI subscription ensured for {} ({}:{}:{})",
                LOG_PREFIX, companyName, exchange, exchangeType, scripCode);
        } catch (Exception e) {
            log.warn("{} Failed to subscribe OI for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
        }
    }

    // ==================== OI METRICS READING ====================

    /**
     * Read OI metrics from Redis for a given option scrip code.
     * Data stored by streamingcandle's RedisCacheService using GenericJackson2JsonRedisSerializer
     * (type-wrapped JSON format: ["com.class.Name", {data}]).
     *
     * @return Map with keys: interpretation (String), confidence (double), oiChangePercent (double)
     *         or null if no data available
     */
    public Map<String, Object> readOiMetrics(String scripCode) {
        if (scripCode == null) return null;

        try {
            String key = "oi:" + scripCode + ":latest";
            String raw = redisTemplate.opsForValue().get(key);
            if (raw == null || raw.isEmpty()) return null;

            JsonNode root = objectMapper.readTree(raw);

            // Handle type-wrapped format: ["com.kotsin.consumer.model.OIMetrics", {actual data}]
            JsonNode data = (root.isArray() && root.size() == 2) ? root.get(1) : root;

            String interpretation = extractStringField(data, "interpretation");
            double confidence = data.has("interpretationConfidence")
                ? data.get("interpretationConfidence").asDouble() : 0;
            double oiChangePercent = data.has("oiChangePercent")
                ? data.get("oiChangePercent").asDouble() : 0;

            if (interpretation == null) return null;

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("interpretation", interpretation);
            result.put("confidence", confidence);
            result.put("oiChangePercent", oiChangePercent);
            return result;

        } catch (Exception e) {
            log.debug("{} Failed to read OI metrics for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
            return null;
        }
    }

    // ==================== PIVOT LEVELS READING ====================

    /**
     * Read multi-timeframe pivot levels from Redis for the underlying equity.
     * Data stored by PivotLevelService using StringRedisTemplate (plain JSON).
     *
     * Returns all equity pivot levels as a flat map of {levelName -> price}.
     * E.g., {"dailyR1" -> 3085.0, "dailyR2" -> 3110.0, "weeklyR1" -> 3095.0, ...}
     *
     * @param underlyingScripCode the equity scrip code (e.g., "49812")
     * @return Map of level names to prices, or empty map if no data
     */
    public Map<String, Double> readPivotLevels(String underlyingScripCode) {
        if (underlyingScripCode == null) return Map.of();

        try {
            String key = "pivot:mtf:" + underlyingScripCode;
            String raw = redisTemplate.opsForValue().get(key);
            if (raw == null || raw.isEmpty()) return Map.of();

            JsonNode root = objectMapper.readTree(raw);

            Map<String, Double> levels = new LinkedHashMap<>();

            // Extract pivot levels from each timeframe
            extractPivotLevels(root, "dailyPivot", "daily", levels);
            extractPivotLevels(root, "prevDailyPivot", "prevDaily", levels);
            extractPivotLevels(root, "weeklyPivot", "weekly", levels);
            extractPivotLevels(root, "prevWeeklyPivot", "prevWeekly", levels);
            extractPivotLevels(root, "monthlyPivot", "monthly", levels);
            extractPivotLevels(root, "prevMonthlyPivot", "prevMonthly", levels);

            return levels;

        } catch (Exception e) {
            log.debug("{} Failed to read pivot levels for {}: {}", LOG_PREFIX, underlyingScripCode, e.getMessage());
            return Map.of();
        }
    }

    /**
     * Extract individual pivot levels from a timeframe node.
     */
    private void extractPivotLevels(JsonNode root, String tfField, String prefix, Map<String, Double> levels) {
        JsonNode tf = root.get(tfField);
        if (tf == null || tf.isNull()) return;

        // Handle type-wrapped format if present
        if (tf.isArray() && tf.size() == 2) {
            tf = tf.get(1);
        }

        addLevel(levels, prefix + "Pivot", tf, "pivot");
        addLevel(levels, prefix + "S1", tf, "s1");
        addLevel(levels, prefix + "S2", tf, "s2");
        addLevel(levels, prefix + "S3", tf, "s3");
        addLevel(levels, prefix + "S4", tf, "s4");
        addLevel(levels, prefix + "R1", tf, "r1");
        addLevel(levels, prefix + "R2", tf, "r2");
        addLevel(levels, prefix + "R3", tf, "r3");
        addLevel(levels, prefix + "R4", tf, "r4");
        addLevel(levels, prefix + "TC", tf, "tc");
        addLevel(levels, prefix + "BC", tf, "bc");
    }

    private void addLevel(Map<String, Double> levels, String name, JsonNode node, String field) {
        if (node.has(field)) {
            double val = node.get(field).asDouble();
            if (val > 0) {
                levels.put(name, val);
            }
        }
    }

    // ==================== SWING LEVEL DETECTION ====================

    /**
     * Detect swing highs and lows from option candle history.
     * Reads tick:{scripCode}:1m:history (Redis LIST of TickCandle objects).
     * Data stored by streamingcandle using GenericJackson2JsonRedisSerializer.
     *
     * A swing high = local maximum where high[i] > high[i-1] AND high[i] > high[i+1]
     * A swing low  = local minimum where low[i] < low[i-1] AND low[i] < low[i+1]
     *
     * @param scripCode option scrip code
     * @param count number of candles to analyze (30-60 recommended)
     * @return Map with "swingHighs" and "swingLows" as List<Double>
     */
    public Map<String, List<Double>> readSwingLevels(String scripCode, int count) {
        Map<String, List<Double>> result = new LinkedHashMap<>();
        result.put("swingHighs", new ArrayList<>());
        result.put("swingLows", new ArrayList<>());

        if (scripCode == null || count < 3) return result;

        try {
            String key = "tick:" + scripCode + ":1m:history";
            List<String> rawCandles = redisTemplate.opsForList().range(key, 0, count - 1);
            if (rawCandles == null || rawCandles.size() < 3) return result;

            // Parse OHLC from type-wrapped JSON candles
            List<double[]> ohlc = new ArrayList<>(); // [open, high, low, close]
            for (String raw : rawCandles) {
                try {
                    JsonNode root = objectMapper.readTree(raw);
                    JsonNode data = (root.isArray() && root.size() == 2) ? root.get(1) : root;

                    double high = data.has("high") ? data.get("high").asDouble() : 0;
                    double low = data.has("low") ? data.get("low").asDouble() : 0;

                    if (high > 0 && low > 0) {
                        ohlc.add(new double[]{0, high, low, 0});
                    }
                } catch (Exception ignored) {}
            }

            // History is stored newest-first (leftPush). Reverse for chronological order.
            Collections.reverse(ohlc);

            // Detect swing highs and lows
            for (int i = 1; i < ohlc.size() - 1; i++) {
                double prevHigh = ohlc.get(i - 1)[1];
                double currHigh = ohlc.get(i)[1];
                double nextHigh = ohlc.get(i + 1)[1];

                double prevLow = ohlc.get(i - 1)[2];
                double currLow = ohlc.get(i)[2];
                double nextLow = ohlc.get(i + 1)[2];

                if (currHigh > prevHigh && currHigh > nextHigh) {
                    result.get("swingHighs").add(currHigh);
                }
                if (currLow < prevLow && currLow < nextLow) {
                    result.get("swingLows").add(currLow);
                }
            }

            return result;

        } catch (Exception e) {
            log.debug("{} Failed to read swing levels for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
            return result;
        }
    }

    // ==================== HELPERS ====================

    /**
     * Extract a string value from a JsonNode field, handling type-wrapped enum format.
     * Type-wrapped: ["com.class$Enum", "VALUE"] → returns "VALUE"
     * Plain: "VALUE" → returns "VALUE"
     */
    private String extractStringField(JsonNode data, String field) {
        JsonNode node = data.get(field);
        if (node == null || node.isNull()) return null;
        if (node.isArray() && node.size() == 2) {
            return node.get(1).asText();
        }
        return node.asText();
    }
}
