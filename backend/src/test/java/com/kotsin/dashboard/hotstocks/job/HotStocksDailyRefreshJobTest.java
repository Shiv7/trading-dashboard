package com.kotsin.dashboard.hotstocks.job;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class HotStocksDailyRefreshJobTest {

    private HotStocksService service;
    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private HotStocksDailyRefreshJob job;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        service = mock(HotStocksService.class);
        redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> opsMock = mock(ValueOperations.class);
        ops = opsMock;
        when(redis.opsForValue()).thenReturn(ops);
        job = new HotStocksDailyRefreshJob(service, redis);
    }

    private String positionJson(String scripCode, String source, String status, int qtyOpen, double entryPrice) {
        return String.format(
            "{\"scripCode\":\"%s\",\"signalSource\":\"%s\",\"status\":\"%s\",\"qtyOpen\":%d,\"entryPrice\":%.2f}",
            scripCode, source, status, qtyOpen, entryPrice);
    }

    private StockMetrics candidate(String scripCode, String symbol) {
        StockMetrics m = new StockMetrics();
        m.setScripCode(scripCode);
        m.setSymbol(symbol);
        return m;
    }

    @Test
    void refresh_updatesLtpAndPnlForActivePosition() throws Exception {
        String scrip = "11111";
        String key = "virtual:positions:" + scrip;
        when(redis.keys("virtual:positions:*")).thenReturn(Set.of(key));
        when(ops.get(key)).thenReturn(positionJson(scrip, "HOTSTOCKS", "OPEN", 100, 500.00));
        when(ops.get("ltp:" + scrip)).thenReturn("510.50");
        when(service.loadRankedList()).thenReturn(List.of());

        job.refresh();

        ArgumentCaptor<String> valCap = ArgumentCaptor.forClass(String.class);
        verify(ops).set(eq(key), valCap.capture());
        JsonNode written = mapper.readTree(valCap.getValue());
        assertEquals(510.50, written.path("currentPrice").asDouble(), 1e-6);
        // unrealizedPnl = (510.50 - 500.00) * 100 = 1050.00
        assertEquals(1050.00, written.path("unrealizedPnl").asDouble(), 1e-6);
        assertTrue(written.path("lastRefreshAt").asLong() > 0);
        // last-run timestamp written
        verify(ops).set(eq("hotstocks:v1:refresh:last_run"), anyString());
    }

    @Test
    void refresh_skipsPositionOnNullLtp() {
        String scrip = "22222";
        String key = "virtual:positions:" + scrip;
        when(redis.keys("virtual:positions:*")).thenReturn(Set.of(key));
        when(ops.get(key)).thenReturn(positionJson(scrip, "HOTSTOCKS", "OPEN", 50, 200.00));
        when(ops.get("ltp:" + scrip)).thenReturn(null);
        when(service.loadRankedList()).thenReturn(List.of());

        job.refresh();

        // No write-back to the position key
        verify(ops, never()).set(eq(key), anyString());
        // But last-run still written
        verify(ops).set(eq("hotstocks:v1:refresh:last_run"), anyString());
    }

    @Test
    void refresh_fetchesLtpForCandidatesWithoutPositions() {
        // No active positions
        when(redis.keys("virtual:positions:*")).thenReturn(Set.of());
        String candScrip = "33333";
        when(service.loadRankedList()).thenReturn(List.of(candidate(candScrip, "RELIANCE")));
        when(ops.get("ltp:" + candScrip)).thenReturn("2500.00");

        job.refresh();

        // LTP fetched
        verify(ops).get("ltp:" + candScrip);
        // No position write
        verify(ops, never()).set(eq("virtual:positions:" + candScrip), anyString());
        // last-run still written
        verify(ops).set(eq("hotstocks:v1:refresh:last_run"), anyString());
    }

    @Test
    void refresh_writesLastRunTimestamp() {
        when(redis.keys("virtual:positions:*")).thenReturn(Set.of());
        when(service.loadRankedList()).thenReturn(List.of());

        long before = System.currentTimeMillis();
        job.refresh();
        long after = System.currentTimeMillis();

        ArgumentCaptor<String> valCap = ArgumentCaptor.forClass(String.class);
        verify(ops).set(eq("hotstocks:v1:refresh:last_run"), valCap.capture());
        long written = Long.parseLong(valCap.getValue());
        assertTrue(written >= before && written <= after,
            "last_run timestamp " + written + " should be within [" + before + "," + after + "]");
    }
}
