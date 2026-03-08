package com.kotsin.dashboard.service;

import java.util.List;
import java.util.Map;

/**
 * Single source of truth for strategy name resolution across the dashboard backend.
 * All services must use this class instead of inline fallback/normalization logic.
 */
public final class StrategyNameResolver {

    private StrategyNameResolver() {}

    public static final List<String> ALL_STRATEGY_KEYS = List.of(
            "FUDKII", "FUKAA", "FUDKOI", "PIVOT_CONFLUENCE", "MICROALPHA", "MERE", "QUANT"
    );

    public static final Map<String, String> DISPLAY_NAMES = Map.ofEntries(
            Map.entry("FUDKII", "FUDKII"),
            Map.entry("FUKAA", "FUKAA"),
            Map.entry("FUDKOI", "FUDKOI"),
            Map.entry("PIVOT_CONFLUENCE", "PIVOT"),
            Map.entry("MICROALPHA", "MICROALPHA"),
            Map.entry("MERE", "MERE"),
            Map.entry("QUANT", "QUANT"),
            Map.entry("MANUAL", "MANUAL")
    );

    /**
     * Normalize any raw strategy string to its canonical key.
     * Handles compound values like "FUDKII_LONG", aliases like "PIVOT", and unknowns.
     */
    public static String normalize(String raw) {
        if (raw == null || raw.isBlank()) return "MANUAL";
        String upper = raw.trim().toUpperCase();

        if (ALL_STRATEGY_KEYS.contains(upper)) return upper;

        // Order matters: FUDKOI before FUDKII (both contain "FUD")
        if (upper.contains("FUDKOI")) return "FUDKOI";
        if (upper.contains("FUDKII")) return "FUDKII";
        if (upper.contains("FUKAA"))  return "FUKAA";
        if (upper.contains("PIVOT"))  return "PIVOT_CONFLUENCE";
        if (upper.contains("MICRO"))  return "MICROALPHA";
        if (upper.contains("MERE"))   return "MERE"; // MERE_SCALP, MERE_SWING, MERE_POSITIONAL → MERE
        if (upper.contains("QUANT"))  return "QUANT";

        return "MANUAL";
    }

    public static String displayName(String canonicalKey) {
        return DISPLAY_NAMES.getOrDefault(canonicalKey, canonicalKey);
    }

    /**
     * Extract and normalize strategy from a Redis position data map.
     * Unified fallback chain: signalSource → strategy → signalType → signalId prefix → MANUAL
     */
    public static String extractFromRedis(Map<?, ?> data) {
        String raw = getStr(data, "signalSource");
        if (raw == null) raw = getStr(data, "strategy");
        if (raw == null) raw = getStr(data, "signalType");

        if (raw == null) {
            String sid = getStr(data, "signalId");
            if (sid != null && sid.contains("_")) {
                raw = sid.substring(0, sid.indexOf("_"));
            }
        }

        return normalize(raw);
    }

    /**
     * Extract and normalize strategy from a MongoDB document.
     */
    public static String extractFromDocument(org.bson.Document doc) {
        String raw = doc.getString("signalSource");
        if (raw == null || raw.isEmpty()) raw = doc.getString("strategy");
        if (raw == null || raw.isEmpty()) raw = doc.getString("signalType");
        return normalize(raw);
    }

    /**
     * Extract executionMode from a Redis position data map.
     * If executionMode is missing but a known strategy is present, infer AUTO.
     */
    public static String extractExecutionMode(Map<?, ?> data) {
        String mode = getStr(data, "executionMode");
        if ("AUTO".equalsIgnoreCase(mode)) return "AUTO";
        if ("MANUAL".equalsIgnoreCase(mode)) return "MANUAL";
        // No explicit mode — infer from strategy
        String strategy = getStr(data, "strategy");
        if (strategy == null) strategy = getStr(data, "signalSource");
        return isAutoStrategy(strategy) ? "AUTO" : "MANUAL";
    }

    /**
     * Extract executionMode from a MongoDB document.
     * If executionMode is missing but a known strategy is present, infer AUTO.
     */
    public static String extractExecutionModeFromDocument(org.bson.Document doc) {
        String mode = doc.getString("executionMode");
        if ("AUTO".equalsIgnoreCase(mode)) return "AUTO";
        if ("MANUAL".equalsIgnoreCase(mode)) return "MANUAL";
        String strategy = doc.getString("strategy");
        if (strategy == null) strategy = doc.getString("signalSource");
        return isAutoStrategy(strategy) ? "AUTO" : "MANUAL";
    }

    private static boolean isAutoStrategy(String strategy) {
        if (strategy == null || strategy.isEmpty()) return false;
        String normalized = normalize(strategy);
        return !"MANUAL".equals(normalized);
    }

    private static String getStr(Map<?, ?> data, String key) {
        Object val = data.get(key);
        if (val == null) return null;
        String s = val.toString();
        return s.isEmpty() ? null : s;
    }
}
