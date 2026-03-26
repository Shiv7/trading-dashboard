package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.entity.UserTrade;
import com.kotsin.dashboard.model.entity.UserWallet;
import com.kotsin.dashboard.service.UserPnLService;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/pnl")
public class UserPnLController {

    private static final String DEFAULT_USER = "default";
    private final UserPnLService userPnLService;

    public UserPnLController(UserPnLService userPnLService) {
        this.userPnLService = userPnLService;
    }

    private String resolveUser(Authentication auth) {
        return auth != null ? resolveUser(auth) : DEFAULT_USER;
    }

    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> getSummary(
            Authentication auth,
            @RequestParam(defaultValue = "PAPER") String walletType) {
        return ResponseEntity.ok(userPnLService.getSummary(resolveUser(auth), walletType));
    }

    @GetMapping("/wallets")
    public ResponseEntity<List<UserWallet>> getWallets(Authentication auth) {
        return ResponseEntity.ok(userPnLService.getUserWallets(resolveUser(auth)));
    }

    @GetMapping("/daily")
    public ResponseEntity<List<Map<String, Object>>> getDailyPnl(
            Authentication auth,
            @RequestParam(defaultValue = "PAPER") String walletType,
            @RequestParam(defaultValue = "30") int days) {
        return ResponseEntity.ok(userPnLService.getDailyPnl(resolveUser(auth), walletType, days));
    }

    @GetMapping("/equity-curve")
    public ResponseEntity<List<Map<String, Object>>> getEquityCurve(
            Authentication auth,
            @RequestParam(defaultValue = "PAPER") String walletType) {
        return ResponseEntity.ok(userPnLService.getEquityCurve(resolveUser(auth), walletType));
    }

    @GetMapping("/calendar")
    public ResponseEntity<List<Map<String, Object>>> getCalendarHeatmap(
            Authentication auth,
            @RequestParam(defaultValue = "PAPER") String walletType,
            @RequestParam(required = false) Integer year) {
        int yr = year != null ? year : LocalDate.now().getYear();
        return ResponseEntity.ok(userPnLService.getCalendarHeatmap(resolveUser(auth), walletType, yr));
    }

    @GetMapping("/by-instrument")
    public ResponseEntity<List<Map<String, Object>>> getInstrumentBreakdown(
            Authentication auth,
            @RequestParam(defaultValue = "PAPER") String walletType) {
        return ResponseEntity.ok(userPnLService.getInstrumentBreakdown(resolveUser(auth), walletType));
    }

    @GetMapping("/by-strategy")
    public ResponseEntity<List<Map<String, Object>>> getStrategyBreakdown(
            Authentication auth,
            @RequestParam(defaultValue = "PAPER") String walletType) {
        return ResponseEntity.ok(userPnLService.getStrategyBreakdown(resolveUser(auth), walletType));
    }

    @GetMapping("/metrics")
    public ResponseEntity<Map<String, Object>> getAdvancedMetrics(
            Authentication auth,
            @RequestParam(defaultValue = "PAPER") String walletType) {
        return ResponseEntity.ok(userPnLService.getAdvancedMetrics(resolveUser(auth), walletType));
    }

    @GetMapping("/trade-journal")
    public ResponseEntity<Page<UserTrade>> getTradeJournal(
            Authentication auth,
            @RequestParam(defaultValue = "PAPER") String walletType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(userPnLService.getTradeJournal(resolveUser(auth), walletType, page, size));
    }

    @PutMapping("/trade-journal/{tradeId}/notes")
    public ResponseEntity<?> updateTradeNotes(
            Authentication auth,
            @PathVariable String tradeId,
            @RequestBody Map<String, Object> body) {
        try {
            String notes = (String) body.get("notes");
            @SuppressWarnings("unchecked")
            List<String> tags = (List<String>) body.get("tags");
            UserTrade trade = userPnLService.updateTradeNotes(resolveUser(auth), tradeId, notes, tags);
            return ResponseEntity.ok(trade);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
