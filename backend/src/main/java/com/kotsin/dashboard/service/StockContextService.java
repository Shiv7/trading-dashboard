package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * StockContextService — aggregates ALL data the Stock Detail Page needs from
 * Redis, MongoDB, and the insights cache into a single response map.
 *
 * Data sources:
 *   1. ScripGroup (Mongo) → identity: name, exchange, type, expiry, lotSize, multiplier
 *   2. unified:{scripCode}:1d:history (Redis list) → OHLCV for latest 20 days → compute ATR
 *   3. oi_metrics_1m (Mongo) → OI daily trend (5 days) → compute buildup per day
 *   4. iv:history:{scripCode} (Redis ZSET) → latest IV
 *   5. trade_outcomes (Mongo) → historical P&L on this scrip → win rate + total PnL
 *   6. dashboard:signal-history:{scripCode}* (Redis strings) → recent signals
 *   7. virtual:positions:{scripCode} (Redis string) → open position if any
 *   8. hotstocks:v1:{scripCode} (Redis string) → enrichment data (1d/5d/20d changes)
 *   9. MarketPulseService.getLatestSnapshot() → macro context
 *  10. bulk/block deals from MarketPulseService → filter by symbol
 *  11. Computed: verdict score, risk flags, smart levels, OI buildup classification
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class StockContextService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final StringRedisTemplate redis;
    private final MongoTemplate mongoTemplate;
    private final MarketPulseService marketPulseService;
    private final ObjectMapper mapper = new ObjectMapper();

    @SuppressWarnings("unchecked")
    public Map<String, Object> buildContext(String scripCode) {
        Map<String, Object> ctx = new LinkedHashMap<>();
        ctx.put("scripCode", scripCode);

        try {
            // ── 1. IDENTITY from ScripGroup ──
            Document sg = mongoTemplate.getCollection("ScripGroup").find(new Document("_id", scripCode)).first();
            Map<String, Object> identity = buildIdentity(sg, scripCode);
            ctx.put("identity", identity);

            String symbol = (String) identity.get("symbolRoot");
            String exchange = (String) identity.get("exchange");
            String instrumentType = (String) identity.get("instrumentType");
            boolean isCommodity = "M".equals(exchange);
            boolean isCurrency = "C".equals(exchange);
            boolean isDerivative = "FUT".equals(instrumentType) || "OPT".equals(instrumentType);

            // ── 2. OHLCV + ATR from Redis unified candles ──
            Map<String, Object> priceData = buildPriceData(scripCode);
            ctx.put("price", priceData);

            // ── 3. OI daily trend (derivatives only) ──
            if (isDerivative) {
                ctx.put("oiTrend", buildOiTrend(scripCode));
            }

            // ── 4. IV (derivatives only) ──
            if (isDerivative) {
                ctx.put("latestIV", getLatestIV(scripCode));
            }

            // ── 5. TRACK RECORD from trade_outcomes ──
            ctx.put("trackRecord", buildTrackRecord(scripCode));

            // ── 6. RECENT SIGNALS from Redis ──
            ctx.put("signals", buildSignals(scripCode));

            // ── 7. OPEN POSITION from Redis ──
            ctx.put("position", buildPosition(scripCode));

            // ── 8. HOTSTOCKS ENRICHMENT (F&O equities) ──
            ctx.put("enrichment", buildEnrichment(scripCode));

            // ── 9. MACRO CONTEXT ──
            ctx.put("macro", buildMacroContext(isCommodity, isCurrency, exchange));

            // ── 10. DEALS (equities only) ──
            if (!isCommodity && !isCurrency) {
                ctx.put("deals", buildDeals(symbol));
            }

            // ── 11. RISK FLAGS + VERDICT ──
            ctx.put("riskFlags", buildRiskFlags(ctx));
            ctx.put("verdict", buildVerdict(ctx));

        } catch (Exception e) {
            log.error("[STOCK_CTX] Error building context for {}: {}", scripCode, e.getMessage(), e);
            ctx.put("error", e.getMessage());
        }

        return ctx;
    }

    // ═══════════════════════════════════════
    // 1. IDENTITY
    // ═══════════════════════════════════════
    private Map<String, Object> buildIdentity(Document sg, String scripCode) {
        Map<String, Object> id = new LinkedHashMap<>();
        if (sg == null) {
            id.put("companyName", scripCode);
            id.put("exchange", "N");
            id.put("instrumentType", "EQ");
            id.put("symbolRoot", scripCode);
            return id;
        }
        Document eq = (Document) sg.get("equity");
        id.put("companyName", sg.getString("companyName"));
        id.put("tradingType", sg.getString("tradingType"));
        id.put("symbolRoot", eq != null ? eq.getString("SymbolRoot") : scripCode);
        id.put("exchange", eq != null ? eq.getString("Exch") : "N");
        String exchType = eq != null ? eq.getString("ExchType") : "C";
        id.put("exchangeType", exchType);
        // Determine instrument type
        String scripType = eq != null ? eq.getString("ScripType") : "";
        double strike = eq != null ? safeDouble(eq.get("StrikeRate")) : 0;
        String instType;
        if (strike > 0 || "CE".equals(scripType) || "PE".equals(scripType)) instType = "OPT";
        else if ("D".equals(exchType) || "XX".equals(scripType)) instType = "FUT";
        else instType = "EQ";
        id.put("instrumentType", instType);
        id.put("lotSize", eq != null ? safeInt(eq.get("LotSize")) : 1);
        id.put("multiplier", eq != null ? safeInt(eq.get("Multiplier")) : 1);
        id.put("tickSize", eq != null ? safeDouble(eq.get("TickSize")) : 0.05);
        // Expiry
        String expiry = eq != null ? eq.getString("Expiry") : null;
        id.put("expiry", expiry);
        if (expiry != null) {
            try {
                LocalDate exp = LocalDate.parse(expiry);
                long daysToExpiry = ChronoUnit.DAYS.between(LocalDate.now(IST), exp);
                id.put("daysToExpiry", daysToExpiry);
                id.put("expiryLabel", daysToExpiry <= 0 ? "EXPIRED" :
                    daysToExpiry <= 3 ? "EXPIRY IMMINENT" :
                    daysToExpiry <= 7 ? "EXPIRY NEAR" : daysToExpiry + " days");
            } catch (Exception ignored) {}
        }
        return id;
    }

    // ═══════════════════════════════════════
    // 2. PRICE + ATR
    // ═══════════════════════════════════════
    @SuppressWarnings("unchecked")
    private Map<String, Object> buildPriceData(String scripCode) {
        Map<String, Object> price = new LinkedHashMap<>();
        try {
            String key = "unified:" + scripCode + ":1d:history";
            List<String> candles = redis.opsForList().range(key, 0, 19);
            if (candles == null || candles.isEmpty()) {
                price.put("available", false);
                return price;
            }
            price.put("available", true);

            // Parse candles (Java-serialized UnifiedCandle: [className, {fields}])
            List<Map<String, Object>> parsedCandles = new ArrayList<>();
            for (String raw : candles) {
                try {
                    Object parsed = mapper.readValue(raw, Object.class);
                    Map<String, Object> candle;
                    if (parsed instanceof List) {
                        List<?> arr = (List<?>) parsed;
                        candle = arr.size() > 1 && arr.get(1) instanceof Map ? (Map<String, Object>) arr.get(1) : null;
                    } else if (parsed instanceof Map) {
                        candle = (Map<String, Object>) parsed;
                    } else candle = null;
                    if (candle != null) parsedCandles.add(candle);
                } catch (Exception ignored) {}
            }

            if (!parsedCandles.isEmpty()) {
                var latest = parsedCandles.get(0);
                price.put("open", toD(latest.get("open")));
                price.put("high", toD(latest.get("high")));
                price.put("low", toD(latest.get("low")));
                price.put("close", toD(latest.get("close")));
                price.put("volume", toD(latest.get("volume")));
                price.put("vwap", toD(latest.get("vwap")));
                price.put("date", latest.get("timestamp"));

                // Compute ATR(20) = average of (high - low) over last 20 candles
                double sumRange = 0;
                int count = 0;
                for (var c : parsedCandles) {
                    double h = toD(c.get("high"));
                    double l = toD(c.get("low"));
                    if (h > 0 && l > 0) { sumRange += (h - l); count++; }
                }
                double atr20 = count > 0 ? sumRange / count : 0;
                double todayRange = toD(latest.get("high")) - toD(latest.get("low"));
                double atrRatio = atr20 > 0 ? todayRange / atr20 : 0;
                price.put("atr20", Math.round(atr20 * 100.0) / 100.0);
                price.put("todayRange", Math.round(todayRange * 100.0) / 100.0);
                price.put("atrRatio", Math.round(atrRatio * 100.0) / 100.0);
                price.put("atrLabel", atrRatio > 1.5 ? "VERY_HIGH_VOL" :
                    atrRatio > 1.2 ? "HIGH_VOL" : atrRatio > 0.8 ? "NORMAL" : "LOW_VOL");

                // 5-day OHLCV series
                List<Map<String, Object>> series5d = new ArrayList<>();
                for (int i = 0; i < Math.min(5, parsedCandles.size()); i++) {
                    var c = parsedCandles.get(i);
                    Map<String, Object> day = new LinkedHashMap<>();
                    day.put("date", c.get("timestamp"));
                    day.put("open", toD(c.get("open")));
                    day.put("high", toD(c.get("high")));
                    day.put("low", toD(c.get("low")));
                    day.put("close", toD(c.get("close")));
                    day.put("volume", toD(c.get("volume")));
                    series5d.add(day);
                }
                price.put("series5d", series5d);

                // Simple 20-day MA
                double sum20 = 0; int cnt20 = 0;
                for (var c : parsedCandles) {
                    double cl = toD(c.get("close"));
                    if (cl > 0) { sum20 += cl; cnt20++; }
                }
                if (cnt20 > 0) price.put("ma20", Math.round(sum20 / cnt20 * 100.0) / 100.0);
            }
        } catch (Exception e) {
            price.put("available", false);
            price.put("error", e.getMessage());
        }
        return price;
    }

    // ═══════════════════════════════════════
    // 3. OI DAILY TREND
    // ═══════════════════════════════════════
    private List<Map<String, Object>> buildOiTrend(String scripCode) {
        List<Map<String, Object>> trend = new ArrayList<>();
        try {
            // Get daily OI aggregates from oi_metrics_1m
            var pipeline = List.of(
                new Document("$match", new Document("scripCode", scripCode)),
                new Document("$sort", new Document("timestamp", -1)),
                new Document("$group", new Document("_id",
                    new Document("$dateToString", new Document("format", "%Y-%m-%d").append("date", "$timestamp")))
                    .append("lastOI", new Document("$first", "$openInterest"))
                    .append("firstOI", new Document("$last", "$openInterest"))
                    .append("prevDayOI", new Document("$first", "$previousDayOI"))),
                new Document("$sort", new Document("_id", -1)),
                new Document("$limit", 5)
            );
            var results = mongoTemplate.getCollection("oi_metrics_1m").aggregate(pipeline).into(new ArrayList<>());
            for (var doc : results) {
                Map<String, Object> day = new LinkedHashMap<>();
                day.put("date", doc.getString("_id"));
                long lastOI = doc.get("lastOI") instanceof Number ? ((Number) doc.get("lastOI")).longValue() : 0;
                long firstOI = doc.get("firstOI") instanceof Number ? ((Number) doc.get("firstOI")).longValue() : 0;
                long oiChange = lastOI - firstOI;
                day.put("oi", lastOI);
                day.put("oiChange", oiChange);
                day.put("oiChangePct", firstOI > 0 ? Math.round((double) oiChange / firstOI * 10000.0) / 100.0 : 0);
                trend.add(day);
            }

            // Enrich with price change and buildup classification from candle data
            Map<String, Double> priceByDate = new HashMap<>();
            try {
                String key = "unified:" + scripCode + ":1d:history";
                List<String> candles = redis.opsForList().range(key, 0, 9);
                if (candles != null) {
                    for (String raw : candles) {
                        try {
                            Object parsed = mapper.readValue(raw, Object.class);
                            Map<String, Object> c = parsed instanceof List ?
                                (Map<String, Object>) ((List<?>) parsed).get(1) :
                                (Map<String, Object>) parsed;
                            String ts = (String) c.get("timestamp");
                            if (ts != null) {
                                String date = ts.substring(0, 10);
                                double cl = toD(c.get("close"));
                                double op = toD(c.get("open"));
                                priceByDate.put(date, op > 0 ? (cl - op) / op * 100 : 0);
                            }
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}

            for (var day : trend) {
                String date = (String) day.get("date");
                double pricePct = priceByDate.getOrDefault(date, 0.0);
                day.put("priceChangePct", Math.round(pricePct * 100.0) / 100.0);
                long oiChg = day.get("oiChange") instanceof Number ? ((Number) day.get("oiChange")).longValue() : 0;
                // OI buildup classification
                String buildup;
                if (oiChg > 0 && pricePct > 0) buildup = "LONG_BUILDUP";
                else if (oiChg > 0 && pricePct < 0) buildup = "SHORT_BUILDUP";
                else if (oiChg < 0 && pricePct > 0) buildup = "SHORT_COVERING";
                else if (oiChg < 0 && pricePct < 0) buildup = "LONG_UNWINDING";
                else buildup = "NEUTRAL";
                day.put("buildup", buildup);
            }
        } catch (Exception e) {
            log.debug("[STOCK_CTX] OI trend error for {}: {}", scripCode, e.getMessage());
        }
        return trend;
    }

    // ═══════════════════════════════════════
    // 4. LATEST IV
    // ═══════════════════════════════════════
    private Double getLatestIV(String scripCode) {
        try {
            Set<String> vals = redis.opsForZSet().reverseRange("iv:history:" + scripCode, 0, 0);
            if (vals != null && !vals.isEmpty()) {
                return Double.parseDouble(vals.iterator().next());
            }
        } catch (Exception ignored) {}
        return null;
    }

    // ═══════════════════════════════════════
    // 5. TRACK RECORD
    // ═══════════════════════════════════════
    private Map<String, Object> buildTrackRecord(String scripCode) {
        Map<String, Object> tr = new LinkedHashMap<>();
        try {
            var trades = mongoTemplate.getCollection("trade_outcomes")
                .find(new Document("scripCode", scripCode))
                .sort(new Document("exitTime", -1))
                .limit(10)
                .into(new ArrayList<>());
            tr.put("totalTrades", trades.size());
            if (trades.isEmpty()) return tr;

            int wins = 0;
            double totalPnl = 0;
            List<Map<String, Object>> history = new ArrayList<>();
            for (var t : trades) {
                double pnl = t.get("pnl") instanceof Number ? ((Number) t.get("pnl")).doubleValue() : 0;
                boolean isWin = pnl > 0;
                if (isWin) wins++;
                totalPnl += pnl;
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("exitTime", t.get("exitTime"));
                entry.put("side", t.getString("side"));
                entry.put("entryPrice", t.get("entryPrice"));
                entry.put("exitPrice", t.get("exitPrice"));
                entry.put("pnl", Math.round(pnl * 100.0) / 100.0);
                entry.put("exitReason", t.getString("exitReason"));
                entry.put("strategy", t.get("signalSource") != null ? t.getString("signalSource") : t.getString("strategy"));
                entry.put("isWin", isWin);
                history.add(entry);
            }
            tr.put("wins", wins);
            tr.put("winRate", trades.size() > 0 ? Math.round((double) wins / trades.size() * 100) : 0);
            tr.put("totalPnl", Math.round(totalPnl * 100.0) / 100.0);
            tr.put("avgPnl", Math.round(totalPnl / trades.size() * 100.0) / 100.0);
            tr.put("history", history);
        } catch (Exception e) {
            tr.put("error", e.getMessage());
        }
        return tr;
    }

    // ═══════════════════════════════════════
    // 6. RECENT SIGNALS
    // ═══════════════════════════════════════
    private List<Map<String, Object>> buildSignals(String scripCode) {
        List<Map<String, Object>> signals = new ArrayList<>();
        try {
            Set<String> keys = redis.keys("dashboard:signal-history:" + scripCode + "*");
            if (keys != null) {
                for (String key : keys) {
                    try {
                        String val = redis.opsForValue().get(key);
                        if (val != null) {
                            Map<String, Object> sig = mapper.readValue(val, Map.class);
                            signals.add(sig);
                        }
                    } catch (Exception ignored) {}
                }
            }
            // Sort by createdAt descending
            signals.sort((a, b) -> {
                String aTime = String.valueOf(a.getOrDefault("createdAt", ""));
                String bTime = String.valueOf(b.getOrDefault("createdAt", ""));
                return bTime.compareTo(aTime);
            });
        } catch (Exception e) {
            log.debug("[STOCK_CTX] Signals error for {}: {}", scripCode, e.getMessage());
        }
        return signals;
    }

    // ═══════════════════════════════════════
    // 7. POSITION
    // ═══════════════════════════════════════
    private Map<String, Object> buildPosition(String scripCode) {
        try {
            String json = redis.opsForValue().get("virtual:positions:" + scripCode);
            if (json != null) {
                Map<String, Object> pos = mapper.readValue(json, Map.class);
                int qtyOpen = pos.get("qtyOpen") instanceof Number ? ((Number) pos.get("qtyOpen")).intValue() : 0;
                pos.put("isOpen", qtyOpen > 0);
                return pos;
            }
        } catch (Exception ignored) {}
        return null;
    }

    // ═══════════════════════════════════════
    // 8. ENRICHMENT (hotstocks:v1)
    // ═══════════════════════════════════════
    private Map<String, Object> buildEnrichment(String scripCode) {
        try {
            String json = redis.opsForValue().get("hotstocks:v1:" + scripCode);
            if (json != null) {
                return mapper.readValue(json, Map.class);
            }
        } catch (Exception ignored) {}
        return null;
    }

    // ═══════════════════════════════════════
    // 9. MACRO CONTEXT
    // ═══════════════════════════════════════
    private Map<String, Object> buildMacroContext(boolean isCommodity, boolean isCurrency, String exchange) {
        Map<String, Object> macro = new LinkedHashMap<>();
        try {
            var snap = marketPulseService.getLatestSnapshot();
            macro.put("nifty50Price", snap.getSgxNiftyLastTrade() > 0 ? snap.getSgxNiftyLastTrade() : snap.getGiftNiftyPrice());
            macro.put("nifty50ChangePct", snap.getGiftNiftyChangePct());
            macro.put("crudePrice", snap.getCrudeOilPrice());
            macro.put("crudeChangePct", snap.getCrudeOilChangePct());
            macro.put("goldPrice", snap.getGoldPrice());
            macro.put("goldChangePct", snap.getGoldChangePct());
            macro.put("dxyPrice", snap.getDxyPrice());
            macro.put("dxyChangePct", snap.getDxyChangePct());
            macro.put("usdInrPrice", snap.getUsdInrPrice());
            macro.put("indiaVix", snap.getIndiaVix());

            // Instrument-specific inference
            if (isCommodity) {
                macro.put("relevantContext", "commodity");
                double dxyChg = snap.getDxyChangePct();
                macro.put("inference", dxyChg < -0.3 ? "Weak USD = commodity tailwind" :
                    dxyChg > 0.3 ? "Strong USD = commodity headwind" : "USD stable — no strong FX pressure");
            } else if (isCurrency) {
                macro.put("relevantContext", "currency");
                macro.put("inference", "DXY " + (snap.getDxyChangePct() > 0 ? "rising" : "falling") +
                    " — direct impact on INR pairs");
            } else {
                macro.put("relevantContext", "equity");
                double fiiNet = 0;
                try {
                    var fiiDii = marketPulseService.getFiiDii();
                    if (!fiiDii.isEmpty()) {
                        var fii = (Map<String, Object>) fiiDii.get(0).get("FII");
                        if (fii != null) fiiNet = fii.get("netValue") instanceof Number ? ((Number) fii.get("netValue")).doubleValue() : 0;
                    }
                } catch (Exception ignored) {}
                macro.put("fiiNetToday", fiiNet);
                macro.put("inference", fiiNet > 500 ? "FII buying — bullish for large caps" :
                    fiiNet < -500 ? "FII selling — cautious on FII-heavy stocks" : "FII neutral");
            }
        } catch (Exception e) {
            macro.put("error", e.getMessage());
        }
        return macro;
    }

    // ═══════════════════════════════════════
    // 10. DEALS (equities only)
    // ═══════════════════════════════════════
    private List<Map<String, Object>> buildDeals(String symbol) {
        List<Map<String, Object>> deals = new ArrayList<>();
        try {
            var bulkDeals = marketPulseService.getBulkDeals();
            var blockDeals = marketPulseService.getBlockDeals();
            for (var d : bulkDeals) {
                if (symbol.equalsIgnoreCase((String) d.get("symbol"))) deals.add(d);
            }
            for (var d : blockDeals) {
                if (symbol.equalsIgnoreCase((String) d.get("symbol"))) deals.add(d);
            }
            deals.sort((a, b) -> String.valueOf(b.getOrDefault("_date", "")).compareTo(
                String.valueOf(a.getOrDefault("_date", ""))));
        } catch (Exception ignored) {}
        return deals;
    }

    // ═══════════════════════════════════════
    // 11. RISK FLAGS
    // ═══════════════════════════════════════
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> buildRiskFlags(Map<String, Object> ctx) {
        List<Map<String, Object>> flags = new ArrayList<>();

        // Track record danger
        var tr = (Map<String, Object>) ctx.get("trackRecord");
        if (tr != null) {
            int total = tr.get("totalTrades") instanceof Number ? ((Number) tr.get("totalTrades")).intValue() : 0;
            int winRate = tr.get("winRate") instanceof Number ? ((Number) tr.get("winRate")).intValue() : 0;
            if (total >= 3 && winRate == 0)
                flags.add(flag("CRITICAL", "0% win rate on " + total + " trades — ₹" + tr.get("totalPnl") + " total loss. Consider blacklisting this scrip."));
            else if (total >= 3 && winRate <= 25)
                flags.add(flag("WARNING", winRate + "% win rate on " + total + " trades. Below profitable threshold."));
        }

        // OI buildup pattern (derivatives)
        var oiTrend = (List<Map<String, Object>>) ctx.get("oiTrend");
        if (oiTrend != null && oiTrend.size() >= 3) {
            long shortBuildupDays = oiTrend.stream().filter(d -> "SHORT_BUILDUP".equals(d.get("buildup"))).count();
            long longBuildupDays = oiTrend.stream().filter(d -> "LONG_BUILDUP".equals(d.get("buildup"))).count();
            if (shortBuildupDays >= 3)
                flags.add(flag("WARNING", "SHORT_BUILDUP " + shortBuildupDays + "/" + oiTrend.size() + " days — bears adding positions while price falls."));
            if (longBuildupDays >= 3)
                flags.add(flag("INFO", "LONG_BUILDUP " + longBuildupDays + "/" + oiTrend.size() + " days — bulls adding positions with rising prices."));
        }

        // Expiry proximity
        var identity = (Map<String, Object>) ctx.get("identity");
        if (identity != null && identity.get("daysToExpiry") instanceof Number) {
            long dte = ((Number) identity.get("daysToExpiry")).longValue();
            if (dte <= 3) flags.add(flag("CRITICAL", "Expiry in " + dte + " day(s) — extreme theta + rollover risk."));
            else if (dte <= 7) flags.add(flag("WARNING", "Expiry in " + dte + " days — theta accelerating."));
            else if (dte <= 14) flags.add(flag("INFO", dte + " days to expiry — monitor rollover activity."));
        }

        // Elevated ATR
        var price = (Map<String, Object>) ctx.get("price");
        if (price != null && price.get("atrRatio") instanceof Number) {
            double atrRatio = ((Number) price.get("atrRatio")).doubleValue();
            if (atrRatio > 1.5) flags.add(flag("WARNING", "Volatility " + (int)(atrRatio * 100) + "% of ATR — widen stops, reduce size."));
            else if (atrRatio > 1.2) flags.add(flag("INFO", "Volatility elevated at " + (int)(atrRatio * 100) + "% of ATR."));
        }

        return flags;
    }

    // ═══════════════════════════════════════
    // 12. VERDICT
    // ═══════════════════════════════════════
    @SuppressWarnings("unchecked")
    private Map<String, Object> buildVerdict(Map<String, Object> ctx) {
        Map<String, Object> verdict = new LinkedHashMap<>();
        int score = 0;
        List<String> reasons = new ArrayList<>();

        // Track record
        var tr = (Map<String, Object>) ctx.get("trackRecord");
        if (tr != null) {
            int winRate = tr.get("winRate") instanceof Number ? ((Number) tr.get("winRate")).intValue() : -1;
            int total = tr.get("totalTrades") instanceof Number ? ((Number) tr.get("totalTrades")).intValue() : 0;
            if (total >= 3 && winRate == 0) { score -= 40; reasons.add("0% win rate (-40)"); }
            else if (total >= 3 && winRate <= 25) { score -= 20; reasons.add(winRate + "% win rate (-20)"); }
            else if (total >= 5 && winRate >= 60) { score += 15; reasons.add(winRate + "% win rate (+15)"); }
        }

        // OI pattern
        var oiTrend = (List<Map<String, Object>>) ctx.get("oiTrend");
        if (oiTrend != null && oiTrend.size() >= 3) {
            long shortDays = oiTrend.stream().filter(d -> "SHORT_BUILDUP".equals(d.get("buildup"))).count();
            long longDays = oiTrend.stream().filter(d -> "LONG_BUILDUP".equals(d.get("buildup"))).count();
            if (shortDays >= 3) { score -= 25; reasons.add("SHORT_BUILDUP " + shortDays + "/5 days (-25)"); }
            if (longDays >= 3) { score += 15; reasons.add("LONG_BUILDUP " + longDays + "/5 days (+15)"); }
        }

        // Expiry
        var identity = (Map<String, Object>) ctx.get("identity");
        if (identity != null && identity.get("daysToExpiry") instanceof Number) {
            long dte = ((Number) identity.get("daysToExpiry")).longValue();
            if (dte <= 3) { score -= 15; reasons.add("Expiry ≤3d (-15)"); }
            else if (dte <= 7) { score -= 10; reasons.add("Expiry ≤7d (-10)"); }
        }

        // ATR / volatility
        var price = (Map<String, Object>) ctx.get("price");
        if (price != null && price.get("atrRatio") instanceof Number) {
            double atrRatio = ((Number) price.get("atrRatio")).doubleValue();
            if (atrRatio > 1.5) { score -= 5; reasons.add("Very high volatility (-5)"); }
        }

        // Macro tailwind
        var macro = (Map<String, Object>) ctx.get("macro");
        if (macro != null) {
            double dxyChg = macro.get("dxyChangePct") instanceof Number ? ((Number) macro.get("dxyChangePct")).doubleValue() : 0;
            String relevantCtx = (String) macro.get("relevantContext");
            if ("commodity".equals(relevantCtx) && dxyChg < -0.3) { score += 10; reasons.add("Weak USD tailwind (+10)"); }
            if ("equity".equals(relevantCtx)) {
                double fiiNet = macro.get("fiiNetToday") instanceof Number ? ((Number) macro.get("fiiNetToday")).doubleValue() : 0;
                if (fiiNet > 500) { score += 10; reasons.add("FII buying (+10)"); }
                if (fiiNet < -500) { score -= 10; reasons.add("FII selling (-10)"); }
            }
        }

        String verdictLabel;
        String verdictAction;
        if (score <= -30) {
            verdictLabel = "AVOID";
            verdictAction = "Multiple factors strongly against. Do not enter new trades on this instrument.";
        } else if (score <= -10) {
            verdictLabel = "CAUTION";
            verdictAction = "Headwinds present. If entering, reduce position size by 50% and tighten stops.";
        } else if (score < 10) {
            verdictLabel = "NEUTRAL";
            verdictAction = "No clear edge. Wait for a fresh signal with aligned macro before committing.";
        } else if (score < 30) {
            verdictLabel = "FAVORABLE";
            verdictAction = "Mild tailwinds. Normal position sizing with standard risk management.";
        } else {
            verdictLabel = "STRONG";
            verdictAction = "Multiple factors aligned. Full conviction entry on next signal.";
        }

        verdict.put("score", score);
        verdict.put("label", verdictLabel);
        verdict.put("action", verdictAction);
        verdict.put("reasons", reasons);
        return verdict;
    }

    private Map<String, Object> flag(String severity, String message) {
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("severity", severity);
        f.put("message", message);
        return f;
    }

    private double toD(Object v) {
        if (v instanceof Number) return ((Number) v).doubleValue();
        if (v instanceof String) try { return Double.parseDouble((String) v); } catch (Exception ignored) {}
        return 0;
    }
    private double safeDouble(Object v) { return toD(v); }
    private int safeInt(Object v) {
        if (v instanceof Number) return ((Number) v).intValue();
        if (v instanceof String) try { return Integer.parseInt((String) v); } catch (Exception ignored) {}
        return 0;
    }
}
