package com.kotsin.dashboard.service;

import java.util.ArrayList;
import java.util.List;

/**
 * OrderBookAbsorptionModel — Simulates limit order fill across orderbook levels.
 *
 * When we place a SELL limit at target price P with qty Q:
 *   - Bid volume at P is limited; we capture only a fraction (captureRate)
 *     because we're not first in queue and bids get pulled on touch
 *   - Remaining qty walks down P-1tick, P-2tick... each with decaying depth
 *   - Weighted average fill price = actual expected exit
 *   - Slippage = |targetPrice - weightedAvgFill|
 *
 * For BUY entry: mirror against ask side, walking UP from target.
 */
public class OrderBookAbsorptionModel {

    public enum Side { BUY, SELL }

    /** Depth decay per level — deeper levels have less reliable liquidity */
    private static final double DEPTH_DECAY_PER_LEVEL = 0.75;

    /** Default max tick levels to walk when filling */
    private static final int DEFAULT_MAX_TICK_LEVELS = 5;

    /**
     * Result of an order book absorption simulation.
     */
    public static class AbsorptionResult {
        public final double weightedAvgFillPrice;
        public final double slippagePerUnit;
        public final double fillableAtTarget;
        public final double totalFillable;
        public final int tickLevelsUsed;
        public final List<FillLevel> levels;

        public AbsorptionResult(double weightedAvgFillPrice, double slippagePerUnit,
                                double fillableAtTarget, double totalFillable,
                                int tickLevelsUsed, List<FillLevel> levels) {
            this.weightedAvgFillPrice = weightedAvgFillPrice;
            this.slippagePerUnit = slippagePerUnit;
            this.fillableAtTarget = fillableAtTarget;
            this.totalFillable = totalFillable;
            this.tickLevelsUsed = tickLevelsUsed;
            this.levels = levels;
        }
    }

    /**
     * One level in the fill simulation.
     */
    public static class FillLevel {
        public final int tickOffset;
        public final double price;
        public final double estimatedDepth;
        public final double fillQty;

        public FillLevel(int tickOffset, double price, double estimatedDepth, double fillQty) {
            this.tickOffset = tickOffset;
            this.price = price;
            this.estimatedDepth = estimatedDepth;
            this.fillQty = fillQty;
        }
    }

    /**
     * Simulate limit order absorption across orderbook levels.
     *
     * @param side            BUY or SELL
     * @param targetPrice     the price we want to fill at
     * @param qty             total qty to fill
     * @param tickSize        instrument tick size (from scripData)
     * @param depthAtTarget   estimated volume at target price level (bid for SELL, ask for BUY)
     * @param avgDepthPerLevel average depth per level beyond target (from liquidity data)
     * @param captureRate     fraction of visible depth we can realistically capture (0.10-0.25)
     * @param maxTickLevels   max price levels to walk (default 5)
     * @return absorption simulation result
     */
    public static AbsorptionResult simulate(Side side, double targetPrice, int qty,
                                             double tickSize, double depthAtTarget,
                                             double avgDepthPerLevel, double captureRate,
                                             int maxTickLevels) {
        if (qty <= 0 || targetPrice <= 0 || tickSize <= 0) {
            return new AbsorptionResult(targetPrice, 0, 0, 0, 0, List.of());
        }

        // Ensure sane defaults
        if (captureRate <= 0) captureRate = 0.20;
        if (maxTickLevels <= 0) maxTickLevels = DEFAULT_MAX_TICK_LEVELS;
        if (depthAtTarget <= 0) depthAtTarget = avgDepthPerLevel;
        if (avgDepthPerLevel <= 0) avgDepthPerLevel = qty * 0.1; // pessimistic: assume thin

        List<FillLevel> levels = new ArrayList<>();
        double remaining = qty;
        double weightedSum = 0;
        double totalFilled = 0;
        double fillableAtTarget = 0;

        for (int level = 0; level <= maxTickLevels && remaining > 0; level++) {
            // Price at this level
            double price;
            if (side == Side.SELL) {
                price = targetPrice - level * tickSize; // SELL: walk down
            } else {
                price = targetPrice + level * tickSize; // BUY: walk up (paying more)
            }
            if (price <= 0) break;

            // Estimated depth at this level
            double depthHere;
            if (level == 0) {
                depthHere = depthAtTarget;
            } else {
                depthHere = avgDepthPerLevel * Math.pow(DEPTH_DECAY_PER_LEVEL, level);
            }

            // Fillable = depth × captureRate (we're not alone in the queue)
            double fillable = depthHere * captureRate;
            double fill = Math.min(remaining, fillable);

            if (fill > 0) {
                levels.add(new FillLevel(level, price, depthHere, fill));
                weightedSum += price * fill;
                totalFilled += fill;
                remaining -= fill;

                if (level == 0) {
                    fillableAtTarget = fill;
                }
            }
        }

        // If we couldn't fill everything within maxTickLevels, fill remainder at worst level
        if (remaining > 0 && totalFilled > 0) {
            double worstPrice;
            if (side == Side.SELL) {
                worstPrice = targetPrice - (maxTickLevels + 1) * tickSize;
            } else {
                worstPrice = targetPrice + (maxTickLevels + 1) * tickSize;
            }
            worstPrice = Math.max(worstPrice, tickSize); // floor at 1 tick
            levels.add(new FillLevel(maxTickLevels + 1, worstPrice, 0, remaining));
            weightedSum += worstPrice * remaining;
            totalFilled += remaining;
        }

        double avgFill = totalFilled > 0 ? weightedSum / totalFilled : targetPrice;
        double slippage = Math.abs(targetPrice - avgFill);
        int ticksUsed = levels.isEmpty() ? 0 : levels.get(levels.size() - 1).tickOffset;

        return new AbsorptionResult(avgFill, slippage, fillableAtTarget, totalFilled,
                ticksUsed, levels);
    }

    /**
     * Convenience: simulate with default maxTickLevels.
     */
    public static AbsorptionResult simulate(Side side, double targetPrice, int qty,
                                             double tickSize, double depthAtTarget,
                                             double avgDepthPerLevel, double captureRate) {
        return simulate(side, targetPrice, qty, tickSize, depthAtTarget,
                avgDepthPerLevel, captureRate, DEFAULT_MAX_TICK_LEVELS);
    }

    /**
     * Compute maximum qty that can exit cleanly at a target price.
     * "Cleanly" = weighted avg fill within maxSlippagePct of target.
     *
     * Binary searches for the largest lot-aligned qty where absorption
     * simulation gives slippage below the threshold.
     *
     * @param targetPrice     exit target price
     * @param tickSize        instrument tick size
     * @param avgDepthPerLevel average depth per orderbook level
     * @param captureRate     capture rate (0.10-0.25)
     * @param maxTickLevels   max levels to walk
     * @param maxSlippagePct  maximum acceptable slippage as fraction (e.g., 0.005 = 0.5%)
     * @param lotSize         lot size for rounding
     * @return max lot-aligned qty that exits within slippage threshold, 0 if even 1 lot exceeds
     */
    public static int maxCleanExitQty(double targetPrice, double tickSize,
                                       double avgDepthPerLevel, double captureRate,
                                       int maxTickLevels, double maxSlippagePct,
                                       int lotSize) {
        if (targetPrice <= 0 || tickSize <= 0 || lotSize <= 0 || avgDepthPerLevel <= 0) {
            return 0;
        }

        double maxSlippageAbs = targetPrice * maxSlippagePct;

        // Upper bound: estimate from total depth across all levels
        double totalDepth = 0;
        for (int i = 0; i <= maxTickLevels; i++) {
            totalDepth += avgDepthPerLevel * Math.pow(DEPTH_DECAY_PER_LEVEL, i) * captureRate;
        }
        int upperLots = (int) (totalDepth / lotSize) + 1;
        upperLots = Math.max(upperLots, 1);

        // Binary search
        int lo = 0, hi = upperLots;
        int bestLots = 0;

        while (lo <= hi) {
            int mid = (lo + hi) / 2;
            int qty = mid * lotSize;
            if (qty <= 0) {
                lo = mid + 1;
                continue;
            }

            AbsorptionResult result = simulate(Side.SELL, targetPrice, qty, tickSize,
                    avgDepthPerLevel, avgDepthPerLevel, captureRate, maxTickLevels);

            if (result.slippagePerUnit <= maxSlippageAbs) {
                bestLots = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        return bestLots * lotSize;
    }
}
