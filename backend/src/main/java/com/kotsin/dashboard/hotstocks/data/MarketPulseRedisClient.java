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

    /**
     * Read a nested DTO for deals from Redis key shape. Pre-computed valueCr preserved.
     * <p>
     * {@code isShortSell} is set when the deal was synthesized from the NSE short-selling
     * disclosure feed (buySell = "SELL", clientName = "SHORT_SELL_DISCLOSURE").
     * For bulk + block deals it stays {@code false}.
     */
    public record Deal(
        LocalDate date,
        String symbol,
        String securityName,
        String clientName,
        String buySell,      // "BUY" / "SELL"
        long quantity,
        double price,
        double valueCr,
        boolean isBlock,
        boolean isShortSell
    ) {
        /** Back-compat ctor: defaults {@code isShortSell} to {@code false}. */
        public Deal(LocalDate date, String symbol, String securityName, String clientName,
                    String buySell, long quantity, double price, double valueCr, boolean isBlock) {
            this(date, symbol, securityName, clientName, buySell,
                quantity, price, valueCr, isBlock, false);
        }
    }

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

    /**
     * Fetch bulk + block deals across an inclusive date range, optionally folding in
     * SHORT_DEALS from {@code market-pulse:short-selling:{YYYY-MM-DD}} as synthesized
     * sell-side {@link Deal} rows. Short-selling rows get:
     * <ul>
     *   <li>{@code buySell = "SELL"}</li>
     *   <li>{@code isShortSell = true}</li>
     *   <li>{@code isBlock = false}</li>
     *   <li>{@code clientName = "SHORT_SELL_DISCLOSURE"} (no disclosed counterparty)</li>
     *   <li>{@code valueCr = qty * price / 1e7}</li>
     * </ul>
     * When the {@code price} field is absent (older rows only had {@code quantity}),
     * {@code price} defaults to 0 and {@code valueCr} falls to 0 too — the caller can
     * still use quantity-weighted signals.
     *
     * @param includeShortSelling when {@code false}, behavior equals {@link #fetchDeals}.
     */
    public List<Deal> loadDealsWithOptionalShortSelling(LocalDate from, LocalDate to,
                                                       boolean includeShortSelling) {
        List<Deal> out = new ArrayList<>(fetchDeals(from, to));
        if (!includeShortSelling) return out;
        LocalDate d = from;
        while (!d.isAfter(to)) {
            String key = "market-pulse:short-selling:" + d.format(ISO);
            String json = redis.opsForValue().get(key);
            if (json != null && !json.isBlank()) {
                out.addAll(parseShortSellingArray(json, d));
            }
            d = d.plusDays(1);
        }
        return out;
    }

    /**
     * Parse the short-selling JSON array stored by FastAnalytics
     * {@code fetch_short_selling()} into synthesized sell-side {@link Deal}s.
     * <p>
     * Schema (per FastAnalytics {@code nse_market_pulse_service.py}):
     * <pre>
     *   [{ "date": "2026-04-22", "symbol": "RELIANCE", "securityName": "...",
     *      "quantity": 12345, "price": 2800.5 }, ...]
     * </pre>
     * The {@code price} field may be absent on older rows; in that case we still
     * emit a row with quantity (and valueCr=0) so downstream count/qty aggregates
     * remain correct.
     *
     * @param date fallback date if a row omits its own date field.
     */
    List<Deal> parseShortSellingArray(String json, LocalDate date) {
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {
            JsonNode root = mapper.readTree(json);
            if (!root.isArray()) return Collections.emptyList();
            List<Deal> out = new ArrayList<>();
            int dropped = 0;
            for (JsonNode n : root) {
                String sym = n.path("symbol").asText("").trim();
                if (sym.isEmpty()) { dropped++; continue; }
                LocalDate d = parseDealDate(n.path("date").asText(""));
                if (d == null) d = date;
                long qty = n.path("quantity").asLong(0L);
                double price = n.path("price").asDouble(0.0);
                double valueCr = (qty > 0 && price > 0)
                    ? Math.round((qty * price) / 1e7 * 100.0) / 100.0
                    : 0.0;
                out.add(new Deal(
                    d,
                    sym,
                    n.path("securityName").asText(""),
                    "SHORT_SELL_DISCLOSURE",
                    "SELL",
                    qty,
                    price,
                    valueCr,
                    /* isBlock    */ false,
                    /* isShortSell*/ true
                ));
            }
            if (dropped > 0) {
                log.warn("[MARKET-PULSE-REDIS] dropped {} short-selling row(s) with empty symbol", dropped);
            }
            return out;
        } catch (Exception e) {
            log.warn("Failed to parse short-selling array: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    private List<Deal> parseDealArray(String json, boolean isBlock) {
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {
            JsonNode root = mapper.readTree(json);
            if (!root.isArray()) return Collections.emptyList();
            List<Deal> out = new ArrayList<>();
            int dropped = 0;
            for (JsonNode n : root) {
                String dateStr = n.path("date").asText();
                LocalDate d = parseDealDate(dateStr);
                if (d == null) { dropped++; continue; }
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
            if (dropped > 0) {
                log.warn("[MARKET-PULSE-REDIS] dropped {} deal(s) with unparseable date (block={})",
                    dropped, isBlock);
            }
            return out;
        } catch (Exception e) {
            log.warn("Failed to parse deal array: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Accept two date formats that have appeared in the NSE deals feed over time:
     * <ul>
     *   <li>{@code 17-APR-2026} — legacy NSE CSV style (DD-MMM-YYYY, case-insensitive)</li>
     *   <li>{@code 2026-04-17} — modern ISO yyyy-MM-dd, introduced ~Apr 2026 in the nsepython
     *       get_bulkdeals() return shape. Python scraper stores the raw NSE value.</li>
     * </ul>
     * Returns null on unparseable input so the caller can drop the row without throwing.
     */
    static LocalDate parseDealDate(String dateStr) {
        if (dateStr == null || dateStr.isBlank()) return null;
        // ISO first — it's the modern format and most rows will hit this branch.
        try {
            return LocalDate.parse(dateStr, ISO);
        } catch (Exception ignored) { /* fall through */ }
        // Legacy DD-MMM-YYYY (any case).
        try {
            return LocalDate.parse(normalizeMonthCase(dateStr), DD_MMM_YYYY);
        } catch (Exception ignored) { /* fall through */ }
        return null;
    }

    private static String normalizeMonthCase(String dateStr) {
        if (dateStr == null || dateStr.length() < 8) return dateStr;
        String[] parts = dateStr.split("-");
        if (parts.length != 3) return dateStr;
        String month = parts[1];
        if (month.length() >= 3) {
            month = month.substring(0, 1).toUpperCase() + month.substring(1).toLowerCase();
        }
        return parts[0] + "-" + month + "-" + parts[2];
    }

    /**
     * Returns short-interest delta for each symbol: (sum of last 5 trading days) vs
     * (sum of prior 5 trading days), expressed as a ratio delta.
     *
     * Formula: deltaRatio = (recent5dSum / max(prior5dSum, 1)) - 1
     *   +0.50 = short interest grew 50%
     *    0.00 = flat
     *   -0.30 = short interest fell 30%
     *
     * Data source: market-pulse:short-selling:{YYYY-MM-DD} lists published by the
     * NSE historical backfill + daily scraper. Returns empty map if no data in window.
     * Called once per HotStocks enrichment cycle — O(10 redis GETs).
     */
    public Map<String, Double> fetchShortInterestDelta5d() {
        LocalDate today = LocalDate.now();
        // Walk back up to 14 calendar days to collect 10 trading days of data (5 + 5).
        List<String> recentDates = new ArrayList<>();
        List<String> priorDates = new ArrayList<>();
        int daysBack = 1;
        while ((recentDates.size() < 5 || priorDates.size() < 5) && daysBack < 20) {
            LocalDate d = today.minusDays(daysBack);
            // weekday filter (Mon-Fri) — NSE holidays not filtered here but missing keys naturally skip
            if (d.getDayOfWeek().getValue() < 6) {
                String dateStr = d.format(ISO);
                String key = "market-pulse:short-selling:" + dateStr;
                if (redis.hasKey(key)) {
                    (recentDates.size() < 5 ? recentDates : priorDates).add(dateStr);
                }
            }
            daysBack++;
        }
        if (recentDates.isEmpty() || priorDates.isEmpty()) {
            log.debug("fetchShortInterestDelta5d: insufficient short-sell history (recent={}, prior={})",
                recentDates.size(), priorDates.size());
            return Collections.emptyMap();
        }

        Map<String, Long> recentSum = aggregateShortQty(recentDates);
        Map<String, Long> priorSum  = aggregateShortQty(priorDates);

        Map<String, Double> out = new HashMap<>();
        // Union of symbols that appeared in either window
        java.util.Set<String> syms = new java.util.HashSet<>(recentSum.keySet());
        syms.addAll(priorSum.keySet());
        for (String s : syms) {
            long r = recentSum.getOrDefault(s, 0L);
            long p = priorSum.getOrDefault(s, 0L);
            if (p <= 0) {
                // No prior activity — treat as strong delta if recent exists, else skip.
                if (r > 0) out.put(s, 1.0); // +100% (new short-selling emerged)
            } else {
                out.put(s, ((double) r / p) - 1.0);
            }
        }
        return out;
    }

    /** Sum quantity by symbol across the given daily list keys. */
    private Map<String, Long> aggregateShortQty(List<String> dateKeys) {
        Map<String, Long> sums = new HashMap<>();
        for (String dateStr : dateKeys) {
            String json = redis.opsForValue().get("market-pulse:short-selling:" + dateStr);
            if (json == null || json.isBlank()) continue;
            try {
                JsonNode arr = mapper.readTree(json);
                if (!arr.isArray()) continue;
                for (JsonNode n : arr) {
                    String sym = n.path("symbol").asText("");
                    long q = n.path("quantity").asLong(0);
                    if (!sym.isEmpty()) sums.merge(sym, q, Long::sum);
                }
            } catch (Exception e) {
                log.debug("aggregateShortQty parse fail for {}: {}", dateStr, e.getMessage());
            }
        }
        return sums;
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
