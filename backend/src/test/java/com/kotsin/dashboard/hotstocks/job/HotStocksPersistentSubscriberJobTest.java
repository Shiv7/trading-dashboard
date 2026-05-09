package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.never;

/**
 * Unit tests for the 09:00 IST HOTSTOCKS persistent subscriber added 2026-05-07.
 *
 * <p>Verifies:
 *   <ul>
 *     <li>Empty ranked list short-circuits without subscribe calls.</li>
 *     <li>Top-N truncation respects {@code hotstocks.persistent.subscription.top.n}.</li>
 *     <li>Kill switch disables the cron entirely.</li>
 *     <li>Last-subscribed Set is read + updated each run.</li>
 *   </ul>
 * </p>
 *
 * <p>Real HTTP calls to OptionProducer are not exercised — those would require an
 * integration test harness. The class's other methods (prioritySubscribe / unsubscribeBase)
 * fail-soft via try/catch so a unit test for "empty ranked list" / "kill switch" /
 * "registry read" covers the meaningful branches.</p>
 */
class HotStocksPersistentSubscriberJobTest {

    private HotStocksService service;
    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private HotStocksPersistentSubscriberJob job;

    @BeforeEach
    void setUp() {
        service = mock(HotStocksService.class);
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);

        job = new HotStocksPersistentSubscriberJob(service, redis);
        ReflectionTestUtils.setField(job, "enabled", true);
        ReflectionTestUtils.setField(job, "topN", 8);
        ReflectionTestUtils.setField(job, "optionProducerBaseUrl",
                "http://localhost:8208");
    }

    @Test
    void emptyRankedListShortCircuits() {
        when(service.loadRankedList()).thenReturn(new ArrayList<>());

        job.runForTest();

        // Should never read last-subscribed when ranked list is empty.
        verify(ops, never()).get(eq("persistent:sub:HOTSTOCKS:lastSubscribed"));
    }

    @Test
    void killSwitchDisabledShortCircuits() {
        ReflectionTestUtils.setField(job, "enabled", false);

        job.runForTest();

        // Should never call service when kill switch is off.
        verify(service, never()).loadRankedList();
    }

    @Test
    void readsLastSubscribedRegistryWhenRanked() {
        List<StockMetrics> picks = mockPicks(8);
        when(service.loadRankedList()).thenReturn(picks);
        when(ops.get("persistent:sub:HOTSTOCKS:lastSubscribed")).thenReturn(null);

        job.runForTest();

        // Reads the registry exactly once per run.
        verify(ops).get(eq("persistent:sub:HOTSTOCKS:lastSubscribed"));
    }

    @Test
    void writesLastSubscribedRegistryAfterSubscribe() {
        List<StockMetrics> picks = mockPicks(3);
        when(service.loadRankedList()).thenReturn(picks);
        when(ops.get("persistent:sub:HOTSTOCKS:lastSubscribed")).thenReturn(null);

        job.runForTest();

        // The .set() to lastSubscribed should fire exactly once with the JSON of target codes.
        // (Subscribe HTTP calls fail-soft inside the helper; that doesn't block the registry write.)
        org.mockito.ArgumentCaptor<String> keyCap = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.ArgumentCaptor<String> valCap = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(ops).set(keyCap.capture(), valCap.capture());
        assertNotNull(valCap.getValue(), "lastSubscribed JSON value should not be null");
    }

    @Test
    void cronExpressionFiresAt0901IST() throws Exception {
        // Reflectively inspect the @Scheduled annotation to assert we moved the cron
        // off the 09:00 IST WebSocket reconnect window. Earlier value "0 0 9 * * MON-FRI"
        // collided with 5paisa's pre-open → open WS cycle and lost all 8 subscribes
        // on 2026-05-08; the fix is "0 1 9 * * MON-FRI".
        java.lang.reflect.Method runMethod = HotStocksPersistentSubscriberJob.class.getMethod("run");
        org.springframework.scheduling.annotation.Scheduled sched =
                runMethod.getAnnotation(org.springframework.scheduling.annotation.Scheduled.class);
        assertNotNull(sched, "@Scheduled annotation must be present on run()");
        org.junit.jupiter.api.Assertions.assertEquals("0 1 9 * * MON-FRI", sched.cron(),
                "cron must be 09:01 IST to dodge the 09:00 IST 5paisa WS reconnect window");
        org.junit.jupiter.api.Assertions.assertEquals("Asia/Kolkata", sched.zone(),
                "cron must run in IST");
    }

    @Test
    void retryConstantsAreThreeAttemptsWithFiveSecondBackoff() {
        // Asserts the retry budget. If you tighten or extend this, also update the test
        // — the constants are guard-rails so a future refactor doesn't accidentally
        // disable the WS-reconnect-window survival path.
        int maxAttempts = (int) ReflectionTestUtils.getField(
                HotStocksPersistentSubscriberJob.class, "PRIORITY_SUBSCRIBE_MAX_ATTEMPTS");
        long backoffMs = (long) ReflectionTestUtils.getField(
                HotStocksPersistentSubscriberJob.class, "PRIORITY_SUBSCRIBE_BACKOFF_MS");
        org.junit.jupiter.api.Assertions.assertEquals(3, maxAttempts,
                "must be 3 attempts to survive a single 5paisa reconnect cycle");
        org.junit.jupiter.api.Assertions.assertEquals(5000L, backoffMs,
                "must be 5s backoff so 3 attempts span ~10-15s, longer than typical reconnect");
    }

    @Test
    void honorsTopNCapWhenRankedListLarger() {
        // 20 ranked picks but topN=5 → only first 5 should be in the persisted Set.
        ReflectionTestUtils.setField(job, "topN", 5);
        when(service.loadRankedList()).thenReturn(mockPicks(20));
        when(ops.get("persistent:sub:HOTSTOCKS:lastSubscribed")).thenReturn(null);

        job.runForTest();

        org.mockito.ArgumentCaptor<String> valCap = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(ops).set(eq("persistent:sub:HOTSTOCKS:lastSubscribed"), valCap.capture());
        // The persisted JSON must contain exactly 5 codes.
        String json = valCap.getValue();
        long codeCount = json.chars().filter(ch -> ch == ',').count() + 1;
        org.junit.jupiter.api.Assertions.assertEquals(5, codeCount,
                "topN=5 must cap the persisted set; got JSON: " + json);
    }

    private List<StockMetrics> mockPicks(int n) {
        List<StockMetrics> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            StockMetrics m = new StockMetrics();
            m.setScripCode(String.valueOf(10000 + i));
            m.setSymbol("PICK" + i);
            out.add(m);
        }
        return out;
    }
}
