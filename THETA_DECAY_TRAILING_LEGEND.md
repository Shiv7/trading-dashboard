# Theta Decay-Aware Post-T2 Trailing Stop — Master Legend

## What Is This?

A smart trailing stop-loss system for **OPTION trades only** that activates **after T2 is hit**.
Instead of trailing the SL back to T1 (giving back most of the T1→T2 gain while theta eats your
premium), it protects a calculated percentage of the T1→T2 distance based on how urgently theta
decay threatens the position.

## When Does It Activate?

```
Trade opens → T1 hit (40% lots exit) → T2 hit (30% lots exit) → THETA TRAILING ACTIVATES
                                                                  (for remaining 30% lots: T3+T4)
```

- **Only OPTION trades** — futures and equity use standard 1% confirmation trailing
- **Only after T2 hit** — before T2, standard trailing (SL → T1 with 1% confirmation)
- **Continuously re-evaluated** every 2 seconds on each monitoring tick

## The Formula

```
Trail SL = T1 + (T2 - T1) × protection%
```

**protection% = LAYER 1 + LAYER 2 + LAYER 3 + LAYER 4** (capped at 95%)

---

## LAYER 1 — Base Protection by Days to Expiry (DTE)

| DTE | Protection | Logic |
|-----|-----------|-------|
| **0** (expiry day) | **90%** | Theta is catastrophic — every minute counts. Lock in almost everything. |
| **1–2** | **75%** | Gamma week. Theta accelerates sharply. Premium can halve in hours. |
| **3–5** | **60%** | Moderate decay. Protect the majority, but give some room for T3. |
| **6–10** | **50%** | Balanced. Theta exists but isn't urgent. 50/50 between protection and room. |
| **>10** | **25%** | Theta is negligible at this DTE. Give the trade maximum room to run to T3/T4. |
| **No expiry data** | **50%** | Safe fallback if optionExpiry wasn't in the signal pipeline. |

### Why DTE matters:
Theta decay follows a √(DTE) curve — it's not linear. An option with 1 DTE loses ~3x more
theta per hour than one with 10 DTE. On expiry day, OTM options can lose 50-80% of remaining
value in the last 2 hours alone.

---

## LAYER 2 — Time-of-Day Adjustment (5-Tier IST Schedule)

| Time Window (IST) | Adjustment | What's Happening |
|-------------------|-----------|------------------|
| **09:15–11:00** | **+0%** | Opening volatility. IV is elevated, gamma dominates theta. Price swings support holding — premium is actually *inflated* vs fair value. No reason to tighten. |
| **11:00–13:00** | **+5%** | **Midday lull.** Volume drops, stocks range-bound. This is the silent killer — theta erodes 0.5–1.5% of premium per hour on near-expiry options, but price doesn't move so traders don't notice. By the time they look, the T1→T2 gain has evaporated. |
| **13:00–14:00** | **+10%** | Institutional positioning begins. MMs start adjusting gamma books. Premium starts visibly fading even if underlying holds. Bid-ask spreads begin widening. |
| **14:00–15:00** | **+15%** | Accelerated decay. MMs actively reduce gamma exposure, widen spreads. On weekly expiry days (Thursday), OTM options can collapse 30-50% in this single hour. |
| **15:00–15:25** | **+20%** | **Extreme decay zone.** Liquidity thins dramatically. Spreads blow out. On expiry day, OTM options can go from ₹15 to ₹2 in this window. Even ITM options lose extrinsic rapidly. EOD exit at 15:25 is looming — no point giving room the trade can't use. |

### The midday lull is the most important addition:
The 11:00–13:00 window is where traders *feel* like the trade is fine because price isn't
moving against them — but theta is silently eating premium. A post-T2 consolidation during
this window is the #1 scenario where traders give back their gains.

---

## LAYER 3 — Premium Fragility

| Condition | Adjustment | Logic |
|-----------|-----------|-------|
| Current premium **< ₹20** | **+15%** | Low-premium options are extremely fragile. A ₹2 move on a ₹15 option = 13% loss. The same ₹2 on a ₹150 option = 1.3%. Theta has outsized impact on cheap premiums because a fixed time-value decay represents a larger % of total value. |

---

## LAYER 4 — Moneyness (OTM vs ITM)

| Condition | Adjustment | Logic |
|-----------|-----------|-------|
| **OTM** option (CE: strike > spot, PE: strike < spot) | **+10%** | OTM options are 100% extrinsic value — every rupee of premium is pure time value that decays. ITM options have intrinsic value that doesn't decay. Same theta has proportionally larger impact on OTM. |

---

## Worked Examples

### Example 1: Near-expiry, midday lull
```
T1 = ₹80, T2 = ₹90 → distance = ₹10
DTE = 1 → base 75%
Time: 12:30 IST → +5%
Premium: ₹85 → no fragility adj
ATM option → no OTM adj
────────────────────────────
Total: 80% → Trail SL = ₹80 + ₹10 × 0.80 = ₹88.00
(Protects ₹8 of the ₹10 gain instead of falling back to ₹80)
```

### Example 2: Same trade, but late session
```
T1 = ₹80, T2 = ₹90 → distance = ₹10
DTE = 1 → base 75%
Time: 14:30 IST → +15%
Premium: ₹85 → no fragility adj
ATM option → no OTM adj
────────────────────────────
Total: 90% → Trail SL = ₹80 + ₹10 × 0.90 = ₹89.00
```

### Example 3: Expiry day, final stretch, cheap OTM
```
T1 = ₹12, T2 = ₹18 → distance = ₹6
DTE = 0 → base 90%
Time: 15:10 IST → +20%
Premium: ₹16 (< ₹20) → +15%
OTM → +10%
────────────────────────────
Raw total: 135% → CAPPED at 95%
Trail SL = ₹12 + ₹6 × 0.95 = ₹17.70
(Essentially locks in the gain — only ₹0.30 room to breathe)
```

### Example 4: Far-dated option, morning session
```
T1 = ₹200, T2 = ₹260 → distance = ₹60
DTE = 15 → base 25%
Time: 10:30 IST → +0%
Premium: ₹240 → no fragility adj
ITM option → no OTM adj
────────────────────────────
Total: 25% → Trail SL = ₹200 + ₹60 × 0.25 = ₹215.00
(Gives the trade plenty of room — theta is minimal at 15 DTE)
```

### Example 5: Weekly expiry Thursday, institutional positioning hour
```
T1 = ₹45, T2 = ₹60 → distance = ₹15
DTE = 0 → base 90%
Time: 13:30 IST → +10%
Premium: ₹55 → no fragility adj
OTM → +10%
────────────────────────────
Raw total: 110% → CAPPED at 95%
Trail SL = ₹45 + ₹15 × 0.95 = ₹59.25
```

---

## How It Evolves Through the Day (Same Trade)

A trade opened at 9:30 AM with T1=₹80, T2=₹90, DTE=3, ATM option:

| Time | Base (DTE=3) | Time Adj | Total | Trail SL | Notes |
|------|-------------|---------|-------|----------|-------|
| 09:30 | 60% | +0% | 60% | ₹86.00 | T2 just hit. Room to breathe. |
| 11:15 | 60% | +5% | 65% | ₹86.50 | Midday lull begins. Tighten slightly. |
| 12:45 | 60% | +5% | 65% | ₹86.50 | Still in lull. |
| 13:15 | 60% | +10% | 70% | ₹87.00 | Institutions positioning. Tighten. |
| 14:30 | 60% | +15% | 75% | ₹87.50 | Decay accelerating. Protect more. |
| 15:10 | 60% | +20% | 80% | ₹88.00 | Final stretch. Lock in. |

**Key insight**: The SL ratchets UP through the day, never down. At 9:30 you protect ₹6 of the
₹10 gain. By 15:10 you protect ₹8. Theta doesn't sleep, and neither does this trailing stop.

---

## What It Doesn't Touch

| Scenario | Behavior |
|----------|----------|
| T2 not yet hit | Standard 1% confirmation trailing (SL → T1 when price > T1×1.01) |
| Futures / Equity trades | Standard 1% confirmation trailing (no theta concept) |
| T3 hit | Standard trailing continues (SL → T3 with 1% confirmation) |
| T4 hit | Standard trailing continues (SL → T4 with 1% confirmation) |
| Before T1 hit | Original SL from signal (no trailing yet) |

---

## Technical Implementation

### Files Modified
1. **StrategyTradeRequest.java** — Added `optionExpiry` field
2. **StrategyTradeExecutor.java** — Added `computeDecayAwareTrailingSl()`, modified `updateTrailingSl()`
3. **SignalBufferService.java** (Trade Execution Module) — Added `optionExpiry` to HTTP request body

### Data Flow
```
Kafka Signal → Consumer extracts optionExpiry → StrategySignal model
  → SignalBufferService.routeToOptionTrade() → HTTP POST body includes optionExpiry
  → Dashboard StrategyTradeRequest.optionExpiry → StrategyTradeExecutor.openTrade()
  → Redis targets map: strategy:targets:{scripCode} includes optionExpiry + strike
  → monitorSinglePosition() every 2s → updateTrailingSl() → computeDecayAwareTrailingSl()
```

### Log Signature
```
[STRATEGY-TRADE] THETA_DECAY SL: DTE=3 base=60% timeAdj=+10% premium=85.50 otm=false → protection=70% trailSl=87.00 (T1=80.00 T2=90.00 dist=10.00)
```

### Redis Position Fields
- `trailingType: "THETA_DECAY"` (vs "TARGET_TRAIL" for standard)
- `trailingStop: <computed SL value>`
- `sl: <same as trailingStop>`

---

## Design Philosophy

> **"Theta doesn't consolidate — it only accelerates."**

The standard trailing approach (trail SL to last hit target) works well for equity and futures
where price consolidation is neutral. But for options, consolidation = loss. Every second the
price sits flat, theta eats your premium. This system quantifies that erosion risk across four
dimensions and protects accordingly.

The 95% cap ensures we never completely lock out the possibility of the trade running further,
even in the worst-case scenario. The 2-second re-evaluation ensures the protection adapts as
conditions change throughout the session.
