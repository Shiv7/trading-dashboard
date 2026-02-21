/**
 * Shared trading utility functions — extracted from FukaaTabContent/PivotTabContent/FudkiiTabContent.
 *
 * Functions:
 * - getStrikeInterval(): option strike spacing by price level
 * - getOTMStrike(): 1-step OTM strike from ATM
 * - approximateDelta(): logistic delta approximation from moneyness
 * - mapToOptionLevels(): equity SL/targets → option premium levels via delta
 * - computeLotSizing(): confidence-based lot sizing with capital allocation
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

/** Compute lot sizing based on confidence and wallet capital */
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
