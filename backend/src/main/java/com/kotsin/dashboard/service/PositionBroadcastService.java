package com.kotsin.dashboard.service;

import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * BUG-A2 fix (2026-05-03) — periodically polls Redis for changed positions and pushes
 * them to the frontend over the existing STOMP WebSocket {@code /topic/positions}.
 *
 * <p>Why this exists:
 * <ul>
 *   <li>tradeExec ({@link com.kotsin.execution.virtual.VirtualEngineService}) updates
 *       {@code virtual:positions:{STRATEGY}:{scripCode}} in Redis every 500&nbsp;ms with fresh
 *       {@code currentPrice} and {@code unrealizedPnl}.</li>
 *   <li>The dashboard's own {@code StrategyTradeExecutor} contains broadcast calls
 *       guarded by {@code if (!executionEnabled) return;} — and execution moved to
 *       tradeExec, so {@code strategy.execution.enabled=false}, so those calls are
 *       dead.</li>
 *   <li>Without this service, the frontend only sees fresh positions when the React
 *       page polls /api/live (30&nbsp;s) or /api/strategy-wallets (15&nbsp;s) — far too
 *       slow for a "real-time" P&amp;L display.</li>
 * </ul>
 *
 * <p>Approach: a single {@link Scheduled} task at {@code fixedDelay=1000} ms scans
 * Redis for {@code virtual:positions:*}, reads each value's {@code updatedAt} epoch
 * millis, and broadcasts only positions whose timestamp moved since the last cycle.
 * That lets the dashboard's per-position {@code updatedAt} act as a content version
 * — no JSON diffing, no parsing on the dashboard side, just push. The full position
 * JSON goes out so the frontend store can replace its cached copy.
 *
 * <p>Kill-switch: set {@code dashboard.position.broadcaster.enabled=false} in
 * application.properties to disable without redeploy.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PositionBroadcastService {

    private static final String POSITION_KEY_PATTERN = "virtual:positions:*";

    private final RedisTemplate<String, String> redisTemplate;
    private final WebSocketSessionManager sessionManager;

    @Value("${dashboard.position.broadcaster.enabled:true}")
    private boolean enabled;

    /** scripCode (or full Redis key for legacy entries) → last broadcast updatedAt. */
    private final Map<String, Long> lastUpdatedAt = new ConcurrentHashMap<>();

    /** Diagnostics so we can verify the loop is doing real work in nohup.out. */
    private long cyclesRun = 0;
    private long broadcastsLastMinute = 0;
    private long lastDiagnosticsLogMs = 0;

    @Scheduled(fixedDelayString = "${dashboard.position.broadcaster.intervalMs:1000}")
    public void broadcastChanged() {
        if (!enabled) return;
        cyclesRun++;
        long broadcastsThisCycle = 0;
        Set<String> seen = new HashSet<>();
        try {
            try (Cursor<String> cursor = redisTemplate.scan(
                    ScanOptions.scanOptions().match(POSITION_KEY_PATTERN).count(200).build())) {
                while (cursor.hasNext()) {
                    String key = cursor.next();
                    seen.add(key);
                    String json = redisTemplate.opsForValue().get(key);
                    if (json == null || json.isBlank()) continue;
                    Long updatedAt = extractUpdatedAt(json);
                    if (updatedAt == null) continue;

                    Long prior = lastUpdatedAt.get(key);
                    if (prior != null && prior.equals(updatedAt)) continue;

                    lastUpdatedAt.put(key, updatedAt);
                    String scripCode = extractScripCodeFromKey(key);
                    sessionManager.broadcastPositionUpdate(scripCode, json);
                    broadcastsThisCycle++;
                }
            }
            // Drop entries for keys that no longer exist (closed positions) so the map
            // doesn't grow unbounded across days of trading.
            lastUpdatedAt.keySet().retainAll(seen);

            broadcastsLastMinute += broadcastsThisCycle;
            long now = System.currentTimeMillis();
            if (now - lastDiagnosticsLogMs > 60_000) {
                if (broadcastsLastMinute > 0 || cyclesRun % 60 == 0) {
                    log.info("[POS-BROADCAST] cycles={} watching={} broadcastsLast60s={}",
                            cyclesRun, lastUpdatedAt.size(), broadcastsLastMinute);
                }
                broadcastsLastMinute = 0;
                lastDiagnosticsLogMs = now;
            }
        } catch (Exception e) {
            log.warn("[POS-BROADCAST] cycle error: {}", e.getMessage());
        }
    }

    /**
     * Pull just the updatedAt epoch-millis from the position JSON without a full
     * Jackson tree parse. Fast string scan — we run this ~1×/sec across ~140 keys.
     * Returns null when the field is absent or unparseable.
     */
    static Long extractUpdatedAt(String json) {
        int i = json.indexOf("\"updatedAt\"");
        if (i < 0) return null;
        int colon = json.indexOf(':', i + 11);
        if (colon < 0) return null;
        int start = colon + 1;
        // skip whitespace
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) start++;
        int end = start;
        while (end < json.length()) {
            char c = json.charAt(end);
            if (c >= '0' && c <= '9') { end++; continue; }
            break;
        }
        if (end == start) return null;
        try {
            return Long.parseLong(json.substring(start, end));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Recover scripCode from a position key. Mirrors the BUG-A5 fix in
     * {@link StrategyWalletsService#extractScripCodeFromKey}.
     */
    static String extractScripCodeFromKey(String key) {
        if (key == null) return null;
        String tail = key.startsWith("virtual:positions:")
                ? key.substring("virtual:positions:".length())
                : key;
        int lastColon = tail.lastIndexOf(':');
        return lastColon >= 0 ? tail.substring(lastColon + 1) : tail;
    }

    /** Test seam — clear the version cache to force re-broadcast on next cycle. */
    void resetForTest() {
        lastUpdatedAt.clear();
        cyclesRun = 0;
        broadcastsLastMinute = 0;
    }

    /** Test seam — inspect current watch set size. */
    int trackedKeyCount() {
        return lastUpdatedAt.size();
    }

    /** Test seam — inspect cycle counter. */
    long getCyclesRun() {
        return cyclesRun;
    }
}
