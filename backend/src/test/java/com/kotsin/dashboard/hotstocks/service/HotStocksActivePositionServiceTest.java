package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.dto.HotStocksActivePosition;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class HotStocksActivePositionServiceTest {

    @Mock
    private RestTemplate restTemplate;

    private HotStocksActivePositionService svc;

    @BeforeEach
    void setUp() {
        svc = new HotStocksActivePositionService(restTemplate);
        ReflectionTestUtils.setField(svc, "baseUrl", "http://localhost:8089");
    }

    @Test
    void listActive_callsTradeExecWithHotStocksFilter_andMapsResponse() {
        Map<String, Object> pos = new HashMap<>();
        pos.put("scripCode", "500325");
        pos.put("instrumentSymbol", "RELIANCE");
        pos.put("exchange", "N");
        pos.put("futScripCode", "500325F");
        pos.put("side", "LONG");
        pos.put("avgEntry", 2450.50);
        pos.put("qtyOpen", 60);
        pos.put("sl", 2400.0);
        pos.put("t1", 2500.0);
        pos.put("t2", 2550.0);
        pos.put("t3", 2600.0);
        pos.put("t4", 2650.0);
        pos.put("t1Hit", false);
        pos.put("t2Hit", false);
        pos.put("t3Hit", false);
        pos.put("t4Hit", false);
        pos.put("openedAt", "2026-04-16T09:15:00Z");

        ArgumentCaptor<String> urlCaptor = ArgumentCaptor.forClass(String.class);

        when(restTemplate.exchange(
            urlCaptor.capture(),
            eq(HttpMethod.GET),
            isNull(),
            any(ParameterizedTypeReference.class)
        )).thenReturn(ResponseEntity.ok(List.of(pos)));

        List<HotStocksActivePosition> result = svc.listActive();

        assertTrue(urlCaptor.getValue().contains("strategy=HOTSTOCKS"));
        assertEquals(1, result.size());
        HotStocksActivePosition p = result.get(0);
        assertEquals("500325", p.scripCode());
        assertEquals("RELIANCE", p.symbol());
        assertEquals(2450.50, p.avgEntry(), 0.001);
        assertEquals(60, p.qtyOpen());
        assertEquals("500325F", p.futScripCode());
        assertEquals(Instant.parse("2026-04-16T09:15:00Z"), p.openedAt());
    }

    @Test
    void listActive_returnsEmptyWhenUpstream4xx() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), isNull(), any(ParameterizedTypeReference.class)))
            .thenThrow(new HttpClientErrorException(HttpStatus.NOT_FOUND));

        List<HotStocksActivePosition> result = svc.listActive();

        assertTrue(result.isEmpty());
    }

    @Test
    void listActive_returnsEmptyWhenUpstream5xx() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), isNull(), any(ParameterizedTypeReference.class)))
            .thenThrow(new HttpServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR));

        List<HotStocksActivePosition> result = svc.listActive();

        assertTrue(result.isEmpty());
    }

    @Test
    void listActive_returnsEmptyOnRestTemplateException() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), isNull(), any(ParameterizedTypeReference.class)))
            .thenThrow(new ResourceAccessException("connection refused"));

        List<HotStocksActivePosition> result = svc.listActive();

        assertTrue(result.isEmpty());
    }

    @Test
    void listActive_filtersOutZeroQtyOpenDefensively() {
        Map<String, Object> active = new HashMap<>();
        active.put("scripCode", "500325");
        active.put("instrumentSymbol", "RELIANCE");
        active.put("exchange", "N");
        active.put("side", "LONG");
        active.put("avgEntry", 2450.0);
        active.put("qtyOpen", 60);
        active.put("sl", 2400.0);
        active.put("t1", 2500.0);
        active.put("t2", 2550.0);
        active.put("t3", 2600.0);
        active.put("t4", 2650.0);
        active.put("openedAt", "2026-04-16T09:15:00Z");

        Map<String, Object> closed = new HashMap<>();
        closed.put("scripCode", "532454");
        closed.put("instrumentSymbol", "INFY");
        closed.put("exchange", "N");
        closed.put("side", "LONG");
        closed.put("avgEntry", 1500.0);
        closed.put("qtyOpen", 0);
        closed.put("sl", 1450.0);
        closed.put("t1", 1550.0);
        closed.put("t2", 1600.0);
        closed.put("t3", 1650.0);
        closed.put("t4", 1700.0);

        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), isNull(), any(ParameterizedTypeReference.class)))
            .thenReturn(ResponseEntity.ok(List.of(active, closed)));

        List<HotStocksActivePosition> result = svc.listActive();

        assertEquals(1, result.size());
        assertEquals("500325", result.get(0).scripCode());
    }

    @Test
    void listActive_returnsEmptyWhenBodyNull() {
        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), isNull(), any(ParameterizedTypeReference.class)))
            .thenReturn(ResponseEntity.ok(null));

        List<HotStocksActivePosition> result = svc.listActive();

        assertTrue(result.isEmpty());
    }

    @Test
    void listActive_handlesOpenedAtAsEpochMillisNumber() {
        long epochMillis = 1744794900000L; // 2026-04-16T09:15:00Z
        Map<String, Object> pos = new HashMap<>();
        pos.put("scripCode", "500325");
        pos.put("instrumentSymbol", "RELIANCE");
        pos.put("exchange", "N");
        pos.put("side", "LONG");
        pos.put("avgEntry", 2450.0);
        pos.put("qtyOpen", 30);
        pos.put("sl", 2400.0);
        pos.put("t1", 2500.0);
        pos.put("t2", 2550.0);
        pos.put("t3", 2600.0);
        pos.put("t4", 2650.0);
        pos.put("openedAt", epochMillis);  // Long number, not ISO string

        when(restTemplate.exchange(anyString(), eq(HttpMethod.GET), isNull(), any(ParameterizedTypeReference.class)))
            .thenReturn(ResponseEntity.ok(List.of(pos)));

        List<HotStocksActivePosition> result = svc.listActive();

        assertEquals(1, result.size());
        assertEquals(Instant.ofEpochMilli(epochMillis), result.get(0).openedAt());
    }
}
