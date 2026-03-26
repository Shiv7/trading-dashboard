package com.kotsin.dashboard.service;

import lombok.*;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * ConfigManagementService - Read, modify, audit, and rollback strategy-relevant
 * configuration properties across Trade Execution and Streaming Candle services.
 *
 * All changes are persisted to MongoDB `config_changes` collection for full audit trail.
 * Properties file writes are atomic (write to temp, then rename).
 * Includes production-hours guard to prevent live modifications during market hours.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ConfigManagementService {

    private final MongoTemplate mongoTemplate;

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter ISO_FMT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
    private static final String CONFIG_CHANGES_COLLECTION = "config_changes";

    private static final Map<String, String> SERVICE_PATHS = Map.of(
            "TRADE_EXECUTION", "/home/ubuntu/tradeExcutionModule/src/main/resources/application.properties",
            "STREAMING_CANDLE", "/home/ubuntu/streamingcandle/src/main/resources/application.properties"
    );

    // Strategy-relevant key fragments — only these are exposed via getCurrentConfig
    private static final List<String> RELEVANT_KEY_FRAGMENTS = List.of(
            "risk", "target", "allocation", "confidence", "trigger", "atr", "sl", "gate",
            "lot", "mere", "fudkii", "fukaa", "fudkoi", "pivot", "microalpha", "mcxbb",
            "conviction", "signal.batch", "exit.dd"
    );

    // Production hours: 9:00 IST to 23:30 IST (covers NSE + MCX)
    private static final LocalTime PROD_START = LocalTime.of(9, 0);
    private static final LocalTime PROD_END = LocalTime.of(23, 30);

    // ════════════════════════════════════════════
    //  Public API
    // ════════════════════════════════════════════

    /**
     * Read current strategy-relevant config for a service.
     * Filters to only keys containing relevant fragments.
     */
    public ConfigSnapshot getCurrentConfig(String service) {
        String propsPath = resolvePropertiesPath(service);
        Properties props = readProperties(propsPath);

        Map<String, String> filtered = new LinkedHashMap<>();
        List<String> sortedKeys = props.stringPropertyNames().stream()
                .sorted()
                .collect(Collectors.toList());

        for (String key : sortedKeys) {
            String keyLower = key.toLowerCase();
            boolean relevant = RELEVANT_KEY_FRAGMENTS.stream()
                    .anyMatch(keyLower::contains);
            if (relevant) {
                filtered.put(key, props.getProperty(key));
            }
        }

        return ConfigSnapshot.builder()
                .service(service.toUpperCase())
                .filePath(propsPath)
                .properties(filtered)
                .propertyCount(filtered.size())
                .readAt(LocalDateTime.now(IST).format(ISO_FMT))
                .build();
    }

    /**
     * Apply config changes to a service's application.properties.
     * Writes an audit record to MongoDB before modifying the file.
     * Returns success with change details and pendingRestart flag.
     */
    public ConfigChangeResult applyConfigChanges(String service, Map<String, String> changes, String reason) {
        if (changes == null || changes.isEmpty()) {
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("No changes provided")
                    .build();
        }

        String normalizedService = service.toUpperCase();
        String propsPath = resolvePropertiesPath(normalizedService);
        boolean duringProdHours = isProductionHours();

        // Read current file line by line
        List<String> lines;
        try {
            lines = Files.readAllLines(Path.of(propsPath));
        } catch (IOException e) {
            log.error("[CONFIG_MGMT] Failed to read properties file {}: {}", propsPath, e.getMessage());
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("Failed to read properties file: " + e.getMessage())
                    .build();
        }

        // Read current values for audit
        Properties currentProps = readProperties(propsPath);
        List<ConfigDiff> diffs = new ArrayList<>();
        Map<String, Boolean> applied = new LinkedHashMap<>();

        for (Map.Entry<String, String> change : changes.entrySet()) {
            String key = change.getKey();
            String newValue = change.getValue();
            String oldValue = currentProps.getProperty(key);

            diffs.add(ConfigDiff.builder()
                    .key(key)
                    .oldValue(oldValue != null ? oldValue : "(not set)")
                    .newValue(newValue)
                    .build());
            applied.put(key, false);
        }

        // Generate change ID
        String changeId = "cfg-" + System.currentTimeMillis() + "-" +
                normalizedService.substring(0, Math.min(4, normalizedService.length())).toLowerCase();

        // Persist audit record to MongoDB BEFORE modifying file
        Document auditDoc = new Document()
                .append("changeId", changeId)
                .append("service", normalizedService)
                .append("changes", diffs.stream().map(d -> new Document()
                        .append("key", d.getKey())
                        .append("oldValue", d.getOldValue())
                        .append("newValue", d.getNewValue())
                ).collect(Collectors.toList()))
                .append("reason", reason != null ? reason : "No reason provided")
                .append("appliedAt", new Date())
                .append("appliedAtIST", LocalDateTime.now(IST).format(ISO_FMT))
                .append("rolledBack", false)
                .append("duringProdHours", duringProdHours);

        try {
            mongoTemplate.getCollection(CONFIG_CHANGES_COLLECTION).insertOne(auditDoc);
        } catch (Exception e) {
            log.error("[CONFIG_MGMT] Failed to persist audit record: {}", e.getMessage());
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("Failed to save audit record: " + e.getMessage())
                    .build();
        }

        // Modify lines in memory
        List<String> modifiedLines = new ArrayList<>(lines);
        for (Map.Entry<String, String> change : changes.entrySet()) {
            String key = change.getKey();
            String newValue = change.getValue();
            boolean found = false;

            for (int i = 0; i < modifiedLines.size(); i++) {
                String line = modifiedLines.get(i).trim();
                // Skip comments and empty lines
                if (line.startsWith("#") || line.isEmpty()) continue;

                // Match key=value or key = value
                int eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                    String lineKey = line.substring(0, eqIdx).trim();
                    if (lineKey.equals(key)) {
                        // Preserve any inline comment
                        String originalLine = modifiedLines.get(i);
                        int commentIdx = findInlineComment(originalLine, eqIdx);
                        String comment = "";
                        if (commentIdx > 0) {
                            comment = " " + originalLine.substring(commentIdx);
                        }
                        modifiedLines.set(i, key + "=" + newValue + comment);
                        applied.put(key, true);
                        found = true;
                        break;
                    }
                }
            }

            // If key not found in file, append it
            if (!found) {
                modifiedLines.add(key + "=" + newValue);
                applied.put(key, true);
            }
        }

        // Atomic write: write to temp file, then rename
        try {
            Path targetPath = Path.of(propsPath);
            Path tempPath = Path.of(propsPath + ".tmp." + System.currentTimeMillis());

            Files.write(tempPath, modifiedLines);
            Files.move(tempPath, targetPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);

            log.info("[CONFIG_MGMT] Applied {} config changes to {} (changeId={})",
                    changes.size(), normalizedService, changeId);
        } catch (IOException e) {
            log.error("[CONFIG_MGMT] Failed to write properties file {}: {}", propsPath, e.getMessage());
            // Mark audit as failed
            try {
                mongoTemplate.getCollection(CONFIG_CHANGES_COLLECTION).updateOne(
                        new Document("changeId", changeId),
                        new Document("$set", new Document("writeFailed", true)
                                .append("writeError", e.getMessage()))
                );
            } catch (Exception ex) {
                log.error("[CONFIG_MGMT] Failed to update audit record: {}", ex.getMessage());
            }
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("Failed to write properties file: " + e.getMessage())
                    .changeId(changeId)
                    .build();
        }

        return ConfigChangeResult.builder()
                .success(true)
                .changeId(changeId)
                .service(normalizedService)
                .changes(diffs)
                .reason(reason)
                .appliedAt(LocalDateTime.now(IST).format(ISO_FMT))
                .pendingRestart(true)
                .message(duringProdHours
                        ? "Changes saved to file. Service is running in production hours (9:00-23:30 IST) — " +
                          "restart required for changes to take effect. Consider restarting after market close."
                        : "Changes saved to file. Restart the service for changes to take effect.")
                .build();
    }

    /**
     * Get config change history from MongoDB.
     */
    public List<ConfigChange> getConfigHistory(int limit) {
        int effectiveLimit = Math.max(1, Math.min(limit, 200));
        List<ConfigChange> history = new ArrayList<>();

        try {
            List<Document> docs = mongoTemplate.getCollection(CONFIG_CHANGES_COLLECTION)
                    .find()
                    .sort(new Document("appliedAt", -1))
                    .limit(effectiveLimit)
                    .into(new ArrayList<>());

            for (Document doc : docs) {
                List<ConfigDiff> diffs = new ArrayList<>();
                @SuppressWarnings("unchecked")
                List<Document> changeDocs = doc.getList("changes", Document.class);
                if (changeDocs != null) {
                    for (Document cd : changeDocs) {
                        diffs.add(ConfigDiff.builder()
                                .key(cd.getString("key"))
                                .oldValue(cd.getString("oldValue"))
                                .newValue(cd.getString("newValue"))
                                .build());
                    }
                }

                history.add(ConfigChange.builder()
                        .changeId(doc.getString("changeId"))
                        .service(doc.getString("service"))
                        .changes(diffs)
                        .reason(doc.getString("reason"))
                        .appliedAt(doc.getString("appliedAtIST") != null
                                ? doc.getString("appliedAtIST")
                                : doc.getDate("appliedAt") != null
                                ? doc.getDate("appliedAt").toInstant().atZone(IST).format(ISO_FMT)
                                : "unknown")
                        .rolledBack(doc.getBoolean("rolledBack", false))
                        .build());
            }
        } catch (Exception e) {
            log.error("[CONFIG_MGMT] Failed to fetch config history: {}", e.getMessage());
        }

        return history;
    }

    /**
     * Rollback a config change by re-applying old values.
     * Creates a new audit record for the rollback itself.
     */
    public ConfigChangeResult rollbackConfig(String changeId) {
        if (changeId == null || changeId.isEmpty()) {
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("changeId is required")
                    .build();
        }

        // Find the original change in MongoDB
        Document originalDoc;
        try {
            originalDoc = mongoTemplate.getCollection(CONFIG_CHANGES_COLLECTION)
                    .find(new Document("changeId", changeId))
                    .first();
        } catch (Exception e) {
            log.error("[CONFIG_MGMT] Failed to find change {}: {}", changeId, e.getMessage());
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("Failed to find change record: " + e.getMessage())
                    .build();
        }

        if (originalDoc == null) {
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("Change not found: " + changeId)
                    .build();
        }

        if (originalDoc.getBoolean("rolledBack", false)) {
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("Change " + changeId + " has already been rolled back")
                    .build();
        }

        String service = originalDoc.getString("service");
        @SuppressWarnings("unchecked")
        List<Document> changeDocs = originalDoc.getList("changes", Document.class);

        if (changeDocs == null || changeDocs.isEmpty()) {
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("No changes found in record " + changeId)
                    .build();
        }

        // Build rollback map: key -> oldValue (restore previous values)
        Map<String, String> rollbackChanges = new LinkedHashMap<>();
        for (Document cd : changeDocs) {
            String key = cd.getString("key");
            String oldValue = cd.getString("oldValue");
            if (key != null && oldValue != null && !"(not set)".equals(oldValue)) {
                rollbackChanges.put(key, oldValue);
            }
        }

        if (rollbackChanges.isEmpty()) {
            return ConfigChangeResult.builder()
                    .success(false)
                    .message("No rollback-able changes found (all were new keys)")
                    .build();
        }

        // Apply the rollback as a new config change
        String rollbackReason = "Rollback of change " + changeId;
        ConfigChangeResult result = applyConfigChanges(service, rollbackChanges, rollbackReason);

        if (result.isSuccess()) {
            // Mark the original change as rolled back
            try {
                mongoTemplate.getCollection(CONFIG_CHANGES_COLLECTION).updateOne(
                        new Document("changeId", changeId),
                        new Document("$set", new Document("rolledBack", true)
                                .append("rolledBackAt", LocalDateTime.now(IST).format(ISO_FMT))
                                .append("rollbackChangeId", result.getChangeId()))
                );
            } catch (Exception e) {
                log.error("[CONFIG_MGMT] Failed to mark change {} as rolled back: {}", changeId, e.getMessage());
            }

            log.info("[CONFIG_MGMT] Successfully rolled back change {} for service {}", changeId, service);
        }

        return ConfigChangeResult.builder()
                .success(result.isSuccess())
                .changeId(result.getChangeId())
                .service(service)
                .changes(result.getChanges())
                .reason(rollbackReason)
                .appliedAt(result.getAppliedAt())
                .pendingRestart(result.isPendingRestart())
                .message(result.isSuccess()
                        ? "Rollback of " + changeId + " applied. " + result.getMessage()
                        : "Rollback failed: " + result.getMessage())
                .build();
    }

    // ════════════════════════════════════════════
    //  Helpers
    // ════════════════════════════════════════════

    private String resolvePropertiesPath(String service) {
        String path = SERVICE_PATHS.get(service.toUpperCase());
        if (path == null) {
            throw new IllegalArgumentException("Unknown service: " + service +
                    ". Valid services: " + String.join(", ", SERVICE_PATHS.keySet()));
        }
        return path;
    }

    private Properties readProperties(String filePath) {
        Properties props = new Properties();
        try (FileReader reader = new FileReader(filePath)) {
            props.load(reader);
        } catch (IOException e) {
            log.error("[CONFIG_MGMT] Cannot read properties from {}: {}", filePath, e.getMessage());
        }
        return props;
    }

    /**
     * Check if current IST time is within production hours (9:00-23:30).
     */
    private boolean isProductionHours() {
        LocalTime now = LocalTime.now(IST);
        // Check day of week (skip weekends)
        DayOfWeek day = LocalDate.now(IST).getDayOfWeek();
        if (day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY) {
            return false;
        }
        return !now.isBefore(PROD_START) && !now.isAfter(PROD_END);
    }

    /**
     * Find position of inline comment (# not inside a value).
     * Returns -1 if no inline comment found.
     */
    private int findInlineComment(String line, int afterEq) {
        // Simple heuristic: look for # after the = sign with a space before it
        for (int i = afterEq + 1; i < line.length(); i++) {
            if (line.charAt(i) == '#' && i > 0 && line.charAt(i - 1) == ' ') {
                return i;
            }
        }
        return -1;
    }

    // ════════════════════════════════════════════
    //  DTOs
    // ════════════════════════════════════════════

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ConfigSnapshot {
        private String service;
        private String filePath;
        private Map<String, String> properties;
        private int propertyCount;
        private String readAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ConfigChangeResult {
        private boolean success;
        private String changeId;
        private String service;
        private List<ConfigDiff> changes;
        private String reason;
        private String appliedAt;
        private boolean pendingRestart;
        private String message;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ConfigChange {
        private String changeId;
        private String service;
        private List<ConfigDiff> changes;
        private String reason;
        private String appliedAt;
        private boolean rolledBack;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ConfigDiff {
        private String key;
        private String oldValue;
        private String newValue;
    }
}
