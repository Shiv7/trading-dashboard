package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.StockContextService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Single endpoint that returns EVERYTHING the Stock Detail page needs.
 * Replaces the old pattern of 8 parallel API calls (5 of which returned 404).
 * One call, zero 404s, all data aggregated server-side.
 */
@RestController
@RequestMapping("/api/stock")
@RequiredArgsConstructor
public class StockContextController {

    private final StockContextService stockContextService;

    @GetMapping("/{scripCode}/context")
    public ResponseEntity<Map<String, Object>> getStockContext(@PathVariable String scripCode) {
        return ResponseEntity.ok(stockContextService.buildContext(scripCode));
    }
}
