package com.kotsin.dashboard.service;

/**
 * Per-asset live-data freshness state, rendered on the market-pulse UI.
 *
 * LIVE            — tick stream / scraper is currently updating; pulsating green dot
 * STALE_SESSION   — market still open but last update is 2–10 min old; solid amber dot
 * CLOSED_AFTERHRS — market closed (after hours / weekend / holiday), showing last-trade value; solid grey dot
 * CLOSED_HOLIDAY  — NSE holiday today (subset of CLOSED_AFTERHRS, with named holiday subtitle)
 * ERROR           — no update for > 48h, data likely broken; solid red dot
 */
public enum MarketState {
    LIVE, STALE_SESSION, CLOSED_AFTERHRS, CLOSED_HOLIDAY, ERROR
}
