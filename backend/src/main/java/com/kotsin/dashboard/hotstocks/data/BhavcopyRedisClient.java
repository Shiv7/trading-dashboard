package com.kotsin.dashboard.hotstocks.data;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only client for NSE bhavcopy OHLCV data pre-populated in Redis by FastAnalytics
 * ({@code service/nse_market_pulse_service.py::fetch_bhavcopy_ohlcv}).
 *
 * <p>Unlocks HotStocks Tier-2 non-F&amp;O scoring: dashboard needs 60+ daily candles per symbol
 * for momentum / relative-strength / volume buckets, but non-F&amp;O equities have no 5paisa
 * scripCode so {@link FivePaisaHistoryClient} can't fetch them. NSE bhavcopy is keyed by
 * SYMBOL instead of scripCode, sidestepping the problem.
 *
 * <p>Read path: one Redis GET per symbol → deserialise JSON array → {@link DailyCandle} list
 * (oldest→newest). No HTTP, no session cookies, no rate limits. FastAnalytics handles scrape.
 */
@Component
public class BhavcopyRedisClient {

    private static final Logger log = LoggerFactory.getLogger(BhavcopyRedisClient.class);
    private static final String KEY_PREFIX = "nse:bhavcopy:ohlcv:";

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();

    public BhavcopyRedisClient(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /**
     * Fetch daily OHLCV candles for a single NSE symbol (oldest→newest).
     * Returns empty list when no cached data exists or parse fails.
     */
    public List<DailyCandle> fetchBySymbol(String symbol) {
        if (symbol == null || symbol.isBlank()) return Collections.emptyList();
        String key = KEY_PREFIX + symbol.trim().toUpperCase();
        String json = redis.opsForValue().get(key);
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {
            return parseCandles(json);
        } catch (Exception e) {
            log.warn("[BHAVCOPY-REDIS] parse failed for symbol={}: {}", symbol, e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Fetch candles for many symbols. Missing / unparseable entries are silently skipped —
     * callers check {@code map.size()} vs. requested size when they care.
     */
    public Map<String, List<DailyCandle>> fetchBulk(Iterable<String> symbols) {
        Map<String, List<DailyCandle>> out = new HashMap<>();
        for (String sym : symbols) {
            List<DailyCandle> candles = fetchBySymbol(sym);
            if (!candles.isEmpty()) {
                out.put(sym.trim().toUpperCase(), candles);
            }
        }
        return out;
    }

    /** Number of symbols currently cached (peek via the _index key published by the scraper). */
    public int cachedSymbolCount() {
        String idx = redis.opsForValue().get(KEY_PREFIX + "_index");
        if (idx == null) return 0;
        try {
            JsonNode node = mapper.readTree(idx);
            JsonNode syms = node.path("symbols");
            return syms.isArray() ? syms.size() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    List<DailyCandle> parseCandles(String json) throws Exception {
        JsonNode root = mapper.readTree(json);
        if (!root.isArray()) return Collections.emptyList();
        List<DailyCandle> out = new ArrayList<>(root.size());
        for (JsonNode n : root) {
            String dateStr = n.path("date").asText();
            if (dateStr.isBlank()) continue;
            out.add(new DailyCandle(
                LocalDate.parse(dateStr),
                n.path("open").asDouble(0),
                n.path("high").asDouble(0),
                n.path("low").asDouble(0),
                n.path("close").asDouble(0),
                n.path("volume").asLong(0)
            ));
        }
        return out;
    }
}
