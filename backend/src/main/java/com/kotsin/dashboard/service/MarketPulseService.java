package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import jakarta.annotation.PostConstruct;
import lombok.Builder;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Market Pulse Service — aggregates macro market data for the Market Pulse page.
 *
 * Data sources:
 * - GIFT Nifty: Kafka topic market-context-giftnifty (from Streaming Candle)
 * - India VIX: extracted from latest FUDKII signals in Redis
 * - Advance/Decline: computed from FUDKII all-latest signals in Redis
 * - INR/USD: from currency tick data if available
 *
 * Broadcasts to /topic/market-pulse via WebSocket for real-time updates.
 */
@Service
@Slf4j
public class MarketPulseService {

    private final StringRedisTemplate redis;
    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper mapper = new ObjectMapper();

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** NSE holidays 2026 — 16 dates when NSE equity/F&O does not trade. */
    private static final Set<LocalDate> NSE_HOLIDAYS_2026 = Set.of(
        LocalDate.of(2026, 1, 15),  // Municipal Corporation Election - Maharashtra
        LocalDate.of(2026, 1, 26),  // Republic Day
        LocalDate.of(2026, 3, 3),   // Holi
        LocalDate.of(2026, 3, 26),  // Shri Ram Navami
        LocalDate.of(2026, 3, 31),  // Shri Mahavir Jayanti
        LocalDate.of(2026, 4, 3),   // Good Friday
        LocalDate.of(2026, 4, 14),  // Dr. Baba Saheb Ambedkar Jayanti
        LocalDate.of(2026, 5, 1),   // Maharashtra Day
        LocalDate.of(2026, 5, 28),  // Bakri Id
        LocalDate.of(2026, 6, 26),  // Muharram
        LocalDate.of(2026, 9, 14),  // Ganesh Chaturthi
        LocalDate.of(2026, 10, 2),  // Mahatma Gandhi Jayanti
        LocalDate.of(2026, 10, 20), // Dussehra
        LocalDate.of(2026, 11, 10), // Diwali-Balipratipada
        LocalDate.of(2026, 11, 24), // Prakash Gurpurb Sri Guru Nanak Dev
        LocalDate.of(2026, 12, 25)  // Christmas
    );

    /** MCX holidays 2026 — only 5 dates where MCX evening session is also closed. */
    private static final Set<LocalDate> MCX_HOLIDAYS_2026 = Set.of(
        LocalDate.of(2026, 1, 1),   // New Year — NSE open, MCX evening closed
        LocalDate.of(2026, 1, 26),  // Republic Day
        LocalDate.of(2026, 4, 3),   // Good Friday
        LocalDate.of(2026, 10, 2),  // Mahatma Gandhi Jayanti
        LocalDate.of(2026, 12, 25)  // Christmas
    );

    /** Returns true during NSE trading hours (9:00–15:30 IST) on non-holiday weekdays. */
    private boolean isNseTradingHours() {
        ZonedDateTime now = ZonedDateTime.now(IST);
        DayOfWeek dow = now.getDayOfWeek();
        if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) return false;
        if (NSE_HOLIDAYS_2026.contains(now.toLocalDate())) return false;
        LocalTime time = now.toLocalTime();
        return !time.isBefore(LocalTime.of(9, 0)) && !time.isAfter(LocalTime.of(15, 30));
    }

    /** Returns true if today is a weekday (Mon–Fri). Global markets trade 24h on weekdays. */
    private boolean isWeekday() {
        DayOfWeek dow = ZonedDateTime.now(IST).getDayOfWeek();
        return dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY;
    }

    // In-memory macro state
    private volatile MacroSnapshot latestSnapshot = MacroSnapshot.empty();

    // SGX Nifty Last Trade (from sgxnifty.org live scrape — not overwritten by NIFTY spot ticks)
    private volatile double sgxNiftyLastTrade = 0;
    private volatile long sgxNiftyLastTradeTimestamp = 0;

    // GIFT Nifty state (from Kafka)
    private volatile double giftNiftyPrice = 0;
    private volatile double giftNiftyChange = 0;
    private volatile double giftNiftyChangePct = 0;
    private volatile double giftNiftyOpen = 0;
    private volatile double giftNiftyHigh = 0;
    private volatile double giftNiftyLow = 0;
    private volatile double giftNiftyPrevClose = 0;
    private volatile double giftNiftyOvernightChangePct = 0;

    // International indices (from GIFT Nifty Kafka)
    private volatile double dowChange = 0;
    private volatile double sp500Change = 0;
    private volatile double nasdaqChange = 0;
    private volatile double dowPrice = 0;
    private volatile double sp500Price = 0;
    private volatile double nasdaqPrice = 0;
    // Additional global indicators
    private volatile double dxyPrice = 0;
    private volatile double dxyChangePct = 0;
    private volatile double usVixPrice = 0;
    private volatile double usVixChangePct = 0;
    private volatile double crudeOilPrice = 0;
    private volatile double crudeOilChangePct = 0;
    private volatile double brentOilPrice = 0;
    private volatile double brentOilChangePct = 0;
    private volatile double goldPrice = 0;
    private volatile double goldChangePct = 0;
    private volatile double usdInrPrice = 0;
    private volatile double usdInrChangePct = 0;
    // Previous prices for computing % change (producer sends raw prices, not %)
    private volatile double dowPrevPrice = 0;
    private volatile double sp500PrevPrice = 0;
    private volatile double nasdaqPrevPrice = 0;

    // VIX state (from FUDKII Redis)
    private volatile double indiaVix = 0;
    private volatile String vixRegime = "N/A";

    public MarketPulseService(StringRedisTemplate redis, WebSocketSessionManager sessionManager) {
        this.redis = redis;
        this.sessionManager = sessionManager;
    }

    @PostConstruct
    public void init() {
        log.info("[MARKET-PULSE] Initializing — loading macro data from Redis");
        refreshFromRedis();
    }

    // ======================== KAFKA: GIFT NIFTY ========================

    @KafkaListener(topics = "market-context-giftnifty",
                   groupId = "market-pulse-consumer",
                   containerFactory = "kafkaListenerContainerFactory")
    public void onGiftNiftyData(String payload) {
        try {
            JsonNode root = mapper.readTree(payload);
            // Separate SGX Nifty live scrape from full Kafka data
            String fetchType = root.path("fetchType").asText("");
            if ("LIVE_SCRAPE".equals(fetchType)) {
                double livePrice = root.path("lastPrice").asDouble(0);
                if (livePrice > 10000 && livePrice < 50000) {
                    sgxNiftyLastTrade = livePrice;
                    sgxNiftyLastTradeTimestamp = root.path("fetchTimeEpochMs").asLong(System.currentTimeMillis());
                }
                // Also pick up US indices from live scrape
                double liveDow = root.path("dowChangePct").asDouble(0);
                double liveSp500 = root.path("sp500ChangePct").asDouble(0);
                double liveNasdaq = root.path("nasdaqChangePct").asDouble(0);
                if (liveDow != 0) dowChange = liveDow;
                if (liveSp500 != 0) sp500Change = liveSp500;
                if (liveNasdaq != 0) nasdaqChange = liveNasdaq;
                double liveDowPrice = root.path("dowJones").asDouble(0);
                double liveSp500Price = root.path("sp500").asDouble(0);
                double liveNasdaqPrice = root.path("nasdaq").asDouble(0);
                if (liveDowPrice > 0) dowPrice = liveDowPrice;
                if (liveSp500Price > 0) sp500Price = liveSp500Price;
                if (liveNasdaqPrice > 0) nasdaqPrice = liveNasdaqPrice;
                // Additional indicators
                double v;
                v = root.path("dxyPrice").asDouble(0); if (v > 0) dxyPrice = v;
                v = root.path("dxyChangePct").asDouble(0); if (v != 0) dxyChangePct = v;
                v = root.path("usVixPrice").asDouble(0); if (v > 0) usVixPrice = v;
                v = root.path("usVixChangePct").asDouble(0); if (v != 0) usVixChangePct = v;
                v = root.path("crudeOilPrice").asDouble(0); if (v > 0) crudeOilPrice = v;
                v = root.path("crudeOilChangePct").asDouble(0); if (v != 0) crudeOilChangePct = v;
                v = root.path("brentOilPrice").asDouble(0); if (v > 0) brentOilPrice = v;
                v = root.path("brentOilChangePct").asDouble(0); if (v != 0) brentOilChangePct = v;
                v = root.path("goldPrice").asDouble(0); if (v > 0) goldPrice = v;
                v = root.path("goldChangePct").asDouble(0); if (v != 0) goldChangePct = v;
                v = root.path("usdInrPrice").asDouble(0); if (v > 0) usdInrPrice = v;
                v = root.path("usdInrChangePct").asDouble(0); if (v != 0) usdInrChangePct = v;
                return; // Don't overwrite OHLC/change fields from a live-only scrape
            }
            giftNiftyPrice = root.path("lastPrice").asDouble(giftNiftyPrice);
            giftNiftyChange = root.path("change").asDouble(giftNiftyChange);
            giftNiftyChangePct = root.path("changePct").asDouble(giftNiftyChangePct);
            giftNiftyOpen = root.path("open").asDouble(giftNiftyOpen);
            giftNiftyHigh = root.path("high").asDouble(giftNiftyHigh);
            giftNiftyLow = root.path("low").asDouble(giftNiftyLow);
            giftNiftyPrevClose = root.path("prevClose").asDouble(giftNiftyPrevClose);
            giftNiftyOvernightChangePct = root.path("overnightChangePct").asDouble(giftNiftyOvernightChangePct);

            // International indices — producer sends raw prices as "dowJones", "sp500", "nasdaq"
            // Compute % change from consecutive fetches (pre-market vs NSE close)
            double dowPrice = root.path("dowJones").asDouble(0);
            double sp500Price = root.path("sp500").asDouble(0);
            double nasdaqPrice = root.path("nasdaq").asDouble(0);
            if (dowPrice > 0) {
                if (dowPrevPrice > 0) dowChange = Math.round((dowPrice - dowPrevPrice) / dowPrevPrice * 10000.0) / 100.0;
                dowPrevPrice = dowPrice;
            }
            if (sp500Price > 0) {
                if (sp500PrevPrice > 0) sp500Change = Math.round((sp500Price - sp500PrevPrice) / sp500PrevPrice * 10000.0) / 100.0;
                sp500PrevPrice = sp500Price;
            }
            if (nasdaqPrice > 0) {
                if (nasdaqPrevPrice > 0) nasdaqChange = Math.round((nasdaqPrice - nasdaqPrevPrice) / nasdaqPrevPrice * 10000.0) / 100.0;
                nasdaqPrevPrice = nasdaqPrice;
            }
            // Also accept direct % if producer ever sends them
            dowChange = root.path("dowChangePct").asDouble(dowChange);
            sp500Change = root.path("sp500ChangePct").asDouble(sp500Change);
            nasdaqChange = root.path("nasdaqChangePct").asDouble(nasdaqChange);

            log.info("[MARKET-PULSE] GIFT Nifty update: {} ({:+.2f}%)", giftNiftyPrice, giftNiftyChangePct);
            rebuildAndBroadcast();
        } catch (Exception e) {
            log.warn("[MARKET-PULSE] Failed to parse GIFT Nifty Kafka: {}", e.getMessage());
        }
    }

    // ======================== SCHEDULED REFRESH ========================

    @Scheduled(fixedRate = 60000) // Every 60 seconds
    public void scheduledRefresh() {
        // Global market data (DOW, Crude, Gold, etc.) is 24h on weekdays — always refresh
        // India VIX is gated inside extractVixFromFudkii() to NSE hours only
        if (!isWeekday()) return;
        refreshFromRedis();
        rebuildAndBroadcast();
    }

    // ======================== DATA EXTRACTION ========================

    private void refreshFromRedis() {
        try {
            extractVixFromFudkii();
            extractNiftyFromTicks();
        } catch (Exception e) {
            log.warn("[MARKET-PULSE] Redis refresh error: {}", e.getMessage());
        }
    }

    /**
     * Extract NIFTY spot price from tick candle history in Redis.
     * Replaces the broken sgxnifty.org scraper with real-time 5paisa data.
     * NIFTY spot (999920000) and NIFTY futures (66691) are already subscribed.
     */
    private void extractNiftyFromTicks() {
        try {
            // Read latest 1m candle for NIFTY spot (999920000)
            String raw = redis.opsForList().index("tick:999920000:1m:history", -1);
            if (raw == null || raw.isEmpty()) return;

            com.fasterxml.jackson.databind.JsonNode node = mapper.readTree(raw);
            // Jackson typed array: ["className", {...}]
            com.fasterxml.jackson.databind.JsonNode data = node.isArray() && node.size() == 2 ? node.get(1) : node;

            double close = data.path("close").asDouble(0);
            double open = data.path("open").asDouble(0);
            double high = data.path("high").asDouble(0);
            double low = data.path("low").asDouble(0);

            if (close <= 0) return;

            // Previous close from ScripGroup (stored as closePrice on NIFTY ScripGroup entry)
            // Use the stored prevClose if we have it, otherwise compute from first candle of day
            double prevClose = giftNiftyPrevClose;
            if (prevClose <= 0) {
                // Read first candle of today for opening reference
                String firstRaw = redis.opsForList().index("tick:999920000:1m:history", 0);
                if (firstRaw != null) {
                    com.fasterxml.jackson.databind.JsonNode firstNode = mapper.readTree(firstRaw);
                    com.fasterxml.jackson.databind.JsonNode firstData = firstNode.isArray() && firstNode.size() == 2 ? firstNode.get(1) : firstNode;
                    prevClose = firstData.path("open").asDouble(0);
                }
            }

            giftNiftyPrice = close;
            giftNiftyOpen = open;
            giftNiftyHigh = high;
            giftNiftyLow = low;
            if (prevClose > 0) {
                giftNiftyPrevClose = prevClose;
                giftNiftyChange = Math.round((close - prevClose) * 100.0) / 100.0;
                giftNiftyChangePct = Math.round((close - prevClose) / prevClose * 10000.0) / 100.0;
            }
        } catch (Exception e) {
            log.debug("[MARKET-PULSE] NIFTY tick extraction failed: {}", e.getMessage());
        }
    }

    private final org.springframework.web.client.RestTemplate vixRestTemplate = new org.springframework.web.client.RestTemplate();

    private void extractVixFromFudkii() {
        // Primary: fetch directly from FastAnalytics (always fresh, works after NSE close too)
        // No NSE hours gate — after close, FastAnalytics returns the closing VIX which is correct to display
        try {
            String json = vixRestTemplate.getForObject("http://localhost:8002/api/vix", String.class);
            if (json != null) {
                JsonNode node = mapper.readTree(json);
                double vix = node.path("vix").asDouble(0);
                if (vix > 0) {
                    indiaVix = vix;
                    vixRegime = classifyVixRegime(vix);
                    return;
                }
            }
        } catch (Exception e) {
            log.debug("[MARKET-PULSE] Direct VIX fetch from FastAnalytics failed, falling back to FUDKII signals: {}", e.getMessage());
        }

        // Fallback: get latest VIX from any FUDKII signal in Redis
        Map<Object, Object> allLatest = redis.opsForHash().entries("dashboard:fudkii:all-latest");
        if (allLatest == null || allLatest.isEmpty()) return;

        double latestVix = 0;
        String latestVixRegime = "N/A";
        long latestTime = 0;

        for (var entry : allLatest.entrySet()) {
            try {
                JsonNode node = mapper.readTree(entry.getValue().toString());
                long cachedAt = node.path("cachedAt").asLong(0);
                if (cachedAt > latestTime && node.has("indiaVix")) {
                    latestTime = cachedAt;
                    latestVix = node.path("indiaVix").asDouble(0);
                    latestVixRegime = node.path("vixRegime").asText("N/A");
                    if (giftNiftyOvernightChangePct == 0) {
                        giftNiftyOvernightChangePct = node.path("giftNiftyOvernightChangePct").asDouble(0);
                    }
                }
            } catch (Exception ignored) {}
        }

        if (latestVix > 0) {
            indiaVix = latestVix;
            vixRegime = latestVixRegime;
        }
    }

    private static String classifyVixRegime(double vix) {
        if (vix >= 30) return "Extreme fear — crisis/war regime";
        if (vix >= 25) return "Very high fear";
        if (vix >= 20) return "Elevated fear regime";
        if (vix >= 16) return "Normal volatility";
        if (vix >= 13) return "Below-average fear";
        return "Low fear — complacent market";
    }

    private AdvanceDecline computeAdvanceDecline() {
        // Read A/D from Redis — scraped from NSE NIFTY TOTAL MARKET (750 scrips) by FastAnalytics
        try {
            String raw = redis.opsForValue().get("market-pulse:advance-decline");
            if (raw != null) {
                JsonNode node = mapper.readTree(raw);
                int advances = node.path("advances").asInt(0);
                int declines = node.path("declines").asInt(0);
                int unchanged = node.path("unchanged").asInt(0);
                double ratio = node.path("ratio").asDouble(1.0);
                return AdvanceDecline.builder()
                        .advances(advances).declines(declines).unchanged(unchanged)
                        .ratio(ratio)
                        .build();
            }
        } catch (Exception e) {
            log.warn("[MARKET-PULSE] Failed to read A/D from Redis: {}", e.getMessage());
        }
        return AdvanceDecline.builder().build();
    }

    // ======================== SNAPSHOT BUILD & BROADCAST ========================

    private void rebuildAndBroadcast() {
        AdvanceDecline ad = computeAdvanceDecline();

        latestSnapshot = MacroSnapshot.builder()
                .giftNiftyPrice(giftNiftyPrice)
                .giftNiftyChange(giftNiftyChange)
                .giftNiftyChangePct(giftNiftyChangePct)
                .giftNiftyOvernightChangePct(giftNiftyOvernightChangePct)
                .giftNiftyOpen(giftNiftyOpen)
                .giftNiftyHigh(giftNiftyHigh)
                .giftNiftyLow(giftNiftyLow)
                .giftNiftyPrevClose(giftNiftyPrevClose)
                .indiaVix(indiaVix)
                .vixRegime(vixRegime)
                .dowPrice(dowPrice)
                .sp500Price(sp500Price)
                .nasdaqPrice(nasdaqPrice)
                .dowChangePct(dowChange)
                .sp500ChangePct(sp500Change)
                .nasdaqChangePct(nasdaqChange)
                .dxyPrice(dxyPrice)
                .dxyChangePct(dxyChangePct)
                .usVixPrice(usVixPrice)
                .usVixChangePct(usVixChangePct)
                .crudeOilPrice(crudeOilPrice)
                .crudeOilChangePct(crudeOilChangePct)
                .brentOilPrice(brentOilPrice)
                .brentOilChangePct(brentOilChangePct)
                .goldPrice(goldPrice)
                .goldChangePct(goldChangePct)
                .usdInrPrice(usdInrPrice)
                .usdInrChangePct(usdInrChangePct)
                .sgxNiftyLastTrade(sgxNiftyLastTrade)
                .sgxNiftyLastTradeTimestamp(sgxNiftyLastTradeTimestamp)
                .advanceDecline(ad)
                .timestamp(System.currentTimeMillis())
                .build();

        sessionManager.broadcastMarketPulse(latestSnapshot);
    }

    public MacroSnapshot getLatestSnapshot() {
        return latestSnapshot;
    }

    // ======================== PHASE 2: REDIS DATA READERS ========================

    /**
     * Get block deals for last 5 trading days from Redis.
     */
    public List<Map<String, Object>> getBlockDeals() {
        List<Map<String, Object>> all = new ArrayList<>();
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        String lastFetch = redis.opsForValue().get("market-pulse:last-fetch:block-deals");
        for (int i = 0; i < 8; i++) {
            String date = today.minusDays(i).toString();
            String raw = redis.opsForValue().get("market-pulse:block-deals:" + date);
            if (raw != null) {
                try {
                    List<Map<String, Object>> deals = mapper.readValue(raw,
                            mapper.getTypeFactory().constructCollectionType(List.class, Map.class));
                    for (Map<String, Object> d : deals) {
                        d.put("_date", date);
                        if (lastFetch != null) d.put("_lastFetchEpoch", Long.parseLong(lastFetch));
                    }
                    all.addAll(deals);
                } catch (Exception e) { log.warn("[MARKET-PULSE] Parse block deals error: {}", e.getMessage()); }
            }
        }
        return all;
    }

    /**
     * Get bulk deals for last 5 trading days from Redis.
     */
    public List<Map<String, Object>> getBulkDeals() {
        List<Map<String, Object>> all = new ArrayList<>();
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        String lastFetch = redis.opsForValue().get("market-pulse:last-fetch:bulk-deals");
        for (int i = 0; i < 8; i++) {
            String date = today.minusDays(i).toString();
            String raw = redis.opsForValue().get("market-pulse:bulk-deals:" + date);
            if (raw != null) {
                try {
                    List<Map<String, Object>> deals = mapper.readValue(raw,
                            mapper.getTypeFactory().constructCollectionType(List.class, Map.class));
                    for (Map<String, Object> d : deals) {
                        d.put("_date", date);
                        if (lastFetch != null) d.put("_lastFetchEpoch", Long.parseLong(lastFetch));
                    }
                    all.addAll(deals);
                } catch (Exception e) { log.warn("[MARKET-PULSE] Parse bulk deals error: {}", e.getMessage()); }
            }
        }
        return all;
    }

    /**
     * Get FII/DII activity for last 5 trading days from Redis.
     */
    public List<Map<String, Object>> getFiiDii() {
        List<Map<String, Object>> results = new ArrayList<>();
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        for (int i = 0; i < 8; i++) {
            String date = today.minusDays(i).toString();
            String raw = redis.opsForValue().get("market-pulse:fii-dii:" + date);
            if (raw != null) {
                try {
                    Map<String, Object> data = mapper.readValue(raw, Map.class);
                    data.put("_date", date);
                    results.add(data);
                    if (results.size() >= 5) break;
                } catch (Exception e) { log.warn("[MARKET-PULSE] Parse FII/DII error: {}", e.getMessage()); }
            }
        }
        return results;
    }

    /**
     * Get corporate events from Redis.
     */
    public List<Map<String, Object>> getCorporateEvents() {
        String raw = redis.opsForValue().get("market-pulse:corporate-events");
        if (raw == null) return Collections.emptyList();
        try {
            return mapper.readValue(raw, mapper.getTypeFactory().constructCollectionType(List.class, Map.class));
        } catch (Exception e) {
            log.warn("[MARKET-PULSE] Parse corporate events error: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Get delivery % data by sector from Redis (scraped from NSE bhavcopy by FastAnalytics).
     */
    public Map<String, Object> getDeliveryData() {
        String raw = redis.opsForValue().get("market-pulse:delivery-data");
        if (raw == null) return Collections.emptyMap();
        try {
            return mapper.readValue(raw, Map.class);
        } catch (Exception e) {
            log.warn("[MARKET-PULSE] Parse delivery data error: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    // ======================== CONVICTION ENGINE ========================

    /**
     * Cross-reference a symbol with institutional events in the 5-day window.
     * Returns conviction data: percentage, color, events list, and template inference text.
     */
    public Map<String, Object> getConvictionForSymbol(String symbol) {
        if (symbol == null || symbol.isBlank()) return Collections.emptyMap();
        String sym = symbol.trim().toUpperCase();

        List<String> events = new ArrayList<>();
        int score = 0;

        // Check block deals
        for (Map<String, Object> deal : getBlockDeals()) {
            if (sym.equals(String.valueOf(deal.get("symbol")).toUpperCase())) {
                double valueCr = toDouble(deal.get("value")) / 1e7;
                events.add(String.format("Block Deal %s: %s vol at %s (%.0fCr)",
                        deal.get("_date"), fmt(deal.get("volume")), fmt(deal.get("price")), valueCr));
                score += 25;
            }
        }

        // Check bulk deals
        for (Map<String, Object> deal : getBulkDeals()) {
            if (sym.equals(String.valueOf(deal.get("symbol")).toUpperCase())) {
                String side = String.valueOf(deal.get("buySell")).toUpperCase();
                events.add(String.format("Bulk Deal %s: %s %s by %s (%.1fCr)",
                        deal.get("_date"), side, fmt(deal.get("quantity")),
                        deal.get("clientName"), toDouble(deal.get("valueCr"))));
                score += 20;
            }
        }

        // Check FII/DII (these are market-wide, not per-symbol — add as context)
        List<Map<String, Object>> fiiDii = getFiiDii();
        if (!fiiDii.isEmpty()) {
            Map<String, Object> latest = fiiDii.get(0);
            Map<String, Object> fii = (Map<String, Object>) latest.get("FII");
            Map<String, Object> dii = (Map<String, Object>) latest.get("DII");
            if (fii != null) {
                double fiiNet = toDouble(fii.get("netValue"));
                events.add(String.format("FII %s: %s%.0fCr (%s)",
                        latest.get("_date"), fiiNet >= 0 ? "+" : "", fiiNet,
                        fiiNet >= 0 ? "NET BUY" : "NET SELL"));
                if (fiiNet > 1000) score += 15;
                else if (fiiNet < -1000) score += 10;
            }
            if (dii != null) {
                double diiNet = toDouble(dii.get("netValue"));
                events.add(String.format("DII %s: %s%.0fCr (%s)",
                        latest.get("_date"), diiNet >= 0 ? "+" : "", diiNet,
                        diiNet >= 0 ? "NET BUY" : "NET SELL"));
            }
        }

        // Check corporate events
        for (Map<String, Object> event : getCorporateEvents()) {
            if (sym.equals(String.valueOf(event.get("symbol")).toUpperCase())) {
                events.add(String.format("Event %s: %s — %s",
                        event.get("date"), event.get("purpose"), event.get("company")));
                score += 15;
            }
        }

        // Cap at 100
        int conviction = Math.min(score, 100);

        // Determine color
        String color;
        if (conviction >= 70) color = "green";
        else if (conviction >= 50) color = "amber";
        else if (conviction >= 30) color = "yellow";
        else color = "slate";

        // Generate template inference text
        String inference = buildInferenceText(sym, events, conviction);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("symbol", sym);
        result.put("conviction", conviction);
        result.put("color", color);
        result.put("events", events);
        result.put("inference", inference);
        return result;
    }

    private String buildInferenceText(String symbol, List<String> events, int conviction) {
        if (events.isEmpty()) return "No institutional activity detected in 5-day window.";

        StringBuilder sb = new StringBuilder();
        sb.append(symbol).append(": ");

        long blockCount = events.stream().filter(e -> e.startsWith("Block")).count();
        long bulkCount = events.stream().filter(e -> e.startsWith("Bulk")).count();
        long eventCount = events.stream().filter(e -> e.startsWith("Event")).count();
        boolean hasFii = events.stream().anyMatch(e -> e.startsWith("FII"));

        if (blockCount > 0) sb.append(blockCount).append(" block deal(s)");
        if (bulkCount > 0) {
            if (blockCount > 0) sb.append(" + ");
            sb.append(bulkCount).append(" bulk deal(s)");
        }
        if (hasFii) {
            if (blockCount > 0 || bulkCount > 0) sb.append(" + ");
            sb.append("FII/DII flow");
        }
        if (eventCount > 0) {
            if (blockCount > 0 || bulkCount > 0 || hasFii) sb.append(" + ");
            sb.append(eventCount).append(" upcoming event(s)");
        }

        sb.append(" in 5-day window. Conviction: ").append(conviction).append("%.");
        return sb.toString();
    }

    private double toDouble(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (Exception e) { return 0; }
    }

    private String fmt(Object val) {
        if (val == null) return "0";
        if (val instanceof Number) return String.format("%,.0f", ((Number) val).doubleValue());
        return val.toString();
    }

    // ======================== DTOs ========================

    @Data
    @Builder
    public static class MacroSnapshot {
        private double giftNiftyPrice;
        private double giftNiftyChange;
        private double giftNiftyChangePct;
        private double giftNiftyOvernightChangePct;
        private double giftNiftyOpen;
        private double giftNiftyHigh;
        private double giftNiftyLow;
        private double giftNiftyPrevClose;
        private double indiaVix;
        private String vixRegime;
        private double dowPrice;
        private double sp500Price;
        private double nasdaqPrice;
        private double dowChangePct;
        private double sp500ChangePct;
        private double nasdaqChangePct;
        private double dxyPrice;
        private double dxyChangePct;
        private double usVixPrice;
        private double usVixChangePct;
        private double crudeOilPrice;
        private double crudeOilChangePct;
        private double brentOilPrice;
        private double brentOilChangePct;
        private double goldPrice;
        private double goldChangePct;
        private double usdInrPrice;
        private double usdInrChangePct;
        private double sgxNiftyLastTrade;
        private long sgxNiftyLastTradeTimestamp;
        private AdvanceDecline advanceDecline;
        private long timestamp;

        public static MacroSnapshot empty() {
            return MacroSnapshot.builder()
                    .vixRegime("N/A")
                    .advanceDecline(AdvanceDecline.builder().build())
                    .timestamp(System.currentTimeMillis())
                    .build();
        }
    }

    @Data
    @Builder
    public static class AdvanceDecline {
        @Builder.Default private int advances = 0;
        @Builder.Default private int declines = 0;
        @Builder.Default private int unchanged = 0;
        @Builder.Default private double ratio = 1.0;
    }
}
