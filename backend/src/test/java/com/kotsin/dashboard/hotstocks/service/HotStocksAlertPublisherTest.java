package com.kotsin.dashboard.hotstocks.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HotStocksAlertPublisherTest {

    private StringRedisTemplate redis;
    @SuppressWarnings("unchecked")
    private ListOperations<String, String> listOps;
    private HotStocksAlertPublisher publisher;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redis = mock(StringRedisTemplate.class);
        listOps = (ListOperations<String, String>) mock(ListOperations.class);
        when(redis.opsForList()).thenReturn(listOps);
        publisher = new HotStocksAlertPublisher(redis);
    }

    @Test
    void publish_writesJsonPayload_andSets24hTtl() {
        publisher.publishInsufficientFunds(12345.67, 98765.43);

        ArgumentCaptor<String> payloadCap = ArgumentCaptor.forClass(String.class);
        verify(listOps).leftPush(eq("dashboard:alerts:hotstocks"), payloadCap.capture());
        String payload = payloadCap.getValue();

        assertTrue(payload.contains("\"type\":\"INSUFFICIENT_FUNDS_NEXT_SESSION\""), payload);
        assertTrue(payload.contains("\"strategy\":\"HOTSTOCKS\""), payload);
        assertTrue(payload.contains("\"freeBalance\":12345.67"), payload);
        assertTrue(payload.contains("\"required\":98765.43"), payload);
        assertTrue(payload.contains("\"at\":"), payload);

        verify(redis).expire(eq("dashboard:alerts:hotstocks"), eq(Duration.ofHours(24)));
    }

    @Test
    void publish_swallowsRedisException() {
        when(listOps.leftPush(any(), any())).thenThrow(new RuntimeException("redis down"));

        assertDoesNotThrow(() -> publisher.publishInsufficientFunds(1.0, 2.0));
        // expire must not be reached after leftPush throws
        verify(redis, never()).expire(any(), any(Duration.class));
    }

    @Test
    void readRecent_returnsEmptyListOnRedisFailure() {
        when(listOps.range(any(), anyLong(), anyLong())).thenThrow(new RuntimeException("boom"));

        List<String> out = publisher.readRecent(50);

        assertEquals(List.of(), out);
    }
}
