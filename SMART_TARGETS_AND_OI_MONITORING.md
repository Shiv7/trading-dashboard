# Smart Targets & OI Monitoring — Design Document

## Date: 2026-02-20

---

## 1. Problem Statement

Current StrategyTradeExecutor uses static targets from signal enrichment (equity pivots delta-adjusted to option levels). These targets:
- Don't account for option-specific price behavior (swing levels, round figures)
- Don't factor in multi-source confluence (equity pivots + option chart + psychology)
- Don't react to institutional OI patterns that signal trade exhaustion
- Miss mid-candle price spikes (fixed by per-tick Redis caching — separate change)

---

## 2. Current Data Available in Redis

| Data Source | Redis Key | Fields | Update Freq |
|-------------|-----------|--------|-------------|
| Equity pivots (D/W/M) | `pivot:mtf:{underlyingScripCode}` | PP, R1-R4, S1-S4, CPR, Fibonacci, Camarilla | ~60 min |
| OI metrics | `oi:{optionScripCode}:latest` | oiChange, oiChangePercent, interpretation, confidence | ~1 min |
| Option candle history | `tick:{optionScripCode}:1m:history` | Last 500 1m candles (OHLCV + volume profile) | Every candle |
| Volume profile | (inside each TickCandle) | POC, VAH, VAL | Per candle |
| Current option price | `price:N:{optionScripCode}` | Latest tick price | Per tick (hot scrips) |

### What Does NOT Exist
- **No option-specific pivot levels** — pivots are computed for equities only
- **No intraday pivots (15m, 30m, 1h)** — only daily/weekly/monthly
- **No pivot fields in TickCandle** — candles contain OHLCV only

---

## 3. OI Monitoring for Early Exit

### 3.1 Why Raw OI Decline Is Misleading

OI decline alone means nothing without price context:

| OI Direction | Price Direction | Interpretation | Signal |
|-------------|----------------|----------------|--------|
| OI up | Price up | LONG_BUILDUP | Bullish continuation |
| OI down | Price up | SHORT_COVERING | Bullish short-term, rally may exhaust |
| OI down | Price down | LONG_UNWINDING | Longs exiting — DANGER for long trades |
| OI up | Price down | SHORT_BUILDUP | Bearish continuation |

The `oi:{scripCode}:latest` key already contains a computed `interpretation` field with these classifications plus `interpretationConfidence` (0-1).

### 3.2 OI Monitoring Algorithm

```
Every 60 seconds for each active option position:

  1. Read oi:{optionScripCode}:latest from Redis
  2. Extract: interpretation, oiChangePercent, interpretationConfidence
  3. Append to sliding window (last 5 readings = ~5 minutes of OI history)
  4. Store window in strategy:targets:{scripCode} metadata

  5. Evaluate exit condition:

     FOR LONG TRADES:
       Danger signal = LONG_UNWINDING (price falling + OI falling)
       If 3 of last 5 readings are LONG_UNWINDING with confidence > 0.5:
         → Set oiExitFlag = true
         → When ANY target is hit → exit ALL remaining lots
         → Exit reason: "T1 all lots (LONG_UNWINDING 3/5)"

       Warning signal = SHORT_COVERING (price rising but OI falling)
       Not exit-worthy alone — shorts are covering, which is temporarily bullish.
       But if SHORT_COVERING persists (4+ of 5), rally may exhaust soon.

     FOR SHORT TRADES:
       Danger signal = SHORT_COVERING (price rising + OI falling — shorts being squeezed)
       If 3 of last 5 readings are SHORT_COVERING with confidence > 0.5:
         → Set oiExitFlag = true

  6. On target hit, check oiExitFlag:
     - If true: close ALL remaining lots at this target
     - If false: close only the pre-computed lot allocation for this target (normal behavior)
```

### 3.3 Why 60 Seconds, Not 5 Minutes

OI data in Redis updates every ~1 minute (per OI candle window). Polling every 5 minutes sees only 1 out of 5 data points — 80% data loss. 60-second polling catches every OI update.

### 3.4 Why 3 of 5, Not "Consecutive"

Markets are noisy. One neutral reading between two LONG_UNWINDING readings doesn't invalidate the pattern. Requiring 3 out of 5 (majority vote) filters noise while catching real institutional exit patterns. Pure "3 consecutive" is too strict — one blip resets the count unnecessarily.

### 3.5 OI Data Structure in Targets Metadata

```json
{
  "oiReadings": [
    {"ts": 1708412460000, "interp": "LONG_BUILDUP", "pct": 2.3, "conf": 0.7},
    {"ts": 1708412520000, "interp": "LONG_UNWINDING", "pct": -1.8, "conf": 0.6},
    {"ts": 1708412580000, "interp": "LONG_UNWINDING", "pct": -3.1, "conf": 0.8},
    {"ts": 1708412640000, "interp": "NEUTRAL", "pct": 0.1, "conf": 0.2},
    {"ts": 1708412700000, "interp": "LONG_UNWINDING", "pct": -2.5, "conf": 0.7}
  ],
  "oiExitFlag": true,
  "oiPattern": "LONG_UNWINDING 3/5",
  "oiLastChecked": 1708412700000
}
```

---

## 4. Smart Round-Figure Targets

### 4.1 Why Option-Specific Pivots Are Unreliable

Computing classical pivot points (PP = (H+L+C)/3) on option OHLCV data is statistically unreliable because:

1. **Options are derivatives** — price driven by underlying movement + IV + theta decay, not their own supply/demand
2. **Low volume options** have wide bid-ask spreads, making OHLCV noisy
3. **Theta decay** constantly erodes the "natural" level of an option throughout the day
4. **IV changes** can spike/crush option prices independent of underlying movement
5. **Short lifespan** — weekly options don't build meaningful technical levels

### 4.2 What Actually Works for Option Targets

Three independent methods, scored by confluence:

#### Method A: Delta-Adjusted Equity Pivots (Score Weight: 2)

Equity pivots are real institutional supply/demand levels. Delta-adjust them to option-equivalent levels:

```
For each equity pivot level (daily R1, R2, R3, weekly R1, monthly S1, etc.):
  optionDistance = delta * (equityPivotLevel - equityEntryPrice)
  optionPivotLevel = optionEntryPrice + optionDistance
```

Source: `pivot:mtf:{underlyingScripCode}` — contains daily, weekly, monthly + previous period pivots (~20-30 levels total).

Multi-timeframe confluence bonus: if a daily R1 and weekly S2 delta-adjust to the same option price range, that level gets +1 extra score.

#### Method B: Option Swing Levels (Score Weight: 1)

Actual price levels where option traders placed orders:

```
Read tick:{optionScripCode}:1m:history (last 30-60 candles)
Find local maxima (swing highs) where price reversed down
Find local minima (swing lows) where price reversed up
```

A swing high at 34.50 means sellers defended that level — real order flow data.

#### Method C: Round Figures (Score Weight: 1)

Options empirically stall at psychological round numbers:

```
Option price range    Round to nearest
< 50                  5    (25, 30, 35, 40, 45)
50-200                10   (50, 60, 70, 80, 100)
200+                  25   (200, 225, 250, 275)
```

### 4.3 Confluence Scoring Algorithm

```
At trade open:

1. Collect all candidate levels:
   - Delta-adjusted equity pivots (from pivot:mtf:{underlying})
   - Swing highs/lows (from tick:{option}:1m:history)
   - Round figures in the expected target range

2. For each candidate level above entry (for LONG):
   score = 0
   if within 2% of a delta-adjusted equity pivot   → score += 2
   if equity pivot is from 2+ timeframes (confluence) → score += 1
   if within 2% of a swing high/low                → score += 1
   if within 1% of a round figure                  → score += 1

3. Cluster nearby levels (within 2% of each other):
   - Merge into a single zone at the round figure or cluster center
   - Sum the scores of all merged levels

4. Sort clusters by distance from entry (nearest first for T1)
   Break ties by score (higher score = stronger level)

5. Assign:
   T1 = nearest cluster with score >= 2
   T2 = next cluster with score >= 2
   T3 = next cluster with score >= 1
   T4 = next cluster (or delta-adjusted T4 fallback)
   SL = nearest cluster BELOW entry with score >= 2
```

### 4.4 Worked Example: BDL 1300 CE

```
Option entry: 22.50
Delta: 0.35
Equity entry: 3057.60

STEP 1: Delta-Adjusted Equity Pivots
  Daily R1 = 3085 → option = 22.50 + 0.35*(3085-3057.60) = 32.09
  Daily R2 = 3110 → option = 22.50 + 0.35*(3110-3057.60) = 40.84
  Weekly R1 = 3095 → option = 22.50 + 0.35*(3095-3057.60) = 35.59
  Daily S1 = 3040 → option = 22.50 + 0.35*(3040-3057.60) = 16.34 (SL zone)

STEP 2: Option Swing Levels (from last 30 1m candles)
  Swing high at 34.50
  Swing high at 28.00

STEP 3: Round Figures
  25, 30, 35, 40, 45

STEP 4: Confluence Scoring (levels above entry)
  25  → near swing high 28 (no, >2%), round figure (+1)              = SCORE 1
  28  → near swing high 28 (+1), no pivot, no round figure           = SCORE 1
  30  → near dailyR1 32.09 (no, >2%), round figure (+1)              = SCORE 1
  32  → near dailyR1 32.09 (+2), no swing, no round                  = SCORE 2
  35  → near weeklyR1 35.59 (+2), near swing 34.50 (+1), round (+1)  = SCORE 4 ***
  40  → near dailyR2 40.84 (+2), round figure (+1)                   = SCORE 3

STEP 5: Assign Targets
  T1 = 30  (nearest with score >= 1, closest to entry)
  T2 = 35  (strongest confluence, SCORE 4)
  T3 = 40  (score 3)
  T4 = 45  (round figure fallback)
  SL = 16  (near daily S1 delta-adjusted, rounded down)
```

### 4.5 Comparison: Current vs Smart Targets

| | Current (Delta-Adjusted Only) | Smart (Confluence) |
|--|-------------------------------|-------------------|
| T1 | 34.24 (arbitrary decimal) | 30 (round, near swing) |
| T2 | 42.10 (arbitrary) | 35 (confluence of 4 sources) |
| T3 | 50.00 (coincidentally round) | 40 (pivot + round) |
| Hit probability | Lower — levels mean nothing to option traders | Higher — round figures + pivot confluence attract orders |
| Partial fills | Common — price grazes target then reverses | More likely clean fills at strong levels |

---

## 5. Architecture Impact

### 5.1 What Changes and Where

| Module | Change | Impact |
|--------|--------|--------|
| StrategyTradeExecutor (trading-dashboard) | Add OI monitoring every 60s | 1-5 Redis GETs per minute |
| StrategyTradeExecutor (trading-dashboard) | Smart targets in openTrade() | 2 Redis reads at trade entry only |
| Kafka consumers | None | Zero lag impact |
| Streamingcandle | None | No changes needed |
| TradeExecutionModule | None | No changes needed |
| Redis | ~200 bytes extra per position (OI window) | Negligible |

### 5.2 Performance

| Operation | Frequency | Latency | Notes |
|-----------|-----------|---------|-------|
| OI Redis GET | Every 60s per position | < 1ms | Same local Redis |
| Pivot Redis GET | Once per trade open | < 1ms | Already cached |
| Candle history LRANGE | Once per trade open | ~2-5ms | 30-60 items from list |
| Confluence computation | Once per trade open | < 1ms | In-memory math |
| OI pattern evaluation | Every 60s per position | < 0.1ms | 5-element array check |

### 5.3 What Is NOT Affected

- Kafka consumer throughput: zero changes to consumers
- TickAggregator: no modifications
- Signal generation (FUDKII/FUKAA): unchanged
- Frontend/WebSocket: unchanged
- MongoDB writes: unchanged
- Other Redis keys: untouched

---

## 6. Edge Cases

| Scenario | Handling |
|----------|----------|
| No OI data for option (illiquid) | Skip OI check, use normal exit logic |
| No pivot data for underlying | Fall back to delta-adjusted signal targets (current behavior) |
| < 30 candles in option history | Skip swing level detection, use pivots + round figures only |
| Delta not provided in trade request | Use delta=0.5 as conservative default |
| OI interpretation confidence < 0.3 | Ignore that reading (too weak to act on) |
| Multiple timeframe pivots at same level | Extra confluence score (+1 per additional timeframe) |
| Trade opens during low OI activity | First 5 OI readings may be sparse — don't flag until window full |
| Option price > 200 (deep ITM) | Round figures at 25 intervals, swing levels more reliable than pivots |

---

## 7. OI Exit Decision Matrix

For LONG option trades:

| OI Pattern (3/5 readings) | Price Trend | Action |
|---------------------------|-------------|--------|
| LONG_BUILDUP | Rising | Hold — healthy trend |
| SHORT_COVERING | Rising | Monitor — rally may exhaust |
| LONG_UNWINDING | Falling | EXIT ALL at next target |
| SHORT_BUILDUP | Falling | EXIT ALL immediately (SL likely) |
| NEUTRAL | Any | Normal target-based exits |

For SHORT option trades (if implemented):

| OI Pattern (3/5 readings) | Price Trend | Action |
|---------------------------|-------------|--------|
| SHORT_BUILDUP | Falling | Hold — healthy trend |
| LONG_UNWINDING | Falling | Monitor — drop may exhaust |
| SHORT_COVERING | Rising | EXIT ALL at next target |
| LONG_BUILDUP | Rising | EXIT ALL immediately (SL likely) |

---

## 8. Implementation Order

1. **OI Monitoring** — affects active trades (higher priority)
   - Add `@Scheduled(fixedRate = 60000)` method for OI tracking
   - Store OI window in targets metadata
   - Modify target hit logic to check `oiExitFlag`

2. **Smart Targets** — affects new trades only
   - Add confluence scoring logic
   - Query Redis for pivots + candle history at trade open
   - Replace static delta-adjusted targets with confluence-scored targets

3. **Testing**
   - Verify OI reads don't affect monitoring loop timing
   - Verify smart targets produce sensible levels for various option prices
   - Verify fallback behavior when data is missing

---

## 9. Files to Modify

| File | Changes |
|------|---------|
| `StrategyTradeExecutor.java` | OI monitoring scheduler, OI exit flag check in target hit logic |
| `StrategyTradeExecutor.java` | Smart target computation in `openTrade()` |
| `OptionTickPriceService.java` | Add `readOiMetrics()` and `readPivotState()` Redis helpers |
| `StrategyTradeRequest.java` | Ensure delta field is passed through |
| `application.properties` | OI monitoring interval config (optional) |
