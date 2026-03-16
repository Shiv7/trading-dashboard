package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.PatternSignalDTO;
import com.kotsin.dashboard.service.ScripLookupService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Expiry;
import jakarta.annotation.PostConstruct;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * PatternSignalConsumer - Consumes pattern signals from SMTIS v2.0
 *
 * Uses Caffeine caches with TF-aware TTL for automatic lifecycle management.
 * No manual eviction, no memory leaks, O(1) amortized operations.
 *
 * Listens to: pattern-signals (Kafka topic)
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class PatternSignalConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final int MAX_ACTIVE_PATTERNS = 8000;
    private static final int MAX_COMPLETED_PATTERNS = 1000;

    // Timeframe → candle duration in minutes. Pattern expires when its candle closes.
    private static final Map<String, Long> TF_MINUTES = Map.ofEntries(
            Map.entry("1m", 2L), Map.entry("3m", 4L), Map.entry("5m", 6L),
            Map.entry("15m", 16L), Map.entry("30m", 31L), Map.entry("1h", 61L),
            Map.entry("2h", 121L), Map.entry("4h", 241L),
            Map.entry("1d", 1441L), Map.entry("1D", 1441L)
    );
    // +1 minute buffer above exact TF duration so the pattern is visible for the full candle

    private static final long DEFAULT_TTL_MINUTES = 60; // unknown TF fallback

    /**
     * Active patterns cache: auto-evicts when candle closes (TF-aware TTL).
     * maximumSize is a hard ceiling — Caffeine evicts LRU entries when exceeded,
     * so burst floods shed oldest entries instead of blocking new ones.
     */
    private final Cache<String, PatternSignalDTO> activePatterns = Caffeine.newBuilder()
            .maximumSize(MAX_ACTIVE_PATTERNS)
            .expireAfter(new Expiry<String, PatternSignalDTO>() {
                @Override
                public long expireAfterCreate(String key, PatternSignalDTO pattern, long currentTime) {
                    return computeTtlNanos(pattern);
                }
                @Override
                public long expireAfterUpdate(String key, PatternSignalDTO pattern, long currentTime, long currentDuration) {
                    return currentDuration; // keep original TTL on update
                }
                @Override
                public long expireAfterRead(String key, PatternSignalDTO pattern, long currentTime, long currentDuration) {
                    return currentDuration; // reads don't extend TTL
                }
            })
            .build();

    /** Completed patterns: flat 2-hour TTL, LRU eviction. */
    private final Cache<String, PatternSignalDTO> completedPatterns = Caffeine.newBuilder()
            .maximumSize(MAX_COMPLETED_PATTERNS)
            .expireAfterWrite(2, TimeUnit.HOURS)
            .build();

    /** Dedup cache: scripCode|patternType|timeframe|timestamp → 25h TTL. */
    private final Cache<String, Boolean> dedupCache = Caffeine.newBuilder()
            .expireAfterWrite(25, TimeUnit.HOURS)
            .maximumSize(50000)
            .build();

    /** Pattern statistics (lightweight, no memory pressure). */
    private final Map<String, PatternStats> patternStats = new ConcurrentHashMap<>();

    /**
     * Compute TTL in nanoseconds based on how much time remains until the candle closes.
     * If the candle already closed (e.g., late Kafka delivery), returns 1 minute so the
     * pattern is briefly visible before eviction.
     */
    private long computeTtlNanos(PatternSignalDTO pattern) {
        LocalDateTime triggeredAt = pattern.getTriggeredAt();
        String tf = pattern.getTimeframe();

        long tfMinutes = DEFAULT_TTL_MINUTES;
        if (tf != null) {
            Long lookup = TF_MINUTES.get(tf.toLowerCase());
            if (lookup == null) lookup = TF_MINUTES.get(tf);
            if (lookup != null) tfMinutes = lookup;
        }

        if (triggeredAt != null) {
            LocalDateTime candleClose = triggeredAt.plusMinutes(tfMinutes);
            long remainingMs = Duration.between(LocalDateTime.now(), candleClose).toMillis();
            if (remainingMs > 0) {
                return TimeUnit.MILLISECONDS.toNanos(remainingMs);
            }
        }

        // Already expired or no timestamp — keep 1 minute for brief visibility
        return TimeUnit.MINUTES.toNanos(1);
    }

    @PostConstruct
    public void init() {
        log.info("PatternSignalConsumer initialized: maxActive={}, maxCompleted={}, TTL=TF-aware",
                MAX_ACTIVE_PATTERNS, MAX_COMPLETED_PATTERNS);
    }

    @KafkaListener(topics = {"pattern-signals"}, groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onPatternSignal(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            PatternSignalDTO pattern = parsePatternSignal(root);

            if (pattern.getPatternId() == null || pattern.getPatternId().isEmpty()) {
                return;
            }

            // Dedup by deterministic patternId
            if (activePatterns.getIfPresent(pattern.getPatternId()) != null) {
                return;
            }

            // Secondary dedup by content key (covers legacy random UUIDs)
            String dedupKey = pattern.getScripCode() + "|" + pattern.getPatternType()
                    + "|" + pattern.getTimeframe() + "|" + pattern.getTriggeredAt();
            if (dedupCache.getIfPresent(dedupKey) != null) {
                return;
            }
            dedupCache.put(dedupKey, Boolean.TRUE);

            // Store — Caffeine handles eviction automatically (TTL + LRU on overflow)
            activePatterns.put(pattern.getPatternId(), pattern);

            // Update statistics
            updatePatternStats(pattern);

            // Broadcast to WebSocket
            sessionManager.broadcastPatternSignal(pattern);

            // Send notification
            String emoji = getPatternEmoji(pattern.getPatternType());
            sessionManager.broadcastNotification("PATTERN",
                    String.format("%s %s pattern detected for %s @ %.2f",
                            emoji, pattern.getPatternType(), pattern.getCompanyName(), pattern.getEntryPrice()));

            if (log.isDebugEnabled()) {
                log.debug("Pattern: {} {} {} {} conf={} active={}",
                        pattern.getScripCode(), pattern.getPatternType(), pattern.getDirection(),
                        pattern.getTimeframe(), pattern.getConfidence(), activePatterns.estimatedSize());
            }
        } catch (Exception e) {
            log.error("Error processing pattern signal: {}", e.getMessage(), e);
        }
    }

    /**
     * Update pattern when outcome is known
     */
    public void updatePatternOutcome(String patternId, boolean isWin, double pnl) {
        PatternSignalDTO pattern = activePatterns.getIfPresent(patternId);
        if (pattern != null) {
            activePatterns.invalidate(patternId);
            pattern.setStatus(isWin ? "COMPLETED_WIN" : "COMPLETED_LOSS");
            pattern.setActualPnl(pnl);
            pattern.setCompletedAt(LocalDateTime.now());
            completedPatterns.put(patternId, pattern);

            PatternStats stats = patternStats.computeIfAbsent(pattern.getPatternType(),
                    k -> new PatternStats(pattern.getPatternType()));
            stats.recordOutcome(isWin, pnl);
        }
    }

    private PatternSignalDTO parsePatternSignal(JsonNode root) {
        long timestamp = root.path("timestamp").asLong(
                root.path("triggeredAt").asLong(System.currentTimeMillis()));

        String patternId = root.path("patternId").asText(null);
        if (patternId == null || patternId.isEmpty() || "null".equals(patternId)) {
            patternId = root.path("id").asText(null);
        }
        if (patternId == null || patternId.isEmpty() || "null".equals(patternId)) {
            patternId = UUID.randomUUID().toString();
        }

        return PatternSignalDTO.builder()
                .patternId(patternId)
                .signalId(root.path("signalId").asText())
                .scripCode(root.path("scripCode").asText(root.path("familyId").asText()))
                .companyName(scripLookup.resolve(root.path("scripCode").asText(root.path("familyId").asText()), root.path("companyName").asText("")))
                .symbol(root.path("symbol").asText(root.path("companyName").asText("")))
                .exchange(root.path("exchange").asText(""))
                .patternType(root.path("patternType").asText(root.path("type").asText("UNKNOWN")))
                .direction(root.path("direction").asText("NEUTRAL"))
                .status("ACTIVE")
                .confidence(root.path("confidence").asDouble(0))
                .qualityScore(root.path("qualityScore").asInt(0))
                .entryPrice(root.path("entryPrice").asDouble(0))
                .stopLoss(nullableDouble(root, "stopLoss"))
                .target1(nullableDouble(root, "target1"))
                .target2(nullableDouble(root, "target2"))
                .target3(nullableDouble(root, "target3"))
                .target4(nullableDouble(root, "target4"))
                .riskRewardRatio(nullableDouble(root, "riskRewardRatio"))
                .timeframe(root.path("timeframe").asText(""))
                .patternDescription(root.path("description").asText(root.path("narrative").asText("")))
                .triggerCondition(root.path("triggerCondition").asText(""))
                .invalidationPrice(root.path("invalidationPrice").asDouble(0))
                .expiresAt(parseDateTime(root.path("expiresAt")))
                .triggeredAt(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .gexRegime(root.path("gexRegime").asText(""))
                .session(root.path("session").asText(""))
                .daysToExpiry(root.has("daysToExpiry") ? root.path("daysToExpiry").asInt() : null)
                .volumeConfirmed(root.has("volumeConfirmed") ? root.path("volumeConfirmed").asBoolean() : null)
                .volumeRatio(root.has("volumeRatio") ? root.path("volumeRatio").asDouble() : null)
                // Option/futures enrichment
                .optionAvailable(root.has("optionAvailable") ? root.path("optionAvailable").asBoolean() : null)
                .optionFailureReason(root.path("optionFailureReason").asText(null))
                .optionScripCode(root.path("optionScripCode").asText(null))
                .optionSymbol(root.path("optionSymbol").asText(null))
                .optionStrike(nullableDouble(root, "optionStrike"))
                .optionType(root.path("optionType").asText(null))
                .optionExpiry(root.path("optionExpiry").asText(null))
                .optionLtp(nullableDouble(root, "optionLtp"))
                .optionLotSize(root.has("optionLotSize") ? root.path("optionLotSize").asInt() : null)
                .optionMultiplier(root.has("optionMultiplier") ? root.path("optionMultiplier").asInt() : null)
                .futuresAvailable(root.has("futuresAvailable") ? root.path("futuresAvailable").asBoolean() : null)
                .futuresScripCode(root.path("futuresScripCode").asText(null))
                .futuresSymbol(root.path("futuresSymbol").asText(null))
                .futuresLtp(nullableDouble(root, "futuresLtp"))
                .futuresLotSize(root.has("futuresLotSize") ? root.path("futuresLotSize").asInt() : null)
                .futuresMultiplier(root.has("futuresMultiplier") ? root.path("futuresMultiplier").asInt() : null)
                .futuresExpiry(root.path("futuresExpiry").asText(null))
                .build();
    }

    private LocalDateTime parseDateTime(JsonNode node) {
        if (node.isNull() || node.isMissingNode()) return null;
        try {
            if (node.isTextual()) return LocalDateTime.parse(node.asText());
            else if (node.isNumber())
                return LocalDateTime.ofInstant(Instant.ofEpochMilli(node.asLong()), ZoneId.of("Asia/Kolkata"));
        } catch (Exception e) { /* ignore parse errors */ }
        return null;
    }

    private Double nullableDouble(JsonNode root, String field) {
        if (!root.has(field) || root.path(field).isNull()) return null;
        return root.path(field).asDouble(0);
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

    public int clearAllPatterns() {
        long cleared = activePatterns.estimatedSize();
        activePatterns.invalidateAll();
        completedPatterns.invalidateAll();
        patternStats.clear();
        dedupCache.invalidateAll();
        log.info("Cleared all patterns: ~{} active, stats, and dedup cache reset", cleared);
        return (int) cleared;
    }

    public List<PatternSignalDTO> getActivePatterns() {
        activePatterns.cleanUp(); // force eviction of expired entries before returning
        return new ArrayList<>(activePatterns.asMap().values());
    }

    public List<PatternSignalDTO> getActivePatternsForStock(String scripCode) {
        activePatterns.cleanUp();
        return activePatterns.asMap().values().stream()
                .filter(p -> scripCode.equals(p.getScripCode()))
                .collect(Collectors.toList());
    }

    public List<PatternSignalDTO> getCompletedPatterns(int limit) {
        return completedPatterns.asMap().values().stream()
                .sorted(Comparator.comparing(
                        (PatternSignalDTO p) -> p.getCompletedAt() != null ? p.getCompletedAt() : LocalDateTime.MIN)
                        .reversed())
                .limit(limit)
                .collect(Collectors.toList());
    }

    public PatternSignalDTO getPattern(String patternId) {
        PatternSignalDTO pattern = activePatterns.getIfPresent(patternId);
        if (pattern == null) pattern = completedPatterns.getIfPresent(patternId);
        return pattern;
    }

    public Map<String, PatternStats> getPatternStats() {
        return new HashMap<>(patternStats);
    }

    public PatternSummary getPatternSummary() {
        activePatterns.cleanUp();
        int totalActive = (int) activePatterns.estimatedSize();
        int totalCompleted = (int) completedPatterns.estimatedSize();

        long wins = completedPatterns.asMap().values().stream()
                .filter(p -> "COMPLETED_WIN".equals(p.getStatus()))
                .count();

        double totalPnl = completedPatterns.asMap().values().stream()
                .mapToDouble(p -> p.getActualPnl() != null ? p.getActualPnl() : 0)
                .sum();

        double winRate = totalCompleted > 0 ? (double) wins / totalCompleted : 0;

        Map<String, Long> byType = activePatterns.asMap().values().stream()
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
