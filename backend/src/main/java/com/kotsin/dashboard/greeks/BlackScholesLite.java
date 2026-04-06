package com.kotsin.dashboard.greeks;

/**
 * Lightweight static Black-Scholes calculator for the Greek Trailing Engine.
 * Uses Abramowitz & Stegun approximation for the cumulative normal distribution.
 * Risk-free rate: 7% (India).
 *
 * Mirror of com.kotsin.execution.greeks.BlackScholesLite (Trade Execution module).
 */
public final class BlackScholesLite {

    private static final double R = 0.07;
    private static final double SQRT_2PI = Math.sqrt(2 * Math.PI);
    private static final int IV_MAX_ITER = 20;
    private static final double IV_TOLERANCE = 1e-6;

    private BlackScholesLite() {}

    // ──────────────────── Greeks ────────────────────

    /**
     * Black-Scholes delta.
     * @param spot   current underlying price
     * @param strike strike price
     * @param tte    time to expiry in years
     * @param vol    annualised implied volatility (e.g. 0.30 = 30%)
     * @param isCall true for CE, false for PE
     * @return delta value (call: 0..1, put: -1..0)
     */
    public static double delta(double spot, double strike, double tte, double vol, boolean isCall) {
        if (tte <= 0 || vol <= 0 || spot <= 0 || strike <= 0) return isCall ? 1.0 : -1.0;
        double d1 = d1(spot, strike, tte, vol);
        return isCall ? normalCDF(d1) : normalCDF(d1) - 1.0;
    }

    /**
     * Black-Scholes gamma (identical for calls and puts).
     */
    public static double gamma(double spot, double strike, double tte, double vol) {
        if (tte <= 0 || vol <= 0 || spot <= 0 || strike <= 0) return 0.0;
        double d1 = d1(spot, strike, tte, vol);
        return normalPDF(d1) / (spot * vol * Math.sqrt(tte));
    }

    /**
     * Black-Scholes theta (per year). Divide by 365 for daily theta.
     */
    public static double theta(double spot, double strike, double tte, double vol, boolean isCall) {
        if (tte <= 0 || vol <= 0 || spot <= 0 || strike <= 0) return 0.0;
        double sqrtT = Math.sqrt(tte);
        double d1 = d1(spot, strike, tte, vol);
        double d2 = d1 - vol * sqrtT;
        double npd1 = normalPDF(d1);
        double discountK = R * strike * Math.exp(-R * tte);

        if (isCall) {
            return -(spot * npd1 * vol) / (2.0 * sqrtT) - discountK * normalCDF(d2);
        } else {
            return -(spot * npd1 * vol) / (2.0 * sqrtT) + discountK * normalCDF(-d2);
        }
    }

    // ──────────────────── Implied Volatility ────────────────────

    /**
     * Newton-Raphson implied volatility solver.
     * @param optionPrice market price of the option
     * @param spot        current underlying price
     * @param strike      strike price
     * @param tte         time to expiry in years
     * @param isCall      true for CE, false for PE
     * @return implied volatility (annualised, e.g. 0.30 = 30%), or -1 if not converged
     */
    public static double impliedVol(double optionPrice, double spot, double strike,
                                     double tte, boolean isCall) {
        if (optionPrice <= 0 || tte <= 0 || spot <= 0 || strike <= 0) return -1.0;

        // Initial guess: Brenner-Subrahmanyam approximation
        double iv = Math.sqrt(2.0 * Math.PI / tte) * optionPrice / spot;
        iv = Math.max(0.01, Math.min(iv, 5.0));

        for (int i = 0; i < IV_MAX_ITER; i++) {
            double price = bsPrice(spot, strike, tte, iv, isCall);
            double vega = bsVega(spot, strike, tte, iv);
            if (Math.abs(vega) < 1e-12) break;

            double diff = optionPrice - price;
            if (Math.abs(diff) < IV_TOLERANCE) return iv;

            iv += diff / vega;
            iv = Math.max(0.001, Math.min(iv, 5.0));
        }
        return iv;
    }

    // ──────────────────── Black-Scholes price & vega ────────────────────

    private static double bsPrice(double spot, double strike, double tte, double vol, boolean isCall) {
        double sqrtT = Math.sqrt(tte);
        double d1 = d1(spot, strike, tte, vol);
        double d2 = d1 - vol * sqrtT;
        double discountedK = strike * Math.exp(-R * tte);
        if (isCall) {
            return spot * normalCDF(d1) - discountedK * normalCDF(d2);
        } else {
            return discountedK * normalCDF(-d2) - spot * normalCDF(-d1);
        }
    }

    /** Vega: dPrice/dVol (NOT per 1% — raw partial derivative). */
    private static double bsVega(double spot, double strike, double tte, double vol) {
        double d1 = d1(spot, strike, tte, vol);
        return spot * normalPDF(d1) * Math.sqrt(tte);
    }

    // ──────────────────── Helpers ────────────────────

    private static double d1(double spot, double strike, double tte, double vol) {
        return (Math.log(spot / strike) + (R + vol * vol / 2.0) * tte) / (vol * Math.sqrt(tte));
    }

    /**
     * Cumulative normal distribution — Abramowitz & Stegun approximation.
     */
    static double normalCDF(double x) {
        if (x > 6.0) return 1.0;
        if (x < -6.0) return 0.0;

        double a = Math.abs(x);
        double t = 1.0 / (1.0 + 0.2316419 * a);
        double b = (1.0 / SQRT_2PI) * Math.exp(-x * x / 2.0);
        double n = ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530) * t;
        n = 1.0 - b * n;
        return x < 0 ? 1.0 - n : n;
    }

    /** Standard normal PDF: N'(x) = exp(-x^2/2) / sqrt(2*pi) */
    static double normalPDF(double x) {
        return Math.exp(-x * x / 2.0) / SQRT_2PI;
    }
}
