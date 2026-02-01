package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.CreateOrderRequest;
import com.kotsin.dashboard.model.dto.TradingSignalDTO;
import com.kotsin.dashboard.model.dto.TradingSignalDTO.ConfirmationStatus;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * Service for managing trading signals and confirmations.
 */
@Service
@Slf4j
public class TradingSignalService {

    private final RedisTemplate<String, String> redisTemplate;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final TradingModeService tradingModeService;

    @Value("${execution.service.url:http://localhost:8089}")
    private String executionServiceUrl;

    @Value("${signal.confirmation.timeout.seconds:300}")
    private int confirmationTimeoutSeconds;

    @Value("${signal.auto.execute:false}")
    private boolean autoExecuteEnabled;

    private static final String PENDING_SIGNALS_KEY = "dashboard:pending-signals";
    private static final String SIGNAL_HISTORY_KEY = "dashboard:signal-history:";

    // In-memory cache for fast access
    private final ConcurrentHashMap<String, TradingSignalDTO> pendingSignals = new ConcurrentHashMap<>();

    public TradingSignalService(
            @Qualifier("redisTemplate") RedisTemplate<String, String> redisTemplate,
            @Qualifier("executionRestTemplate") RestTemplate restTemplate,
            ObjectMapper objectMapper,
            TradingModeService tradingModeService) {
        this.redisTemplate = redisTemplate;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.tradingModeService = tradingModeService;
    }

    /**
     * Add a new pending signal for user confirmation
     */
    public void addPendingSignal(TradingSignalDTO signal) {
        signal.setConfirmationStatus(ConfirmationStatus.PENDING);
        signal.setReceivedAt(LocalDateTime.now());

        // Store in memory
        pendingSignals.put(signal.getSignalId(), signal);

        // Persist to Redis
        try {
            String json = objectMapper.writeValueAsString(signal);
            redisTemplate.opsForHash().put(PENDING_SIGNALS_KEY, signal.getSignalId(), json);
            redisTemplate.expire(PENDING_SIGNALS_KEY, 1, TimeUnit.HOURS);
        } catch (Exception e) {
            log.error("Failed to persist pending signal: {}", e.getMessage());
        }

        // Auto-execute if enabled and signal meets criteria
        if (autoExecuteEnabled && shouldAutoExecute(signal)) {
            log.info("AUTO_EXECUTE: Signal {} meets criteria, auto-confirming", signal.getSignalId());
            confirmSignal(signal.getSignalId(), "AUTO");
        }

        log.info("PENDING_SIGNAL_ADDED: {} {} score={} RR={}",
                signal.getScripCode(), signal.getDirection(),
                signal.getCompositeScore(),
                signal.getRiskRewardRatio());
    }

    /**
     * Get all pending signals
     */
    public List<TradingSignalDTO> getPendingSignals() {
        // Return from cache, sorted by score
        return pendingSignals.values().stream()
                .filter(s -> s.getConfirmationStatus() == ConfirmationStatus.PENDING)
                .sorted((a, b) -> {
                    Double scoreA = a.getCompositeScore() != null ? a.getCompositeScore() : 0;
                    Double scoreB = b.getCompositeScore() != null ? b.getCompositeScore() : 0;
                    return scoreB.compareTo(scoreA); // Highest score first
                })
                .collect(Collectors.toList());
    }

    /**
     * Get a specific signal by ID
     */
    public Optional<TradingSignalDTO> getSignal(String signalId) {
        return Optional.ofNullable(pendingSignals.get(signalId));
    }

    /**
     * Confirm a signal and execute the order
     */
    public SignalConfirmationResult confirmSignal(String signalId, String confirmedBy) {
        TradingSignalDTO signal = pendingSignals.get(signalId);
        if (signal == null) {
            return SignalConfirmationResult.failed("Signal not found: " + signalId);
        }

        if (signal.getConfirmationStatus() != ConfirmationStatus.PENDING) {
            return SignalConfirmationResult.failed("Signal already processed: " + signal.getConfirmationStatus());
        }

        try {
            // Create order request
            CreateOrderRequest orderRequest = CreateOrderRequest.builder()
                    .scripCode(signal.getScripCode())
                    .side("BULLISH".equals(signal.getDirection()) ? "BUY" : "SELL")
                    .type("MARKET")
                    .qty(1) // Default quantity, can be enhanced
                    .currentPrice(signal.getEntryPrice())
                    .sl(signal.getStopLoss())
                    .tp1(signal.getTarget1())
                    .tp2(signal.getTarget2())
                    .tp1ClosePercent(50.0) // Default 50%
                    .signalId(signalId)
                    .build();

            // Execute order via execution service
            String apiPath = tradingModeService.getApiPathPrefix();
            String url = executionServiceUrl + apiPath + "/orders";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<CreateOrderRequest> entity = new HttpEntity<>(orderRequest, headers);

            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                // Update signal status
                signal.setConfirmationStatus(ConfirmationStatus.EXECUTED);
                signal.setConfirmedAt(LocalDateTime.now());
                signal.setConfirmedBy(confirmedBy);

                Map<String, Object> body = response.getBody();
                if (body != null && body.get("order") != null) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> order = (Map<String, Object>) body.get("order");
                    signal.setExecutionOrderId((String) order.get("id"));
                }

                // Move to history
                moveToHistory(signal);
                pendingSignals.remove(signalId);

                log.info("SIGNAL_CONFIRMED: {} {} orderId={}",
                        signal.getScripCode(), signal.getDirection(), signal.getExecutionOrderId());

                return SignalConfirmationResult.success(signal);
            } else {
                signal.setConfirmationStatus(ConfirmationStatus.PENDING);
                return SignalConfirmationResult.failed("Order execution failed: " + response.getStatusCode());
            }

        } catch (Exception e) {
            log.error("Failed to confirm signal {}: {}", signalId, e.getMessage());
            return SignalConfirmationResult.failed("Execution error: " + e.getMessage());
        }
    }

    /**
     * Reject a signal
     */
    public SignalConfirmationResult rejectSignal(String signalId, String rejectedBy, String reason) {
        TradingSignalDTO signal = pendingSignals.get(signalId);
        if (signal == null) {
            return SignalConfirmationResult.failed("Signal not found: " + signalId);
        }

        signal.setConfirmationStatus(ConfirmationStatus.REJECTED);
        signal.setConfirmedAt(LocalDateTime.now());
        signal.setConfirmedBy(rejectedBy);
        signal.setReason(reason);

        moveToHistory(signal);
        pendingSignals.remove(signalId);

        log.info("SIGNAL_REJECTED: {} {} by {} reason={}",
                signal.getScripCode(), signal.getDirection(), rejectedBy, reason);

        return SignalConfirmationResult.success(signal);
    }

    /**
     * Clean up expired signals (every 30 seconds)
     */
    @Scheduled(fixedRate = 30000)
    public void cleanupExpiredSignals() {
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(confirmationTimeoutSeconds);

        List<String> expiredIds = pendingSignals.entrySet().stream()
                .filter(e -> e.getValue().getReceivedAt() != null &&
                             e.getValue().getReceivedAt().isBefore(cutoff))
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());

        for (String signalId : expiredIds) {
            TradingSignalDTO signal = pendingSignals.get(signalId);
            if (signal != null) {
                signal.setConfirmationStatus(ConfirmationStatus.EXPIRED);
                moveToHistory(signal);
                pendingSignals.remove(signalId);
                log.info("SIGNAL_EXPIRED: {} {} (timeout after {}s)",
                        signal.getScripCode(), signal.getDirection(), confirmationTimeoutSeconds);
            }
        }
    }

    /**
     * Get signal history
     */
    public List<TradingSignalDTO> getSignalHistory(int limit) {
        try {
            Set<String> keys = redisTemplate.keys(SIGNAL_HISTORY_KEY + "*");
            if (keys == null || keys.isEmpty()) return List.of();

            return keys.stream()
                    .map(k -> {
                        try {
                            String json = redisTemplate.opsForValue().get(k);
                            return json != null ? objectMapper.readValue(json, TradingSignalDTO.class) : null;
                        } catch (Exception e) {
                            return null;
                        }
                    })
                    .filter(Objects::nonNull)
                    .sorted((a, b) -> {
                        if (a.getConfirmedAt() == null) return 1;
                        if (b.getConfirmedAt() == null) return -1;
                        return b.getConfirmedAt().compareTo(a.getConfirmedAt());
                    })
                    .limit(limit)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Failed to get signal history: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * Check if signal should be auto-executed
     */
    private boolean shouldAutoExecute(TradingSignalDTO signal) {
        // High-quality signal criteria:
        // 1. Score >= 75
        // 2. Risk/Reward >= 2
        // 3. Active trigger confirmed
        Double score = signal.getCompositeScore();
        Double rr = signal.getRiskRewardRatio();

        return score != null && score >= 75 &&
               rr != null && rr >= 2.0 &&
               Boolean.TRUE.equals(signal.getIsActiveTrigger());
    }

    /**
     * Move signal to history
     */
    private void moveToHistory(TradingSignalDTO signal) {
        try {
            String key = SIGNAL_HISTORY_KEY + signal.getSignalId();
            String json = objectMapper.writeValueAsString(signal);
            redisTemplate.opsForValue().set(key, json, 7, TimeUnit.DAYS);
            redisTemplate.opsForHash().delete(PENDING_SIGNALS_KEY, signal.getSignalId());
        } catch (Exception e) {
            log.error("Failed to move signal to history: {}", e.getMessage());
        }
    }

    /**
     * Result of signal confirmation
     */
    @lombok.Data
    @lombok.Builder
    public static class SignalConfirmationResult {
        private boolean success;
        private String message;
        private TradingSignalDTO signal;

        public static SignalConfirmationResult success(TradingSignalDTO signal) {
            return SignalConfirmationResult.builder()
                    .success(true)
                    .message("Signal processed successfully")
                    .signal(signal)
                    .build();
        }

        public static SignalConfirmationResult failed(String message) {
            return SignalConfirmationResult.builder()
                    .success(false)
                    .message(message)
                    .build();
        }
    }
}
