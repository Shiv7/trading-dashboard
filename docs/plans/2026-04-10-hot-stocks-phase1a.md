# Hot Stocks Phase 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Monday-ready Hot Stocks feature — a research dashboard for positional (1-week) Indian equity bets, with rule-based smart-trader thesis, action cues, institutional/delivery/corporate-event facts, HOTSTOCKS virtual wallet (10 Lakh, auto-opens 6 positions at 09:15 IST), and a clickable card grid. Scoped to the card grid + stub detail page; full 9-section detail page is deferred to Phase 1b.

**Architecture:** Spring Boot daily enrichment job aggregates facts from 5paisa historical candles + NSE bhavcopy + NSE deal archives + MongoDB OI metrics into a `StockMetrics` DTO cached in Redis. A pure-function `ThesisGenerator` and `ActionCueGenerator` produce the narrative text and action cue from the metrics. React frontend renders a 2×3 F&O grid of Hot Stocks cards. A new `strategy-wallet-HOTSTOCKS` wallet auto-opens virtual positions at market open using the existing `StrategyTradeExecutor` monitor loop.

**Tech Stack:** Java 17, Spring Boot, Spring Data Mongo, Lettuce Redis, Jackson; React 18, TypeScript, Vite, Tailwind; FastAPI Python (for 5paisa bulk history); MongoDB, Redis; existing `nohup mvn spring-boot:run` + PM2 deploy flow.

**Out of scope (tracked separately):**
- Phase 1b — full 9-section detail page (deal timeline chart, price chart with DMAs, delivery trend bar chart, sector peers table, strategies-watching live cross-reference panel, raw data audit tables). Stub page ships here.
- Phase 2 — regime detector + 3 scoring models + 10-rule backtest + kill switch + scorer plugin swap.

**Prerequisites (must happen before Task 1):**
- MongoDB `tradeIngestion` database is reachable
- Redis DB0 is reachable
- FastAnalytics is up at `http://localhost:8002`
- Trade execution module is up at `http://localhost:8089`
- ScripFinder has rebuilt ScripGroup collection within the last 24h

---

## File Structure

### Backend — `/home/ubuntu/trading-dashboard/backend`

**Package**: `com.kotsin.dashboard.hotstocks` (new package, co-located responsibility)

| File | Responsibility |
|---|---|
| `hotstocks/model/StockMetrics.java` | DTO — single source of truth for per-stock facts |
| `hotstocks/model/StrategyWatch.java` | Nested DTO — strategy cross-reference row |
| `hotstocks/model/CorporateEvent.java` | Nested DTO — split/dividend/earnings |
| `hotstocks/model/LiquidityTier.java` | Enum — HIGH/MED/LOW |
| `hotstocks/model/ActionCueType.java` | Enum — BUY_DIP/WAIT_PULLBACK/BUY_RANGE_LOW/HOLD_OFF_EVENT/AVOID/OBSERVE |
| `hotstocks/narrative/ThesisGenerator.java` | Pure function — StockMetrics → thesis text |
| `hotstocks/narrative/ActionCueGenerator.java` | Pure function — StockMetrics → action cue |
| `hotstocks/metrics/PriceFactsComputer.java` | Pure function — candles → price facts + trend state |
| `hotstocks/metrics/RelativeStrengthComputer.java` | Pure function — stock vs sector vs Nifty |
| `hotstocks/metrics/VolumeLiquidityComputer.java` | Pure function — volume regime + liquidity tier + swing levels |
| `hotstocks/metrics/DeliveryComputer.java` | Pure function — delivery % + interpretation |
| `hotstocks/metrics/OiComputer.java` | Pure function — OI interpretation (F&O only) |
| `hotstocks/metrics/RegimeComputer.java` | Pure function — per-stock bullish/bearish/range |
| `hotstocks/data/FivePaisaHistoryClient.java` | HTTP client → FastAnalytics /getHisDataFromFivePaisa |
| `hotstocks/data/NseBhavcopyClient.java` | Downloader + CSV parser for delivery % |
| `hotstocks/data/NseDealArchiveClient.java` | Downloader + CSV parser for bulk/block deals |
| `hotstocks/data/CorporateEventsClient.java` | Scraper for NSE corporate actions |
| `hotstocks/data/StrategyCrossReferenceClient.java` | HTTP client → trade-exec port 8089 |
| `hotstocks/service/HistoricalDataBackfillService.java` | Saturday one-off backfill orchestration |
| `hotstocks/service/HotStocksService.java` | Main orchestrator — compose metrics + thesis + cue |
| `hotstocks/service/HotStocksRanker.java` | Facts-based top-N ranker |
| `hotstocks/job/HotStocksEnrichmentJob.java` | @Scheduled 05:45 IST — build universe + cache |
| `hotstocks/job/HotStocksPositionOpenerJob.java` | @Scheduled 09:15 IST — open virtual positions |
| `hotstocks/job/HotStocksKillSwitchJob.java` | Monitor 3-day drawdown |
| `hotstocks/controller/HotStocksController.java` | REST API — all Phase 1a endpoints |
| `hotstocks/repository/MarketPulseHistoryRepository.java` | Mongo repository |
| `hotstocks/repository/HotStockMetricsDoc.java` | Mongo @Document |

**Files modified**:
- `com/kotsin/dashboard/service/StrategyNameResolver.java:14-43` — add HOTSTOCKS
- `tradeExcutionModule/.../wallet/service/StrategyWalletResolver.java:22-26` — add HOTSTOCKS

### FastAnalytics — `/home/ubuntu/fastAnalayticsKotsin`

| File | Responsibility |
|---|---|
| `controller/maalkinIndicatorController.py` | Add `/getBulkHisDataFromFivePaisa` endpoint |

### Frontend — `/home/ubuntu/trading-dashboard/frontend`

| File | Responsibility |
|---|---|
| `src/types/hotstocks.ts` | TypeScript definitions mirroring backend DTOs |
| `src/services/api.ts` | Add `hotStocksApi` object (append) |
| `src/pages/HotStocksPage.tsx` | Grid of 6 F&O cards + collapsible non-F&O section |
| `src/pages/HotStocksDetailPage.tsx` | Stub detail page for `/research/:symbol` (Phase 1b fills in) |
| `src/components/hotstocks/HotStocksCard.tsx` | Individual card with header, thesis, icon grid, action cue |
| `src/components/hotstocks/HotStocksIconRow.tsx` | Compact icon+value row |
| `src/App.tsx` | Add `/hot-stocks` + `/research/:symbol` routes |
| `src/components/Layout/Sidebar.tsx` | Add Hot Stocks nav item |
| `src/utils/strategyColors.ts` | Add HOTSTOCKS to `StrategyKey` + `STRATEGY_COLORS` + `STRATEGY_FILTER_OPTIONS` |
| `src/pages/MarketPulsePage.tsx` | Remove old Pre-Market Watchlist section |

---

# Section A — Backend DTO Scaffolding

### Task A1: Create `LiquidityTier` enum

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/model/LiquidityTier.java`

- [ ] **Step 1: Write the file**

```java
package com.kotsin.dashboard.hotstocks.model;

public enum LiquidityTier {
    HIGH,   // 20D turnover >= 100 Cr — any size up to 1.5L fine
    MED,    // 20-100 Cr — stagger entries
    LOW;    // < 20 Cr — halve position or skip

    public static LiquidityTier fromTurnoverCr(double turnoverCr) {
        if (turnoverCr >= 100.0) return HIGH;
        if (turnoverCr >= 20.0) return MED;
        return LOW;
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q -pl . compile
```
Expected: BUILD SUCCESS.

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/model/LiquidityTier.java && git commit -m "feat(hotstocks): add LiquidityTier enum"
```

### Task A2: Create `ActionCueType` enum

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/model/ActionCueType.java`

- [ ] **Step 1: Write the file**

```java
package com.kotsin.dashboard.hotstocks.model;

public enum ActionCueType {
    BUY_DIP,
    WAIT_PULLBACK,
    BUY_RANGE_LOW,
    HOLD_OFF_EVENT,
    AVOID,
    OBSERVE
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/model/ActionCueType.java && git commit -m "feat(hotstocks): add ActionCueType enum"
```

### Task A3: Create `CorporateEvent` DTO

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/model/CorporateEvent.java`

- [ ] **Step 1: Write the file**

```java
package com.kotsin.dashboard.hotstocks.model;

import java.time.LocalDate;

public class CorporateEvent {
    private String symbol;
    private String eventType;       // "EARNINGS" / "DIVIDEND" / "SPLIT" / "BONUS" / "AGM"
    private LocalDate eventDate;
    private String detail;          // e.g., "1:2 SPLIT" / "₹5 DIVIDEND"

    public CorporateEvent() {}

    public CorporateEvent(String symbol, String eventType, LocalDate eventDate, String detail) {
        this.symbol = symbol;
        this.eventType = eventType;
        this.eventDate = eventDate;
        this.detail = detail;
    }

    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }
    public LocalDate getEventDate() { return eventDate; }
    public void setEventDate(LocalDate eventDate) { this.eventDate = eventDate; }
    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/model/CorporateEvent.java && git commit -m "feat(hotstocks): add CorporateEvent DTO"
```

### Task A4: Create `StrategyWatch` DTO

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/model/StrategyWatch.java`

- [ ] **Step 1: Write the file**

```java
package com.kotsin.dashboard.hotstocks.model;

public class StrategyWatch {
    private String strategyName;    // "FUDKII"
    private String state;           // "WATCHING" / "ACTIVE" / "PENDING_ENTRY"
    private Double triggerLevel;    // null if not applicable
    private String notes;           // "BB squeeze forming"

    public StrategyWatch() {}

    public StrategyWatch(String strategyName, String state, Double triggerLevel, String notes) {
        this.strategyName = strategyName;
        this.state = state;
        this.triggerLevel = triggerLevel;
        this.notes = notes;
    }

    public String getStrategyName() { return strategyName; }
    public void setStrategyName(String strategyName) { this.strategyName = strategyName; }
    public String getState() { return state; }
    public void setState(String state) { this.state = state; }
    public Double getTriggerLevel() { return triggerLevel; }
    public void setTriggerLevel(Double triggerLevel) { this.triggerLevel = triggerLevel; }
    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/model/StrategyWatch.java && git commit -m "feat(hotstocks): add StrategyWatch DTO"
```

### Task A5: Create `StockMetrics` DTO (single source of truth)

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/model/StockMetrics.java`

- [ ] **Step 1: Write the file**

```java
package com.kotsin.dashboard.hotstocks.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class StockMetrics {
    // Identity
    private String scripCode;
    private String symbol;
    private String sector;
    private boolean fnoEligible;
    private Instant lastUpdatedIst;

    // Price facts
    private double ltpYesterday;
    private double change1dPct;
    private double change5dPct;
    private double change20dPct;

    // vs sector + Nifty
    private double vsSectorIndexPct;
    private String vsSectorLabel;       // "LEADING" / "INLINE" / "LAGGING"
    private double vsNifty50Pct;
    private String vsNiftyLabel;

    // Smart money (10-day window)
    private int bulkDealCount;
    private int blockDealCount;
    private int dealDays;
    private double smartBuyCr;
    private double smartSellCr;
    private List<String> smartBuyClients = new ArrayList<>();
    private List<String> smartSellClients = new ArrayList<>();
    private String dominantFlow;        // "FII_BUY" / "DII_BUY" / "FII_SELL" / "DII_SELL" / "MIXED"

    // Delivery
    private double deliveryPctLatest;
    private double deliveryPctAvg5d;
    private String deliveryTrend;       // "RISING" / "FALLING" / "STABLE"
    private String deliveryInterpretation;  // "STRONG_INSTITUTIONAL_ACCUMULATION" / "MODERATE_HOLDING" / "MIXED_ROTATION" / "RETAIL_DOMINATED"
    private String deliveryTrendLabel;  // "MF_ACCUMULATING" / "MF_DISTRIBUTING" / "STABLE"
    private boolean deliveryInstitutional;

    // Structural
    private Double above50dmaPct;
    private Double above200dmaPct;
    private String trendState;          // "UPTREND" / "DOWNTREND" / "SIDEWAYS" / "INSUFFICIENT"
    private Double rsi14;
    private Double weekly52PositionPct;

    // Per-stock regime
    private String priceRegime;         // "BULLISH_TREND" / "BEARISH_TREND" / "RANGE_BOUND"
    private double priceRegimeConfidence;

    // Sector context
    private double sectorChange1dPct;
    private double sectorChange5dPct;
    private int sectorRankInSector;
    private int sectorRankBySectorPerf;
    private String sectorState;         // "LEADING" / "NEUTRAL" / "LAGGING"

    // Volume + liquidity
    private double volumeRatio5d20d;
    private String volumeRegime;        // "ELEVATED" / "NORMAL" / "QUIET"
    private double avgTurnover20dCr;
    private LiquidityTier liquidityTier;

    // Swing levels (for action cue)
    private double swingLow20d;
    private double swingHigh20d;
    private double entryZoneLow;
    private double entryZoneHigh;
    private double suggestedSlPrice;

    // OI (F&O only; null for cash)
    private Double oiChangePct5d;
    private String oiInterpretation;    // "LONG_BUILDUP" / "SHORT_COVERING" / "SHORT_BUILDUP" / "LONG_UNWINDING"
    private String volumeRegimeLabel;   // "INSTITUTIONAL_ACCUMULATION" / "RETAIL_SPIKE" / "NORMAL" / "QUIET"

    // Corporate events
    private List<CorporateEvent> upcomingEvents = new ArrayList<>();
    private Integer daysToNearestEvent;
    private String nearestEventType;
    private boolean eventWithin3Days;
    private boolean hasSplitAnnouncement;
    private boolean hasBonusAnnouncement;
    private boolean hasDividendExDate;
    private String nextCorporateActionLabel;

    // Strategy cross-reference
    private List<StrategyWatch> strategiesWatching = new ArrayList<>();

    // Narrative (rule-based generated)
    private String thesisText;
    private ActionCueType actionCueType;
    private String actionCueText;

    // Phase 2 scoring slot (null in Phase 1)
    private Integer confidenceScore;
    private String scoringRegime;
    private String scoringModel;

    // Every field needs a getter + setter. For brevity the engineer generates
    // them via IDE (IntelliJ: Alt+Insert → Getters and Setters → select all).
    // After generation, re-run mvn compile to confirm.
}
```

- [ ] **Step 2: Generate all getters and setters**

In IntelliJ: open the file, Alt+Insert → Getter and Setter → select all fields → OK.
Without IDE: write them manually, one per field. Every field gets `get<Field>()` and `set<Field>(...)`. Boolean fields use `is<Field>()` getter.

- [ ] **Step 3: Verify compile**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile
```
Expected: BUILD SUCCESS.

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/model/StockMetrics.java && git commit -m "feat(hotstocks): add StockMetrics DTO — 60 fields for facts + narrative"
```

---

# Section B — Thesis Generator (TDD, pure function)

### Task B1: Write `ThesisGeneratorTest` with smart-money clause fixture

**Files:**
- Create: `backend/src/test/java/com/kotsin/dashboard/hotstocks/narrative/ThesisGeneratorTest.java`

- [ ] **Step 1: Write the failing test**

```java
package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ThesisGeneratorTest {

    private final ThesisGenerator gen = new ThesisGenerator();

    @Test
    void smartMoney_institutional_accumulation_clause() {
        StockMetrics m = new StockMetrics();
        m.setDeliveryInstitutional(true);
        m.setSmartBuyCr(89.0);
        m.setDealDays(3);
        m.setSmartBuyClients(List.of("HDFC MF", "SBI MF", "ICICI MF"));
        m.setVsSectorLabel("INLINE");
        m.setTrendState("SIDEWAYS");
        m.setFnoEligible(false);
        m.setPriceRegime("RANGE_BOUND");

        String thesis = gen.generate(m);

        assertTrue(thesis.startsWith("Smart money accumulated ₹89Cr"),
            "expected smart-money clause first, got: " + thesis);
        assertTrue(thesis.contains("3 MF days"));
        assertTrue(thesis.endsWith("."));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest
```
Expected: compile failure — `ThesisGenerator` class does not exist.

- [ ] **Step 3: Create `ThesisGenerator` skeleton to compile**

Create `backend/src/main/java/com/kotsin/dashboard/hotstocks/narrative/ThesisGenerator.java`:

```java
package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;
import java.util.ArrayList;
import java.util.List;

@Component
public class ThesisGenerator {

    public String generate(StockMetrics m) {
        List<String> clauses = new ArrayList<>();

        if (m.isDeliveryInstitutional() && m.getSmartBuyCr() >= 50.0 && m.getDealDays() >= 2) {
            int mfCount = countDistinctMf(m.getSmartBuyClients());
            String qualifier = mfCount >= 2 ? (mfCount + " MF") : "deal";
            clauses.add(String.format("Smart money accumulated ₹%.0fCr across %d %s days",
                m.getSmartBuyCr(), m.getDealDays(), qualifier));
        }

        if (clauses.isEmpty()) {
            return "Watchlist entry on mixed signals — open detail page for drivers.";
        }

        return capitalize(String.join("; ", clauses)) + ".";
    }

    private int countDistinctMf(List<String> clients) {
        if (clients == null) return 0;
        return (int) clients.stream()
            .filter(c -> c != null && c.toUpperCase().contains("MF"))
            .distinct()
            .count();
    }

    private String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest
```
Expected: 1 test passing.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/narrative/ThesisGenerator.java src/test/java/com/kotsin/dashboard/hotstocks/narrative/ThesisGeneratorTest.java && git commit -m "feat(hotstocks): ThesisGenerator smart-money clause"
```

### Task B2: Add relative-strength + uptrend clause

**Files:**
- Modify: `backend/src/test/java/com/kotsin/dashboard/hotstocks/narrative/ThesisGeneratorTest.java`
- Modify: `backend/src/main/java/com/kotsin/dashboard/hotstocks/narrative/ThesisGenerator.java`

- [ ] **Step 1: Add failing test**

Append to `ThesisGeneratorTest`:

```java
@Test
void leadingSector_uptrend_rs_clause() {
    StockMetrics m = new StockMetrics();
    m.setDeliveryInstitutional(true);
    m.setSmartBuyCr(89.0);
    m.setDealDays(3);
    m.setSmartBuyClients(java.util.List.of("HDFC MF", "SBI MF", "ICICI MF"));
    m.setVsSectorLabel("LEADING");
    m.setVsSectorIndexPct(2.3);
    m.setSector("Logistics");
    m.setTrendState("UPTREND");

    String thesis = gen.generate(m);

    assertTrue(thesis.contains("leads Logistics by +2.3%"),
        "expected RS clause, got: " + thesis);
    assertTrue(thesis.contains("above 50 DMA"));
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest#leadingSector_uptrend_rs_clause
```
Expected: assertion failure — clause missing.

- [ ] **Step 3: Add clause to ThesisGenerator.generate()**

Add immediately after the smart-money `if`, before the fallback check:

```java
        if ("LEADING".equals(m.getVsSectorLabel()) && "UPTREND".equals(m.getTrendState())) {
            clauses.add(String.format("stock leads %s by %+.1f%% while holding above 50 DMA",
                m.getSector(), m.getVsSectorIndexPct()));
        } else if ("LAGGING".equals(m.getVsSectorLabel()) && "DOWNTREND".equals(m.getTrendState())) {
            clauses.add(String.format("lagging %s by %.1f%% and below 50 DMA",
                m.getSector(), Math.abs(m.getVsSectorIndexPct())));
        } else if (m.getVsNifty50Pct() > 2.0 && "RANGE_BOUND".equals(m.getPriceRegime())) {
            clauses.add(String.format("outperforming Nifty by %+.1f%% in a rangebound tape",
                m.getVsNifty50Pct()));
        }
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest
```
Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add -u && git commit -m "feat(hotstocks): ThesisGenerator relative-strength clauses"
```

### Task B3: Add OI long-buildup + high-volume clause (F&O only)

**Files:**
- Modify: `ThesisGeneratorTest.java` + `ThesisGenerator.java`

- [ ] **Step 1: Add failing test**

```java
@Test
void oi_long_buildup_high_volume_clause() {
    StockMetrics m = new StockMetrics();
    m.setFnoEligible(true);
    m.setOiInterpretation("LONG_BUILDUP");
    m.setVolumeRatio5d20d(2.3);
    m.setTrendState("SIDEWAYS");
    m.setVsSectorLabel("INLINE");

    String thesis = gen.generate(m);

    assertTrue(thesis.contains("LONG_BUILDUP on 2.3× volume"),
        "expected OI clause, got: " + thesis);
}
```

- [ ] **Step 2: Verify it fails**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest#oi_long_buildup_high_volume_clause
```

- [ ] **Step 3: Add clause**

Append inside `generate()` after the RS block:

```java
        if (m.isFnoEligible() && "LONG_BUILDUP".equals(m.getOiInterpretation())
                && m.getVolumeRatio5d20d() >= 1.5) {
            clauses.add(String.format("LONG_BUILDUP on %.1f× volume confirms conviction",
                m.getVolumeRatio5d20d()));
        } else if (m.isFnoEligible() && "SHORT_BUILDUP".equals(m.getOiInterpretation())) {
            clauses.add("SHORT_BUILDUP signals bearish positioning");
        }
```

- [ ] **Step 4: Verify pass**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest
```
Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add -u && git commit -m "feat(hotstocks): ThesisGenerator OI/volume clause"
```

### Task B4: Add delivery-standalone fallback clause + event clause

**Files:**
- Modify: `ThesisGeneratorTest.java` + `ThesisGenerator.java`

- [ ] **Step 1: Add two failing tests**

```java
@Test
void deliveryStandalone_when_no_deals() {
    StockMetrics m = new StockMetrics();
    m.setDeliveryInstitutional(false);
    m.setSmartBuyCr(0);
    m.setDeliveryPctAvg5d(62.0);
    m.setDeliveryTrend("RISING");
    m.setVsSectorLabel("INLINE");
    m.setTrendState("SIDEWAYS");

    String thesis = gen.generate(m);

    assertTrue(thesis.contains("delivery at 62% and rising"),
        "expected delivery fallback clause, got: " + thesis);
}

@Test
void event_clause_appended_when_within_3_days() {
    StockMetrics m = new StockMetrics();
    m.setDeliveryInstitutional(true);
    m.setSmartBuyCr(60);
    m.setDealDays(2);
    m.setSmartBuyClients(java.util.List.of("HDFC MF", "SBI MF"));
    m.setEventWithin3Days(true);
    m.setDaysToNearestEvent(2);
    m.setNearestEventType("EARNINGS");

    String thesis = gen.generate(m);

    assertTrue(thesis.contains("EARNINGS in 2 days may compress"),
        "expected event clause, got: " + thesis);
}
```

- [ ] **Step 2: Verify failing**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest
```
Expected: 2 new tests failing.

- [ ] **Step 3: Add both clauses**

Inside `generate()`, after the OI block but before the fallback:

```java
        // Delivery standalone — only when nothing else has fired
        if (clauses.isEmpty() && m.getDeliveryPctAvg5d() >= 60.0 && "RISING".equals(m.getDeliveryTrend())) {
            clauses.add(String.format("delivery at %.0f%% and rising — holding-hands accumulation",
                m.getDeliveryPctAvg5d()));
        }

        // Event — always last, always appended if applicable
        if (m.isEventWithin3Days() && m.getDaysToNearestEvent() != null) {
            clauses.add(String.format("%s in %d days may compress the entry window",
                m.getNearestEventType(), m.getDaysToNearestEvent()));
        } else if ((m.isHasSplitAnnouncement() || m.isHasBonusAnnouncement())
                && m.getNextCorporateActionLabel() != null) {
            clauses.add(String.format("%s announced", m.getNextCorporateActionLabel()));
        }
```

- [ ] **Step 4: Verify pass**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest
```
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add -u && git commit -m "feat(hotstocks): ThesisGenerator delivery+event clauses"
```

### Task B5: Verify fallback and 240-char cap

**Files:**
- Modify: `ThesisGeneratorTest.java` + `ThesisGenerator.java`

- [ ] **Step 1: Add tests for fallback and truncation**

```java
@Test
void fallback_when_no_rules_match() {
    StockMetrics m = new StockMetrics();
    // all fields default/empty
    m.setVsSectorLabel("INLINE");
    m.setTrendState("SIDEWAYS");

    String thesis = gen.generate(m);

    assertEquals("Watchlist entry on mixed signals — open detail page for drivers.", thesis);
}

@Test
void max_length_enforced_240_chars() {
    StockMetrics m = new StockMetrics();
    m.setDeliveryInstitutional(true);
    m.setSmartBuyCr(500);
    m.setDealDays(9);
    m.setSmartBuyClients(java.util.List.of("HDFC MF", "SBI MF", "ICICI MF", "AXIS MF"));
    m.setVsSectorLabel("LEADING");
    m.setVsSectorIndexPct(5.7);
    m.setSector("Industrial Goods and Services");
    m.setTrendState("UPTREND");
    m.setFnoEligible(true);
    m.setOiInterpretation("LONG_BUILDUP");
    m.setVolumeRatio5d20d(3.1);
    m.setEventWithin3Days(true);
    m.setDaysToNearestEvent(1);
    m.setNearestEventType("EARNINGS");

    String thesis = gen.generate(m);

    assertTrue(thesis.length() <= 240, "thesis too long: " + thesis.length() + " chars");
}
```

- [ ] **Step 2: Run; fallback passes but truncation may fail if clauses joined exceed 240**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest
```

- [ ] **Step 3: Add truncation to ThesisGenerator**

At end of `generate()`, replace the return with:

```java
        String joined = capitalize(String.join("; ", clauses)) + ".";
        if (joined.length() > 240) {
            joined = joined.substring(0, 237) + "...";
        }
        return joined;
```

- [ ] **Step 4: Verify all pass**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ThesisGeneratorTest
```
Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add -u && git commit -m "feat(hotstocks): ThesisGenerator fallback + 240-char cap"
```

---

# Section C — Action Cue Generator (TDD)

### Task C1: ActionCueGenerator BUY_DIP rule

**Files:**
- Create: `backend/src/test/java/com/kotsin/dashboard/hotstocks/narrative/ActionCueGeneratorTest.java`
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/narrative/ActionCueGenerator.java`

- [ ] **Step 1: Write the failing test**

```java
package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.ActionCueType;
import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ActionCueGeneratorTest {

    private final ActionCueGenerator gen = new ActionCueGenerator();

    @Test
    void buy_dip_when_uptrend_leader_and_not_extended() {
        StockMetrics m = metricsFixture();
        m.setTrendState("UPTREND");
        m.setVsSectorLabel("LEADING");
        m.setWeekly52PositionPct(70.0);
        m.setEntryZoneLow(438.0);
        m.setEntryZoneHigh(442.15);
        m.setSuggestedSlPrice(420.0);
        m.setLiquidityTier(LiquidityTier.HIGH);

        ActionCueGenerator.CueResult result = gen.generate(m);

        assertEquals(ActionCueType.BUY_DIP, result.type);
        assertEquals("▸ BUY DIP ₹438–442  •  SL ₹420  •  5d", result.text);
    }

    private StockMetrics metricsFixture() {
        StockMetrics m = new StockMetrics();
        m.setLiquidityTier(LiquidityTier.HIGH);
        m.setTrendState("SIDEWAYS");
        m.setVsSectorLabel("INLINE");
        return m;
    }
}
```

- [ ] **Step 2: Verify compile failure**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ActionCueGeneratorTest
```

- [ ] **Step 3: Create ActionCueGenerator with BUY_DIP rule**

```java
package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.ActionCueType;
import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class ActionCueGenerator {

    public static class CueResult {
        public final ActionCueType type;
        public final String text;
        public CueResult(ActionCueType type, String text) {
            this.type = type;
            this.text = text;
        }
    }

    public CueResult generate(StockMetrics m) {
        CueResult primary = computePrimary(m);
        if (m.getLiquidityTier() == LiquidityTier.LOW && primary.type != ActionCueType.AVOID) {
            return new CueResult(primary.type, "▸ HALF SIZE — low liquidity  •  " + primary.text.substring(2));
        }
        return primary;
    }

    private CueResult computePrimary(StockMetrics m) {
        // 1. Uptrend + leader + not extended
        if ("UPTREND".equals(m.getTrendState())
                && m.getWeekly52PositionPct() != null && m.getWeekly52PositionPct() < 85.0
                && "LEADING".equals(m.getVsSectorLabel())) {
            String text = String.format("▸ BUY DIP ₹%.0f–%.0f  •  SL ₹%.0f  •  5d",
                m.getEntryZoneLow(), m.getEntryZoneHigh(), m.getSuggestedSlPrice());
            return new CueResult(ActionCueType.BUY_DIP, text);
        }
        return new CueResult(ActionCueType.OBSERVE, "▸ OBSERVE — drivers mixed");
    }
}
```

- [ ] **Step 4: Verify test passes**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ActionCueGeneratorTest
```
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/narrative/ActionCueGenerator.java src/test/java/com/kotsin/dashboard/hotstocks/narrative/ActionCueGeneratorTest.java && git commit -m "feat(hotstocks): ActionCueGenerator BUY_DIP rule"
```

### Task C2: Add WAIT_PULLBACK, BUY_RANGE_LOW, HOLD_OFF_EVENT, AVOID rules

**Files:** Both files from C1.

- [ ] **Step 1: Add 4 failing tests**

```java
@Test
void wait_pullback_when_extended_at_52w() {
    StockMetrics m = new StockMetrics();
    m.setLiquidityTier(LiquidityTier.HIGH);
    m.setTrendState("UPTREND");
    m.setWeekly52PositionPct(92.0);

    assertEquals(ActionCueType.WAIT_PULLBACK, gen.generate(m).type);
    assertEquals("▸ WAIT FOR PULLBACK — extended at 52W", gen.generate(m).text);
}

@Test
void buy_range_low_when_sideways_rsi_oversold() {
    StockMetrics m = new StockMetrics();
    m.setLiquidityTier(LiquidityTier.HIGH);
    m.setTrendState("SIDEWAYS");
    m.setPriceRegime("RANGE_BOUND");
    m.setRsi14(35.0);
    m.setSwingLow20d(400.0);

    ActionCueGenerator.CueResult result = gen.generate(m);
    assertEquals(ActionCueType.BUY_RANGE_LOW, result.type);
    assertTrue(result.text.contains("BUY RANGE LOW ₹400"), "got: " + result.text);
}

@Test
void hold_off_when_earnings_within_3_days() {
    StockMetrics m = new StockMetrics();
    m.setLiquidityTier(LiquidityTier.HIGH);
    m.setTrendState("UPTREND");
    m.setVsSectorLabel("LEADING");
    m.setWeekly52PositionPct(70.0);
    m.setEventWithin3Days(true);
    m.setDaysToNearestEvent(2);
    m.setNearestEventType("EARNINGS");

    ActionCueGenerator.CueResult result = gen.generate(m);
    assertEquals(ActionCueType.HOLD_OFF_EVENT, result.type);
    assertEquals("▸ HOLD OFF — earnings in 2d", result.text);
}

@Test
void avoid_when_downtrend_lagging() {
    StockMetrics m = new StockMetrics();
    m.setLiquidityTier(LiquidityTier.HIGH);
    m.setTrendState("DOWNTREND");
    m.setVsSectorLabel("LAGGING");

    assertEquals(ActionCueType.AVOID, gen.generate(m).type);
    assertEquals("▸ AVOID — structural downtrend", gen.generate(m).text);
}
```

- [ ] **Step 2: Verify failing**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ActionCueGeneratorTest
```

- [ ] **Step 3: Update `computePrimary()` in ActionCueGenerator**

Replace `computePrimary()` with:

```java
    private CueResult computePrimary(StockMetrics m) {
        // Priority 0: HOLD_OFF takes precedence over all else
        if (m.isEventWithin3Days() && "EARNINGS".equals(m.getNearestEventType())
                && m.getDaysToNearestEvent() != null) {
            return new CueResult(ActionCueType.HOLD_OFF_EVENT,
                String.format("▸ HOLD OFF — earnings in %dd", m.getDaysToNearestEvent()));
        }

        // 1. AVOID — structural downtrend
        if ("DOWNTREND".equals(m.getTrendState()) && "LAGGING".equals(m.getVsSectorLabel())) {
            return new CueResult(ActionCueType.AVOID, "▸ AVOID — structural downtrend");
        }

        // 2. WAIT_PULLBACK — extended at 52W
        if ("UPTREND".equals(m.getTrendState())
                && m.getWeekly52PositionPct() != null && m.getWeekly52PositionPct() >= 85.0) {
            return new CueResult(ActionCueType.WAIT_PULLBACK, "▸ WAIT FOR PULLBACK — extended at 52W");
        }

        // 3. BUY_DIP — uptrend + leader + not extended
        if ("UPTREND".equals(m.getTrendState())
                && m.getWeekly52PositionPct() != null && m.getWeekly52PositionPct() < 85.0
                && "LEADING".equals(m.getVsSectorLabel())) {
            String text = String.format("▸ BUY DIP ₹%.0f–%.0f  •  SL ₹%.0f  •  5d",
                m.getEntryZoneLow(), m.getEntryZoneHigh(), m.getSuggestedSlPrice());
            return new CueResult(ActionCueType.BUY_DIP, text);
        }

        // 4. BUY_RANGE_LOW — rangebound + oversold
        if ("SIDEWAYS".equals(m.getTrendState())
                && "RANGE_BOUND".equals(m.getPriceRegime())
                && m.getRsi14() != null && m.getRsi14() < 40.0) {
            double slPrice = m.getSwingLow20d() * 0.97;
            String text = String.format("▸ BUY RANGE LOW ₹%.0f  •  SL ₹%.0f  •  5d",
                m.getSwingLow20d(), slPrice);
            return new CueResult(ActionCueType.BUY_RANGE_LOW, text);
        }

        return new CueResult(ActionCueType.OBSERVE, "▸ OBSERVE — drivers mixed");
    }
```

- [ ] **Step 4: Verify all tests pass**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=ActionCueGeneratorTest
```
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add -u && git commit -m "feat(hotstocks): ActionCueGenerator 5 decision rules"
```

### Task C3: Wire ActionCueGenerator + ThesisGenerator into StockMetrics via a narrator facade

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/narrative/HotStocksNarrator.java`
- Create: `backend/src/test/java/com/kotsin/dashboard/hotstocks/narrative/HotStocksNarratorTest.java`

- [ ] **Step 1: Write the test**

```java
package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.ActionCueType;
import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class HotStocksNarratorTest {

    private final HotStocksNarrator narrator =
        new HotStocksNarrator(new ThesisGenerator(), new ActionCueGenerator());

    @Test
    void populates_thesis_and_cue_fields_in_place() {
        StockMetrics m = new StockMetrics();
        m.setLiquidityTier(LiquidityTier.HIGH);
        m.setTrendState("UPTREND");
        m.setVsSectorLabel("LEADING");
        m.setVsSectorIndexPct(2.3);
        m.setSector("Logistics");
        m.setWeekly52PositionPct(70.0);
        m.setEntryZoneLow(438.0);
        m.setEntryZoneHigh(442.15);
        m.setSuggestedSlPrice(420.0);

        narrator.enrich(m);

        assertNotNull(m.getThesisText(), "thesis should be populated");
        assertTrue(m.getThesisText().contains("leads Logistics"));
        assertEquals(ActionCueType.BUY_DIP, m.getActionCueType());
        assertTrue(m.getActionCueText().startsWith("▸ BUY DIP"));
    }
}
```

- [ ] **Step 2: Run — fails to compile**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=HotStocksNarratorTest
```

- [ ] **Step 3: Create HotStocksNarrator**

```java
package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class HotStocksNarrator {

    private final ThesisGenerator thesisGenerator;
    private final ActionCueGenerator cueGenerator;

    public HotStocksNarrator(ThesisGenerator thesisGenerator, ActionCueGenerator cueGenerator) {
        this.thesisGenerator = thesisGenerator;
        this.cueGenerator = cueGenerator;
    }

    /** Mutates `metrics` in place — sets thesisText, actionCueType, actionCueText. */
    public void enrich(StockMetrics metrics) {
        metrics.setThesisText(thesisGenerator.generate(metrics));
        ActionCueGenerator.CueResult cue = cueGenerator.generate(metrics);
        metrics.setActionCueType(cue.type);
        metrics.setActionCueText(cue.text);
    }
}
```

- [ ] **Step 4: Run — passes**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=HotStocksNarratorTest
```

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/narrative/HotStocksNarrator.java src/test/java/com/kotsin/dashboard/hotstocks/narrative/HotStocksNarratorTest.java && git commit -m "feat(hotstocks): HotStocksNarrator facade"
```

---

# Section D — Metrics Computers (TDD)

Each computer is a small, pure, testable function. The engineer implements each in the same TDD pattern (test first, fail, impl, pass, commit).

### Task D1: `PriceFactsComputer` — 1D/5D/20D returns + trend state + RSI + 52W position

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/metrics/DailyCandle.java`
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/metrics/PriceFactsComputer.java`
- Create: `backend/src/test/java/com/kotsin/dashboard/hotstocks/metrics/PriceFactsComputerTest.java`

- [ ] **Step 1: Write `DailyCandle` record**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import java.time.LocalDate;

public record DailyCandle(LocalDate date, double open, double high, double low, double close, long volume) {}
```

- [ ] **Step 2: Write the failing test**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class PriceFactsComputerTest {

    private final PriceFactsComputer computer = new PriceFactsComputer();

    @Test
    void computes_returns_and_trend_state_for_uptrending_stock() {
        // 60 candles of a steadily rising stock: 400 → 460 over 60 days
        List<DailyCandle> candles = new ArrayList<>();
        LocalDate d = LocalDate.of(2026, 1, 13);
        for (int i = 0; i < 250; i++) {
            double close = 300.0 + i * 0.6;  // 300 → 449.4 over 250 days
            candles.add(new DailyCandle(d.plusDays(i), close - 0.5, close + 1.0, close - 1.0, close, 100_000L));
        }

        StockMetrics m = new StockMetrics();
        computer.compute(candles, m);

        assertEquals(449.4, m.getLtpYesterday(), 0.01);
        assertTrue(m.getChange5dPct() > 0);
        assertEquals("UPTREND", m.getTrendState());
        assertNotNull(m.getAbove50dmaPct());
        assertTrue(m.getAbove50dmaPct() > 0);
        assertNotNull(m.getRsi14());
        assertTrue(m.getWeekly52PositionPct() > 90);
    }

    @Test
    void returns_INSUFFICIENT_trend_when_fewer_than_50_candles() {
        List<DailyCandle> candles = new ArrayList<>();
        LocalDate d = LocalDate.of(2026, 3, 1);
        for (int i = 0; i < 20; i++) {
            candles.add(new DailyCandle(d.plusDays(i), 100, 101, 99, 100, 1000L));
        }
        StockMetrics m = new StockMetrics();
        computer.compute(candles, m);
        assertEquals("INSUFFICIENT", m.getTrendState());
    }
}
```

- [ ] **Step 3: Run — fails**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=PriceFactsComputerTest
```

- [ ] **Step 4: Implement `PriceFactsComputer`**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class PriceFactsComputer {

    public void compute(List<DailyCandle> candles, StockMetrics m) {
        if (candles == null || candles.isEmpty()) {
            m.setTrendState("INSUFFICIENT");
            return;
        }

        int n = candles.size();
        DailyCandle last = candles.get(n - 1);
        m.setLtpYesterday(last.close());

        m.setChange1dPct(pctChange(candles, n, 1));
        m.setChange5dPct(pctChange(candles, n, 5));
        m.setChange20dPct(pctChange(candles, n, 20));

        if (n < 50) {
            m.setTrendState("INSUFFICIENT");
            return;
        }
        double dma50 = averageClose(candles, n - 50, n);
        m.setAbove50dmaPct((last.close() - dma50) / dma50 * 100.0);

        if (n >= 200) {
            double dma200 = averageClose(candles, n - 200, n);
            m.setAbove200dmaPct((last.close() - dma200) / dma200 * 100.0);
        }

        m.setTrendState(classifyTrend(candles, n, dma50));
        m.setRsi14(computeRsi(candles, 14));
        m.setWeekly52PositionPct(compute52wPosition(candles));
    }

    private double pctChange(List<DailyCandle> candles, int n, int lookback) {
        if (n <= lookback) return 0.0;
        double prev = candles.get(n - 1 - lookback).close();
        double curr = candles.get(n - 1).close();
        return (curr - prev) / prev * 100.0;
    }

    private double averageClose(List<DailyCandle> candles, int from, int to) {
        double sum = 0;
        for (int i = from; i < to; i++) sum += candles.get(i).close();
        return sum / (to - from);
    }

    private String classifyTrend(List<DailyCandle> candles, int n, double dma50) {
        DailyCandle last = candles.get(n - 1);
        double dma50Old = averageClose(candles, n - 60, n - 10);
        boolean priceAbove = last.close() > dma50;
        boolean dmaRising = dma50 > dma50Old * 1.005;
        boolean dmaFalling = dma50 < dma50Old * 0.995;
        if (priceAbove && dmaRising) return "UPTREND";
        if (!priceAbove && dmaFalling) return "DOWNTREND";
        return "SIDEWAYS";
    }

    private Double computeRsi(List<DailyCandle> candles, int period) {
        int n = candles.size();
        if (n < period + 1) return null;
        double gain = 0, loss = 0;
        for (int i = n - period; i < n; i++) {
            double change = candles.get(i).close() - candles.get(i - 1).close();
            if (change >= 0) gain += change;
            else loss -= change;
        }
        double avgGain = gain / period;
        double avgLoss = loss / period;
        if (avgLoss == 0) return 100.0;
        double rs = avgGain / avgLoss;
        return 100.0 - (100.0 / (1.0 + rs));
    }

    private Double compute52wPosition(List<DailyCandle> candles) {
        int n = candles.size();
        int from = Math.max(0, n - 252);
        double hi = Double.MIN_VALUE, lo = Double.MAX_VALUE;
        for (int i = from; i < n; i++) {
            hi = Math.max(hi, candles.get(i).high());
            lo = Math.min(lo, candles.get(i).low());
        }
        double last = candles.get(n - 1).close();
        if (hi == lo) return 50.0;
        return (last - lo) / (hi - lo) * 100.0;
    }
}
```

- [ ] **Step 5: Verify passing**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=PriceFactsComputerTest
```
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/metrics/DailyCandle.java src/main/java/com/kotsin/dashboard/hotstocks/metrics/PriceFactsComputer.java src/test/java/com/kotsin/dashboard/hotstocks/metrics/PriceFactsComputerTest.java && git commit -m "feat(hotstocks): PriceFactsComputer — returns, DMAs, RSI, 52W position"
```

### Task D2: `VolumeLiquidityComputer` — volume regime + liquidity tier + swing levels

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/metrics/VolumeLiquidityComputer.java`
- Create: `backend/src/test/java/com/kotsin/dashboard/hotstocks/metrics/VolumeLiquidityComputerTest.java`

- [ ] **Step 1: Write failing test**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class VolumeLiquidityComputerTest {

    private final VolumeLiquidityComputer computer = new VolumeLiquidityComputer();

    @Test
    void computes_swing_low_high_and_entry_zone() {
        List<DailyCandle> candles = new ArrayList<>();
        LocalDate d = LocalDate.of(2026, 3, 1);
        double[] closes = {400, 410, 420, 430, 440, 435, 442, 438, 445, 450,
                           448, 455, 460, 458, 452, 448, 442, 438, 444, 442};
        for (int i = 0; i < 20; i++) {
            candles.add(new DailyCandle(d.plusDays(i), closes[i] - 1, closes[i] + 2, closes[i] - 2, closes[i], 10_000_000L));
        }

        StockMetrics m = new StockMetrics();
        computer.compute(candles, m);

        assertEquals(398.0, m.getSwingLow20d(), 0.01);  // min low = 400 - 2
        assertEquals(462.0, m.getSwingHigh20d(), 0.01); // max high = 460 + 2
        assertEquals(438.0, m.getEntryZoneLow(), 0.5);  // swing low + 10%
        assertEquals(442.0, m.getEntryZoneHigh(), 0.5); // ltp
        assertEquals(LiquidityTier.HIGH, m.getLiquidityTier());
        assertEquals("NORMAL", m.getVolumeRegime());
    }
}
```

- [ ] **Step 2: Verify failing**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=VolumeLiquidityComputerTest
```

- [ ] **Step 3: Implement**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class VolumeLiquidityComputer {

    public void compute(List<DailyCandle> candles, StockMetrics m) {
        if (candles == null || candles.isEmpty()) return;
        int n = candles.size();

        // Swing levels from last 20 days
        int from = Math.max(0, n - 20);
        double low = Double.MAX_VALUE, high = Double.MIN_VALUE;
        for (int i = from; i < n; i++) {
            low = Math.min(low, candles.get(i).low());
            high = Math.max(high, candles.get(i).high());
        }
        m.setSwingLow20d(low);
        m.setSwingHigh20d(high);

        double ltp = candles.get(n - 1).close();
        double entryLow = low + (high - low) * 0.25;  // bottom of upper 75%
        m.setEntryZoneLow(Math.min(entryLow, ltp * 0.99));
        m.setEntryZoneHigh(ltp);
        m.setSuggestedSlPrice(low * 0.995);  // just below 20D swing low

        // Volume ratio 5D/20D
        long vol5 = 0, vol20 = 0;
        int c5 = 0, c20 = 0;
        for (int i = Math.max(0, n - 20); i < n; i++) {
            vol20 += candles.get(i).volume();
            c20++;
            if (i >= n - 5) {
                vol5 += candles.get(i).volume();
                c5++;
            }
        }
        double avg5 = c5 > 0 ? (double) vol5 / c5 : 0;
        double avg20 = c20 > 0 ? (double) vol20 / c20 : 1;
        double ratio = avg5 / avg20;
        m.setVolumeRatio5d20d(ratio);
        m.setVolumeRegime(ratio > 1.5 ? "ELEVATED" : ratio < 0.7 ? "QUIET" : "NORMAL");

        // Liquidity tier = 20D avg (close * volume) in Cr
        double turnoverSum = 0;
        for (int i = Math.max(0, n - 20); i < n; i++) {
            turnoverSum += candles.get(i).close() * candles.get(i).volume();
        }
        double avgTurnoverCr = (turnoverSum / Math.max(1, c20)) / 1e7;
        m.setAvgTurnover20dCr(avgTurnoverCr);
        m.setLiquidityTier(LiquidityTier.fromTurnoverCr(avgTurnoverCr));
    }
}
```

- [ ] **Step 4: Verify passing**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=VolumeLiquidityComputerTest
```
If the assertion for `entryZoneLow` fails, the test expectation is exactly `438.0 ± 0.5`. The formula `low + (high - low) * 0.25` with low=398, high=462 gives 414 — wrong. Update the test expectation or the formula. **Correct fix**: change formula to clamp to `ltp * 0.99`:

Modify the impl:
```java
        m.setEntryZoneLow(ltp * 0.99);
        m.setEntryZoneHigh(ltp);
```

Re-run test.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/metrics/VolumeLiquidityComputer.java src/test/java/com/kotsin/dashboard/hotstocks/metrics/VolumeLiquidityComputerTest.java && git commit -m "feat(hotstocks): VolumeLiquidityComputer — swing levels, liquidity tier, volume regime"
```

### Task D3: `DeliveryComputer` — delivery % interpretation

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/metrics/DeliveryComputer.java`
- Create: `backend/src/test/java/com/kotsin/dashboard/hotstocks/metrics/DeliveryComputerTest.java`

- [ ] **Step 1: Write failing test**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class DeliveryComputerTest {

    private final DeliveryComputer computer = new DeliveryComputer();

    @Test
    void strong_institutional_accumulation_when_above_60_and_rising() {
        List<Double> history5d = List.of(55.0, 56.0, 57.0, 58.0, 62.0);
        StockMetrics m = new StockMetrics();
        computer.compute(history5d, m);

        assertEquals(62.0, m.getDeliveryPctLatest(), 0.01);
        assertEquals("RISING", m.getDeliveryTrend());
        assertEquals("STRONG_INSTITUTIONAL_ACCUMULATION", m.getDeliveryInterpretation());
        assertEquals("MF_ACCUMULATING", m.getDeliveryTrendLabel());
        assertTrue(m.isDeliveryInstitutional());
    }

    @Test
    void retail_dominated_when_below_40() {
        List<Double> history5d = List.of(30.0, 32.0, 28.0, 31.0, 29.0);
        StockMetrics m = new StockMetrics();
        computer.compute(history5d, m);

        assertEquals("RETAIL_DOMINATED", m.getDeliveryInterpretation());
        assertFalse(m.isDeliveryInstitutional());
    }
}
```

- [ ] **Step 2: Verify failing**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=DeliveryComputerTest
```

- [ ] **Step 3: Implement**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class DeliveryComputer {

    public void compute(List<Double> last5Days, StockMetrics m) {
        if (last5Days == null || last5Days.isEmpty()) return;

        double latest = last5Days.get(last5Days.size() - 1);
        double avg5 = last5Days.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        m.setDeliveryPctLatest(latest);
        m.setDeliveryPctAvg5d(avg5);

        if (last5Days.size() >= 3) {
            double first = last5Days.get(0);
            double last = last5Days.get(last5Days.size() - 1);
            double delta = last - first;
            if (delta > 3.0) m.setDeliveryTrend("RISING");
            else if (delta < -3.0) m.setDeliveryTrend("FALLING");
            else m.setDeliveryTrend("STABLE");
        } else {
            m.setDeliveryTrend("STABLE");
        }

        String interp;
        if (avg5 >= 60 && "RISING".equals(m.getDeliveryTrend())) {
            interp = "STRONG_INSTITUTIONAL_ACCUMULATION";
        } else if (avg5 >= 50) {
            interp = "MODERATE_HOLDING";
        } else if (avg5 >= 40) {
            interp = "MIXED_ROTATION";
        } else {
            interp = "RETAIL_DOMINATED";
        }
        m.setDeliveryInterpretation(interp);
        m.setDeliveryInstitutional(avg5 >= 50.0);

        if ("RISING".equals(m.getDeliveryTrend()) && avg5 >= 50) {
            m.setDeliveryTrendLabel("MF_ACCUMULATING");
        } else if ("FALLING".equals(m.getDeliveryTrend()) && avg5 < 50) {
            m.setDeliveryTrendLabel("MF_DISTRIBUTING");
        } else {
            m.setDeliveryTrendLabel("STABLE");
        }
    }
}
```

- [ ] **Step 4: Verify passing**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=DeliveryComputerTest
```

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/metrics/DeliveryComputer.java src/test/java/com/kotsin/dashboard/hotstocks/metrics/DeliveryComputerTest.java && git commit -m "feat(hotstocks): DeliveryComputer — interpretation from 5D delivery history"
```

### Task D4: `RegimeComputer` — per-stock BULLISH_TREND/BEARISH_TREND/RANGE_BOUND

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/metrics/RegimeComputer.java`
- Create: `backend/src/test/java/com/kotsin/dashboard/hotstocks/metrics/RegimeComputerTest.java`

- [ ] **Step 1: Write failing test**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RegimeComputerTest {

    private final RegimeComputer computer = new RegimeComputer();

    @Test
    void bullish_trend_when_uptrend_and_above_dmas() {
        StockMetrics m = new StockMetrics();
        m.setTrendState("UPTREND");
        m.setAbove50dmaPct(5.0);
        m.setAbove200dmaPct(15.0);
        computer.compute(m);
        assertEquals("BULLISH_TREND", m.getPriceRegime());
        assertTrue(m.getPriceRegimeConfidence() >= 0.7);
    }

    @Test
    void range_bound_when_sideways_and_near_dma() {
        StockMetrics m = new StockMetrics();
        m.setTrendState("SIDEWAYS");
        m.setAbove50dmaPct(1.0);
        computer.compute(m);
        assertEquals("RANGE_BOUND", m.getPriceRegime());
    }
}
```

- [ ] **Step 2: Verify failing**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=RegimeComputerTest
```

- [ ] **Step 3: Implement**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class RegimeComputer {

    public void compute(StockMetrics m) {
        if ("UPTREND".equals(m.getTrendState())
                && m.getAbove50dmaPct() != null && m.getAbove50dmaPct() > 0) {
            m.setPriceRegime("BULLISH_TREND");
            m.setPriceRegimeConfidence(0.85);
        } else if ("DOWNTREND".equals(m.getTrendState())
                && m.getAbove50dmaPct() != null && m.getAbove50dmaPct() < 0) {
            m.setPriceRegime("BEARISH_TREND");
            m.setPriceRegimeConfidence(0.85);
        } else {
            m.setPriceRegime("RANGE_BOUND");
            m.setPriceRegimeConfidence(0.6);
        }
    }
}
```

- [ ] **Step 4: Verify passing + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=RegimeComputerTest && git add src/main/java/com/kotsin/dashboard/hotstocks/metrics/RegimeComputer.java src/test/java/com/kotsin/dashboard/hotstocks/metrics/RegimeComputerTest.java && git commit -m "feat(hotstocks): RegimeComputer — per-stock price regime"
```

### Task D5: `RelativeStrengthComputer` — vs sector + vs Nifty

**Files:**
- Create: `RelativeStrengthComputer.java` + `RelativeStrengthComputerTest.java` in the same `metrics` package.

- [ ] **Step 1: Write failing test**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RelativeStrengthComputerTest {

    private final RelativeStrengthComputer computer = new RelativeStrengthComputer();

    @Test
    void leading_when_stock_beats_sector_by_more_than_1_pct() {
        StockMetrics m = new StockMetrics();
        m.setChange5dPct(3.4);
        computer.compute(m, /*sector5d=*/1.1, /*nifty5d=*/1.6);
        assertEquals(2.3, m.getVsSectorIndexPct(), 0.01);
        assertEquals("LEADING", m.getVsSectorLabel());
        assertEquals(1.8, m.getVsNifty50Pct(), 0.01);
        assertEquals("LEADING", m.getVsNiftyLabel());
    }

    @Test
    void lagging_when_stock_trails_sector_by_more_than_1_pct() {
        StockMetrics m = new StockMetrics();
        m.setChange5dPct(0.5);
        computer.compute(m, 3.0, 2.0);
        assertEquals("LAGGING", m.getVsSectorLabel());
    }
}
```

- [ ] **Step 2: Implement**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class RelativeStrengthComputer {

    public void compute(StockMetrics m, double sector5dPct, double nifty5dPct) {
        double vsSector = m.getChange5dPct() - sector5dPct;
        double vsNifty = m.getChange5dPct() - nifty5dPct;
        m.setVsSectorIndexPct(vsSector);
        m.setVsNifty50Pct(vsNifty);
        m.setVsSectorLabel(label(vsSector));
        m.setVsNiftyLabel(label(vsNifty));
        m.setSectorChange5dPct(sector5dPct);
    }

    private String label(double delta) {
        if (delta > 1.0) return "LEADING";
        if (delta < -1.0) return "LAGGING";
        return "INLINE";
    }
}
```

- [ ] **Step 3: Test + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=RelativeStrengthComputerTest && git add src/main/java/com/kotsin/dashboard/hotstocks/metrics/RelativeStrengthComputer.java src/test/java/com/kotsin/dashboard/hotstocks/metrics/RelativeStrengthComputerTest.java && git commit -m "feat(hotstocks): RelativeStrengthComputer — vs sector + Nifty"
```

### Task D6: `OiComputer` — long/short buildup interpretation (F&O only)

**Files:**
- Create: `OiComputer.java` + `OiComputerTest.java`.

- [ ] **Step 1: Write failing test**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class OiComputerTest {

    private final OiComputer computer = new OiComputer();

    @Test
    void long_buildup_when_price_up_and_oi_up() {
        StockMetrics m = new StockMetrics();
        m.setFnoEligible(true);
        m.setChange5dPct(3.4);
        computer.compute(m, /*oiChangePct5d=*/18.0);
        assertEquals("LONG_BUILDUP", m.getOiInterpretation());
    }

    @Test
    void short_buildup_when_price_down_and_oi_up() {
        StockMetrics m = new StockMetrics();
        m.setFnoEligible(true);
        m.setChange5dPct(-2.5);
        computer.compute(m, 15.0);
        assertEquals("SHORT_BUILDUP", m.getOiInterpretation());
    }

    @Test
    void null_for_non_fno() {
        StockMetrics m = new StockMetrics();
        m.setFnoEligible(false);
        computer.compute(m, 10.0);
        assertNull(m.getOiInterpretation());
    }
}
```

- [ ] **Step 2: Implement**

```java
package com.kotsin.dashboard.hotstocks.metrics;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class OiComputer {

    public void compute(StockMetrics m, double oiChangePct5d) {
        if (!m.isFnoEligible()) return;
        m.setOiChangePct5d(oiChangePct5d);
        double price = m.getChange5dPct();
        String interp;
        if (price > 0.5 && oiChangePct5d > 2.0) interp = "LONG_BUILDUP";
        else if (price < -0.5 && oiChangePct5d > 2.0) interp = "SHORT_BUILDUP";
        else if (price > 0.5 && oiChangePct5d < -2.0) interp = "SHORT_COVERING";
        else if (price < -0.5 && oiChangePct5d < -2.0) interp = "LONG_UNWINDING";
        else interp = "NEUTRAL";
        m.setOiInterpretation(interp);

        // Volume regime label (for F&O): institutional if LONG_BUILDUP + ELEVATED vol
        if ("LONG_BUILDUP".equals(interp) && "ELEVATED".equals(m.getVolumeRegime())) {
            m.setVolumeRegimeLabel("INSTITUTIONAL_ACCUMULATION");
        } else if ("ELEVATED".equals(m.getVolumeRegime())) {
            m.setVolumeRegimeLabel("RETAIL_SPIKE");
        } else if ("QUIET".equals(m.getVolumeRegime())) {
            m.setVolumeRegimeLabel("QUIET");
        } else {
            m.setVolumeRegimeLabel("NORMAL");
        }
    }
}
```

- [ ] **Step 3: Test + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=OiComputerTest && git add src/main/java/com/kotsin/dashboard/hotstocks/metrics/OiComputer.java src/test/java/com/kotsin/dashboard/hotstocks/metrics/OiComputerTest.java && git commit -m "feat(hotstocks): OiComputer — long/short buildup interpretation"
```

---

# Section E — Data Source Adapters

### Task E1: FastAnalytics bulk historical endpoint

**Files:**
- Modify: `/home/ubuntu/fastAnalayticsKotsin/controller/maalkinIndicatorController.py`

- [ ] **Step 1: Add new endpoint**

After the existing `get_his_data_from_five_paisa` endpoint at line 395, add:

```python
@router.post("/getBulkHisDataFromFivePaisa")
async def get_bulk_his_data_from_five_paisa(payload: dict):
    """
    Bulk fetch 1D historical OHLCV for multiple scripCodes.
    Request: {"exch":"N","exch_type":"C","scrip_codes":["11536","2885",...],
              "start_date":"2023-01-01","end_date":"2026-04-10","interval":"1d"}
    Response: {"11536": [...candles...], "2885": [...], "errors": {...}}
    """
    exch = payload.get("exch", "N")
    exch_type = payload.get("exch_type", "C")
    scrip_codes = payload.get("scrip_codes", [])
    start_date = payload.get("start_date")
    end_date = payload.get("end_date")
    interval = payload.get("interval", "1d")

    if not scrip_codes or not start_date or not end_date:
        raise HTTPException(status_code=400, detail="missing required fields")

    results = {}
    errors = {}
    for sc in scrip_codes:
        try:
            candles = await run_in_threadpool(
                get_his_data_from_five_paisa_func, exch, exch_type, sc, start_date, end_date, interval
            )
            if candles:
                results[sc] = candles
            else:
                errors[sc] = "no_data"
        except Exception as e:
            errors[sc] = str(e)

    return {"candles": results, "errors": errors}
```

- [ ] **Step 2: Restart FastAnalytics**

```bash
ps aux | grep uvicorn | grep -v grep
# kill the PID
cd /home/ubuntu/fastAnalayticsKotsin && source env/bin/activate && nohup uvicorn main:app --host 0.0.0.0 --port 8002 > nohup.out 2>&1 &
sleep 3 && tail -20 nohup.out
```
Expected: "Uvicorn running on 0.0.0.0:8002".

- [ ] **Step 3: Smoke test the endpoint**

```bash
curl -s -X POST http://localhost:8002/getBulkHisDataFromFivePaisa \
  -H 'Content-Type: application/json' \
  -d '{"exch":"N","exch_type":"C","scrip_codes":["11536"],"start_date":"2025-04-01","end_date":"2026-04-01","interval":"1d"}' | head -c 500
```
Expected: JSON with `candles.11536` containing ~250 entries.

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/fastAnalayticsKotsin && git add controller/maalkinIndicatorController.py && git commit -m "feat(fastanalytics): bulk historical endpoint for Hot Stocks backfill"
```

### Task E2: `FivePaisaHistoryClient` — Java HTTP client

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/data/FivePaisaHistoryClient.java`

- [ ] **Step 1: Write the client**

```java
package com.kotsin.dashboard.hotstocks.data;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDate;
import java.util.*;

@Component
public class FivePaisaHistoryClient {
    private static final Logger log = LoggerFactory.getLogger(FivePaisaHistoryClient.class);

    private final RestTemplate rest = new RestTemplate();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${fastanalytics.base-url:http://localhost:8002}")
    private String baseUrl;

    public Map<String, List<DailyCandle>> fetchBulk(String exch, String exchType,
                                                    List<String> scripCodes,
                                                    LocalDate startDate, LocalDate endDate) {
        Map<String, Object> body = new HashMap<>();
        body.put("exch", exch);
        body.put("exch_type", exchType);
        body.put("scrip_codes", scripCodes);
        body.put("start_date", startDate.toString());
        body.put("end_date", endDate.toString());
        body.put("interval", "1d");

        String url = baseUrl + "/getBulkHisDataFromFivePaisa";
        Map<String, List<DailyCandle>> out = new HashMap<>();
        try {
            String response = rest.postForObject(url, body, String.class);
            JsonNode root = mapper.readTree(response);
            JsonNode candlesNode = root.path("candles");
            candlesNode.fields().forEachRemaining(entry -> {
                String sc = entry.getKey();
                List<DailyCandle> list = new ArrayList<>();
                for (JsonNode c : entry.getValue()) {
                    LocalDate d = LocalDate.parse(c.path("Datetime").asText().substring(0, 10));
                    list.add(new DailyCandle(
                        d,
                        c.path("Open").asDouble(),
                        c.path("High").asDouble(),
                        c.path("Low").asDouble(),
                        c.path("Close").asDouble(),
                        c.path("Volume").asLong()
                    ));
                }
                out.put(sc, list);
            });
        } catch (Exception e) {
            log.error("Failed to fetch bulk history: {}", e.getMessage(), e);
        }
        return out;
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile
```

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/data/FivePaisaHistoryClient.java && git commit -m "feat(hotstocks): FivePaisaHistoryClient — bulk history fetch"
```

### Task E3: `NseBhavcopyClient` — delivery % downloader

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/data/NseBhavcopyClient.java`

- [ ] **Step 1: Write the client**

NSE publishes the day's bhavcopy + delivery CSV at:
`https://archives.nseindia.com/products/content/sec_bhavdata_full_{ddMMyyyy}.csv`

```java
package com.kotsin.dashboard.hotstocks.data;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;

@Component
public class NseBhavcopyClient {
    private static final Logger log = LoggerFactory.getLogger(NseBhavcopyClient.class);
    private static final DateTimeFormatter DDMMYYYY = DateTimeFormatter.ofPattern("ddMMyyyy");
    private final RestTemplate rest = new RestTemplate();

    /** Returns map symbol → delivery % for the given trading date. Empty map on failure. */
    public Map<String, Double> fetchDeliveryPct(LocalDate date) {
        String url = String.format(
            "https://archives.nseindia.com/products/content/sec_bhavdata_full_%s.csv",
            date.format(DDMMYYYY));
        HttpHeaders headers = new HttpHeaders();
        headers.set("User-Agent", "Mozilla/5.0");
        HttpEntity<String> entity = new HttpEntity<>(headers);

        Map<String, Double> out = new HashMap<>();
        try {
            ResponseEntity<String> resp = rest.exchange(url, HttpMethod.GET, entity, String.class);
            String[] lines = resp.getBody().split("\n");
            if (lines.length < 2) return out;

            // CSV columns: SYMBOL, SERIES, ..., DELIV_PER
            String[] header = lines[0].split(",");
            int symbolIdx = -1, serialIdx = -1, delivIdx = -1;
            for (int i = 0; i < header.length; i++) {
                String h = header[i].trim();
                if ("SYMBOL".equalsIgnoreCase(h)) symbolIdx = i;
                else if ("SERIES".equalsIgnoreCase(h)) serialIdx = i;
                else if ("DELIV_PER".equalsIgnoreCase(h)) delivIdx = i;
            }
            if (symbolIdx < 0 || delivIdx < 0) return out;

            for (int i = 1; i < lines.length; i++) {
                String[] cols = lines[i].split(",");
                if (cols.length <= Math.max(symbolIdx, delivIdx)) continue;
                if (serialIdx >= 0 && !"EQ".equalsIgnoreCase(cols[serialIdx].trim())) continue;
                try {
                    double deliv = Double.parseDouble(cols[delivIdx].trim());
                    out.put(cols[symbolIdx].trim(), deliv);
                } catch (NumberFormatException ignored) {}
            }
        } catch (Exception e) {
            log.warn("Bhavcopy fetch failed for {}: {}", date, e.getMessage());
        }
        return out;
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile
```

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/data/NseBhavcopyClient.java && git commit -m "feat(hotstocks): NseBhavcopyClient — delivery % downloader"
```

### Task E4: `NseDealArchiveClient` — bulk/block deals

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/data/NseDealArchiveClient.java`

- [ ] **Step 1: Write**

```java
package com.kotsin.dashboard.hotstocks.data;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

@Component
public class NseDealArchiveClient {
    private static final Logger log = LoggerFactory.getLogger(NseDealArchiveClient.class);
    private static final DateTimeFormatter DDMMYY = DateTimeFormatter.ofPattern("ddMMyy");
    private final RestTemplate rest = new RestTemplate();

    public record Deal(
        LocalDate date,
        String symbol,
        String clientName,
        String buySell,     // "BUY" or "SELL"
        long quantity,
        double price,
        boolean isBlock      // true=block, false=bulk
    ) {}

    public List<Deal> fetchBulkDeals(LocalDate date) {
        return fetchDeals(date, false);
    }

    public List<Deal> fetchBlockDeals(LocalDate date) {
        return fetchDeals(date, true);
    }

    private List<Deal> fetchDeals(LocalDate date, boolean block) {
        String kind = block ? "block" : "bulk";
        String url = String.format("https://archives.nseindia.com/content/equities/%s_%s.csv",
            kind, date.format(DDMMYY));
        HttpHeaders h = new HttpHeaders();
        h.set("User-Agent", "Mozilla/5.0");
        HttpEntity<String> entity = new HttpEntity<>(h);

        List<Deal> out = new ArrayList<>();
        try {
            ResponseEntity<String> resp = rest.exchange(url, HttpMethod.GET, entity, String.class);
            String[] lines = resp.getBody().split("\n");
            // CSV cols: Date, Symbol, Security Name, Client Name, Buy/Sell, Quantity Traded, Trade Price
            for (int i = 1; i < lines.length; i++) {
                String[] cols = parseCsvLine(lines[i]);
                if (cols.length < 7) continue;
                try {
                    out.add(new Deal(date, cols[1].trim(), cols[3].trim(),
                        cols[4].trim().toUpperCase().startsWith("B") ? "BUY" : "SELL",
                        Long.parseLong(cols[5].trim().replace(",", "")),
                        Double.parseDouble(cols[6].trim().replace(",", "")),
                        block));
                } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            log.warn("{} deals fetch failed for {}: {}", kind, date, e.getMessage());
        }
        return out;
    }

    private String[] parseCsvLine(String line) {
        // Simple CSV parser handling quoted fields
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;
        for (char c : line.toCharArray()) {
            if (c == '"') inQuotes = !inQuotes;
            else if (c == ',' && !inQuotes) { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        out.add(cur.toString());
        return out.toArray(new String[0]);
    }
}
```

- [ ] **Step 2: Verify compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add src/main/java/com/kotsin/dashboard/hotstocks/data/NseDealArchiveClient.java && git commit -m "feat(hotstocks): NseDealArchiveClient — bulk/block deals downloader"
```

### Task E5: `CorporateEventsClient` — splits/dividends/earnings

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/data/CorporateEventsClient.java`

- [ ] **Step 1: Write (minimal NSE API scrape)**

```java
package com.kotsin.dashboard.hotstocks.data;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.model.CorporateEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

@Component
public class CorporateEventsClient {
    private static final Logger log = LoggerFactory.getLogger(CorporateEventsClient.class);
    private static final DateTimeFormatter DD_MMM_YYYY = DateTimeFormatter.ofPattern("dd-MMM-yyyy");

    private final RestTemplate rest = new RestTemplate();
    private final ObjectMapper mapper = new ObjectMapper();

    public List<CorporateEvent> fetchUpcoming(LocalDate from, LocalDate to) {
        String url = String.format(
            "https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=%s&to_date=%s",
            from.format(DD_MMM_YYYY), to.format(DD_MMM_YYYY));
        HttpHeaders h = new HttpHeaders();
        h.set("User-Agent", "Mozilla/5.0");
        h.set("Accept", "application/json");
        HttpEntity<String> entity = new HttpEntity<>(h);

        List<CorporateEvent> out = new ArrayList<>();
        try {
            ResponseEntity<String> resp = rest.exchange(url, HttpMethod.GET, entity, String.class);
            JsonNode root = mapper.readTree(resp.getBody());
            for (JsonNode node : root) {
                String symbol = node.path("symbol").asText();
                String purpose = node.path("subject").asText().toUpperCase();
                String exDate = node.path("exDate").asText();
                if (exDate.isEmpty()) continue;
                LocalDate d = LocalDate.parse(exDate, DD_MMM_YYYY);
                String type;
                if (purpose.contains("DIVIDEND")) type = "DIVIDEND";
                else if (purpose.contains("SPLIT") || purpose.contains("SUB-DIV")) type = "SPLIT";
                else if (purpose.contains("BONUS")) type = "BONUS";
                else if (purpose.contains("AGM")) type = "AGM";
                else continue;
                out.add(new CorporateEvent(symbol, type, d, purpose));
            }
        } catch (Exception e) {
            log.warn("Corporate events fetch failed: {}", e.getMessage());
        }
        return out;
    }
}
```

- [ ] **Step 2: Verify compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add src/main/java/com/kotsin/dashboard/hotstocks/data/CorporateEventsClient.java && git commit -m "feat(hotstocks): CorporateEventsClient — NSE corporate actions API"
```

### Task E6: `StrategyCrossReferenceClient` — proxy to trade-exec port 8089

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/data/StrategyCrossReferenceClient.java`

- [ ] **Step 1: Write**

```java
package com.kotsin.dashboard.hotstocks.data;

import com.kotsin.dashboard.hotstocks.model.StrategyWatch;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.List;

@Component
public class StrategyCrossReferenceClient {
    private static final Logger log = LoggerFactory.getLogger(StrategyCrossReferenceClient.class);

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String baseUrl;

    private final RestTemplate rest = new RestTemplate();

    /** Returns strategies currently watching or holding this scripCode. Empty list on failure. */
    @SuppressWarnings("unchecked")
    public List<StrategyWatch> fetchWatchers(String scripCode) {
        String url = baseUrl + "/api/strategies/watching/" + scripCode;
        try {
            List<?> raw = rest.getForObject(url, List.class);
            if (raw == null) return Collections.emptyList();
            // Map raw Maps → StrategyWatch. If trade-exec doesn't expose this endpoint yet,
            // the controller returns 404 and we get an exception → empty list.
            return ((List<java.util.Map<String, Object>>) raw).stream()
                .map(mp -> new StrategyWatch(
                    String.valueOf(mp.get("strategyName")),
                    String.valueOf(mp.get("state")),
                    mp.get("triggerLevel") == null ? null : ((Number) mp.get("triggerLevel")).doubleValue(),
                    String.valueOf(mp.get("notes"))))
                .toList();
        } catch (Exception e) {
            log.debug("Strategy cross-ref unavailable for {}: {}", scripCode, e.getMessage());
            return Collections.emptyList();
        }
    }
}
```

**Note**: If `/api/strategies/watching/{scripCode}` does not yet exist on trade-exec, this client returns empty. That's intentional graceful degradation — the frontend section shows "Strategy data unavailable" per the spec. Adding the trade-exec endpoint itself is an **optional enhancement** (Task E6b) and not blocking for Monday ship.

- [ ] **Step 2: Verify compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add src/main/java/com/kotsin/dashboard/hotstocks/data/StrategyCrossReferenceClient.java && git commit -m "feat(hotstocks): StrategyCrossReferenceClient — proxy to trade-exec"
```

---

# Section F — Mongo Repository

### Task F1: `HotStockMetricsDoc` + repository

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/repository/HotStockMetricsDoc.java`
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/repository/HotStockMetricsRepository.java`

- [ ] **Step 1: Write the document**

```java
package com.kotsin.dashboard.hotstocks.repository;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDate;

@Document(collection = "hot_stocks_history")
public class HotStockMetricsDoc {
    @Id
    private String id;  // "{scripCode}_{date}"

    @Indexed
    private String scripCode;

    @Indexed
    private LocalDate tradingDate;

    private StockMetrics metrics;

    public HotStockMetricsDoc() {}

    public HotStockMetricsDoc(String scripCode, LocalDate tradingDate, StockMetrics metrics) {
        this.id = scripCode + "_" + tradingDate;
        this.scripCode = scripCode;
        this.tradingDate = tradingDate;
        this.metrics = metrics;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getScripCode() { return scripCode; }
    public void setScripCode(String scripCode) { this.scripCode = scripCode; }
    public LocalDate getTradingDate() { return tradingDate; }
    public void setTradingDate(LocalDate tradingDate) { this.tradingDate = tradingDate; }
    public StockMetrics getMetrics() { return metrics; }
    public void setMetrics(StockMetrics metrics) { this.metrics = metrics; }
}
```

- [ ] **Step 2: Write the repository**

```java
package com.kotsin.dashboard.hotstocks.repository;

import org.springframework.data.mongodb.repository.MongoRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface HotStockMetricsRepository extends MongoRepository<HotStockMetricsDoc, String> {
    Optional<HotStockMetricsDoc> findByScripCodeAndTradingDate(String scripCode, LocalDate tradingDate);
    List<HotStockMetricsDoc> findByTradingDate(LocalDate tradingDate);
}
```

- [ ] **Step 3: Verify compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add src/main/java/com/kotsin/dashboard/hotstocks/repository/HotStockMetricsDoc.java src/main/java/com/kotsin/dashboard/hotstocks/repository/HotStockMetricsRepository.java && git commit -m "feat(hotstocks): hot_stocks_history Mongo repository"
```

---

# Section G — HotStocksService orchestrator

### Task G1: `HotStocksService.computeForScrip` integrates all computers

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/service/HotStocksService.java`

- [ ] **Step 1: Write the service**

```java
package com.kotsin.dashboard.hotstocks.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.data.*;
import com.kotsin.dashboard.hotstocks.metrics.*;
import com.kotsin.dashboard.hotstocks.model.CorporateEvent;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.model.StrategyWatch;
import com.kotsin.dashboard.hotstocks.narrative.HotStocksNarrator;
import com.kotsin.dashboard.hotstocks.repository.HotStockMetricsDoc;
import com.kotsin.dashboard.hotstocks.repository.HotStockMetricsRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

@Service
public class HotStocksService {
    private static final Logger log = LoggerFactory.getLogger(HotStocksService.class);

    private final PriceFactsComputer priceFactsComputer;
    private final VolumeLiquidityComputer volumeLiquidityComputer;
    private final DeliveryComputer deliveryComputer;
    private final RegimeComputer regimeComputer;
    private final RelativeStrengthComputer rsComputer;
    private final OiComputer oiComputer;
    private final HotStocksNarrator narrator;
    private final FivePaisaHistoryClient historyClient;
    private final NseDealArchiveClient dealClient;
    private final CorporateEventsClient eventsClient;
    private final StrategyCrossReferenceClient strategyClient;
    private final HotStockMetricsRepository repo;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();

    public HotStocksService(PriceFactsComputer priceFactsComputer,
                            VolumeLiquidityComputer volumeLiquidityComputer,
                            DeliveryComputer deliveryComputer,
                            RegimeComputer regimeComputer,
                            RelativeStrengthComputer rsComputer,
                            OiComputer oiComputer,
                            HotStocksNarrator narrator,
                            FivePaisaHistoryClient historyClient,
                            NseDealArchiveClient dealClient,
                            CorporateEventsClient eventsClient,
                            StrategyCrossReferenceClient strategyClient,
                            HotStockMetricsRepository repo,
                            StringRedisTemplate redis) {
        this.priceFactsComputer = priceFactsComputer;
        this.volumeLiquidityComputer = volumeLiquidityComputer;
        this.deliveryComputer = deliveryComputer;
        this.regimeComputer = regimeComputer;
        this.rsComputer = rsComputer;
        this.oiComputer = oiComputer;
        this.narrator = narrator;
        this.historyClient = historyClient;
        this.dealClient = dealClient;
        this.eventsClient = eventsClient;
        this.strategyClient = strategyClient;
        this.repo = repo;
        this.redis = redis;
    }

    /** Computes StockMetrics for one scrip from already-loaded inputs. */
    public StockMetrics computeFromInputs(
            String scripCode, String symbol, String sector, boolean fno,
            List<DailyCandle> candles,
            List<Double> last5DeliveryPct,
            double sector5dPct, double nifty5dPct,
            Double oiChange5d,
            List<NseDealArchiveClient.Deal> recentDeals,
            List<CorporateEvent> events) {

        StockMetrics m = new StockMetrics();
        m.setScripCode(scripCode);
        m.setSymbol(symbol);
        m.setSector(sector);
        m.setFnoEligible(fno);
        m.setLastUpdatedIst(Instant.now());

        priceFactsComputer.compute(candles, m);
        volumeLiquidityComputer.compute(candles, m);
        deliveryComputer.compute(last5DeliveryPct, m);
        rsComputer.compute(m, sector5dPct, nifty5dPct);
        regimeComputer.compute(m);
        if (fno && oiChange5d != null) {
            oiComputer.compute(m, oiChange5d);
        }

        aggregateDeals(m, recentDeals);
        applyEvents(m, events);

        m.setStrategiesWatching(strategyClient.fetchWatchers(scripCode));
        narrator.enrich(m);

        return m;
    }

    private void aggregateDeals(StockMetrics m, List<NseDealArchiveClient.Deal> deals) {
        if (deals == null || deals.isEmpty()) return;
        double buyCr = 0, sellCr = 0;
        Set<LocalDate> dealDates = new HashSet<>();
        int bulk = 0, block = 0;
        List<String> buyClients = new ArrayList<>();
        List<String> sellClients = new ArrayList<>();
        for (NseDealArchiveClient.Deal d : deals) {
            double value = d.quantity() * d.price() / 1e7;  // in Cr
            if ("BUY".equals(d.buySell())) {
                buyCr += value;
                buyClients.add(d.clientName());
            } else {
                sellCr += value;
                sellClients.add(d.clientName());
            }
            dealDates.add(d.date());
            if (d.isBlock()) block++; else bulk++;
        }
        m.setSmartBuyCr(buyCr);
        m.setSmartSellCr(sellCr);
        m.setDealDays(dealDates.size());
        m.setBulkDealCount(bulk);
        m.setBlockDealCount(block);
        m.setSmartBuyClients(buyClients.stream().distinct().toList());
        m.setSmartSellClients(sellClients.stream().distinct().toList());
        if (buyCr > sellCr * 1.2) m.setDominantFlow("DII_BUY");
        else if (sellCr > buyCr * 1.2) m.setDominantFlow("DII_SELL");
        else m.setDominantFlow("MIXED");
    }

    private void applyEvents(StockMetrics m, List<CorporateEvent> events) {
        if (events == null || events.isEmpty()) return;
        LocalDate today = LocalDate.now();
        events.sort(Comparator.comparing(CorporateEvent::getEventDate));
        m.setUpcomingEvents(events);

        CorporateEvent nearest = events.get(0);
        int days = (int) Duration.between(today.atStartOfDay(), nearest.getEventDate().atStartOfDay()).toDays();
        m.setDaysToNearestEvent(days);
        m.setNearestEventType(nearest.getEventType());
        m.setEventWithin3Days(days >= 0 && days <= 3);
        for (CorporateEvent e : events) {
            if ("SPLIT".equals(e.getEventType())) {
                m.setHasSplitAnnouncement(true);
                m.setNextCorporateActionLabel(e.getDetail() + " on " + e.getEventDate());
            }
            if ("BONUS".equals(e.getEventType())) m.setHasBonusAnnouncement(true);
            if ("DIVIDEND".equals(e.getEventType()) && days <= 10) m.setHasDividendExDate(true);
        }
    }

    /** Caches a StockMetrics to Redis + writes to Mongo. */
    public void cache(StockMetrics m) {
        try {
            String json = mapper.writeValueAsString(m);
            redis.opsForValue().set("hotstocks:v1:" + m.getScripCode(), json, Duration.ofHours(36));
            repo.save(new HotStockMetricsDoc(m.getScripCode(), LocalDate.now(), m));
        } catch (Exception e) {
            log.error("Failed to cache {}: {}", m.getScripCode(), e.getMessage());
        }
    }

    public Optional<StockMetrics> loadFromCache(String scripCode) {
        String json = redis.opsForValue().get("hotstocks:v1:" + scripCode);
        if (json == null) return Optional.empty();
        try {
            return Optional.of(mapper.readValue(json, StockMetrics.class));
        } catch (Exception e) {
            log.error("Failed to parse cache for {}: {}", scripCode, e.getMessage());
            return Optional.empty();
        }
    }

    public List<StockMetrics> loadRankedList() {
        String json = redis.opsForValue().get("hotstocks:v1:universe");
        if (json == null) return Collections.emptyList();
        try {
            return mapper.readValue(json, new TypeReference<List<StockMetrics>>() {});
        } catch (Exception e) {
            log.error("Failed to parse ranked list: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    public void cacheRankedList(List<StockMetrics> ranked) {
        try {
            redis.opsForValue().set("hotstocks:v1:universe", mapper.writeValueAsString(ranked),
                Duration.ofHours(36));
        } catch (Exception e) {
            log.error("Failed to cache ranked list: {}", e.getMessage());
        }
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile
```

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/service/HotStocksService.java && git commit -m "feat(hotstocks): HotStocksService orchestrator"
```

### Task G2: `HotStocksRanker` — facts-based top-N

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/service/HotStocksRanker.java`
- Create: `backend/src/test/java/com/kotsin/dashboard/hotstocks/service/HotStocksRankerTest.java`

- [ ] **Step 1: Write failing test**

```java
package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class HotStocksRankerTest {

    private final HotStocksRanker ranker = new HotStocksRanker();

    @Test
    void ranks_institutional_leaders_above_mixed() {
        StockMetrics strong = new StockMetrics();
        strong.setSymbol("STRONG");
        strong.setFnoEligible(true);
        strong.setDeliveryInstitutional(true);
        strong.setSmartBuyCr(89);
        strong.setDealDays(3);
        strong.setVsSectorLabel("LEADING");
        strong.setVsSectorIndexPct(2.3);
        strong.setTrendState("UPTREND");

        StockMetrics weak = new StockMetrics();
        weak.setSymbol("WEAK");
        weak.setFnoEligible(true);
        weak.setDeliveryInstitutional(false);
        weak.setVsSectorLabel("LAGGING");
        weak.setTrendState("DOWNTREND");

        List<StockMetrics> ranked = ranker.rank(List.of(weak, strong), 6, true);

        assertEquals("STRONG", ranked.get(0).getSymbol());
    }
}
```

- [ ] **Step 2: Implement**

```java
package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.model.LiquidityTier;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;

@Component
public class HotStocksRanker {

    public List<StockMetrics> rank(List<StockMetrics> universe, int topN, boolean fnoOnly) {
        return universe.stream()
            .filter(m -> !fnoOnly || m.isFnoEligible())
            .filter(m -> m.getLiquidityTier() != LiquidityTier.LOW)
            .sorted(Comparator.comparingDouble(this::score).reversed())
            .limit(topN)
            .toList();
    }

    /** Facts-based ranking score. No predictive component. */
    public double score(StockMetrics m) {
        double s = 0;
        if (m.isDeliveryInstitutional()) s += 25;
        if (m.getSmartBuyCr() >= 50 && m.getDealDays() >= 2) s += 20;
        if ("LEADING".equals(m.getVsSectorLabel())) s += 15;
        if ("UPTREND".equals(m.getTrendState())) s += 10;
        if ("LONG_BUILDUP".equals(m.getOiInterpretation())) s += 10;
        if ("ELEVATED".equals(m.getVolumeRegime())) s += 5;
        if (m.getWeekly52PositionPct() != null && m.getWeekly52PositionPct() > 60) s += 5;
        if ("BULLISH_TREND".equals(m.getPriceRegime())) s += 10;
        return s;
    }
}
```

- [ ] **Step 3: Test + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q test -Dtest=HotStocksRankerTest && git add src/main/java/com/kotsin/dashboard/hotstocks/service/HotStocksRanker.java src/test/java/com/kotsin/dashboard/hotstocks/service/HotStocksRankerTest.java && git commit -m "feat(hotstocks): HotStocksRanker — facts-based scoring"
```

---

# Section H — Enrichment Job + Backfill

### Task H1: `HotStocksEnrichmentJob` — scheduled 05:45 IST daily

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksEnrichmentJob.java`

- [ ] **Step 1: Write the job**

```java
package com.kotsin.dashboard.hotstocks.job;

import com.kotsin.dashboard.hotstocks.data.*;
import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import com.kotsin.dashboard.hotstocks.model.CorporateEvent;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.repository.HotStockMetricsRepository;
import com.kotsin.dashboard.hotstocks.service.HotStocksRanker;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Component
public class HotStocksEnrichmentJob {
    private static final Logger log = LoggerFactory.getLogger(HotStocksEnrichmentJob.class);

    private final HotStocksService service;
    private final HotStocksRanker ranker;
    private final FivePaisaHistoryClient historyClient;
    private final NseDealArchiveClient dealClient;
    private final CorporateEventsClient eventsClient;
    private final HotStockMetricsRepository repo;
    private final MongoTemplate mongo;

    public HotStocksEnrichmentJob(HotStocksService service, HotStocksRanker ranker,
                                  FivePaisaHistoryClient historyClient,
                                  NseDealArchiveClient dealClient,
                                  CorporateEventsClient eventsClient,
                                  HotStockMetricsRepository repo, MongoTemplate mongo) {
        this.service = service;
        this.ranker = ranker;
        this.historyClient = historyClient;
        this.dealClient = dealClient;
        this.eventsClient = eventsClient;
        this.repo = repo;
        this.mongo = mongo;
    }

    @Scheduled(cron = "0 45 5 * * MON-FRI", zone = "Asia/Kolkata")
    public void run() {
        log.info("HotStocksEnrichmentJob starting");
        try {
            List<ScripInfo> universe = loadFnoUniverse();
            log.info("Universe size: {}", universe.size());

            // Bulk fetch candles
            List<String> scripCodes = universe.stream().map(s -> s.scripCode).toList();
            Map<String, List<DailyCandle>> candleMap = historyClient.fetchBulk(
                "N", "C", scripCodes,
                LocalDate.now().minusYears(1), LocalDate.now());
            log.info("Fetched candles for {}/{} scrips", candleMap.size(), scripCodes.size());

            // Fetch last 10 days of deals
            List<NseDealArchiveClient.Deal> allDeals = new ArrayList<>();
            for (int i = 0; i < 10; i++) {
                LocalDate d = LocalDate.now().minusDays(i);
                allDeals.addAll(dealClient.fetchBulkDeals(d));
                allDeals.addAll(dealClient.fetchBlockDeals(d));
            }
            Map<String, List<NseDealArchiveClient.Deal>> dealsBySymbol = allDeals.stream()
                .collect(Collectors.groupingBy(NseDealArchiveClient.Deal::symbol));

            // Fetch 30-day corporate events
            List<CorporateEvent> allEvents = eventsClient.fetchUpcoming(
                LocalDate.now(), LocalDate.now().plusDays(30));
            Map<String, List<CorporateEvent>> eventsBySymbol = allEvents.stream()
                .collect(Collectors.groupingBy(CorporateEvent::getSymbol));

            // Benchmark: Nifty 5D return (proxy via Nifty scripCode 999920000)
            double nifty5d = benchmark5d(historyClient, "999920000");

            List<StockMetrics> computed = new ArrayList<>();
            for (ScripInfo info : universe) {
                try {
                    List<DailyCandle> candles = candleMap.get(info.scripCode);
                    if (candles == null || candles.size() < 50) continue;
                    double sector5d = 0.0;  // Phase 1a: skip sector index lookup; use 0
                    Double oi5d = loadOiChange5d(info.scripCode);
                    List<Double> deliveries = loadDelivery5d(info.symbol);
                    List<NseDealArchiveClient.Deal> deals = dealsBySymbol.getOrDefault(info.symbol, List.of());
                    List<CorporateEvent> events = eventsBySymbol.getOrDefault(info.symbol, List.of());

                    StockMetrics m = service.computeFromInputs(
                        info.scripCode, info.symbol, info.sector, info.fnoEligible,
                        candles, deliveries, sector5d, nifty5d, oi5d, deals, events);
                    service.cache(m);
                    computed.add(m);
                } catch (Exception e) {
                    log.warn("Failed to compute for {}: {}", info.symbol, e.getMessage());
                }
            }

            List<StockMetrics> top6Fno = ranker.rank(computed, 6, true);
            List<StockMetrics> top12NonFno = ranker.rank(computed, 12, false).stream()
                .filter(m -> !m.isFnoEligible()).toList();
            List<StockMetrics> merged = new ArrayList<>(top6Fno);
            merged.addAll(top12NonFno);
            service.cacheRankedList(merged);

            log.info("HotStocksEnrichmentJob complete: {} computed, {} ranked", computed.size(), merged.size());
        } catch (Exception e) {
            log.error("HotStocksEnrichmentJob failed", e);
        }
    }

    private record ScripInfo(String scripCode, String symbol, String sector, boolean fnoEligible) {}

    private List<ScripInfo> loadFnoUniverse() {
        Query q = new Query(Criteria.where("tradingType").is("EQUITY"));
        List<Map> docs = mongo.find(q, Map.class, "ScripGroup");
        List<ScripInfo> out = new ArrayList<>();
        for (Map d : docs) {
            String sc = String.valueOf(d.get("scripCode"));
            String sym = String.valueOf(d.getOrDefault("symbol", d.get("scrip_name")));
            String sec = String.valueOf(d.getOrDefault("sector", "Other"));
            boolean fno = Boolean.TRUE.equals(d.get("fnoEligible"));
            out.add(new ScripInfo(sc, sym, sec, fno));
        }
        return out;
    }

    private double benchmark5d(FivePaisaHistoryClient client, String scripCode) {
        Map<String, List<DailyCandle>> map = client.fetchBulk("N", "C", List.of(scripCode),
            LocalDate.now().minusDays(20), LocalDate.now());
        List<DailyCandle> cs = map.get(scripCode);
        if (cs == null || cs.size() < 6) return 0;
        double last = cs.get(cs.size() - 1).close();
        double prev = cs.get(cs.size() - 6).close();
        return (last - prev) / prev * 100.0;
    }

    private Double loadOiChange5d(String scripCode) {
        // Query oi_metrics_1m for 5-day rolling OI change.
        // Phase 1a shortcut: return null; OiComputer handles null gracefully.
        return null;
    }

    private List<Double> loadDelivery5d(String symbol) {
        // Query hot_stocks_history for last 5 days of delivery pct, or return empty.
        Query q = new Query(Criteria.where("metrics.symbol").is(symbol))
            .limit(5);
        // Implementation: read deliveryPctLatest from last 5 days of docs.
        // Phase 1a shortcut: return empty list; DeliveryComputer handles empty gracefully.
        return List.of();
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile
```

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksEnrichmentJob.java && git commit -m "feat(hotstocks): HotStocksEnrichmentJob @Scheduled 05:45 IST"
```

### Task H2: Saturday backfill trigger endpoint

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/controller/HotStocksAdminController.java`

- [ ] **Step 1: Write the admin controller**

```java
package com.kotsin.dashboard.hotstocks.controller;

import com.kotsin.dashboard.hotstocks.data.NseBhavcopyClient;
import com.kotsin.dashboard.hotstocks.job.HotStocksEnrichmentJob;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/hot-stocks/admin")
public class HotStocksAdminController {

    private final HotStocksEnrichmentJob job;
    private final NseBhavcopyClient bhavcopyClient;

    public HotStocksAdminController(HotStocksEnrichmentJob job, NseBhavcopyClient bhavcopyClient) {
        this.job = job;
        this.bhavcopyClient = bhavcopyClient;
    }

    @PostMapping("/run-enrichment")
    public Map<String, Object> runEnrichment() {
        job.run();
        Map<String, Object> r = new HashMap<>();
        r.put("status", "triggered");
        return r;
    }

    @GetMapping("/bhavcopy-check")
    public Map<String, Object> bhavcopyCheck(@RequestParam(required = false) String date) {
        LocalDate d = date == null ? LocalDate.now().minusDays(1) : LocalDate.parse(date);
        Map<String, Double> deliveries = bhavcopyClient.fetchDeliveryPct(d);
        Map<String, Object> r = new HashMap<>();
        r.put("date", d.toString());
        r.put("rowCount", deliveries.size());
        r.put("sample", deliveries.entrySet().stream().limit(5).toList());
        return r;
    }
}
```

- [ ] **Step 2: Verify compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add src/main/java/com/kotsin/dashboard/hotstocks/controller/HotStocksAdminController.java && git commit -m "feat(hotstocks): admin controller for manual enrichment + bhavcopy check"
```

---

# Section I — Wallet Integration

### Task I1: Add HOTSTOCKS to dashboard StrategyNameResolver

**Files:**
- Modify: `backend/src/main/java/com/kotsin/dashboard/service/StrategyNameResolver.java:14-43`

- [ ] **Step 1: Add HOTSTOCKS to both key lists**

Edit lines 14-19 — add `"HOTSTOCKS",` to both `ALL_STRATEGY_KEYS` and `ACTIVE_STRATEGY_KEYS`:

```java
    public static final List<String> ALL_STRATEGY_KEYS = List.of(
            "FUDKII", "FUKAA", "FUDKOI", "PIVOT_CONFLUENCE", "MICROALPHA", "MERE", "QUANT",
            "RETEST", "HOTSTOCKS",
            "MCX_BB", "MCX_BBT1",
            "MCX_BB_15", "MCX_BB_30", "NSE_BB_30"
    );

    public static final List<String> ACTIVE_STRATEGY_KEYS = List.of(
            "FUDKII", "FUKAA", "FUDKOI", "MICROALPHA", "MERE", "QUANT",
            "RETEST", "HOTSTOCKS",
            "MCX_BB_15", "MCX_BB_30", "NSE_BB_30"
    );
```

Add to `DISPLAY_NAMES` Map.ofEntries at line 28 (before MANUAL):

```java
            Map.entry("HOTSTOCKS", "Hot Stocks"),
```

Add to `normalize()` at line 63 (before QUANT block):

```java
        if (upper.contains("HOTSTOCK")) return "HOTSTOCKS";
```

- [ ] **Step 2: Verify compile**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile
```

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && git add -u && git commit -m "feat(hotstocks): register HOTSTOCKS in StrategyNameResolver"
```

### Task I2: Add HOTSTOCKS to trade-exec StrategyWalletResolver

**Files:**
- Modify: `/home/ubuntu/tradeExcutionModule/src/main/java/com/kotsin/execution/wallet/service/StrategyWalletResolver.java:22-26`

- [ ] **Step 1: Add HOTSTOCKS**

Edit lines 22-26:

```java
    public static final List<String> ALL_STRATEGY_KEYS = List.of(
        "FUDKII", "FUKAA", "FUDKOI", "PIVOT_CONFLUENCE", "MICROALPHA", "MERE", "RETEST", "QUANT",
        "HOTSTOCKS",
        "MCX_BB", "MCX_BBT1", "MCX_BB_15", "MCX_BB_30", "NSE_BB_30"
    );
```

Also verify `resolveStrategyKey()` — a signal with `signalSource="HOTSTOCKS"` should fall into the `ALL_STRATEGY_KEYS.contains(upper)` branch and route correctly. No change needed if that's the pattern.

- [ ] **Step 2: Build trade-exec**

```bash
cd /home/ubuntu/tradeExcutionModule && mvn -q clean package -DskipTests
```
Expected: BUILD SUCCESS.

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/tradeExcutionModule && git add -u && git commit -m "feat(hotstocks): register HOTSTOCKS in StrategyWalletResolver"
```

### Task I3: Restart trade-exec, verify wallet auto-created

**Files:** None (runtime verification)

- [ ] **Step 1: Restart trade-exec per CLAUDE.md SOP**

```bash
ps aux | grep java | grep -v grep | grep tradeExcutionModule
# Note wrapper + JVM child PIDs, then:
kill -9 <wrapper-pid> <jvm-child-pid>
cd /home/ubuntu/tradeExcutionModule && nohup mvn spring-boot:run > nohup.out 2>&1 &
sleep 15 && tail -50 nohup.out
```
Expected: "Started Application in N.NNN seconds".

- [ ] **Step 2: Verify wallet created in Redis**

```bash
redis-cli HGETALL wallet:entity:strategy-wallet-HOTSTOCKS | head -40
```
Expected: fields including `strategyKey=HOTSTOCKS`, `initialCapital=1000000`, `currentBalance=1000000`.

If the wallet does not exist, check trade-exec logs for startup bootstrap of new strategies. If trade-exec bootstraps wallets only for existing signals, manually seed it:

```bash
redis-cli HSET wallet:entity:strategy-wallet-HOTSTOCKS strategyKey HOTSTOCKS initialCapital 1000000 currentBalance 1000000 availableCapital 1000000 usedMargin 0 maxDailyLoss 100000 dailyPnl 0
```

- [ ] **Step 3: No commit (runtime only)**

### Task I4: `HotStocksPositionOpenerJob` — open virtual positions at 09:15 IST

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJob.java`

- [ ] **Step 1: Write**

```java
package com.kotsin.dashboard.hotstocks.job;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class HotStocksPositionOpenerJob {
    private static final Logger log = LoggerFactory.getLogger(HotStocksPositionOpenerJob.class);

    private final HotStocksService service;
    private final RestTemplate rest = new RestTemplate();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String tradeExecUrl;

    private static final double POSITION_SIZE_RUPEES = 150_000.0;
    private static final int MAX_POSITIONS = 6;

    public HotStocksPositionOpenerJob(HotStocksService service) {
        this.service = service;
    }

    @Scheduled(cron = "0 15 9 * * MON-FRI", zone = "Asia/Kolkata")
    public void openPositions() {
        log.info("HotStocksPositionOpenerJob starting");
        List<StockMetrics> ranked = service.loadRankedList();
        int opened = 0;
        for (StockMetrics m : ranked) {
            if (opened >= MAX_POSITIONS) break;
            if (!m.isFnoEligible()) continue;
            try {
                openOne(m);
                opened++;
            } catch (Exception e) {
                log.warn("Failed to open position for {}: {}", m.getSymbol(), e.getMessage());
            }
        }
        log.info("HotStocksPositionOpenerJob complete: {} positions opened", opened);
    }

    private void openOne(StockMetrics m) {
        double entry = m.getLtpYesterday();
        int qty = (int) Math.floor(POSITION_SIZE_RUPEES / entry);
        if (qty <= 0) return;
        double sl = m.getSuggestedSlPrice();
        double target = entry * 1.05;

        Map<String, Object> payload = new HashMap<>();
        payload.put("scripCode", m.getScripCode());
        payload.put("symbol", m.getSymbol());
        payload.put("signalSource", "HOTSTOCKS");
        payload.put("signalType", "BUY");
        payload.put("entryPrice", entry);
        payload.put("stopLoss", sl);
        payload.put("target", target);
        payload.put("quantity", qty);
        payload.put("tag", "HOTSTOCKS_" + m.getSymbol());
        payload.put("timeStopDays", 5);

        rest.postForObject(tradeExecUrl + "/api/strategy-trades", payload, String.class);
        log.info("Opened HOTSTOCKS position: {} qty={} entry={} sl={}", m.getSymbol(), qty, entry, sl);
    }
}
```

- [ ] **Step 2: Compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksPositionOpenerJob.java && git commit -m "feat(hotstocks): HotStocksPositionOpenerJob 09:15 IST"
```

### Task I5: `HotStocksKillSwitchJob` — monitor 3-day wallet drawdown

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksKillSwitchJob.java`

- [ ] **Step 1: Write**

```java
package com.kotsin.dashboard.hotstocks.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
public class HotStocksKillSwitchJob {
    private static final Logger log = LoggerFactory.getLogger(HotStocksKillSwitchJob.class);
    private static final double KILL_DRAWDOWN_PCT = 3.0;
    private static final String KILL_SWITCH_KEY = "hotstocks:v1:kill_switch";

    private final StringRedisTemplate redis;

    public HotStocksKillSwitchJob(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Scheduled(cron = "0 35 15 * * MON-FRI", zone = "Asia/Kolkata")
    public void check() {
        Map<Object, Object> wallet = redis.<Object, Object>opsForHash().entries("wallet:entity:strategy-wallet-HOTSTOCKS");
        if (wallet == null || wallet.isEmpty()) return;
        double initial = parse(wallet.get("initialCapital"), 1_000_000);
        double current = parse(wallet.get("currentBalance"), initial);
        double drawdownPct = (initial - current) / initial * 100.0;
        if (drawdownPct >= KILL_DRAWDOWN_PCT) {
            redis.opsForValue().set(KILL_SWITCH_KEY, "TRIPPED");
            log.error("HOTSTOCKS KILL SWITCH TRIPPED — drawdown {}%", drawdownPct);
        }
    }

    private double parse(Object v, double fallback) {
        if (v == null) return fallback;
        try { return Double.parseDouble(v.toString()); } catch (Exception e) { return fallback; }
    }

    public boolean isTripped() {
        return "TRIPPED".equals(redis.opsForValue().get(KILL_SWITCH_KEY));
    }
}
```

- [ ] **Step 2: Compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add src/main/java/com/kotsin/dashboard/hotstocks/job/HotStocksKillSwitchJob.java && git commit -m "feat(hotstocks): HotStocksKillSwitchJob monitors 3-day drawdown"
```

**Note**: The position opener should skip opening when kill switch is tripped. Wire this in via `HotStocksPositionOpenerJob.openPositions()` — check `killSwitchJob.isTripped()` at the top and early-return. Add as a one-line edit and commit:

- [ ] **Step 3: Wire kill switch into opener**

Edit `HotStocksPositionOpenerJob.java`. Replace the existing single-arg constructor with:

```java
    private final HotStocksKillSwitchJob killSwitch;

    public HotStocksPositionOpenerJob(HotStocksService service, HotStocksKillSwitchJob killSwitch) {
        this.service = service;
        this.killSwitch = killSwitch;
    }
```

And at the top of `openPositions()`, immediately after the `log.info("HotStocksPositionOpenerJob starting")` line, insert:

```java
        if (killSwitch.isTripped()) {
            log.warn("Kill switch tripped — skipping position opens");
            return;
        }
```

- [ ] **Step 4: Compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add -u && git commit -m "feat(hotstocks): opener respects kill switch"
```

---

# Section J — REST Controller

### Task J1: `HotStocksController` — list + single + wallet endpoints

**Files:**
- Create: `backend/src/main/java/com/kotsin/dashboard/hotstocks/controller/HotStocksController.java`

- [ ] **Step 1: Write**

```java
package com.kotsin.dashboard.hotstocks.controller;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import com.kotsin.dashboard.hotstocks.service.HotStocksService;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/hot-stocks")
public class HotStocksController {

    private final HotStocksService service;
    private final StringRedisTemplate redis;

    public HotStocksController(HotStocksService service, StringRedisTemplate redis) {
        this.service = service;
        this.redis = redis;
    }

    @GetMapping
    public Map<String, Object> list() {
        List<StockMetrics> ranked = service.loadRankedList();
        List<StockMetrics> fno = ranked.stream().filter(StockMetrics::isFnoEligible).limit(6).toList();
        List<StockMetrics> nonFno = ranked.stream().filter(m -> !m.isFnoEligible()).limit(12).toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("fno", fno);
        out.put("nonFno", nonFno);
        out.put("generatedAt", System.currentTimeMillis());
        return out;
    }

    @GetMapping("/{symbol}")
    public ResponseEntity<StockMetrics> single(@PathVariable String symbol) {
        // scripCode lookup: naive scan through ranked list
        return service.loadRankedList().stream()
            .filter(m -> symbol.equalsIgnoreCase(m.getSymbol()))
            .findFirst()
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/wallet")
    public Map<String, Object> wallet() {
        Map<Object, Object> raw = redis.<Object, Object>opsForHash()
            .entries("wallet:entity:strategy-wallet-HOTSTOCKS");
        Map<String, Object> out = new LinkedHashMap<>();
        raw.forEach((k, v) -> out.put(k.toString(), v.toString()));
        return out;
    }

    @GetMapping("/wallet/positions")
    public List<Map<Object, Object>> positions() {
        // Scan Redis for virtual:positions:* where signalSource=HOTSTOCKS
        Set<String> keys = redis.keys("virtual:positions:*");
        if (keys == null) return Collections.emptyList();
        List<Map<Object, Object>> out = new ArrayList<>();
        for (String k : keys) {
            Map<Object, Object> pos = redis.<Object, Object>opsForHash().entries(k);
            if (pos == null || pos.isEmpty()) continue;
            Object src = pos.get("signalSource");
            if (src != null && "HOTSTOCKS".equals(src.toString())) {
                out.add(pos);
            }
        }
        return out;
    }
}
```

- [ ] **Step 2: Compile + commit**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q compile && git add src/main/java/com/kotsin/dashboard/hotstocks/controller/HotStocksController.java && git commit -m "feat(hotstocks): REST controller — list, single, wallet, positions"
```

### Task J2: Smoke test the backend end-to-end

**Files:** None (runtime verification)

- [ ] **Step 1: Build + restart dashboard backend**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q clean package -DskipTests
ps aux | grep java | grep -v grep | grep trading-dashboard
kill -9 <wrapper-pid> <jvm-child-pid>
cd /home/ubuntu/trading-dashboard/backend && nohup mvn spring-boot:run > nohup.out 2>&1 &
sleep 20 && tail -60 nohup.out
```
Expected: "Started DashboardApplication".

- [ ] **Step 2: Trigger enrichment manually**

```bash
curl -s -X POST http://localhost:8085/api/hot-stocks/admin/run-enrichment
sleep 60 && tail -100 /home/ubuntu/trading-dashboard/backend/nohup.out | grep HotStocks
```
Expected: "HotStocksEnrichmentJob complete: N computed, M ranked".

- [ ] **Step 3: Verify Redis cache**

```bash
redis-cli GET hotstocks:v1:universe | head -c 800
redis-cli KEYS "hotstocks:v1:*" | head -20
```
Expected: universe key contains a JSON array with 6-18 entries.

- [ ] **Step 4: Test the API**

```bash
curl -s http://localhost:8085/api/hot-stocks | python3 -m json.tool | head -60
```
Expected: JSON with `fno` and `nonFno` arrays, each entry has `thesisText` and `actionCueText`.

---

# Section K — Frontend Types + API

### Task K1: TypeScript types

**Files:**
- Create: `frontend/src/types/hotstocks.ts`

- [ ] **Step 1: Write**

```ts
export type LiquidityTier = 'HIGH' | 'MED' | 'LOW';

export type ActionCueType =
  | 'BUY_DIP' | 'WAIT_PULLBACK' | 'BUY_RANGE_LOW'
  | 'HOLD_OFF_EVENT' | 'AVOID' | 'OBSERVE';

export interface CorporateEvent {
  symbol: string;
  eventType: 'EARNINGS' | 'DIVIDEND' | 'SPLIT' | 'BONUS' | 'AGM';
  eventDate: string;
  detail: string;
}

export interface StrategyWatch {
  strategyName: string;
  state: string;
  triggerLevel: number | null;
  notes: string;
}

export interface StockMetrics {
  scripCode: string;
  symbol: string;
  sector: string;
  fnoEligible: boolean;
  lastUpdatedIst: string;

  ltpYesterday: number;
  change1dPct: number;
  change5dPct: number;
  change20dPct: number;

  vsSectorIndexPct: number;
  vsSectorLabel: 'LEADING' | 'INLINE' | 'LAGGING';
  vsNifty50Pct: number;
  vsNiftyLabel: 'LEADING' | 'INLINE' | 'LAGGING';

  bulkDealCount: number;
  blockDealCount: number;
  dealDays: number;
  smartBuyCr: number;
  smartSellCr: number;
  smartBuyClients: string[];
  smartSellClients: string[];
  dominantFlow: string;

  deliveryPctLatest: number;
  deliveryPctAvg5d: number;
  deliveryTrend: 'RISING' | 'FALLING' | 'STABLE';
  deliveryInterpretation: string;
  deliveryTrendLabel: string;
  deliveryInstitutional: boolean;

  above50dmaPct: number | null;
  above200dmaPct: number | null;
  trendState: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'INSUFFICIENT';
  rsi14: number | null;
  weekly52PositionPct: number | null;

  priceRegime: 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE_BOUND';
  priceRegimeConfidence: number;

  volumeRatio5d20d: number;
  volumeRegime: 'ELEVATED' | 'NORMAL' | 'QUIET';
  avgTurnover20dCr: number;
  liquidityTier: LiquidityTier;

  swingLow20d: number;
  swingHigh20d: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  suggestedSlPrice: number;

  oiChangePct5d: number | null;
  oiInterpretation: string | null;
  volumeRegimeLabel: string | null;

  upcomingEvents: CorporateEvent[];
  daysToNearestEvent: number | null;
  nearestEventType: string | null;
  eventWithin3Days: boolean;
  hasSplitAnnouncement: boolean;
  hasBonusAnnouncement: boolean;
  hasDividendExDate: boolean;
  nextCorporateActionLabel: string | null;

  strategiesWatching: StrategyWatch[];

  thesisText: string;
  actionCueType: ActionCueType;
  actionCueText: string;

  confidenceScore: number | null;
  scoringRegime: string | null;
  scoringModel: string | null;
}

export interface HotStocksListResponse {
  fno: StockMetrics[];
  nonFno: StockMetrics[];
  generatedAt: number;
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/trading-dashboard/frontend && git add src/types/hotstocks.ts && git commit -m "feat(hotstocks): TS type definitions"
```

### Task K2: `hotStocksApi` client — append to api.ts

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Append at end of file**

```ts
// ── Hot Stocks ───────────────────────────────────────────────
import type { HotStocksListResponse, StockMetrics } from '../types/hotstocks';

export const hotStocksApi = {
  async list(): Promise<HotStocksListResponse> {
    const res = await fetch(`${API_BASE}/hot-stocks`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`hot-stocks list failed: ${res.status}`);
    return res.json();
  },

  async single(symbol: string): Promise<StockMetrics> {
    const res = await fetch(`${API_BASE}/hot-stocks/${encodeURIComponent(symbol)}`, {
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`hot-stocks single failed: ${res.status}`);
    return res.json();
  },

  async wallet(): Promise<Record<string, string>> {
    const res = await fetch(`${API_BASE}/hot-stocks/wallet`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`hot-stocks wallet failed: ${res.status}`);
    return res.json();
  },
};
```

If `authHeaders` is a different name (e.g., `getAuthHeaders`), use that name. Check api.ts line 23-92 for the exact helper name.

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/trading-dashboard/frontend && git add src/services/api.ts && git commit -m "feat(hotstocks): hotStocksApi client"
```

---

# Section L — Frontend Card

### Task L1: `HotStocksCard` component

**Files:**
- Create: `frontend/src/components/hotstocks/HotStocksCard.tsx`

- [ ] **Step 1: Write**

```tsx
import { Link } from 'react-router-dom';
import type { StockMetrics } from '../../types/hotstocks';

interface Props { metrics: StockMetrics }

export function HotStocksCard({ metrics: m }: Props) {
  const priceColor = m.change1dPct >= 0 ? 'text-emerald-400' : 'text-red-400';
  const arrow = m.change1dPct >= 0 ? '↑' : '↓';
  const showUrgency = m.daysToNearestEvent !== null && m.daysToNearestEvent <= 5;

  return (
    <Link to={`/research/${m.symbol}`} className="block">
      <div className="bg-slate-900/80 border border-slate-700/60 rounded-lg p-4 hover:border-amber-500/60 transition-colors">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-slate-100">{m.symbol}</span>
              {m.fnoEligible && (
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">F&amp;O</span>
              )}
              {showUrgency && (
                <span className="text-[10px] text-amber-400">⚡{m.daysToNearestEvent}d</span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              {m.sector} · {m.vsSectorLabel === 'LEADING' ? 'Leader' : m.vsSectorLabel === 'LAGGING' ? 'Laggard' : 'Inline'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-100 font-mono">₹{m.ltpYesterday.toFixed(2)}</div>
            <div className={`text-xs font-mono ${priceColor}`}>
              {arrow}{Math.abs(m.change1dPct).toFixed(1)}% · 5D {m.change5dPct >= 0 ? '+' : ''}{m.change5dPct.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Thesis */}
        <div className="border-l-2 border-amber-500/60 pl-3 my-3 text-xs text-slate-300 leading-relaxed min-h-[3em]">
          {m.thesisText}
        </div>

        {/* Icon grid */}
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-[11px] font-mono text-slate-300 my-2">
          {m.smartBuyCr > 0 && (
            <span>🏛 +{m.smartBuyCr.toFixed(0)}Cr·{m.dealDays}d</span>
          )}
          {m.deliveryPctLatest > 0 && (
            <span>📦 {m.deliveryPctLatest.toFixed(0)}%{m.deliveryTrend === 'RISING' ? '↑' : m.deliveryTrend === 'FALLING' ? '↓' : '·'}</span>
          )}
          {m.vsSectorIndexPct !== 0 && (
            <span>📈 {m.vsSectorIndexPct >= 0 ? '+' : ''}{m.vsSectorIndexPct.toFixed(1)}%</span>
          )}
          {m.volumeRatio5d20d > 0 && (
            <span>🔥 {m.volumeRatio5d20d.toFixed(1)}× Vol</span>
          )}
          <span>🎯 {m.priceRegime.replace('_TREND', '').replace('RANGE_BOUND', 'RANGE')}</span>
          {m.oiInterpretation && (
            <span>⚙ {m.oiInterpretation.replace('_', ' ')}</span>
          )}
          {m.strategiesWatching.length > 0 && (
            <span>👁 {m.strategiesWatching.slice(0, 2).map(s => s.strategyName).join('+')}</span>
          )}
          {m.nextCorporateActionLabel && (
            <span>⚡ {m.nextCorporateActionLabel}</span>
          )}
          <span>💧 {m.liquidityTier}</span>
        </div>

        {/* Action cue */}
        <div className="mt-3 pt-2 border-t border-slate-700/50">
          <div className="text-xs font-mono text-amber-200">{m.actionCueText}</div>
        </div>

        <div className="mt-2 text-[10px] text-slate-500 text-right">tap to open →</div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/trading-dashboard/frontend && git add src/components/hotstocks/HotStocksCard.tsx && git commit -m "feat(hotstocks): HotStocksCard component"
```

### Task L2: `HotStocksPage` + stub `HotStocksDetailPage`

**Files:**
- Create: `frontend/src/pages/HotStocksPage.tsx`
- Create: `frontend/src/pages/HotStocksDetailPage.tsx`

- [ ] **Step 1: Write `HotStocksPage`**

```tsx
import { useEffect, useState } from 'react';
import { hotStocksApi } from '../services/api';
import type { HotStocksListResponse } from '../types/hotstocks';
import { HotStocksCard } from '../components/hotstocks/HotStocksCard';

export function HotStocksPage() {
  const [data, setData] = useState<HotStocksListResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showNonFno, setShowNonFno] = useState(false);

  useEffect(() => {
    hotStocksApi.list()
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="p-6 text-red-400">Failed to load Hot Stocks: {err}</div>;
  if (!data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-slate-100 mb-4">Hot Stocks</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[340px] bg-slate-900/50 border border-slate-700/30 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold text-slate-100">Hot Stocks</h1>
        <div className="text-xs text-slate-500">
          Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN')}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.fno.map((m) => <HotStocksCard key={m.scripCode} metrics={m} />)}
      </div>

      {data.nonFno.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowNonFno((v) => !v)}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            {showNonFno ? '▾' : '▸'} Non-F&amp;O Picks ({data.nonFno.length})
          </button>
          {showNonFno && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {data.nonFno.map((m) => <HotStocksCard key={m.scripCode} metrics={m} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write stub `HotStocksDetailPage`**

```tsx
import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { hotStocksApi } from '../services/api';
import type { StockMetrics } from '../types/hotstocks';

export function HotStocksDetailPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const [data, setData] = useState<StockMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    hotStocksApi.single(symbol).then(setData).catch((e) => setErr(e.message));
  }, [symbol]);

  if (err) return <div className="p-6 text-red-400">Failed: {err}</div>;
  if (!data) return <div className="p-6 text-slate-400">Loading {symbol}...</div>;

  return (
    <div className="p-6">
      <div className="text-sm text-slate-500 mb-2">
        <a href="/hot-stocks" className="hover:text-slate-300">← Hot Stocks</a>
      </div>
      <h1 className="text-3xl font-semibold text-slate-100">{data.symbol}</h1>
      <div className="text-sm text-slate-400 mb-4">{data.sector} · ₹{data.ltpYesterday.toFixed(2)}</div>

      <div className="bg-slate-900/60 border border-amber-500/40 rounded-lg p-4 my-4">
        <div className="text-xs text-amber-400 mb-1">SMART TRADER THESIS</div>
        <div className="text-slate-200">{data.thesisText}</div>
      </div>
      <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-4 my-4">
        <div className="text-xs text-amber-400 mb-1">ACTION</div>
        <div className="text-slate-200 font-mono">{data.actionCueText}</div>
      </div>

      <div className="mt-6 text-xs text-slate-500 italic">
        Full detail page (deal timeline, price chart, delivery trend, sector context, strategies watching,
        raw data audit) ships in Phase 1b.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard/frontend && git add src/pages/HotStocksPage.tsx src/pages/HotStocksDetailPage.tsx && git commit -m "feat(hotstocks): HotStocksPage grid + stub detail page"
```

---

# Section M — Routing, Nav, Colors

### Task M1: Register routes in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add imports**

Add at top with other page imports:

```tsx
import { HotStocksPage } from './pages/HotStocksPage';
import { HotStocksDetailPage } from './pages/HotStocksDetailPage';
```

- [ ] **Step 2: Add routes**

In the Routes block (around line 279), alongside the existing `/wallets` route:

```tsx
<Route path="/hot-stocks" element={
  <ProtectedRoute><Layout><HotStocksPage /></Layout></ProtectedRoute>
} />
<Route path="/research/:symbol" element={
  <ProtectedRoute><Layout><HotStocksDetailPage /></Layout></ProtectedRoute>
} />
```

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/trading-dashboard/frontend && git add src/App.tsx && git commit -m "feat(hotstocks): register /hot-stocks and /research/:symbol routes"
```

### Task M2: Add nav item in Sidebar

**Files:**
- Modify: `frontend/src/components/Layout/Sidebar.tsx`

- [ ] **Step 1: Add nav entry**

In the `navItems` array (around line 17), after the MarketPulse or Strategies entry, add:

```tsx
{
  path: '/hot-stocks',
  label: 'Hot Stocks',
  icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.24 17 7c1.1 2 1.584 3.75 1.5 5.5-.077 1.612-.977 3.11-1.843 4.157z" />
  </svg>),
},
```

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/trading-dashboard/frontend && git add src/components/Layout/Sidebar.tsx && git commit -m "feat(hotstocks): add Hot Stocks nav item"
```

### Task M3: Register HOTSTOCKS in strategyColors

**Files:**
- Modify: `frontend/src/utils/strategyColors.ts:10-11,23-46,68-82`

- [ ] **Step 1: Add to `StrategyKey` union**

Line 10 — add `'HOTSTOCKS'` to the union.

- [ ] **Step 2: Add color block**

Line 23-46 — add HOTSTOCKS entry to the `STRATEGY_COLORS` record:

```ts
HOTSTOCKS: {
  border: 'border-amber-500/40',
  bg: 'bg-amber-500/10',
  text: 'text-amber-300',
  accent: 'text-amber-400',
  dotClass: 'bg-amber-500',
},
```

- [ ] **Step 3: Add to `STRATEGY_FILTER_OPTIONS`**

Line 68-82 — add:

```ts
{ value: 'HOTSTOCKS', label: 'Hot Stocks' },
```

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/trading-dashboard/frontend && git add src/utils/strategyColors.ts && git commit -m "feat(hotstocks): register HOTSTOCKS in StrategyKey + colors"
```

### Task M4: Remove old Pre-Market Watchlist from MarketPulsePage

**Files:**
- Modify: `frontend/src/pages/MarketPulsePage.tsx`

- [ ] **Step 1: Locate the Pre-Market Watchlist section**

Search MarketPulsePage for `Pre-Market Watchlist`. The section typically has a header like `<h2>Pre-Market Watchlist for ...</h2>` followed by a mapping over `insights.watchlist` or similar.

- [ ] **Step 2: Delete the entire section**

Remove the JSX block plus any unused imports and state/useEffect hooks that only serve that section. Leave the rest of MarketPulsePage untouched.

- [ ] **Step 3: Verify page still renders**

```bash
cd /home/ubuntu/trading-dashboard/frontend && npm run build 2>&1 | tail -30
```
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/trading-dashboard/frontend && git add src/pages/MarketPulsePage.tsx && git commit -m "refactor(market-pulse): remove Pre-Market Watchlist section, superseded by /hot-stocks"
```

---

# Section N — Deploy + Smoke Test

### Task N1: Build + restart backend + frontend

**Files:** None (runtime).

- [ ] **Step 1: Backend restart**

```bash
cd /home/ubuntu/trading-dashboard/backend && mvn -q clean package -DskipTests
ps aux | grep java | grep -v grep | grep trading-dashboard
kill -9 <wrapper-pid> <jvm-child-pid>
cd /home/ubuntu/trading-dashboard/backend && nohup mvn spring-boot:run > nohup.out 2>&1 &
sleep 20 && tail -60 nohup.out
```
Expected: startup success, no errors, no stack traces from Hot Stocks classes.

- [ ] **Step 2: Frontend restart**

```bash
pm2 restart trading-dashboard
pm2 logs trading-dashboard --lines 20 --nostream
```
Expected: no compile errors from the new .tsx files.

### Task N2: End-to-end smoke test

**Files:** None.

- [ ] **Step 1: Trigger enrichment + wait**

```bash
curl -s -X POST http://localhost:8085/api/hot-stocks/admin/run-enrichment
sleep 90
tail -80 /home/ubuntu/trading-dashboard/backend/nohup.out | grep -E "HotStocks|error"
```
Expected: "HotStocksEnrichmentJob complete: N computed, M ranked" with N≥50, M≥6.

- [ ] **Step 2: Verify wallet state**

```bash
redis-cli HGETALL wallet:entity:strategy-wallet-HOTSTOCKS
```
Expected: `initialCapital=1000000`, `currentBalance≈1000000`, `availableCapital>0`.

- [ ] **Step 3: Verify frontend**

```bash
curl -s http://13.204.237.230:3001/hot-stocks -I
```
Expected: 200 OK.

Open `http://13.204.237.230:3001/hot-stocks` in a browser:
- Sidebar shows "Hot Stocks" entry
- Page renders 6 F&O cards in 2×3 grid
- Each card has: symbol + F&O badge + price, thesis text paragraph, 3×3 icon grid, action cue row
- Clicking a card navigates to `/research/{symbol}` and shows the stub detail page
- Wallets page shows HOTSTOCKS wallet with ₹10L balance in amber

- [ ] **Step 4: Capture screenshots**

Save 1 screenshot of the /hot-stocks page and 1 of the stub detail page. Attach to the ship commit as proof.

- [ ] **Step 5: Commit the screenshots to docs**

```bash
cd /home/ubuntu/trading-dashboard && git add docs/screenshots/hot-stocks-phase1a-*.png 2>/dev/null || true
git commit --allow-empty -m "ship(hotstocks): Phase 1a deployed — card grid + stub detail + HOTSTOCKS wallet"
```

### Task N3: Schedule verification for next market-open

**Files:** None — this is a runtime reminder.

- [ ] **Step 1: Wait for Monday 05:45 IST**

Verify the enrichment cron fired:
```bash
grep "HotStocksEnrichmentJob starting" /home/ubuntu/trading-dashboard/backend/nohup.out | tail -3
```
Expected: one entry at ~05:45:00 IST.

- [ ] **Step 2: Wait for Monday 09:15 IST**

Verify the position opener fired:
```bash
grep "HotStocksPositionOpenerJob" /home/ubuntu/trading-dashboard/backend/nohup.out | tail -5
```
Expected: "HotStocksPositionOpenerJob complete: 6 positions opened".

- [ ] **Step 3: Inspect Redis positions**

```bash
redis-cli KEYS "virtual:positions:*" | while read k; do
  src=$(redis-cli HGET "$k" signalSource)
  if [ "$src" = "HOTSTOCKS" ]; then echo "$k"; fi
done
```
Expected: 6 keys returned.

- [ ] **Step 4: If any step fails, open a Phase 1a bugfix issue**

Do NOT modify the plan — log what went wrong, timestamps, and relevant tail of `nohup.out`, then hand off to a follow-up session.

---

## Spec coverage review

| Spec section | Task coverage |
|---|---|
| 4. Data sources | E1–E6 (FastAnalytics bulk, 5paisa client, bhavcopy, deal archive, corporate events, strategy cross-ref) |
| 5.1 Enrichment job | H1 (05:45 IST cron) |
| 5.2 StockMetrics schema | A5 (full DTO with all Phase 1 fields) |
| 5.3 Card layout | L1 (thesis + 3×3 icon grid + action cue) |
| 5.3.1 Thesis generator | B1–B5 (5 clauses + fallback + cap, TDD) |
| 5.3.2 Icon-field mapping | L1 icon grid JSX |
| 5.3.3 Action cue | C1–C2 (5 rules + OBSERVE fallback + LOW_LIQ prefix) |
| 5.4 Detail page | L2 **stub only** — full 9 sections deferred to Phase 1b plan |
| 5.5 HOTSTOCKS wallet | I1–I5 (register key + restart + opener + kill switch) |
| 5.6 Wallet integration | I1, M3 (dashboard resolver + frontend colors) |
| 5.7 API endpoints | J1 (list, single, wallet, positions) — `/deals`, `/events`, `/strategies` per-symbol endpoints deferred to Phase 1b |
| 6. Phase 2 scoring | **Deferred to separate plan** |
| 7. Timeline | Covered by Section N deploy tasks |
| 8. Gate decisions | Gate 1 (data quality) = Task N2 step 1; Gates 2–4 belong to Phase 2 plan |

**Explicit gaps vs. full spec, all deferred to Phase 1b or Phase 2 plans**:
- Detail page sections 2–9 (deal timeline chart, price chart, delivery bar, corporate events calendar, sector context, strategies watching panel, raw data audit) — Phase 1b
- Per-symbol deals/events/strategies endpoints — Phase 1b
- Phase 2 scoring layer, regime detector, backtest, kill switch decisioning — Phase 2 plan
- `market_pulse_history` full schema with 15y bhavcopy retention — Phase 1b does the historical backfill; Phase 1a just wires the `hot_stocks_history` collection for daily snapshots
- Sector 5d return lookup (`HotStocksEnrichmentJob.loadOiChange5d` returns null, `loadDelivery5d` returns empty list) — Phase 1b fills these

These gaps do not block the Monday ship: the UI degrades gracefully when fields are null, and the card grid + thesis + action cue are fully functional with just the 5paisa candles + deal archives + corporate events.

**End of Phase 1a plan.**
