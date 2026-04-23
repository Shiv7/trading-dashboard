package com.kotsin.dashboard.hotstocks.service;

import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Classifies a bulk/block-deal counterparty name into a quality tier used to
 * weight the observed flow. Pattern-based; runs in shadow mode only (see
 * {@code hotstocks.client.quality.apply}) until calibration lands.
 *
 * Tiers:
 *   - SMART   — explicit institutional / regulated counterparties (MFs, insurance,
 *               pension, sovereign, FPIs, certain named banks). Expected to move
 *               with thesis; weight 1.3× in shadow aggregates.
 *   - SHELL   — entities that frequently appear in rotation / non-institutional
 *               flows (HUF, LLP, "VENTURES / HOLDINGS / INFRA REALTY / REALTY
 *               PRIVATE LIMITED", stand-alone "CAPITAL MARKETS LIMITED" names
 *               that are NOT in the known-broker exception list). Weight 0.8×.
 *   - NEUTRAL — everything else, including known brokers' capital-markets arms.
 *               Default weight 1.0×.
 *
 * Pattern matching is case-insensitive. Deal counterparty strings from NSE can
 * be noisy (extra whitespace, capitalisation variance, abbreviations), so we
 * uppercase once and search against literal substrings.
 */
@Component
public class ClientQualityClassifier {

    public enum Tier { SMART, NEUTRAL, SHELL }

    /**
     * Broker exception list — their "capital markets limited" arms appear as
     * counterparties but represent retail routing rather than shell activity.
     * Keep strictly upper-case for direct substring match.
     */
    private static final List<String> BROKER_EXCEPTIONS = List.of(
            "MOTILAL OSWAL",
            "IIFL",
            "KOTAK SECURITIES",
            "ICICI DIRECT",
            "ZERODHA",
            "UPSTOX",
            "HDFC SECURITIES",
            "AXIS SECURITIES",
            "SHAREKHAN");

    /**
     * SMART substring markers. Order not significant — first match wins.
     * MUTUAL FUND covers "…MUTUAL FUND TRUSTEES …", AMC covers all *AMC LIMITED*
     * asset-management company names.
     */
    private static final List<String> SMART_MARKERS = List.of(
            "MUTUAL FUND",
            "AMC",
            "INSURANCE",
            "PENSION",
            "SOVEREIGN",
            "FOREIGN PORTFOLIO",
            "FII",
            "BANK LIMITED");

    /**
     * Bank-limited guard: exclude names that coincidentally contain BANK but are
     * actually broker/arbitrage shells. Evaluated only when BANK LIMITED matched.
     */
    private static final List<String> BANK_LIMITED_EXCLUSIONS = List.of(
            "BANK BROKERS",
            "BANK CAPITAL");

    private static final List<String> SHELL_MARKERS = List.of(
            "HUF",
            "LLP",
            " VENTURES ",
            " HOLDINGS ",
            "INFRA REALTY",
            "REALTY PRIVATE LIMITED",
            "CAPITAL MARKETS LIMITED");

    /**
     * Classify a counterparty name. Null / blank → NEUTRAL (no signal either way).
     * SHELL is decided AFTER the broker-exceptions check — a known broker never
     * gets punished even if its name contains "CAPITAL MARKETS LIMITED".
     */
    public Tier classify(String clientName) {
        if (clientName == null) return Tier.NEUTRAL;
        String name = clientName.trim();
        if (name.isEmpty()) return Tier.NEUTRAL;
        String upper = " " + name.toUpperCase() + " ";  // pad so " VENTURES " matches at edges

        // 1. Broker exception — always overrides any later SHELL match
        for (String broker : BROKER_EXCEPTIONS) {
            if (upper.contains(broker)) return Tier.NEUTRAL;
        }

        // 2. SMART markers
        for (String marker : SMART_MARKERS) {
            if (upper.contains(marker)) {
                // BANK LIMITED guard — reject "… BANK BROKERS CAPITAL LIMITED" style
                if ("BANK LIMITED".equals(marker)) {
                    boolean excluded = false;
                    for (String ex : BANK_LIMITED_EXCLUSIONS) {
                        if (upper.contains(ex)) { excluded = true; break; }
                    }
                    if (excluded) continue;
                }
                return Tier.SMART;
            }
        }

        // 3. SHELL markers
        for (String marker : SHELL_MARKERS) {
            if (upper.contains(marker)) return Tier.SHELL;
        }

        return Tier.NEUTRAL;
    }

    /** Shadow weights — applied in aggregate only, never to live scoring. */
    public double shadowWeightFor(Tier tier) {
        return switch (tier) {
            case SMART -> 1.3;
            case SHELL -> 0.8;
            default    -> 1.0;
        };
    }
}
