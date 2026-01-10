package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.AlertHistoryService;
import com.kotsin.dashboard.service.AlertHistoryService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * AlertController - REST endpoints for alert management
 *
 * Provides:
 * - Alert listing and filtering
 * - Mark as read functionality
 * - Alert statistics
 */
@RestController
@RequestMapping("/api/alerts")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class AlertController {

    private final AlertHistoryService alertService;

    /**
     * Get alerts with optional filters
     */
    @GetMapping
    public ResponseEntity<List<AlertRecord>> getAlerts(
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) Boolean unreadOnly) {
        return ResponseEntity.ok(alertService.getAlerts(limit, type, severity, unreadOnly));
    }

    /**
     * Get alert summary for dashboard
     */
    @GetMapping("/summary")
    public ResponseEntity<AlertSummary> getSummary() {
        return ResponseEntity.ok(alertService.getSummary());
    }

    /**
     * Get alert statistics
     */
    @GetMapping("/stats")
    public ResponseEntity<AlertStats> getStats() {
        return ResponseEntity.ok(alertService.getStats());
    }

    /**
     * Get alerts for a specific stock
     */
    @GetMapping("/stock/{scripCode}")
    public ResponseEntity<List<AlertRecord>> getAlertsForStock(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "20") int limit) {
        return ResponseEntity.ok(alertService.getAlertsForStock(scripCode, limit));
    }

    /**
     * Get a specific alert
     */
    @GetMapping("/{alertId}")
    public ResponseEntity<AlertRecord> getAlert(@PathVariable String alertId) {
        AlertRecord alert = alertService.getAlert(alertId);
        if (alert == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(alert);
    }

    /**
     * Mark alert as read
     */
    @PostMapping("/{alertId}/read")
    public ResponseEntity<Map<String, Object>> markAsRead(@PathVariable String alertId) {
        boolean success = alertService.markAsRead(alertId);
        return ResponseEntity.ok(Map.of("success", success));
    }

    /**
     * Mark all alerts as read
     */
    @PostMapping("/read-all")
    public ResponseEntity<Map<String, Object>> markAllAsRead() {
        int count = alertService.markAllAsRead();
        return ResponseEntity.ok(Map.of("markedCount", count));
    }

    /**
     * Delete an alert
     */
    @DeleteMapping("/{alertId}")
    public ResponseEntity<Map<String, Object>> deleteAlert(@PathVariable String alertId) {
        boolean success = alertService.deleteAlert(alertId);
        return ResponseEntity.ok(Map.of("success", success));
    }

    /**
     * Create a manual alert (for testing/admin)
     */
    @PostMapping
    public ResponseEntity<AlertRecord> createAlert(@RequestBody CreateAlertRequest request) {
        AlertRecord alert = alertService.addAlert(
                request.getType(),
                request.getSeverity(),
                request.getTitle(),
                request.getMessage(),
                request.getScripCode()
        );
        return ResponseEntity.ok(alert);
    }

    @lombok.Data
    public static class CreateAlertRequest {
        private String type;
        private String severity;
        private String title;
        private String message;
        private String scripCode;
    }
}
