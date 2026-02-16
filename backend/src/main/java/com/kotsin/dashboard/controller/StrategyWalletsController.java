package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.StrategyWalletDTO;
import com.kotsin.dashboard.service.StrategyWalletsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/strategy-wallets")
@RequiredArgsConstructor
@Slf4j
public class StrategyWalletsController {

    private final StrategyWalletsService strategyWalletsService;

    @GetMapping("/summary")
    public ResponseEntity<List<StrategyWalletDTO.StrategySummary>> getSummaries() {
        return ResponseEntity.ok(strategyWalletsService.getSummaries());
    }

    @GetMapping("/trades")
    public ResponseEntity<List<StrategyWalletDTO.StrategyTrade>> getWeeklyTrades(
            @RequestParam(required = false) String strategy,
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String exchange,
            @RequestParam(defaultValue = "exitTime") String sortBy,
            @RequestParam(defaultValue = "200") int limit) {
        return ResponseEntity.ok(
                strategyWalletsService.getWeeklyTrades(strategy, direction, exchange, sortBy, limit));
    }
}
