# Patterns Page — User Guide

## Overview

The Patterns page displays real-time candlestick pattern signals detected across **7 timeframes** (5m, 15m, 30m, 1h, 2h, 4h, 1d) for all instruments (NSE + MCX). Each pattern card shows trigger price, stop loss, up to 4 pivot-based targets, and risk:reward ratio.

---

## Filter Bar

All filters work independently and combine with AND logic between them.

### Search

- Type to filter instantly by stock name, scripCode, or pattern name
- Click the **X** to clear
- No need to press Enter — results update as you type

### Patterns Dropdown (Multi-Select)

- Click **Patterns** to open the dropdown
- Check/uncheck individual patterns (e.g., THREE BLACK CROWS, MARUBOZU, HAMMER)
- **Select All** / **Clear All** at the top for quick bulk selection
- Click **Apply** to filter, **Reset** to clear the selection
- Badge shows count of selected patterns

### Timeframes Dropdown (Multi-Select)

- Click **Timeframes** to open
- Available: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1D
- Same Apply/Reset behavior as Patterns dropdown

### Confidence Dropdown (Multi-Select)

- **High (70%+)** — strong pattern recognition confidence
- **Medium (40-70%)** — moderate confidence
- **Low (<40%)** — weak patterns
- Multiple can be selected (e.g., High + Medium)

### Direction Toggle

- **All** / **Bull** / **Bear** / **Ntrl** — click to toggle
- Immediately filters (no Apply needed)

### Time Sort

- Click the **Time** button to toggle between newest-first and oldest-first
- Icon changes to indicate current sort direction

### Reset All

- Appears when any filter is active
- Clears all filters, search, and sort back to defaults

---

## Multi-TF Confluence Search

The key feature for finding stocks with aligned patterns across multiple timeframes.

### How to Use

1. Click **Multi-TF Search** button (below the filter bar)
2. Two empty rule rows appear by default
3. For each row, select a **Pattern** and a **Timeframe**
4. Results appear instantly once 2+ complete rules are defined
5. Click **+ Add another pattern** to add more rules (no limit)
6. Click **X** on any rule to remove it
7. Click **Clear** to close and reset all rules

### Example: Find bearish confluence

```
Rule 1:  THREE BLACK CROWS  on  2h
Rule 2:  MARUBOZU           on  5m
Rule 3:  BEARISH ENGULFING  on  30m
```

Results show only stocks that have **ALL three patterns** active right now.

### How Results Display

Each matching stock shows:
- **Stock name** (clickable — links to stock analysis page)
- **ScripCode** for reference
- **Matched pattern tags** — each rule displayed as a colored chip:
  - Green border/text = BULLISH direction
  - Red border/text = BEARISH direction
  - Shows: pattern icon, pattern name, timeframe, direction arrow, confidence %

### Logic

- **AND** across all rules — a stock must match every rule to appear
- Each rule matches if the stock has an active pattern of that exact type on that exact timeframe
- Results are sorted by number of matches (highest first)
- The main pattern card list below continues to work independently

---

## Pattern Cards

Each card displays:

### Row 1 — Identity
- Pattern icon + Stock name (clickable link to stock page)
- ScripCode, Timeframe badge, Pattern type badge
- Direction (BULLISH/BEARISH/NEUTRAL) with color coding
- Confidence percentage

### Row 2 — Price Levels
| Field | Description |
|-------|-------------|
| **Triggered** | Timestamp when the pattern was detected (IST) |
| **Trigger Price** | Entry price (candle close at detection) |
| **SL** | Stop loss from pivot levels. For BULLISH: below entry. For BEARISH: above entry |
| **R:R** | Risk:Reward ratio. Green if >= 1.5, amber if >= 1, red if < 1 |

### Row 3 — Targets
| Field | Description |
|-------|-------------|
| **T1** | First pivot target (nearest) |
| **T2** | Second pivot target |
| **T3** | Third pivot target (faded) |
| **T4** | Fourth pivot target (most faded) |

### Data Status Indicators
- **Numeric value** — real pivot-based data
- **DM** (Data Missing) — no pivot data available for this instrument (common for MCX mini contracts)
- **ERR** — should not appear; indicates a data pipeline issue

### SL/Target Direction Rules
- **BULLISH patterns**: SL is below trigger price, targets are above
- **BEARISH patterns**: SL is above trigger price, targets are below
- Each pattern's SL/targets are computed using its own direction, not the candle's overall bias

---

## Detail Panel

Click any pattern card to open the detail panel on the right:

- **Header**: Stock name, scripCode, status badge, pattern type, direction, timeframe
- **Confidence & Quality**: Confidence % with progress bar, Quality Score (0-100)
- **Price Levels**: Entry, SL, T1-T4, R:R, Invalidation price (full list)
- **Description**: Pattern explanation
- **Context**: GEX Regime, Session, Days to Expiry, Timeframe
- **Timeline**: Triggered, Expires, Completed timestamps
- **Outcome**: P&L and R-Multiple (for completed patterns)
- **View Stock Analysis** button links to the full stock page

---

## Views

Toggle between three views using the buttons in the header:

### Active (default)
All currently active pattern signals with filters and cards.

### History
Completed patterns (wins, losses, expired). Same card layout with P&L shown.

### Stats
Per-pattern-type statistics grid showing:
- Total occurrences, Win rate, Wins, Losses, Total P&L

---

## Data Pipeline

```
1m ticks → CandleService aggregates to 5m/15m/30m/1h/2h/4h/1d
         → PatternAnalyzer detects candlestick patterns per timeframe
         → PatternSignalProducer enriches with pivot-based SL/targets (per-direction)
         → Kafka topic: pattern-signals
         → Dashboard PatternSignalConsumer stores in memory
         → REST API: /api/patterns + WebSocket: /topic/patterns
         → Frontend: polling every 30s + real-time WebSocket updates
```

### Pivot Target Computation
SL and targets use the same algorithm as FUDKII/FUKAA strategies:
1. ATR from ATRService (30m timeframe, fallback: 1% of entry)
2. Pivot levels from PivotLevelService (multi-timeframe: daily, weekly, monthly)
3. All pivot levels collected, deduped within 0.5 x ATR
4. Zones sorted relative to entry price
5. For BULLISH: SL = nearest zone below, T1-T4 = zones above
6. For BEARISH: SL = nearest zone above, T1-T4 = zones below
7. R:R = distance to T1 / distance to SL

---

## Supported Pattern Types

### Bullish Candlestick
| Pattern | Icon | Description |
|---------|------|-------------|
| HAMMER | 🔨 | Bullish reversal, long lower shadow |
| INVERTED_HAMMER | 🔧 | Bullish reversal after downtrend |
| BULLISH_ENGULFING | 🟢 | Bullish reversal, engulfs prior candle |
| BULLISH_HARAMI | 🤰 | Bullish reversal, inside bar |
| PIERCING_LINE | ⬆️ | Bullish reversal, pierces midpoint |
| MORNING_STAR | 🌅 | Strong bullish reversal, 3 candles |
| THREE_WHITE_SOLDIERS | 🎖️ | Strong bullish continuation |
| TWEEZER_BOTTOM | 🔻 | Double bottom reversal |

### Bearish Candlestick
| Pattern | Icon | Description |
|---------|------|-------------|
| SHOOTING_STAR | 💫 | Bearish reversal, long upper shadow |
| HANGING_MAN | 🎭 | Bearish reversal after uptrend |
| BEARISH_ENGULFING | 🔴 | Bearish reversal, engulfs prior candle |
| BEARISH_HARAMI | 🎎 | Bearish reversal, inside bar |
| DARK_CLOUD_COVER | ☁️ | Bearish reversal, covers prior gain |
| EVENING_STAR | 🌆 | Strong bearish reversal, 3 candles |
| THREE_BLACK_CROWS | 🐦‍⬛ | Strong bearish continuation |
| TWEEZER_TOP | 🔺 | Double top reversal |

### Neutral / Indecision
| Pattern | Icon | Description |
|---------|------|-------------|
| DOJI | ➕ | Indecision, small body |
| SPINNING_TOP | 🎡 | Indecision, small body with shadows |
| MARUBOZU | 📊 | Strong momentum, no shadows |

### Structural
| Pattern | Icon | Description |
|---------|------|-------------|
| BREAKOUT | 🚀 | Price breaking resistance |
| BREAKDOWN | 📉 | Price breaking support |
| REVERSAL | 🔄 | Trend direction change |
| DOUBLE_BOTTOM | 〰️ | W pattern reversal |
| DOUBLE_TOP | 🏔️ | M pattern reversal |
