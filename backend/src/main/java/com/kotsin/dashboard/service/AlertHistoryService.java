package com.kotsin.dashboard.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.stream.Collectors;

/**
 * AlertHistoryService - Tracks and manages system alerts
 *
 * Provides:
 * - Alert history storage
 * - Alert categorization
 * - Read/unread tracking
 * - Alert statistics
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AlertHistoryService {

    // In-memory alert storage (in production, would use MongoDB/Redis)
    private final Deque<AlertRecord> alertHistory = new ConcurrentLinkedDeque<>();
    private final Map<String, AlertRecord> alertById = new ConcurrentHashMap<>();
    private final Map<String, Integer> alertCountByType = new ConcurrentHashMap<>();

    private static final int MAX_ALERTS = 1000;

    /**
     * Add a new alert
     */
    public AlertRecord addAlert(String type, String severity, String title, String message, String scripCode) {
        AlertRecord alert = AlertRecord.builder()
                .id(UUID.randomUUID().toString())
                .type(type)
                .severity(severity)
                .title(title)
                .message(message)
                .scripCode(scripCode)
                .isRead(false)
                .createdAt(LocalDateTime.now())
                .build();

        alertHistory.addFirst(alert);
        alertById.put(alert.getId(), alert);
        alertCountByType.merge(type, 1, Integer::sum);

        // Trim old alerts
        while (alertHistory.size() > MAX_ALERTS) {
            AlertRecord old = alertHistory.removeLast();
            alertById.remove(old.getId());
        }

        log.info("Alert added: {} - {} - {}", type, severity, title);
        return alert;
    }

    /**
     * Add alert from external source (e.g., Kafka consumer)
     */
    public AlertRecord addAlert(AlertRecord alert) {
        if (alert.getId() == null) {
            alert.setId(UUID.randomUUID().toString());
        }
        if (alert.getCreatedAt() == null) {
            alert.setCreatedAt(LocalDateTime.now());
        }

        alertHistory.addFirst(alert);
        alertById.put(alert.getId(), alert);
        alertCountByType.merge(alert.getType(), 1, Integer::sum);

        // Trim old alerts
        while (alertHistory.size() > MAX_ALERTS) {
            AlertRecord old = alertHistory.removeLast();
            alertById.remove(old.getId());
        }

        return alert;
    }

    /**
     * Get recent alerts
     */
    public List<AlertRecord> getAlerts(int limit, String type, String severity, Boolean unreadOnly) {
        return alertHistory.stream()
                .filter(a -> type == null || type.equals(a.getType()))
                .filter(a -> severity == null || severity.equals(a.getSeverity()))
                .filter(a -> unreadOnly == null || !unreadOnly || !a.isRead())
                .limit(limit)
                .collect(Collectors.toList());
    }

    /**
     * Get alerts for a specific stock
     */
    public List<AlertRecord> getAlertsForStock(String scripCode, int limit) {
        return alertHistory.stream()
                .filter(a -> scripCode.equals(a.getScripCode()))
                .limit(limit)
                .collect(Collectors.toList());
    }

    /**
     * Get alert by ID
     */
    public AlertRecord getAlert(String alertId) {
        return alertById.get(alertId);
    }

    /**
     * Mark alert as read
     */
    public boolean markAsRead(String alertId) {
        AlertRecord alert = alertById.get(alertId);
        if (alert != null) {
            alert.setRead(true);
            return true;
        }
        return false;
    }

    /**
     * Mark all alerts as read
     */
    public int markAllAsRead() {
        int count = 0;
        for (AlertRecord alert : alertHistory) {
            if (!alert.isRead()) {
                alert.setRead(true);
                count++;
            }
        }
        return count;
    }

    /**
     * Delete an alert
     */
    public boolean deleteAlert(String alertId) {
        AlertRecord alert = alertById.remove(alertId);
        if (alert != null) {
            alertHistory.remove(alert);
            return true;
        }
        return false;
    }

    /**
     * Clear all alerts
     */
    public void clearAlerts() {
        alertHistory.clear();
        alertById.clear();
        alertCountByType.clear();
    }

    /**
     * Get alert statistics
     */
    public AlertStats getStats() {
        long total = alertHistory.size();
        long unread = alertHistory.stream().filter(a -> !a.isRead()).count();

        Map<String, Long> byType = alertHistory.stream()
                .collect(Collectors.groupingBy(AlertRecord::getType, Collectors.counting()));

        Map<String, Long> bySeverity = alertHistory.stream()
                .collect(Collectors.groupingBy(AlertRecord::getSeverity, Collectors.counting()));

        // Recent alerts (last hour)
        LocalDateTime oneHourAgo = LocalDateTime.now().minusHours(1);
        long recentCount = alertHistory.stream()
                .filter(a -> a.getCreatedAt().isAfter(oneHourAgo))
                .count();

        return AlertStats.builder()
                .totalAlerts((int) total)
                .unreadCount((int) unread)
                .byType(byType)
                .bySeverity(bySeverity)
                .recentCount((int) recentCount)
                .build();
    }

    /**
     * Get summary for dashboard
     */
    public AlertSummary getSummary() {
        long unread = alertHistory.stream().filter(a -> !a.isRead()).count();
        long critical = alertHistory.stream()
                .filter(a -> !a.isRead() && "CRITICAL".equals(a.getSeverity()))
                .count();
        long high = alertHistory.stream()
                .filter(a -> !a.isRead() && "HIGH".equals(a.getSeverity()))
                .count();

        List<AlertRecord> recent = alertHistory.stream()
                .limit(5)
                .collect(Collectors.toList());

        return AlertSummary.builder()
                .unreadCount((int) unread)
                .criticalCount((int) critical)
                .highCount((int) high)
                .recentAlerts(recent)
                .build();
    }

    // ======================== DTOs ========================

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class AlertRecord {
        private String id;
        private String type;          // SIGNAL, PATTERN, RISK, SYSTEM, TRADE, PRICE
        private String severity;      // CRITICAL, HIGH, MEDIUM, LOW, INFO
        private String title;
        private String message;
        private String scripCode;
        private boolean isRead;
        private LocalDateTime createdAt;
        private Map<String, Object> metadata;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class AlertStats {
        private int totalAlerts;
        private int unreadCount;
        private Map<String, Long> byType;
        private Map<String, Long> bySeverity;
        private int recentCount;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class AlertSummary {
        private int unreadCount;
        private int criticalCount;
        private int highCount;
        private List<AlertRecord> recentAlerts;
    }
}
