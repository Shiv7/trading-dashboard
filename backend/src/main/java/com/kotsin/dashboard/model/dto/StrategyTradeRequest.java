package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for creating a strategy-driven virtual trade (option or futures).
 * Submitted by frontend when user clicks the BUY CTA on strategy cards.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StrategyTradeRequest {

    // Instrument being traded (option or futures)
    private String scripCode;            // option/futures scripCode
    private String instrumentSymbol;     // display name (e.g. "COPPER 27FEB 1150PE" or "ALUMINI FUT 27FEB")
    private String instrumentType;       // "OPTION" or "FUTURES"

    // Underlying reference
    private String underlyingScripCode;  // equity/commodity scripCode
    private String underlyingSymbol;     // e.g. "COPPER", "ALUMINIUM"

    // Order details
    private String side;                 // "BUY" or "SELL" (SELL for bearish FUT/equity shorts)
    private int quantity;                // total qty (lots × lotSize)
    private int lots;                    // number of lots
    private int lotSize;                 // per-lot size (order quantity per lot)
    private int multiplier;              // contract multiplier (MCX: notional value factor, NSE: 1)

    // Execution levels (delta-mapped for options, direct for futures)
    private double entryPrice;           // option premium or futures price at entry
    private double sl;                   // execution SL
    private double t1;                   // execution target 1
    private double t2;                   // execution target 2
    private double t3;                   // execution target 3
    private double t4;                   // execution target 4

    // Original equity levels (for dual display in wallet)
    private double equitySpot;           // equity price at signal time
    private double equitySl;             // equity SL from signal
    private double equityT1;             // equity target 1
    private double equityT2;             // equity target 2
    private double equityT3;             // equity target 3
    private double equityT4;             // equity target 4

    // Option-specific
    private double delta;                // computed delta used for mapping
    private String deltaFallbackReason;  // null = real BS delta, non-null = reason for 0.5 fallback
    private String optionType;           // CE / PE / null for futures
    private double strike;               // option strike / 0 for futures
    private String optionExpiry;         // option expiry date string (e.g. "2026-03-12")

    // Strategy metadata
    private String strategy;             // FUDKII / FUKAA / PIVOT_CONFLUENCE / MICROALPHA
    private String exchange;             // N / M / C
    private String direction;            // BULLISH / BEARISH
    private double confidence;           // signal confidence %
    private String executionMode;        // "AUTO" (signal-driven) or "MANUAL" (user CTA click)

    // ========== Greek Enrichment (from Streaming Candle via Trade Execution) ==========
    // When greekEnriched=true, SL/T1-T4 are authoritative from Black-Scholes Greeks.
    // Dashboard should use them directly — DO NOT override with computeSmartTargets().
    private boolean greekEnriched;
    private double greekDelta;
    private double greekGamma;
    private double greekTheta;
    private double greekVega;
    private double greekIV;
    private int greekDte;
    private String greekMoneynessType;
    private boolean greekThetaImpaired;
    private String greekSlMethod;
    private double greekGammaBoost;
    private double optionRR;
    private String lotAllocation;        // e.g. "40,30,20,10" or "100,0,0,0" (theta impaired)
    // Cross-instrument futures SL/targets
    private double futuresSL;
    private double futuresT1;
    private double futuresT2;
    private double futuresT3;
    private double futuresT4;

    // ========== Signal Enrichment Metrics (for post-trade regime analysis) ==========
    private double atr;
    private double volumeSurge;
    private double oiChangePercent;
    private double blockDealPercent;
    private double riskReward;

    // ========== Slippage Estimation (from orderbook-aware model) ==========
    private Double estimatedEntrySlippage;      // ₹ per unit at entry
    private Double estimatedEntrySlippageTotal;  // ₹ total at entry
    private Double estimatedSlippagePct;          // estimated round-trip %
    private String slippageTier;                  // FULL/SPREAD_ONLY/VOLUME_ONLY/STATIC

    // ========== Gap Analysis ==========
    private double gapFactor;                    // Gap penalty factor (0.3 - 1.0)
    private double gapQualityScore;              // GQS: 0.0-1.0+ gap-fill trap detector
    private double gapPct;                       // Scrip gap% at open

    // ========== Retest Enrichment ==========
    private boolean retestActive;
    private Double retestBoost;
    private boolean retestDirectionAligned;
    private String retestSource;                 // "W_PIVOT", "W_S1", "W_R1", etc.
    private String retestStage;                  // "D1_BROKEN", "RETEST_30M", "RETEST_15M", etc.

    // ========== Liquidity + Institutional Conviction ==========
    private String liquiditySource;              // "DIRECT", "PROXY", "ON_DEMAND", or "DISABLED"
    private double realMoneyScore;               // Institutional conviction total
    private double dayValueCr;                   // Day value in crores
    private double convictionScore;              // Final conviction score for outcome analysis

    // ========== Option Swap Tracking ==========
    private String originalOptionScripCode;      // Pre-swap ITM option scripCode for proxy liquidity fallback

    // ========== Trade Label ==========
    private String tradeLabel;                   // e.g. "FUT FALLBACK due to Illiquid Opt"
}
