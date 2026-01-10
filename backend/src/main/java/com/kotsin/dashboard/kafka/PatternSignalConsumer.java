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

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
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

    // In-memory pattern storage
    private final Map<String, PatternSignalDTO> activePatterns = new ConcurrentHashMap<>();
    private final Map<String, PatternSignalDTO> completedPatterns = new ConcurrentHashMap<>();
    private final Map<String, List<PatternSignalDTO>> patternsByStock = new ConcurrentHashMap<>();

    // Pattern statistics
    private final Map<String, PatternStats> patternStats = new ConcurrentHashMap<>();

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

            // Store pattern
            activePatterns.put(pattern.getPatternId(), pattern);
            patternsByStock.computeIfAbsent(pattern.getScripCode(), k -> new ArrayList<>()).add(pattern);

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
            completedPatterns.put(patternId, pattern);

            // Update stats
            PatternStats stats = patternStats.computeIfAbsent(pattern.getPatternType(),
                    k -> new PatternStats(pattern.getPatternType()));
            stats.recordOutcome(isWin, pnl);
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
