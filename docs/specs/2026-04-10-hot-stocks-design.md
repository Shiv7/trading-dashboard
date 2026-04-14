# Hot Stocks — Design Specification

**Date**: 2026-04-10  
**Status**: Draft — awaiting user review  
**Scope**: Positional (1-week to multi-month) equity research + scoring system  
**Supersedes**: Current Pre-Market Watchlist in `MarketPulsePage.tsx`

---

## 1. Problem Statement

Users need to make confident positional buy/sell decisions for Indian equities with a 1-week to multi-month hold horizon. The current Pre-Market Watchlist shows a narrow strip of 5 cards with minimal data (symbol, BUY/SELL label, netCr, 2 sentences). A trader cannot act from that alone — they need institutional context, structural trend state, delivery patterns, corporate events, and ideally a validated confidence signal.

## 2. Goals

**Primary goal**: enable a trader to scan 6 stocks and, by clicking one card, see all the institutional + structural + corporate context needed to make a confident 1-week to 1-month positional decision, in under 60 seconds of reading.

**Secondary goal**: build the system in a way that can layer a validated scoring model on top without rebuilding the frontend, but only if the scoring empirically works.

**Non-goals**:
- Intraday/scalp trading (covered by FUDKII, FUKAA, FUDKOI, MERE, MICROALPHA, QUANT, RETEST strategies)
- Options trading (no gap-up/penny option plays; separate future feature if demanded)
- Promoter/insider/SAST data (not scraped; deferred)
- Analyst targets or news sentiment (not scraped; deferred)

## 3. Architecture

Two-phase plugin model. Phase 1 ships fact-only research. Phase 2 adds regime-aware scoring via a pluggable interface. The UI has an empty slot for confidence that's populated in Phase 2 without frontend rebuild.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 1 — Hot Stocks (facts)                 │
│                                                                 │
│  Data Layer          Enrichment Job         UI                  │
│  (Mongo/Redis)  ──▶  (05:45 IST daily)  ──▶ (React)             │
│                                                                 │
│  - deals cache                               - snapshot grid    │
│  - delivery %                                - detail page      │
│  - 5paisa candles                            - wallet view      │
│  - corporate events                                             │
│  - OI metrics                                                   │
│                                                                 │
│  Wallet: strategy-wallet-HOTSTOCKS                              │
│  - 10 Lakh initial, 1.5L per position, max 6 concurrent         │
│  - Auto-opens virtual positions at 09:15 IST on top 6 picks     │
│  - 5-day time stop, -5% SL, -3% 3-day kill switch               │
│                                                                 │
│                        Scoring Plugin Interface                 │
│                        score() returns empty in Phase 1         │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                 PHASE 2 — Conviction Layer (scoring)            │
│                                                                 │
│  Regime Detector  ──▶  Regime-Aware Scorer  ──▶  Shadow Tracker │
│  BULL/RANGE/           3 models (momentum/         Kill switch  │
│  BEAR/CRASH            mean-rev/defensive)         auto-halt    │
│                                                                 │
│                   score() returns 0-100 when validated          │
│                   UI shows confidence % after Thursday decision │
└─────────────────────────────────────────────────────────────────┘
```

**Plugin point**: a single `ConvictionScorer` interface in backend. Phase 1 ships with a `NoOpScorer` that returns `Optional.empty()`. Phase 2 implements `RegimeAwareScorer` that returns scores. UI code doesn't know which scorer is active — it renders whatever the backend returns.

## 4. Data Sources (all free)

| Source | Content | Depth | Access |
|---|---|---|---|
| 5paisa historical (via FastAnalytics `/getHisDataFromFivePaisa`) | 1D OHLCV per stock | 3+ years | Already integrated |
| NSE bhavcopy archive | EOD OHLCV + delivery % per stock | 15+ years | Free download |
| NSE bulk deals archive | Client-level bulk deals | 5+ years | Free CSV |
| NSE block deals archive | Client-level block deals | 5+ years | Free CSV |
| NSE corporate actions | Splits, dividends, bonuses, AGMs, earnings | 3+ years | Scrape |
| NSE Nifty + sector indices | Index EOD | 15+ years | Free |
| India VIX historical | VIX EOD | 10+ years | Free |
| tradeExcutionModule (port 8089) | Live strategy state for cross-reference | Live | Internal API |
| `oi_metrics_1m` (MongoDB) | OI per scripCode | ~3 months | Internal |

All data lands in a new MongoDB collection `market_pulse_history` with schema versioning for future migrations.

## 5. Phase 1 — Hot Stocks (ships Monday)

### 5.1 Backend enrichment job

New scheduled method in `MarketPulseInsightsService`:

```java
@Scheduled(cron = "0 45 5 * * MON-FRI", zone = "Asia/Kolkata")
public void buildHotStocks() {
    List<String> universe = loadFnoUniverse();  // 217 F&O stocks
    for (String scripCode : universe) {
        StockMetrics m = computeMetrics(scripCode);
        cacheToRedis("hotstocks:v1:" + scripCode, m, Duration.ofHours(36));
    }
    List<StockMetrics> ranked = rankTopN(universe, 6 + 12); // 6 F&O + 12 non-F&O
    cacheToRedis("hotstocks:v1:universe", ranked, Duration.ofHours(36));
}
```

Runs daily 05:45 IST. All data from cached Redis/Mongo — zero external API calls in the hot path.

### 5.2 `StockMetrics` schema

Single source of truth per stock per day. All fields are **facts** derived from authoritative sources. Nothing predicts.

```java
class StockMetrics {
    // Identity
    String scripCode;
    String symbol;
    String sector;
    boolean fnoEligible;
    String lastUpdatedIst;

    // Price facts (computed from 5paisa 1D candles)
    double ltpYesterday;
    double change1dPct;
    double change5dPct;
    double change20dPct;

    // vs sector index (NEW in Phase 1)
    double vsSectorIndexPct;        // stock 5D return - sector 5D return
    String vsSectorLabel;            // "LEADING" / "INLINE" / "LAGGING"

    // vs Nifty 50 (NEW in Phase 1)
    double vsNifty50Pct;            // stock 5D return - Nifty 5D return
    String vsNiftyLabel;

    // Smart money facts (last 10-day window, client-classified)
    int bulkDealCount;
    int blockDealCount;
    int dealDays;                   // number of days with ≥1 deal
    double smartBuyCr;              // institutional net buying
    double smartSellCr;
    List<String> smartBuyClients;   // de-duped institution names
    List<String> smartSellClients;
    String dominantFlow;            // "FII_BUY"/"DII_BUY"/"FII_SELL"/"DII_SELL"/"MIXED"

    // Delivery facts with interpretation (NEW interpretation in Phase 1)
    double deliveryPctLatest;
    double deliveryPctAvg5d;
    String deliveryTrend;           // "RISING" / "FALLING" / "STABLE"
    String deliveryInterpretation;  // "STRONG_INSTITUTIONAL_ACCUMULATION" (>60% + rising)
                                    // "MODERATE_HOLDING" (50-60%)
                                    // "MIXED_ROTATION" (40-50%)
                                    // "RETAIL_DOMINATED" (<40%)
    String deliveryTrendLabel;      // "MF_ACCUMULATING" / "MF_DISTRIBUTING" / "STABLE"
    boolean deliveryInstitutional;  // avg5d ≥ 50

    // Structural facts (computed from 5paisa 1D candles)
    Double above50dmaPct;           // (close - 50DMA) / 50DMA * 100
    Double above200dmaPct;
    String trendState;              // "UPTREND" / "DOWNTREND" / "SIDEWAYS" / "INSUFFICIENT"
    Double rsi14;
    Double weekly52PositionPct;     // 0 = at 52W low, 100 = at 52W high

    // Per-stock regime (NEW in Phase 1)
    String priceRegime;             // "BULLISH_TREND" / "BEARISH_TREND" / "RANGE_BOUND"
    double priceRegimeConfidence;   // 0-1

    // Sector context
    double sectorChange1dPct;
    double sectorChange5dPct;
    int sectorRankInSector;         // this stock's rank within its sector
    int sectorRankBySectorPerf;     // sector's rank vs other sectors (1 = best)
    String sectorState;             // "LEADING" / "NEUTRAL" / "LAGGING"

    // Volume facts
    double volumeRatio5d20d;        // 5D avg / 20D avg
    String volumeRegime;            // "ELEVATED" / "NORMAL" / "QUIET"

    // OI facts (F&O only, NEW in Phase 1)
    Double oiChangePct5d;           // 5-day OI change %
    String oiInterpretation;        // "LONG_BUILDUP"/"SHORT_COVERING"/"SHORT_BUILDUP"/"LONG_UNWINDING"
    String volumeRegimeLabel;       // "INSTITUTIONAL_ACCUMULATION" (vol >2x + LONG_BUILDUP)
                                    // "RETAIL_SPIKE" (vol >2x + OI flat/down)
                                    // "NORMAL" / "QUIET"

    // Corporate actions (NEW interpretation in Phase 1)
    List<CorporateEvent> upcomingEvents;  // all events within next 30 days
    Integer daysToNearestEvent;
    String nearestEventType;        // "EARNINGS" / "DIVIDEND" / "SPLIT" / "BONUS" / "AGM"
    boolean eventWithin3Days;       // used for ⚠ badge
    boolean hasSplitAnnouncement;   // split within 30 days
    boolean hasBonusAnnouncement;
    boolean hasDividendExDate;      // ex-dividend within 10 days
    String nextCorporateActionLabel; // "1:2 SPLIT on 15 Apr" or null

    // Strategy cross-reference (NEW in Phase 1)
    List<StrategyWatch> strategiesWatching;  // from tradeExcutionModule port 8089

    // Liquidity (NEW in Phase 1 — essential for positional sizing)
    double avgTurnover20dCr;        // 20D average (close * volume) / 1Cr
    String liquidityTier;           // "HIGH" (≥100Cr) / "MED" (20-100Cr) / "LOW" (<20Cr)

    // Swing levels for action cue (NEW in Phase 1)
    double swingLow20d;             // 20D rolling low
    double swingHigh20d;            // 20D rolling high
    double entryZoneLow;            // suggested entry zone low
    double entryZoneHigh;           // suggested entry zone high
    double suggestedSlPrice;        // stop loss price (20D swing low)

    // Smart-trader narrative (NEW in Phase 1)
    String thesisText;              // rule-based generated thesis, 2-4 sentences
    String actionCueType;           // "BUY_DIP"/"WAIT_PULLBACK"/"BUY_RANGE_LOW"/
                                    // "HOLD_OFF_EVENT"/"AVOID"/"OBSERVE"
    String actionCueText;           // pre-rendered single-line cue

    // Phase 2 scoring slot
    Optional<Integer> confidenceScore;       // 0-100 when Phase 2 validated
    Optional<String> scoringRegime;          // "BULL"/"RANGE"/"BEAR"/"CRASH"
    Optional<String> scoringModel;           // "MOMENTUM"/"MEAN_REVERSION"/"DEFENSIVE"
}

class StrategyWatch {
    String strategyName;            // "FUDKII"
    String state;                   // "WATCHING" / "ACTIVE" / "PENDING_ENTRY"
    Double triggerLevel;            // e.g. 247.50
    String notes;                   // "BB squeeze forming"
}
```

### 5.3 Hot Stocks card layout (snapshot)

The card is organized top-down around the trader's decision flow: **what is this, what's the story, what do the facts say, what should I do now**. The story is a rule-based thesis paragraph that synthesizes every data point into 2–4 lines of narrative. The facts are compressed into a 3-row icon grid so the thesis has room to breathe without growing the card. The bottom of the card is an **action cue** — the essential missing piece that tells the trader *what to do now*, not just *what is true*.

Desktop: 2 columns × 3 rows grid = 6 F&O stocks above fold. Non-F&O section below, collapsed.

```
┌────────────────────────────────────────────┐
│ DELHIVERY     [F&O] ⚡3d       ₹442.15 ↑1.2%│  header: symbol, badges, urgency, price
│ Logistics · Leader #3/12 · 5D +3.4%        │  sector+rank+rolling return
│                                            │
│ ┃ Smart money accumulated ₹89Cr across     │  ◀ smart-trader thesis
│ ┃ 3 MF days; stock leads Logistics by      │  ◀ rule-based generation
│ ┃ +2.3% while holding above 50 DMA with    │  ◀ 2–4 lines, deterministic
│ ┃ LONG_BUILDUP on 2.3× volume. 1:2 split   │  ◀ (see 5.3.1)
│ ┃ in 5 days may compress the entry window. │
│                                            │
│ 🏛 +89Cr·3MF   📦 58%↑    📈 +2.3%vsSctr   │  icon row 1 — money + delivery + RS
│ 🔥 2.3× Vol    🎯 BULL    ⚙ LONG_BUILD    │  icon row 2 — volume + regime + OI
│ 👁 FUDKII+MERE ⚡ 1:2 15Apr   💧 HIGH      │  icon row 3 — strategies + event + liquidity
│                                            │
│ ▸ BUY DIP ₹438–442  •  SL ₹420  •  5d     │  ◀ action cue (NEW, essential)
│                                            │
│                            tap to open →   │
└────────────────────────────────────────────┘
```

Card dimensions: ~320px × 340px. Responsive:
- Desktop (≥1024px): 2 columns × 3 rows
- Tablet (≥768px): 2 columns × N rows  
- Mobile (<768px): 1 column, scrollable

Below the F&O grid:
- `"Non-F&O Picks (12)"` — collapsible header
- Expanded: same 280-width cards, up to 12 non-F&O picks
- `"Show all 28 picks"` — link opens full research page

### 5.3.1 Smart-trader thesis (rule-based generation)

The thesis is a narrative paragraph composed from detected patterns in `StockMetrics`. It is **not** LLM-generated — every sentence comes from a deterministic template triggered by a boolean condition, so it is explainable, auditable, and repeatable on the same input.

The generator walks an ordered list of rules, appends every matched clause, then joins them into 2–4 sentences capped at ~240 characters. Order matters: the highest-signal clauses come first so that if the cap truncates, the truncated content is the weakest.

```java
class ThesisGenerator {
    String generate(StockMetrics m) {
        List<String> clauses = new ArrayList<>();

        // 1. Smart money — highest signal
        if (m.deliveryInstitutional && m.smartBuyCr >= 50 && m.dealDays >= 2) {
            int mfCount = countDistinct(m.smartBuyClients, "MF");
            clauses.add(String.format("Smart money accumulated ₹%.0fCr across %d %s days",
                m.smartBuyCr, m.dealDays, mfCount >= 2 ? mfCount + " MF" : "deal"));
        } else if (m.smartSellCr >= 50 && m.dealDays >= 2) {
            clauses.add(String.format("Institutions distributed ₹%.0fCr over %d days",
                m.smartSellCr, m.dealDays));
        }

        // 2. Relative strength + structural context
        if (m.vsSectorLabel.equals("LEADING") && m.trendState.equals("UPTREND")) {
            clauses.add(String.format("stock leads %s by %+.1f%% while holding above 50 DMA",
                m.sector, m.vsSectorIndexPct));
        } else if (m.vsSectorLabel.equals("LAGGING") && m.trendState.equals("DOWNTREND")) {
            clauses.add(String.format("lagging %s by %.1f%% and below 50 DMA",
                m.sector, Math.abs(m.vsSectorIndexPct)));
        } else if (m.vsNifty50Pct > 2 && m.priceRegime.equals("RANGE_BOUND")) {
            clauses.add(String.format("outperforming Nifty by %+.1f%% in a rangebound tape",
                m.vsNifty50Pct));
        }

        // 3. OI + volume confirmation (F&O only)
        if (m.fnoEligible && "LONG_BUILDUP".equals(m.oiInterpretation)
                && m.volumeRatio5d20d >= 1.5) {
            clauses.add(String.format("LONG_BUILDUP on %.1f× volume confirms conviction",
                m.volumeRatio5d20d));
        } else if (m.fnoEligible && "SHORT_BUILDUP".equals(m.oiInterpretation)) {
            clauses.add("SHORT_BUILDUP signals bearish positioning");
        }

        // 4. Delivery trend as standalone when no deals
        if (clauses.isEmpty() && m.deliveryPctAvg5d >= 60 && "RISING".equals(m.deliveryTrend)) {
            clauses.add(String.format("delivery at %.0f%% and rising — holding-hands accumulation",
                m.deliveryPctAvg5d));
        }

        // 5. Event compression — always last, always appended
        if (m.eventWithin3Days) {
            clauses.add(String.format("%s in %d days may compress the entry window",
                humanize(m.nearestEventType), m.daysToNearestEvent));
        } else if (m.hasSplitAnnouncement || m.hasBonusAnnouncement) {
            clauses.add(String.format("%s announced for %s",
                m.nextCorporateActionLabel, m.nearestEventType));
        }

        // 6. Fallback when nothing fires
        if (clauses.isEmpty()) {
            return "Watchlist entry on mixed signals — open detail page for drivers.";
        }

        return capitalize(String.join("; ", clauses)) + ".";
    }
}
```

**Properties of the generator**:
- **Deterministic**: same metrics → same text. No sampling, no LLM.
- **Explainable**: every clause has a visible boolean trigger, auditable in code review.
- **Self-limiting**: max 5 clauses joined by "; " caps at ~240 chars naturally.
- **Graceful**: fallback clause fires when no pattern matches, so the card never shows an empty thesis.
- **Testable**: pure function on `StockMetrics` — unit tests assert exact text for fixture inputs.

A parallel `generateBearThesis()` exists for short candidates (inverse conditions). The generator selection is driven by the dominant signal direction on the metric, not by `priceRegime` alone — a stock in RANGE_BOUND with heavy distribution still gets a bearish thesis.

### 5.3.2 Icon-field mapping

All numeric facts previously shown as labeled rows are compressed to `emoji value` pairs and arranged in a 3×3 grid. Every icon maps to a single `StockMetrics` field via a pure render function, so hiding a row on missing data is trivial (`null → omit slot`, grid collapses).

| Icon | Field | Rendered example | Source field |
|---|---|---|---|
| 🏛 | Smart money net | `+89Cr·3MF` | `smartBuyCr` + distinct MF count |
| 📦 | Delivery % + trend | `58%↑` | `deliveryPctLatest` + `deliveryTrend` arrow |
| 📈 | RS vs sector | `+2.3%vsSctr` | `vsSectorIndexPct` |
| 🔥 | Volume ratio | `2.3× Vol` | `volumeRatio5d20d` |
| 🎯 | Per-stock regime | `BULL` | `priceRegime` (shortened) |
| ⚙ | OI interpretation | `LONG_BUILD` | `oiInterpretation` (shortened, F&O only) |
| 👁 | Strategies watching | `FUDKII+MERE` | `strategiesWatching` joined, max 2 |
| ⚡ | Nearest event | `1:2 15Apr` | `nextCorporateActionLabel` |
| 💧 | Liquidity tier | `HIGH` / `MED` / `LOW` | derived from 20D avg value traded |
| ⚠ | Risk badge (header) | `⚠` | shown when `eventWithin3Days` OR `vix > 22` |
| ⚡Nd (header) | Time urgency | `⚡3d` | shown when `daysToNearestEvent ≤ 5` |

**Layout rules**:
- If a cell's source field is null/unavailable (e.g., non-F&O has no OI interpretation), the cell is **omitted** and the remaining cells in that row re-flow left. A row with zero cells is hidden entirely.
- Short constant labels (`BULL`, `LONG_BUILD`) are read from an enum map so Phase 2 scoring can reuse them.
- Strategies row joins up to 2 names with `+`; overflow becomes `+N more`.

**Essential addition — Liquidity tier (💧)**: a positional trader must know whether they can realistically enter and exit at their intended position size. Liquidity is derived once per day as `20D avg (close × volume)`:

| Tier | Rupee turnover (20D avg) | Meaning |
|---|---|---|
| HIGH | ≥ ₹100 Cr | Can enter any size up to 1.5L without visible impact |
| MED | ₹20–100 Cr | Fine for 1.5L position, stagger over the day |
| LOW | < ₹20 Cr | Skip or halve the position size — slippage risk |

Stocks below ₹5 Cr turnover are filtered out of the universe upstream.

### 5.3.3 Action cue (essential addition)

Below the icon grid, one line tells the trader **what to do now**:

```
▸ BUY DIP ₹438–442  •  SL ₹420  •  5d
```

The action cue is derived from a small decision table, not the scoring layer. It fires in Phase 1 using only facts, and refines in Phase 2 if scoring is live.

| Condition | Cue |
|---|---|
| `trendState=UPTREND` AND `weekly52PositionPct < 85` AND `vsSectorLabel=LEADING` | `▸ BUY DIP {swing-low}–{ltp}  •  SL {20D-swing-low}  •  5d` |
| `trendState=UPTREND` AND `weekly52PositionPct ≥ 85` | `▸ WAIT FOR PULLBACK — extended at 52W` |
| `trendState=SIDEWAYS` AND `priceRegime=RANGE_BOUND` AND `rsi14 < 40` | `▸ BUY RANGE LOW ₹{rng-low}  •  SL {rng-low}-3%  •  5d` |
| `eventWithin3Days` AND `nearestEventType=EARNINGS` | `▸ HOLD OFF — earnings in {N}d` |
| `trendState=DOWNTREND` AND `vsSectorLabel=LAGGING` | `▸ AVOID — structural downtrend` |
| `liquidityTier=LOW` | `▸ HALF SIZE — low liquidity` (prepended to the primary cue) |
| All Phase 2 scored and `confidenceScore ≥ 80` | Prepend `[CONVICTION 82]` badge to whichever cue fired |
| Nothing above matches | `▸ OBSERVE — drivers mixed` |

The three values in the primary BUY cue (entry zone, SL, horizon) are the minimum set a trader needs to act from a card alone. The cue is intentionally short so traders can scan six cards and pick one to drill into.

### 5.4 Hot Stocks detail page (`/research/{symbol}`)

New route in React Router. Reuses the strategies-page layout shell (sidebar, header, content area). 9 sections top-to-bottom ordered by decision relevance:

1. **Hero**: symbol, F&O badge, sector, live price, 1D/5D/20D/1Y returns, last updated
2. **Deal timeline**: chronological bulk + block deals, 10-day window, color-coded buy/sell, client names
3. **Delivery trend**: 5-day bar chart with institutional zone (50%) line + interpretation
4. **Price chart**: 60-day daily candles with 50 DMA + 200 DMA overlays
5. **Volume + OI panels**: 20-day trend lines, OI interpretation labeled per day
6. **Corporate events**: 30-day calendar view, urgent events (within 3 days) highlighted
7. **Sector context**: sector index chart + top 5 peers comparison table
8. **Strategies watching** (unique differentiator): live cross-reference to FUDKII/FUKAA/FUDKOI/MERE/MICROALPHA/QUANT/RETEST state from port 8089. Shows which strategies have this stock on their radar, at what trigger levels, in what state (WATCHING/ACTIVE/PENDING)
9. **Raw data audit**: expandable tables with every deal, every candle, every event — for users who want to verify

### 5.5 HOTSTOCKS wallet

**Wallet ID**: `strategy-wallet-HOTSTOCKS` in Redis, follows existing conventions.

**Configuration**:
- Initial capital: 10,00,000 (10 Lakh)
- Position size per pick: 1,50,000 (~15% of wallet)
- Max concurrent positions: 6 (matches grid size)
- Daily loss cap: 10% of currentBalance
- Daily reset: 8:55 AM IST weekdays (via `WalletDailyResetService`)

**Position lifecycle** (Variant B — auto-opens positions):

```
09:15 IST (market open)
  │
  ├─▶ Hot Stocks job loads today's top 6 picks from hotstocks:v1:universe
  │
  ├─▶ For each pick with no existing HOTSTOCKS position:
  │     - Compute qty: floor(1,50,000 / open_price)
  │     - Set SL: max(-5% from entry, below 20-day swing low)
  │     - Set time stop: close of trading day + 5
  │     - Record in wallet:HOTSTOCKS (deduct margin)
  │     - Create virtual:positions:{scripCode} (signalSource=HOTSTOCKS)
  │     - Create strategy:targets:{scripCode} (managed by existing StrategyTradeExecutor)
  │
  └─▶ Existing positions untouched

Day+1 to Day+4 (hold)
  │
  ├─▶ Existing monitor loop (StrategyTradeExecutor.monitorPositions) handles:
  │     - SL triggers → auto-exit via VirtualEngineService.closePosition()
  │     - Price updates → unrealized PnL
  │
  └─▶ Kill switch monitor checks 3-day wallet drawdown
        If > 3%: halt new position opens, let existing run to time stop

Day+5 (close, 15:25 IST)
  │
  └─▶ Time stop: auto-exit all positions opened on Day-5
        Realized PnL credited to wallet
        Position closed via existing close pipeline
        Logged to market_pulse_history for validation tracking
```

**Why variant B, not variant A**: without simulated positions, we have no objective way to measure whether the picks correlate with actual returns. The wallet is the validation instrument for Phase 2.

### 5.6 Strategy wallet integration (per dashboard CLAUDE.md)

Following the "Adding a New Strategy Wallet" procedure:

1. **Backend**: Add `"HOTSTOCKS"` to `StrategyWalletResolver.ALL_STRATEGY_KEYS` — wallet auto-creates at next startup with 10 Lakh.
2. **Signal routing**: Ensure `VirtualOrder.signalSource = "HOTSTOCKS"` on all created positions.
3. **Backend dashboard**: Update `StrategyWalletsService.STRATEGY_KEYS + DISPLAY_NAMES + normalizeStrategy()` to handle `HOTSTOCKS → "Hot Stocks"`.
4. **Frontend**: Add `"HOTSTOCKS"` to `StrategyFilter` type, `STRATEGY_COLORS` (amber `#F59E0B`), filter dropdown, skeleton loaders.

### 5.7 Phase 1 API endpoints

```
GET /api/hot-stocks                           → ranked list (6 F&O + 12 non-F&O)
GET /api/hot-stocks/{symbol}                  → full StockMetrics for detail page
GET /api/hot-stocks/{symbol}/deals            → deal timeline (10-day window)
GET /api/hot-stocks/{symbol}/events           → corporate events (30-day window)
GET /api/hot-stocks/{symbol}/strategies       → strategies watching (proxies port 8089)
GET /api/hot-stocks/wallet                    → HOTSTOCKS wallet state
GET /api/hot-stocks/wallet/positions          → current virtual positions
GET /api/hot-stocks/wallet/history            → closed positions history
```

All reads from Redis cache. No external calls in the hot path.

## 6. Phase 2 — Conviction Layer (ships Monday IF Sunday backtest passes)

### 6.1 Regime detector (rule-based, ~150 lines)

```java
enum MarketRegime { BULL, RANGE, BEAR, CRASH }

MarketRegime detect(MarketContext ctx) {
    // CRASH: extreme volatility or single-day drop
    if (ctx.vix > 25 || ctx.nifty1dChange < -2.0 || ctx.breadthAdRatio < 0.4) {
        return CRASH;
    }
    // BULL: structural uptrend + low vol + broad advance
    if (ctx.nifty50dmaRising && ctx.niftyPriceAboveDma50 
        && ctx.vix < 18 && ctx.breadthAdRatio > 1.2) {
        return BULL;
    }
    // BEAR: structural downtrend + moderate vol
    if (ctx.nifty50dmaFalling && ctx.niftyPriceBelowDma50 
        && ctx.vix >= 18 && ctx.vix <= 25) {
        return BEAR;
    }
    // RANGE: everything else
    return RANGE;
}
```

Regime detector runs once per day after market close. Published to Redis `regime:current`. Phase 2 scoring reads this to select the right scoring model.

### 6.2 Three regime-aware scoring models

**BULL scorer** (momentum-weighted):
- Trend alignment (above 10/50/200 DMA, rising): 25 pts
- Sustained smart-money accumulation: 20 pts
- Delivery >50% sustained: 15 pts
- Relative strength vs sector+Nifty: 15 pts
- Volume regime (5D > 20D): 10 pts
- 52-week positioning (>60%): 10 pts
- OI/volume interpretation (LONG_BUILDUP): 5 pts

**RANGE scorer** (mean-reversion weighted):
- Stock at lower half of 20-day range: 20 pts
- Delivery % trending up on recent bounce: 20 pts
- RSI < 40 (oversold): 15 pts
- Smart-money net buying while price rangebound: 15 pts
- Sector in rotation (bottom quartile by 5D return): 10 pts
- Volume spike on recent bounce day: 10 pts
- OI buildup at the low end of range: 10 pts

**BEAR scorer** (quality + defensive):
- Stock outperforming market by > 2% in past 5D: 25 pts
- Delivery >60% (flight to quality): 20 pts
- Low beta (< 0.9): 15 pts
- Above 200 DMA while broader market isn't: 15 pts
- Positive 1-day return on a red market day: 10 pts
- Smart-money net buying: 10 pts
- Dividend-paying with ex-date soon: 5 pts

**CRASH scorer**: returns empty (`Optional.empty()`). No scoring in crash regimes — too risky, defer to user.

Each scorer returns 0-100. Thresholds for display:
- 80-100: top tier, shown prominently
- 75-79: shown (initial conservative cutoff Monday)
- 60-74: computed but hidden during validation window
- < 60: computed, not surfaced

### 6.3 Plugin interface

```java
interface ConvictionScorer {
    Optional<ScoreResult> score(StockMetrics metrics, MarketRegime regime);
}

class ScoreResult {
    int score;           // 0-100
    String model;        // "MOMENTUM"/"MEAN_REVERSION"/"DEFENSIVE"
    Map<String, Integer> breakdown;  // per-component points for transparency
}

// Phase 1 implementation
class NoOpScorer implements ConvictionScorer {
    public Optional<ScoreResult> score(StockMetrics m, MarketRegime r) {
        return Optional.empty();
    }
}

// Phase 2 implementation
class RegimeAwareScorer implements ConvictionScorer {
    private final BullScorer bull = new BullScorer();
    private final RangeScorer range = new RangeScorer();
    private final BearScorer bear = new BearScorer();
    
    public Optional<ScoreResult> score(StockMetrics m, MarketRegime r) {
        switch (r) {
            case BULL: return bull.score(m);
            case RANGE: return range.score(m);
            case BEAR: return bear.score(m);
            case CRASH: return Optional.empty();
        }
    }
}
```

Spring `@Autowired(required=false)` — the UI doesn't know which implementation is active. At Phase 1 ship, `NoOpScorer` is injected. After Thursday validation, a property flag swaps to `RegimeAwareScorer`.

### 6.4 Backtest protocol (Sunday)

All 10 rules of robustness enforced. Any failure = Phase 2 doesn't ship.

**Rule 1 — Train/test split**:
- Train: 2023-01-01 to 2025-06-30 (30 months)
- Test: 2025-07-01 to 2026-04-10 (~9 months)
- Test data never touched during model development
- All reported metrics come from the test set

**Rule 2 — Walk-forward validation**:
- Step through history 90 days at a time
- Retrain weights every 90 days
- Report rolling performance to simulate live conditions

**Rule 3 — Regime-stratified metrics**:
- Separate Sharpe, hit rate, mean return per regime
- If any regime shows negative expectancy, that regime's scoring is disabled

**Rule 4 — Four baselines**:
- Random picks (fair comparison)
- Nifty 50 buy-and-hold
- Equal-weight F&O basket
- Always-top-sector buy-and-hold
- Scoring must beat ALL four on Sharpe in the test set

**Rule 5 — Transaction cost realism**:
- 0.1% round-trip slippage minimum
- 0.15% for stocks < ₹100 Cr turnover
- 0.25% for mid-cap non-F&O
- Applied to every simulated return

**Rule 6 — Statistical significance**:
- N ≥ 30 per regime required
- Bootstrap 95% confidence interval on Sharpe
- p-value vs random baseline must be < 0.05
- Report point estimate AND CI

**Rule 7 — Component ablation**:
- Remove each component one at a time
- If Sharpe unchanged or improves: delete the component (YAGNI)
- Final model contains only components with positive contribution

**Rule 8 — Negative control tests**:
- Shuffle labels: scoring should perform at random (catches data leaks)
- Random signals replacing real ones: scoring should perform at random (catches bugs)
- Half-split: train on half of stocks, test on other half (catches overfitting)

**Rule 9 — Sample-weighted evaluation**:
- Exponential recency decay (180-day half-life)
- Recent data weighted more heavily

**Rule 10 — Live shadow validation**:
- Monday-Tuesday-Wednesday of week 1
- Scoring visible on cards with VALIDATING amber badge
- Kill switch armed
- Thursday morning decision based on 3-day wallet PnL

### 6.5 Kill switch

Runs continuously after Phase 2 activation:

```
IF any of:
  - 3-day rolling HOTSTOCKS wallet drawdown > 3%
  - 3-day rolling hit rate of scored picks < 35%
  - 2 consecutive days with Sharpe < 0
  - Single day with > 2σ deviation from backtest expectation
THEN:
  - Disable scoring (swap RegimeAwareScorer → NoOpScorer via feature flag)
  - Stop opening new HOTSTOCKS positions
  - Let existing positions run to time stop
  - Log alert + notify via dashboard
  - Preserve all data for post-mortem
```

Kill switch thresholds are set from Sunday backtest variance so they're realistic, not arbitrary.

## 7. Timeline

| Day | Work | Gates |
|---|---|---|
| **Saturday** | Historical data backfill (5paisa 3y + NSE bhavcopy 2y + NSE deal archives 2y). Load to `market_pulse_history`. Verify quality. | Gate 1: data quality passed |
| **Sunday morning** | Phase 1 Hot Stocks backend: `StockMetrics` + enrichment job + 5 APIs + HOTSTOCKS wallet integration. | — |
| **Sunday afternoon** | Phase 2 regime detector + 3 scoring models. | — |
| **Sunday evening** | Full backtest with 10 robustness rules. Generate report. | Gate 2: backtest passes all 10 rules |
| **Monday 8:30 IST** | Ship Phase 1 frontend (card + detail page). Activate HOTSTOCKS wallet. If Gate 2 passed: ship Phase 2 scoring with VALIDATING badge, threshold ≥75. | — |
| **Mon-Tue-Wed** | Live validation window. Kill switch armed. Daily tracking. | Gate 3: no catastrophic failure |
| **Thursday 08:00 IST** | Review 3-day wallet PnL. Decision. | Gate 4: Thursday decision |
| **Thursday onwards** | Full activation OR extend validation OR kill scoring. Phase 1 always runs regardless. | — |

## 8. Gate-based decision tree

**Gate 1 (Saturday evening) — Data quality**
- Pass: data complete, no gaps, sensible values → proceed to Sunday
- Fail: data incomplete → fall back to 5paisa-only backtest, note limitation in spec

**Gate 2 (Sunday evening) — Backtest validation**
- Pass: all 10 robustness rules satisfied, at least one regime shows edge → ship Phase 2 Monday
- Fail: any rule violated → Phase 2 doesn't ship, Phase 1 ships alone, scoring revisited next week

**Gate 3 (Monday-Wednesday nightly) — Kill switch**
- Monitoring runs continuously
- Any threshold breach → scoring auto-disabled immediately, Phase 1 continues
- No manual intervention

**Gate 4 (Thursday morning) — Activation decision**
- HOTSTOCKS wallet PnL positive AND ≥ 0.5% above Nifty buy-hold for Mon-Tue-Wed → remove VALIDATING badge, full trust
- HOTSTOCKS PnL positive but below Nifty → extend VALIDATING window to Friday + next Monday (5 days total)
- HOTSTOCKS PnL negative → kill switch already fired, post-mortem, scoring archived

## 9. Accuracy, Uniqueness, Robustness

### Accuracy
- All Phase 1 data is fact-from-authoritative-source — no predictions
- Sources: NSE (official), 5paisa (institutional quality), internal strategy state (our own)
- 1-day lag on deal data is inherent to the market (T+0 disclosure)
- Per-scrip delivery % coverage expanded from top-200 to full NSE universe
- Per-field graceful degradation — missing data hides the field, never shows fake values

### Uniqueness vs TradingView / Moneycontrol / Zerodha Pulse
- **Strategy cross-reference** (Section 8 of detail page): only your system can show "FUDKII is watching this at ₹247 with eKII 74". No competitor has this data.
- **Deal repeat detection**: requires historical cache of client-level deals, which retail tools don't maintain.
- **Cross-stream signals**: deals + OI + delivery + corporate events unified per stock view.
- **Complete transparency**: confidence breakdown shown on detail page, not a black-box AI number.

### Robustness
- All data reads from Redis cache, built once daily
- Per-field graceful degradation
- Explicit last-updated timestamp
- No fabricated values
- Plugin architecture for scoring (can disable without rebuild)
- Kill switch auto-disables scoring on degradation
- Phase 1 always runs, even if Phase 2 is disabled

## 10. Non-Goals (explicit, to prevent scope creep)

- ❌ Intraday/scalp trading signals (existing strategies handle this)
- ❌ Options trading / gap-up plays (separate Gap Play Desk, future if ever)
- ❌ Promoter holdings / SAST disclosures (no scraper, would show fake data)
- ❌ Analyst target prices (not scraped)
- ❌ News feed / sentiment (not integrated)
- ❌ Fundamentals: PE, PB, ROE, D/E (not scraped, would need paid feed)
- ❌ AI/LLM scoring (explicit non-goal — all scoring is deterministic rule-based)
- ❌ Real broker order execution (wallet is virtual only, same as other strategies)

## 11. Open Questions (deferred)

These are explicitly deferred and NOT blockers for Phase 1/2 ship:

- **Quarterly earnings surprise**: valuable for positional but requires new scraper (~2 days work)
- **Fundamental ratios**: PE, PB, ROE, sales growth — valuable but needs paid feed
- **Promoter holding changes**: requires BSE quarterly shareholding pattern scraper
- **Insider trading / PIT disclosures**: separate NSE/BSE feed
- **Gap Play Desk** (overnight option bets on accumulation signals): explicitly deferred, requires its own scoring and backtest
- **Multi-month variant** (beyond 1-week hold): show same stock with both 1W and 1M+ execution blocks on detail page. Phase 2+ feature.

## 12. Success Metrics

### Phase 1 (facts-only)
- 100% of cards render within 200ms from cache
- Zero fabricated data fields (audit via sampling)
- Strategy cross-reference works when port 8089 is up, degrades gracefully when down
- User feedback: can they make a confident decision from a card in under 60 seconds?

### Phase 2 (scoring)
- Wallet 5-day Sharpe ≥ 1.3× random baseline over 30-day rolling window
- Hit rate ≥ 55% in at least 2 of 3 regimes (BULL, RANGE, BEAR)
- Kill switch never falsely triggers during stable regimes
- Zero production bugs in scoring pipeline

### Long-term (3-6 months)
- HOTSTOCKS wallet outperforms Nifty buy-hold by ≥ 5% on 3-month rolling basis
- No major regime blindspots discovered
- Component weights stable (walk-forward retuning doesn't drift wildly)

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Backtest passes but live trading fails (regime change, data lag) | Kill switch armed from day 1; Phase 1 facts layer is always a safe fallback |
| NSE archive scraping rate-limited or blocked on Saturday | Fall back to 5paisa-only backtest (narrower but valid), note limitation |
| Weight overfitting to recent market regime | Walk-forward validation + regime stratification enforces cross-regime generalization |
| HOTSTOCKS wallet margin leak (bug in position management) | Reuses existing tested `StrategyTradeExecutor` monitor loop; no new trade logic |
| Strategy cross-reference fails when port 8089 is down | Graceful degradation — section 8 shows "Strategy data unavailable" |
| Phase 2 scoring actively hurts returns in unforeseen regime | Kill switch auto-disables on 3-day drawdown > 3%; no multi-day exposure |
| Users act on Phase 1 facts and lose money | Phase 1 explicitly disclaims predictive intent; shows FACTS not BUY signals |

## 14. Ownership and Timeline

**Owner**: current session (post-brainstorming)

**Build time**:
- Saturday: 4-6 hours (data backfill)
- Sunday morning: 3-4 hours (Phase 1 backend + wallet)
- Sunday afternoon: 3-4 hours (Phase 2 regime + scorers)
- Sunday evening: 2-3 hours (backtest + validation)
- Monday morning: 2-3 hours (frontend + deploy)

**Total**: ~15-20 hours spread over the weekend, delivering Phase 1+2 by Monday NSE open.

**Non-goals for this spec's session**:
- Writing implementation code (writing-plans will produce the plan; execution happens in separate session)
- Real broker integration (wallet is virtual only)
- Additional strategies (HOTSTOCKS is the only new strategy wallet)

---

## Appendix A — Comparison to existing systems

| Feature | TradingView | Moneycontrol Pulse | Zerodha Kite | Hot Stocks |
|---|---|---|---|---|
| Per-stock price chart | ✅ | ✅ | ✅ | ✅ |
| Delivery % per stock | ❌ | Partial | ❌ | ✅ |
| Bulk/block deals with client names | ❌ | ✅ | ❌ | ✅ |
| Corporate events calendar | ✅ | ✅ | ✅ | ✅ |
| OI interpretation (long_buildup etc.) | ❌ | ❌ | Partial | ✅ |
| Strategy cross-reference to YOUR live signals | ❌ | ❌ | ❌ | ✅ (unique) |
| Regime-aware scoring (validated) | ❌ | ❌ | ❌ | Phase 2 |
| Kill switch for degraded scoring | ❌ | ❌ | ❌ | ✅ |
| Wallet-tracked simulated positions | ❌ | ❌ | ❌ | ✅ |

The unique differentiators (strategy cross-reference, wallet tracking, kill switch, regime-aware scoring) justify building Hot Stocks rather than using an existing tool.

---

**End of design specification**
