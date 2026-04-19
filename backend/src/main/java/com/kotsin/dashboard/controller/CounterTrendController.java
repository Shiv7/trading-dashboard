package com.kotsin.dashboard.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * Counter-trend OTM lookup. Reads otm8:{symbol}:{CE|PE} cache populated by
 * Streaming Candle's OptionPreWarmService (computeAndStoreOtm8).
 *
 * Returns the top-1 most liquid OTM candidate for the OPPOSITE direction of a signal:
 *   BEARISH signal → counter is CE
 *   BULLISH signal → counter is PE
 */
@RestController
@RequestMapping("/api/counter-trend")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class CounterTrendController {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * GET /api/counter-trend/otm/{symbol}/{originalDirection}
     *
     * Returns the counter-trend OTM candidate (opposite direction of the original signal).
     * E.g., for symbol=ASTRAL, originalDirection=BEARISH, returns top-1 CE candidate.
     */
    @GetMapping("/otm/{symbol}/{originalDirection}")
    public ResponseEntity<Map<String, Object>> getCounterTrendOtm(
            @PathVariable String symbol,
            @PathVariable String originalDirection) {

        String oppositeType = "BEARISH".equalsIgnoreCase(originalDirection) ? "CE" : "PE";
        String key = "otm8:" + symbol + ":" + oppositeType;

        try {
            String raw = redisTemplate.opsForValue().get(key);
            if (raw == null || raw.isEmpty()) {
                return ResponseEntity.ok(Map.of(
                        "available", false,
                        "reason", "NO_OTM8_CACHE",
                        "symbol", symbol,
                        "counterType", oppositeType));
            }

            JsonNode root = mapper.readTree(raw);
            JsonNode candidates = root.path("candidates");
            if (!candidates.isArray() || candidates.size() == 0) {
                return ResponseEntity.ok(Map.of(
                        "available", false,
                        "reason", "EMPTY_CANDIDATES",
                        "symbol", symbol,
                        "counterType", oppositeType));
            }

            // Pick the top by liquidityScore
            JsonNode best = null;
            double bestScore = -1;
            for (JsonNode c : candidates) {
                double score = c.path("liquidityScore").asDouble(0);
                if (score > bestScore) {
                    bestScore = score;
                    best = c;
                }
            }
            if (best == null) best = candidates.get(0);

            Map<String, Object> result = new HashMap<>();
            result.put("available", true);
            result.put("symbol", symbol);
            result.put("counterType", oppositeType);
            result.put("counterDirection", "BEARISH".equalsIgnoreCase(originalDirection) ? "BULLISH" : "BEARISH");
            result.put("spotPrice", root.path("spotPrice").asDouble());
            result.put("scripCode", best.path("scripCode").asText());
            result.put("strike", best.path("strike").asDouble());
            result.put("expiry", best.path("expiry").asText());
            result.put("contractName", best.path("contractName").asText());
            // Correct LTP field — was reading non-existent "ltp" and falling back to avgVolPerMin
            result.put("ltp", best.path("optionLtpAtPrewarm").asDouble(0));
            // Greeks (full set)
            result.put("delta", best.path("delta").asDouble(0));
            result.put("gamma", best.path("gamma").asDouble(0));
            result.put("theta", best.path("theta").asDouble(0));
            result.put("impliedVol", best.path("impliedVol").asDouble(0));
            // Liquidity / volume
            result.put("liquidityScore", bestScore);
            result.put("avgVolPerMin", best.path("avgVolPerMin").asDouble(0));
            result.put("currentVolPerMin", best.path("currentVolPerMin").asDouble(0));
            result.put("avgTradesPerMin", best.path("avgTradesPerMin").asDouble(0));
            result.put("volumeSurgeRatio", best.path("volumeSurgeRatio").asDouble(0));
            // Orderbook
            result.put("spreadPct", best.path("spreadPct").asDouble(-1));
            result.put("bidAskSpread", best.path("bidAskSpread").asDouble(-1));
            result.put("topOfBookDepth", best.path("topOfBookDepth").asDouble(-1));
            result.put("daysToExpiry", best.path("daysToExpiry").asInt(0));
            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.warn("Counter-trend OTM lookup failed for {}/{}: {}", symbol, originalDirection, e.getMessage());
            return ResponseEntity.ok(Map.of(
                    "available", false,
                    "reason", "ERROR: " + e.getMessage(),
                    "symbol", symbol));
        }
    }
}
