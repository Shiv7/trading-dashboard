/**
 * Shared trading utility functions — extracted from FukaaTabContent/PivotTabContent/FudkiiTabContent.
 *
 * Functions:
 * - getStrikeInterval(): option strike spacing by price level
 * - getOTMStrike(): 1-step OTM strike from ATM
 * - approximateDelta(): logistic delta approximation from moneyness
 * - mapToOptionLevels(): equity SL/targets → option premium levels via delta
 * - computeLotSizing(): confidence-based lot sizing with capital allocation
 * - MCX_MULTIPLIER_MAP: MCX futures contract multipliers (PNL per ₹1 move) as fallback
 * - getExpiryMonth(): extract month abbreviation from ISO expiry date
 */

/** Derive option strike interval from underlying price */
export function getStrikeInterval(price: number): number {
  if (price > 40000) return 500;
  if (price > 20000) return 200;
  if (price > 10000) return 100;
  if (price > 5000) return 50;
  if (price > 2000) return 20;
  if (price > 1000) return 10;
  if (price > 500) return 5;
  if (price > 100) return 2.5;
  return 1;
}

/** Get OTM strike 1 step away from ATM */
export function getOTMStrike(price: number, direction: string): { strike: number; interval: number } {
  const interval = getStrikeInterval(price);
  const atm = Math.round(price / interval) * interval;
  const strike = direction === 'BULLISH'
    ? atm + interval
    : atm - interval;
  return { strike, interval };
}

/** Approximate option delta from moneyness using logistic function */
export function approximateDelta(spot: number, strike: number, optionType: 'CE' | 'PE'): number {
  const moneyness = (spot - strike) / strike;
  const ceDelta = 1 / (1 + Math.exp(-10 * moneyness));
  return optionType === 'CE' ? ceDelta : 1 - ceDelta;
}

/** Map equity-level SL/targets to option premium levels using delta */
export function mapToOptionLevels(
  optionEntry: number,
  equitySpot: number,
  equitySl: number,
  equityTargets: (number | null)[],
  strike: number,
  optionType: 'CE' | 'PE'
): { sl: number; targets: number[]; delta: number } {
  const delta = approximateDelta(equitySpot, strike, optionType);
  const slMove = Math.abs(equitySpot - equitySl);
  const optionSl = Math.max(0.5, optionEntry - delta * slMove);
  const targets = equityTargets.map(t => {
    if (t == null) return 0;
    const targetMove = Math.abs(t - equitySpot);
    return Math.round((optionEntry + delta * targetMove) * 100) / 100;
  });
  return { sl: Math.round(optionSl * 100) / 100, targets, delta: Math.round(delta * 100) / 100 };
}

// ─────────────────────────────────────────────
//  Slot-Based Capital Budgeting
// ─────────────────────────────────────────────

/**
 * Time-phased exchange budget allocation:
 *   Phase 1 (9:00–15:25):  NSE 60%, MCX 30%, CDS 10%  (all markets)
 *   Phase 2 (15:25–17:00): MCX 75%, CDS 25%           (NSE closed)
 *   Phase 3 (17:00–MCX close): MCX 100%               (MCX only)
 */
const PHASE1_BUDGETS: Record<string, { allocPct: number; maxPositions: number }> = {
  N: { allocPct: 0.60, maxPositions: 5 },
  M: { allocPct: 0.30, maxPositions: 3 },
  C: { allocPct: 0.10, maxPositions: 2 },
};
const PHASE2_BUDGETS: Record<string, { allocPct: number; maxPositions: number }> = {
  N: { allocPct: 0.00, maxPositions: 0 },
  M: { allocPct: 0.75, maxPositions: 5 },
  C: { allocPct: 0.25, maxPositions: 3 },
};
const PHASE3_BUDGETS: Record<string, { allocPct: number; maxPositions: number }> = {
  N: { allocPct: 0.00, maxPositions: 0 },
  M: { allocPct: 1.00, maxPositions: 7 },
  C: { allocPct: 0.00, maxPositions: 0 },
};

function getAllocationPhase(): number {
  const now = new Date();
  const istH = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
  const istM = (now.getUTCMinutes() + 30) % 60;
  const istMinutes = istH * 60 + istM;
  if (istMinutes >= 17 * 60) return 3;
  if (istMinutes >= 15 * 60 + 25) return 2;
  return 1;
}

export function getExchangeBudgets(): Record<string, { allocPct: number; maxPositions: number }> {
  const phase = getAllocationPhase();
  if (phase === 3) return PHASE3_BUDGETS;
  if (phase === 2) return PHASE2_BUDGETS;
  return PHASE1_BUDGETS;
}

export const EXCHANGE_BUDGETS = PHASE1_BUDGETS;

/** Wallet state from enriched getCapital endpoint */
export interface SlotWalletState {
  availableMargin: number;
  usedMargin: number;
  currentBalance: number;
  openPositionCount: number;
  positionsByExchange: Record<string, number>;
}

/** Slot-based lot sizing: exchange-partitioned, position-aware, conviction-scaled */
export function computeSlotSizing(
  confidence: number,
  wallet: SlotWalletState,
  optionLtp: number,
  lotSize: number,
  multiplier: number = 1,
  exchangeCode: string = 'N',
  rrRatio: number = 2.0,
  confidenceThreshold: number = 0  // Confidence gating handled by backend FundAllocationService — frontend is display-only
): { lots: number; quantity: number; disabled: boolean; insufficientFunds: boolean; creditAmount: number; allocPct: number; slotsUsed: number; maxSlots: number; exchangeFull: boolean } {
  const empty = { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0, slotsUsed: 0, maxSlots: 0, exchangeFull: false };

  if (confidence < confidenceThreshold) return empty;

  const budgets = getExchangeBudgets();
  const budget = budgets[exchangeCode] || budgets['N'];
  const exchangeBudget = wallet.availableMargin * budget.allocPct;
  const openInExchange = wallet.positionsByExchange[exchangeCode] || 0;
  const availableSlots = budget.maxPositions - openInExchange;

  if (availableSlots <= 0) {
    // Slots full or exchange closed — still compute sizing for manual CTA override
    const safeMaxPos = budget.maxPositions > 0 ? budget.maxPositions : 5;
    const safeBudget = exchangeBudget > 0 ? exchangeBudget : wallet.availableMargin * 0.20;
    const slotCap = safeBudget / safeMaxPos;
    const costPerLot = optionLtp * lotSize * multiplier;
    const manualLots = costPerLot > 0 ? Math.floor(slotCap / costPerLot) : 0;
    const manualQty = manualLots * lotSize;
    return { lots: Math.max(manualLots, 1), quantity: Math.max(manualQty, lotSize), disabled: false,
      insufficientFunds: false, creditAmount: slotCap, allocPct: budget.allocPct || 0.20,
      slotsUsed: 0, maxSlots: safeMaxPos, exchangeFull: true };
  }

  // High-conviction + high R:R → double slot
  let slotsToUse = 1;
  if (confidence > 80 && rrRatio >= 3.0 && availableSlots >= 2) {
    slotsToUse = 2;
  }

  const capitalPerSlot = exchangeBudget / budget.maxPositions;
  const allocatedCapital = capitalPerSlot * slotsToUse;
  const effectiveMultiplier = (multiplier && multiplier > 1) ? multiplier : lotSize;
  const costPerLot = optionLtp * effectiveMultiplier;

  if (costPerLot <= 0) {
    return { lots: 1, quantity: lotSize, disabled: false, insufficientFunds: false, creditAmount: 0,
      allocPct: allocatedCapital / (wallet.availableMargin || 1), slotsUsed: slotsToUse, maxSlots: budget.maxPositions, exchangeFull: false };
  }

  let lots = Math.floor(allocatedCapital / costPerLot);
  let insufficientFunds = false;
  let creditAmount = 0;
  if (lots < 1) {
    lots = 1;
    insufficientFunds = true;
    creditAmount = Math.round((costPerLot - allocatedCapital) * 100) / 100;
  }

  const allocPct = wallet.availableMargin > 0 ? allocatedCapital / wallet.availableMargin : 0;
  return { lots, quantity: lots * lotSize, disabled: false, insufficientFunds, creditAmount,
    allocPct, slotsUsed: slotsToUse, maxSlots: budget.maxPositions, exchangeFull: false };
}

/** @deprecated Use computeSlotSizing instead — backend sizing now handled by FundAllocationService (slot-based) */
export function computeLotSizing(
  confidence: number,
  walletCapital: number,
  optionLtp: number,
  lotSize: number,
  multiplier: number = 1
): { lots: number; quantity: number; disabled: boolean; insufficientFunds: boolean; creditAmount: number; allocPct: number } {
  if (confidence < 60) {
    return { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0 };
  }
  const allocPct = confidence > 75 ? 0.75 : 0.50;
  const allocatedCapital = walletCapital * allocPct;
  const effectiveMultiplier = (multiplier && multiplier > 1) ? multiplier : lotSize;
  const costPerLot = optionLtp * effectiveMultiplier;
  if (costPerLot <= 0) {
    return { lots: 1, quantity: lotSize, disabled: false, insufficientFunds: false, creditAmount: 0, allocPct };
  }
  let lots = Math.floor(allocatedCapital / costPerLot);
  let insufficientFunds = false;
  let creditAmount = 0;
  if (lots < 1) {
    lots = 1;
    insufficientFunds = true;
    creditAmount = Math.round((costPerLot - walletCapital) * 100) / 100;
  }
  return { lots, quantity: lots * lotSize, disabled: false, insufficientFunds, creditAmount, allocPct };
}

/**
 * MCX futures contract multipliers — PNL per ₹1 price move.
 * Used as fallback when enrichment data (futuresMultiplier) is missing.
 * For futures: lotSize = 1 (1 contract), multiplier determines contract value.
 */
export const MCX_MULTIPLIER_MAP: Record<string, number> = {
  GOLD: 1, GOLDM: 10, GOLDGUINEA: 8, GOLDPETAL: 1, GOLDTEN: 10,
  SILVER: 30, SILVERM: 5, SILVERMIC: 1,
  CRUDEOIL: 100, CRUDEOILM: 10, NATURALGAS: 1250, NATGASMINI: 250,
  COPPER: 2500, ZINC: 5000, ZINCMINI: 1000,
  LEAD: 5000, LEADMINI: 1000, NICKEL: 250, NICKELMINI: 100,
  ALUMINIUM: 5000, ALUMINI: 1000, MENTHAOIL: 360, COTTON: 10,
};

/** Extract month abbreviation (e.g., "MAR") from ISO date string (e.g., "2026-03-27") */
export function getExpiryMonth(expiryStr?: string): string {
  if (!expiryStr) return '';
  const parts = expiryStr.split('-');
  if (parts.length < 2) return '';
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return months[parseInt(parts[1], 10) - 1] ?? '';
}

/**
 * Returns true if the signal falls in the NSE no-trade window (3:15–3:25 PM IST).
 * NSE positions close at 15:25 — block new entries 10 min before.
 * Checks BOTH the signal's own timestamp AND current time — if either is in the window, returns true.
 * Only applies to NSE exchange ("N" or unset/empty).
 */
export function isNseNoTradeWindow(exchange?: string, signalTimestamp?: number | string): boolean {
  // Only applies to NSE (exchange "N" or unset/empty)
  if (exchange && exchange !== 'N' && exchange !== 'NSE') return false;

  const inWindow = (date: Date): boolean => {
    const istH = (date.getUTCHours() + 5 + Math.floor((date.getUTCMinutes() + 30) / 60)) % 24;
    const istM = (date.getUTCMinutes() + 30) % 60;
    const istMinutes = istH * 60 + istM;
    return istMinutes >= 915 && istMinutes <= 925; // 3:15 PM – 3:25 PM
  };

  // Check signal timestamp
  if (signalTimestamp) {
    const sigDate = typeof signalTimestamp === 'number'
      ? new Date(signalTimestamp)
      : new Date(signalTimestamp);
    if (!isNaN(sigDate.getTime()) && inWindow(sigDate)) return true;
  }

  // Also check current time (live window)
  return inWindow(new Date());
}

// ─────────────────────────────────────────────
//  Stale Price Adjustment
// ─────────────────────────────────────────────

/**
 * Check current LTP against trade plan and compute adjusted levels if needed.
 * Returns null if no adjustment needed (LTP is between SL and T1).
 */
export interface StalePriceResult {
  type: 'below-sl' | 'targets-shifted';
  currentLtp: number;
  adjustedSl: number;
  adjustedT1: number | null;
  adjustedT2: number | null;
  adjustedT3: number | null;
  adjustedT4: number | null;
  levelsShifted: number;
}

export function checkStalePriceAdjustment(
  currentLtp: number,
  sl: number,
  t1: number | null,
  t2: number | null,
  t3: number | null,
  t4: number | null
): StalePriceResult | null {
  // If LTP < SL -> warning
  if (currentLtp < sl) {
    return {
      type: 'below-sl',
      currentLtp,
      adjustedSl: sl,
      adjustedT1: t1,
      adjustedT2: t2,
      adjustedT3: t3,
      adjustedT4: t4,
      levelsShifted: 0,
    };
  }

  // Build ordered levels array
  const levels = [t1, t2, t3, t4];

  // Count how many targets LTP has crossed
  let crossed = 0;
  for (const level of levels) {
    if (level != null && currentLtp > level) {
      crossed++;
    } else {
      break; // Stop at first non-crossed target
    }
  }

  if (crossed === 0) return null; // Normal case: SL < LTP < T1

  // Shift targets up by `crossed` levels
  // Original: SL, T1, T2, T3, T4
  // All levels in order:
  const allLevels = [sl, t1, t2, t3, t4];
  // After shifting by `crossed`: new SL = allLevels[crossed], new T1 = allLevels[crossed+1], etc.
  const newSl = allLevels[crossed] ?? allLevels[crossed - 1] ?? sl;
  const newT1 = (crossed + 1 < allLevels.length) ? allLevels[crossed + 1] : null;
  const newT2 = (crossed + 2 < allLevels.length) ? allLevels[crossed + 2] : null;
  const newT3 = (crossed + 3 < allLevels.length) ? allLevels[crossed + 3] : null;
  const newT4 = (crossed + 4 < allLevels.length) ? allLevels[crossed + 4] : null;

  return {
    type: 'targets-shifted',
    currentLtp,
    adjustedSl: newSl!,
    adjustedT1: newT1 ?? null,
    adjustedT2: newT2 ?? null,
    adjustedT3: newT3 ?? null,
    adjustedT4: newT4 ?? null,
    levelsShifted: crossed,
  };
}
