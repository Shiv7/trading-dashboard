package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.PatternSignalDTO;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import org.springframework.scheduling.annotation.Scheduled;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

/**
 * PatternSignalConsumer - Consumes pattern signals from SMTIS v2.0
 *
 * Listens to:
 * - pattern-signals: Pattern recognition signals
 *
 * Provides:
 * - Active patterns tracking
 * - Pattern lifecycle management
 * - Pattern success rate tracking
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class PatternSignalConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Memory limits to prevent OOM
    private static final int MAX_ACTIVE_PATTERNS = 1000;
    private static final int MAX_COMPLETED_PATTERNS = 500;
    private static final int MAX_PATTERNS_PER_STOCK = 50;
    private static final int PATTERN_EXPIRY_HOURS = 24;

    // In-memory pattern storage
    private final Map<String, PatternSignalDTO> activePatterns = new ConcurrentHashMap<>();
    private final Map<String, PatternSignalDTO> completedPatterns = new ConcurrentHashMap<>();
    // FIX: Use CopyOnWriteArrayList for thread-safe iteration
    private final Map<String, List<PatternSignalDTO>> patternsByStock = new ConcurrentHashMap<>();

    // Pattern statistics
    private final Map<String, PatternStats> patternStats = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        log.info("PatternSignalConsumer initialized with limits: maxActive={}, maxCompleted={}, maxPerStock={}",
                MAX_ACTIVE_PATTERNS, MAX_COMPLETED_PATTERNS, MAX_PATTERNS_PER_STOCK);
    }

    @KafkaListener(topics = {"pattern-signals"}, groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onPatternSignal(String payload) {
        try {
            log.info("Received pattern signal from Kafka");
            JsonNode root = objectMapper.readTree(payload);

            PatternSignalDTO pattern = parsePatternSignal(root);

            if (pattern.getPatternId() == null || pattern.getPatternId().isEmpty()) {
                log.warn("Pattern has no patternId, skipping");
                return;
            }

            // FIX: Check max limit before adding
            if (activePatterns.size() >= MAX_ACTIVE_PATTERNS && !activePatterns.containsKey(pattern.getPatternId())) {
                log.warn("Active patterns limit reached ({}), skipping new pattern for {}",
                        MAX_ACTIVE_PATTERNS, pattern.getScripCode());
                return;
            }

            // Store pattern
            activePatterns.put(pattern.getPatternId(), pattern);

            // FIX: Use CopyOnWriteArrayList and enforce per-stock limit
            patternsByStock.compute(pattern.getScripCode(), (k, list) -> {
                if (list == null) {
                    list = new CopyOnWriteArrayList<>();
                }
                // Remove old patterns if limit exceeded
                while (list.size() >= MAX_PATTERNS_PER_STOCK) {
                    list.remove(0); // Remove oldest
                }
                list.add(pattern);
                return list;
            });

            // Update statistics
            updatePatternStats(pattern);

            // Broadcast to WebSocket
            sessionManager.broadcastPatternSignal(pattern);

            // Send notification
            String emoji = getPatternEmoji(pattern.getPatternType());
            sessionManager.broadcastNotification("PATTERN",
                    String.format("%s %s pattern detected for %s @ %.2f",
                            emoji, pattern.getPatternType(), pattern.getCompanyName(), pattern.getEntryPrice()));

            log.info("Pattern signal processed: {} {} {} @ {}",
                    pattern.getScripCode(), pattern.getPatternType(), pattern.getDirection(), pattern.getEntryPrice());

        } catch (Exception e) {
            log.error("Error processing pattern signal: {}", e.getMessage(), e);
        }
    }

    /**
     * Update pattern when outcome is known
     */
    public void updatePatternOutcome(String patternId, boolean isWin, double pnl) {
        PatternSignalDTO pattern = activePatterns.remove(patternId);
        if (pattern != null) {
            pattern.setStatus(isWin ? "COMPLETED_WIN" : "COMPLETED_LOSS");
            pattern.setActualPnl(pnl);
            pattern.setCompletedAt(LocalDateTime.now());

            // FIX: Enforce completed patterns limit
            if (completedPatterns.size() >= MAX_COMPLETED_PATTERNS) {
                // Remove oldest completed pattern
                completedPatterns.values().stream()
                        .min(Comparator.comparing(p -> p.getCompletedAt() != null ? p.getCompletedAt() : LocalDateTime.MIN))
                        .ifPresent(oldest -> completedPatterns.remove(oldest.getPatternId()));
            }
            completedPatterns.put(patternId, pattern);

            // Update stats
            PatternStats stats = patternStats.computeIfAbsent(pattern.getPatternType(),
                    k -> new PatternStats(pattern.getPatternType()));
            stats.recordOutcome(isWin, pnl);
        }
    }

    /**
     * Scheduled cleanup of expired patterns (every 5 minutes)
     */
    @Scheduled(fixedRate = 300000) // 5 minutes
    public void cleanupExpiredPatterns() {
        try {
            LocalDateTime cutoff = LocalDateTime.now().minusHours(PATTERN_EXPIRY_HOURS);
            int expiredCount = 0;

            // Expire old active patterns
            List<String> toExpire = new ArrayList<>();
            for (Map.Entry<String, PatternSignalDTO> entry : activePatterns.entrySet()) {
                PatternSignalDTO pattern = entry.getValue();

                // Check if pattern has explicit expiry
                if (pattern.getExpiresAt() != null && pattern.getExpiresAt().isBefore(LocalDateTime.now())) {
                    toExpire.add(entry.getKey());
                }
                // Check if pattern is older than cutoff
                else if (pattern.getTriggeredAt() != null && pattern.getTriggeredAt().isBefore(cutoff)) {
                    toExpire.add(entry.getKey());
                }
            }

            for (String patternId : toExpire) {
                PatternSignalDTO pattern = activePatterns.remove(patternId);
                if (pattern != null) {
                    pattern.setStatus("EXPIRED");
                    pattern.setCompletedAt(LocalDateTime.now());
                    // Don't add to completed if limit reached
                    if (completedPatterns.size() < MAX_COMPLETED_PATTERNS) {
                        completedPatterns.put(patternId, pattern);
                    }
                    expiredCount++;
                }
            }

            // Cleanup old completed patterns (keep only recent ones)
            if (completedPatterns.size() > MAX_COMPLETED_PATTERNS) {
                List<String> toRemove = completedPatterns.values().stream()
                        .sorted(Comparator.comparing(p -> p.getCompletedAt() != null ? p.getCompletedAt() : LocalDateTime.MIN))
                        .limit(completedPatterns.size() - MAX_COMPLETED_PATTERNS)
                        .map(PatternSignalDTO::getPatternId)
                        .collect(Collectors.toList());
                toRemove.forEach(completedPatterns::remove);
            }

            // Cleanup patternsByStock - remove empty lists
            patternsByStock.entrySet().removeIf(entry -> entry.getValue().isEmpty());

            if (expiredCount > 0) {
                log.info("Pattern cleanup: expired {} patterns, active={}, completed={}",
                        expiredCount, activePatterns.size(), completedPatterns.size());
            }
        } catch (Exception e) {
            log.error("Error during pattern cleanup: {}", e.getMessage());
        }
    }

    private PatternSignalDTO parsePatternSignal(JsonNode root) {
        long timestamp = root.path("timestamp").asLong(
                root.path("triggeredAt").asLong(System.currentTimeMillis()));

        return PatternSignalDTO.builder()
                .patternId(root.path("patternId").asText(UUID.randomUUID().toString()))
                .signalId(root.path("signalId").asText())
                .scripCode(root.path("scripCode").asText(root.path("familyId").asText()))
                .companyName(root.path("companyName").asText(root.path("scripCode").asText()))
                .patternType(root.path("patternType").asText(root.path("type").asText("UNKNOWN")))
                .direction(root.path("direction").asText("NEUTRAL"))
                .status("ACTIVE")
                .confidence(root.path("confidence").asDouble(0))
                .qualityScore(root.path("qualityScore").asInt(0))
                .entryPrice(root.path("entryPrice").asDouble(0))
                .stopLoss(root.path("stopLoss").asDouble(0))
                .target1(root.path("target1").asDouble(0))
                .target2(root.path("target2").asDouble(0))
                .riskRewardRatio(root.path("riskRewardRatio").asDouble(0))
                .timeframe(root.path("timeframe").asText(""))
                .patternDescription(root.path("description").asText(root.path("narrative").asText("")))
                .triggerCondition(root.path("triggerCondition").asText(""))
                .invalidationPrice(root.path("invalidationPrice").asDouble(0))
                .expiresAt(parseDateTime(root.path("expiresAt")))
                .triggeredAt(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .gexRegime(root.path("gexRegime").asText(""))
                .session(root.path("session").asText(""))
                .daysToExpiry(root.has("daysToExpiry") ? root.path("daysToExpiry").asInt() : null)
                .build();
    }

    private LocalDateTime parseDateTime(JsonNode node) {
        if (node.isNull() || node.isMissingNode()) {
            return null;
        }
        try {
            if (node.isTextual()) {
                return LocalDateTime.parse(node.asText());
            } else if (node.isNumber()) {
                return LocalDateTime.ofInstant(
                        Instant.ofEpochMilli(node.asLong()),
                        ZoneId.of("Asia/Kolkata")
                );
            }
        } catch (Exception e) {
            // Ignore parse errors
        }
        return null;
    }

    private String getPatternEmoji(String patternType) {
        if (patternType == null) return "";
        return switch (patternType.toUpperCase()) {
            case "BREAKOUT" -> "";
            case "BREAKDOWN" -> "";
            case "REVERSAL" -> "";
            case "TREND_CONTINUATION" -> "";
            case "MOMENTUM" -> "";
            case "MEAN_REVERSION" -> "";
            case "DOUBLE_BOTTOM" -> "";
            case "DOUBLE_TOP" -> "";
            case "HEAD_SHOULDERS" -> "";
            default -> "";
        };
    }

    private void updatePatternStats(PatternSignalDTO pattern) {
        PatternStats stats = patternStats.computeIfAbsent(pattern.getPatternType(),
                k -> new PatternStats(pattern.getPatternType()));
        stats.incrementTotal();
    }

    // ======================== REST API Support ========================

    public List<PatternSignalDTO> getActivePatterns() {
        return new ArrayList<>(activePatterns.values());
    }

    public List<PatternSignalDTO> getActivePatternsForStock(String scripCode) {
        return activePatterns.values().stream()
                .filter(p -> scripCode.equals(p.getScripCode()))
                .collect(Collectors.toList());
    }

    public List<PatternSignalDTO> getCompletedPatterns(int limit) {
        return completedPatterns.values().stream()
                .sorted(Comparator.comparing(PatternSignalDTO::getCompletedAt).reversed())
                .limit(limit)
                .collect(Collectors.toList());
    }

    public PatternSignalDTO getPattern(String patternId) {
        PatternSignalDTO pattern = activePatterns.get(patternId);
        if (pattern == null) {
            pattern = completedPatterns.get(patternId);
        }
        return pattern;
    }

    public Map<String, PatternStats> getPatternStats() {
        return new HashMap<>(patternStats);
    }

    public PatternSummary getPatternSummary() {
        int totalActive = activePatterns.size();
        int totalCompleted = completedPatterns.size();

        long wins = completedPatterns.values().stream()
                .filter(p -> "COMPLETED_WIN".equals(p.getStatus()))
                .count();

        double totalPnl = completedPatterns.values().stream()
                .mapToDouble(p -> p.getActualPnl() != null ? p.getActualPnl() : 0)
                .sum();

        double winRate = totalCompleted > 0 ? (double) wins / totalCompleted : 0;

        Map<String, Long> byType = activePatterns.values().stream()
                .collect(Collectors.groupingBy(PatternSignalDTO::getPatternType, Collectors.counting()));

        return PatternSummary.builder()
                .totalActive(totalActive)
                .totalCompleted(totalCompleted)
                .wins((int) wins)
                .losses(totalCompleted - (int) wins)
                .winRate(winRate)
                .totalPnl(totalPnl)
                .activeByType(byType)
                .build();
    }

    // ======================== DTOs ========================

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class PatternSummary {
        private int totalActive;
        private int totalCompleted;
        private int wins;
        private int losses;
        private double winRate;
        private double totalPnl;
        private Map<String, Long> activeByType;
    }

    @lombok.Data
    public static class PatternStats {
        private String patternType;
        private int totalOccurrences;
        private int wins;
        private int losses;
        private double totalPnl;
        private double winRate;
        private double avgPnl;

        public PatternStats(String patternType) {
            this.patternType = patternType;
        }

        public void incrementTotal() {
            totalOccurrences++;
        }

        public void recordOutcome(boolean isWin, double pnl) {
            if (isWin) wins++;
            else losses++;
            totalPnl += pnl;
            winRate = (wins + losses) > 0 ? (double) wins / (wins + losses) : 0;
            avgPnl = (wins + losses) > 0 ? totalPnl / (wins + losses) : 0;
        }
    }
}
