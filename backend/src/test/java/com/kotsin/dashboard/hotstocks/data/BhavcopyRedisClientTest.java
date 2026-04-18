package com.kotsin.dashboard.hotstocks.data;

import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class BhavcopyRedisClientTest {

    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private BhavcopyRedisClient client;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        client = new BhavcopyRedisClient(redis);
    }

    @Test
    void fetchBySymbol_parsesThreeCandlesOldestFirst() {
        String json = "["
            + "{\"date\":\"2026-04-15\",\"open\":100,\"high\":110,\"low\":95,\"close\":108,\"volume\":12345},"
            + "{\"date\":\"2026-04-16\",\"open\":108,\"high\":115,\"low\":105,\"close\":112,\"volume\":22222},"
            + "{\"date\":\"2026-04-17\",\"open\":112,\"high\":113,\"low\":109,\"close\":110,\"volume\":18900}"
            + "]";
        when(ops.get("nse:bhavcopy:ohlcv:AGIIL")).thenReturn(json);

        List<DailyCandle> candles = client.fetchBySymbol("agiil");

        assertEquals(3, candles.size());
        assertEquals("2026-04-15", candles.get(0).date().toString());
        assertEquals(108.0, candles.get(0).close(), 1e-9);
        assertEquals(22222L, candles.get(1).volume());
        assertEquals("2026-04-17", candles.get(2).date().toString());
    }

    @Test
    void fetchBySymbol_missingKeyReturnsEmpty() {
        when(ops.get(anyString())).thenReturn(null);
        assertTrue(client.fetchBySymbol("NONEXISTENT").isEmpty());
    }

    @Test
    void fetchBySymbol_blankInputReturnsEmpty() {
        assertTrue(client.fetchBySymbol("").isEmpty());
        assertTrue(client.fetchBySymbol(null).isEmpty());
        verifyNoInteractions(ops);
    }

    @Test
    void fetchBySymbol_malformedJsonReturnsEmpty() {
        when(ops.get(anyString())).thenReturn("not-json{{");
        assertTrue(client.fetchBySymbol("BAD").isEmpty());
    }

    @Test
    void fetchBySymbol_missingDateFieldSkipsRow() {
        // One row missing "date" — silently dropped, other rows survive.
        String json = "[{\"date\":\"2026-04-15\",\"open\":100,\"high\":110,\"low\":95,\"close\":108,\"volume\":1},"
                    + "{\"open\":200,\"close\":202,\"volume\":9}]";
        when(ops.get(anyString())).thenReturn(json);
        List<DailyCandle> out = client.fetchBySymbol("X");
        assertEquals(1, out.size());
        assertEquals(108.0, out.get(0).close(), 1e-9);
    }

    @Test
    void fetchBulk_returnsOnlySymbolsWithData() {
        when(ops.get("nse:bhavcopy:ohlcv:A")).thenReturn(
            "[{\"date\":\"2026-04-17\",\"open\":1,\"high\":1,\"low\":1,\"close\":1,\"volume\":1}]");
        when(ops.get("nse:bhavcopy:ohlcv:B")).thenReturn(null);
        when(ops.get("nse:bhavcopy:ohlcv:C")).thenReturn("[]");

        Map<String, List<DailyCandle>> out = client.fetchBulk(List.of("a", "b", "c"));
        assertEquals(1, out.size());
        assertTrue(out.containsKey("A"));
    }

    @Test
    void cachedSymbolCount_parsesIndexKey() {
        when(ops.get("nse:bhavcopy:ohlcv:_index")).thenReturn(
            "{\"symbols\":[\"AAA\",\"BBB\",\"CCC\"],\"dates\":[\"2026-04-17\"],\"days\":1,\"timestamp\":123}");
        assertEquals(3, client.cachedSymbolCount());
    }

    @Test
    void cachedSymbolCount_missingIndexReturnsZero() {
        when(ops.get("nse:bhavcopy:ohlcv:_index")).thenReturn(null);
        assertEquals(0, client.cachedSymbolCount());
    }
}
