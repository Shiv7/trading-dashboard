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
    private String side;                 // "BUY"
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
    private String optionType;           // CE / PE / null for futures
    private double strike;               // option strike / 0 for futures

    // Strategy metadata
    private String strategy;             // FUDKII / FUKAA / PIVOT_CONFLUENCE / MICROALPHA
    private String exchange;             // N / M / C
    private String direction;            // BULLISH / BEARISH
    private double confidence;           // signal confidence %
}
