package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.TradingSignalDTO;
import com.kotsin.dashboard.service.TradingSignalService;
import com.kotsin.dashboard.service.TradingSignalService.SignalConfirmationResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST controller for trading signal management.
 */
@RestController
@RequestMapping("/api/signals/trading")
@RequiredArgsConstructor
@Slf4j
public class TradingSignalController {

    private final TradingSignalService tradingSignalService;

    /**
     * Get all pending signals awaiting confirmation
     */
    @GetMapping("/pending")
    public ResponseEntity<List<TradingSignalDTO>> getPendingSignals() {
        List<TradingSignalDTO> signals = tradingSignalService.getPendingSignals();
        return ResponseEntity.ok(signals);
    }

    /**
     * Get a specific signal by ID
     */
    @GetMapping("/{signalId}")
    public ResponseEntity<?> getSignal(@PathVariable String signalId) {
        return tradingSignalService.getSignal(signalId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Confirm a signal and execute the trade
     */
    @PostMapping("/{signalId}/confirm")
    public ResponseEntity<Map<String, Object>> confirmSignal(
            @PathVariable String signalId,
            @RequestBody(required = false) ConfirmRequest request) {

        String confirmedBy = request != null && request.getConfirmedBy() != null
                ? request.getConfirmedBy() : "user";

        SignalConfirmationResult result = tradingSignalService.confirmSignal(signalId, confirmedBy);

        if (result.isSuccess()) {
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Signal confirmed and order placed",
                    "signal", result.getSignal(),
                    "orderId", result.getSignal().getExecutionOrderId()
            ));
        } else {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", result.getMessage()
            ));
        }
    }

    /**
     * Reject a signal
     */
    @PostMapping("/{signalId}/reject")
    public ResponseEntity<Map<String, Object>> rejectSignal(
            @PathVariable String signalId,
            @RequestBody(required = false) RejectRequest request) {

        String rejectedBy = request != null && request.getRejectedBy() != null
                ? request.getRejectedBy() : "user";
        String reason = request != null && request.getReason() != null
                ? request.getReason() : "User rejected";

        SignalConfirmationResult result = tradingSignalService.rejectSignal(signalId, rejectedBy, reason);

        if (result.isSuccess()) {
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Signal rejected",
                    "signal", result.getSignal()
            ));
        } else {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", result.getMessage()
            ));
        }
    }

    /**
     * Get signal history
     */
    @GetMapping("/history")
    public ResponseEntity<List<TradingSignalDTO>> getSignalHistory(
            @RequestParam(defaultValue = "50") int limit) {
        List<TradingSignalDTO> history = tradingSignalService.getSignalHistory(limit);
        return ResponseEntity.ok(history);
    }

    /**
     * Confirm all high-quality signals (bulk action)
     */
    @PostMapping("/confirm-all")
    public ResponseEntity<Map<String, Object>> confirmAllQualitySignals(
            @RequestParam(defaultValue = "70") double minScore,
            @RequestParam(defaultValue = "1.5") double minRR) {

        List<TradingSignalDTO> pending = tradingSignalService.getPendingSignals();

        int confirmed = 0;
        int failed = 0;

        for (TradingSignalDTO signal : pending) {
            Double score = signal.getCompositeScore();
            Double rr = signal.getRiskRewardRatio();

            if (score != null && score >= minScore && rr != null && rr >= minRR) {
                SignalConfirmationResult result = tradingSignalService.confirmSignal(
                        signal.getSignalId(), "bulk-confirm");
                if (result.isSuccess()) {
                    confirmed++;
                } else {
                    failed++;
                }
            }
        }

        return ResponseEntity.ok(Map.of(
                "confirmed", confirmed,
                "failed", failed,
                "criteria", Map.of("minScore", minScore, "minRR", minRR)
        ));
    }

    /**
     * Reject all pending signals (bulk action)
     */
    @PostMapping("/reject-all")
    public ResponseEntity<Map<String, Object>> rejectAllSignals(
            @RequestBody(required = false) RejectRequest request) {

        String reason = request != null && request.getReason() != null
                ? request.getReason() : "Bulk rejection";

        List<TradingSignalDTO> pending = tradingSignalService.getPendingSignals();
        int rejected = 0;

        for (TradingSignalDTO signal : pending) {
            SignalConfirmationResult result = tradingSignalService.rejectSignal(
                    signal.getSignalId(), "bulk-reject", reason);
            if (result.isSuccess()) {
                rejected++;
            }
        }

        return ResponseEntity.ok(Map.of(
                "rejected", rejected,
                "reason", reason
        ));
    }

    @lombok.Data
    public static class ConfirmRequest {
        private String confirmedBy;
        private Integer quantity;
    }

    @lombok.Data
    public static class RejectRequest {
        private String rejectedBy;
        private String reason;
    }
}
