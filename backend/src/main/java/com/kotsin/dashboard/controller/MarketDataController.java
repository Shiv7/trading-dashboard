package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.OptionTickPriceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * REST controller for market data lookups (LTP, etc.) from Redis candle data.
 */
@RestController
@RequestMapping("/api/market-data")
public class MarketDataController {

    @Autowired
    private OptionTickPriceService optionTickPriceService;

    /**
     * Get the latest LTP for a given scripCode.
     * Reads from Redis candle history (tick:{scripCode}:1m:history).
     *
     * @param scripCode the instrument scrip code
     * @return JSON with scripCode, ltp, and timestamp
     */
    @GetMapping("/ltp/{scripCode}")
    public ResponseEntity<Map<String, Object>> getLatestLtp(@PathVariable String scripCode) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("scripCode", scripCode);

        Double ltp = optionTickPriceService.getLatestLtp(scripCode);
        response.put("ltp", ltp);

        if (ltp != null) {
            response.put("timestamp", System.currentTimeMillis());
        }

        return ResponseEntity.ok(response);
    }
}
