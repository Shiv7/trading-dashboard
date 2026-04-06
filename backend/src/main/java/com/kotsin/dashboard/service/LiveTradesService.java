package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import java.time.*;
import java.util.*;

/**
 * Service for the Live Trades page.
 * Returns active positions (from Redis strategy:targets + virtual:positions)
 * and today's closed trades (from MongoDB trade_outcomes).
 */
@Service
@Slf4j
public class LiveTradesService {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Autowired
    private MongoTemplate mongoTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String TARGETS_PREFIX = "strategy:targets:";
    private static final String POSITIONS_PREFIX = "virtual:positions:";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /**
     * Main entry point: returns activePositions + todayExits.
     */
    public Map<String, Object> getLiveData() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("activePositions", getActivePositions());
        result.put("todayExits", getTodayExits());
        return result;
    }

    // ─────────────────────────────────────────────
    //  Active Positions from Redis
    // ─────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> getActivePositions() {
        List<Map<String, Object>> positions = new ArrayList<>();

        try {
            Set<String> targetKeys = redisTemplate.keys(TARGETS_PREFIX + "*");
            if (targetKeys == null || targetKeys.isEmpty()) {
                log.debug("LIVE: No strategy:targets:* keys found");
                return positions;
            }

            for (String targetKey : targetKeys) {
                try {
                    String scripCode = targetKey.replace(TARGETS_PREFIX, "");
                    String targetsJson = redisTemplate.opsForValue().get(targetKey);
                    if (targetsJson == null) continue;

                    Map<String, Object> targets = objectMapper.readValue(targetsJson, Map.class);

                    // Skip if remainingQty <= 0 (fully exited but key not yet cleaned up)
                    int remainingQty = getInt(targets, "remainingQty");
                    if (remainingQty <= 0) continue;

                    // Read corresponding virtual:positions for live price/P&L
                    Map<String, Object> position = readPosition(scripCode);

                    Map<String, Object> active = buildActivePosition(scripCode, targets, position);
                    if (active != null) {
                        positions.add(active);
                    }
                } catch (Exception e) {
                    log.warn("LIVE: Error parsing target key {}: {}", targetKey, e.getMessage());
                }
            }

            log.debug("LIVE: Returning {} active positions", positions.size());
        } catch (Exception e) {
            log.error("LIVE: Error reading active positions: {}", e.getMessage(), e);
        }

        return positions;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readPosition(String scripCode) {
        try {
            String posJson = redisTemplate.opsForValue().get(POSITIONS_PREFIX + scripCode);
            if (posJson != null) {
                return objectMapper.readValue(posJson, Map.class);
            }
        } catch (Exception e) {
            log.debug("LIVE: Could not read position for {}: {}", scripCode, e.getMessage());
        }
        return Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> buildActivePosition(String scripCode,
                                                     Map<String, Object> targets,
                                                     Map<String, Object> position) {
        Map<String, Object> out = new LinkedHashMap<>();

        out.put("scripCode", scripCode);
        out.put("symbol", getString(targets, "instrumentSymbol", scripCode));
        out.put("direction", getString(targets, "direction", ""));
        out.put("side", deriveSide(targets));
        out.put("entryPrice", getDouble(targets, "entryPrice"));

        // Current price: prefer position (updated every 500ms), fall back to entry
        double currentPrice = getDouble(position, "currentPrice");
        if (currentPrice == 0) currentPrice = getDouble(targets, "entryPrice");
        out.put("currentPrice", currentPrice);

        int totalQty = getInt(targets, "totalQty");
        int remainingQty = getInt(targets, "remainingQty");
        out.put("quantity", remainingQty);
        out.put("totalQuantity", totalQty);
        out.put("remainingQuantity", remainingQty);

        int lotSize = Math.max(getInt(targets, "lotSize"), 1);
        int lots = getInt(targets, "lots");
        if (lots == 0 && lotSize > 0) lots = totalQty / lotSize;
        out.put("lots", lots);
        out.put("lotSize", lotSize);

        // P&L from position
        double unrealizedPnl = getDouble(position, "unrealizedPnl");
        double entryPrice = getDouble(targets, "entryPrice");
        if (unrealizedPnl == 0 && entryPrice > 0 && currentPrice > 0 && remainingQty > 0) {
            // Fallback calculation: all option buys are LONG on premium
            unrealizedPnl = (currentPrice - entryPrice) * remainingQty;
        }
        double positionCost = entryPrice * remainingQty;
        double unrealizedPnlPct = positionCost > 0 ? (unrealizedPnl / positionCost) * 100 : 0;
        out.put("unrealizedPnl", round2(unrealizedPnl));
        out.put("unrealizedPnlPct", round2(unrealizedPnlPct));
        out.put("realizedPnl", round2(getDouble(position, "realizedPnl")));

        out.put("openedAt", getLong(targets, "openedAt"));
        out.put("exchange", getString(targets, "exchange", "N"));
        out.put("instrumentType", getString(targets, "instrumentType", "EQUITY"));
        out.put("instrumentSymbol", getString(targets, "instrumentSymbol", ""));

        // Target progress
        List<Map<String, Object>> targetLevels = (List<Map<String, Object>>) targets.get("targets");
        int targetsHit = 0;
        int totalTargets = 0;
        List<Map<String, Object>> exitProgress = new ArrayList<>();
        boolean anyTargetHit = false;

        if (targetLevels != null) {
            totalTargets = targetLevels.size();
            for (Map<String, Object> t : targetLevels) {
                boolean hit = Boolean.TRUE.equals(t.get("hit"));
                if (hit) {
                    targetsHit++;
                    anyTargetHit = true;
                }
                Map<String, Object> ep = new LinkedHashMap<>();
                ep.put("level", getString(t, "level", ""));
                ep.put("price", getDouble(t, "price"));
                ep.put("qty", getInt(t, "closeQty"));
                ep.put("hit", hit);
                ep.put("hitSource", t.get("hitSource"));
                exitProgress.add(ep);
            }
        }

        out.put("isTrailing", anyTargetHit && remainingQty > 0);
        out.put("targetsHit", targetsHit);
        out.put("totalTargets", totalTargets);
        out.put("exitProgress", exitProgress);

        // Signal enrichment metrics
        out.put("confidence", getDouble(targets, "confidence"));
        out.put("atr", getDouble(targets, "atr"));
        out.put("volumeSurge", getDouble(targets, "volumeSurge"));
        out.put("oiChangePct", getDouble(targets, "oiChangePercent"));
        out.put("riskReward", getDouble(targets, "riskReward"));
        out.put("delta", getDouble(targets, "greekDelta"));
        out.put("optionHighFiveMin", getDouble(targets, "optionHighFiveMin"));

        // Strategy
        out.put("strategy", getString(targets, "strategy", ""));

        // Recalibration metadata (from RecalibrationService, updated every 30s)
        out.put("recalDelta", getDouble(targets, "recalDelta"));
        out.put("recalGamma", getDouble(targets, "recalGamma"));
        out.put("recalCount", getInt(targets, "recalCount"));
        out.put("lastRecalReason", getString(targets, "lastRecalReason", null));
        out.put("lastRecalTime", getString(targets, "lastRecalTime", null));
        out.put("recalTimePhase", getString(targets, "recalTimePhase", null));

        // Greek trailing state (from GreekTrailingEngine, persisted to Redis)
        out.put("greekTrailingActive", Boolean.TRUE.equals(targets.get("greekTrailingActive")));
        out.put("hardFloorSl", getDouble(targets, "hardFloorSl"));
        // Read Greek trailing details from dedicated Redis key
        try {
            if (redisTemplate != null) {
                String trailJson = redisTemplate.opsForValue().get("greek:trailing:" + scripCode);
                if (trailJson != null) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> trail = new com.fasterxml.jackson.databind.ObjectMapper()
                            .readValue(trailJson, Map.class);
                    Map<String, Object> trailData = new LinkedHashMap<>();
                    trailData.put("status", trail.get("status"));
                    trailData.put("peakDelta", trail.get("peakDelta"));
                    trailData.put("highWatermark", trail.get("highWatermark"));
                    trailData.put("currentDelta", trail.get("currentDelta"));
                    trailData.put("currentGamma", trail.get("currentGamma"));
                    trailData.put("currentTheta", trail.get("currentTheta"));
                    trailData.put("trailStopPrice", trail.get("trailStopPrice"));
                    trailData.put("currentTrailPct", trail.get("currentTrailPct"));
                    trailData.put("thetaBurnRate", trail.get("thetaBurnRate"));
                    trailData.put("deltaAccelRatio", trail.get("deltaAccelRatio"));
                    trailData.put("dte", trail.get("dte"));
                    trailData.put("exitReason", trail.get("exitReason"));
                    out.put("greekTrail", trailData);
                }
            }
        } catch (Exception e) {
            // Greek trailing data unavailable — non-critical
        }

        // Dual SL/target levels for drawer
        out.put("equitySl", getDouble(targets, "equitySl"));
        out.put("equityT1", getDouble(targets, "equityT1"));
        out.put("equityT2", getDouble(targets, "equityT2"));
        out.put("equityT3", getDouble(targets, "equityT3"));
        out.put("equityT4", getDouble(targets, "equityT4"));
        out.put("optionSl", getDouble(targets, "optionSl"));
        out.put("optionT1", getDouble(targets, "optionT1"));
        out.put("optionT2", getDouble(targets, "optionT2"));
        out.put("optionT3", getDouble(targets, "optionT3"));
        out.put("optionT4", getDouble(targets, "optionT4"));
        out.put("currentSl", getDouble(targets, "currentSl"));

        // Charges accumulated so far (from partial exits in position)
        Map<String, Object> charges = new LinkedHashMap<>();
        double totalCharges = getDouble(position, "totalCharges");
        if (totalCharges > 0) {
            charges.put("brokerage", round2(getDouble(position, "chargesBrokerage")));
            charges.put("stt", round2(getDouble(position, "chargesStt")));
            charges.put("exchangeCharges", round2(getDouble(position, "chargesExchange")));
            charges.put("gst", round2(getDouble(position, "chargesGst")));
            charges.put("sebi", round2(getDouble(position, "chargesSebi")));
            charges.put("stampDuty", round2(getDouble(position, "chargesStamp")));
            charges.put("total", round2(totalCharges));
        }
        out.put("charges", charges);

        return out;
    }

    // ─────────────────────────────────────────────
    //  Today's Exits from MongoDB trade_outcomes
    // ─────────────────────────────────────────────

    private List<Map<String, Object>> getTodayExits() {
        List<Map<String, Object>> exits = new ArrayList<>();

        try {
            // Start of today in IST → epoch millis
            LocalDate today = LocalDate.now(IST);
            Instant startOfDayInstant = today.atStartOfDay(IST).toInstant();
            Date startOfDay = Date.from(startOfDayInstant);

            // trade_outcomes stores entryTime/exitTime as Date objects.
            // Query: exitTime >= today 00:00 IST (closed today)
            // OR entryTime >= today 00:00 IST AND no exitTime (opened today, may still be active)
            // For "today's exits" we want closed trades, so filter on exitTime.
            Document query = new Document("exitTime", new Document("$gte", startOfDay));

            for (Document doc : mongoTemplate.getCollection("trade_outcomes").find(query)) {
                try {
                    Map<String, Object> exit = buildTodayExit(doc);
                    if (exit != null) {
                        exits.add(exit);
                    }
                } catch (Exception e) {
                    log.warn("LIVE: Error parsing trade_outcome: {}", e.getMessage());
                }
            }

            log.debug("LIVE: Returning {} today's exits", exits.size());
        } catch (Exception e) {
            log.error("LIVE: Error reading today's exits: {}", e.getMessage(), e);
        }

        return exits;
    }

    private Map<String, Object> buildTodayExit(Document doc) {
        Map<String, Object> out = new LinkedHashMap<>();

        out.put("scripCode", doc.getString("scripCode"));
        out.put("symbol", doc.getString("companyName"));
        out.put("instrumentSymbol", doc.getString("instrumentSymbol"));
        out.put("direction", doc.getString("direction"));

        String side = doc.getString("side");
        if (side == null || side.isEmpty()) side = "LONG";
        out.put("side", side);

        double entryPrice = getDocDouble(doc, "entryPrice");
        double exitPrice = getDocDouble(doc, "exitPrice");
        out.put("entryPrice", entryPrice);
        out.put("exitPrice", exitPrice);

        int quantity = doc.get("quantity") instanceof Number ? ((Number) doc.get("quantity")).intValue() : 0;
        out.put("quantity", quantity);

        double pnl = getDocDouble(doc, "pnl");
        double pnlPct = getDocDouble(doc, "pnlPercent");
        out.put("pnl", round2(pnl));
        out.put("pnlPct", round2(pnlPct));

        out.put("exitReason", doc.getString("exitReason"));

        // Timestamps: entryTime/exitTime stored as java.util.Date in MongoDB
        Date entryTime = doc.getDate("entryTime");
        Date exitTime = doc.getDate("exitTime");
        out.put("openedAt", entryTime != null ? entryTime.getTime() : null);
        out.put("closedAt", exitTime != null ? exitTime.getTime() : null);

        long durationMinutes = 0;
        if (doc.get("durationMinutes") instanceof Number) {
            durationMinutes = ((Number) doc.get("durationMinutes")).longValue();
        } else if (entryTime != null && exitTime != null) {
            durationMinutes = (exitTime.getTime() - entryTime.getTime()) / 60000;
        }
        out.put("durationMinutes", durationMinutes);

        out.put("exchange", doc.getString("exchange") != null ? doc.getString("exchange") : "N");
        out.put("instrumentType", doc.getString("instrumentType") != null ? doc.getString("instrumentType") : "EQUITY");
        out.put("isWin", pnl > 0);
        out.put("strategy", doc.getString("strategy"));

        // Enrichment metrics (stored by TradeOutcomeConsumer from signal data)
        out.put("confidence", getDocDouble(doc, "confidence"));
        out.put("volumeSurge", getDocDouble(doc, "volumeSurge"));
        out.put("oiChangePct", getDocDouble(doc, "oiChangePercent"));
        out.put("riskReward", getDocDouble(doc, "riskReward"));
        out.put("rMultiple", getDocDouble(doc, "rMultiple"));
        out.put("stopLoss", getDocDouble(doc, "stopLoss"));
        out.put("totalCharges", round2(getDocDouble(doc, "totalCharges")));

        // Target hits
        boolean t1 = Boolean.TRUE.equals(doc.getBoolean("target1Hit"));
        boolean t2 = Boolean.TRUE.equals(doc.getBoolean("target2Hit"));
        boolean t3 = Boolean.TRUE.equals(doc.getBoolean("target3Hit"));
        boolean t4 = Boolean.TRUE.equals(doc.getBoolean("target4Hit"));
        int targetsHit = (t1 ? 1 : 0) + (t2 ? 1 : 0) + (t3 ? 1 : 0) + (t4 ? 1 : 0);

        // Infer from exitReason if target booleans are missing
        if (targetsHit == 0) {
            String exitReason = doc.getString("exitReason");
            if (exitReason != null) {
                String upper = exitReason.toUpperCase();
                if (upper.contains("T4") || upper.contains("TARGET_4")) { targetsHit = 4; }
                else if (upper.contains("T3") || upper.contains("TARGET_3")) { targetsHit = 3; }
                else if (upper.contains("T2") || upper.contains("TARGET_2")) { targetsHit = 2; }
                else if (upper.contains("T1") || upper.contains("TARGET") || upper.contains("TP1")) { targetsHit = 1; }
            }
        }

        out.put("targetsHit", targetsHit);
        out.put("totalTargets", 4);

        // Charges
        Map<String, Object> charges = new LinkedHashMap<>();
        double totalCharges = getDocDouble(doc, "totalCharges");
        if (totalCharges > 0) {
            // trade_outcomes may not have per-field breakdown (only totalCharges stored by TradeOutcomeConsumer).
            // Include breakdown fields if they exist.
            charges.put("brokerage", round2(getDocDouble(doc, "chargesBrokerage")));
            charges.put("stt", round2(getDocDouble(doc, "chargesStt")));
            charges.put("exchangeCharges", round2(getDocDouble(doc, "chargesExchange")));
            charges.put("gst", round2(getDocDouble(doc, "chargesGst")));
            charges.put("sebi", round2(getDocDouble(doc, "chargesSebi")));
            charges.put("stampDuty", round2(getDocDouble(doc, "chargesStamp")));
            charges.put("total", round2(totalCharges));
        }
        out.put("charges", charges);

        return out;
    }

    // ─────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────

    private String deriveSide(Map<String, Object> targets) {
        // Option buys are always LONG on premium.
        // For equity/futures, derive from direction.
        String instrumentType = getString(targets, "instrumentType", "");
        if ("OPTION".equalsIgnoreCase(instrumentType)) {
            return "LONG";
        }
        String direction = getString(targets, "direction", "");
        return direction.toUpperCase().contains("BEAR") ? "SHORT" : "LONG";
    }

    private static String getString(Map<String, Object> map, String key, String defaultValue) {
        Object v = map.get(key);
        return v != null ? v.toString() : defaultValue;
    }

    private static double getDouble(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).doubleValue() : 0.0;
    }

    private static int getInt(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).intValue() : 0;
    }

    private static long getLong(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).longValue() : 0L;
    }

    private static double getDocDouble(Document doc, String key) {
        Object v = doc.get(key);
        return v instanceof Number ? ((Number) v).doubleValue() : 0.0;
    }

    private static double round2(double val) {
        return Math.round(val * 100.0) / 100.0;
    }
}
