package com.kotsin.dashboard.hotstocks.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Tests the merge behaviour of {@link HotStocksService#loadRankedList()} after the
 * 2026-04-23 non-F&O-wiring fix. Previously only the F&O universe was returned and
 * non-F&O picks were silently lost; now both keys are read and merged by v2Score.
 */
class HotStocksServiceMergeTest {

    private HotStocksService service;
    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        // Only redis is needed for loadRankedList / cacheNonFnoRankedList —
        // all other collaborators go unused and we pass null to keep the test minimal.
        service = new HotStocksService(
            null, null, null, null, null, null, null, null, null, null, redis);
    }

    private String json(List<StockMetrics> list) {
        try { return new ObjectMapper().writeValueAsString(list); }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    private StockMetrics sm(String scripCode, String sym, int score, boolean fno) {
        StockMetrics m = new StockMetrics();
        m.setScripCode(scripCode);
        m.setSymbol(sym);
        m.setV2Score(score);
        m.setFnoEligible(fno);
        m.setLtpYesterday(100.0);
        return m;
    }

    @Test
    void mergesFnoAndNonFno_sortedByScoreDesc() {
        List<StockMetrics> fno = List.of(
            sm("11630", "NTPC", 60, true),
            sm("438",   "BHEL", 56, true),
            sm("9552",  "RVNL", 55, true));
        List<StockMetrics> nonFno = List.of(
            sm("ONESOURCE_SC", "ONESOURCE", 49, false),
            sm("BLACKBUCK_SC", "BLACKBUCK", 40, false));
        when(ops.get("hotstocks:v1:universe")).thenReturn(json(fno));
        when(ops.get("hotstocks:v1:universe:nonfno")).thenReturn(json(nonFno));

        List<StockMetrics> merged = service.loadRankedList();

        assertEquals(5, merged.size());
        assertEquals("NTPC",      merged.get(0).getSymbol());   // 60
        assertEquals("BHEL",      merged.get(1).getSymbol());   // 56
        assertEquals("RVNL",      merged.get(2).getSymbol());   // 55
        assertEquals("ONESOURCE", merged.get(3).getSymbol());   // 49 (non-F&O ranks in)
        assertEquals("BLACKBUCK", merged.get(4).getSymbol());   // 40
    }

    @Test
    void emptyNonFno_returnsFnoOnly() {
        List<StockMetrics> fno = List.of(sm("11630", "NTPC", 60, true));
        when(ops.get("hotstocks:v1:universe")).thenReturn(json(fno));
        when(ops.get("hotstocks:v1:universe:nonfno")).thenReturn(null);
        assertEquals(1, service.loadRankedList().size());
    }

    @Test
    void emptyFno_returnsNonFnoOnly() {
        List<StockMetrics> nonFno = List.of(sm("X", "XYZ", 45, false));
        when(ops.get("hotstocks:v1:universe")).thenReturn(null);
        when(ops.get("hotstocks:v1:universe:nonfno")).thenReturn(json(nonFno));
        List<StockMetrics> merged = service.loadRankedList();
        assertEquals(1, merged.size());
        assertEquals("XYZ", merged.get(0).getSymbol());
    }

    @Test
    void bothEmpty_returnsEmptyList() {
        when(ops.get(anyString())).thenReturn(null);
        assertTrue(service.loadRankedList().isEmpty());
    }

    @Test
    void cacheNonFnoRankedList_writesToSiblingKey() {
        List<StockMetrics> list = List.of(sm("X", "XYZ", 45, false));
        service.cacheNonFnoRankedList(list);
        verify(ops).set(eq("hotstocks:v1:universe:nonfno"), anyString(), any());
    }
}
