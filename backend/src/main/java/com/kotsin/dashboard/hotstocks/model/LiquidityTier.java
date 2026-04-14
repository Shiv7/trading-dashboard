package com.kotsin.dashboard.hotstocks.model;

public enum LiquidityTier {
    HIGH,   // 20D turnover >= 100 Cr — any size up to 1.5L fine
    MED,    // 20-100 Cr — stagger entries
    LOW;    // < 20 Cr — halve position or skip

    public static LiquidityTier fromTurnoverCr(double turnoverCr) {
        if (turnoverCr >= 100.0) return HIGH;
        if (turnoverCr >= 20.0) return MED;
        return LOW;
    }
}
