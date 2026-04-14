package com.kotsin.dashboard.hotstocks.controller;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Read-only REST API for Hot Stocks frontend.
 *
 *  GET /api/hot-stocks           → ranked list split into fno[] and nonFno[]
 *  GET /api/hot-stocks/{symbol}  → single StockMetrics by NSE symbol
 *  GET /api/hot-stocks/wallet    → HOTSTOCKS wallet state as raw JSON string
 *  GET /api/hot-stocks/wallet/positions → virtual positions opened by HOTSTOCKS strategy
 *
 * Admin trigger (POST /api/hot-stocks/admin/run-enrichment) lives in HotStocksAdminController.
 */
@RestController
@RequestMapping("/api/hot-stocks")
public class HotStocksController {

    private static final String WALLET_KEY = "wallet:entity:strategy-wallet-HOTSTOCKS";

    private final HotStocksService service;
    private final StringRedisTemplate redis;

    public HotStocksController(HotStocksService service, StringRedisTemplate redis) {
        this.service = service;
        this.redis = redis;
    }

    @GetMapping
    public Map<String, Object> list() {
        List<StockMetrics> ranked = service.loadRankedList();
        List<StockMetrics> fno = ranked.stream().filter(StockMetrics::isFnoEligible).limit(6).toList();
        List<StockMetrics> nonFno = ranked.stream().filter(m -> !m.isFnoEligible()).limit(12).toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("fno", fno);
        out.put("nonFno", nonFno);
        out.put("generatedAt", System.currentTimeMillis());
        return out;
    }

    @GetMapping("/{symbol}")
    public ResponseEntity<StockMetrics> single(@PathVariable String symbol) {
        if (symbol == null || symbol.isBlank()) return ResponseEntity.notFound().build();
        String sym = symbol.trim().toUpperCase();
        return service.loadRankedList().stream()
            .filter(m -> sym.equals(m.getSymbol() == null ? null : m.getSymbol().toUpperCase()))
            .findFirst()
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/wallet")
    public ResponseEntity<String> wallet() {
        String json = redis.opsForValue().get(WALLET_KEY);
        if (json == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(json);
    }

    @GetMapping("/wallet/positions")
    public List<Map<Object, Object>> positions() {
        Set<String> keys = redis.keys("virtual:positions:*");
        if (keys == null || keys.isEmpty()) return Collections.emptyList();
        List<Map<Object, Object>> out = new ArrayList<>();
        for (String key : keys) {
            Map<Object, Object> pos = redis.<Object, Object>opsForHash().entries(key);
            if (pos == null || pos.isEmpty()) continue;
            Object source = pos.get("signalSource");
            if (source != null && "HOTSTOCKS".equals(source.toString())) {
                out.add(pos);
            }
        }
        return out;
    }
}
