package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.TradingModeService;
import com.kotsin.dashboard.service.TradingModeService.TradingMode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Controller for managing trading mode (VIRTUAL vs LIVE).
 */
@RestController
@RequestMapping("/api/trading-mode")
@RequiredArgsConstructor
@Slf4j
public class TradingModeController {

    private final TradingModeService tradingModeService;

    /**
     * Get current trading mode status
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> getMode() {
        return ResponseEntity.ok(Map.of(
            "mode", tradingModeService.getCurrentMode().name(),
            "isVirtual", tradingModeService.isVirtual(),
            "isLive", tradingModeService.isLive(),
            "liveTradingEnabled", tradingModeService.isLiveTradingEnabled()
        ));
    }

    /**
     * Switch trading mode
     */
    @PostMapping("/{mode}")
    public ResponseEntity<Map<String, Object>> setMode(@PathVariable String mode) {
        try {
            TradingMode newMode = TradingMode.valueOf(mode.toUpperCase());

            // Safety check: don't allow LIVE unless explicitly enabled
            if (newMode == TradingMode.LIVE && !tradingModeService.isLiveTradingEnabled()) {
                return ResponseEntity.badRequest().body(Map.of(
                    "error", "Live trading is not enabled",
                    "message", "Call POST /api/trading-mode/enable-live first to enable live trading"
                ));
            }

            boolean changed = tradingModeService.setMode(newMode);

            return ResponseEntity.ok(Map.of(
                "mode", tradingModeService.getCurrentMode().name(),
                "changed", changed,
                "message", changed ? "Mode changed to " + newMode : "Already in " + newMode + " mode"
            ));

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "Invalid mode",
                "message", "Mode must be VIRTUAL or LIVE"
            ));
        }
    }

    /**
     * Enable live trading capability (requires confirmation)
     */
    @PostMapping("/enable-live")
    public ResponseEntity<Map<String, Object>> enableLive(
            @RequestParam(required = false, defaultValue = "false") boolean confirm) {

        if (!confirm) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "Confirmation required",
                "message", "Add ?confirm=true to enable live trading. This will use real money!"
            ));
        }

        tradingModeService.setLiveTradingEnabled(true);
        log.warn("⚠️ LIVE TRADING ENABLED by user");

        return ResponseEntity.ok(Map.of(
            "liveTradingEnabled", true,
            "mode", tradingModeService.getCurrentMode().name(),
            "warning", "Live trading is now enabled. Orders will use real money when mode is LIVE."
        ));
    }

    /**
     * Disable live trading capability
     */
    @PostMapping("/disable-live")
    public ResponseEntity<Map<String, Object>> disableLive() {
        tradingModeService.setLiveTradingEnabled(false);
        log.info("Live trading disabled");

        return ResponseEntity.ok(Map.of(
            "liveTradingEnabled", false,
            "mode", tradingModeService.getCurrentMode().name(),
            "message", "Live trading disabled. Mode forced to VIRTUAL."
        ));
    }
}
