package com.kotsin.dashboard.hotstocks.data;

import com.kotsin.dashboard.hotstocks.data.MarketPulseRedisClient.Deal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Covers the {@link MarketPulseRedisClient#loadDealsWithOptionalShortSelling} path
 * added for Agent A's short-selling sell-side input to HotStocks.
 *
 * <p>All tests set the same 1-day window {@code 2026-04-22} and mock bulk+block
 * keys as empty — the focus is the short-selling branch and the
 * {@code includeShortSelling} flag toggle.</p>
 */
class MarketPulseRedisClientShortSellingTest {

    private StringRedisTemplate redis;
    private ValueOperations<String, String> ops;
    private MarketPulseRedisClient client;

    private static final LocalDate D = LocalDate.of(2026, 4, 22);
    private static final String SHORT_KEY = "market-pulse:short-selling:2026-04-22";

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        // default: bulk+block return null (empty)
        when(ops.get(anyString())).thenReturn(null);
        client = new MarketPulseRedisClient(redis);
    }

    @Test
    void loadDealsWithOptionalShortSelling_includesShortSelling_whenEnabled() {
        String json = "[{\"symbol\":\"RELIANCE\",\"date\":\"2026-04-22\",\"quantity\":1000000,\"price\":2800.0}]";
        when(ops.get(SHORT_KEY)).thenReturn(json);

        List<Deal> out = client.loadDealsWithOptionalShortSelling(D, D, true);

        assertEquals(1, out.size());
        Deal d = out.get(0);
        assertEquals("RELIANCE", d.symbol());
        assertEquals("SELL", d.buySell());
        assertTrue(d.isShortSell());
        assertFalse(d.isBlock());
        assertEquals("SHORT_SELL_DISCLOSURE", d.clientName());
        assertEquals(LocalDate.of(2026, 4, 22), d.date());
        // valueCr = 1_000_000 * 2800 / 1e7 = 280 Cr
        assertEquals(280.0, d.valueCr(), 0.001);
    }

    @Test
    void loadDealsWithOptionalShortSelling_excludesShortSelling_whenDisabled() {
        String json = "[{\"symbol\":\"RELIANCE\",\"date\":\"2026-04-22\",\"quantity\":1000000,\"price\":2800.0}]";
        when(ops.get(SHORT_KEY)).thenReturn(json);

        List<Deal> out = client.loadDealsWithOptionalShortSelling(D, D, false);

        assertTrue(out.isEmpty(), "flag=false must skip the short-selling key entirely");
        // Must not have even attempted to read the short-selling key
        verify(ops, never()).get(SHORT_KEY);
    }

    @Test
    void loadDealsWithOptionalShortSelling_handlesEmptyShortSellingData() {
        when(ops.get(SHORT_KEY)).thenReturn(null);
        List<Deal> out1 = client.loadDealsWithOptionalShortSelling(D, D, true);
        assertTrue(out1.isEmpty());

        when(ops.get(SHORT_KEY)).thenReturn("");
        List<Deal> out2 = client.loadDealsWithOptionalShortSelling(D, D, true);
        assertTrue(out2.isEmpty());

        when(ops.get(SHORT_KEY)).thenReturn("[]");
        List<Deal> out3 = client.loadDealsWithOptionalShortSelling(D, D, true);
        assertTrue(out3.isEmpty());
    }

    @Test
    void valueCr_computed_correctly_fromQtyPrice() {
        // 1_000_000 shares × 100 ₹ = 10_00_00_000 = 10 Cr
        String json = "[{\"symbol\":\"TEST\",\"date\":\"2026-04-22\",\"quantity\":1000000,\"price\":100.0}]";
        when(ops.get(SHORT_KEY)).thenReturn(json);

        List<Deal> out = client.loadDealsWithOptionalShortSelling(D, D, true);
        assertEquals(1, out.size());
        assertEquals(10.0, out.get(0).valueCr(), 0.001);
    }

    @Test
    void loadDealsWithOptionalShortSelling_handlesMissingPriceField() {
        // Older rows only had quantity — price defaults to 0 so valueCr = 0
        String json = "[{\"symbol\":\"OLDSYM\",\"date\":\"2026-04-22\",\"quantity\":50000}]";
        when(ops.get(SHORT_KEY)).thenReturn(json);

        List<Deal> out = client.loadDealsWithOptionalShortSelling(D, D, true);
        assertEquals(1, out.size());
        Deal d = out.get(0);
        assertEquals(50000L, d.quantity());
        assertEquals(0.0, d.price());
        assertEquals(0.0, d.valueCr());
        assertTrue(d.isShortSell());
    }

    @Test
    void loadDealsWithOptionalShortSelling_dropsRowsWithEmptySymbol() {
        String json = "["
            + "{\"symbol\":\"\",\"date\":\"2026-04-22\",\"quantity\":100,\"price\":50},"
            + "{\"symbol\":\"GOOD\",\"date\":\"2026-04-22\",\"quantity\":200,\"price\":60}"
            + "]";
        when(ops.get(SHORT_KEY)).thenReturn(json);

        List<Deal> out = client.loadDealsWithOptionalShortSelling(D, D, true);
        assertEquals(1, out.size());
        assertEquals("GOOD", out.get(0).symbol());
    }

    @Test
    void dealRecord_backCompatConstructor_defaultsIsShortSellFalse() {
        Deal d = new Deal(D, "X", "", "", "BUY", 100L, 50.0, 0.5, true);
        assertFalse(d.isShortSell(), "9-arg ctor must default isShortSell to false");
        assertTrue(d.isBlock());
    }
}
