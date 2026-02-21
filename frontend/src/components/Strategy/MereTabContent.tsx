import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, AlertTriangle, Loader2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchJson, strategyTradesApi, strategyWalletsApi } from '../../services/api';
import type { StrategyTradeRequest } from '../../types/orders';

type SortField = 'score' | 'rr' | 'time' | 'percentB' | 'timestamp';
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH';
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C';

/* ═══════════════════════════════════════════════════════════════
   TYPES & INTERFACES
   ═══════════════════════════════════════════════════════════════ */

interface MereTrigger {
  scripCode: string;
  symbol: string;
  companyName: string;
  exchange: string;
  triggered: boolean;
  direction: string;
  triggerPrice: number;
  triggerScore: number;
  triggerTime: string;
  triggerTimeEpoch: number;
  // MERE scoring
  mereScore: number;
  mereLayer1: number;
  mereLayer2: number;
  mereLayer3: number;
  mereBonus: number;
  merePenalty: number;
  mereReasons: string;
  // BB data
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidth: number;
  percentB: number;
  // SuperTrend
  superTrend: number;
  trend: string;
  trendChanged: boolean;
  pricePosition: string;
  isSqueezing: boolean;
  barsInTrend: number;
  trendStrength: number;
  // Trade levels
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  target4: number;
  riskReward: number;
  pivotSource: boolean;
  atr30m: number;
  mereSLSource?: string;
  // Volume
  volumeT: number;
  volumeTMinus1: number;
  avgVolume: number;
  surgeT: number;
  surgeTMinus1: number;
  // OI
  oiChangeAtT?: number;
  oiInterpretation?: string;
  oiLabel?: string;
  // Option enrichment
  optionAvailable?: boolean;
  optionScripCode?: string;
  optionSymbol?: string;
  optionStrike?: number;
  optionType?: string;
  optionExpiry?: string;
  optionLtp?: number;
  optionLotSize?: number;
  optionMultiplier?: number;
  optionExchange?: string;
  optionExchangeType?: string;
  // Futures fallback
  futuresAvailable?: boolean;
  futuresScripCode?: string;
  futuresSymbol?: string;
  futuresLtp?: number;
  futuresLotSize?: number;
  futuresMultiplier?: number;
  futuresExpiry?: string;
  futuresExchange?: string;
  futuresExchangeType?: string;
  cachedAt: number;
}

interface TradePlan {
  entry: number;
  sl: number;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  t4: number | null;
  rr: number;
  atr: number;
  optionType: 'CE' | 'PE';
  strike: number;
  strikeInterval: number;
}

interface ExecutionState {
  visible: boolean;
  symbol: string;
  optionName: string;
  strike: number;
  optionType: 'CE' | 'PE';
  lots: number;
  filledPrice: number;
  riskPercent: number;
  status: 'sending' | 'filled' | 'error';
  orderId?: string;
  errorMessage?: string;
}

interface MereTabContentProps {
  autoRefresh?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(decimals);
}

function getStrikeInterval(price: number): number {
  if (price > 50000) return 500;
  if (price > 20000) return 200;
  if (price > 10000) return 100;
  if (price > 5000) return 50;
  if (price > 1000) return 25;
  if (price > 200) return 5;
  return 2.5;
}

function getOTMStrike(equityPrice: number, direction: string): { strike: number; interval: number } {
  const interval = getStrikeInterval(equityPrice);
  const isLong = direction === 'BULLISH';
  const atm = Math.round(equityPrice / interval) * interval;
  const strike = isLong ? atm + interval : atm - interval;
  return { strike, interval };
}

function extractTradePlan(sig: MereTrigger): TradePlan {
  const isLong = sig.direction === 'BULLISH';
  const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE';
  const { strike, interval } = getOTMStrike(sig.triggerPrice, sig.direction);

  const bw = (sig.bbUpper || 0) - (sig.bbLower || 0);
  const atr = sig.atr30m && sig.atr30m > 0
    ? sig.atr30m
    : bw > 0 ? bw / 2.5 : sig.triggerPrice * 0.004;

  // MERE always has backend-enriched targets (BB-based SL + BB/pivot targets)
  if (sig.target1 != null && sig.stopLoss != null) {
    return {
      entry: sig.triggerPrice,
      sl: sig.stopLoss,
      t1: sig.target1 ?? null,
      t2: sig.target2 ?? null,
      t3: sig.target3 ?? null,
      t4: sig.target4 ?? null,
      rr: sig.riskReward ?? 0,
      atr,
      optionType,
      strike,
      strikeInterval: interval,
    };
  }

  // Fallback (shouldn't happen for MERE — BB-based SL is always computed)
  const sl = isLong
    ? sig.triggerPrice - atr * 1.5
    : sig.triggerPrice + atr * 1.5;
  const risk = Math.abs(sig.triggerPrice - sl);
  const t1 = sig.bbMiddle || (isLong ? sig.triggerPrice + risk * 1.5 : sig.triggerPrice - risk * 1.5);
  const t2 = isLong ? (sig.bbUpper || sig.triggerPrice + risk * 2.5) : (sig.bbLower || sig.triggerPrice - risk * 2.5);
  const rr = risk > 0 ? (Math.abs(t1 - sig.triggerPrice) / risk) : 0;

  return {
    entry: sig.triggerPrice,
    sl, t1, t2, t3: null, t4: null,
    rr, atr, optionType, strike, strikeInterval: interval,
  };
}

function estimateOptionPremium(plan: TradePlan): number {
  const otmDist = Math.abs(plan.strike - plan.entry);
  const baseIV = 0.15;
  const timeValue = plan.entry * baseIV * Math.sqrt(7 / 365);
  const intrinsic = Math.max(0, plan.entry - plan.strike);
  return Math.max(1, Math.round((intrinsic + timeValue - otmDist * 0.3) * 100) / 100);
}

function approximateDelta(entry: number, strike: number, optionType: 'CE' | 'PE'): number {
  const moneyness = (entry - strike) / entry;
  let delta: number;
  if (optionType === 'CE') {
    delta = 0.5 + moneyness * 3;
    delta = Math.max(0.15, Math.min(0.85, delta));
  } else {
    delta = -(0.5 - moneyness * 3);
    delta = Math.min(-0.15, Math.max(-0.85, delta));
  }
  return Math.round(delta * 100) / 100;
}

function mapToOptionLevels(
  premium: number,
  equityEntry: number,
  equitySl: number,
  equityTargets: (number | null)[],
  strike: number,
  optionType: 'CE' | 'PE'
): { sl: number; targets: number[]; delta: number } {
  const delta = approximateDelta(equityEntry, strike, optionType);
  const absDelta = Math.abs(delta);
  const slMove = Math.abs(equityEntry - equitySl) * absDelta;
  const sl = Math.max(0.05, premium - slMove);
  const targets = equityTargets.map(t => {
    if (t == null) return 0;
    const move = Math.abs(t - equityEntry) * absDelta;
    return Math.round((premium + move) * 100) / 100;
  });
  return { sl: Math.round(sl * 100) / 100, targets, delta };
}

function formatTriggerTime(sig: MereTrigger): string {
  if (sig.triggerTime) {
    try {
      const d = new Date(sig.triggerTime);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      }
    } catch { /* fall through */ }
  }
  if (sig.triggerTimeEpoch) {
    return new Date(sig.triggerTimeEpoch).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  return '';
}

function getEpoch(sig: MereTrigger): number {
  if (sig.triggerTimeEpoch) return sig.triggerTimeEpoch;
  if (sig.triggerTime) {
    const d = new Date(sig.triggerTime);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return sig.cachedAt || 0;
}

function getOILabelStyle(label?: string): { text: string; color: string } {
  switch (label) {
    case 'LONG_BUILDUP': return { text: 'Long Buildup', color: 'text-green-400' };
    case 'SHORT_BUILDUP': return { text: 'Short Buildup', color: 'text-green-400' };
    case 'SHORT_COVERING': return { text: 'Short Covering', color: 'text-orange-400' };
    case 'LONG_UNWINDING': return { text: 'Long Unwinding', color: 'text-orange-400' };
    default: return { text: '', color: 'text-slate-500' };
  }
}

function getOIAccent(label?: string): string {
  if (label === 'LONG_BUILDUP' || label === 'SHORT_BUILDUP') return 'bg-green-500/15 text-green-300';
  if (label === 'SHORT_COVERING' || label === 'LONG_UNWINDING') return 'bg-orange-500/15 text-orange-300';
  return 'bg-slate-700/50 text-slate-300';
}

/** Compute lot sizing based on confidence and wallet capital */
function computeLotSizing(
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

/* ═══════════════════════════════════════════════════════════════
   MERE SCORE BAR — visual layer breakdown
   ═══════════════════════════════════════════════════════════════ */

const MereScoreBar: React.FC<{ sig: MereTrigger }> = ({ sig }) => {
  const total = sig.mereScore;
  const maxScore = 120; // 40+30+30+20
  const pct = Math.min(100, (total / maxScore) * 100);

  const scoreColor = total >= 80 ? 'text-green-400' : total >= 70 ? 'text-teal-400' : total >= 50 ? 'text-yellow-400' : 'text-slate-400';
  const barColor = total >= 80 ? 'bg-green-500' : total >= 70 ? 'bg-teal-500' : total >= 50 ? 'bg-yellow-500' : 'bg-slate-500';

  return (
    <div className="bg-slate-900/50 rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">MERE Score</span>
        <span className={`font-mono text-sm font-bold ${scoreColor}`}>{total}</span>
      </div>
      {/* Progress bar */}
      <div className="h-[6px] bg-slate-700 rounded-full overflow-hidden mb-2">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {/* Layer chips */}
      <div className="grid grid-cols-5 gap-1 text-center">
        <div>
          <div className="text-[9px] text-slate-500">Setup</div>
          <div className="font-mono text-[11px] text-teal-300">{sig.mereLayer1}/40</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500">Trend</div>
          <div className="font-mono text-[11px] text-teal-300">{sig.mereLayer2}/30</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500">Confirm</div>
          <div className="font-mono text-[11px] text-teal-300">{sig.mereLayer3}/30</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500">Bonus</div>
          <div className="font-mono text-[11px] text-cyan-300">+{sig.mereBonus}</div>
        </div>
        {sig.merePenalty > 0 && (
          <div>
            <div className="text-[9px] text-slate-500">Penalty</div>
            <div className="font-mono text-[11px] text-red-400">-{sig.merePenalty}</div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   %B POSITION INDICATOR
   ═══════════════════════════════════════════════════════════════ */

const PercentBIndicator: React.FC<{ percentB: number; isSqueezing: boolean; direction: string }> = ({ percentB, isSqueezing, direction }) => {
  // percentB: 0 = at lower BB, 0.5 = at middle, 1 = at upper BB
  const clampedB = Math.max(-0.1, Math.min(1.1, percentB));
  const leftPct = Math.max(2, Math.min(98, clampedB * 100));

  const isLong = direction === 'BULLISH';
  const posColor = isLong
    ? (percentB <= 0.1 ? 'text-green-400' : percentB <= 0.3 ? 'text-teal-400' : 'text-slate-400')
    : (percentB >= 0.9 ? 'text-green-400' : percentB >= 0.7 ? 'text-teal-400' : 'text-slate-400');

  return (
    <div className="bg-slate-900/50 rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">BB Position (%B)</span>
        <div className="flex items-center gap-2">
          {isSqueezing && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">SQUEEZE</span>
          )}
          <span className={`font-mono text-xs font-bold ${posColor}`}>{(percentB * 100).toFixed(0)}%</span>
        </div>
      </div>
      {/* Visual BB bar */}
      <div className="relative h-[8px] bg-gradient-to-r from-red-500/30 via-slate-600/50 to-green-500/30 rounded-full">
        {/* Middle marker */}
        <div className="absolute left-1/2 top-0 w-[2px] h-full bg-slate-400/50" />
        {/* Price position dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg shadow-white/20 border border-slate-600"
          style={{ left: `calc(${leftPct}% - 6px)` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-slate-500">
        <span>Lower BB</span>
        <span>Middle</span>
        <span>Upper BB</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   R:R VISUAL BAR
   ═══════════════════════════════════════════════════════════════ */

const RiskRewardBar: React.FC<{ rr: number }> = ({ rr }) => {
  const totalParts = 1 + Math.max(rr, 0);
  const riskPct = totalParts > 0 ? (1 / totalParts) * 100 : 50;
  const rewardPct = 100 - riskPct;

  return (
    <div>
      <div className="flex h-[6px] rounded-full overflow-hidden">
        <div className="bg-red-500/80 rounded-l-full" style={{ width: `${riskPct}%` }} />
        <div className="bg-green-500/80 rounded-r-full" style={{ width: `${rewardPct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] text-slate-500">Risk</span>
        <span className={`font-mono text-xs font-bold ${
          rr >= 2 ? 'text-green-400' : rr >= 1.5 ? 'text-green-400/80' : rr >= 1 ? 'text-yellow-400' : 'text-red-400'
        }`}>
          R:R 1:{rr.toFixed(1)}
        </span>
        <span className="text-[11px] text-slate-500">Reward</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   METRICS CHIP
   ═══════════════════════════════════════════════════════════════ */

const MetricsChip: React.FC<{ label: string; value: string; accent?: string; bold?: boolean }> = ({ label, value, accent, bold }) => (
  <div className={`flex-shrink-0 flex items-center gap-1 px-1.5 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-mono
    ${accent || 'bg-slate-700/50 text-slate-300'}`}>
    <span className="text-slate-500 text-[9px] sm:text-[10px]">{label}</span>
    <span className={bold ? 'font-bold text-white' : 'font-medium'}>{value}</span>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   EXECUTION OVERLAY
   ═══════════════════════════════════════════════════════════════ */

const ExecutionOverlay: React.FC<{
  state: ExecutionState;
  onClose: () => void;
  onViewPosition: () => void;
}> = ({ state, onClose, onViewPosition }) => {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (state.visible && state.status === 'filled') {
      timerRef.current = setTimeout(onClose, 3000);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [state.visible, state.status, onClose]);

  if (!state.visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-[340px] shadow-2xl animate-scaleIn text-center">
        {state.status === 'sending' && (
          <>
            <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-1">Placing Order...</h3>
            <p className="text-slate-400 text-sm mb-4">
              {state.symbol} {state.strike} {state.optionType}
            </p>
          </>
        )}
        {state.status === 'error' && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-1">Order Failed</h3>
            <p className="text-red-400 text-sm mb-4">
              {state.errorMessage || 'Could not place order. Try again.'}
            </p>
            <button
              onClick={onClose}
              className="w-full h-11 rounded-lg bg-slate-700 text-white font-semibold text-sm hover:bg-slate-600 transition-colors"
            >
              Close
            </button>
          </>
        )}
        {state.status === 'filled' && (
          <>
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-green-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-1">Order Sent</h3>
            <p className="text-slate-400 text-sm mb-4">
              {state.symbol} {state.strike} {state.optionType}
            </p>
            <div className="grid grid-cols-3 gap-3 mb-5 text-center">
              <div>
                <div className="text-[11px] text-slate-500 mb-0.5">Filled</div>
                <div className="font-mono text-white text-sm">{state.filledPrice.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 mb-0.5">Lots</div>
                <div className="font-mono text-white text-sm">{state.lots}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 mb-0.5">Risk</div>
                <div className="font-mono text-amber-400 text-sm">{state.riskPercent}%</div>
              </div>
            </div>
            <button
              onClick={onViewPosition}
              className="w-full h-11 rounded-lg bg-[#3B82F6] text-white font-semibold text-sm hover:bg-blue-600 active:bg-blue-700 transition-colors mb-2"
            >
              View Position
            </button>
            <button
              onClick={onClose}
              className="text-slate-500 text-xs hover:text-slate-300 transition-colors"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   FILTER DROPDOWN
   ═══════════════════════════════════════════════════════════════ */

const FilterDropdown: React.FC<{
  direction: DirectionFilter;
  exchange: ExchangeFilter;
  onDirectionChange: (d: DirectionFilter) => void;
  onExchangeChange: (e: ExchangeFilter) => void;
  onClose: () => void;
  onReset: () => void;
}> = ({ direction, exchange, onDirectionChange, onExchangeChange, onClose, onReset }) => (
  <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 p-4 min-w-[260px] animate-slideDown mobile-dropdown-full">
    <div className="mb-4">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Direction</div>
      <div className="flex gap-2">
        {(['ALL', 'BULLISH', 'BEARISH'] as DirectionFilter[]).map(d => (
          <button
            key={d}
            onClick={() => onDirectionChange(d)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              direction === d
                ? d === 'BULLISH' ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                  : d === 'BEARISH' ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : 'bg-teal-500/20 text-teal-400 border border-teal-500/40'
                : 'bg-slate-700/50 text-slate-400 border border-transparent hover:bg-slate-700'
            }`}
          >
            {d === 'ALL' ? 'All' : d === 'BULLISH' ? 'Bullish' : 'Bearish'}
          </button>
        ))}
      </div>
    </div>
    <div className="mb-4">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Instrument</div>
      <div className="flex gap-2">
        {([
          { key: 'ALL', label: 'All' },
          { key: 'N', label: 'NSE' },
          { key: 'M', label: 'MCX' },
          { key: 'C', label: 'Currency' },
        ] as { key: ExchangeFilter; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onExchangeChange(key)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              exchange === key
                ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40'
                : 'bg-slate-700/50 text-slate-400 border border-transparent hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
    <button
      onClick={onClose}
      className="w-full h-10 rounded-lg bg-[#3B82F6] text-white font-semibold text-sm hover:bg-blue-600 active:bg-blue-700 transition-colors"
    >
      Apply
    </button>
    <div className="text-center mt-2">
      <button onClick={onReset} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
        Reset Filters
      </button>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   SORT DROPDOWN
   ═══════════════════════════════════════════════════════════════ */

const SORT_OPTIONS: { key: SortField; label: string }[] = [
  { key: 'timestamp', label: 'Recent' },
  { key: 'score', label: 'MERE Score' },
  { key: 'rr', label: 'R:R' },
  { key: 'percentB', label: '%B Extremity' },
  { key: 'time', label: 'Latest Trigger' },
];

const SortDropdown: React.FC<{
  current: SortField;
  onSelect: (f: SortField) => void;
  onClose: () => void;
}> = ({ current, onSelect, onClose }) => (
  <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 py-1 min-w-[180px] animate-slideDown">
    {SORT_OPTIONS.map(({ key, label }) => (
      <button
        key={key}
        onClick={() => { onSelect(key); onClose(); }}
        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
          current === key
            ? 'text-teal-400 bg-teal-500/10'
            : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
        }`}
      >
        {label}
        {current === key && <Check className="w-3.5 h-3.5 inline ml-2 text-teal-400" />}
      </button>
    ))}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   EMPTY STATE
   ═══════════════════════════════════════════════════════════════ */

const EmptyState: React.FC<{ hasFilters: boolean; onReset: () => void }> = ({ hasFilters, onReset }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center px-6">
    <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
      <TrendingUp className="w-7 h-7 text-slate-600" />
    </div>
    <h3 className="text-white font-medium text-lg mb-1">No Signals Match</h3>
    <p className="text-slate-500 text-sm mb-5 max-w-xs">
      {hasFilters
        ? 'No MERE signals match your current filters. Try adjusting your criteria.'
        : 'Waiting for mean reversion signals (BB band touch + pattern confirmation)...'}
    </p>
    {hasFilters && (
      <button
        onClick={onReset}
        className="px-5 py-2.5 rounded-lg bg-[#3B82F6] text-white font-medium text-sm hover:bg-blue-600 transition-colors"
      >
        Reset Filters
      </button>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   MERE TRADING CARD
   ═══════════════════════════════════════════════════════════════ */

const MereCard: React.FC<{
  trigger: MereTrigger;
  plan: TradePlan;
  walletCapital: number;
  onBuy: (sig: MereTrigger, plan: TradePlan, lots: number) => void;
}> = ({ trigger, plan, walletCapital, onBuy }) => {
  const [pressing, setPressing] = useState(false);
  const isLong = trigger.direction === 'BULLISH';

  const dirColor = isLong ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30';
  const buyBg = isLong ? 'bg-[#18C964]' : 'bg-[#FF4D6D]';
  const buyBgActive = isLong ? 'active:bg-[#15a854]' : 'active:bg-[#e6445f]';
  const buyHover = isLong ? 'hover:bg-[#16b85c]' : 'hover:bg-[#e84565]';
  const cardBorderGlow = isLong
    ? 'border-teal-500/20 hover:border-teal-500/40'
    : 'border-teal-500/20 hover:border-teal-500/40';

  const displayName = trigger.symbol || trigger.companyName || trigger.scripCode;
  const confidence = trigger.mereScore;

  // Option / Futures instrument resolution
  const hasRealOption = trigger.optionAvailable === true && trigger.optionLtp != null && trigger.optionLtp > 0;
  const hasFutures = trigger.futuresAvailable === true && trigger.futuresLtp != null && trigger.futuresLtp > 0;
  const noDerivatives = trigger.optionAvailable === false && !hasFutures;

  let instrumentMode: 'OPTION' | 'FUTURES' | 'NONE' = 'NONE';
  let premium = 0;
  let displayInstrumentName = '';
  let lotSize = 1;
  let multiplier = 1;

  if (hasRealOption) {
    instrumentMode = 'OPTION';
    premium = trigger.optionLtp!;
    const displayStrike = trigger.optionStrike ?? plan.strike;
    const displayOptionType = trigger.optionType ?? plan.optionType;
    displayInstrumentName = `${trigger.symbol} ${displayStrike} ${displayOptionType}`;
    lotSize = trigger.optionLotSize ?? 1;
    multiplier = trigger.optionMultiplier ?? 1;
  } else if (hasFutures) {
    instrumentMode = 'FUTURES';
    premium = trigger.futuresLtp!;
    displayInstrumentName = `${trigger.futuresSymbol ?? trigger.symbol} FUT${trigger.futuresExpiry ? ' ' + trigger.futuresExpiry : ''}`;
    lotSize = trigger.futuresLotSize ?? 1;
    multiplier = trigger.futuresMultiplier ?? 1;
  } else if (!noDerivatives) {
    instrumentMode = 'OPTION';
    premium = estimateOptionPremium(plan);
    displayInstrumentName = `${trigger.symbol} ${plan.strike} ${plan.optionType}`;
    lotSize = 1;
  }

  const sizing = (instrumentMode === 'NONE')
    ? { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0 }
    : computeLotSizing(confidence, walletCapital, premium, lotSize, multiplier);

  // Metrics
  const oiStyle = getOILabelStyle(trigger.oiLabel);
  const oiAccent = getOIAccent(trigger.oiLabel);
  const surgeVal = (trigger.surgeT || 0).toFixed(1);

  return (
    <div className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-clip transition-shadow duration-200 hover:shadow-lg`}>
      <div className="p-3 sm:p-4">

        {/* TOP SECTION */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-white leading-tight">{displayName}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-500">
                Score <span className="font-mono text-teal-400 font-semibold">{trigger.mereScore}</span>
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-xs text-slate-500 font-mono">
                {formatTriggerTime(trigger)}
              </span>
            </div>
          </div>
          <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${dirColor}`}>
            {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isLong ? 'Bullish' : 'Bearish'}
          </span>
        </div>

        {/* MERE SCORE BREAKDOWN */}
        <div className="mt-3">
          <MereScoreBar sig={trigger} />
        </div>

        {/* %B POSITION */}
        <div className="mt-2">
          <PercentBIndicator
            percentB={trigger.percentB}
            isSqueezing={trigger.isSqueezing}
            direction={trigger.direction}
          />
        </div>

        {/* SL / Entry / Targets Grid */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">SL {trigger.mereSLSource ? `(${trigger.mereSLSource})` : ''}</span>
            <span className="font-mono text-sm font-semibold text-red-400">{fmt(plan.sl)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Entry</span>
            <span className="font-mono text-sm font-semibold text-white">{fmt(plan.entry)}</span>
          </div>
          {plan.t1 !== null && (
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">T1 (BB Mid)</span>
              <span className="font-mono text-sm font-semibold text-green-400">{fmt(plan.t1)}</span>
            </div>
          )}
          {plan.t2 !== null && (
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">T2 (Opp BB)</span>
              <span className="font-mono text-sm font-semibold text-green-400/80">{fmt(plan.t2)}</span>
            </div>
          )}
          {plan.t3 !== null && (
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">T3</span>
              <span className="font-mono text-sm font-semibold text-green-400/60">{fmt(plan.t3)}</span>
            </div>
          )}
          {plan.t4 !== null && (
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">T4</span>
              <span className="font-mono text-sm font-semibold text-green-400/40">{fmt(plan.t4)}</span>
            </div>
          )}
        </div>

        {/* R:R BAR */}
        <div className="mt-3">
          <RiskRewardBar rr={plan.rr} />
        </div>

        {/* METRICS ROW */}
        <div className="mt-3 flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 custom-scrollbar -mx-1 px-1 min-w-0">
          <MetricsChip label="ATR" value={fmt(plan.atr)} />
          <MetricsChip label="%B" value={`${(trigger.percentB * 100).toFixed(0)}%`} bold accent="bg-teal-500/15 text-teal-300" />
          {trigger.surgeT > 0 && <MetricsChip label="Vol" value={`${surgeVal}x`} />}
          {trigger.oiLabel && <MetricsChip label="OI" value={getOILabelStyle(trigger.oiLabel).text} accent={oiAccent} />}
          <MetricsChip label="Trend" value={trigger.trend === 'UP' ? 'Bull' : 'Bear'} accent={trigger.trend === 'UP' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'} />
        </div>

        {/* OI LABEL */}
        {oiStyle.text && (
          <div className="mt-1.5 px-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${oiStyle.color}`}>
              {oiStyle.text}
            </span>
          </div>
        )}

        {/* MERE REASONS */}
        {trigger.mereReasons && trigger.mereReasons.length > 0 && (
          <div className="mt-2 px-1">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Reasons</div>
            <div className="flex flex-wrap gap-1">
              {trigger.mereReasons.split(',').filter(r => r.trim()).map((reason, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20">
                  {reason.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* INSUFFICIENT FUNDS */}
        {sizing.insufficientFunds && !sizing.disabled && (
          <div className="mt-3 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <span className="text-[11px] text-orange-400">Insufficient Funds — forced 1 lot (need +&#8377;{sizing.creditAmount.toLocaleString('en-IN')})</span>
          </div>
        )}

        {/* BUY BUTTON */}
        {instrumentMode === 'NONE' ? (
          <button
            disabled
            className="w-full h-12 rounded-xl mt-4 text-slate-500 font-semibold text-sm bg-slate-700/30 border border-slate-600/30 cursor-not-allowed"
          >
            No Derivatives Available for {trigger.symbol || trigger.scripCode}
          </button>
        ) : sizing.disabled ? (
          <button
            disabled
            className="w-full h-12 rounded-xl mt-4 text-slate-400 font-semibold text-sm bg-slate-700/50 cursor-not-allowed"
          >
            Score {confidence} &lt; 60 — No Trade
          </button>
        ) : (
          <button
            onClick={() => onBuy(trigger, plan, sizing.lots)}
            onMouseDown={() => setPressing(true)}
            onMouseUp={() => setPressing(false)}
            onMouseLeave={() => setPressing(false)}
            className={`w-full h-12 rounded-xl mt-4 text-white font-semibold text-sm
              transition-all duration-100 select-none
              ${buyBg} ${buyHover} ${buyBgActive}
              ${pressing ? 'scale-[0.98] brightness-90' : 'scale-100'}`}
          >
            BUY {displayInstrumentName} @ &#8377;{Number(premium.toFixed(2))}/-  x {sizing.lots} lot{sizing.lots > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN: MERE TAB CONTENT
   ═══════════════════════════════════════════════════════════════ */

export const MereTabContent: React.FC<MereTabContentProps> = ({ autoRefresh = true }) => {
  const navigate = useNavigate();
  const [triggers, setTriggers] = useState<MereTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL');
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [execution, setExecution] = useState<ExecutionState>({
    visible: false, symbol: '', optionName: '', strike: 0,
    optionType: 'CE', lots: 1, filledPrice: 0, riskPercent: 0,
    status: 'sending',
  });
  const [walletCapital, setWalletCapital] = useState<number>(100000);

  const fetchMere = useCallback(async () => {
    try {
      const data = await fetchJson<MereTrigger[]>('/strategy-state/mere/history/list');
      if (data) {
        setTriggers(data);
      }
    } catch (err) {
      console.error('Error fetching MERE triggers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMere();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchMere, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [autoRefresh, fetchMere]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-dropdown]')) {
        setShowFilter(false);
        setShowSort(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Fetch wallet capital for lot sizing
  useEffect(() => {
    const fetchCapital = async () => {
      try {
        const data = await strategyWalletsApi.getCapital('MERE');
        if (data?.currentCapital != null) setWalletCapital(data.currentCapital);
      } catch { /* ignore */ }
    };
    fetchCapital();
    const interval = setInterval(fetchCapital, 30000);
    return () => clearInterval(interval);
  }, []);

  /* FILTER */
  const hasActiveFilter = directionFilter !== 'ALL' || exchangeFilter !== 'ALL';

  let filtered = triggers.filter(t => t.triggered);
  if (directionFilter !== 'ALL') {
    filtered = filtered.filter(s => s.direction === directionFilter);
  }
  if (exchangeFilter !== 'ALL') {
    filtered = filtered.filter(s => s.exchange === exchangeFilter);
  }

  /* ENRICH WITH TRADE PLANS */
  const enriched = filtered.map(sig => ({ sig, plan: extractTradePlan(sig) }));

  /* SORT */
  const sorted = [...enriched].sort((a, b) => {
    switch (sortField) {
      case 'score':
        return b.sig.mereScore - a.sig.mereScore || getEpoch(b.sig) - getEpoch(a.sig);
      case 'rr':
        return b.plan.rr - a.plan.rr || getEpoch(b.sig) - getEpoch(a.sig);
      case 'time':
        return getEpoch(b.sig) - getEpoch(a.sig);
      case 'percentB': {
        // Sort by how extreme the %B is (closer to 0 or 1)
        const extremityA = Math.abs(a.sig.percentB - 0.5);
        const extremityB = Math.abs(b.sig.percentB - 0.5);
        return extremityB - extremityA || getEpoch(b.sig) - getEpoch(a.sig);
      }
      case 'timestamp':
        return getEpoch(b.sig) - getEpoch(a.sig);
      default:
        return 0;
    }
  });

  const sortLabel = SORT_OPTIONS.find(o => o.key === sortField)?.label || 'Recent';

  /* BUY HANDLER */
  const handleBuy = useCallback(async (sig: MereTrigger, plan: TradePlan, lots: number) => {
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
    const isLong = sig.direction === 'BULLISH';

    let premium = 0;
    let instrumentSymbol = '';
    let instrumentType: 'OPTION' | 'FUTURES' = 'OPTION';
    let lotSize = 1;
    let multiplier = 1;
    let tradingScripCode = sig.scripCode;
    let strike = plan.strike;
    let optionType: 'CE' | 'PE' = plan.optionType;

    if (hasRealOption) {
      premium = sig.optionLtp!;
      strike = sig.optionStrike ?? plan.strike;
      optionType = (sig.optionType ?? plan.optionType) as 'CE' | 'PE';
      instrumentSymbol = `${sig.symbol} ${strike} ${optionType}`;
      lotSize = sig.optionLotSize ?? 1;
      multiplier = sig.optionMultiplier ?? 1;
      tradingScripCode = sig.optionScripCode ?? sig.scripCode;
      instrumentType = 'OPTION';
    } else if (hasFutures) {
      premium = sig.futuresLtp!;
      instrumentSymbol = `${sig.futuresSymbol ?? sig.symbol} FUT${sig.futuresExpiry ? ' ' + sig.futuresExpiry : ''}`;
      lotSize = sig.futuresLotSize ?? 1;
      multiplier = sig.futuresMultiplier ?? 1;
      tradingScripCode = sig.futuresScripCode ?? sig.scripCode;
      instrumentType = 'FUTURES';
    } else {
      premium = estimateOptionPremium(plan);
      instrumentSymbol = `${sig.symbol} ${plan.strike} ${plan.optionType}`;
      instrumentType = 'OPTION';
    }

    setExecution({
      visible: true,
      symbol: sig.symbol || sig.scripCode,
      optionName: instrumentSymbol,
      strike,
      optionType,
      lots,
      filledPrice: premium,
      riskPercent: 0.8,
      status: 'sending',
    });

    try {
      let tradeSl = plan.sl;
      let tradeT1 = plan.t1 ?? 0;
      let tradeT2 = plan.t2 ?? 0;
      let tradeT3 = plan.t3 ?? 0;
      let tradeT4 = plan.t4 ?? 0;
      let delta = 1.0;

      if (instrumentType === 'OPTION' && hasRealOption) {
        const mapped = mapToOptionLevels(
          premium,
          sig.triggerPrice,
          plan.sl,
          [plan.t1, plan.t2, plan.t3, plan.t4],
          strike,
          optionType
        );
        tradeSl = mapped.sl;
        tradeT1 = mapped.targets[0] ?? 0;
        tradeT2 = mapped.targets[1] ?? 0;
        tradeT3 = mapped.targets[2] ?? 0;
        tradeT4 = mapped.targets[3] ?? 0;
        delta = mapped.delta;
      }

      const req: StrategyTradeRequest = {
        scripCode: tradingScripCode,
        instrumentSymbol,
        instrumentType,
        underlyingScripCode: sig.scripCode,
        underlyingSymbol: sig.symbol || sig.scripCode,
        side: 'BUY',
        quantity: lots * lotSize,
        lots,
        lotSize,
        multiplier,
        entryPrice: premium,
        sl: tradeSl,
        t1: tradeT1,
        t2: tradeT2,
        t3: tradeT3,
        t4: tradeT4,
        equitySpot: sig.triggerPrice,
        equitySl: plan.sl,
        equityT1: plan.t1 ?? 0,
        equityT2: plan.t2 ?? 0,
        equityT3: plan.t3 ?? 0,
        equityT4: plan.t4 ?? 0,
        delta,
        optionType: instrumentType === 'OPTION' ? optionType : undefined,
        strike,
        strategy: 'MERE',
        exchange: sig.exchange,
        direction: isLong ? 'BULLISH' : 'BEARISH',
        confidence: sig.mereScore,
      };

      const result = await strategyTradesApi.create(req);

      setExecution(prev => ({
        ...prev,
        status: 'filled',
        filledPrice: result.entryPrice ?? premium,
        orderId: result.tradeId,
        riskPercent: plan.sl && sig.triggerPrice
          ? Math.round(Math.abs(sig.triggerPrice - plan.sl) / sig.triggerPrice * 100 * 10) / 10
          : 0.8,
      }));
    } catch (err) {
      setExecution(prev => ({
        ...prev,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Order failed',
      }));
    }
  }, []);

  const resetFilters = useCallback(() => {
    setDirectionFilter('ALL');
    setExchangeFilter('ALL');
    setShowFilter(false);
  }, []);

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="relative">
      {/* STICKY HEADER */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50">
        <div className="flex items-center justify-between h-14 px-4">
          <h1 className="text-lg font-semibold text-teal-400 tracking-tight">MERE</h1>

          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => { e.stopPropagation(); setShowFilter(!showFilter); setShowSort(false); }}
                className={`relative p-2 rounded-lg transition-colors ${
                  hasActiveFilter
                    ? 'bg-teal-500/15 text-teal-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Filter className="w-5 h-5" />
                {hasActiveFilter && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-teal-400" />
                )}
              </button>
              {showFilter && (
                <FilterDropdown
                  direction={directionFilter}
                  exchange={exchangeFilter}
                  onDirectionChange={setDirectionFilter}
                  onExchangeChange={setExchangeFilter}
                  onClose={() => setShowFilter(false)}
                  onReset={resetFilters}
                />
              )}
            </div>

            {/* Sort */}
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => { e.stopPropagation(); setShowSort(!showSort); setShowFilter(false); }}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <ArrowUpDown className="w-5 h-5" />
              </button>
              {showSort && (
                <SortDropdown current={sortField} onSelect={setSortField} onClose={() => setShowSort(false)} />
              )}
            </div>
          </div>
        </div>

        {/* Sort chip */}
        <div className="px-4 pb-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/80 text-[12px] text-slate-400 border border-slate-700/50">
            Sorted by {sortLabel}
          </span>
        </div>
      </div>

      {/* CONTENT */}
      <div className="pt-4 pb-8">
        {loading && triggers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-teal-400 animate-spin mb-4" />
            <span className="text-slate-500 text-sm">Loading MERE signals...</span>
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} onReset={resetFilters} />
        )}

        {sorted.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <MereCard
                key={`${sig.scripCode}-${getEpoch(sig)}`}
                trigger={sig}
                plan={plan}
                walletCapital={walletCapital}
                onBuy={handleBuy}
              />
            ))}
          </div>
        )}
      </div>

      {/* EXECUTION OVERLAY */}
      <ExecutionOverlay
        state={execution}
        onClose={() => setExecution(s => ({ ...s, visible: false }))}
        onViewPosition={() => {
          setExecution(s => ({ ...s, visible: false }));
          navigate('/wallets');
        }}
      />
    </div>
  );
};

export default MereTabContent;
