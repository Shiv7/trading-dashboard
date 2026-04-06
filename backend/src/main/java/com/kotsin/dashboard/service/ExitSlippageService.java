package com.kotsin.dashboard.service;

import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ExitSlippageService — Computes exit slippage using orderbook data from Redis,
 * with instrument-class-aware pessimistic fallback from InstrumentSlippageConfig.
 *
 * Tier 1 (FULL): OrderBookAbsorptionModel — simulates limit order fill across levels
 * Tier 2 (SPREAD_ONLY): spread/2 + volume-based impact proxy
 * Tier 3 (VOLUME_ONLY): participation-rate price impact
 * Tier 4 (STATIC): InstrumentSlippageConfig — pessimistic % by instrument class + premium band
 */
@Service
@Slf4j
public class ExitSlippageService {

    private static final String LOG_PREFIX = "[EXIT-SLIPPAGE]";

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @Autowired
    private MongoTemplate mongoTemplate;

    private final ConcurrentHashMap<String, Double> tickSizeCache = new ConcurrentHashMap<>();

    @PostConstruct
    public void preloadTickSizes() {
        int count = 0;
        try {
            for (Document doc : mongoTemplate.getCollection("scripData").find()) {
                try {
                    Object scObj = doc.get("ScripCode");
                    if (scObj == null) continue;
                    String scripCode = scObj.toString().trim();
                    if (scripCode.isEmpty()) continue;

                    Object tsObj = doc.get("TickSize");
                    if (tsObj == null) continue;
                    double tickSize = Double.parseDouble(tsObj.toString().trim());
                    if (tickSize > 0) {
                        tickSizeCache.put(scripCode, tickSize);
                        count++;
                    }
                } catch (Exception e) {
                    // Skip malformed docs
                }
            }
            log.info("✅ {} Loaded {} tick sizes from scripData", LOG_PREFIX, count);
        } catch (Exception e) {
            log.error("{} Failed to preload tick sizes: {}", LOG_PREFIX, e.getMessage());
        }
    }

    /**
     * Compute per-unit exit slippage (backward-compatible, no instrument metadata).
     */
    public double computeExitSlippage(String scripCode, int qty, double exitPrice, String exchange) {
        return computeExitSlippage(scripCode, qty, exitPrice, exchange, null, null);
    }

    /**
     * Compute per-unit exit slippage with instrument metadata for accurate classification.
     */
    public double computeExitSlippage(String scripCode, int qty, double exitPrice,
                                       String exchange, String instrumentType, String symbol) {
        if (exitPrice <= 0 || qty <= 0) return 0;

        InstrumentSlippageConfig.InstrumentClass instrClass =
                InstrumentSlippageConfig.resolve(exchange, instrumentType, symbol);

        try {
            String key = "liquidity:" + scripCode;
            Map<Object, Object> data = stringRedisTemplate.opsForHash().entries(key);

            if (data != null && !data.isEmpty()) {
                double avgSpread = parseDouble(data.get("avgSpread"));
                double kyleLambda = parseDouble(data.get("kyleLambda"));
                double avgAskDepth = parseDouble(data.get("avgAskDepth"));
                double avgBidDepth = parseDouble(data.get("avgBidDepth"));
                double avgVolumePerMin = parseDouble(data.get("avgVolumePerMin"));

                double slippagePerUnit;

                if (avgSpread > 0 && avgBidDepth > 0 && kyleLambda > 0) {
                    // FULL tier — use OrderBookAbsorptionModel
                    double tickSize = resolveTickSize(scripCode, exchange);
                    double spreadTicks = tickSize > 0 ? avgSpread / tickSize : 3;
                    double levelsEstimate = Math.max(spreadTicks + 2, 3);
                    double avgDepthPerLevel = avgBidDepth / levelsEstimate;
                    double urgency = InstrumentSlippageConfig.getUrgencyMultiplier();
                    double captureRate = 0.20 / urgency;

                    OrderBookAbsorptionModel.AbsorptionResult absorption =
                            OrderBookAbsorptionModel.simulate(
                                    OrderBookAbsorptionModel.Side.SELL,
                                    exitPrice, qty, tickSize,
                                    avgBidDepth * 0.3, avgDepthPerLevel,
                                    captureRate, 5);
                    slippagePerUnit = absorption.slippagePerUnit;
                } else if (avgSpread > 0) {
                    // SPREAD_ONLY tier
                    double halfSpread = avgSpread / 2.0;
                    double urgency = InstrumentSlippageConfig.getUrgencyMultiplier();
                    double impactProxy = avgVolumePerMin > 0
                            ? halfSpread * Math.min(qty / (avgVolumePerMin * 2), 3.0) : 0;
                    slippagePerUnit = (halfSpread + impactProxy) * urgency;
                } else if (avgVolumePerMin > 0) {
                    // VOLUME_ONLY tier
                    double urgency = InstrumentSlippageConfig.getUrgencyMultiplier();
                    double participationRate = qty / (avgVolumePerMin * 2);
                    double impactFactor = 0.001 * (1 + Math.min(participationRate, 5.0));
                    slippagePerUnit = exitPrice * impactFactor * urgency;
                } else {
                    return staticSlippage(scripCode, exitPrice, exchange, qty, instrClass);
                }

                // Cap by instrument class
                double cap = InstrumentSlippageConfig.getCapPct(instrClass) * exitPrice;
                slippagePerUnit = Math.min(slippagePerUnit, cap);

                // Floor: 1 tick
                double tickSize = resolveTickSize(scripCode, exchange);
                slippagePerUnit = Math.max(slippagePerUnit, tickSize);

                return slippagePerUnit;
            }
        } catch (Exception e) {
            log.debug("{} Error reading liquidity for {}: {}", LOG_PREFIX, scripCode, e.getMessage());
        }

        return staticSlippage(scripCode, exitPrice, exchange, qty, instrClass);
    }

    /**
     * Static fallback — instrument-class-aware pessimistic model.
     */
    private double staticSlippage(String scripCode, double exitPrice, String exchange,
                                   int qty, InstrumentSlippageConfig.InstrumentClass instrClass) {
        double tickSize = resolveTickSize(scripCode, exchange);
        // Estimate lots (assume 1 lot = qty when no lot size info available)
        int lots = qty;
        return InstrumentSlippageConfig.computeStaticSlippage(instrClass, exitPrice, lots, tickSize);
    }

    private double resolveTickSize(String scripCode, String exchange) {
        if (scripCode != null) {
            Double cached = tickSizeCache.get(scripCode);
            if (cached != null) return cached;
        }
        if ("M".equals(exchange)) return 0.05;
        if ("C".equals(exchange) || "U".equals(exchange)) return 0.0025;
        return 0.05;
    }

    private double parseDouble(Object val) {
        if (val == null) return -1;
        try {
            return Double.parseDouble(String.valueOf(val));
        } catch (NumberFormatException e) {
            return -1;
        }
    }
}
