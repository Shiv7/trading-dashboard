package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.MarketPulseService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/market-pulse")
@RequiredArgsConstructor
public class MarketPulseController {

    private final MarketPulseService marketPulseService;

    @GetMapping
    public ResponseEntity<MarketPulseService.MacroSnapshot> getMacroSnapshot() {
        return ResponseEntity.ok(marketPulseService.getLatestSnapshot());
    }

    @GetMapping("/block-deals")
    public ResponseEntity<List<Map<String, Object>>> getBlockDeals() {
        return ResponseEntity.ok(marketPulseService.getBlockDeals());
    }

    @GetMapping("/bulk-deals")
    public ResponseEntity<List<Map<String, Object>>> getBulkDeals() {
        return ResponseEntity.ok(marketPulseService.getBulkDeals());
    }

    @GetMapping("/fii-dii")
    public ResponseEntity<List<Map<String, Object>>> getFiiDii() {
        return ResponseEntity.ok(marketPulseService.getFiiDii());
    }

    @GetMapping("/corporate-events")
    public ResponseEntity<List<Map<String, Object>>> getCorporateEvents() {
        return ResponseEntity.ok(marketPulseService.getCorporateEvents());
    }

    @GetMapping("/delivery-data")
    public ResponseEntity<Map<String, Object>> getDeliveryData() {
        return ResponseEntity.ok(marketPulseService.getDeliveryData());
    }

    @GetMapping("/conviction/{symbol}")
    public ResponseEntity<Map<String, Object>> getConviction(@PathVariable String symbol) {
        return ResponseEntity.ok(marketPulseService.getConvictionForSymbol(symbol));
    }
}
