package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.calendar.NseCalendarHelper;
import com.kotsin.dashboard.hotstocks.data.ConfluenceTargetsClient;
import com.kotsin.dashboard.hotstocks.data.EquityScripCodeResolver;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import com.kotsin.dashboard.hotstocks.service.LiveLtpResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.endsWith;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 2026-05-07 (HOTSTOCKS-4): pre-flight tick freshness gate tests.
 *
 * Verifies the gate at openOne() correctly aborts when:
 *   - trade-tick:{scripCode} key is missing (NO_TICK)
 *   - tick timestamp is stale beyond max age (STALE_TICK)
 * And admits when the tick is fresh.
 */
class HotStocksPreflightGateTest {

    private HotStocksService service;
    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private RestTemplate rest;
    private EquityScripCodeResolver resolver;
    private ConfluenceTargetsClient confluence;
    private NseCalendarHelper calendar;
    private LiveLtpResolver liveLtpResolver;
    private HotStocksPositionOpenerJob job;

    @BeforeEach
    void setUp() {
        service = mock(HotStocksService.class);
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        rest = mock(RestTemplate.class);
        resolver = mock(EquityScripCodeResolver.class);
        confluence = mock(ConfluenceTargetsClient.class);
        calendar = mock(NseCalendarHelper.class);
        liveLtpResolver = mock(LiveLtpResolver.class);

        when(redis.opsForValue()).thenReturn(ops);

        // Slippage stub — the gate runs BEFORE this in openOne, so it's enough to mock null-safely.
        when(rest.postForEntity(endsWith("/api/equity/slippage-estimate"), any(), eq(Map.class)))
            .thenReturn(new ResponseEntity<>(Map.of("estimatedEntrySlippage", 0.0), HttpStatus.OK));
        when(rest.postForEntity(endsWith("/api/strategy-trades"), any(), eq(Map.class)))
            .thenReturn(new ResponseEntity<>(Map.of("success", true), HttpStatus.OK));

        // Confluence — return empty so we always fall to staircase fallback (deterministic targets).
        when(confluence.computeEquityTargets(any(), any(Double.class), any(Boolean.class)))
            .thenReturn(Optional.empty());

        job = new HotStocksPositionOpenerJob(service, redis, rest, resolver, confluence, calendar, liveLtpResolver);
        ReflectionTestUtils.setField(job, "maxNewFnoPerDay", 6);
        ReflectionTestUtils.setField(job, "maxNewNonFnoPerDay", 2);
        ReflectionTestUtils.setField(job, "preflightTickFreshnessEnabled", true);
        ReflectionTestUtils.setField(job, "preflightTickMaxAgeMs", 60000L);
    }

    @Test
    void preflight_abortsWhenTradeTickMissing() {
        when(ops.get("trade-tick:12345")).thenReturn(null);

        StockMetrics m = newMetrics("12345", "TESTSYM");
        IllegalStateException ex = assertThrows(IllegalStateException.class,
            () -> job.openOne(m, "12345", 100.0, 10000.0, "VWAP_0915"));
        assertTrue(ex.getMessage().contains("pre-flight"),
            "exception must mention pre-flight; got: " + ex.getMessage());
        // No /api/strategy-trades call — opener bailed out before HTTP fire.
        verify(rest, never()).postForEntity(endsWith("/api/strategy-trades"), any(), eq(Map.class));
    }

    @Test
    void preflight_abortsWhenTickIsStale() {
        // Tick timestamp 5 minutes ago — well beyond 60s threshold.
        long staleMs = System.currentTimeMillis() - (5 * 60_000L);
        when(ops.get("trade-tick:12345")).thenReturn(String.valueOf(staleMs));

        StockMetrics m = newMetrics("12345", "TESTSYM");
        IllegalStateException ex = assertThrows(IllegalStateException.class,
            () -> job.openOne(m, "12345", 100.0, 10000.0, "VWAP_0915"));
        assertTrue(ex.getMessage().contains("pre-flight"));
        verify(rest, never()).postForEntity(endsWith("/api/strategy-trades"), any(), eq(Map.class));
    }

    @Test
    void preflight_admitsWhenTickIsFresh() {
        // Tick timestamp 5 seconds ago — well under 60s threshold.
        long freshMs = System.currentTimeMillis() - 5_000L;
        when(ops.get("trade-tick:12345")).thenReturn(String.valueOf(freshMs));

        StockMetrics m = newMetrics("12345", "TESTSYM");
        // Should NOT throw — gate admits, position open proceeds (will throw later for other
        // reasons in this minimal mock setup, but NOT pre-flight). Use try/catch to verify.
        try {
            job.openOne(m, "12345", 100.0, 10000.0, "VWAP_0915");
        } catch (IllegalStateException ise) {
            assertTrue(!ise.getMessage().contains("pre-flight"),
                "fresh tick should not trigger pre-flight abort; got: " + ise.getMessage());
        } catch (Exception other) {
            // Other exceptions are fine — they come from downstream paths not under test.
        }
    }

    @Test
    void preflight_disabledKillSwitchAllowsMissingTick() {
        ReflectionTestUtils.setField(job, "preflightTickFreshnessEnabled", false);
        when(ops.get("trade-tick:12345")).thenReturn(null);

        StockMetrics m = newMetrics("12345", "TESTSYM");
        // Disabled gate must not abort even with no tick.
        try {
            job.openOne(m, "12345", 100.0, 10000.0, "VWAP_0915");
        } catch (IllegalStateException ise) {
            assertTrue(!ise.getMessage().contains("pre-flight"),
                "disabled gate must not throw pre-flight: " + ise.getMessage());
        } catch (Exception other) {
            // Downstream exceptions OK.
        }
    }

    private StockMetrics newMetrics(String scripCode, String symbol) {
        StockMetrics m = new StockMetrics();
        m.setScripCode(scripCode);
        m.setSymbol(symbol);
        m.setFnoEligible(true);
        m.setSuggestedSlPrice(95.0);
        return m;
    }
}
