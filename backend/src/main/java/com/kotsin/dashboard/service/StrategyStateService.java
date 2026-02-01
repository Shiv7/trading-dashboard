package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.kotsin.dashboard.model.dto.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Service for fetching strategy state (VCP, IPU, Pivot) from Redis.
 *
 * ARCHITECTURE:
 * - StreamingCandle calculates and stores strategy state in Redis
 * - Dashboard reads from Redis for display
 * - State is updated after each strategy calculation cycle
 *
 * Redis Key Patterns:
 * - strategy:{symbol}:VCP:{tf}    → VCP state
 * - strategy:{symbol}:IPU:{tf}    → IPU state
 * - strategy:{symbol}:PIVOT:{tf}  → Pivot state
 *
 * Alternative patterns (also supported):
 * - vcp:{symbol}:state            → VCP state (legacy)
 * - ipu:{symbol}:state            → IPU state (legacy)
 * - pivot:{symbol}:state          → Pivot state (legacy)
 */
@Service
@Slf4j
public class StrategyStateService {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;

    // Key prefixes
    private static final String STRATEGY_PREFIX = "strategy:";
    private static final String VCP_LEGACY_PREFIX = "vcp:";
    private static final String IPU_LEGACY_PREFIX = "ipu:";
    private static final String PIVOT_LEGACY_PREFIX = "pivot:";

    /**
     * Constructor - configure ObjectMapper for Java time types.
     */
    public StrategyStateService(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
    }

    /**
     * Get VCP state for a symbol.
     */
    public Optional<VcpStateDTO> getVcpState(String symbol, String timeframe) {
        // Try new key pattern first
        String newKey = STRATEGY_PREFIX + symbol + ":VCP:" + timeframe;
        Optional<VcpStateDTO> state = getState(newKey, VcpStateDTO.class);

        if (state.isEmpty()) {
            // Try legacy key pattern
            String legacyKey = VCP_LEGACY_PREFIX + symbol + ":state";
            state = getState(legacyKey, VcpStateDTO.class);
        }

        return state;
    }

    /**
     * Get IPU state for a symbol.
     */
    public Optional<IpuStateDTO> getIpuState(String symbol, String timeframe) {
        // Try new key pattern first
        String newKey = STRATEGY_PREFIX + symbol + ":IPU:" + timeframe;
        Optional<IpuStateDTO> state = getState(newKey, IpuStateDTO.class);

        if (state.isEmpty()) {
            // Try legacy key pattern
            String legacyKey = IPU_LEGACY_PREFIX + symbol + ":state";
            state = getState(legacyKey, IpuStateDTO.class);
        }

        return state;
    }

    /**
     * Get Pivot state for a symbol.
     */
    public Optional<PivotStateDTO> getPivotState(String symbol, String timeframe) {
        // Try new key pattern first
        String newKey = STRATEGY_PREFIX + symbol + ":PIVOT:" + timeframe;
        Optional<PivotStateDTO> state = getState(newKey, PivotStateDTO.class);

        if (state.isEmpty()) {
            // Try legacy key pattern
            String legacyKey = PIVOT_LEGACY_PREFIX + symbol + ":state";
            state = getState(legacyKey, PivotStateDTO.class);
        }

        return state;
    }

    /**
     * Get full strategy state for a symbol (all three states).
     */
    public Optional<StrategyStateDTO> getFullState(String symbol, String timeframe) {
        Optional<VcpStateDTO> vcp = getVcpState(symbol, timeframe);
        Optional<IpuStateDTO> ipu = getIpuState(symbol, timeframe);
        Optional<PivotStateDTO> pivot = getPivotState(symbol, timeframe);

        if (vcp.isEmpty() && ipu.isEmpty() && pivot.isEmpty()) {
            return Optional.empty();
        }

        StrategyStateDTO state = StrategyStateDTO.builder()
                .symbol(symbol)
                .timeframe(timeframe)
                .vcpState(vcp.orElse(null))
                .ipuState(ipu.orElse(null))
                .pivotState(pivot.orElse(null))
                .hasVcpState(vcp.isPresent())
                .hasIpuState(ipu.isPresent())
                .hasPivotState(pivot.isPresent())
                .build();

        // Calculate composite values
        state.setCompositeDirection(state.calculateCompositeDirection());
        state.setCompositeScore(state.calculateCompositeScore());
        state.setCompositeSignal(state.calculateCompositeSignal());

        return Optional.of(state);
    }

    /**
     * Get symbols with high IPU score.
     */
    public List<String> getSymbolsWithHighIpu(String timeframe, double minScore) {
        List<String> result = new ArrayList<>();

        try {
            // Scan for IPU keys
            Set<String> keys = redisTemplate.keys(STRATEGY_PREFIX + "*:IPU:" + timeframe);
            if (keys == null) keys = new HashSet<>();

            // Also check legacy keys
            Set<String> legacyKeys = redisTemplate.keys(IPU_LEGACY_PREFIX + "*:state");
            if (legacyKeys != null) keys.addAll(legacyKeys);

            for (String key : keys) {
                try {
                    String json = redisTemplate.opsForValue().get(key);
                    if (json != null) {
                        IpuStateDTO state = objectMapper.readValue(json, IpuStateDTO.class);
                        if (state.getCurrentIpuScore() != null && state.getCurrentIpuScore() >= minScore) {
                            String symbol = extractSymbolFromKey(key);
                            if (symbol != null) {
                                result.add(symbol);
                            }
                        }
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse IPU state from key {}: {}", key, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Error getting high IPU symbols: {}", e.getMessage());
        }

        return result;
    }

    /**
     * Get symbols with active VCP setup.
     */
    public List<String> getSymbolsWithActiveVcp(String timeframe) {
        List<String> result = new ArrayList<>();

        try {
            Set<String> keys = redisTemplate.keys(STRATEGY_PREFIX + "*:VCP:" + timeframe);
            if (keys == null) keys = new HashSet<>();

            // Also check legacy keys
            Set<String> legacyKeys = redisTemplate.keys(VCP_LEGACY_PREFIX + "*:state");
            if (legacyKeys != null) keys.addAll(legacyKeys);

            for (String key : keys) {
                try {
                    String json = redisTemplate.opsForValue().get(key);
                    if (json != null) {
                        VcpStateDTO state = objectMapper.readValue(json, VcpStateDTO.class);
                        // Consider "active" if has both support and resistance clusters
                        if (state.getSupportClusters() != null && !state.getSupportClusters().isEmpty() &&
                            state.getResistanceClusters() != null && !state.getResistanceClusters().isEmpty()) {
                            String symbol = extractSymbolFromKey(key);
                            if (symbol != null) {
                                result.add(symbol);
                            }
                        }
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse VCP state from key {}: {}", key, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Error getting active VCP symbols: {}", e.getMessage());
        }

        return result;
    }

    /**
     * Get symbols with bullish VCP setup.
     */
    public List<String> getSymbolsWithBullishVcp(String timeframe) {
        List<String> result = new ArrayList<>();

        try {
            Set<String> keys = redisTemplate.keys(STRATEGY_PREFIX + "*:VCP:" + timeframe);
            if (keys == null) return result;

            for (String key : keys) {
                try {
                    String json = redisTemplate.opsForValue().get(key);
                    if (json != null) {
                        VcpStateDTO state = objectMapper.readValue(json, VcpStateDTO.class);
                        if (state.isBullishSetup()) {
                            String symbol = extractSymbolFromKey(key);
                            if (symbol != null) {
                                result.add(symbol);
                            }
                        }
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse VCP state: {}", e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Error getting bullish VCP symbols: {}", e.getMessage());
        }

        return result;
    }

    /**
     * Get symbols in uptrend (based on Pivot state).
     */
    public List<String> getSymbolsInUptrend(String timeframe) {
        List<String> result = new ArrayList<>();

        try {
            Set<String> keys = redisTemplate.keys(STRATEGY_PREFIX + "*:PIVOT:" + timeframe);
            if (keys == null) return result;

            for (String key : keys) {
                try {
                    String json = redisTemplate.opsForValue().get(key);
                    if (json != null) {
                        PivotStateDTO state = objectMapper.readValue(json, PivotStateDTO.class);
                        if (state.isUptrend()) {
                            String symbol = extractSymbolFromKey(key);
                            if (symbol != null) {
                                result.add(symbol);
                            }
                        }
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse Pivot state: {}", e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("Error getting uptrend symbols: {}", e.getMessage());
        }

        return result;
    }

    /**
     * Get actionable setups (high IPU + clear structure).
     */
    public List<StrategyStateDTO> getActionableSetups(String timeframe, int limit) {
        List<StrategyStateDTO> result = new ArrayList<>();

        try {
            // Get all symbols with IPU state
            Set<String> keys = redisTemplate.keys(STRATEGY_PREFIX + "*:IPU:" + timeframe);
            if (keys == null) return result;

            for (String key : keys) {
                String symbol = extractSymbolFromKey(key);
                if (symbol == null) continue;

                Optional<StrategyStateDTO> state = getFullState(symbol, timeframe);
                if (state.isPresent() && state.get().isActionable()) {
                    result.add(state.get());
                    if (result.size() >= limit) break;
                }
            }

            // Sort by composite score
            result.sort((a, b) -> {
                Double scoreA = a.getCompositeScore();
                Double scoreB = b.getCompositeScore();
                if (scoreA == null) return 1;
                if (scoreB == null) return -1;
                return Double.compare(scoreB, scoreA);  // Descending
            });

        } catch (Exception e) {
            log.error("Error getting actionable setups: {}", e.getMessage());
        }

        return result;
    }

    /**
     * Get strategy state counts by type.
     */
    public Map<String, Long> getStateCounts(String timeframe) {
        Map<String, Long> counts = new HashMap<>();

        try {
            Set<String> vcpKeys = redisTemplate.keys(STRATEGY_PREFIX + "*:VCP:" + timeframe);
            Set<String> ipuKeys = redisTemplate.keys(STRATEGY_PREFIX + "*:IPU:" + timeframe);
            Set<String> pivotKeys = redisTemplate.keys(STRATEGY_PREFIX + "*:PIVOT:" + timeframe);

            counts.put("vcp", (long) (vcpKeys != null ? vcpKeys.size() : 0));
            counts.put("ipu", (long) (ipuKeys != null ? ipuKeys.size() : 0));
            counts.put("pivot", (long) (pivotKeys != null ? pivotKeys.size() : 0));

            // Count total unique symbols
            Set<String> allSymbols = new HashSet<>();
            if (vcpKeys != null) vcpKeys.forEach(k -> {
                String s = extractSymbolFromKey(k);
                if (s != null) allSymbols.add(s);
            });
            if (ipuKeys != null) ipuKeys.forEach(k -> {
                String s = extractSymbolFromKey(k);
                if (s != null) allSymbols.add(s);
            });
            if (pivotKeys != null) pivotKeys.forEach(k -> {
                String s = extractSymbolFromKey(k);
                if (s != null) allSymbols.add(s);
            });

            counts.put("totalSymbols", (long) allSymbols.size());

        } catch (Exception e) {
            log.error("Error getting state counts: {}", e.getMessage());
        }

        return counts;
    }

    /**
     * Get available symbols with any strategy state.
     */
    public Set<String> getAvailableSymbols(String timeframe) {
        Set<String> symbols = new HashSet<>();

        try {
            Set<String> keys = redisTemplate.keys(STRATEGY_PREFIX + "*:*:" + timeframe);
            if (keys != null) {
                for (String key : keys) {
                    String symbol = extractSymbolFromKey(key);
                    if (symbol != null) {
                        symbols.add(symbol);
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error getting available symbols: {}", e.getMessage());
        }

        return symbols;
    }

    // ==================== HELPER METHODS ====================

    /**
     * Generic method to get state from Redis.
     */
    private <T> Optional<T> getState(String key, Class<T> clazz) {
        try {
            String json = redisTemplate.opsForValue().get(key);
            if (json == null || json.isEmpty()) {
                return Optional.empty();
            }
            return Optional.of(objectMapper.readValue(json, clazz));
        } catch (Exception e) {
            log.error("Error reading state from Redis key {}: {}", key, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Extract symbol from Redis key.
     * Handles patterns:
     * - strategy:{symbol}:VCP:{tf}
     * - vcp:{symbol}:state
     */
    private String extractSymbolFromKey(String key) {
        if (key == null) return null;

        String[] parts = key.split(":");
        if (parts.length >= 2) {
            // For strategy:{symbol}:... or vcp:{symbol}:...
            return parts[1];
        }
        return null;
    }
}
