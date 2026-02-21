package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.StrategyWalletDTO;
import com.kotsin.dashboard.service.StrategyWalletsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/strategy-wallets")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class StrategyWalletsController {

    private final StrategyWalletsService strategyWalletsService;

    @GetMapping("/summary")
    public ResponseEntity<List<StrategyWalletDTO.StrategySummary>> getSummaries() {
        return ResponseEntity.ok(strategyWalletsService.getSummaries());
    }

    /**
     * Get capital for a specific strategy wallet.
     * Used by frontend to compute lot sizing for BUY CTA.
     */
    @GetMapping("/capital/{strategy}")
    public ResponseEntity<Map<String, Object>> getCapital(@PathVariable String strategy) {
        List<StrategyWalletDTO.StrategySummary> summaries = strategyWalletsService.getSummaries();
        for (StrategyWalletDTO.StrategySummary s : summaries) {
            if (s.getStrategy().equalsIgnoreCase(strategy)
                    || s.getDisplayName().equalsIgnoreCase(strategy)) {
                return ResponseEntity.ok(Map.of(
                        "strategy", s.getStrategy(),
                        "currentCapital", s.getCurrentCapital(),
                        "initialCapital", s.getInitialCapital(),
                        "totalPnl", s.getTotalPnl()
                ));
            }
        }
        return ResponseEntity.notFound().build();
    }

    @GetMapping("/trades")
    public ResponseEntity<List<StrategyWalletDTO.StrategyTrade>> getWeeklyTrades(
            @RequestParam(required = false) String strategy,
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String exchange,
            @RequestParam(defaultValue = "exitTime") String sortBy,
            @RequestParam(defaultValue = "500") int limit) {
        return ResponseEntity.ok(
                strategyWalletsService.getWeeklyTrades(strategy, direction, exchange, sortBy, limit));
    }
}
