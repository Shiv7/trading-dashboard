package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.StrategyWalletDTO;
import com.kotsin.dashboard.service.StrategyWalletsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/strategy-wallets")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class StrategyWalletsController {

    private final StrategyWalletsService strategyWalletsService;
    @Qualifier("executionRestTemplate")
    private final RestTemplate restTemplate;

    @Value("${execution.service.url:http://localhost:8089}")
    private String executionUrl;

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
                Map<String, Integer> posByExchange = strategyWalletsService.getActivePositionCountsByExchange(s.getStrategy());
                int openCount = posByExchange.values().stream().mapToInt(Integer::intValue).sum();
                Map<String, Object> resp = new LinkedHashMap<>();
                resp.put("strategy", s.getStrategy());
                resp.put("currentCapital", s.getCurrentCapital());
                resp.put("initialCapital", s.getInitialCapital());
                resp.put("totalPnl", s.getTotalPnl());
                resp.put("availableMargin", s.getAvailableMargin());
                resp.put("usedMargin", s.getUsedMargin());
                resp.put("openPositionCount", openCount);
                resp.put("positionsByExchange", posByExchange);
                return ResponseEntity.ok(resp);
            }
        }
        return ResponseEntity.notFound().build();
    }

    @GetMapping("/trades")
    public ResponseEntity<List<StrategyWalletDTO.StrategyTrade>> getTrades(
            @RequestParam(required = false) String strategy,
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String exchange,
            @RequestParam(defaultValue = "exitTime") String sortBy,
            @RequestParam(defaultValue = "2000") int limit,
            @RequestParam(required = false) Long from,
            @RequestParam(required = false) Long to) {
        return ResponseEntity.ok(
                strategyWalletsService.getTrades(strategy, direction, exchange, sortBy, limit, from, to));
    }

    /**
     * Add funds to a strategy wallet (proxies to Trade Execution Module).
     */
    @PostMapping("/capital/{strategy}/add-funds")
    public ResponseEntity<?> addFunds(@PathVariable String strategy, @RequestBody Map<String, Object> body) {
        String walletId = "strategy-wallet-" + strategy.toUpperCase();
        String url = executionUrl + "/api/wallet/strategy/" + walletId + "/add-funds";
        try {
            @SuppressWarnings("unchecked")
            ResponseEntity<Map> response = restTemplate.postForEntity(url, body, Map.class);
            log.info("[STRATEGY-WALLETS] Add funds proxied strategy={} amount={}", strategy, body.get("amount"));
            return ResponseEntity.ok(response.getBody());
        } catch (RestClientException e) {
            log.error("ERR [STRATEGY-WALLETS] Failed to proxy add-funds for {}: {}", strategy, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false, "message", "Failed to add funds: " + e.getMessage()));
        }
    }

    /**
     * Get transaction history for a strategy wallet (proxies to Trade Execution Module).
     */
    @GetMapping("/capital/{strategy}/transactions")
    public ResponseEntity<?> getTransactions(
            @PathVariable String strategy, @RequestParam(defaultValue = "50") int limit) {
        String walletId = "strategy-wallet-" + strategy.toUpperCase();
        String url = executionUrl + "/api/wallet/strategy/" + walletId + "/transactions?limit=" + limit;
        try {
            @SuppressWarnings("unchecked")
            ResponseEntity<List> response = restTemplate.getForEntity(url, List.class);
            return ResponseEntity.ok(response.getBody());
        } catch (RestClientException e) {
            log.error("ERR [STRATEGY-WALLETS] Failed to proxy transactions for {}: {}", strategy, e.getMessage());
            return ResponseEntity.ok(List.of());
        }
    }
}
