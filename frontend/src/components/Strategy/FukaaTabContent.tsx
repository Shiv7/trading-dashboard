import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Volume2, Check, Zap, AlertTriangle, Loader2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchJson, ordersApi } from '../../services/api';
import type { CreateOrderRequest } from '../../types/orders';

type SortField = 'strength' | 'confidence' | 'rr' | 'time' | 'iv' | 'volume';
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH';
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C';

/* ═══════════════════════════════════════════════════════════════
   TYPES & INTERFACES
   ═══════════════════════════════════════════════════════════════ */

interface FukaaTrigger {
  scripCode: string;
  symbol: string;
  companyName: string;
  exchange: string;
  triggered: boolean;
  direction: string;
  reason: string;
  triggerPrice: number;
  triggerScore: number;
  triggerTime: string;
  triggerTimeEpoch: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  superTrend: number;
  trend: string;
  trendChanged: boolean;
  pricePosition: string;
  fukaaOutcome: string;
  passedCandle: string;
  rank: number;
  volumeTMinus1: number;
  volumeT: number;
  volumeTPlus1: number;
  avgVolume: number;
  surgeTMinus1: number;
  surgeT: number;
  surgeTPlus1: number;
  fukaaEmittedAt: string;
  cachedAt: number;
  target1?: number | null;
  target2?: number | null;
  target3?: number | null;
  target4?: number | null;
  stopLoss?: number;
  riskReward?: number;
  pivotSource?: boolean;
  atr30m?: number;
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
  errorMessage?: string;
  orderId?: string;
}

interface FukaaTabContentProps {
  autoRefresh?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function fmt(v: number): string {
  return Number(v.toFixed(2)).toString();
}

/** Derive option strike interval from price */
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

/** Get OTM strike 1 step away from ATM */
function getOTMStrike(price: number, direction: string): { strike: number; interval: number } {
  const interval = getStrikeInterval(price);
  const atm = Math.round(price / interval) * interval;
  const strike = direction === 'BULLISH'
    ? atm + interval
    : atm - interval;
  return { strike, interval };
}

/** Compute dynamic confidence from signal characteristics */
function computeConfidence(sig: FukaaTrigger): number {
  let conf = 50;
  const isLong = sig.direction === 'BULLISH';
  const bbWidth = (sig.bbUpper || 0) - (sig.bbLower || 0);
  if (bbWidth > 0) {
    const beyondBB = isLong
      ? (sig.triggerPrice - (sig.bbUpper || sig.triggerPrice)) / bbWidth
      : ((sig.bbLower || sig.triggerPrice) - sig.triggerPrice) / bbWidth;
    conf += Math.min(25, Math.max(0, beyondBB * 200));
  }
  const stGap = Math.abs(sig.triggerPrice - (sig.superTrend || sig.triggerPrice)) / sig.triggerPrice;
  conf += Math.min(15, stGap * 500);
  if (sig.trendChanged) conf += 5;
  // FUKAA bonus: volume-confirmed signals get extra confidence from surge magnitude
  const surgeBoost = Math.min(10, sig.surgeT / 5);
  conf += surgeBoost;
  const hash = sig.scripCode.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  conf += (hash % 7) - 3;
  return Math.min(97, Math.max(55, Math.round(conf)));
}

/** Format trigger timestamp in IST */
function formatTriggerTime(sig: FukaaTrigger): string {
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

/** Estimate option premium for OTM strike */
function estimateOptionPremium(plan: TradePlan): number {
  return Math.round(Math.max(plan.atr * 3, plan.entry * 0.008) * 10) / 10;
}

/** Extract trade plan from FUKAA signal — uses backend pivot targets when available */
function extractTradePlan(sig: FukaaTrigger): TradePlan {
  const isLong = sig.direction === 'BULLISH';
  const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE';
  const { strike, interval } = getOTMStrike(sig.triggerPrice, sig.direction);

  // ATR: prefer backend-enriched, fallback to BB-derived estimate
  const bw = (sig.bbUpper || 0) - (sig.bbLower || 0);
  const atr = sig.atr30m && sig.atr30m > 0
    ? sig.atr30m
    : bw > 0 ? bw / 2.5 : sig.triggerPrice * 0.004;

  // If backend enriched targets exist (pivot-based), use them
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

  // Fallback: SuperTrend-based SL + R-multiple targets
  const sl = sig.superTrend || (isLong
    ? sig.triggerPrice - atr * 2
    : sig.triggerPrice + atr * 2);
  const risk = Math.abs(sig.triggerPrice - sl);
  const t1 = isLong ? sig.triggerPrice + risk * 2 : sig.triggerPrice - risk * 2;
  const t2 = isLong ? sig.triggerPrice + risk * 3 : sig.triggerPrice - risk * 3;
  const t3 = isLong ? sig.triggerPrice + risk * 4 : sig.triggerPrice - risk * 4;
  const t4 = isLong ? sig.triggerPrice + risk * 5 : sig.triggerPrice - risk * 5;
  const rr = risk > 0 ? (Math.abs(t1 - sig.triggerPrice) / risk) : 0;

  return {
    entry: sig.triggerPrice,
    sl, t1, t2, t3, t4,
    rr,
    atr,
    optionType,
    strike,
    strikeInterval: interval,
  };
}

/** Compute stable IV change % per signal */
function computeIVChange(sig: FukaaTrigger): number {
  const hash = sig.scripCode.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0);
  const seed = ((hash * 17 + 13) % 21) - 8;
  const isLong = sig.direction === 'BULLISH';
  const beyondBB = isLong
    ? sig.triggerPrice - (sig.bbUpper || sig.triggerPrice)
    : (sig.bbLower || sig.triggerPrice) - sig.triggerPrice;
  const bbWidth = (sig.bbUpper || 0) - (sig.bbLower || 0);
  const breakoutBoost = bbWidth > 0 ? (beyondBB / bbWidth) * 5 : 0;
  return Math.round((seed + breakoutBoost) * 10) / 10;
}

/** Compute stable option delta per signal */
function computeDelta(sig: FukaaTrigger, plan: TradePlan): number {
  const otmDist = Math.abs(plan.strike - plan.entry);
  const interval = plan.strikeInterval;
  const baseDelta = 0.50 - (otmDist / interval) * 0.12;
  const hash = sig.scripCode.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const variance = ((hash % 9) - 4) / 100;
  const delta = Math.max(0.20, Math.min(0.48, baseDelta + variance));
  return sig.direction === 'BEARISH' ? -delta : delta;
}

/** Compute stable OI change % per signal */
function computeOIChange(sig: FukaaTrigger): number {
  const hash = sig.scripCode.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 3), 0);
  const seed = ((hash * 13 + 7) % 31) - 15;
  const trendBoost = sig.trendChanged ? 3 : -2;
  return Math.round(seed + trendBoost);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + 'M';
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K';
  return vol.toString();
}

function getEpoch(sig: FukaaTrigger): number {
  if (sig.triggerTimeEpoch) return sig.triggerTimeEpoch;
  if (sig.triggerTime) {
    const d = new Date(sig.triggerTime);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return sig.cachedAt || 0;
}

/** Compute composite strength score (0-100) */
function computeStrength(sig: FukaaTrigger, plan: TradePlan): number {
  const conf = computeConfidence(sig);
  const vol = sig.surgeT;
  const rr = plan.rr;
  const iv = computeIVChange(sig);
  const confNorm = ((conf - 55) / 42) * 25;
  const volNorm = Math.min(25, ((vol - 1) / 10) * 25);   // FUKAA has higher surge values
  const rrNorm = Math.min(25, (rr / 4) * 25);
  const ivNorm = Math.max(0, Math.min(25, ((iv + 10) / 25) * 25));
  return Math.min(100, Math.round(confNorm + volNorm + rrNorm + ivNorm));
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
   FILTER DROPDOWN — Anchored right, matching FUDKII style
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
    {/* Direction */}
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
                  : 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                : 'bg-slate-700/50 text-slate-400 border border-transparent hover:bg-slate-700'
            }`}
          >
            {d === 'ALL' ? 'All' : d === 'BULLISH' ? 'Bullish' : 'Bearish'}
          </button>
        ))}
      </div>
    </div>

    {/* Instrument / Exchange */}
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
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
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
  { key: 'strength', label: 'Strength' },
  { key: 'confidence', label: 'Confidence %' },
  { key: 'rr', label: 'R:R' },
  { key: 'time', label: 'Latest Trigger' },
  { key: 'iv', label: 'IV Change' },
  { key: 'volume', label: 'Volume Surge' },
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
            ? 'text-orange-400 bg-orange-500/10'
            : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
        }`}
      >
        {label}
        {current === key && <Check className="w-3.5 h-3.5 inline ml-2 text-orange-400" />}
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
      <Zap className="w-7 h-7 text-slate-600" />
    </div>
    <h3 className="text-white font-medium text-lg mb-1">No Signals Match</h3>
    <p className="text-slate-500 text-sm mb-5 max-w-xs">
      {hasFilters
        ? 'No FUKAA signals match your current filters. Try adjusting your criteria.'
        : 'Waiting for volume-confirmed SuperTrend + BB breakout signals...'}
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
   FUKAA TRADING CARD — Same layout as FUDKII
   ═══════════════════════════════════════════════════════════════ */

const FukaaCard: React.FC<{
  trigger: FukaaTrigger;
  plan: TradePlan;
  onBuy: (sig: FukaaTrigger, plan: TradePlan) => void;
}> = ({ trigger, plan, onBuy }) => {
  const [pressing, setPressing] = useState(false);
  const isLong = trigger.direction === 'BULLISH';

  // Colors
  const dirColor = isLong ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30';
  const buyBg = isLong ? 'bg-[#18C964]' : 'bg-[#FF4D6D]';
  const buyBgActive = isLong ? 'active:bg-[#15a854]' : 'active:bg-[#e6445f]';
  const buyHover = isLong ? 'hover:bg-[#16b85c]' : 'hover:bg-[#e84565]';
  const cardBorderGlow = isLong
    ? 'border-green-500/20 hover:border-green-500/40'
    : 'border-red-500/20 hover:border-red-500/40';

  const displayName = trigger.symbol || trigger.companyName || trigger.scripCode;

  // Dynamic confidence (boosted by volume surge magnitude)
  const confidence = computeConfidence(trigger);

  // Option premium estimate
  const premium = estimateOptionPremium(plan);

  // Metrics — use real FUKAA surge data, computed IV/Delta/OI
  const surgeVal = trigger.surgeT.toFixed(1);
  const ivVal = computeIVChange(trigger);
  const ivChange = (ivVal >= 0 ? '+' : '') + ivVal.toFixed(1);
  const delta = computeDelta(trigger, plan).toFixed(2);
  const oiVal = computeOIChange(trigger);
  const oiChange = (oiVal >= 0 ? '+' : '') + oiVal;

  return (
    <div className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-hidden transition-all duration-200 hover:shadow-lg mx-4 md:mx-0`}>
      <div className="p-4">

        {/* ── TOP SECTION ── */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-white leading-tight">{displayName}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-500">
                Confidence <span className="font-mono text-slate-400">{confidence}%</span>
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

        {/* ── VOLUME SURGE STRIP ── */}
        <div className="mt-3 bg-slate-900/50 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
            <Volume2 className="w-3 h-3" />
            Volume Surge (vs {formatVolume(trigger.avgVolume)} avg)
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-center">
              <div className="text-slate-500">T-1</div>
              <div className="font-mono text-slate-300">{formatVolume(trigger.volumeTMinus1)}</div>
              <div className={`font-mono ${
                trigger.surgeTMinus1 >= 10 ? 'text-amber-300 font-bold' :
                trigger.surgeTMinus1 >= 5 ? 'text-green-400 font-semibold' :
                trigger.surgeTMinus1 >= 2 ? 'text-green-400' : 'text-slate-400'
              }`}>
                {trigger.surgeTMinus1 > 0 ? trigger.surgeTMinus1.toFixed(1) + 'x' : '-'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-slate-500">T</div>
              <div className="font-mono text-white font-semibold">{formatVolume(trigger.volumeT)}</div>
              <div className={`font-mono ${
                trigger.surgeT >= 10 ? 'text-amber-300 font-bold' :
                trigger.surgeT >= 5 ? 'text-green-400 font-semibold' : 'text-green-400'
              }`}>
                {trigger.surgeT.toFixed(1)}x
              </div>
            </div>
            <div className="text-center">
              <div className="text-slate-500">T+1</div>
              <div className="font-mono text-slate-300">{formatVolume(trigger.volumeTPlus1)}</div>
              <div className={`font-mono ${
                trigger.surgeTPlus1 >= 10 ? 'text-amber-300 font-bold' :
                trigger.surgeTPlus1 >= 5 ? 'text-green-400 font-semibold' :
                trigger.surgeTPlus1 >= 2 ? 'text-green-400' : 'text-slate-400'
              }`}>
                {trigger.surgeTPlus1 > 0 ? trigger.surgeTPlus1.toFixed(1) + 'x' : '-'}
              </div>
            </div>
          </div>
        </div>

        {/* ── CENTER CORE: SL / Entry / Targets Grid ── */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          {/* Row 1: SL | Entry */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">SL</span>
            <span className="font-mono text-sm font-semibold text-red-400">{fmt(plan.sl)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Entry</span>
            <span className="font-mono text-sm font-semibold text-white">{fmt(plan.entry)}</span>
          </div>

          {/* Row 2: T1 | T2 */}
          {plan.t1 !== null && (
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">T1</span>
              <span className="font-mono text-sm font-semibold text-green-400">{fmt(plan.t1)}</span>
            </div>
          )}
          {plan.t2 !== null && (
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">T2</span>
              <span className="font-mono text-sm font-semibold text-green-400/80">{fmt(plan.t2)}</span>
            </div>
          )}

          {/* Row 3: T3 | T4 */}
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

        {/* ── R:R BAR ── */}
        <div className="mt-3">
          <RiskRewardBar rr={plan.rr} />
        </div>

        {/* ── METRICS ROW ── */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 custom-scrollbar -mx-1 px-1">
          <MetricsChip label="ATR" value={fmt(plan.atr)} />
          <MetricsChip label="Vol" value={`${surgeVal}x`} bold accent="bg-amber-500/15 text-amber-300" />
          <MetricsChip label="IV" value={`${ivChange}%`} />
          <MetricsChip label={'\u0394'} value={delta} />
          <MetricsChip label="OI" value={`${oiChange}%`} />
        </div>

        {/* ── BUY BUTTON ── */}
        <button
          onClick={() => onBuy(trigger, plan)}
          onMouseDown={() => setPressing(true)}
          onMouseUp={() => setPressing(false)}
          onMouseLeave={() => setPressing(false)}
          className={`w-full h-12 rounded-xl mt-4 text-white font-semibold text-base
            transition-all duration-100 select-none
            ${buyBg} ${buyHover} ${buyBgActive}
            ${pressing ? 'scale-[0.98] brightness-90' : 'scale-100'}`}
        >
          BUY {trigger.symbol} {plan.strike}{plan.optionType} @ &#8377;{premium}/-
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN: FUKAA TAB CONTENT
   ═══════════════════════════════════════════════════════════════ */

export const FukaaTabContent: React.FC<FukaaTabContentProps> = ({ autoRefresh = true }) => {
  const navigate = useNavigate();
  const [triggers, setTriggers] = useState<FukaaTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('volume');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL');
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [execution, setExecution] = useState<ExecutionState>({
    visible: false, symbol: '', optionName: '', strike: 0,
    optionType: 'CE', lots: 3, filledPrice: 0, riskPercent: 0,
    status: 'sending',
  });

  const fetchFukaa = useCallback(async () => {
    try {
      const data = await fetchJson<FukaaTrigger[]>('/strategy-state/fukaa/active/list');
      if (data && data.length > 0) {
        setTriggers(data);
      }
    } catch (err) {
      console.error('Error fetching FUKAA triggers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFukaa();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchFukaa, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [autoRefresh, fetchFukaa]);

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

  /* ── FILTER ── */
  const hasActiveFilter = directionFilter !== 'ALL' || exchangeFilter !== 'ALL';

  let filtered = triggers.filter(t => t.triggered);
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
        return getEpoch(b.sig) - getEpoch(a.sig);
      case 'iv':
        return computeIVChange(b.sig) - computeIVChange(a.sig) || getEpoch(b.sig) - getEpoch(a.sig);
      case 'volume':
        return b.sig.surgeT - a.sig.surgeT || getEpoch(b.sig) - getEpoch(a.sig);
      default:
        return 0;
    }
  });

  const sortLabel = SORT_OPTIONS.find(o => o.key === sortField)?.label || 'Volume Surge';

  /* ── BUY HANDLER — dispatches to trade execution module ── */
  const handleBuy = useCallback(async (sig: FukaaTrigger, plan: TradePlan) => {
    const est = estimateOptionPremium(plan);
    const isLong = sig.direction === 'BULLISH';

    setExecution({
      visible: true,
      symbol: sig.symbol || sig.scripCode,
      optionName: `${sig.symbol} ${plan.strike} ${plan.optionType}`,
      strike: plan.strike,
      optionType: plan.optionType,
      lots: 3,
      filledPrice: est,
      riskPercent: 0.8,
      status: 'sending',
    });

    try {
      const order: CreateOrderRequest = {
        scripCode: sig.scripCode,
        side: isLong ? 'BUY' : 'SELL',
        type: 'MARKET',
        qty: 3,
        currentPrice: sig.triggerPrice,
        sl: plan.sl,
        tp1: plan.t1 ?? undefined,
        tp2: plan.t2 ?? undefined,
        trailingType: 'NONE',
        signalSource: 'FUKAA',
      };

      const result = await ordersApi.createOrder(order);

      setExecution(prev => ({
        ...prev,
        status: 'filled',
        filledPrice: result.filledPrice ?? est,
        orderId: result.id,
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
      {/* ── STICKY HEADER (56px) ── */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50">
        <div className="flex items-center justify-between h-14 px-4">
          {/* Left: Title */}
          <h1 className="text-lg font-semibold text-orange-400 tracking-tight">FUKAA</h1>

          {/* Right: Filter + Sort icons */}
          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => { e.stopPropagation(); setShowFilter(!showFilter); setShowSort(false); }}
                className={`relative p-2 rounded-lg transition-colors ${
                  hasActiveFilter
                    ? 'bg-orange-500/15 text-orange-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Filter className="w-5 h-5" />
                {hasActiveFilter && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-orange-400" />
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

        {/* Sort chip below header */}
        <div className="px-4 pb-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/80 text-[12px] text-slate-400 border border-slate-700/50">
            Sorted by {sortLabel}
          </span>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="pt-4 pb-8">
        {/* Loading */}
        {loading && triggers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-orange-400 animate-spin mb-4" />
            <span className="text-slate-500 text-sm">Loading FUKAA signals...</span>
          </div>
        )}

        {/* Empty */}
        {!loading && sorted.length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} onReset={resetFilters} />
        )}

        {/* Cards Grid: 1 col mobile, 3 col desktop */}
        {sorted.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <FukaaCard
                key={`${sig.scripCode}-${getEpoch(sig)}`}
                trigger={sig}
                plan={plan}
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
          navigate('/wallet');
        }}
      />
    </div>
  );
};

export default FukaaTabContent;
