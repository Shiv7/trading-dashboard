package com.kotsin.dashboard.kafka;

/**
 * Interface for strategy consumers that cache option data in signal maps.
 * When trade execution swaps an ITM option to OTM, the dashboard backend
 * calls updateTradedOption() on all implementing consumers so the frontend
 * CTA reflects the actual traded instrument, not the pre-swap one.
 */
public interface OptionSwapAware {

    /**
     * Update cached signal option fields for a given underlying scripCode.
     *
     * @param underlyingScripCode the equity/commodity scripCode (e.g. "17438" for OIL)
     * @param strategy            the strategy key (e.g. "FUDKII") — consumer only updates if it matches
     * @param newScripCode        actual traded option scripCode
     * @param newSymbol           actual traded option symbol (e.g. "OIL 30 MAR 2026 CE 480.00")
     * @param newStrike           actual traded strike
     * @param newLtp              actual traded entry premium
     * @param optionType          CE or PE
     */
    void updateTradedOption(String underlyingScripCode, String strategy,
                            String newScripCode, String newSymbol,
                            double newStrike, double newLtp, String optionType);
}
