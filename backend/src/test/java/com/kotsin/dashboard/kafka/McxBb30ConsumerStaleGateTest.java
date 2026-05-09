package com.kotsin.dashboard.kafka;

import com.kotsin.dashboard.model.entity.McxBb30SignalEntity;
import com.kotsin.dashboard.repository.McxBb30SignalRepository;
import com.kotsin.dashboard.service.ScripLookupService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies the 2026-05-01 fixes wired into McxBb30Consumer:
 *
 * Fix 4 — stale-message rejection: messages older than maxMessageAgeMinutes
 *         are dropped before any processing (caches, repo, WebSocket).
 * Fix 2 — Mongo persistence: fresh messages are saved exactly once even on
 *         duplicate Kafka delivery (dedupKey index + findByDedupKey guard).
 *
 * Tests use ReflectionTestUtils.setField rather than @InjectMocks because the
 * consumer takes scalar @Value fields for thresholds/TTLs.
 */
class McxBb30ConsumerStaleGateTest {

    private McxBb30Consumer consumer;
    private WebSocketSessionManager sessionManager;
    private SignalConsumer signalConsumer;
    private ScripLookupService scripLookup;
    private McxBb30SignalRepository signalRepository;

    @BeforeEach
    void setUp() {
        sessionManager = mock(WebSocketSessionManager.class);
        signalConsumer = mock(SignalConsumer.class);
        scripLookup = mock(ScripLookupService.class);
        signalRepository = mock(McxBb30SignalRepository.class);
        when(scripLookup.resolve(anyString(), any())).thenReturn("ZINC");

        consumer = new McxBb30Consumer(sessionManager, signalConsumer, scripLookup, signalRepository);
        ReflectionTestUtils.setField(consumer, "signalTtlMinutes", 30L);
        ReflectionTestUtils.setField(consumer, "maxSignalsPerDay", 10);
        ReflectionTestUtils.setField(consumer, "maxMessageAgeMinutes", 720L);
        consumer.init();
    }

    @Test
    void rejectsMessageOlderThanCap() {
        // 2 days ago — way past 720-minute cap
        long staleTs = System.currentTimeMillis() - 2L * 24 * 3600 * 1000;
        String payload = String.format(
            "{\"scripCode\":\"488794\",\"triggered\":true,\"triggerTime\":\"x\",\"timestamp\":%d," +
            "\"direction\":\"BULLISH\",\"triggerPrice\":342.95,\"surgeT\":1.76," +
            "\"oiChangeRatio\":0.05,\"triggerScore\":16.2,\"bbUpper\":340,\"bbLower\":300," +
            "\"stopLoss\":338,\"target1\":350,\"riskReward\":1.5}", staleTs);

        consumer.onMcxBb30(payload);

        verify(signalRepository, never()).save(any());
        verify(signalConsumer, never()).addExternalSignal(any());
    }

    @Test
    void acceptsFreshMessageAndPersistsExactlyOnce() {
        long freshTs = System.currentTimeMillis() - 60_000L; // 1 minute old
        String payload = String.format(
            "{\"scripCode\":\"488505\",\"triggered\":true,\"triggerTime\":\"2026-05-01T13:00\",\"timestamp\":%d," +
            "\"direction\":\"BEARISH\",\"triggerPrice\":251.8,\"surgeT\":2.6," +
            "\"oiChangeRatio\":0.05,\"triggerScore\":36.56,\"bbUpper\":260,\"bbLower\":250," +
            "\"stopLoss\":253,\"target1\":248,\"riskReward\":1.5}", freshTs);

        // Empty repo on first lookup → save proceeds
        when(signalRepository.findByDedupKey("488505|2026-05-01T13:00")).thenReturn(Optional.empty());

        consumer.onMcxBb30(payload);

        verify(signalRepository, times(1)).save(any(McxBb30SignalEntity.class));
        verify(signalConsumer, times(1)).addExternalSignal(any());
    }

    @Test
    void duplicateMessageDoesNotPersistTwice() {
        long freshTs = System.currentTimeMillis() - 60_000L;
        String payload = String.format(
            "{\"scripCode\":\"488505\",\"triggered\":true,\"triggerTime\":\"2026-05-01T13:00\",\"timestamp\":%d," +
            "\"direction\":\"BEARISH\",\"triggerPrice\":251.8,\"surgeT\":2.6," +
            "\"oiChangeRatio\":0.05,\"triggerScore\":36.56,\"bbUpper\":260,\"bbLower\":250," +
            "\"stopLoss\":253,\"target1\":248,\"riskReward\":1.5}", freshTs);

        // First call: empty repo → save. Second call: Caffeine dedupCache short-circuits
        // before hitting repo at all. We assert save called exactly once across both.
        when(signalRepository.findByDedupKey("488505|2026-05-01T13:00")).thenReturn(Optional.empty());

        consumer.onMcxBb30(payload);
        consumer.onMcxBb30(payload);

        verify(signalRepository, times(1)).save(any(McxBb30SignalEntity.class));
    }

    @Test
    void killSwitchZeroDisablesStaleGate() {
        // maxMessageAgeMinutes=0 should disable the gate; even a 2-day-old message passes
        ReflectionTestUtils.setField(consumer, "maxMessageAgeMinutes", 0L);
        long staleTs = System.currentTimeMillis() - 2L * 24 * 3600 * 1000;
        String payload = String.format(
            "{\"scripCode\":\"488794\",\"triggered\":true,\"triggerTime\":\"old\",\"timestamp\":%d," +
            "\"direction\":\"BULLISH\",\"triggerPrice\":342.95,\"surgeT\":1.76," +
            "\"oiChangeRatio\":0.05,\"triggerScore\":16.2,\"bbUpper\":340,\"bbLower\":300," +
            "\"stopLoss\":338,\"target1\":350,\"riskReward\":1.5}", staleTs);
        when(signalRepository.findByDedupKey(anyString())).thenReturn(Optional.empty());

        consumer.onMcxBb30(payload);

        verify(signalConsumer, times(1)).addExternalSignal(any());
    }
}
