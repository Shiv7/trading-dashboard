package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.data.ConfluenceTargetsClient;
import com.kotsin.dashboard.hotstocks.data.EquityScripCodeResolver;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.endsWith;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.atMost;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HotStocksPositionOpenerJobTest {

    private HotStocksService service;
    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private RestTemplate rest;
    private EquityScripCodeResolver resolver;
    private ConfluenceTargetsClient confluence;

    @BeforeEach
    void setUp() {
        service = mock(HotStocksService.class);
        redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> opsMock = mock(ValueOperations.class);
        ops = opsMock;
        when(redis.opsForValue()).thenReturn(ops);
        when(ops.get("hotstocks:v1:kill_switch")).thenReturn(null);
        rest = mock(RestTemplate.class);
        resolver = mock(EquityScripCodeResolver.class);
        confluence = mock(ConfluenceTargetsClient.class);

        // Default: resolver returns empty (only F&O picks resolved automatically via metrics).
        when(resolver.resolve(anyString())).thenReturn(java.util.Optional.empty());
        // Default: confluence returns empty → falls back to % staircase.
        when(confluence.computeEquityTargets(anyString(), org.mockito.ArgumentMatchers.anyDouble(),
            org.mockito.ArgumentMatchers.anyBoolean()))
            .thenReturn(java.util.Optional.empty());

        // Slippage endpoint returns sensible defaults for all tests.
        when(rest.postForEntity(endsWith("/api/slippage/estimate"), any(HttpEntity.class), eq(Map.class)))
            .thenReturn(new ResponseEntity<>(Map.of(
                "estimatedEntrySlippage", 0.2,
                "estimatedEntrySlippageTotal", 40.0,
                "estimatedSlippagePct", 0.05,
                "slippageTier", "SPREAD_ONLY"), HttpStatus.OK));
        // Strategy-trade endpoint returns success.
        when(rest.postForEntity(endsWith("/api/strategy-trades"), any(HttpEntity.class), eq(Map.class)))
            .thenReturn(new ResponseEntity<>(Map.of("success", true), HttpStatus.OK));
    }

    private HotStocksPositionOpenerJob newJob() {
        return newJob(6, 2);
    }

    private HotStocksPositionOpenerJob newJob(int fnoCap, int nonFnoCap) {
        HotStocksPositionOpenerJob job = new HotStocksPositionOpenerJob(
            service, redis, rest, resolver, confluence);
        // @Value defaults don't fire without a Spring context — set the caps explicitly.
        org.springframework.test.util.ReflectionTestUtils.setField(job, "maxNewFnoPerDay", fnoCap);
        org.springframework.test.util.ReflectionTestUtils.setField(job, "maxNewNonFnoPerDay", nonFnoCap);
        return job;
    }

    private static StockMetrics fno(String scripCode, String symbol, double ltp) {
        StockMetrics m = new StockMetrics();
        m.setScripCode(scripCode);
        m.setSymbol(symbol);
        m.setLtpYesterday(ltp);
        m.setFnoEligible(true);
        return m;
    }

    @Test
    void opener_stopsAfterMaxNewPerDay_evenIfMoreRanked() {
        List<StockMetrics> ranked = new ArrayList<>();
        // 10 candidates; only first 6 should open.
        for (int i = 0; i < 10; i++) {
            ranked.add(fno(String.valueOf(1000 + i), "S" + i, 500.0 + i));
        }
        when(service.loadRankedList()).thenReturn(ranked);
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(new HashSet<>());
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);

        HotStocksPositionOpenerJob job = newJob();
        job.openPositions();

        // MAX_NEW_PER_DAY=6 → 6 POSTs to /api/strategy-trades.
        verify(rest, times(6)).postForEntity(endsWith("/api/strategy-trades"), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void opener_skipsAllWhenConcurrentAtMax() {
        // Fake 50 existing HOTSTOCKS positions in Redis.
        Set<String> existingKeys = new HashSet<>();
        for (int i = 0; i < 50; i++) {
            existingKeys.add("virtual:positions:" + (2000 + i));
        }
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(existingKeys);
        // Each key returns HOTSTOCKS active position JSON.
        when(ops.get(startsWith("virtual:positions:"))).thenAnswer(inv -> {
            String key = inv.getArgument(0);
            if (existingKeys.contains(key)) {
                return "{\"signalSource\":\"HOTSTOCKS\",\"status\":\"OPEN\",\"qtyOpen\":100}";
            }
            return null;
        });

        // New ranked list with 6 more candidates.
        List<StockMetrics> ranked = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            ranked.add(fno(String.valueOf(3000 + i), "N" + i, 500.0));
        }
        when(service.loadRankedList()).thenReturn(ranked);

        HotStocksPositionOpenerJob job = newJob();
        job.openPositions();

        // Already at 50 concurrent; zero new POSTs.
        verify(rest, times(0)).postForEntity(endsWith("/api/strategy-trades"), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void opener_opensOnlyUpToMaxConcurrentWhenPartiallyFull() {
        // 48 existing HOTSTOCKS positions. Cap=50. Should open exactly 2 new, even though 6 ranked.
        Set<String> existingKeys = new HashSet<>();
        for (int i = 0; i < 48; i++) {
            existingKeys.add("virtual:positions:" + (2000 + i));
        }
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(existingKeys);
        when(ops.get(startsWith("virtual:positions:"))).thenAnswer(inv -> {
            String key = inv.getArgument(0);
            if (existingKeys.contains(key)) {
                return "{\"signalSource\":\"HOTSTOCKS\",\"status\":\"OPEN\",\"qtyOpen\":100}";
            }
            return null;
        });

        List<StockMetrics> ranked = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            ranked.add(fno(String.valueOf(3000 + i), "N" + i, 500.0));
        }
        when(service.loadRankedList()).thenReturn(ranked);

        HotStocksPositionOpenerJob job = newJob();
        job.openPositions();

        // 48 already + room for 2 more = 2 new POSTs.
        verify(rest, times(2)).postForEntity(endsWith("/api/strategy-trades"), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void opener_populatesT2T3T4AndPartialExitsInPayload() {
        StockMetrics m = fno("4684", "SONACOMS", 500.0);
        when(service.loadRankedList()).thenReturn(List.of(m));
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(new HashSet<>());
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);

        HotStocksPositionOpenerJob job = newJob();
        job.openPositions();

        // Capture the /api/strategy-trades payload.
        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<HttpEntity<Map<String, Object>>> captor =
            org.mockito.ArgumentCaptor.forClass(HttpEntity.class);
        verify(rest).postForEntity(endsWith("/api/strategy-trades"), captor.capture(), eq(Map.class));
        Map<String, Object> payload = captor.getValue().getBody();
        assertNotNull(payload);

        // Staircase: +2 / +5 / +8 / +12% (tuned from 2026-04-15 backtest — picks grind, don't breakout)
        // T1 = 500 * 1.02 = 510
        assertEquals(510.0, ((Number) payload.get("t1")).doubleValue(), 0.001);
        // T2 = 500 * 1.05 = 525
        assertEquals(525.0, ((Number) payload.get("t2")).doubleValue(), 0.001);
        // T3 = 500 * 1.08 = 540
        assertEquals(540.0, ((Number) payload.get("t3")).doubleValue(), 0.001);
        // T4 = 500 * 1.12 = 560
        assertEquals(560.0, ((Number) payload.get("t4")).doubleValue(), 0.001);

        // partialExits scaffolding present
        Object pe = payload.get("partialExits");
        assertNotNull(pe, "partialExits should be populated");
        assertTrue(pe instanceof List, "partialExits should be a list");
        List<?> peList = (List<?>) pe;
        assertEquals(1, peList.size());
        Map<?, ?> first = (Map<?, ?>) peList.get(0);
        assertEquals("T1", first.get("level"));
        assertEquals(100, first.get("qtyPct"));
    }

    @Test
    void opener_skipsAlreadyHeldScrip() {
        StockMetrics m = fno("4684", "SONACOMS", 500.0);
        when(service.loadRankedList()).thenReturn(List.of(m));
        when(redis.keys(startsWith("virtual:positions:")))
            .thenReturn(new HashSet<>(List.of("virtual:positions:4684")));
        when(ops.get("virtual:positions:4684"))
            .thenReturn("{\"signalSource\":\"HOTSTOCKS\",\"status\":\"OPEN\",\"qtyOpen\":263}");

        HotStocksPositionOpenerJob job = newJob();
        job.openPositions();

        // Already held → no new POST.
        verify(rest, times(0)).postForEntity(endsWith("/api/strategy-trades"), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void countActiveHotStocksPositions_countsOnlyHotStocksWithQtyOpen() {
        Set<String> keys = new HashSet<>(List.of(
            "virtual:positions:1", // HOTSTOCKS open — COUNT
            "virtual:positions:2", // FUDKII open — skip
            "virtual:positions:3", // HOTSTOCKS closed — skip
            "virtual:positions:4", // HOTSTOCKS qtyOpen=0 — skip
            "virtual:positions:5"  // HOTSTOCKS open — COUNT
        ));
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(keys);
        when(ops.get("virtual:positions:1"))
            .thenReturn("{\"signalSource\":\"HOTSTOCKS\",\"status\":\"OPEN\",\"qtyOpen\":100}");
        when(ops.get("virtual:positions:2"))
            .thenReturn("{\"signalSource\":\"FUDKII\",\"status\":\"OPEN\",\"qtyOpen\":100}");
        when(ops.get("virtual:positions:3"))
            .thenReturn("{\"signalSource\":\"HOTSTOCKS\",\"status\":\"CLOSED\",\"qtyOpen\":100}");
        when(ops.get("virtual:positions:4"))
            .thenReturn("{\"signalSource\":\"HOTSTOCKS\",\"status\":\"OPEN\",\"qtyOpen\":0}");
        when(ops.get("virtual:positions:5"))
            .thenReturn("{\"signalSource\":\"HOTSTOCKS\",\"status\":\"OPEN\",\"qtyOpen\":263}");

        HotStocksPositionOpenerJob job = newJob();
        assertEquals(2, job.countActiveHotStocksPositions());
    }

    @Test
    void countActiveHotStocksPositions_returnsZeroOnRedisFailure() {
        when(redis.keys(anyString())).thenThrow(new RuntimeException("connection refused"));
        HotStocksPositionOpenerJob job = newJob();
        assertEquals(0, job.countActiveHotStocksPositions(),
            "on failure, returns 0 (permissive) so the cap check still fires mid-loop");
    }

    // ── Non-F&O equity branch ───────────────────────────────────────────────────

    private static StockMetrics nonFno(String symbol, double ltp) {
        StockMetrics m = new StockMetrics();
        // Non-F&O picks arrive from HotStocksNonFnoScanJob with scripCode=null.
        m.setScripCode(null);
        m.setSymbol(symbol);
        m.setLtpYesterday(ltp);
        m.setFnoEligible(false);
        return m;
    }

    @Test
    void nonFno_skipsWhenScripCodeResolverReturnsEmpty() {
        when(service.loadRankedList()).thenReturn(List.of(nonFno("NOTLISTED", 100.0)));
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(new HashSet<>());
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);
        when(resolver.resolve("NOTLISTED")).thenReturn(java.util.Optional.empty());

        newJob().openPositions();

        // No scripCode → no POST to trade-exec.
        verify(rest, times(0)).postForEntity(endsWith("/api/strategy-trades"), any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void nonFno_usesConfluenceTargetsWhenActionable() {
        StockMetrics m = nonFno("AGIIL", 100.0);
        when(service.loadRankedList()).thenReturn(List.of(m));
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(new HashSet<>());
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);

        when(resolver.resolve("AGIIL")).thenReturn(java.util.Optional.of("24445"));
        ConfluenceTargetsClient.EquityTargets targets = new ConfluenceTargetsClient.EquityTargets(
            /*sl*/ 95.0, /*t1*/ 102.0, /*t2*/ 105.0, /*t3*/ 108.0, /*t4*/ 112.0,
            /*rr*/ 2.4, /*atr*/ 1.5, "A", null,
            /*pivotSource*/ true, /*zones*/ 14, /*fortress*/ 18.0, /*roomRatio*/ 2.1,
            /*lotAlloc*/ "40,30,20,10");
        when(confluence.computeEquityTargets("24445", 100.0, true))
            .thenReturn(java.util.Optional.of(targets));

        // Capture the payload to trade-exec.
        org.mockito.ArgumentCaptor<HttpEntity<Map<String, Object>>> captor =
            org.mockito.ArgumentCaptor.forClass(HttpEntity.class);
        when(rest.postForEntity(endsWith("/api/strategy-trades"), captor.capture(), eq(Map.class)))
            .thenReturn(new ResponseEntity<>(Map.of("success", true), HttpStatus.OK));

        newJob().openPositions();

        verify(rest, times(1)).postForEntity(endsWith("/api/strategy-trades"),
            any(HttpEntity.class), eq(Map.class));
        Map<String, Object> payload = captor.getValue().getBody();
        assertEquals("24445", payload.get("scripCode"), "resolved non-F&O scripCode");
        assertEquals(false, payload.get("fnoEligible"));
        assertEquals("EQUITY", payload.get("instrumentType"));
        assertEquals("HOTSTOCKS_NONFNO_EQUITY", payload.get("tradeLabel"));
        assertEquals("CONFLUENCE_A", payload.get("targetSource"));
        assertEquals(95.0, ((Number) payload.get("sl")).doubleValue(), 1e-9);
        assertEquals(102.0, ((Number) payload.get("t1")).doubleValue(), 1e-9);
        assertEquals(105.0, ((Number) payload.get("t2")).doubleValue(), 1e-9);
    }

    @Test
    void nonFno_fallsBackToStaircaseWhenConfluenceUnavailable() {
        StockMetrics m = nonFno("OLAELEC", 50.0);
        when(service.loadRankedList()).thenReturn(List.of(m));
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(new HashSet<>());
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);

        when(resolver.resolve("OLAELEC")).thenReturn(java.util.Optional.of("24777"));
        when(confluence.computeEquityTargets("24777", 50.0, true))
            .thenReturn(java.util.Optional.empty()); // confluence offline

        org.mockito.ArgumentCaptor<HttpEntity<Map<String, Object>>> captor =
            org.mockito.ArgumentCaptor.forClass(HttpEntity.class);
        when(rest.postForEntity(endsWith("/api/strategy-trades"), captor.capture(), eq(Map.class)))
            .thenReturn(new ResponseEntity<>(Map.of("success", true), HttpStatus.OK));

        newJob().openPositions();

        verify(rest, times(1)).postForEntity(endsWith("/api/strategy-trades"),
            any(HttpEntity.class), eq(Map.class));
        Map<String, Object> payload = captor.getValue().getBody();
        assertEquals("STAIRCASE_FALLBACK", payload.get("targetSource"));
        // T1 = 2% of 50 = 51, T2 = 5% = 52.5, T3 = 8% = 54, T4 = 12% = 56
        assertEquals(51.0, ((Number) payload.get("t1")).doubleValue(), 1e-9);
        assertEquals(52.5, ((Number) payload.get("t2")).doubleValue(), 1e-9);
        assertEquals("HOTSTOCKS_NONFNO_EQUITY", payload.get("tradeLabel"));
    }

    @Test
    void split_nonFnoGetsSlotEvenWhenFnoOverflows() {
        // Ranked: 10 F&O first, then 3 non-F&O. With caps fno=6 nonFno=2, expect 8 opens (6+2).
        // Before the split, F&O would have consumed the whole 6-slot budget and non-F&O
        // would never see a slot — the regression this test exists to prevent.
        List<StockMetrics> ranked = new ArrayList<>();
        for (int i = 0; i < 10; i++) ranked.add(fno(String.valueOf(1000 + i), "F" + i, 500.0));
        for (int i = 0; i < 3; i++) ranked.add(nonFno("NF" + i, 100.0));

        when(service.loadRankedList()).thenReturn(ranked);
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(new HashSet<>());
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);
        // Resolver returns distinct scripCodes for non-F&O symbols so each passes dedup.
        when(resolver.resolve("NF0")).thenReturn(java.util.Optional.of("50000"));
        when(resolver.resolve("NF1")).thenReturn(java.util.Optional.of("50001"));
        when(resolver.resolve("NF2")).thenReturn(java.util.Optional.of("50002"));

        newJob(6, 2).openPositions();

        // 6 F&O + 2 non-F&O = 8 total POSTs.
        verify(rest, times(8)).postForEntity(endsWith("/api/strategy-trades"),
            any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void split_nonFnoCapZeroDisablesNonFno() {
        // Kill-switch path: setting non-F&O cap to 0 stops non-F&O opens entirely.
        List<StockMetrics> ranked = new ArrayList<>();
        ranked.add(fno("1000", "F0", 500.0));
        ranked.add(nonFno("NF0", 100.0));

        when(service.loadRankedList()).thenReturn(ranked);
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(new HashSet<>());
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);
        when(resolver.resolve("NF0")).thenReturn(java.util.Optional.of("50000"));

        newJob(6, 0).openPositions();

        // Only the F&O pick opens; non-F&O blocked by nonFno=0 budget.
        verify(rest, times(1)).postForEntity(endsWith("/api/strategy-trades"),
            any(HttpEntity.class), eq(Map.class));
    }

    @Test
    void fnoEligible_alwaysUsesStaircaseEvenIfConfluenceAvailable() {
        // F&O picks never hit the confluence client — their SL/targets come from the opener's
        // hardcoded % staircase tuned from the Apr-15 backtest.
        StockMetrics m = fno("4684", "SONACOMS", 500.0);
        when(service.loadRankedList()).thenReturn(List.of(m));
        when(redis.keys(startsWith("virtual:positions:"))).thenReturn(new HashSet<>());
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);

        newJob().openPositions();

        verify(confluence, times(0)).computeEquityTargets(anyString(),
            org.mockito.ArgumentMatchers.anyDouble(), org.mockito.ArgumentMatchers.anyBoolean());
    }
}
