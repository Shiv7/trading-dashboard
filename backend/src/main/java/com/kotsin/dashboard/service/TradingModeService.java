package com.kotsin.dashboard.service;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.concurrent.atomic.AtomicReference;

/**
 * Service to manage trading mode (VIRTUAL vs LIVE).
 * Default is VIRTUAL for safety.
 */
@Service
@Slf4j
public class TradingModeService {

    public enum TradingMode {
        VIRTUAL,  // Paper trading through VirtualEngineService
        LIVE      // Real trading through 5Paisa
    }

    private final AtomicReference<TradingMode> currentMode = new AtomicReference<>(TradingMode.VIRTUAL);

    @Getter
    private volatile boolean liveTradingEnabled = false;

    /**
     * Get current trading mode
     */
    public TradingMode getCurrentMode() {
        return currentMode.get();
    }

    /**
     * Switch to a new trading mode
     * @param mode The new mode
     * @return true if mode was changed, false if already in that mode
     */
    public boolean setMode(TradingMode mode) {
        TradingMode previous = currentMode.getAndSet(mode);
        if (previous != mode) {
            log.warn("⚠️ TRADING MODE CHANGED: {} -> {}", previous, mode);
            return true;
        }
        return false;
    }

    /**
     * Enable/disable live trading capability.
     * Must be called before setMode(LIVE) can work.
     */
    public void setLiveTradingEnabled(boolean enabled) {
        this.liveTradingEnabled = enabled;
        if (!enabled && currentMode.get() == TradingMode.LIVE) {
            // Force back to virtual if live is disabled
            currentMode.set(TradingMode.VIRTUAL);
            log.warn("⚠️ Live trading disabled - forced back to VIRTUAL mode");
        }
        log.info("Live trading capability: {}", enabled ? "ENABLED" : "DISABLED");
    }

    /**
     * Check if currently in virtual mode
     */
    public boolean isVirtual() {
        return currentMode.get() == TradingMode.VIRTUAL;
    }

    /**
     * Check if currently in live mode
     */
    public boolean isLive() {
        return currentMode.get() == TradingMode.LIVE && liveTradingEnabled;
    }

    /**
     * Get API path prefix based on current mode
     */
    public String getApiPathPrefix() {
        return isLive() ? "/api/live" : "/api/virtual";
    }
}
