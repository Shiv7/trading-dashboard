package com.kotsin.dashboard.service;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Transaction Cost Calculator — Zerodha Rate Card (2026)
 *
 * Covers all segments: Equity (NSE/BSE), Currency, Commodity (MCX).
 * Calculates brokerage, STT/CTT, exchange/transaction charges, GST, SEBI, stamp duty.
 */
@Service
@Slf4j
public class TransactionCostService {

    // ── Brokerage ──
    private static final double BROKERAGE_FLAT = 20.0;
    private static final double BROKERAGE_PCT = 0.03 / 100;

    // ── STT / CTT ──
    private static final double STT_EQ_DELIVERY_RATE = 0.1 / 100;
    private static final double STT_EQ_INTRADAY_SELL = 0.025 / 100;
    private static final double STT_EQ_FUTURES_SELL  = 0.02 / 100;
    private static final double STT_EQ_OPTIONS_SELL  = 0.1 / 100;
    private static final double CTT_COMM_FUTURES_SELL = 0.01 / 100;
    private static final double CTT_COMM_OPTIONS_SELL = 0.05 / 100;

    // ── Exchange / Transaction Charges ──
    private static final double TXN_NSE_EQ      = 0.00307 / 100;
    private static final double TXN_BSE_EQ      = 0.00375 / 100;
    private static final double TXN_NSE_FUTURES  = 0.00183 / 100;
    private static final double TXN_NSE_OPTIONS  = 0.03553 / 100;
    private static final double TXN_CUR_FUTURES_NSE = 0.00035 / 100;
    private static final double TXN_CUR_FUTURES_BSE = 0.00045 / 100;
    private static final double TXN_CUR_OPTIONS_NSE = 0.0311 / 100;
    private static final double TXN_CUR_OPTIONS_BSE = 0.001 / 100;
    private static final double TXN_COMM_FUTURES_MCX = 0.0021 / 100;
    private static final double TXN_COMM_FUTURES_NSE = 0.0001 / 100;
    private static final double TXN_COMM_OPTIONS_MCX = 0.0418 / 100;
    private static final double TXN_COMM_OPTIONS_NSE = 0.001 / 100;

    // ── GST ──
    private static final double GST_RATE = 0.18;

    // ── SEBI ──
    private static final double SEBI_PER_CRORE = 10.0;
    private static final double CRORE = 1_00_00_000.0;

    // ── Stamp Duty (buy side only) ──
    private static final double STAMP_EQ_DELIVERY  = 0.015 / 100;
    private static final double STAMP_EQ_INTRADAY  = 0.003 / 100;
    private static final double STAMP_EQ_FUTURES   = 0.002 / 100;
    private static final double STAMP_EQ_OPTIONS   = 0.003 / 100;
    private static final double STAMP_CUR_FUTURES  = 0.0001 / 100;
    private static final double STAMP_CUR_OPTIONS  = 0.0001 / 100;
    private static final double STAMP_COMM_FUTURES = 0.002 / 100;
    private static final double STAMP_COMM_OPTIONS = 0.003 / 100;

    /**
     * Calculate round-trip (entry + exit) total charges.
     */
    public double calculateRoundTripCharges(TradeType tradeType,
                                             double entryPrice, double exitPrice,
                                             int qty, String exchange) {
        double entryValue = entryPrice * qty;
        double exitValue  = exitPrice * qty;

        double entryCost = calcOneLeg(tradeType, entryValue, TradeSide.BUY, exchange);
        double exitCost  = calcOneLeg(tradeType, exitValue, TradeSide.SELL, exchange);

        double total = entryCost + exitCost;

        log.info("ROUND_TRIP_CHARGES type={} entry={} exit={} qty={} exch={} charges={}",
                tradeType, fmt(entryPrice), fmt(exitPrice), qty, exchange, fmt(total));

        return total;
    }

    /**
     * Calculate round-trip charges with per-component breakdown.
     * Returns: {total, brokerage, stt, exchangeCharges, gst, sebiCharges, stampDuty}
     */
    public Map<String, Double> calculateRoundTripBreakdown(TradeType tradeType,
                                                            double entryPrice, double exitPrice,
                                                            int qty, String exchange) {
        double entryValue = entryPrice * qty;
        double exitValue  = exitPrice * qty;
        double[] entryB = calcOneLegBreakdown(tradeType, entryValue, TradeSide.BUY, exchange);
        double[] exitB  = calcOneLegBreakdown(tradeType, exitValue, TradeSide.SELL, exchange);
        Map<String, Double> m = new java.util.LinkedHashMap<>();
        m.put("brokerage",       entryB[0] + exitB[0]);
        m.put("stt",             entryB[1] + exitB[1]);
        m.put("exchangeCharges", entryB[2] + exitB[2]);
        m.put("gst",             entryB[3] + exitB[3]);
        m.put("sebiCharges",     entryB[4] + exitB[4]);
        m.put("stampDuty",       entryB[5] + exitB[5]);
        m.put("total",           m.values().stream().mapToDouble(Double::doubleValue).sum());
        return m;
    }

    private double calcOneLeg(TradeType tradeType, double tradeValue,
                               TradeSide side, String exchange) {
        double brokerage = calculateBrokerage(tradeType, tradeValue);
        double stt       = calculateSTT(tradeType, tradeValue, side);
        double txnCharge = calculateTransactionCharges(tradeType, tradeValue, exchange);
        double sebi      = (tradeValue / CRORE) * SEBI_PER_CRORE;
        double gst       = (brokerage + sebi + txnCharge) * GST_RATE;
        double stamp     = (side == TradeSide.BUY) ? calculateStampDuty(tradeType, tradeValue) : 0.0;
        return brokerage + stt + txnCharge + gst + sebi + stamp;
    }

    /** Returns [brokerage, stt, exchangeCharges, gst, sebi, stamp] */
    private double[] calcOneLegBreakdown(TradeType tradeType, double tradeValue,
                                          TradeSide side, String exchange) {
        double brokerage = calculateBrokerage(tradeType, tradeValue);
        double stt       = calculateSTT(tradeType, tradeValue, side);
        double txnCharge = calculateTransactionCharges(tradeType, tradeValue, exchange);
        double sebi      = (tradeValue / CRORE) * SEBI_PER_CRORE;
        double gst       = (brokerage + sebi + txnCharge) * GST_RATE;
        double stamp     = (side == TradeSide.BUY) ? calculateStampDuty(tradeType, tradeValue) : 0.0;
        return new double[]{ brokerage, stt, txnCharge, gst, sebi, stamp };
    }

    public static TradeType resolveTradeType(String exchange, String instrumentType) {
        String ex  = (exchange == null || exchange.isEmpty()) ? "N" : exchange.toUpperCase();
        String ins = (instrumentType == null) ? "" : instrumentType.toUpperCase();
        if ("M".equals(ex)) {
            return ins.contains("OPTION") ? TradeType.COMMODITY_OPTIONS : TradeType.COMMODITY_FUTURES;
        }
        if ("C".equals(ex)) {
            return ins.contains("OPTION") ? TradeType.CURRENCY_OPTIONS : TradeType.CURRENCY_FUTURES;
        }
        if (ins.contains("OPTION")) return TradeType.EQUITY_OPTIONS;
        if (ins.contains("FUTURE")) return TradeType.EQUITY_FUTURES;
        return TradeType.EQUITY_INTRADAY;
    }

    public static String normalizeExchange(String exchange) {
        if (exchange == null || exchange.isEmpty()) return "NSE";
        switch (exchange.toUpperCase()) {
            case "N": return "NSE";
            case "B": return "BSE";
            case "M": return "MCX";
            case "C": return "NSE";
            default:  return "NSE";
        }
    }

    private double calculateBrokerage(TradeType tradeType, double tradeValue) {
        if (tradeType == TradeType.EQUITY_DELIVERY) return 0.0;
        if (tradeType == TradeType.EQUITY_OPTIONS ||
            tradeType == TradeType.CURRENCY_OPTIONS ||
            tradeType == TradeType.COMMODITY_OPTIONS) {
            return BROKERAGE_FLAT;
        }
        return Math.min(tradeValue * BROKERAGE_PCT, BROKERAGE_FLAT);
    }

    private double calculateSTT(TradeType tradeType, double tradeValue, TradeSide side) {
        switch (tradeType) {
            case EQUITY_DELIVERY:   return tradeValue * STT_EQ_DELIVERY_RATE;
            case EQUITY_INTRADAY:   return side == TradeSide.SELL ? tradeValue * STT_EQ_INTRADAY_SELL : 0.0;
            case EQUITY_FUTURES:    return side == TradeSide.SELL ? tradeValue * STT_EQ_FUTURES_SELL : 0.0;
            case EQUITY_OPTIONS:    return side == TradeSide.SELL ? tradeValue * STT_EQ_OPTIONS_SELL : 0.0;
            case CURRENCY_FUTURES:
            case CURRENCY_OPTIONS:  return 0.0;
            case COMMODITY_FUTURES: return side == TradeSide.SELL ? tradeValue * CTT_COMM_FUTURES_SELL : 0.0;
            case COMMODITY_OPTIONS: return side == TradeSide.SELL ? tradeValue * CTT_COMM_OPTIONS_SELL : 0.0;
            default: return 0.0;
        }
    }

    private double calculateTransactionCharges(TradeType tradeType, double tradeValue, String exchange) {
        String exch = (exchange == null) ? "NSE" : exchange.toUpperCase();
        switch (tradeType) {
            case EQUITY_DELIVERY:
            case EQUITY_INTRADAY:   return tradeValue * ("BSE".equals(exch) ? TXN_BSE_EQ : TXN_NSE_EQ);
            case EQUITY_FUTURES:    return tradeValue * TXN_NSE_FUTURES;
            case EQUITY_OPTIONS:    return tradeValue * TXN_NSE_OPTIONS;
            case CURRENCY_FUTURES:  return tradeValue * ("BSE".equals(exch) ? TXN_CUR_FUTURES_BSE : TXN_CUR_FUTURES_NSE);
            case CURRENCY_OPTIONS:  return tradeValue * ("BSE".equals(exch) ? TXN_CUR_OPTIONS_BSE : TXN_CUR_OPTIONS_NSE);
            case COMMODITY_FUTURES: return tradeValue * ("MCX".equals(exch) ? TXN_COMM_FUTURES_MCX : TXN_COMM_FUTURES_NSE);
            case COMMODITY_OPTIONS: return tradeValue * ("MCX".equals(exch) ? TXN_COMM_OPTIONS_MCX : TXN_COMM_OPTIONS_NSE);
            default: return tradeValue * TXN_NSE_EQ;
        }
    }

    private double calculateStampDuty(TradeType tradeType, double tradeValue) {
        switch (tradeType) {
            case EQUITY_DELIVERY:   return tradeValue * STAMP_EQ_DELIVERY;
            case EQUITY_INTRADAY:   return tradeValue * STAMP_EQ_INTRADAY;
            case EQUITY_FUTURES:    return tradeValue * STAMP_EQ_FUTURES;
            case EQUITY_OPTIONS:    return tradeValue * STAMP_EQ_OPTIONS;
            case CURRENCY_FUTURES:  return tradeValue * STAMP_CUR_FUTURES;
            case CURRENCY_OPTIONS:  return tradeValue * STAMP_CUR_OPTIONS;
            case COMMODITY_FUTURES: return tradeValue * STAMP_COMM_FUTURES;
            case COMMODITY_OPTIONS: return tradeValue * STAMP_COMM_OPTIONS;
            default:                return tradeValue * STAMP_EQ_INTRADAY;
        }
    }

    private static String fmt(double v) { return String.format("%.2f", v); }

    public enum TradeType {
        EQUITY_DELIVERY, EQUITY_INTRADAY, EQUITY_FUTURES, EQUITY_OPTIONS,
        CURRENCY_FUTURES, CURRENCY_OPTIONS, COMMODITY_FUTURES, COMMODITY_OPTIONS
    }

    public enum TradeSide { BUY, SELL }
}
