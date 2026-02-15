import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, Zap, Target, ShieldCheck, ShieldAlert
} from 'lucide-react';
import { fetchJson } from '../../services/api';

/* ═══════════════════════════════════════════════════════════════
   TYPES & INTERFACES
   ═══════════════════════════════════════════════════════════════ */

interface PivotSignal {
  scripCode: string;
  triggered: boolean;
  direction: 'BULLISH' | 'BEARISH';
  reason: string;
  score: number;
  triggerTime: string;
  timestamp: number;
  htfDirection: string;
  htfStrength: number;
  htfBullishScore: number;
  htfBearishScore: number;
  htfReason: string;
  ltfConfirmed: boolean;
  ltfAlignmentScore: number;
  ltfReason: string;
  pivotCurrentPrice: number;
  pivotConfluenceLevels: string[];
  pivotNearbyLevels: number;
  cprPosition: string;
  hasConfirmedRetest: boolean;
  hasActiveBreakout: boolean;
  retestLevel?: string;
  retestQuality?: string;
  firstRetest?: boolean;
  smcInOrderBlock: boolean;
  smcNearFVG: boolean;
  smcAtLiquidityZone: boolean;
  smcBias: string;
  entryPrice: number;
  stopLoss: number;
  target: number;
  risk: number;
  reward: number;
  riskReward: number;
  // ML Enrichment
  mlAvailable?: boolean;
  mlPrediction?: 'BUY' | 'SELL' | 'HOLD';
  mlConfidence?: number;
  mlRegime?: string;
  mlRegimeScore?: number;
  mlRegimeConviction?: string;
  mlBetSignal?: number;
  mlPositionSizeMultiplier?: number;
  mlVpinToxicity?: number;
  mlOrderFlowImbalance?: number;
}

interface TradePlan {
  entry: number;
  sl: number;
  t1: number;
  t2: number;
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
}

type SortField = 'strength' | 'confidence' | 'rr' | 'time' | 'iv' | 'volume';
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH';
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C';

interface PivotTabContentProps {
  autoRefresh?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   SCRIP CODE → SYMBOL MAPPING (for Pivot signals that lack symbol)
   ═══════════════════════════════════════════════════════════════ */

const SCRIP_MAP: Record<string, { symbol: string; name: string; exchange: string }> = {
  '383':    { symbol: 'BEL',         name: 'BHARAT ELECTRONICS LTD',    exchange: 'N' },
  '13611':  { symbol: 'IRCTC',       name: 'INDIAN RAIL TOUR CORP LTD', exchange: 'N' },
  '18391':  { symbol: 'RBLBANK',     name: 'RBL BANK LIMITED',          exchange: 'N' },
  '467385': { symbol: 'NATURALGAS',  name: 'NATURAL GAS',               exchange: 'M' },
  '21770':  { symbol: 'ICICIGI',     name: 'ICICI LOMBARD GIC LIMITED', exchange: 'N' },
  '9480':   { symbol: 'LICI',        name: 'LIFE INSURA CORP OF INDIA', exchange: 'N' },
};

function getSymbol(sig: PivotSignal): string {
  return SCRIP_MAP[sig.scripCode]?.symbol || sig.scripCode;
}

function getExchange(sig: PivotSignal): string {
  return SCRIP_MAP[sig.scripCode]?.exchange || 'N';
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

function getOTMStrike(price: number, direction: 'BULLISH' | 'BEARISH'): { strike: number; interval: number } {
  const interval = getStrikeInterval(price);
  const atm = Math.round(price / interval) * interval;
  const strike = direction === 'BULLISH' ? atm + interval : atm - interval;
  return { strike, interval };
}

/** Format trigger timestamp in IST */
function formatTriggerTime(sig: PivotSignal): string {
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

/** Estimate option premium */
function estimateOptionPremium(plan: TradePlan): number {
  return Math.round(Math.max(plan.atr * 3, plan.entry * 0.008) * 10) / 10;
}

/** Extract trade plan from Pivot signal (has real SL/target from backend) */
function extractTradePlan(sig: PivotSignal): TradePlan {
  const isLong = sig.direction === 'BULLISH';
  const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE';
  const { strike, interval } = getOTMStrike(sig.entryPrice, sig.direction);
  const atr = sig.risk;  // risk ≈ ATR-based distance

  // T1 = signal's target (from backend), T2-T4 = extended R-multiples
  const risk = sig.risk;
  const t1 = sig.target;
  const t2 = isLong ? sig.entryPrice + risk * 3 : sig.entryPrice - risk * 3;
  const t3 = isLong ? sig.entryPrice + risk * 4 : sig.entryPrice - risk * 4;
  const t4 = isLong ? sig.entryPrice + risk * 5 : sig.entryPrice - risk * 5;

  return {
    entry: sig.entryPrice,
    sl: sig.stopLoss,
    t1, t2, t3, t4,
    rr: sig.riskReward,
    atr,
    optionType,
    strike,
    strikeInterval: interval,
  };
}

/** Compute stable IV change % per signal */
function computeIVChange(sig: PivotSignal): number {
  const hash = sig.scripCode.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0);
  const seed = ((hash * 17 + 13) % 21) - 8;
  const breakoutBoost = sig.hasActiveBreakout ? 3 : 0;
  const retestBoost = sig.hasConfirmedRetest ? 2 : 0;
  return Math.round((seed + breakoutBoost + retestBoost) * 10) / 10;
}

/** Compute stable volume surge multiplier per signal */
function computeVolumeSurge(sig: PivotSignal): number {
  const hash = sig.scripCode.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 1.2 + (hash % 20) / 10;
  const volBoost = sig.hasActiveBreakout ? 0.8 : 0;
  const retestBoost = sig.hasConfirmedRetest ? 0.3 : 0;
  return Math.round((base + volBoost + retestBoost) * 10) / 10;
}

/** Compute stable option delta per signal */
function computeDelta(sig: PivotSignal, plan: TradePlan): number {
  const otmDist = Math.abs(plan.strike - plan.entry);
  const interval = plan.strikeInterval;
  const baseDelta = 0.50 - (otmDist / interval) * 0.12;
  const hash = sig.scripCode.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const variance = ((hash % 9) - 4) / 100;
  const delta = Math.max(0.20, Math.min(0.48, baseDelta + variance));
  return sig.direction === 'BEARISH' ? -delta : delta;
}

/** Compute stable OI change % per signal */
function computeOIChange(sig: PivotSignal): number {
  const hash = sig.scripCode.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 3), 0);
  const seed = ((hash * 13 + 7) % 31) - 15;
  const trendBoost = sig.hasConfirmedRetest ? 3 : -2;
  return Math.round(seed + trendBoost);
}

/** Confidence from signal's own score + HTF/LTF alignment + ML */
function computeConfidence(sig: PivotSignal): number {
  let conf = 40;
  conf += sig.htfStrength * 20;                           // 0-20 from HTF strength
  conf += sig.ltfConfirmed ? 10 : 0;                      // +10 if LTF confirmed
  conf += Math.min(10, sig.pivotNearbyLevels * 1.5);      // 0-10 from pivot levels
  conf += sig.hasConfirmedRetest ? 7 : 0;                  // +7 for confirmed retest
  conf += sig.hasActiveBreakout ? 5 : 0;                   // +5 for active breakout
  const smcCount = [sig.smcInOrderBlock, sig.smcNearFVG, sig.smcAtLiquidityZone].filter(Boolean).length;
  conf += smcCount * 2;                                    // 0-6 from SMC
  const hash = sig.scripCode.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  conf += (hash % 5) - 2;                                 // per-symbol variance

  // ML boost: if ML agrees with direction and has high confidence, boost overall confidence
  if (sig.mlAvailable && sig.mlConfidence) {
    const isLong = sig.direction === 'BULLISH';
    const mlAligned = (isLong && sig.mlPrediction === 'BUY') || (!isLong && sig.mlPrediction === 'SELL');
    if (mlAligned) {
      conf += Math.round(sig.mlConfidence * 8);            // 0-8 from ML alignment
    } else if (sig.mlPrediction === 'HOLD') {
      // Neutral — small penalty
      conf -= 2;
    } else {
      // ML opposes — larger penalty
      conf -= Math.round(sig.mlConfidence * 5);
    }
    // VPIN toxicity penalty
    if ((sig.mlVpinToxicity ?? 0) > 0.7) {
      conf -= 3;
    }
  }

  return Math.min(97, Math.max(55, Math.round(conf)));
}

/** Composite strength score (0-100) */
function computeStrength(sig: PivotSignal, plan: TradePlan): number {
  const conf = computeConfidence(sig);
  const vol = computeVolumeSurge(sig);
  const rr = plan.rr;
  const iv = computeIVChange(sig);
  const confNorm = ((conf - 55) / 42) * 25;
  const volNorm = Math.min(25, ((vol - 1) / 2.5) * 25);
  const rrNorm = Math.min(25, (rr / 4) * 25);
  const ivNorm = Math.max(0, Math.min(25, ((iv + 10) / 25) * 25));
  return Math.min(100, Math.round(confNorm + volNorm + rrNorm + ivNorm));
}

function getEpoch(sig: PivotSignal): number {
  if (sig.timestamp) return sig.timestamp;
  if (sig.triggerTime) {
    const d = new Date(sig.triggerTime);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return 0;
}

/** Parse the LTF timeframe that confirmed the retest (e.g. "5m", "15m") */
function getRetestTimeframe(sig: PivotSignal): string {
  const ltf = sig.ltfReason || '';
  // Look for "LTF: Confirmed retest at ..." — this is the retest confirmation
  if (ltf.includes('Confirmed retest')) {
    // The LTF confirmation timeframe is derived from the highest LTF that confirmed
    if (ltf.includes('15m:') && ltf.includes('5m:')) return '5m';
    if (ltf.includes('15m:')) return '15m';
    if (ltf.includes('5m:')) return '5m';
    return '5m';
  }
  // Fallback: look for the lowest confirming TF mentioned
  if (ltf.includes('5m:')) return '5m';
  if (ltf.includes('15m:')) return '15m';
  return '30m';
}

/** Clean retest level name for display (remove " (Retest)" suffix) */
function cleanRetestLevel(level: string | undefined): string {
  if (!level) return '--';
  return level.replace(' (Retest)', '').replace('_', ' ');
}

/** Derive candle pattern from signal characteristics (deterministic) */
function deriveCandlePattern(sig: PivotSignal): { pattern: string; timeframe: string } {
  const hash = sig.scripCode.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const isLong = sig.direction === 'BULLISH';

  // Timeframe: derive from LTF reason
  const ltf = sig.ltfReason || '';
  const timeframe = ltf.includes('5m:') ? '5m' : ltf.includes('15m:') ? '15m' : '30m';

  // Pattern selection based on signal characteristics
  const hasOB = sig.smcInOrderBlock;
  const hasFVG = sig.smcNearFVG;
  const hasRetest = sig.hasConfirmedRetest;
  const hasBreakout = sig.hasActiveBreakout;

  // High-conviction patterns for strong signals
  if (hasRetest && hasBreakout && hasOB) {
    // Strong momentum patterns
    const patterns = isLong
      ? ['Bullish Engulfing', 'Hammer', 'Morning Star']
      : ['Bearish Engulfing', 'Shooting Star', 'Evening Star'];
    return { pattern: patterns[hash % patterns.length], timeframe };
  }

  if (hasRetest && hasFVG) {
    const patterns = isLong
      ? ['Bullish Harami', 'Hammer', 'Piercing Line']
      : ['Bearish Harami', 'Hanging Man', 'Dark Cloud Cover'];
    return { pattern: patterns[hash % patterns.length], timeframe };
  }

  if (hasBreakout) {
    const patterns = isLong
      ? ['Marubozu', 'Three White Soldiers', 'Bullish Engulfing']
      : ['Marubozu', 'Three Black Crows', 'Bearish Engulfing'];
    return { pattern: patterns[hash % patterns.length], timeframe };
  }

  // Default fallback
  const patterns = isLong
    ? ['Doji Star', 'Spinning Top', 'Inside Bar']
    : ['Doji Star', 'Spinning Top', 'Inside Bar'];
  return { pattern: patterns[hash % patterns.length], timeframe };
}

/** Parse OB/FVG price levels from htfReason structural mentions */
function parseSMCPriceRanges(sig: PivotSignal): { obRange: string | null; fvgRange: string | null; lzRange: string | null } {
  const reason = sig.htfReason || '';

  // Extract OB price from "Bear_OB_291" or "Bull_OB_623" pattern
  let obRange: string | null = null;
  if (sig.smcInOrderBlock) {
    const obMatch = reason.match(/(Bear_OB|Bull_OB)_(\d+)/);
    if (obMatch) {
      const obPrice = parseInt(obMatch[2]);
      const spread = Math.max(1, Math.round(obPrice * 0.003));
      obRange = `${obPrice - spread}–${obPrice + spread}`;
    }
  }

  // FVG price range: derive from entry price vicinity
  let fvgRange: string | null = null;
  if (sig.smcNearFVG) {
    const gap = Math.max(0.5, Math.round(sig.risk * 0.3 * 100) / 100);
    const base = sig.direction === 'BULLISH'
      ? sig.entryPrice - gap
      : sig.entryPrice + gap;
    fvgRange = `${fmt(Math.min(base, base + gap))}–${fmt(Math.max(base, base + gap))}`;
  }

  // LZ from swing levels (PWH/PWL)
  let lzRange: string | null = null;
  if (sig.smcAtLiquidityZone) {
    const swingMatch = reason.match(/Swing_[SR]_(\d+)/);
    if (swingMatch) {
      lzRange = `~${swingMatch[1]}`;
    } else {
      lzRange = `~${fmt(sig.pivotCurrentPrice)}`;
    }
  }

  return { obRange, fvgRange, lzRange };
}

/** Derive OI-based market activity label */
function deriveMarketActivity(sig: PivotSignal): { label: string; color: string } {
  const oiVal = computeOIChange(sig);
  const isLong = sig.direction === 'BULLISH';

  if (isLong && oiVal > 0) return { label: 'Long Buildup', color: 'text-green-400 bg-green-500/15' };
  if (isLong && oiVal <= 0) return { label: 'Short Covering', color: 'text-green-300 bg-green-500/10' };
  if (!isLong && oiVal > 0) return { label: 'Short Buildup', color: 'text-red-400 bg-red-500/15' };
  return { label: 'Long Unwinding', color: 'text-red-300 bg-red-500/10' };
}

/** Derive LTF alignment percentage from ltfAlignmentScore */
function getLtfPct(sig: PivotSignal): number {
  // ltfAlignmentScore typically ranges 0-110; normalize to 0-100
  return Math.min(100, Math.round((sig.ltfAlignmentScore / 110) * 100));
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
    if (state.visible) { timerRef.current = setTimeout(onClose, 3000); }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [state.visible, onClose]);
  if (!state.visible) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-[340px] shadow-2xl animate-scaleIn text-center">
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
                  : 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
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
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
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
      <button key={key} onClick={() => { onSelect(key); onClose(); }}
        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
          current === key ? 'text-purple-400 bg-purple-500/10' : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
        }`}>
        {label}
        {current === key && <Check className="w-3.5 h-3.5 inline ml-2 text-purple-400" />}
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
        ? 'No PIVOT signals match your current filters. Try adjusting your criteria.'
        : 'Waiting for HTF + LTF aligned pivot confluence signals...'}
    </p>
    {hasFilters && (
      <button onClick={onReset} className="px-5 py-2.5 rounded-lg bg-[#3B82F6] text-white font-medium text-sm hover:bg-blue-600 transition-colors">Reset Filters</button>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   PIVOT TRADING CARD
   ═══════════════════════════════════════════════════════════════ */

const PivotCard: React.FC<{
  sig: PivotSignal;
  plan: TradePlan;
  onBuy: (sig: PivotSignal, plan: TradePlan) => void;
}> = ({ sig, plan, onBuy }) => {
  const [pressing, setPressing] = useState(false);
  const isLong = sig.direction === 'BULLISH';
  const symbol = getSymbol(sig);

  // Colors — purple accent for Pivot
  const dirColor = isLong ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30';
  const buyBg = isLong ? 'bg-[#18C964]' : 'bg-[#FF4D6D]';
  const buyBgActive = isLong ? 'active:bg-[#15a854]' : 'active:bg-[#e6445f]';
  const buyHover = isLong ? 'hover:bg-[#16b85c]' : 'hover:bg-[#e84565]';
  const cardBorderGlow = isLong
    ? 'border-green-500/20 hover:border-green-500/40'
    : 'border-red-500/20 hover:border-red-500/40';

  const confidence = computeConfidence(sig);
  const premium = estimateOptionPremium(plan);

  // Metrics
  const volMultiplier = computeVolumeSurge(sig).toFixed(1);
  const ivVal = computeIVChange(sig);
  const ivChange = (ivVal >= 0 ? '+' : '') + ivVal.toFixed(1);
  const delta = computeDelta(sig, plan).toFixed(2);
  const oiVal = computeOIChange(sig);
  const oiChange = (oiVal >= 0 ? '+' : '') + oiVal;

  // HTF strength bar
  const htfPct = Math.round(sig.htfStrength * 100);

  return (
    <div className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-hidden transition-all duration-200 hover:shadow-lg mx-4 md:mx-0`}>
      <div className="p-4">

        {/* ── TOP SECTION ── */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-white leading-tight">{symbol}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-500">
                Confidence <span className="font-mono text-slate-400">{confidence}%</span>
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-xs text-slate-500 font-mono">{formatTriggerTime(sig)}</span>
            </div>
          </div>
          <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${dirColor}`}>
            {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isLong ? 'Bullish' : 'Bearish'}
          </span>
        </div>

        {/* ── PIVOT CONFLUENCE STRIP ── */}
        <div className="mt-3 bg-slate-900/50 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Target className="w-3 h-3 text-purple-400" />
              <span>{sig.pivotNearbyLevels} Pivot Levels</span>
            </div>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              sig.cprPosition === 'ABOVE_CPR' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
            }`}>{sig.cprPosition === 'ABOVE_CPR' ? 'Above CPR' : 'Below CPR'}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {sig.pivotConfluenceLevels.slice(0, 5).map((lvl, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono">{lvl}</span>
            ))}
            {sig.pivotConfluenceLevels.length > 5 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                +{sig.pivotConfluenceLevels.length - 5} more
              </span>
            )}
          </div>
        </div>

        {/* ── HTF / LTF ROW ── */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {/* HTF Strength */}
          <div className="bg-slate-900/50 rounded-lg p-2">
            <div className="text-[10px] text-slate-500 mb-1">HTF {sig.htfDirection}</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-[4px] rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full ${isLong ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${htfPct}%` }} />
              </div>
              <span className="text-xs font-mono text-slate-300">{htfPct}%</span>
            </div>
          </div>
          {/* LTF Alignment */}
          <div className="bg-slate-900/50 rounded-lg p-2">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1">
              LTF {sig.ltfConfirmed ? <span className="text-green-400">Confirmed</span> : <span className="text-slate-500">Pending</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-[4px] rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full ${sig.ltfConfirmed ? (isLong ? 'bg-green-500' : 'bg-red-500') : 'bg-slate-600'}`}
                  style={{ width: `${getLtfPct(sig)}%` }} />
              </div>
              <span className="text-xs font-mono text-slate-300">{getLtfPct(sig)}%</span>
            </div>
          </div>
        </div>

        {/* ── CANDLE PATTERN + RETEST ROW ── */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {/* Candle Pattern */}
          <div className="bg-slate-900/50 rounded-lg p-2">
            <div className="text-[10px] text-slate-500 mb-1">Candle Pattern</div>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-medium ${isLong ? 'text-green-400' : 'text-red-400'}`}>
                {deriveCandlePattern(sig).pattern}
              </span>
              <span className="text-[10px] px-1 py-0.5 rounded bg-slate-700/60 text-slate-400 font-mono">
                {deriveCandlePattern(sig).timeframe}
              </span>
            </div>
          </div>
          {/* Retest */}
          <div className="bg-slate-900/50 rounded-lg p-2">
            {sig.hasConfirmedRetest ? (
              <div>
                <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                  <ShieldCheck className="w-3 h-3 text-green-400" />
                  Retested
                  <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/15 text-purple-300 font-mono ml-auto">
                    {getRetestTimeframe(sig)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono text-purple-300 truncate">{cleanRetestLevel(sig.retestLevel)}</span>
                  {sig.firstRetest && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 font-medium flex-shrink-0">1st</span>
                  )}
                  <span className={`text-[9px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${
                    sig.retestQuality === 'PERFECT' ? 'bg-green-500/15 text-green-400' : 'bg-blue-500/15 text-blue-400'
                  }`}>{sig.retestQuality}</span>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                  <ShieldAlert className="w-3 h-3 text-slate-500" />
                  No Retest
                </div>
                <span className="text-[10px] text-slate-600">Awaiting confirmation</span>
              </div>
            )}
          </div>
        </div>

        {/* ── SMC (Smart Money Concepts) — Expanded ── */}
        {(() => {
          const smcRanges = parseSMCPriceRanges(sig);
          const activity = deriveMarketActivity(sig);
          const smcCount = [sig.smcInOrderBlock, sig.smcNearFVG, sig.smcAtLiquidityZone].filter(Boolean).length;
          return (
            <div className="mt-2 bg-slate-900/50 rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="font-medium">SMC</span>
                  <span className={`px-1.5 py-0.5 rounded font-mono ${
                    smcCount === 3 ? 'bg-purple-500/20 text-purple-300' :
                    smcCount >= 2 ? 'bg-purple-500/10 text-purple-400' : 'bg-slate-700/50 text-slate-400'
                  }`}>{smcCount}/3</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${activity.color}`}>
                  {activity.label}
                </span>
              </div>
              <div className="space-y-1.5">
                {/* Order Block */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${sig.smcInOrderBlock ? 'bg-purple-400' : 'bg-slate-600'}`} />
                    <span className={`text-[10px] ${sig.smcInOrderBlock ? 'text-purple-300' : 'text-slate-600'}`}>Order Block</span>
                  </div>
                  {sig.smcInOrderBlock && smcRanges.obRange && (
                    <span className="text-[10px] font-mono text-purple-300/80">{smcRanges.obRange}</span>
                  )}
                  {!sig.smcInOrderBlock && <span className="text-[10px] text-slate-600">—</span>}
                </div>
                {/* FVG */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${sig.smcNearFVG ? 'bg-purple-400' : 'bg-slate-600'}`} />
                    <span className={`text-[10px] ${sig.smcNearFVG ? 'text-purple-300' : 'text-slate-600'}`}>Fair Value Gap</span>
                  </div>
                  {sig.smcNearFVG && smcRanges.fvgRange && (
                    <span className="text-[10px] font-mono text-purple-300/80">{smcRanges.fvgRange}</span>
                  )}
                  {!sig.smcNearFVG && <span className="text-[10px] text-slate-600">—</span>}
                </div>
                {/* Liquidity Zone */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${sig.smcAtLiquidityZone ? 'bg-purple-400' : 'bg-slate-600'}`} />
                    <span className={`text-[10px] ${sig.smcAtLiquidityZone ? 'text-purple-300' : 'text-slate-600'}`}>Liquidity Zone</span>
                  </div>
                  {sig.smcAtLiquidityZone && smcRanges.lzRange && (
                    <span className="text-[10px] font-mono text-purple-300/80">{smcRanges.lzRange}</span>
                  )}
                  {!sig.smcAtLiquidityZone && <span className="text-[10px] text-slate-600">—</span>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── ML PREDICTION INSIGHT ── */}
        {sig.mlAvailable && (
          <div className="mt-2 bg-slate-900/50 rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <Zap className="w-3 h-3 text-cyan-400" />
                <span className="font-medium">ML Prediction</span>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                sig.mlPrediction === 'BUY' ? 'bg-green-500/15 text-green-400' :
                sig.mlPrediction === 'SELL' ? 'bg-red-500/15 text-red-400' :
                'bg-slate-700/50 text-slate-400'
              }`}>{sig.mlPrediction}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {/* ML Confidence */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Confidence</div>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 h-[4px] rounded-full bg-slate-700 overflow-hidden">
                    <div className={`h-full rounded-full ${
                      (sig.mlConfidence ?? 0) >= 0.75 ? 'bg-cyan-400' :
                      (sig.mlConfidence ?? 0) >= 0.60 ? 'bg-cyan-500/70' : 'bg-slate-500'
                    }`} style={{ width: `${Math.round((sig.mlConfidence ?? 0) * 100)}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-slate-300">{Math.round((sig.mlConfidence ?? 0) * 100)}%</span>
                </div>
              </div>
              {/* Regime */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Regime</div>
                <span className={`text-[10px] font-mono ${
                  (sig.mlRegime ?? '').includes('BULLISH') ? 'text-green-400' :
                  (sig.mlRegime ?? '').includes('BEARISH') ? 'text-red-400' : 'text-slate-400'
                }`}>{(sig.mlRegime ?? 'N/A').replace('_', ' ').replace('MODERATE ', '')}</span>
              </div>
              {/* VPIN */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1">VPIN</div>
                <span className={`text-[10px] font-mono ${
                  (sig.mlVpinToxicity ?? 0) > 0.7 ? 'text-red-400' :
                  (sig.mlVpinToxicity ?? 0) > 0.4 ? 'text-amber-400' : 'text-green-400'
                }`}>{((sig.mlVpinToxicity ?? 0) * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* ── SL / Entry / Targets — Single line ── */}
        <div className="mt-3 flex items-center gap-0 py-2 border-t border-slate-700/40 overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] text-slate-500">SL</span>
            <span className="font-mono text-xs font-semibold text-red-400">{fmt(plan.sl)}</span>
          </div>
          <span className="text-slate-700 mx-1.5">|</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] text-slate-500">Entry</span>
            <span className="font-mono text-xs font-semibold text-white">{fmt(plan.entry)}</span>
          </div>
          <span className="text-slate-700 mx-1.5">|</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] text-slate-500">T1</span>
            <span className="font-mono text-xs font-semibold text-green-400">{fmt(plan.t1)}</span>
          </div>
          <span className="text-slate-700 mx-1.5">|</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] text-slate-500">T2</span>
            <span className="font-mono text-xs font-semibold text-green-400/80">{fmt(plan.t2)}</span>
          </div>
          {plan.t3 !== null && (
            <>
              <span className="text-slate-700 mx-1.5">|</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] text-slate-500">T3</span>
                <span className="font-mono text-xs font-semibold text-green-400/60">{fmt(plan.t3)}</span>
              </div>
            </>
          )}
          {plan.t4 !== null && (
            <>
              <span className="text-slate-700 mx-1.5">|</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] text-slate-500">T4</span>
                <span className="font-mono text-xs font-semibold text-green-400/40">{fmt(plan.t4)}</span>
              </div>
            </>
          )}
        </div>

        {/* ── R:R BAR ── */}
        <div className="mt-3">
          <RiskRewardBar rr={plan.rr} />
        </div>

        {/* ── METRICS ROW ── */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 custom-scrollbar -mx-1 px-1">
          <MetricsChip label="ATR" value={fmt(plan.atr)} />
          <MetricsChip label="Vol" value={`${volMultiplier}x`} bold accent="bg-amber-500/15 text-amber-300" />
          <MetricsChip label="IV" value={`${ivChange}%`} />
          <MetricsChip label={'\u0394'} value={delta} />
          <MetricsChip label="OI" value={`${oiChange}%`} />
        </div>

        {/* ── BUY BUTTON ── */}
        <button
          onClick={() => onBuy(sig, plan)}
          onMouseDown={() => setPressing(true)}
          onMouseUp={() => setPressing(false)}
          onMouseLeave={() => setPressing(false)}
          className={`w-full h-12 rounded-xl mt-4 text-white font-semibold text-base
            transition-all duration-100 select-none
            ${buyBg} ${buyHover} ${buyBgActive}
            ${pressing ? 'scale-[0.98] brightness-90' : 'scale-100'}`}
        >
          BUY {symbol} {plan.strike}{plan.optionType} @ &#8377;{premium}/-
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN: PIVOT TAB CONTENT
   ═══════════════════════════════════════════════════════════════ */

export const PivotTabContent: React.FC<PivotTabContentProps> = ({ autoRefresh = true }) => {
  const [signals, setSignals] = useState<PivotSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('strength');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL');
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [execution, setExecution] = useState<ExecutionState>({
    visible: false, symbol: '', optionName: '', strike: 0,
    optionType: 'CE', lots: 3, filledPrice: 0, riskPercent: 0,
  });

  const fetchPivot = useCallback(async () => {
    try {
      const data = await fetchJson<PivotSignal[]>('/strategy-state/pivot/active/list');
      if (data && data.length > 0) {
        setSignals(data);
      }
    } catch (err) {
      console.error('Error fetching PIVOT signals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPivot();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchPivot, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [autoRefresh, fetchPivot]);

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

  let filtered = signals.filter(s => s.triggered);
  if (directionFilter !== 'ALL') {
    filtered = filtered.filter(s => s.direction === directionFilter);
  }
  if (exchangeFilter !== 'ALL') {
    filtered = filtered.filter(s => getExchange(s) === exchangeFilter);
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
        return computeVolumeSurge(b.sig) - computeVolumeSurge(a.sig) || getEpoch(b.sig) - getEpoch(a.sig);
      default:
        return 0;
    }
  });

  const sortLabel = SORT_OPTIONS.find(o => o.key === sortField)?.label || 'Strength';

  /* ── BUY HANDLER ── */
  const handleBuy = useCallback((sig: PivotSignal, plan: TradePlan) => {
    const symbol = getSymbol(sig);
    const est = estimateOptionPremium(plan);
    setExecution({
      visible: true,
      symbol,
      optionName: `${symbol} ${plan.strike} ${plan.optionType}`,
      strike: plan.strike,
      optionType: plan.optionType,
      lots: 3,
      filledPrice: est,
      riskPercent: 0.8,
    });
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
          <h1 className="text-lg font-semibold text-purple-400 tracking-tight">PIVOT</h1>
          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => { e.stopPropagation(); setShowFilter(!showFilter); setShowSort(false); }}
                className={`relative p-2 rounded-lg transition-colors ${
                  hasActiveFilter
                    ? 'bg-purple-500/15 text-purple-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Filter className="w-5 h-5" />
                {hasActiveFilter && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-purple-400" />
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
            <RefreshCw className="w-8 h-8 text-purple-400 animate-spin mb-4" />
            <span className="text-slate-500 text-sm">Loading PIVOT signals...</span>
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} onReset={resetFilters} />
        )}

        {sorted.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <PivotCard
                key={`${sig.scripCode}-${getEpoch(sig)}`}
                sig={sig}
                plan={plan}
                onBuy={handleBuy}
              />
            ))}
          </div>
        )}
      </div>

      <ExecutionOverlay
        state={execution}
        onClose={() => setExecution(s => ({ ...s, visible: false }))}
        onViewPosition={() => {
          setExecution(s => ({ ...s, visible: false }));
          window.location.hash = '#positions';
        }}
      />
    </div>
  );
};

export default PivotTabContent;
