import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, AlertTriangle, Loader2, Activity
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchJson, strategyWalletsApi, strategyTradesApi } from '../../services/api';
import type { StrategyTradeRequest } from '../../types/orders';

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

function fmt(v: number): string {
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
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
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
  const { strike, interval } = getOTMStrike(sig.entryPrice, sig.direction);

  const risk = Math.abs(sig.entryPrice - sig.stopLoss);
  const atr = risk > 0 ? risk : sig.entryPrice * 0.004;

  const t1 = sig.target;
  const t2 = isLong ? sig.entryPrice + risk * 3 : sig.entryPrice - risk * 3;
  const t3 = isLong ? sig.entryPrice + risk * 4 : sig.entryPrice - risk * 4;

  return {
    entry: sig.entryPrice,
    sl: sig.stopLoss,
    t1, t2, t3,
    rr: sig.riskReward,
    atr,
    optionType,
    strike,
    strikeInterval: interval,
  };
}

/** Confidence from absConviction (already 0-100 scale) */
function computeConfidence(sig: MicroAlphaSignal): number {
  return Math.min(97, Math.max(40, Math.round(sig.absConviction)));
}

/** Composite strength score */
function computeStrength(sig: MicroAlphaSignal, plan: TradePlan): number {
  const conf = computeConfidence(sig);
  const rr = plan.rr;
  const confNorm = ((conf - 40) / 57) * 50;
  const rrNorm = Math.min(50, (rr / 4) * 50);
  return Math.min(100, Math.round(confNorm + rrNorm));
}

/** Compute lot sizing based on confidence and wallet capital */
function computeLotSizing(
  confidence: number,
  walletCapital: number,
  optionLtp: number,
  lotSize: number
): { lots: number; quantity: number; disabled: boolean; insufficientFunds: boolean; creditAmount: number; allocPct: number } {
  if (confidence < 60) {
    return { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0 };
  }
  const allocPct = confidence > 75 ? 0.75 : 0.50;
  const allocatedCapital = walletCapital * allocPct;
  const costPerLot = optionLtp * lotSize;
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
    case 'TREND_FOLLOWING': return 'Trend';
    case 'MEAN_REVERSION': return 'Reversion';
    case 'BREAKOUT_AWAITING': return 'Breakout';
    default: return mode;
  }
}

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
        }`}>R:R 1:{rr.toFixed(1)}</span>
        <span className="text-[11px] text-slate-500">Reward</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   METRICS CHIP
   ═══════════════════════════════════════════════════════════════ */

const MetricsChip: React.FC<{ label: string; value: string; accent?: string; bold?: boolean }> = ({ label, value, accent, bold }) => (
  <div className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono
    ${accent || 'bg-slate-700/50 text-slate-300'}`}>
    <span className="text-slate-500 text-[10px]">{label}</span>
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
  <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 p-4 min-w-[260px] animate-slideDown">
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
  walletCapital: number;
  onBuy: (sig: MicroAlphaSignal, plan: TradePlan, lots: number) => void;
}> = ({ sig, plan, walletCapital, onBuy }) => {
  const [pressing, setPressing] = useState(false);
  const isLong = sig.direction === 'BULLISH';

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
    displayInstrumentName = `${sig.futuresSymbol ?? sig.symbol ?? sig.scripCode} FUT${sig.futuresExpiry ? ' ' + sig.futuresExpiry : ''}`;
    lotSize = sig.futuresLotSize ?? 1;
  } else if (!noDerivatives) {
    // Legacy fallback (old signals without optionAvailable field)
    instrumentMode = 'OPTION';
    premium = estimateOptionPremium(plan);
    displayInstrumentName = `${sig.symbol || sig.scripCode} ${plan.strike} ${plan.optionType}`;
    lotSize = 1;
  }

  const sizing = (instrumentMode === 'NONE')
    ? { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0 }
    : computeLotSizing(confidence, walletCapital, premium, lotSize);

  return (
    <div className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-hidden transition-all duration-200 hover:shadow-lg mx-4 md:mx-0`}>
      <div className="p-4">

        {/* ── TOP SECTION ── */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-white leading-tight">
              {sig.symbol || sig.scripCode}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-500">
                Conviction <span className="font-mono text-slate-400">{confidence}%</span>
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-xs text-slate-500 font-mono">{formatTriggerTime(sig)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getModeColor(sig.tradingMode)}`}>
              {getModeLabel(sig.tradingMode)}
            </span>
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${dirColor}`}>
              {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isLong ? 'Bullish' : 'Bearish'}
            </span>
          </div>
        </div>

        {/* ── SUB-SCORES BREAKDOWN ── */}
        {sig.subScores && (
          <div className="mt-3 bg-slate-900/50 rounded-lg p-2.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
              <Activity className="w-3 h-3 text-cyan-400" />
              Sub-Scores
            </div>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {Object.entries(sig.subScores).map(([key, val]) => (
                <div key={key}>
                  <div className="text-[10px] text-slate-500 capitalize">{key}</div>
                  <div className={`font-mono text-xs font-semibold ${
                    val > 0.5 ? 'text-green-400' : val < -0.5 ? 'text-red-400' : 'text-slate-400'
                  }`}>{typeof val === 'number' ? val.toFixed(1) : val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── DATA QUALITY FLAGS ── */}
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {[
            { key: 'Orderbook', has: sig.hasOrderbook },
            { key: 'OI', has: sig.hasOI },
            { key: 'Options', has: sig.hasOptions },
            { key: 'Session', has: sig.hasSession },
          ].map(({ key, has }) => (
            <span key={key} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              has ? 'bg-cyan-500/10 text-cyan-400' : 'bg-slate-700/30 text-slate-600'
            }`}>{key}</span>
          ))}
        </div>

        {/* ── SL / Entry / Targets ── */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
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

        {/* ── METRICS ROW ── */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 custom-scrollbar -mx-1 px-1">
          <MetricsChip label="Conv" value={`${sig.absConviction.toFixed(0)}%`} bold accent="bg-cyan-500/15 text-cyan-300" />
          <MetricsChip label="Score" value={sig.score.toFixed(1)} />
          <MetricsChip label="Mode" value={getModeLabel(sig.tradingMode)} />
        </div>

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
            Conviction {confidence}% &lt; 60% — No Trade
          </button>
        ) : (
          <button
            onClick={() => onBuy(sig, plan, sizing.lots)}
            onMouseDown={() => setPressing(true)}
            onMouseUp={() => setPressing(false)}
            onMouseLeave={() => setPressing(false)}
            className={`w-full h-12 rounded-xl mt-4 text-white font-semibold text-sm
              transition-all duration-100 select-none
              ${buyBg} ${buyHover} ${buyBgActive}
              ${pressing ? 'scale-[0.98] brightness-90' : 'scale-100'}`}
          >
            BUY {displayInstrumentName} @ &#8377;{fmt(premium)}/- x {sizing.lots} lot{sizing.lots > 1 ? 's' : ''}
          </button>
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
  const [walletCapital, setWalletCapital] = useState<number>(100000);

  const fetchSignals = useCallback(async () => {
    try {
      const data = await fetchJson<MicroAlphaSignal[]>('/strategy-state/microalpha/history/list');
      if (data) {
        setSignals(data);
      }
    } catch (err) {
      console.error('Error fetching MicroAlpha signals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchSignals, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
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

  // Fetch wallet capital for lot sizing
  useEffect(() => {
    const fetchCapital = async () => {
      try {
        const data = await strategyWalletsApi.getCapital('MICROALPHA');
        if (data?.currentCapital != null) setWalletCapital(data.currentCapital);
      } catch { /* ignore */ }
    };
    fetchCapital();
    const interval = setInterval(fetchCapital, 30000);
    return () => clearInterval(interval);
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

  /* ── BUY HANDLER — dispatches to strategy trade execution ── */
  const handleBuy = useCallback(async (sig: MicroAlphaSignal, plan: TradePlan, lots: number) => {
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;

    // Determine instrument details
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
      instrumentSymbol = `${sig.futuresSymbol ?? sig.symbol ?? sig.scripCode} FUT${sig.futuresExpiry ? ' ' + sig.futuresExpiry : ''}`;
      lotSize = sig.futuresLotSize ?? 1;
      tradingScripCode = sig.futuresScripCode ?? sig.scripCode;
      exchange = sig.futuresExchange ?? sig.exchange;
    } else {
      // Legacy fallback
      instrumentType = 'OPTION';
      premium = estimateOptionPremium(plan);
      displayStrike = plan.strike;
      displayOptionType = plan.optionType;
      instrumentSymbol = `${sig.symbol || sig.scripCode} ${plan.strike} ${plan.optionType}`;
      lotSize = 1;
      tradingScripCode = sig.scripCode;
      exchange = sig.exchange;
    }

    setExecution({
      visible: true,
      symbol: sig.symbol || sig.scripCode,
      optionName: instrumentSymbol,
      strike: displayStrike,
      optionType: displayOptionType as 'CE' | 'PE',
      lots,
      filledPrice: premium,
      riskPercent: 0.8,
      status: 'sending',
    });

    try {
      // Compute delta-mapped levels for options; for futures use delta=1.0
      let tradeSl: number;
      let tradeT1: number;
      let tradeT2: number;
      let tradeT3: number;
      let delta: number;

      if (instrumentType === 'OPTION') {
        const optType = (displayOptionType === 'CE' || displayOptionType === 'PE') ? displayOptionType : plan.optionType;
        const mapped = mapToOptionLevels(
          premium,
          plan.entry,
          plan.sl,
          [plan.t1, plan.t2, plan.t3],
          displayStrike,
          optType
        );
        tradeSl = mapped.sl;
        tradeT1 = mapped.targets[0] ?? 0;
        tradeT2 = mapped.targets[1] ?? 0;
        tradeT3 = mapped.targets[2] ?? 0;
        delta = mapped.delta;
      } else {
        // Futures: delta = 1.0, use equity levels directly
        delta = 1.0;
        tradeSl = plan.sl;
        tradeT1 = plan.t1;
        tradeT2 = plan.t2;
        tradeT3 = plan.t3 ?? 0;
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
        multiplier: 1,
        entryPrice: premium,
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
      };

      const result = await strategyTradesApi.create(req);

      if (result.success) {
        setExecution(prev => ({
          ...prev,
          status: 'filled',
          filledPrice: result.entryPrice ?? premium,
          orderId: result.tradeId,
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
        <div className="flex items-center justify-between h-14 px-4">
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
        <div className="px-4 pb-2">
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
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <MicroAlphaCard
                key={`${sig.scripCode}-${getEpoch(sig)}`}
                sig={sig}
                plan={plan}
                walletCapital={walletCapital}
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
    </div>
  );
};

export default MicroAlphaTabContent;
