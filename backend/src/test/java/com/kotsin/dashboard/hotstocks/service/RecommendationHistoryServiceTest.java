package com.kotsin.dashboard.hotstocks.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RecommendationHistoryServiceTest {

    private StringRedisTemplate redis;
    @SuppressWarnings("unchecked")
    private ListOperations<String, String> listOps;
    private RecommendationHistoryService svc;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redis = mock(StringRedisTemplate.class);
        listOps = (ListOperations<String, String>) mock(ListOperations.class);
        when(redis.opsForList()).thenReturn(listOps);
        svc = new RecommendationHistoryService(redis);
    }

    @Test
    void record_pushesDate_trimsToLast10_setsTTL15d() {
        LocalDate date = LocalDate.of(2026, 4, 15);
        String scripCode = "500325";
        String key = "hotstocks:v1:recommendation_history:" + scripCode;

        svc.record(scripCode, date);

        verify(listOps).leftPush(eq(key), eq("2026-04-15"));
        verify(listOps).trim(eq(key), eq(0L), eq(9L));
        verify(redis).expire(eq(key), eq(Duration.ofDays(15)));
    }

    @Test
    void countInLastNDays_countsOnlyEntriesWithinCutoff() {
        String scripCode = "500325";
        LocalDate today = LocalDate.now();
        // 3 entries within last 10 days, 2 older
        List<String> entries = Arrays.asList(
            today.toString(),
            today.minusDays(3).toString(),
            today.minusDays(9).toString(),   // inclusive boundary (cutoff = today-9)
            today.minusDays(10).toString(),  // outside
            today.minusDays(30).toString()   // outside
        );
        when(listOps.range(eq("hotstocks:v1:recommendation_history:" + scripCode), eq(0L), eq(-1L)))
            .thenReturn(entries);

        int count = svc.countInLastNDays(scripCode, 10);

        assertEquals(3, count);
    }

    @Test
    void countInLastNDays_returnsZeroOnRedisFailure() {
        when(listOps.range(any(), anyLong(), anyLong()))
            .thenThrow(new RuntimeException("redis down"));

        assertEquals(0, svc.countInLastNDays("500325", 10));
    }

    @Test
    void countInLastNDays_returnsZeroWhenListEmpty() {
        when(listOps.range(any(), anyLong(), anyLong())).thenReturn(null);

        assertEquals(0, svc.countInLastNDays("500325", 10));
    }
}
