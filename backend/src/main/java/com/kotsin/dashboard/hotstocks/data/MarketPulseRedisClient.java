package com.kotsin.dashboard.hotstocks.data;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.model.CorporateEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Single read-only client for all NSE market-pulse data pre-populated in Redis
 * by FastAnalytics (service/nse_market_pulse_service.py).
 *
 * Keys read:
 *  - market-pulse:corporate-events         → board meetings, earnings, fund raising, etc.
 *  - market-pulse:bulk-deals:{YYYY-MM-DD}  → per-day bulk deals
 *  - market-pulse:block-deals:{YYYY-MM-DD} → per-day block deals
 *  - market-pulse:delivery-data            → includes bySymbol map of delivery %
 *
 * No HTTP calls. No scraping. No session cookies. FastAnalytics handles all that.
 */
@Component
public class MarketPulseRedisClient {
    private static final Logger log = LoggerFactory.getLogger(MarketPulseRedisClient.class);
    private static final DateTimeFormatter DD_MMM_YYYY = DateTimeFormatter.ofPattern("dd-MMM-yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE;

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();

    public MarketPulseRedisClient(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** Read a nested DTO for deals from Redis key shape. Pre-computed valueCr preserved. */
    public record Deal(
        LocalDate date,
        String symbol,
        String securityName,
        String clientName,
        String buySell,      // "BUY" / "SELL"
        long quantity,
        double price,
        double valueCr,
        boolean isBlock
    ) {}

    /**
     * Returns all corporate events in the rolling 12-day window (populated daily by FastAnalytics).
     * Event types are normalized from the NSE purpose field:
     *   "Financial Results" → EARNINGS
     *   "Dividend" → DIVIDEND
     *   "Split" / "Sub-Division" → SPLIT
     *   "Bonus" → BONUS
     *   "Fund Raising" / other → AGM (generic)
     */
    public List<CorporateEvent> fetchCorporateEvents() {
        String json = redis.opsForValue().get("market-pulse:corporate-events");
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {
            JsonNode root = mapper.readTree(json);
            if (!root.isArray()) return Collections.emptyList();
            List<CorporateEvent> out = new ArrayList<>();
            for (JsonNode n : root) {
                String symbol = n.path("symbol").asText();
                String purpose = n.path("purpose").asText().toUpperCase();
                String dateStr = n.path("date").asText();
                if (symbol.isEmpty() || dateStr.isEmpty()) continue;
                LocalDate d;
                try {
                    d = LocalDate.parse(dateStr, DD_MMM_YYYY);
                } catch (Exception ex) {
                    continue;
                }
                String type = classifyEventType(purpose);
                out.add(new CorporateEvent(symbol, type, d, n.path("purpose").asText()));
            }
            return out;
        } catch (Exception e) {
            log.warn("Failed to parse corporate-events: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    private String classifyEventType(String purposeUpper) {
        if (purposeUpper.contains("FINANCIAL RESULT") || purposeUpper.contains("EARNING")) return "EARNINGS";
        if (purposeUpper.contains("DIVIDEND")) return "DIVIDEND";
        if (purposeUpper.contains("SPLIT") || purposeUpper.contains("SUB-DIV")) return "SPLIT";
        if (purposeUpper.contains("BONUS")) return "BONUS";
        return "AGM";  // fund raising / other business matters bucket
    }

    /**
     * Fetch bulk + block deals across an inclusive date range.
     * Missing per-day keys are silently skipped (FastAnalytics only caches trading days).
     */
    public List<Deal> fetchDeals(LocalDate from, LocalDate to) {
        List<Deal> out = new ArrayList<>();
        LocalDate d = from;
        while (!d.isAfter(to)) {
            out.addAll(parseDealArray(redis.opsForValue().get("market-pulse:bulk-deals:" + d.format(ISO)), false));
            out.addAll(parseDealArray(redis.opsForValue().get("market-pulse:block-deals:" + d.format(ISO)), true));
            d = d.plusDays(1);
        }
        return out;
    }

    private List<Deal> parseDealArray(String json, boolean isBlock) {
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {
            JsonNode root = mapper.readTree(json);
            if (!root.isArray()) return Collections.emptyList();
            List<Deal> out = new ArrayList<>();
            for (JsonNode n : root) {
                String dateStr = n.path("date").asText();
                LocalDate d;
                try {
                    // Deal dates come in as "dd-MMM-yyyy" uppercased; reuse the formatter with
                    // case-insensitive reparse via lowercasing month abbreviations if needed.
                    d = LocalDate.parse(normalizeMonthCase(dateStr), DD_MMM_YYYY);
                } catch (Exception ex) {
                    continue;
                }
                out.add(new Deal(
                    d,
                    n.path("symbol").asText(),
                    n.path("securityName").asText(),
                    n.path("clientName").asText(),
                    n.path("buySell").asText().toUpperCase(),
                    n.path("quantity").asLong(),
                    n.path("price").asDouble(),
                    n.path("valueCr").asDouble(),
                    isBlock
                ));
            }
            return out;
        } catch (Exception e) {
            log.warn("Failed to parse deal array: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    private String normalizeMonthCase(String dateStr) {
        // Input like "10-APR-2026" → "10-Apr-2026" for DateTimeFormatter
        if (dateStr == null || dateStr.length() < 8) return dateStr;
        String[] parts = dateStr.split("-");
        if (parts.length != 3) return dateStr;
        String month = parts[1];
        if (month.length() >= 3) {
            month = month.substring(0, 1).toUpperCase() + month.substring(1).toLowerCase();
        }
        return parts[0] + "-" + month + "-" + parts[2];
    }

    /** Returns the full symbol → delivery% map from the most recent bhavcopy run. */
    public Map<String, Double> fetchDeliveryBySymbol() {
        String json = redis.opsForValue().get("market-pulse:delivery-data");
        if (json == null || json.isBlank()) return Collections.emptyMap();
        try {
            JsonNode root = mapper.readTree(json);
            JsonNode bySymbol = root.path("bySymbol");
            if (!bySymbol.isObject()) return Collections.emptyMap();
            Map<String, Double> out = new HashMap<>();
            bySymbol.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue().asDouble()));
            return out;
        } catch (Exception e) {
            log.warn("Failed to parse delivery bySymbol: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }
}
