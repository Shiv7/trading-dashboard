package com.kotsin.dashboard.service;

import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Set;

/**
 * InstrumentSlippageConfig — Pessimistic percentage-based slippage rates by instrument class.
 *
 * Used as the STATIC fallback when no orderbook data is available.
 * Rates are calibrated from SEBI impact cost reports, NSE market pulse data,
 * and empirical bid-ask spread observations across Indian markets.
 *
 * All rates are ONE-WAY (entry OR exit), not round-trip.
 */
public class InstrumentSlippageConfig {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** Index underlyings for NSE_INDEX_OPTION / NSE_INDEX_FUTURES classification */
    private static final Set<String> INDEX_SYMBOLS = Set.of(
            "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTY 50", "BANK NIFTY",
            "NIFTY BANK", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP SELECT",
            "SENSEX", "BANKEX"
    );

    public enum InstrumentClass {
        NSE_EQUITY,
        NSE_FUTURES,
        NSE_INDEX_FUTURES,
        NSE_INDEX_OPTION,
        NSE_STOCK_OPTION,
        MCX_FUTURES,
        MCX_OPTION,
        CDS_FUTURES,
        CDS_OPTION
    }

    /**
     * Resolve instrument class from exchange, instrumentType, and symbol.
     *
     * @param exchange       N=NSE, M=MCX, C/U=CDS, B=BSE
     * @param instrumentType EQUITY, FUTURES, OPTION (or null)
     * @param symbol         underlying symbol for index detection
     */
    public static InstrumentClass resolve(String exchange, String instrumentType, String symbol) {
        if (exchange == null) exchange = "N";
        if (instrumentType == null) instrumentType = "EQUITY";

        String exch = exchange.toUpperCase().trim();
        String type = instrumentType.toUpperCase().trim();

        boolean isIndex = symbol != null && INDEX_SYMBOLS.stream()
                .anyMatch(idx -> symbol.toUpperCase().contains(idx));

        // MCX
        if ("M".equals(exch)) {
            if (type.contains("OPTION")) return InstrumentClass.MCX_OPTION;
            return InstrumentClass.MCX_FUTURES;
        }

        // CDS (Currency)
        if ("C".equals(exch) || "U".equals(exch)) {
            if (type.contains("OPTION")) return InstrumentClass.CDS_OPTION;
            return InstrumentClass.CDS_FUTURES;
        }

        // NSE / BSE
        if (type.contains("OPTION")) {
            return isIndex ? InstrumentClass.NSE_INDEX_OPTION : InstrumentClass.NSE_STOCK_OPTION;
        }
        if (type.contains("FUTURE")) {
            return isIndex ? InstrumentClass.NSE_INDEX_FUTURES : InstrumentClass.NSE_FUTURES;
        }
        return InstrumentClass.NSE_EQUITY;
    }

    /**
     * Get base slippage as a fraction of price (one-way).
     * E.g., returns 0.08 for 8% on a deep OTM MCX option.
     */
    public static double getBaseSlippagePct(InstrumentClass instrClass, double price) {
        return switch (instrClass) {
            case NSE_EQUITY -> nseEquitySlippage(price);
            case NSE_FUTURES -> nseFuturesSlippage(price);
            case NSE_INDEX_FUTURES -> 0.0001; // 0.01% — tightest instrument in India
            case NSE_INDEX_OPTION -> nseOptionSlippage(price) * 0.5; // index options ~half stock option spread
            case NSE_STOCK_OPTION -> nseOptionSlippage(price);
            case MCX_FUTURES -> mcxFuturesSlippage(price);
            case MCX_OPTION -> nseOptionSlippage(price) * 2.0; // MCX options ~2x NSE stock options
            case CDS_FUTURES -> 0.00005; // 0.005% — USDINR very tight
            case CDS_OPTION -> nseOptionSlippage(price) * 1.5; // CDS options ~1.5x NSE stock options
        };
    }

    /**
     * Get cap slippage as a fraction of price (one-way).
     * Prevents unrealistic values even with size/urgency multipliers.
     */
    public static double getCapPct(InstrumentClass instrClass) {
        return switch (instrClass) {
            case NSE_EQUITY -> 0.003;       // 0.3%
            case NSE_FUTURES -> 0.005;      // 0.5%
            case NSE_INDEX_FUTURES -> 0.001; // 0.1%
            case NSE_INDEX_OPTION -> 0.10;   // 10%
            case NSE_STOCK_OPTION -> 0.15;   // 15%
            case MCX_FUTURES -> 0.005;      // 0.5%
            case MCX_OPTION -> 0.20;        // 20%
            case CDS_FUTURES -> 0.001;      // 0.1%
            case CDS_OPTION -> 0.15;        // 15%
        };
    }

    // ── NSE Equity by price band ──

    private static double nseEquitySlippage(double price) {
        if (price > 500)  return 0.0002; // 0.02% — NIFTY50 large caps
        if (price > 100)  return 0.0005; // 0.05% — mid caps
        if (price > 50)   return 0.0008; // 0.08%
        return 0.0015;                   // 0.15% — penny territory
    }

    // ── NSE Futures by price band ──

    private static double nseFuturesSlippage(double price) {
        if (price > 500)  return 0.0003; // 0.03%
        if (price > 100)  return 0.0006; // 0.06%
        return 0.0010;                   // 0.10%
    }

    // ── NSE Options by premium band ──
    // This is the critical table. OTM stock options have massive spreads.
    // Data from SEBI market microstructure reports + empirical observations.

    private static double nseOptionSlippage(double premium) {
        if (premium < 2)    return 0.15;   // 15% — near-zero premium, spread ≈ price
        if (premium < 5)    return 0.10;   // 10% — lottery tickets
        if (premium < 10)   return 0.06;   //  6% — deep OTM
        if (premium < 20)   return 0.04;   //  4% — OTM
        if (premium < 50)   return 0.025;  //  2.5% — moderate OTM
        if (premium < 100)  return 0.015;  //  1.5% — near ATM
        if (premium < 200)  return 0.008;  //  0.8% — ATM range
        if (premium < 500)  return 0.005;  //  0.5% — deep ITM / expensive ATM
        return 0.003;                      //  0.3% — very deep ITM
    }

    // ── MCX Futures by price band ──

    private static double mcxFuturesSlippage(double price) {
        if (price > 10000)  return 0.0003; // 0.03% — GOLD, SILVER
        if (price > 1000)   return 0.0005; // 0.05% — CRUDE, COPPER, NICKEL
        if (price > 100)    return 0.0008; // 0.08% — ALUMINIUM, ZINC, NATGAS underlying
        return 0.0015;                     // 0.15% — low-price MCX
    }

    // ── Size multiplier ──
    // More lots = more slippage (eating through book depth)

    public static double getSizeMultiplier(int lots) {
        if (lots <= 3)  return 1.0;
        if (lots <= 10) return 1.15;
        if (lots <= 25) return 1.30;
        if (lots <= 50) return 1.60;
        return 2.0;
    }

    // ── Time-of-day urgency multiplier ──

    public static double getUrgencyMultiplier() {
        LocalTime now = LocalTime.now(IST);
        int minuteOfDay = now.getHour() * 60 + now.getMinute();

        if (minuteOfDay < 570)  return 2.0;  // 9:00-9:30 — opening, widest spreads
        if (minuteOfDay < 600)  return 1.3;  // 9:30-10:00 — settling
        if (minuteOfDay < 840)  return 1.0;  // 10:00-14:00 — normal liquidity
        if (minuteOfDay < 915)  return 1.2;  // 14:00-15:15 — NSE pre-close squaring
        if (minuteOfDay < 1020) return 1.4;  // 15:15-17:00 — NSE closed, MCX/CDS thinner
        if (minuteOfDay < 1260) return 1.0;  // 17:00-21:00 — MCX prime time (US overlap)
        return 1.3;                           // 21:00-23:30 — thinning out
    }

    /**
     * Compute full pessimistic static slippage per unit.
     * slippage = price × basePct × sizeMult × urgency, floored at minTickSlip, capped at capPct × price.
     */
    public static double computeStaticSlippage(InstrumentClass instrClass, double price,
                                                int lots, double tickSize) {
        double basePct = getBaseSlippagePct(instrClass, price);
        double sizeMult = getSizeMultiplier(lots);
        double urgency = getUrgencyMultiplier();

        double slip = price * basePct * sizeMult * urgency;

        // Floor: at least 1 tick
        if (tickSize > 0) {
            slip = Math.max(slip, tickSize);
        }

        // Cap
        double capPct = getCapPct(instrClass);
        slip = Math.min(slip, price * capPct);

        return slip;
    }
}
