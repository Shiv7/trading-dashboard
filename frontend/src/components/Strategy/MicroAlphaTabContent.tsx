import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, AlertTriangle, Loader2, Activity, Clock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchJson, strategyWalletsApi, strategyTradesApi, marketDataApi, greeksApi } from '../../services/api';
import type { StrategyTradeRequest } from '../../types/orders';
import { computeSlotSizing, SlotWalletState, isNseNoTradeWindow, checkStalePriceAdjustment } from '../../utils/tradingUtils';
import type { StalePriceResult } from '../../utils/tradingUtils';
import StalePriceModal from './StalePriceModal';

/* ═══════════════════════════════════════════════════════════════
   TYPES & INTERFACES
   ═══════════════════════════════════════════════════════════════ */

interface MicroAlphaSignal {
  scripCode: string;
  symbol: string;
  exchange: string;
  triggered: boolean;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reason: string;
  strategy: string;
  triggerTime: string;
  triggerTimeEpoch: number;
  score: number;
  conviction: number;
  absConviction: number;
  tradingMode: string;
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskReward: number;
  reasons?: string[];
  subScores?: Record<string, number>;
  hasOrderbook?: boolean;
  hasOI?: boolean;
  hasOptions?: boolean;
  hasSession?: boolean;
  cachedAt?: number;
  // Option enrichment from backend
  optionAvailable?: boolean;
  optionScripCode?: string;
  optionSymbol?: string;
  optionStrike?: number;
  optionType?: string;
  optionExpiry?: string;
  optionLtp?: number;
  optionLotSize?: number;
  optionExchange?: string;
  optionExchangeType?: string;
  // Futures fallback (MCX instruments without options)
  futuresAvailable?: boolean;
  futuresScripCode?: string;
  futuresSymbol?: string;
  futuresLtp?: number;
  futuresLotSize?: number;
  futuresExpiry?: string;
  futuresExchange?: string;
  futuresExchangeType?: string;
  futuresVolume?: number;
  // Raw metrics for enhanced card
  oiChangePercent?: number;
  oiInterpretation?: string;
  volumeXFactor?: number;
  pcrValue?: number;
  maxPainDistPercent?: number;
  modeReason?: string;
  blockCount?: number;
  modeWeights?: Record<string, number>;
  // Greek enrichment from Streaming Candle (Black-Scholes)
  greekEnriched?: boolean;
  greekDelta?: number;
  greekGamma?: number;
  greekTheta?: number;
  greekVega?: number;
  greekIV?: number;
  greekDte?: number;
  greekMoneynessType?: string;
  greekThetaImpaired?: boolean;
  greekSlMethod?: string;
  greekGammaBoost?: number;
  optionRR?: number;
  optionSL?: number;
  optionT1?: number;
  optionT2?: number;
  optionT3?: number;
  optionT4?: number;
  lotAllocation?: string;
  futuresSL?: number;
  futuresT1?: number;
  futuresT2?: number;
  futuresT3?: number;
  futuresT4?: number;
}

interface TradePlan {
  entry: number;
  sl: number;
  t1: number;
  t2: number;
  t3: number | null;
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
  errorMessage?: string;
  orderId?: string;
}

type SortField = 'strength' | 'confidence' | 'rr' | 'time' | 'timestamp';
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH';
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C';

interface MicroAlphaTabContentProps {
  autoRefresh?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'DM';
  return Number(v.toFixed(2)).toString();
}

function getStrikeInterval(price: number): number {
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

function getOTMStrike(price: number, direction: string): { strike: number; interval: number } {
  const interval = getStrikeInterval(price);
  const atm = Math.round(price / interval) * interval;
  const strike = direction === 'BULLISH' ? atm + interval : atm - interval;
  return { strike, interval };
}

function getEpoch(sig: MicroAlphaSignal): number {
  if (sig.triggerTimeEpoch) return sig.triggerTimeEpoch;
  if (sig.triggerTime) {
    const d = new Date(sig.triggerTime);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return sig.cachedAt || 0;
}

function formatTriggerTime(sig: MicroAlphaSignal): string {
  if (!sig.triggerTime) return '--';
  const d = new Date(sig.triggerTime);
  if (isNaN(d.getTime())) return '--';
  const day = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' });
  const month = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase();
  const time = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
  return `${day} ${month} ${time}`;
}

function estimateOptionPremium(plan: TradePlan): number {
  return Math.round(Math.max(plan.atr * 3, plan.entry * 0.008) * 10) / 10;
}

/** Approximate option delta from moneyness using logistic function */
function approximateDelta(spot: number, strike: number, optionType: 'CE' | 'PE'): number {
  const moneyness = (spot - strike) / strike;
  const ceDelta = 1 / (1 + Math.exp(-10 * moneyness));
  return optionType === 'CE' ? ceDelta : 1 - ceDelta;
}

/** Map equity-level SL/targets to option premium levels using delta */
function mapToOptionLevels(
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

function extractTradePlan(sig: MicroAlphaSignal): TradePlan {
  const isLong = sig.direction === 'BULLISH';
  const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE';
  const entry = sig.entryPrice ?? 0;
  const sl = sig.stopLoss ?? 0;
  const { strike, interval } = getOTMStrike(entry, sig.direction);

  const risk = Math.abs(entry - sl);
  const atr = risk > 0 ? risk : entry * 0.004;

  const t1 = sig.target ?? entry;
  const t2 = isLong ? entry + risk * 3 : entry - risk * 3;
  const t3 = isLong ? entry + risk * 4 : entry - risk * 4;

  return {
    entry,
    sl,
    t1, t2, t3,
    rr: sig.riskReward ?? 0,
    atr,
    optionType,
    strike,
    strikeInterval: interval,
  };
}

/** Confidence from absConviction (already 0-100 scale) */
function computeConfidence(sig: MicroAlphaSignal): number {
  return Math.min(97, Math.max(0, Math.round(sig.absConviction ?? 0)));
}

/** Composite strength score */
function computeStrength(sig: MicroAlphaSignal, plan: TradePlan): number {
  const conf = computeConfidence(sig);
  const rr = plan.rr;
  const confNorm = ((conf - 40) / 57) * 50;
  const rrNorm = Math.min(50, (rr / 4) * 50);
  return Math.min(100, Math.round(confNorm + rrNorm));
}

// computeSlotSizing: imported from ../../utils/tradingUtils (threshold=12 for MicroAlpha)

/** Trading mode badge color */
function getModeColor(mode: string): string {
  switch (mode) {
    case 'TREND_FOLLOWING': return 'bg-green-500/15 text-green-400 border-green-500/30';
    case 'MEAN_REVERSION': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'BREAKOUT_AWAITING': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    default: return 'bg-slate-700/50 text-slate-400 border-slate-600';
  }
}

function getModeLabel(mode: string): string {
  switch (mode) {
    case 'TREND_FOLLOWING': return 'Trend Following';
    case 'MEAN_REVERSION': return 'Mean Reversion';
    case 'BREAKOUT_AWAITING': return 'Breakout Awaiting';
    case 'TREND_WITH_CAUTION': return 'Trend w/ Caution';
    case 'CAUTIOUS': return 'Cautious';
    case 'AVOID': return 'Avoid';
    default: return mode;
  }
}

function getModeIcon(mode: string): string {
  switch (mode) {
    case 'TREND_FOLLOWING': return '\u2197'; // ↗
    case 'MEAN_REVERSION': return '\u21C4'; // ⇄
    case 'BREAKOUT_AWAITING': return '\u26A1'; // ⚡
    case 'TREND_WITH_CAUTION': return '\u26A0'; // ⚠
    default: return '\u2022'; // •
  }
}

/** OI interpretation → human-readable label */
function getOIInterpLabel(interp: string | undefined): string {
  switch (interp) {
    case 'LONG_BUILDUP': return 'Long Buildup';
    case 'SHORT_COVERING': return 'Short Covering';
    case 'SHORT_BUILDUP': return 'Short Buildup';
    case 'LONG_UNWINDING': return 'Long Unwinding';
    default: return 'Neutral';
  }
}

/** OI interpretation → meaning */
function getOIInterpMeaning(interp: string | undefined): string {
  switch (interp) {
    case 'LONG_BUILDUP': return 'new longs entering, bullish';
    case 'SHORT_COVERING': return 'shorts exiting, mildly bullish';
    case 'SHORT_BUILDUP': return 'new shorts entering, bearish';
    case 'LONG_UNWINDING': return 'longs exiting, bearish pressure';
    default: return 'no clear directional bias';
  }
}

/**
 * Build smart inference text — interpretation only, no raw numbers
 * (raw numbers are already shown in the x-factor metrics row).
 */
function buildSmartInference(sig: MicroAlphaSignal): string {
  const parts: string[] = [];
  const blockCount = sig.blockCount ?? 0;
  const oiInterp = sig.oiInterpretation;
  const pcr = sig.pcrValue ?? 0;
  const isLong = sig.direction === 'BULLISH';

  // OI interpretation (most important signal)
  if (oiInterp && oiInterp !== 'NEUTRAL') {
    const interpLabel = getOIInterpLabel(oiInterp);
    const meaning = getOIInterpMeaning(oiInterp);
    parts.push(`${interpLabel} \u2014 ${meaning}`);
  }

  // Block deal interpretation
  if (blockCount > 0) {
    const side = isLong ? 'buy-side' : 'sell-side';
    parts.push(`Institutional ${side} positioning via block deals`);
  }

  // PCR interpretation
  if (pcr > 0.8) {
    parts.push('Elevated puts suggest institutional hedging');
  } else if (pcr < 0.3 && pcr > 0) {
    parts.push('Extreme call-side greed \u2014 contrarian caution');
  }

  return parts.length > 0 ? parts.join('. ') + '.' : '';
}

/* ═══════════════════════════════════════════════════════════════
   R:R VISUAL BAR
   ═══════════════════════════════════════════════════════════════ */

const RiskRewardBar: React.FC<{ rr: number }> = ({ rr: rawRr }) => {
  const rr = isFinite(rawRr) ? rawRr : 0;
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
        }`}>R:R 1:{rr.toFixed(1)}</span>
        <span className="text-[11px] text-slate-500">Reward</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   METRICS CHIP
   ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   SUB-SCORE BAR (horizontal fill bar with weight annotation)
   ═══════════════════════════════════════════════════════════════ */

const SubScoreBar: React.FC<{
  label: string;
  score: number;
  weight: number;
  callout?: string;
}> = ({ label, score, weight, callout }) => {
  const absScore = Math.abs(score);
  const fillPct = Math.min(100, absScore); // Cap visual at 100% width
  const isPositive = score > 0;
  const barColor = absScore < 5 ? 'bg-slate-600' : isPositive ? 'bg-green-500/70' : 'bg-red-500/70';
  const textColor = absScore < 5 ? 'text-slate-500' : isPositive ? 'text-green-400' : 'text-red-400';
  const weightPct = Math.round(weight * 100);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 w-[52px] text-right shrink-0 capitalize">{label}</span>
      <div className="flex-1 h-[6px] bg-slate-800 rounded-full overflow-hidden relative">
        <div className={`h-full rounded-full ${barColor} transition-all duration-300`} style={{ width: `${fillPct}%` }} />
        {absScore > 100 && (
          <div className="absolute right-0 top-0 h-full w-1 bg-yellow-400 animate-pulse" />
        )}
      </div>
      <span className={`font-mono text-[11px] font-semibold w-[36px] text-right ${textColor}`}>
        {score > 0 ? '+' : ''}{score.toFixed(0)}
      </span>
      <span className="text-[9px] text-slate-600 w-[28px] text-right">{weightPct}%</span>
      {callout && <span className="text-[9px] text-slate-500 truncate max-w-[70px]">{callout}</span>}
    </div>
  );
};

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
            <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-1">Placing Order...</h3>
            <p className="text-slate-400 text-sm mb-4">{state.symbol} {state.strike} {state.optionType}</p>
          </>
        )}
        {state.status === 'error' && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-1">Order Failed</h3>
            <p className="text-red-400 text-sm mb-4">{state.errorMessage || 'Could not place order. Try again.'}</p>
            <button onClick={onClose} className="w-full h-11 rounded-lg bg-slate-700 text-white font-semibold text-sm hover:bg-slate-600 transition-colors">Close</button>
          </>
        )}
        {state.status === 'filled' && (
          <>
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-green-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-1">Order Sent</h3>
            <p className="text-slate-400 text-sm mb-4">{state.symbol} {state.strike} {state.optionType}</p>
            <div className="grid grid-cols-3 gap-3 mb-5 text-center">
              <div><div className="text-[11px] text-slate-500 mb-0.5">Filled</div><div className="font-mono text-white text-sm">{state.filledPrice.toFixed(2)}</div></div>
              <div><div className="text-[11px] text-slate-500 mb-0.5">Lots</div><div className="font-mono text-white text-sm">{state.lots}</div></div>
              <div><div className="text-[11px] text-slate-500 mb-0.5">Risk</div><div className="font-mono text-amber-400 text-sm">{state.riskPercent}%</div></div>
            </div>
            <button onClick={onViewPosition} className="w-full h-11 rounded-lg bg-[#3B82F6] text-white font-semibold text-sm hover:bg-blue-600 active:bg-blue-700 transition-colors mb-2">View Position</button>
            <button onClick={onClose} className="text-slate-500 text-xs hover:text-slate-300 transition-colors">Close</button>
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
          <button key={d} onClick={() => onDirectionChange(d)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              direction === d
                ? d === 'BULLISH' ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                  : d === 'BEARISH' ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'bg-slate-700/50 text-slate-400 border border-transparent hover:bg-slate-700'
            }`}>{d === 'ALL' ? 'All' : d === 'BULLISH' ? 'Bullish' : 'Bearish'}</button>
        ))}
      </div>
    </div>
    <div className="mb-4">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Instrument</div>
      <div className="flex gap-2">
        {([
          { key: 'ALL', label: 'All' }, { key: 'N', label: 'NSE' },
          { key: 'M', label: 'MCX' }, { key: 'C', label: 'Currency' },
        ] as { key: ExchangeFilter; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => onExchangeChange(key)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              exchange === key
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'bg-slate-700/50 text-slate-400 border border-transparent hover:bg-slate-700'
            }`}>{label}</button>
        ))}
      </div>
    </div>
    <button onClick={onClose} className="w-full h-10 rounded-lg bg-[#3B82F6] text-white font-semibold text-sm hover:bg-blue-600 active:bg-blue-700 transition-colors">Apply</button>
    <div className="text-center mt-2">
      <button onClick={onReset} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Reset Filters</button>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   SORT DROPDOWN
   ═══════════════════════════════════════════════════════════════ */

const SORT_OPTIONS: { key: SortField; label: string }[] = [
  { key: 'timestamp', label: 'Recent' },
  { key: 'strength', label: 'Strength' },
  { key: 'confidence', label: 'Conviction' },
  { key: 'rr', label: 'R:R' },
  { key: 'time', label: 'Latest Trigger' },
];

const SortDropdown: React.FC<{
  current: SortField;
  onSelect: (f: SortField) => void;
  onClose: () => void;
}> = ({ current, onSelect, onClose }) => (
  <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 py-1 min-w-[180px] animate-slideDown">
    {SORT_OPTIONS.map(({ key, label }) => (
      <button key={key} onClick={() => { onSelect(key); onClose(); }}
        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
          current === key ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
        }`}>
        {label}
        {current === key && <Check className="w-3.5 h-3.5 inline ml-2 text-cyan-400" />}
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
      <Activity className="w-7 h-7 text-slate-600" />
    </div>
    <h3 className="text-white font-medium text-lg mb-1">No Signals Match</h3>
    <p className="text-slate-500 text-sm mb-5 max-w-xs">
      {hasFilters
        ? 'No MicroAlpha signals match your current filters. Try adjusting your criteria.'
        : 'Waiting for microstructure alpha signals...'}
    </p>
    {hasFilters && (
      <button onClick={onReset} className="px-5 py-2.5 rounded-lg bg-[#3B82F6] text-white font-medium text-sm hover:bg-blue-600 transition-colors">Reset Filters</button>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   MICROALPHA TRADING CARD
   ═══════════════════════════════════════════════════════════════ */

const MicroAlphaCard: React.FC<{
  sig: MicroAlphaSignal;
  plan: TradePlan;
  walletState: SlotWalletState;
  onBuy: (sig: MicroAlphaSignal, plan: TradePlan, lots: number) => void;
}> = ({ sig, plan, walletState, onBuy }) => {
  const [pressing, setPressing] = useState(false);
  const [showRevisedPopup, setShowRevisedPopup] = useState(false);
  const [revisedData, setRevisedData] = useState<any>(null);
  const [loadingRevised, setLoadingRevised] = useState(false);
  const [ltpDriftPct, setLtpDriftPct] = useState<number | null>(null);
  const isLong = sig.direction === 'BULLISH';

  const signalAgeMs = sig.triggerTimeEpoch ? Date.now() - sig.triggerTimeEpoch : 0;
  const isWithin30mWindow = signalAgeMs <= 30 * 60 * 1000;
  const isBeyond30mBoundary = !isWithin30mWindow;
  const isStale = ltpDriftPct !== null && ltpDriftPct > 10;

  const dirColor = isLong ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30';
  const buyBg = isLong ? 'bg-[#18C964]' : 'bg-[#FF4D6D]';
  const buyBgActive = isLong ? 'active:bg-[#15a854]' : 'active:bg-[#e6445f]';
  const buyHover = isLong ? 'hover:bg-[#16b85c]' : 'hover:bg-[#e84565]';
  const cardBorderGlow = isLong
    ? 'border-green-500/20 hover:border-green-500/40'
    : 'border-red-500/20 hover:border-red-500/40';

  const confidence = computeConfidence(sig);

  // Option: prefer real data from backend; check futures fallback for MCX
  const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
  const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
  const noDerivatives = sig.optionAvailable === false && !hasFutures;

  // Determine instrument mode: OPTION, FUTURES, or NONE
  let instrumentMode: 'OPTION' | 'FUTURES' | 'NONE' = 'NONE';
  let premium = 0;
  let displayInstrumentName = '';
  let lotSize = 1;

  if (hasRealOption) {
    instrumentMode = 'OPTION';
    premium = sig.optionLtp!;
    const displayStrike = sig.optionStrike ?? plan.strike;
    const displayOptionType = sig.optionType ?? plan.optionType;
    displayInstrumentName = `${sig.symbol || sig.scripCode} ${displayStrike} ${displayOptionType}`;
    lotSize = sig.optionLotSize ?? 1;
  } else if (hasFutures) {
    instrumentMode = 'FUTURES';
    premium = sig.futuresLtp!;
    const futExpiryMonth = (() => {
      if (!sig.futuresExpiry) return '';
      const parts = sig.futuresExpiry.split('-');
      if (parts.length < 2) return '';
      const monthIdx = parseInt(parts[1], 10) - 1;
      return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][monthIdx] ?? '';
    })();
    displayInstrumentName = `${sig.futuresSymbol ?? sig.symbol ?? sig.scripCode}${futExpiryMonth ? ' ' + futExpiryMonth : ''} FUT`;
    lotSize = sig.futuresLotSize ?? 1;
  } else if (!noDerivatives) {
    // Legacy fallback (old signals without optionAvailable field)
    instrumentMode = 'OPTION';
    premium = estimateOptionPremium(plan);
    displayInstrumentName = `${sig.symbol || sig.scripCode} ${plan.strike} ${plan.optionType}`;
    lotSize = 1;
  }

  const sizing = (instrumentMode === 'NONE')
    ? { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0, slotsUsed: 0, maxSlots: 0, exchangeFull: false }
    : computeSlotSizing(confidence, walletState, premium, lotSize, 1,
        (sig.exchange || 'N').substring(0, 1).toUpperCase(), sig.riskReward ?? 2.0, 12);

  // Periodic LTP drift check (every 30s) for stale badge
  const scripForDrift = sig.optionScripCode || '';
  const premiumForDrift = premium;
  useEffect(() => {
    if (!scripForDrift || premiumForDrift <= 0) return;
    const checkDrift = async () => {
      try {
        const res = await marketDataApi.getLtp(scripForDrift);
        if (res?.ltp && res.ltp > 0) {
          setLtpDriftPct(Math.abs(res.ltp - premiumForDrift) / premiumForDrift * 100);
        }
      } catch {}
    };
    checkDrift();
    const iv = setInterval(checkDrift, 30000);
    return () => clearInterval(iv);
  }, [scripForDrift, premiumForDrift]);

  // Sub-score callouts
  const weights = sig.modeWeights ?? {};
  const subScores = sig.subScores ?? {};
  const oiCallout = (sig.oiChangePercent && Math.abs(sig.oiChangePercent) > 0.5)
    ? `${sig.oiChangePercent > 0 ? '+' : ''}${sig.oiChangePercent.toFixed(1)}%` : undefined;
  const gammaCallout = (sig.maxPainDistPercent && Math.abs(sig.maxPainDistPercent) > 0.1)
    ? `${Math.abs(sig.maxPainDistPercent).toFixed(1)}% MP` : undefined;
  const optsCallout = sig.pcrValue ? `PCR ${sig.pcrValue.toFixed(2)}` : undefined;
  const blockCallout = (sig.blockCount && sig.blockCount > 0)
    ? `${sig.blockCount} deal${sig.blockCount > 1 ? 's' : ''}` : undefined;
  const volCallout = (sig.volumeXFactor && sig.volumeXFactor > 1.1)
    ? `${sig.volumeXFactor.toFixed(1)}\u00D7 vol` : undefined;

  // Smart inference
  const smartInference = buildSmartInference(sig);

  // Conviction color intensity
  const convColor = confidence >= 100 ? 'text-cyan-300 animate-pulse'
    : confidence >= 60 ? 'text-green-400' : confidence >= 30 ? 'text-amber-400' : 'text-slate-400';

  // Direction label for mode banner
  const dirLabel = sig.direction === 'BULLISH' ? 'Continue Bullish' : sig.direction === 'BEARISH' ? 'Continue Bearish' : 'Neutral';
  // Equity-equivalent position for banner (shares @ price = amount)
  const equityCapital = walletState.availableMargin * 0.50;
  const equityShares = sig.entryPrice > 0 ? Math.floor(equityCapital / sig.entryPrice) : 0;
  const equityAmount = equityShares * sig.entryPrice;
  const sharesLabel = equityShares > 0
    ? `${equityShares.toLocaleString('en-IN')} shares @ \u20B9${fmt(sig.entryPrice)}/- (\u20B9${Math.round(equityAmount).toLocaleString('en-IN')}/-)`
    : '';

  return (
    <div className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-clip transition-shadow duration-200 hover:shadow-lg`}>
      <div className="p-3 sm:p-4">

        {/* ── TOP: Symbol + Direction + Conviction + Time ── */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-white leading-tight">
              {sig.symbol || sig.scripCode}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xl font-bold font-mono ${convColor}`}>{confidence}%</span>
              <span className="text-slate-700">|</span>
              <span className="text-[11px] text-slate-500 font-mono">{formatTriggerTime(sig)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isNseNoTradeWindow(sig.exchange, sig.triggerTime) && (
              <span className="p-1 rounded-full bg-amber-500/15 border border-amber-500/30" title="NSE no-trade window (3:15–3:30 PM)">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
              </span>
            )}
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${dirColor}`}>
              {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isLong ? 'Bullish' : 'Bearish'}
            </span>
          </div>
        </div>

        {/* ── MODE BANNER (hero element) ── */}
        <div className={`mt-2 rounded-lg px-3 py-2 border ${getModeColor(sig.tradingMode)}`}>
          <div className="flex items-center gap-2">
            <span className="text-base">{getModeIcon(sig.tradingMode)}</span>
            <span className="font-bold text-sm tracking-wide">{getModeLabel(sig.tradingMode)}</span>
            <span className="text-slate-500 text-[10px]">|</span>
            <span className={`text-[11px] font-semibold ${isLong ? 'text-green-400' : 'text-red-400'}`}>
              {dirLabel}
            </span>
            {sharesLabel && (
              <>
                <span className="text-slate-500 text-[10px]">|</span>
                <span className="text-[11px] font-medium text-cyan-400">{sharesLabel}</span>
              </>
            )}
          </div>
          {sig.modeReason && (
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{sig.modeReason}</p>
          )}
        </div>

        {/* ── SMART INFERENCE ── */}
        {smartInference && (
          <div className="mt-2 px-3 py-2 bg-slate-900/60 rounded-lg border border-slate-700/50">
            <p className="text-[11px] text-slate-300 leading-relaxed">{smartInference}</p>
          </div>
        )}

        {/* ── SUB-SCORES (horizontal bars with weights) ── */}
        {sig.subScores && (
          <div className="mt-3 space-y-1">
            <SubScoreBar label="Flow" score={subScores.flow ?? 0} weight={weights.flow ?? 0} callout={volCallout} />
            <SubScoreBar label="OI" score={subScores.oi ?? 0} weight={weights.oi ?? 0} callout={oiCallout} />
            <SubScoreBar label="Gamma" score={subScores.gamma ?? 0} weight={weights.gamma ?? 0} callout={gammaCallout} />
            <SubScoreBar label="Options" score={subScores.options ?? 0} weight={weights.options ?? 0} callout={optsCallout} />
            <SubScoreBar label="Session" score={subScores.session ?? 0} weight={weights.session ?? 0} />
            <SubScoreBar label="Block" score={subScores.block ?? 0} weight={weights.block ?? 0} callout={blockCallout} />
          </div>
        )}

        {/* ── KEY X-FACTORS (quick-scan) ── */}
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {[
            { label: 'Block\u00D7', value: sig.blockCount ? `${sig.blockCount}` : 'DM', active: (sig.blockCount ?? 0) > 0 },
            { label: 'Vol\u00D7', value: sig.volumeXFactor ? `${sig.volumeXFactor.toFixed(1)}\u00D7` : 'DM', active: (sig.volumeXFactor ?? 1) > 1.1 },
            { label: 'OI\u0394%', value: sig.oiChangePercent ? `${sig.oiChangePercent > 0 ? '+' : ''}${sig.oiChangePercent.toFixed(1)}%` : 'DM', active: Math.abs(sig.oiChangePercent ?? 0) > 0.5 },
            { label: 'PCR', value: sig.pcrValue ? sig.pcrValue.toFixed(2) : 'DM', active: (sig.pcrValue ?? 0) > 0 },
          ].map(({ label, value, active }) => (
            <div key={label} className={`text-center py-1.5 rounded-lg ${active ? 'bg-slate-700/50' : 'bg-slate-800/30'}`}>
              <div className="text-[9px] text-slate-500 uppercase">{label}</div>
              <div className={`font-mono text-[11px] font-semibold ${active ? 'text-white' : 'text-slate-600 italic'}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── DATA QUALITY FLAGS ── */}
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {[
            { key: 'Orderbook', has: sig.hasOrderbook },
            { key: 'OI', has: sig.hasOI },
            { key: 'Options', has: sig.hasOptions },
            { key: 'Session', has: sig.hasSession },
          ].map(({ key, has }) => (
            <span key={key} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
              has ? 'bg-cyan-500/10 text-cyan-400' : 'bg-slate-700/30 text-slate-600'
            }`}>
              <span className="text-[9px]">{has ? '\u2713' : '\u2717'}</span>
              {key}
            </span>
          ))}
        </div>

        {/* ── SL / Entry / Targets ── */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-2">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">SL</span>
            <span className="font-mono text-sm font-semibold text-red-400">{fmt(plan.sl)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Entry</span>
            <span className="font-mono text-sm font-semibold text-white">{fmt(plan.entry)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">T1</span>
            <span className="font-mono text-sm font-semibold text-green-400">{fmt(plan.t1)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">T2</span>
            <span className="font-mono text-sm font-semibold text-green-400/80">{fmt(plan.t2)}</span>
          </div>
        </div>

        {/* ── R:R BAR ── */}
        <div className="mt-3">
          <RiskRewardBar rr={plan.rr} />
        </div>

        {/* ── GREEK METADATA (only when greekEnriched) ── */}
        {sig.greekEnriched && (
          <div className="mt-2 flex items-center gap-1 flex-wrap">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30">
              Greek
            </span>
            <span className="text-[9px] font-mono text-slate-400">
              {'\u03B4'} {(sig.greekDelta ?? 0).toFixed(2)}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-[9px] font-mono text-slate-400">
              {'\u03B3'} {(sig.greekGamma ?? 0).toFixed(3)}
            </span>
            <span className="text-slate-600">|</span>
            <span className={`text-[9px] font-mono ${(sig.greekTheta ?? 0) < -3 ? 'text-red-400' : 'text-slate-400'}`}>
              {'\u03B8'} {(sig.greekTheta ?? 0).toFixed(1)}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-[9px] font-mono text-slate-400">
              IV {((sig.greekIV ?? 0) * 100).toFixed(0)}%
            </span>
            <span className="text-slate-600">|</span>
            <span className={`text-[9px] font-mono ${(sig.greekDte ?? 0) <= 2 ? 'text-red-400 font-bold' : 'text-slate-400'}`}>
              DTE {sig.greekDte ?? 0}
            </span>
            {sig.optionRR != null && sig.optionRR > 0 && (
              <>
                <span className="text-slate-600">|</span>
                <span className="text-[9px] font-mono text-emerald-400">
                  R:R {sig.optionRR.toFixed(1)}
                </span>
              </>
            )}
            {sig.greekThetaImpaired && (
              <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                {'\u03B8'}-IMPAIRED
              </span>
            )}
          </div>
        )}

        {/* ── INSUFFICIENT FUNDS LABEL ── */}
        {sizing.insufficientFunds && !sizing.disabled && (
          <div className="mt-3 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <span className="text-[11px] text-orange-400">Insufficient Funds — forced 1 lot (need +&#8377;{sizing.creditAmount.toLocaleString('en-IN')})</span>
          </div>
        )}

        {/* ── BUY BUTTON ── */}
        {instrumentMode === 'NONE' ? (
          <button
            disabled
            className="w-full h-12 rounded-xl mt-4 text-slate-500 font-semibold text-sm bg-slate-700/30 border border-slate-600/30 cursor-not-allowed"
          >
            No Derivatives Available for {sig.symbol || sig.scripCode}
          </button>
        ) : sizing.disabled ? (
          <button
            disabled
            className="w-full h-12 rounded-xl mt-4 text-slate-400 font-semibold text-sm bg-slate-700/50 cursor-not-allowed"
          >
            Conviction {confidence}% &lt; 12% — No Trade
          </button>
        ) : (
          <div className="relative mt-4">
            <button
              onClick={async () => {
                if ((isBeyond30mBoundary || (isWithin30mWindow && isStale)) && instrumentMode === 'OPTION' && sig.optionScripCode) {
                  setLoadingRevised(true);
                  try {
                    const ltpRes = await marketDataApi.getLtp(sig.optionScripCode);
                    const currentLtp = ltpRes?.ltp;
                    if (currentLtp && currentLtp > 0) {
                      const eqEntry = plan.entry || sig.entryPrice || 0;
                      const eqSl = plan.sl || 0;
                      const eqT1 = plan.t1 || 0;
                      const eqT2 = plan.t2 || 0;
                      const eqT3 = plan.t3 || 0;
                      const revised = await greeksApi.compute({
                        spot: eqEntry,
                        strike: plan.strike || sig.optionStrike || 0,
                        optionLtp: currentLtp,
                        optionType: plan.optionType || 'CE',
                        expiry: sig.optionExpiry || '',
                        equityEntry: eqEntry,
                        equitySl: eqSl,
                        equityT1: eqT1,
                        equityT2: eqT2,
                        equityT3: eqT3,
                        equityT4: 0,
                      });
                      setRevisedData({ ...revised, currentLtp, originalLtp: premium, signalAge: Math.round(signalAgeMs / 60000), slotsFullOverride: sizing.exchangeFull });
                      setShowRevisedPopup(true);
                    } else {
                      if (sizing.exchangeFull) {
                        if (window.confirm(`Exchange slots are full (${sizing.maxSlots}/${sizing.maxSlots}). Manual override — proceed?`)) onBuy(sig, plan, sizing.lots);
                      } else {
                        onBuy(sig, plan, sizing.lots);
                      }
                    }
                  } catch (e) {
                    console.error('Greeks compute failed:', e);
                    onBuy(sig, plan, sizing.lots);
                  } finally {
                    setLoadingRevised(false);
                  }
                } else if (sizing.exchangeFull) {
                  if (window.confirm(`Exchange slots are full (${sizing.maxSlots}/${sizing.maxSlots}). Manual override — proceed?`)) onBuy(sig, plan, sizing.lots);
                } else {
                  onBuy(sig, plan, sizing.lots);
                }
              }}
              onMouseDown={() => setPressing(true)}
              onMouseUp={() => setPressing(false)}
              onMouseLeave={() => setPressing(false)}
              disabled={loadingRevised}
              className={`w-full h-12 rounded-xl text-white font-semibold text-sm
                transition-all duration-100 select-none
                ${isBeyond30mBoundary
                  ? (isLong ? 'bg-[#18C964]/40 hover:bg-[#18C964]/60' : 'bg-[#FF4D6D]/40 hover:bg-[#FF4D6D]/60')
                  : `${buyBg} ${buyHover} ${buyBgActive}`}
                ${pressing ? 'scale-[0.98] brightness-90' : 'scale-100'}`}
            >
              <span className="flex items-center justify-center gap-2">
                {isStale && isWithin30mWindow && <span className="text-yellow-300 text-base animate-pulse" title={`LTP drifted ${ltpDriftPct?.toFixed(1)}% from signal`}>⚠</span>}
                {sizing.exchangeFull && !isBeyond30mBoundary && <span className="text-[10px] text-amber-300 bg-amber-500/20 px-1 rounded">SLOTS FULL</span>}
                {loadingRevised ? 'Computing...' : (
                  <>{instrumentMode === 'OPTION' ? 'BUY' : (isLong ? 'BUY' : 'SELL')} {displayInstrumentName} @ &#8377;{fmt(premium)}/- x {sizing.lots} lot{sizing.lots > 1 ? 's' : ''}</>
                )}
              </span>
            </button>

            {showRevisedPopup && revisedData && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowRevisedPopup(false)}>
                <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-white mb-1">Revised Trade Levels</h3>
                  <p className="text-xs text-slate-400 mb-4">Signal is {revisedData.signalAge}m old — levels recomputed with current LTP</p>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-slate-700/50 rounded-lg p-3">
                      <div className="text-[10px] text-slate-500 mb-1">Signal LTP</div>
                      <div className="text-sm font-bold text-slate-300">&#8377;{fmt(revisedData.originalLtp)}</div>
                    </div>
                    <div className={`rounded-lg p-3 ${revisedData.currentLtp > revisedData.originalLtp ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                      <div className="text-[10px] text-slate-500 mb-1">Current LTP</div>
                      <div className={`text-sm font-bold ${revisedData.currentLtp > revisedData.originalLtp ? 'text-green-400' : 'text-red-400'}`}>
                        &#8377;{fmt(revisedData.currentLtp)} ({((revisedData.currentLtp - revisedData.originalLtp) / revisedData.originalLtp * 100).toFixed(1)}%)
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-4 text-sm">
                    <div className="flex justify-between"><span className="text-slate-400">SL</span><span className="text-red-400 font-medium">&#8377;{fmt(revisedData.optionSL)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">T1</span><span className="text-green-400 font-medium">&#8377;{fmt(revisedData.optionT1)}</span></div>
                    {revisedData.optionT2 > 0 && <div className="flex justify-between"><span className="text-slate-400">T2</span><span className="text-green-400 font-medium">&#8377;{fmt(revisedData.optionT2)}</span></div>}
                    {revisedData.optionT3 > 0 && <div className="flex justify-between"><span className="text-slate-400">T3</span><span className="text-green-400 font-medium">&#8377;{fmt(revisedData.optionT3)}</span></div>}
                    {revisedData.optionT4 > 0 && <div className="flex justify-between"><span className="text-slate-400">T4</span><span className="text-green-400 font-medium">&#8377;{fmt(revisedData.optionT4)}</span></div>}
                    <div className="flex justify-between"><span className="text-slate-400">R:R</span><span className="text-blue-400 font-medium">{revisedData.optionRR.toFixed(1)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Greeks</span><span className="text-violet-400 font-medium text-xs">δ{revisedData.delta.toFixed(2)} γ{revisedData.gamma.toFixed(3)} θ{revisedData.theta.toFixed(1)} IV{revisedData.iv.toFixed(0)}%</span></div>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => setShowRevisedPopup(false)}
                      className="flex-1 h-10 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-sm transition-colors">
                      Cancel
                    </button>
                    <button onClick={() => {
                      setShowRevisedPopup(false);
                      onBuy(sig, { ...plan, sl: revisedData.optionSL, t1: revisedData.optionT1, t2: revisedData.optionT2, t3: revisedData.optionT3, entry: revisedData.currentLtp }, sizing.lots);
                    }} className={`flex-1 h-10 rounded-xl text-white font-semibold text-sm transition-colors ${buyBg} ${buyHover}`}>
                      Execute @ &#8377;{fmt(revisedData.currentLtp)}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN: MICROALPHA TAB CONTENT
   ═══════════════════════════════════════════════════════════════ */

export const MicroAlphaTabContent: React.FC<MicroAlphaTabContentProps> = ({ autoRefresh = true }) => {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<MicroAlphaSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL');
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [execution, setExecution] = useState<ExecutionState>({
    visible: false, symbol: '', optionName: '', strike: 0,
    optionType: 'CE', lots: 3, filledPrice: 0, riskPercent: 0,
    status: 'sending',
  });
  const [walletState, setWalletState] = useState<SlotWalletState>({
    availableMargin: 100000, usedMargin: 0, currentBalance: 100000,
    openPositionCount: 0, positionsByExchange: { N: 0, M: 0, C: 0 },
  });
  const [stalePriceCheck, setStalePriceCheck] = useState<{
    result: StalePriceResult;
    instrumentName: string;
    originalSl: number;
    originalTargets: { t1: number | null; t2: number | null; t3: number | null; t4: number | null };
    pendingBuy: () => void;
  } | null>(null);

  const fetchSignals = useCallback(async () => {
    try {
      const data = await fetchJson<MicroAlphaSignal[]>('/strategy-state/microalpha/history/list');
      if (Array.isArray(data)) {
        setSignals(data);
      }
    } catch (err) {
      console.error('Error fetching MicroAlpha signals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals(); // Initial full history load
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchSignals, 60000); // 60s fallback safety net
    }
    // WebSocket push: prepend new triggered signals in real-time
    const onWsSignal = (e: Event) => {
      const sig = (e as CustomEvent).detail;
      if (sig && sig.scripCode) {
        setSignals(prev => {
          if (prev.some(s => s.scripCode === sig.scripCode && s.triggerTimeEpoch === sig.triggerTimeEpoch)) return prev;
          return [sig, ...prev];
        });
      }
    };
    window.addEventListener('microalpha-signal', onWsSignal);
    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener('microalpha-signal', onWsSignal);
    };
  }, [autoRefresh, fetchSignals]);

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

  // Fetch wallet state for slot-based sizing
  useEffect(() => {
    const fetchCapital = async () => {
      try {
        const data = await strategyWalletsApi.getCapital('MICROALPHA');
        if (data?.currentCapital != null) setWalletState({
          availableMargin: data.availableMargin ?? data.currentCapital,
          usedMargin: data.usedMargin ?? 0,
          currentBalance: data.currentCapital,
          openPositionCount: data.openPositionCount ?? 0,
          positionsByExchange: data.positionsByExchange ?? { N: 0, M: 0, C: 0 },
        });
      } catch { /* ignore */ }
    };
    fetchCapital();
    const interval = setInterval(fetchCapital, 30000);
    const onWalletUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.strategy === 'MICROALPHA') fetchCapital();
    };
    window.addEventListener('wallet-update', onWalletUpdate);
    return () => { clearInterval(interval); window.removeEventListener('wallet-update', onWalletUpdate); };
  }, []);

  /* ── FILTER ── */
  const hasActiveFilter = directionFilter !== 'ALL' || exchangeFilter !== 'ALL';

  let filtered = signals.filter(s => s.triggered);
  if (directionFilter !== 'ALL') {
    filtered = filtered.filter(s => s.direction === directionFilter);
  }
  if (exchangeFilter !== 'ALL') {
    filtered = filtered.filter(s => s.exchange === exchangeFilter);
  }

  /* ── ENRICH WITH TRADE PLANS ── */
  const enriched = filtered.map(sig => ({ sig, plan: extractTradePlan(sig) }));

  /* ── SORT ── */
  const sorted = [...enriched].sort((a, b) => {
    switch (sortField) {
      case 'strength':
        return computeStrength(b.sig, b.plan) - computeStrength(a.sig, a.plan) || getEpoch(b.sig) - getEpoch(a.sig);
      case 'confidence':
        return computeConfidence(b.sig) - computeConfidence(a.sig) || getEpoch(b.sig) - getEpoch(a.sig);
      case 'rr':
        return b.plan.rr - a.plan.rr || getEpoch(b.sig) - getEpoch(a.sig);
      case 'time':
      case 'timestamp':
        return getEpoch(b.sig) - getEpoch(a.sig);
      default:
        return 0;
    }
  });

  const sortLabel = SORT_OPTIONS.find(o => o.key === sortField)?.label || 'Recent';

  /* ── EXECUTE TRADE (inner) — builds request and sends to backend ── */
  const executeTrade = useCallback(async (
    sig: MicroAlphaSignal, plan: TradePlan, lots: number,
    overrideEntry?: number, overrideSl?: number,
    overrideT1?: number | null, overrideT2?: number | null,
    overrideT3?: number | null, _overrideT4?: number | null
  ) => {
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;

    let premium: number;
    let instrumentType: 'OPTION' | 'FUTURES';
    let instrumentSymbol: string;
    let tradingScripCode: string;
    let lotSize: number;
    let displayStrike: number;
    let displayOptionType: string;
    let exchange: string;

    if (hasRealOption) {
      instrumentType = 'OPTION';
      premium = sig.optionLtp!;
      displayStrike = sig.optionStrike ?? plan.strike;
      displayOptionType = sig.optionType ?? plan.optionType;
      instrumentSymbol = `${sig.symbol || sig.scripCode} ${displayStrike} ${displayOptionType}`;
      lotSize = sig.optionLotSize ?? 1;
      tradingScripCode = sig.optionScripCode ?? sig.scripCode;
      exchange = sig.optionExchange ?? sig.exchange;
    } else if (hasFutures) {
      instrumentType = 'FUTURES';
      premium = sig.futuresLtp!;
      displayStrike = 0;
      displayOptionType = plan.optionType;
      const futMonth = (() => {
        if (!sig.futuresExpiry) return '';
        const parts = sig.futuresExpiry.split('-');
        if (parts.length < 2) return '';
        const mi = parseInt(parts[1], 10) - 1;
        return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][mi] ?? '';
      })();
      instrumentSymbol = `${sig.futuresSymbol ?? sig.symbol ?? sig.scripCode}${futMonth ? ' ' + futMonth : ''} FUT`;
      lotSize = sig.futuresLotSize ?? 1;
      tradingScripCode = sig.futuresScripCode ?? sig.scripCode;
      exchange = sig.futuresExchange ?? sig.exchange;
    } else {
      instrumentType = 'OPTION';
      premium = estimateOptionPremium(plan);
      displayStrike = plan.strike;
      displayOptionType = plan.optionType;
      instrumentSymbol = `${sig.symbol || sig.scripCode} ${plan.strike} ${plan.optionType ?? ''}`;
      lotSize = 1;
      tradingScripCode = sig.scripCode;
      exchange = sig.exchange;
    }

    const entryPrice = overrideEntry ?? premium;

    setExecution({
      visible: true,
      symbol: sig.symbol || sig.scripCode,
      optionName: instrumentSymbol,
      strike: displayStrike,
      optionType: displayOptionType as 'CE' | 'PE',
      lots,
      filledPrice: entryPrice,
      riskPercent: 0.8,
      status: 'sending',
    });

    try {
      let tradeSl: number;
      let tradeT1: number;
      let tradeT2: number;
      let tradeT3: number;
      let delta: number;

      if (instrumentType === 'OPTION') {
        const optType = (displayOptionType === 'CE' || displayOptionType === 'PE') ? displayOptionType : plan.optionType;
        const mapped = mapToOptionLevels(
          premium, plan.entry, plan.sl,
          [plan.t1, plan.t2, plan.t3],
          displayStrike, optType
        );
        tradeSl = mapped.sl;
        tradeT1 = mapped.targets[0] ?? 0;
        tradeT2 = mapped.targets[1] ?? 0;
        tradeT3 = mapped.targets[2] ?? 0;
        delta = mapped.delta;
      } else {
        delta = 1.0;
        tradeSl = plan.sl;
        tradeT1 = plan.t1;
        tradeT2 = plan.t2;
        tradeT3 = plan.t3 ?? 0;
      }

      if (overrideSl != null) tradeSl = overrideSl;
      if (overrideT1 !== undefined) tradeT1 = overrideT1 ?? 0;
      if (overrideT2 !== undefined) tradeT2 = overrideT2 ?? 0;
      if (overrideT3 !== undefined) tradeT3 = overrideT3 ?? 0;

      const req: StrategyTradeRequest = {
        scripCode: tradingScripCode,
        instrumentSymbol,
        instrumentType,
        underlyingScripCode: sig.scripCode,
        underlyingSymbol: sig.symbol || sig.scripCode,
        side: instrumentType === 'OPTION' ? 'BUY' : (sig.direction === 'BULLISH' ? 'BUY' : 'SELL'),
        quantity: lots * lotSize,
        lots,
        lotSize,
        multiplier: 1,
        entryPrice,
        sl: tradeSl,
        t1: tradeT1,
        t2: tradeT2,
        t3: tradeT3,
        t4: 0,
        equitySpot: plan.entry,
        equitySl: plan.sl,
        equityT1: plan.t1,
        equityT2: plan.t2,
        equityT3: plan.t3 ?? 0,
        equityT4: 0,
        delta,
        optionType: (displayOptionType === 'CE' || displayOptionType === 'PE') ? displayOptionType : undefined,
        strike: displayStrike,
        strategy: 'MICROALPHA',
        exchange,
        direction: sig.direction as 'BULLISH' | 'BEARISH',
        confidence: computeConfidence(sig),
        executionMode: 'MANUAL',
      };

      const result = await strategyTradesApi.create(req);

      if (result?.success) {
        setExecution(prev => ({
          ...prev,
          status: 'filled',
          filledPrice: result?.entryPrice ?? entryPrice,
          orderId: result?.tradeId,
          riskPercent: plan.sl && sig.entryPrice
            ? Math.round(Math.abs(sig.entryPrice - plan.sl) / sig.entryPrice * 100 * 10) / 10
            : 0.8,
        }));
      } else {
        setExecution(prev => ({
          ...prev,
          status: 'error',
          errorMessage: result.error || 'Trade creation failed',
        }));
      }
    } catch (err) {
      setExecution(prev => ({
        ...prev,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Order failed',
      }));
    }
  }, []);

  /* ── BUY HANDLER — stale price check then dispatch ── */
  const handleBuy = useCallback(async (sig: MicroAlphaSignal, plan: TradePlan, lots: number) => {
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
    const ltpScripCode = hasRealOption ? (sig.optionScripCode ?? sig.scripCode)
      : hasFutures ? (sig.futuresScripCode ?? sig.scripCode)
      : sig.scripCode;
    const instrumentName = hasRealOption
      ? `${sig.symbol} ${sig.optionStrike ?? plan.strike} ${sig.optionType ?? plan.optionType}`
      : hasFutures ? `${sig.futuresSymbol ?? sig.symbol} FUT`
      : sig.symbol;

    let tradeSl = plan.sl;
    let tradeT1: number | null = plan.t1;
    let tradeT2: number | null = plan.t2;
    let tradeT3 = plan.t3;

    if (hasRealOption) {
      const optType = (sig.optionType === 'CE' || sig.optionType === 'PE') ? sig.optionType : plan.optionType;
      const mapped = mapToOptionLevels(
        sig.optionLtp!, plan.entry, plan.sl,
        [plan.t1, plan.t2, plan.t3],
        sig.optionStrike ?? plan.strike, optType
      );
      tradeSl = mapped.sl;
      tradeT1 = mapped.targets[0] ?? null;
      tradeT2 = mapped.targets[1] ?? null;
      tradeT3 = mapped.targets[2] ?? null;
    }

    try {
      const ltpData = await marketDataApi.getLtp(ltpScripCode);
      if (ltpData?.ltp != null && ltpData.ltp > 0) {
        const currentLtp = ltpData.ltp;
        const staleCheck = checkStalePriceAdjustment(currentLtp, tradeSl, tradeT1, tradeT2, tradeT3, null);

        if (staleCheck) {
          setStalePriceCheck({
            result: staleCheck,
            instrumentName,
            originalSl: tradeSl,
            originalTargets: { t1: tradeT1, t2: tradeT2, t3: tradeT3, t4: null },
            pendingBuy: () => {
              if (staleCheck.type === 'below-sl') {
                executeTrade(sig, plan, lots, currentLtp);
              } else {
                executeTrade(sig, plan, lots, currentLtp,
                  staleCheck.adjustedSl, staleCheck.adjustedT1, staleCheck.adjustedT2,
                  staleCheck.adjustedT3, staleCheck.adjustedT4);
              }
            },
          });
          return;
        }

        executeTrade(sig, plan, lots, currentLtp);
        return;
      }
    } catch {
      // LTP fetch failed — proceed with original price
    }

    executeTrade(sig, plan, lots);
  }, [executeTrade]);

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
      {/* ── STICKY HEADER ── */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50">
        <div className="flex items-center justify-between h-14 px-2 sm:px-4">
          <h1 className="text-lg font-semibold text-cyan-400 tracking-tight">MICROALPHA</h1>
          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => { e.stopPropagation(); setShowFilter(!showFilter); setShowSort(false); }}
                className={`relative p-2 rounded-lg transition-colors ${
                  hasActiveFilter
                    ? 'bg-cyan-500/15 text-cyan-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Filter className="w-5 h-5" />
                {hasActiveFilter && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-cyan-400" />
                )}
              </button>
              {showFilter && (
                <FilterDropdown
                  direction={directionFilter} exchange={exchangeFilter}
                  onDirectionChange={setDirectionFilter} onExchangeChange={setExchangeFilter}
                  onClose={() => setShowFilter(false)} onReset={resetFilters}
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
        <div className="px-2 sm:px-4 pb-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/80 text-[12px] text-slate-400 border border-slate-700/50">
            Sorted by {sortLabel}
          </span>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="pt-4 pb-8">
        {loading && signals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mb-4" />
            <span className="text-slate-500 text-sm">Loading MicroAlpha signals...</span>
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} onReset={resetFilters} />
        )}

        {sorted.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <MicroAlphaCard
                key={`${sig.scripCode}-${getEpoch(sig)}`}
                sig={sig}
                plan={plan}
                walletState={walletState}
                onBuy={handleBuy}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── EXECUTION OVERLAY ── */}
      <ExecutionOverlay
        state={execution}
        onClose={() => setExecution(s => ({ ...s, visible: false }))}
        onViewPosition={() => {
          setExecution(s => ({ ...s, visible: false }));
          navigate('/wallets');
        }}
      />

      {/* ── STALE PRICE CHECK MODAL ── */}
      {stalePriceCheck && (
        <StalePriceModal
          type={stalePriceCheck.result.type}
          currentLtp={stalePriceCheck.result.currentLtp}
          originalEntry={stalePriceCheck.result.currentLtp}
          originalSl={stalePriceCheck.originalSl}
          originalTargets={stalePriceCheck.originalTargets}
          adjustedSl={stalePriceCheck.result.adjustedSl}
          adjustedTargets={{
            t1: stalePriceCheck.result.adjustedT1,
            t2: stalePriceCheck.result.adjustedT2,
            t3: stalePriceCheck.result.adjustedT3,
            t4: stalePriceCheck.result.adjustedT4,
          }}
          levelsShifted={stalePriceCheck.result.levelsShifted}
          instrumentName={stalePriceCheck.instrumentName}
          onCancel={() => setStalePriceCheck(null)}
          onProceed={() => {
            stalePriceCheck.pendingBuy();
            setStalePriceCheck(null);
          }}
        />
      )}
    </div>
  );
};

export default MicroAlphaTabContent;
