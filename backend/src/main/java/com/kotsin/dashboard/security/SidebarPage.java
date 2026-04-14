package com.kotsin.dashboard.security;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

public enum SidebarPage {
    DASHBOARD("dashboard", "Dashboard"),
    WATCHLIST("watchlist", "Watchlist"),
    ORDERS("orders", "Orders"),
    POSITIONS("positions", "Positions"),
    TRADES("trades", "Trades"),
    PNL("pnl", "PnL Analytics"),
    SIGNALS("signals", "Signals"),
    RISK("risk", "Risk"),
    QUANT_SCORES("quant-scores", "Quant Score"),
    GREEK_TRAILING("greek-trailing", "Greek Trail"),
    PERFORMANCE("performance", "Performance"),
    PATTERNS("patterns", "Patterns"),
    INSIGHTS("insights", "Insights"),
    MARKET_PULSE("market-pulse", "Market Pulse"),
    HOT_STOCKS("hot-stocks", "HotStocks"),
    STRATEGY("strategy", "Strategy"),
    WALLETS("wallets", "Wallets"),
    ML_SHADOW("ml-shadow", "ML Shadow");

    private final String key;
    private final String label;

    SidebarPage(String key, String label) {
        this.key = key;
        this.label = label;
    }

    public String getKey() { return key; }
    public String getLabel() { return label; }

    public static Set<String> allKeys() {
        return Arrays.stream(values()).map(SidebarPage::getKey).collect(Collectors.toSet());
    }

    public static List<SidebarPage> asList() {
        return Arrays.asList(values());
    }

    public static boolean isValid(String key) {
        return allKeys().contains(key);
    }
}
