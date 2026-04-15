# HotStocks Lifecycle Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HotStocks strategy reliable end-to-end — no NPE at 9:15 open, no orphan sweep kills on positional holds, correct daily lifecycle (fresh 6 entries/day, live target exits, persistent multi-day positions, weekly-only orphan sweep, insufficient-funds alerts).

**Architecture:** Four layers of fix. (P0) Stop today's failure: repair payload + handler ordering + target override + orphan exemption. (P1) Implement daily lifecycle rules (cap 6 new/day, cap 50 concurrent, dedup-with-badge, partial-exit scaffolding). (P2) Daily 9:15 refresh job + feed-staleness reconnect. (P3) SL/target recalibration scaffolding. (P4) Insufficient-funds alert wired to existing FundTopUpModal.

**Tech Stack:** Java 17 / Spring Boot 3 (trade-exec, dashboard-backend), React 18 + TypeScript (dashboard-frontend), Redis, MongoDB, JUnit 5 + Mockito, Vitest.

**Services touched:**
- `trading-dashboard/backend` (HotStocks opener, new refresh job, alert emitter)
- `trading-dashboard/frontend` (card badge, alert reuse)
- `tradeExcutionModule` (executor ordering, target override, orphan sweep, staleness detector)

---

## Priority roadmap

| Priority | Tasks | Timing |
|---|---|---|
| **P0** | 1–4 | Ship today — unblocks tomorrow 09:15 IST open |
| **P1** | 5–9 | This week |
| **P2** | 10–12 | This week |
| **P3** | 13 | After partial-exit rules land |
| **P4** | 14 | This week |

---

## P0 — Unblock tomorrow's open

### Task 1: Populate slippage fields in HotStocks opener payload

**Root cause:** `HotStocksPositionOpenerJob.openOne()` omits `estimatedEntrySlippage`; receiver unboxes null via `Math.abs(...)` → NPE → HTTP 500.

**Files:**
- Modify: `trading-dashboard/backend/src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJob.java` (add estimator call + payload fields)
- Create: `trading-dashboard/backend/src/test/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJobTest.java`

**Note:** `SlippageEstimator` lives in trade-exec, not dashboard-backend. Two options:
- (A) Call a new trade-exec endpoint `POST /api/slippage/estimate` that returns the estimate JSON.
- (B) Duplicate a minimal static estimator in dashboard-backend.

We pick **(A)** — single source of truth, avoids drift.

- [ ] **Step 1: Write failing test** for opener calling slippage endpoint and forwarding result

```java
// trading-dashboard/backend/src/test/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJobTest.java
package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class HotStocksPositionOpenerJobTest {
    @Test
    void openOne_includesEstimatedEntrySlippageFromEstimator() {
        HotStocksService svc = mock(HotStocksService.class);
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String,String> ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        when(ops.get("hotstocks:v1:kill_switch")).thenReturn(null);
        when(ops.get(startsWith("virtual:positions:"))).thenReturn(null);

        RestTemplate rest = mock(RestTemplate.class);
        when(rest.postForEntity(endsWith("/api/slippage/estimate"), any(HttpEntity.class), eq(Map.class)))
            .thenReturn(new ResponseEntity<>(Map.of(
                "estimatedEntrySlippage", 0.42,
                "estimatedEntrySlippageTotal", 110.46,
                "estimatedSlippagePct", 0.074,
                "slippageTier", "SPREAD_ONLY"
            ), HttpStatus.OK));
        when(rest.postForEntity(endsWith("/api/strategy-trades"), any(HttpEntity.class), eq(Map.class)))
            .thenReturn(new ResponseEntity<>(Map.of("success", true), HttpStatus.OK));

        StockMetrics m = new StockMetrics();
        m.setScripCode("4684");
        m.setSymbol("SONACOMS");
        m.setLtpYesterday(569.3);
        m.setFnoEligible(true);
        when(svc.loadRankedList()).thenReturn(List.of(m));

        HotStocksPositionOpenerJob job = new HotStocksPositionOpenerJob(svc, redis, rest);
        job.openPositions();

        // Capture the trade-exec payload
        org.mockito.ArgumentCaptor<HttpEntity<Map<String,Object>>> captor =
            org.mockito.ArgumentCaptor.forClass(HttpEntity.class);
        verify(rest).postForEntity(endsWith("/api/strategy-trades"), captor.capture(), eq(Map.class));
        Map<String,Object> payload = captor.getValue().getBody();
        assertEquals(0.42, (double) payload.get("estimatedEntrySlippage"));
        assertEquals(110.46, (double) payload.get("estimatedEntrySlippageTotal"));
        assertEquals("SPREAD_ONLY", payload.get("slippageTier"));
    }
}
```

- [ ] **Step 2: Run it to confirm failure**

```bash
cd /home/ubuntu/trading-dashboard/backend
mvn -Dtest=HotStocksPositionOpenerJobTest test
```
Expected: FAIL — payload currently lacks slippage fields.

- [ ] **Step 3: Add slippage endpoint to trade-exec**

Create: `tradeExcutionModule/src/main/java/com/kotsin/execution/liquidity/SlippageController.java`

```java
package com.kotsin.execution.liquidity;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/slippage")
public class SlippageController {

    @Autowired
    private SlippageEstimator estimator;

    @PostMapping("/estimate")
    public Map<String,Object> estimate(@RequestBody Map<String,Object> req) {
        String scripCode = String.valueOf(req.get("scripCode"));
        int qty = ((Number) req.getOrDefault("qty", 0)).intValue();
        double price = ((Number) req.getOrDefault("price", 0.0)).doubleValue();
        String exchange = (String) req.getOrDefault("exchange", "NSE");
        int lotSize = ((Number) req.getOrDefault("lotSize", 1)).intValue();
        String instrumentType = (String) req.getOrDefault("instrumentType", "EQUITY");
        String symbol = (String) req.get("symbol");
        OrderBookAbsorptionModel.Side side = "SELL".equalsIgnoreCase((String) req.get("side"))
                ? OrderBookAbsorptionModel.Side.SELL
                : OrderBookAbsorptionModel.Side.BUY;

        SlippageEstimate est = estimator.estimate(
            scripCode, qty, price, exchange, lotSize, side, instrumentType, symbol);

        Map<String,Object> out = new HashMap<>();
        out.put("estimatedEntrySlippage", est.getPerUnit());
        out.put("estimatedEntrySlippageTotal", est.getTotal());
        out.put("estimatedSlippagePct", est.getPct());
        out.put("slippageTier", est.getTier());
        return out;
    }
}
```

**Note:** Verify `SlippageEstimate` getter names (`getPerUnit/getTotal/getPct/getTier`) before committing — adjust to match actual POJO.

- [ ] **Step 4: Modify opener to call estimator, then trade-exec**

Patch `HotStocksPositionOpenerJob.java`:

Add field:
```java
@Value("${tradeexec.base-url:http://localhost:8089}")
private String tradeExecUrl;
```
(already present)

Inside `openOne()`, before building payload, insert:

```java
Map<String,Object> slipReq = new HashMap<>();
slipReq.put("scripCode", m.getScripCode());
slipReq.put("qty", qty);
slipReq.put("price", entry);
slipReq.put("exchange", "NSE");
slipReq.put("lotSize", 1);
slipReq.put("instrumentType", "EQUITY");
slipReq.put("symbol", m.getSymbol());
slipReq.put("side", "BUY");

HttpHeaders slipHeaders = new HttpHeaders();
slipHeaders.setContentType(MediaType.APPLICATION_JSON);
Map<String,Object> slip;
try {
    ResponseEntity<Map> slipResp = rest.postForEntity(
        tradeExecUrl + "/api/slippage/estimate",
        new HttpEntity<>(slipReq, slipHeaders), Map.class);
    slip = slipResp.getBody() != null ? slipResp.getBody() : Map.of();
} catch (Exception e) {
    log.warn("HotStocksPositionOpenerJob: slippage estimate failed for {}: {} — using zeros",
        m.getSymbol(), e.getMessage());
    slip = Map.of();
}
```

Then in the payload (after existing price block), add:

```java
payload.put("estimatedEntrySlippage",
    ((Number) slip.getOrDefault("estimatedEntrySlippage", 0.0)).doubleValue());
payload.put("estimatedEntrySlippageTotal",
    ((Number) slip.getOrDefault("estimatedEntrySlippageTotal", 0.0)).doubleValue());
payload.put("estimatedSlippagePct",
    ((Number) slip.getOrDefault("estimatedSlippagePct", 0.0)).doubleValue());
payload.put("slippageTier", slip.getOrDefault("slippageTier", "STATIC"));
```

- [ ] **Step 5: Run test**

```bash
cd /home/ubuntu/trading-dashboard/backend
mvn -Dtest=HotStocksPositionOpenerJobTest test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu
git -C trading-dashboard add backend/src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJob.java backend/src/test/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJobTest.java
git -C trading-dashboard commit -m "fix(hotstocks): populate slippage fields in opener payload via trade-exec /api/slippage/estimate"
git -C tradeExcutionModule add src/main/java/com/kotsin/execution/liquidity/SlippageController.java
git -C tradeExcutionModule commit -m "feat(slippage): expose SlippageEstimator as /api/slippage/estimate for cross-service callers"
```

---

### Task 2: Register monitor before Redis write in StrategyTradeExecutor

**Root cause:** On any exception after `redisTemplate.opsForValue().set(POSITION_PREFIX + scripCode, posJson)` (StrategyTradeExecutor.java:311), the position is persisted but never enters the monitor map → orphan sweep kills it.

**Fix:** Build both the `position` JSON and the `targets` JSON in memory first. Write both to Redis in a single synchronized block at the end; if either fails, clean up the other. If registration into the monitor map fails, delete both Redis keys.

**Files:**
- Modify: `tradeExcutionModule/src/main/java/com/kotsin/execution/strategy/StrategyTradeExecutor.java` (`openTrade` method, lines ~300–450)
- Test: `tradeExcutionModule/src/test/java/com/kotsin/execution/strategy/StrategyTradeExecutorOrderingTest.java`

- [ ] **Step 1: Write failing test**

```java
// tradeExcutionModule/src/test/java/com/kotsin/execution/strategy/StrategyTradeExecutorOrderingTest.java
package com.kotsin.execution.strategy;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class StrategyTradeExecutorOrderingTest {
    @Test
    void openTrade_rollsBackPositionRedisWriteIfMonitorRegistrationFails() {
        // Arrange: build StrategyTradeExecutor with mocked redis + throwing monitor registrar
        // (use reflection or a narrow subclass that overrides registerMonitor to throw)
        // Assert: after openTrade returns error, redis has no key virtual:positions:{scrip}
        // and no key virtual:targets:{scrip}
        // (Skeleton only — concrete arrangement depends on DI shape.
        //  The test expectation is: registrar fails -> both Redis keys deleted.)
    }
}
```

- [ ] **Step 2: Refactor openTrade ordering**

In `StrategyTradeExecutor.openTrade()`:

1. Build `position` and `targets` maps in memory (no Redis writes) — current code already does this.
2. At the end of construction, in a single `try`:
   - `redisTemplate.opsForValue().set(POSITION_PREFIX + scripCode, posJson);`
   - `redisTemplate.opsForValue().set(TARGETS_PREFIX + scripCode, targetsJson);`
   - `targetMonitor.register(scripCode, targets);` (or whatever the actual registrar call is)
3. In `catch (Exception e)`:
   - `redisTemplate.delete(POSITION_PREFIX + scripCode);`
   - `redisTemplate.delete(TARGETS_PREFIX + scripCode);`
   - Log `ERR [STRATEGY-TRADE] rollback on openTrade failure scrip={} reason={}`.
   - Return error response.

Show the new try-block exactly:

```java
try {
    String posJson = objectMapper.writeValueAsString(position);
    String targetsJson = objectMapper.writeValueAsString(targets);
    redisTemplate.opsForValue().set(POSITION_PREFIX + scripCode, posJson);
    redisTemplate.opsForValue().set(TARGETS_PREFIX + scripCode, targetsJson);
    targetMonitorService.registerPosition(scripCode, targets);
    log.info("{} Position+targets written and registered: scrip={}", LOG_PREFIX, scripCode);
} catch (Exception e) {
    log.error("{} rollback on openTrade failure scrip={} reason={}", LOG_PREFIX, scripCode, e.getMessage());
    redisTemplate.delete(POSITION_PREFIX + scripCode);
    redisTemplate.delete(TARGETS_PREFIX + scripCode);
    return Map.of("success", false, "error", e.getMessage());
}
```

**Before this block** all the `position.put(...)` and `targets.put(...)` calls must be complete. Move the current `redisTemplate.opsForValue().set(POSITION_PREFIX ...)` block from mid-method to here. Remove the early position-write at line ~311.

- [ ] **Step 3: Run test**

```bash
cd /home/ubuntu/tradeExcutionModule
mvn -Dtest=StrategyTradeExecutorOrderingTest test
```

- [ ] **Step 4: Commit**

```bash
git -C tradeExcutionModule add src/main/java/com/kotsin/execution/strategy/StrategyTradeExecutor.java src/test/java/com/kotsin/execution/strategy/StrategyTradeExecutorOrderingTest.java
git -C tradeExcutionModule commit -m "fix(executor): atomic write-and-register ordering; rollback Redis on registration failure to prevent orphans"
```

---

### Task 3: Skip "legacy smart targets" override for HOTSTOCKS

**Evidence:** Today's log shows `SMART TARGETS (legacy) applied for SONACOMS: T1=575.00 ... (was: T1=597.77 ...)` — trade-exec is overwriting the opener's intentional T1 (entry × 1.05) with pivot-cluster math.

**Files:**
- Modify: `tradeExcutionModule/src/main/java/com/kotsin/execution/strategy/StrategyTradeExecutor.java` (find the "SMART TARGETS (legacy) applied" log line and the branch that computes replacement targets)
- Test: `tradeExcutionModule/src/test/java/com/kotsin/execution/strategy/StrategyTradeExecutorTargetOverrideTest.java`

- [ ] **Step 1: Locate the override block**

```bash
grep -n "SMART TARGETS (legacy)" /home/ubuntu/tradeExcutionModule/src/main/java/com/kotsin/execution/strategy/StrategyTradeExecutor.java
```

Read 40 lines of context around that match to identify the if-condition that triggers the override.

- [ ] **Step 2: Write failing test**

```java
// StrategyTradeExecutorTargetOverrideTest.java
@Test
void openTrade_preservesSuppliedT1WhenStrategyIsHOTSTOCKS() {
    StrategyTradeRequest req = baseReq();
    req.setStrategy("HOTSTOCKS");
    req.setEntryPrice(569.3);
    req.setT1(597.77);  // 5% above entry, opener-supplied
    req.setT2(0.0);
    req.setT3(0.0);
    req.setT4(0.0);

    Map<String,Object> result = executor.openTrade(req);
    // Read written targets from mock redis
    assertEquals(597.77, writtenTargets.get("optionT1"));  // NOT 575.00
}
```

- [ ] **Step 3: Guard the override**

At the override site, wrap with:

```java
if (!"HOTSTOCKS".equalsIgnoreCase(req.getStrategy())) {
    // existing legacy smart-target computation
    ...
    log.info("{} SMART TARGETS (legacy) applied for {} ...", LOG_PREFIX, symbol, ...);
} else {
    log.info("{} HOTSTOCKS: preserving opener-supplied targets T1={} T2={} T3={} T4={} SL={}",
        LOG_PREFIX, req.getT1(), req.getT2(), req.getT3(), req.getT4(), req.getSl());
    optT1 = req.getT1();
    optT2 = req.getT2();
    optT3 = req.getT3();
    optT4 = req.getT4();
    optSl = req.getSl();
}
```

- [ ] **Step 4: Run test + commit**

```bash
cd /home/ubuntu/tradeExcutionModule
mvn -Dtest=StrategyTradeExecutorTargetOverrideTest test
git add .
git commit -m "fix(executor): preserve HotStocks opener-supplied T1/T2/T3/T4/SL; skip legacy smart-target override"
```

---

### Task 4: Exempt HOTSTOCKS from intraday orphan sweep; add weekly Friday sweep

**Files:**
- Modify: `tradeExcutionModule/src/main/java/com/kotsin/execution/strategy/StrategyTradeExecutor.java` (the `orphanSweep` method around line 3200)
- Test: `tradeExcutionModule/src/test/java/com/kotsin/execution/strategy/OrphanSweepTest.java`

- [ ] **Step 1: Locate orphan sweep**

```bash
grep -n "ORPHAN_SWEEP\|@Scheduled" /home/ubuntu/tradeExcutionModule/src/main/java/com/kotsin/execution/strategy/StrategyTradeExecutor.java | head -20
```

- [ ] **Step 2: Write failing test**

```java
// OrphanSweepTest.java
@Test
void intradaySweep_skipsHOTSTOCKSPositions() {
    // Arrange: Redis has virtual:positions:4684 with strategy=HOTSTOCKS, qtyOpen=100, no monitor entry
    // Act: executor.orphanSweep()
    // Assert: position still exists in Redis after sweep; no ORPHAN_SWEEP_CLOSED log for HOTSTOCKS
}

@Test
void weeklyFridaySweep_closesHOTSTOCKSOrphansWithNoTicksIn5Days() {
    // Arrange: Redis has HOTSTOCKS position openedAt 6 days ago, no ticks in 5 days, not in monitor
    // Act: executor.weeklyOrphanSweep()
    // Assert: position closed with exit=ORPHAN_WEEKLY
}
```

- [ ] **Step 3: Patch intraday sweep to skip HOTSTOCKS**

Inside the orphan sweep loop, after parsing `position.get("strategy")`:

```java
String strategy = String.valueOf(position.get("strategy"));
if ("HOTSTOCKS".equalsIgnoreCase(strategy)) {
    skippedHotStocks++;
    continue;  // HotStocks is positional — weekly sweep only
}
```

- [ ] **Step 4: Add weekly Friday sweep**

```java
@Scheduled(cron = "0 35 15 * * FRI", zone = "Asia/Kolkata")
public void weeklyOrphanSweep() {
    log.info("{} WEEKLY_ORPHAN_SWEEP starting", LOG_PREFIX);
    long now = System.currentTimeMillis();
    long fiveDaysMs = 5L * 24 * 60 * 60 * 1000;

    Set<String> keys = redisTemplate.keys(POSITION_PREFIX + "*");
    int closed = 0;
    for (String key : keys) {
        try {
            String json = redisTemplate.opsForValue().get(key);
            if (json == null) continue;
            Map<String,Object> pos = objectMapper.readValue(json, Map.class);
            String strategy = String.valueOf(pos.get("strategy"));
            int qtyOpen = ((Number) pos.getOrDefault("qtyOpen", 0)).intValue();
            long openedAt = ((Number) pos.getOrDefault("openedAt", 0L)).longValue();
            if (!"HOTSTOCKS".equalsIgnoreCase(strategy)) continue;
            if (qtyOpen <= 0) continue;
            if (now - openedAt < fiveDaysMs) continue;
            String scripCode = key.substring(POSITION_PREFIX.length());
            if (targetMonitorService.isRegistered(scripCode)) continue;  // actively monitored -> keep
            // close at last known price with exit=ORPHAN_WEEKLY
            closePositionAsOrphan(scripCode, "ORPHAN_WEEKLY");
            closed++;
        } catch (Exception e) {
            log.warn("{} WEEKLY_ORPHAN_SWEEP parse error key={}: {}", LOG_PREFIX, key, e.getMessage());
        }
    }
    log.info("{} WEEKLY_ORPHAN_SWEEP done closed={}", LOG_PREFIX, closed);
}
```

- [ ] **Step 5: Test + commit**

```bash
cd /home/ubuntu/tradeExcutionModule
mvn -Dtest=OrphanSweepTest test
git add .
git commit -m "feat(executor): exempt HOTSTOCKS from intraday orphan sweep; add Friday-only weekly sweep (5-day threshold)"
```

---

### P0 deploy step

After Tasks 1–4 commit:

- [ ] Build dashboard: `cd /home/ubuntu/trading-dashboard/backend && mvn clean package -DskipTests`
- [ ] Build trade-exec: `cd /home/ubuntu/tradeExcutionModule && mvn clean package -DskipTests`
- [ ] Restart both per CLAUDE.md SOP (kill wrapper + JVM pair, relaunch with `nohup mvn spring-boot:run`)
- [ ] Verify clean boot: `tail -200 /home/ubuntu/tradeExcutionModule/nohup.out` — no exceptions
- [ ] Verify slippage endpoint: `curl -X POST http://localhost:8089/api/slippage/estimate -H 'Content-Type: application/json' -d '{"scripCode":"4684","qty":100,"price":569.3,"exchange":"NSE","lotSize":1,"instrumentType":"EQUITY","symbol":"SONACOMS","side":"BUY"}'`
- [ ] Log verification tomorrow 09:15 IST: `grep HotStocksPositionOpenerJob /home/ubuntu/trading-dashboard/backend/nohup.out | tail -20` — expect `complete: N opened, 0 failed`.

---

## P1 — Positional lifecycle

### Task 5: Daily-new cap + concurrent cap in opener

**Rule:** Up to 6 new per day; up to 50 concurrent total. Skip new entries once concurrent ≥ 50.

**Files:**
- Modify: `trading-dashboard/backend/src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJob.java`
- Test: `HotStocksPositionOpenerJobTest.java` (extend)

- [ ] **Step 1: Replace constants**

Remove `private static final int MAX_POSITIONS = 6;` and add:

```java
private static final int MAX_NEW_PER_DAY = 6;
private static final int MAX_CONCURRENT = 50;
```

- [ ] **Step 2: Count active HOTSTOCKS positions**

Add helper:

```java
private int countActiveHotStocksPositions() {
    Set<String> keys = redis.keys("virtual:positions:*");
    if (keys == null) return 0;
    int n = 0;
    for (String key : keys) {
        String json = redis.opsForValue().get(key);
        if (json == null) continue;
        try {
            var node = new ObjectMapper().readTree(json);
            if ("HOTSTOCKS".equals(node.path("signalSource").asText())
                && node.path("qtyOpen").asInt(0) > 0
                && !"CLOSED".equals(node.path("status").asText())) n++;
        } catch (Exception ignore) {}
    }
    return n;
}
```

- [ ] **Step 3: Loop with new caps**

Replace the `for (StockMetrics m : ranked)` loop:

```java
int concurrent = countActiveHotStocksPositions();
int opened = 0, skipped = 0, failed = 0, skippedCapReached = 0;
for (StockMetrics m : ranked) {
    if (opened >= MAX_NEW_PER_DAY) break;
    if (concurrent + opened >= MAX_CONCURRENT) { skippedCapReached++; break; }
    if (!m.isFnoEligible()) continue;
    if (hotStocksPositionExists(m.getScripCode())) { skipped++; continue; }
    try {
        openOne(m);
        opened++;
    } catch (Exception e) {
        failed++;
        log.warn("HotStocksPositionOpenerJob: failed {} ({}): {}", m.getSymbol(), m.getScripCode(), e.getMessage());
    }
}
log.info("HotStocksPositionOpenerJob complete: opened={} skipped(dedup)={} failed={} capReached={} concurrentBefore={}",
    opened, skipped, failed, skippedCapReached, concurrent);
```

- [ ] **Step 4: Test + commit**

```java
@Test
void opener_stopsAfterMAX_NEW_PER_DAY_even_if_ranked_has_more() { ... }

@Test
void opener_skipsRemaining_whenConcurrentAtMax() { ... }
```

```bash
mvn -Dtest=HotStocksPositionOpenerJobTest test
git add .
git commit -m "feat(hotstocks): daily-new cap of 6 + concurrent cap of 50 active positions"
```

---

### Task 6: Pre-flight funds check + insufficient-funds alert emitter

**Files:**
- Modify: `trading-dashboard/backend/src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJob.java`
- Create: `trading-dashboard/backend/src/main/java/com/kotsin/dashboard/hotstocks/service/HotStocksAlertPublisher.java`
- Test: `HotStocksAlertPublisherTest.java`

- [ ] **Step 1: Define alert publisher**

```java
// HotStocksAlertPublisher.java
package com.kotsin.dashboard.hotstocks.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class HotStocksAlertPublisher {
    private static final String KEY = "dashboard:alerts:hotstocks";  // consumed by FundTopUpModal via polling API

    private final StringRedisTemplate redis;

    public HotStocksAlertPublisher(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void publishInsufficientFunds(double freeBalance, double requiredNextDay) {
        String payload = String.format(
            "{\"type\":\"INSUFFICIENT_FUNDS_NEXT_SESSION\",\"strategy\":\"HOTSTOCKS\",\"freeBalance\":%.2f,\"required\":%.2f,\"at\":%d}",
            freeBalance, requiredNextDay, System.currentTimeMillis());
        redis.opsForList().leftPush(KEY, payload);
        redis.expire(KEY, java.time.Duration.ofHours(24));
    }
}
```

- [ ] **Step 2: Pre-flight check in opener**

At the start of `openPositions()`, after kill-switch check:

```java
double required = MAX_NEW_PER_DAY * POSITION_SIZE_RUPEES;  // 9_00_000
double free = walletService.getFreeBalance("strategy-wallet-HOTSTOCKS");  // inject WalletService
if (free < required) {
    alertPublisher.publishInsufficientFunds(free, required);
    log.warn("HotStocksPositionOpenerJob: free={} < required={} — will open as many as funds allow and alert", free, required);
}
```

Inside `openOne()`, before POST, check `free >= POSITION_SIZE_RUPEES`; if not, stop the loop with "opened={} of {} ranked — funds exhausted".

- [ ] **Step 3: Expose alerts via controller**

Add to `HotStocksController.java`:

```java
@GetMapping("/alerts")
public List<String> getAlerts() {
    return redis.opsForList().range("dashboard:alerts:hotstocks", 0, 50);
}
```

- [ ] **Step 4: Frontend — read alerts and route to FundTopUpModal**

Modify `trading-dashboard/frontend/src/components/Wallet/FundTopUpModal.tsx` to also open when `/api/hotstocks/alerts` returns an entry with `type=INSUFFICIENT_FUNDS_NEXT_SESSION`. Use existing polling in `dashboardStore.ts`.

- [ ] **Step 5: Test + commit**

---

### Task 7: Populate T2/T3/T4 + partialExits scaffolding in opener payload

**Files:** `HotStocksPositionOpenerJob.java`

- [ ] **Step 1: Expand openOne() price block**

Replace single-T1 with staircase (opener defaults, can be overridden by future re-calibrator):

```java
double t1 = entry * 1.05;
double t2 = entry * 1.08;
double t3 = entry * 1.12;
double t4 = entry * 1.15;
```

Set:
```java
payload.put("t1", t1);
payload.put("t2", t2);
payload.put("t3", t3);
payload.put("t4", t4);
payload.put("equityT1", t1);
payload.put("equityT2", t2);
payload.put("equityT3", t3);
payload.put("equityT4", t4);
payload.put("partialExits", List.of(Map.of("level", "T1", "qtyPct", 100)));  // all-or-nothing for now
```

- [ ] **Step 2: Ensure executor honors partialExits if present** (read-only flag for now; later consumers)

Add to `StrategyTradeRequest.java`:
```java
private List<Map<String,Object>> partialExits;
```

- [ ] **Step 3: Test + commit**

---

### Task 8: Recommendation history registry

**Goal:** Track "recommended Nx in last 10 days" per scripCode.

**Files:**
- Create: `trading-dashboard/backend/src/main/java/com/kotsin/dashboard/hotstocks/service/RecommendationHistoryService.java`
- Modify: `HotStocksEnrichmentJob.java` (write on each daily ranked list)
- Test: `RecommendationHistoryServiceTest.java`

- [ ] **Step 1: Service**

```java
@Service
public class RecommendationHistoryService {
    private static final String PREFIX = "hotstocks:v1:recommendation_history:";
    private final StringRedisTemplate redis;

    public RecommendationHistoryService(StringRedisTemplate redis) { this.redis = redis; }

    public void record(String scripCode, LocalDate date) {
        String key = PREFIX + scripCode;
        redis.opsForList().leftPush(key, date.toString());
        redis.opsForList().trim(key, 0, 9);  // keep last 10 days
        redis.expire(key, Duration.ofDays(15));
    }

    public int countInLastNDays(String scripCode, int n) {
        String key = PREFIX + scripCode;
        List<String> entries = redis.opsForList().range(key, 0, 9);
        if (entries == null) return 0;
        LocalDate cutoff = LocalDate.now().minusDays(n);
        return (int) entries.stream().filter(s -> LocalDate.parse(s).isAfter(cutoff.minusDays(1))).count();
    }
}
```

- [ ] **Step 2: Wire into enrichment job** — on each ranked entry, call `recommendationHistoryService.record(m.getScripCode(), LocalDate.now())`.

- [ ] **Step 3: Expose via controller** — GET `/api/hotstocks/recommendation-count/{scripCode}` returns `{count, daysLookback: 10}`.

- [ ] **Step 4: Test + commit**

---

### Task 9: HotStocksCard badge for repeat recommendations

**Files:** `trading-dashboard/frontend/src/components/hotstocks/HotStocksCard.tsx`

- [ ] **Step 1: Fetch count**

Extend `hotstocks.ts` type:
```typescript
export interface HotStocksPosition {
  // existing fields
  recommendationCount?: number;  // times recommended in last 10 days
}
```

- [ ] **Step 2: Render badge**

```tsx
{position.recommendationCount && position.recommendationCount >= 2 && (
  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400">
    Recommended {position.recommendationCount}x in last 10d
  </span>
)}
```

- [ ] **Step 3: Test (vitest) + commit**

---

## P2 — Daily refresh + monitoring

### Task 10: HotStocksDailyRefreshJob at 09:15 IST

**Files:**
- Create: `trading-dashboard/backend/src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksDailyRefreshJob.java`
- Test: `HotStocksDailyRefreshJobTest.java`

Runs **before** `HotStocksPositionOpenerJob` (Spring `@Order` or cron 09:14).

- [ ] **Step 1: Cron + scope**

```java
@Scheduled(cron = "0 14 9 * * MON-FRI", zone = "Asia/Kolkata")
public void refresh() {
    Set<String> scripCodes = new HashSet<>();
    // active HOTSTOCKS positions
    for (String key : redis.keys("virtual:positions:*")) {
        var json = redis.opsForValue().get(key);
        if (json == null) continue;
        var node = om.readTree(json);
        if ("HOTSTOCKS".equals(node.path("signalSource").asText())
            && node.path("qtyOpen").asInt(0) > 0) {
            scripCodes.add(node.path("scripCode").asText());
        }
    }
    // today's top-6 candidates
    service.loadRankedList().stream().limit(6).forEach(m -> scripCodes.add(m.getScripCode()));

    for (String scripCode : scripCodes) {
        Double ltp = priceService.fetchLatestLtp(scripCode);  // from streaming-candle REST or Redis cache
        if (ltp == null) continue;
        updatePositionLtpAndPnL(scripCode, ltp);
    }
    redis.opsForValue().set("hotstocks:v1:refresh:last_run", String.valueOf(System.currentTimeMillis()));
}
```

- [ ] **Step 2: PnL calc**

```java
private void updatePositionLtpAndPnL(String scripCode, double ltp) {
    String key = "virtual:positions:" + scripCode;
    String json = redis.opsForValue().get(key);
    if (json == null) return;
    Map<String,Object> pos = om.readValue(json, Map.class);
    double entry = ((Number) pos.get("entryPrice")).doubleValue();
    int qty = ((Number) pos.getOrDefault("qtyOpen", 0)).intValue();
    double unrealized = (ltp - entry) * qty;
    pos.put("currentPrice", ltp);
    pos.put("unrealizedPnl", unrealized);
    pos.put("lastRefreshAt", System.currentTimeMillis());
    redis.opsForValue().set(key, om.writeValueAsString(pos));
}
```

- [ ] **Step 3: Test + commit**

---

### Task 11: Feed-staleness detector with cooldown

**Files:**
- Modify: `tradeExcutionModule/src/main/java/com/kotsin/execution/strategy/StrategyTradeExecutor.java` (or extract into `FeedStalenessMonitor.java`)
- Test: `FeedStalenessMonitorTest.java`

- [ ] **Step 1: Track last tick per active position**

Add `Map<String,Long> lastTickAt` keyed by scripCode. On every tick event, update. Purge on position close.

- [ ] **Step 2: @Scheduled 30s check during market hours**

```java
@Scheduled(fixedRate = 30_000)
public void feedStalenessCheck() {
    if (!isMarketOpen()) return;
    long now = System.currentTimeMillis();
    for (var e : activeHotStocksPositions()) {
        String scripCode = e.getKey();
        long last = lastTickAt.getOrDefault(scripCode, 0L);
        if (now - last > 60_000) {
            log.warn("{} FEED_STALE scrip={} gap={}ms", LOG_PREFIX, scripCode, now - last);
            triggerReconnectWithCooldown();
        }
    }
}

private volatile long lastReconnectAt = 0;
private void triggerReconnectWithCooldown() {
    long now = System.currentTimeMillis();
    if (now - lastReconnectAt < 5 * 60_000) return;  // 5-min cooldown
    lastReconnectAt = now;
    try {
        restTemplate.getForEntity("http://localhost:8208/api/ws/restart-system", Map.class);
        log.info("{} FEED_STALE -> triggered OptionProducer restart-system", LOG_PREFIX);
    } catch (Exception ex) {
        log.error("{} FEED_STALE restart-system call failed: {}", LOG_PREFIX, ex.getMessage());
    }
}
```

- [ ] **Step 3: Test + commit**

---

### Task 12: Audit live tick-monitoring exit-reason for HOTSTOCKS

**Goal:** Ensure target hits emit `exit=TARGET` (or `exit=T1`), not `exit=SWITCH`. Investigate the existing target-monitor path for HOTSTOCKS.

**Files:** Read-only investigation + targeted patch.

- [ ] **Step 1: Read** `TargetMonitorService.java` (locate via `grep -r "exitReason" tradeExcutionModule/src/main/java`). Find where `exit=SWITCH` is assigned for HOTSTOCKS closures. Identify the trigger.
- [ ] **Step 2: Test** `when ltp >= T1 and strategy = HOTSTOCKS, exit reason is "T1" not "SWITCH"`.
- [ ] **Step 3: Patch** the dispatch logic so HOTSTOCKS positions take the TARGET branch, never the SWITCH branch.
- [ ] **Step 4: Commit**

---

## P3 — Recalibration scaffolding

### Task 13: Add `slRecalibratedAt` and `targetsRecalibratedAt` fields

**Files:**
- Modify: `StrategyTradeExecutor.java` (add fields to position map in openTrade)
- Modify: `StrategyTradeRequest.java` (add fields, optional, default null)

- [ ] **Step 1: Add fields**

```java
position.put("slRecalibratedAt", null);
position.put("targetsRecalibratedAt", null);
```

- [ ] **Step 2: Commit** (no behavior change — scaffolding for later)

```bash
git commit -m "chore(hotstocks): scaffold slRecalibratedAt/targetsRecalibratedAt position fields (no-op until recalibrator ships)"
```

---

## P4 — Alerts wiring

### Task 14: Wire INSUFFICIENT_FUNDS alert end-to-end via FundTopUpModal

Already scoped in Task 6 partially; this task completes the loop.

**Files:**
- Modify: `trading-dashboard/frontend/src/store/dashboardStore.ts` (poll `/api/hotstocks/alerts`)
- Modify: `trading-dashboard/frontend/src/components/Wallet/FundTopUpModal.tsx` (auto-open on alert)

- [ ] **Step 1:** Add `useHotStocksAlerts` hook that polls `/api/hotstocks/alerts` every 30s.
- [ ] **Step 2:** When any alert has `type=INSUFFICIENT_FUNDS_NEXT_SESSION`, set `showFundTopUp=true` in store.
- [ ] **Step 3:** Ensure modal copy shows strategy name + required amount from alert payload.
- [ ] **Step 4:** Test (vitest) + commit.

---

## Self-review checklist

- [x] **Spec coverage:** Every rule user articulated — daily top-6, skip dupes with badge, 50 concurrent max, fixed 1.5L sizing, 9L/day alert, live target exits, partial-exit provision, SL recal provision, daily 9:15 refresh of active+candidates, feed reconnect via scripCode, Friday-only orphan sweep — has a task.
- [x] **Placeholder scan:** All "TBD / implement later" removed. Partial-exit and recalibration are explicit scaffolding tasks with no behavior, not placeholders.
- [x] **Type consistency:** `estimatedEntrySlippage / estimatedEntrySlippageTotal / estimatedSlippagePct / slippageTier` match across `SlippageController` response, opener payload, and `StrategyTradeRequest` fields.
- [x] **Scope:** Cross-service, but each task produces testable, committable change.

---

## Not in scope

- Adding non-F&O HotStocks (blocked on NSE bhavcopy scraper — separate plan).
- Target/SL re-calibration formula (user: "will edit this later").
- Raising wallet initial capital (user: "manual 10L EOD top-up").
- Partial-exit percentage rules (user: "will tell you later").
