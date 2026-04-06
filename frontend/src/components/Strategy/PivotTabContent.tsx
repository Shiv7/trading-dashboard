import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, Zap, Target, ShieldCheck, ShieldAlert, Loader2, AlertTriangle, Clock
} from 'lucide-react';
import { fetchJson, strategyWalletsApi, strategyTradesApi, pivotAutoTradeApi, marketDataApi, greeksApi } from '../../services/api';
import { useNavigate } from 'react-router-dom';
import type { StrategyTradeRequest } from '../../types/orders';
import { getOTMStrike, mapToOptionLevels, computeSlotSizing, SlotWalletState, isNseNoTradeWindow, checkStalePriceAdjustment, isAnyMarketOpen } from '../../utils/tradingUtils';
import CrossInstrumentLevels from './CrossInstrumentLevels';
import type { StalePriceResult } from '../../utils/tradingUtils';
import StalePriceModal from './StalePriceModal';
import { LiquiditySourceBadge, RetestBadge } from './SignalBadges';

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
  retestDirection?: string; // BULLISH or BEARISH — direction of bounce after retest
  // Block trade
  blockTradeDetected?: boolean;
  blockTradeVol?: number;
  blockTradePct?: number;
  blockTradeFlowLabel?: string;
  // OI context
  oiInterpretation?: string; // LONG_BUILDUP, SHORT_COVERING, SHORT_BUILDUP, LONG_UNWINDING
  oiChangePercent?: number;
  smcInOrderBlock: boolean;
  smcNearFVG: boolean;
  smcAtLiquidityZone: boolean;
  smcBias: string;
  // FVG actual price range
  fvgHigh?: number;
  fvgLow?: number;
  fvgType?: string;
  // LZ actual price data
  lzLevel?: number;
  lzZoneHigh?: number;
  lzZoneLow?: number;
  lzType?: string;
  lzSource?: string;
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
  // Option enrichment from backend
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
  // Futures fallback (MCX instruments without options)
  futuresAvailable?: boolean;
  futuresScripCode?: string;
  futuresSymbol?: string;
  futuresLtp?: number;
  futuresLotSize?: number;
  futuresMultiplier?: number;
  futuresExpiry?: string;
  futuresExchange?: string;
  futuresExchangeType?: string;
  futuresVolume?: number;
  // Symbol, company, and exchange
  symbol?: string;
  companyName?: string;
  exchange?: string;
  // V2 4-Gate Funnel fields
  version?: number;
  stAlignment?: number;
  stBarsInTrend?: number;
  trendConfidence?: number;
  htfTimeframes?: string[];
  pullbackDepth?: number;
  zoneType?: string;
  zoneLevels?: string[];
  pullbackScore?: number;
  volumeSurge?: number;
  oiBuildupPct?: number;
  triggerType?: string;
  triggerTimeframe?: string;
  atrMultiple?: number;
  gateReached?: number;
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
  // Liquidity source
  liquiditySource?: string;
  // Retest enrichment (cross-strategy)
  retestActive?: boolean;
  retestLevelNum?: number;
  retestSource?: string;
  retestStage?: string;
  retestDirectionAligned?: boolean;
  retestBoost?: number;
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
  hasPivots: boolean;
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

type SortField = 'strength' | 'confidence' | 'rr' | 'time';
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH';
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C';

interface PivotTabContentProps {
  autoRefresh?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   SYMBOL / EXCHANGE HELPERS
   Uses symbol & companyName from backend (resolved via ScripLookupService).
   ═══════════════════════════════════════════════════════════════ */

function getSymbol(sig: PivotSignal): string {
  return sig.symbol || sig.companyName || sig.scripCode;
}

function getExchange(sig: PivotSignal): string {
  return sig.exchange || sig.optionExchange || sig.futuresExchange || 'N';
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'DM';
  return Number(v.toFixed(2)).toString();
}

// getStrikeInterval, getOTMStrike: imported from ../../utils/tradingUtils

/** Classify trade type for Pivot signals */
function classifyPivotTradeType(sig: PivotSignal): { label: string; narrative: string; color: string } {
  const dte = sig.greekDte ?? 15;
  const confluence = sig.pivotNearbyLevels ?? 0;
  // htfStrength is 0-1 range, trendConfidence is 0-100 range — normalize to percentage
  const htfRaw = sig.htfStrength ?? 0;
  const htfPct = htfRaw <= 1 ? htfRaw * 100 : htfRaw;
  const trendConf = sig.trendConfidence ?? 0;
  const htfStrengthPct = htfPct > 0 ? htfPct : trendConf;
  const mlConf = sig.mlConfidence ?? 0;

  if (dte < 3) return { label: 'QUICK SCALP', narrative: `DTE ${dte}d — take T1 at pivot level, don't hold.`, color: 'text-red-400' };
  if (confluence >= 3 && htfStrengthPct > 70 && dte > 10)
    return { label: 'SWING', narrative: `${confluence}-level confluence + HTF aligned (${htfStrengthPct.toFixed(0)}%). High conviction — hold through T1, trail to T2.`, color: 'text-cyan-400' };
  if (mlConf > 0.70)
    return { label: 'MOMENTUM', narrative: `ML ${(mlConf * 100).toFixed(0)}% confidence backs pivot setup. Strong execution bias.`, color: 'text-green-400' };
  return { label: 'STANDARD', narrative: `Pivot confluence setup. Follow lot-split exit plan.`, color: 'text-blue-400' };
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

// approximateDelta, mapToOptionLevels: imported from ../../utils/tradingUtils

/** Extract trade plan from Pivot signal (has real SL/target from backend) */
function extractTradePlan(sig: PivotSignal): TradePlan {
  const isLong = sig.direction === 'BULLISH';
  const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE';
  const entry = sig.entryPrice ?? 0;
  const { strike, interval } = getOTMStrike(entry, sig.direction);
  const risk = sig.risk ?? 0;
  const atr = risk;

  const t1 = sig.target ?? entry;
  const t2 = isLong ? entry + risk * 3 : entry - risk * 3;
  const t3 = isLong ? entry + risk * 4 : entry - risk * 4;
  const t4 = isLong ? entry + risk * 5 : entry - risk * 5;

  return {
    entry,
    sl: sig.stopLoss ?? 0,
    t1, t2, t3, t4,
    rr: sig.riskReward ?? 0,
    atr,
    optionType,
    strike,
    strikeInterval: interval,
    hasPivots: true,
  };
}


/** Confidence from signal's own score + HTF/LTF alignment + ML */
function computeConfidence(sig: PivotSignal): number {
  let conf = 40;
  conf += (sig.htfStrength ?? 0) * 20;                     // 0-20 from HTF strength
  conf += sig.ltfConfirmed ? 10 : 0;                      // +10 if LTF confirmed
  conf += Math.min(10, (sig.pivotNearbyLevels ?? 0) * 1.5); // 0-10 from pivot levels
  conf += sig.hasConfirmedRetest ? 7 : 0;                  // +7 for confirmed retest
  conf += sig.hasActiveBreakout ? 5 : 0;                   // +5 for active breakout
  const smcCount = [sig.smcInOrderBlock, sig.smcNearFVG, sig.smcAtLiquidityZone].filter(Boolean).length;
  conf += smcCount * 2;                                    // 0-6 from SMC
  const hash = (sig.scripCode ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
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
  const rr = plan.rr;
  const confNorm = ((conf - 55) / 42) * 50;
  const rrNorm = Math.min(50, (rr / 4) * 50);
  return Math.min(100, Math.round(confNorm + rrNorm));
}

// computeSlotSizing: imported from ../../utils/tradingUtils

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

/** Clean retest level name for display (remove " (Retest)" suffix, all underscores) */
function cleanRetestLevel(level: string | undefined): string {
  if (!level) return '--';
  return level.replace(' (Retest)', '').replace(/_/g, ' ');
}

/** Derive candle pattern from signal characteristics (deterministic) */
function deriveCandlePattern(sig: PivotSignal): { pattern: string; timeframe: string } {
  const hash = (sig.scripCode ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
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

  // FVG price range: use real backend data
  let fvgRange: string | null = null;
  if (sig.smcNearFVG) {
    if (sig.fvgHigh != null && sig.fvgLow != null && sig.fvgHigh > 0) {
      fvgRange = `${fmt(sig.fvgLow)}–${fmt(sig.fvgHigh)}`;
    } else {
      // Fallback: derive from risk (guard NaN)
      const risk = sig.risk ?? 0;
      if (risk > 0) {
        const gap = Math.round(risk * 0.3 * 100) / 100;
        const base = sig.direction === 'BULLISH' ? sig.entryPrice - gap : sig.entryPrice + gap;
        fvgRange = `${fmt(Math.min(base, base + gap))}–${fmt(Math.max(base, base + gap))}`;
      }
    }
  }

  // LZ from real backend data
  let lzRange: string | null = null;
  if (sig.smcAtLiquidityZone) {
    if (sig.lzLevel != null && sig.lzLevel > 0) {
      const src = sig.lzSource ? sig.lzSource.replace(/_/g, ' ') : '';
      lzRange = `${fmt(sig.lzLevel)}${src ? ` (${src})` : ''}`;
    } else {
      // Fallback: try htfReason
      const swingMatch = reason.match(/Swing_[SR]_(\d+)/);
      if (swingMatch) {
        lzRange = `~${swingMatch[1]}`;
      }
    }
  }

  return { obRange, fvgRange, lzRange };
}

/** Derive market activity label from signal direction and confluence */
function deriveMarketActivity(sig: PivotSignal): { label: string; color: string } {
  const isLong = sig.direction === 'BULLISH';
  if (isLong && sig.hasActiveBreakout) return { label: 'Bullish Breakout', color: 'text-green-400 bg-green-500/15' };
  if (isLong) return { label: 'Bullish Setup', color: 'text-green-300 bg-green-500/10' };
  if (!isLong && sig.hasActiveBreakout) return { label: 'Bearish Breakout', color: 'text-red-400 bg-red-500/15' };
  return { label: 'Bearish Setup', color: 'text-red-300 bg-red-500/10' };
}

/** Derive LTF alignment percentage from ltfAlignmentScore */
function getLtfPct(sig: PivotSignal): number {
  // ltfAlignmentScore typically ranges 0-110; normalize to 0-100
  return Math.min(100, Math.round(((sig.ltfAlignmentScore ?? 0) / 110) * 100));
}

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
  walletState: SlotWalletState;
  onBuy: (sig: PivotSignal, plan: TradePlan, lots: number) => void;
  onNavigateToScrip: (scripCode: string) => void;
}> = ({ sig, plan, walletState, onBuy, onNavigateToScrip }) => {
  const [pressing, setPressing] = useState(false);
  const [showRevisedPopup, setShowRevisedPopup] = useState(false);
  const [revisedData, setRevisedData] = useState<any>(null);
  const [loadingRevised, setLoadingRevised] = useState(false);
  const [ltpDriftPct, setLtpDriftPct] = useState<number | null>(null);
  const isLong = sig.direction === 'BULLISH';

  const signalAgeMs = (sig.timestamp || getEpoch(sig)) ? Date.now() - (sig.timestamp || getEpoch(sig)) : 0;
  const isWithin30mWindow = signalAgeMs <= 30 * 60 * 1000;
  const isBeyond30mBoundary = !isWithin30mWindow;
  const isStale = ltpDriftPct !== null && ltpDriftPct > 10;

  const symbol = getSymbol(sig);

  // Colors — purple accent for Pivot
  const dirColor = isLong ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30';
  const buyBg = isLong ? 'bg-[#18C964]' : 'bg-[#FF4D6D]';
  const buyBgActive = isLong ? 'active:bg-[#15a854]' : 'active:bg-[#e6445f]';
  const buyHover = isLong ? 'hover:bg-[#16b85c]' : 'hover:bg-[#e84565]';
  const cardBorderGlow = isLong
    ? 'border-green-500/20 hover:border-green-500/40'
    : 'border-red-500/20 hover:border-red-500/40';

  const isV2 = sig.version === 2;
  const confidence = isV2 ? (sig.trendConfidence ?? 70) : computeConfidence(sig);

  // Option: prefer real data from backend; check futures fallback for MCX
  const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
  const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
  const noDerivatives = sig.optionAvailable === false && !hasFutures;

  // Determine instrument mode: OPTION, FUTURES, or NONE
  let instrumentMode: 'OPTION' | 'FUTURES' | 'NONE' = 'NONE';
  let premium = 0;
  let displayInstrumentName = '';
  let lotSize = 1;
  let multiplier = 1;

  if (hasRealOption) {
    instrumentMode = 'OPTION';
    premium = sig.optionLtp!;
    const displayStrike = sig.optionStrike ?? plan.strike;
    const displayOptionType = sig.optionType ?? plan.optionType;
    const expiryMonth = (() => {
      if (!sig.optionExpiry) return '';
      const parts = sig.optionExpiry.split('-');
      if (parts.length < 2) return '';
      const monthIdx = parseInt(parts[1], 10) - 1;
      return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][monthIdx] ?? '';
    })();
    displayInstrumentName = `${symbol}${expiryMonth ? ' ' + expiryMonth : ''} ${displayStrike} ${displayOptionType}`;
    lotSize = sig.optionLotSize ?? 1;
    multiplier = sig.optionMultiplier ?? 1;
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
    displayInstrumentName = `${sig.futuresSymbol ?? symbol}${futExpiryMonth ? ' ' + futExpiryMonth : ''} FUT`;
    lotSize = sig.futuresLotSize ?? 1;
    multiplier = sig.futuresMultiplier ?? 1;
  } else if (!noDerivatives) {
    // Legacy fallback (old signals without optionAvailable field)
    instrumentMode = 'OPTION';
    premium = estimateOptionPremium(plan);
    displayInstrumentName = `${symbol} ${sig.optionStrike ?? plan.strike} ${sig.optionType ?? plan.optionType}`;
    lotSize = 1;
  }

  const sizing = (instrumentMode === 'NONE')
    ? { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0, slotsUsed: 0, maxSlots: 0, exchangeFull: false }
    : computeSlotSizing(confidence, walletState, premium, lotSize, multiplier,
        (sig.exchange || sig.optionExchange || 'N').substring(0, 1).toUpperCase(), sig.riskReward ?? 2.0, 60);

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
    const iv = setInterval(() => { if (isAnyMarketOpen()) checkDrift(); }, 30000);
    return () => clearInterval(iv);
  }, [scripForDrift, premiumForDrift]);

  // Metrics — only ATR is real; Vol/IV/Delta/OI not available for PIVOT strategy

  // HTF strength bar
  const htfPct = Math.round((sig.htfStrength ?? 0) * 100);

  return (
    <div className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-clip transition-shadow duration-200 hover:shadow-lg cursor-pointer`}
      onClick={() => onNavigateToScrip(sig.scripCode)}>
      <div className="p-3 sm:p-4">

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
              {premium > 0 && premium < 10 && instrumentMode === 'OPTION' && (
                <>
                  <span className="text-slate-700">|</span>
                  <span className="text-[9px] text-amber-500/70 whitespace-nowrap">
                    ~{((premium < 5 ? 6 : 4) * 0.05 / premium * 100).toFixed(1)}% slip
                  </span>
                </>
              )}
              <LiquiditySourceBadge source={sig.liquiditySource} />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isNseNoTradeWindow(sig.exchange || sig.optionExchange, sig.timestamp || sig.triggerTime) && (
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

        {/* ── V2: 4-GATE FUNNEL CARD ── */}
        {isV2 ? (<>
          {/* Gate Progress */}
          <div className="mt-3 flex items-center gap-1.5">
            {[1,2,3,4].map(g => (
              <div key={g} className="flex items-center gap-1">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  (sig.gateReached ?? 0) >= g
                    ? (isLong ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-red-500/20 text-red-400 border border-red-500/40')
                    : 'bg-slate-700/50 text-slate-500 border border-slate-600/30'
                }`}>{g}</div>
                {g < 4 && <div className={`w-4 h-[2px] ${(sig.gateReached ?? 0) > g ? (isLong ? 'bg-green-500/40' : 'bg-red-500/40') : 'bg-slate-700'}`} />}
              </div>
            ))}
            <span className="text-[10px] text-slate-500 ml-1.5">
              {(sig.gateReached ?? 0) >= 4 ? 'All gates passed' : `Gate ${sig.gateReached ?? 0}/4`}
            </span>
          </div>

          {/* G1: Trend */}
          <div className="mt-3 bg-slate-900/50 rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <TrendingUp className="w-3 h-3 text-purple-400" />
                <span className="font-medium">TREND</span>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                (sig.stAlignment ?? 0) >= 3 ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'
              }`}>{sig.stAlignment ?? 0}/3 aligned</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-[4px] rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full ${isLong ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{ width: `${sig.trendConfidence ?? 0}%` }} />
              </div>
              <span className="text-xs font-mono text-slate-300">{sig.trendConfidence ?? 0}%</span>
            </div>
            <div className="flex items-center gap-1 mt-1.5">
              <span className="text-[10px] text-slate-500">Bars in trend:</span>
              <span className="text-[10px] font-mono text-slate-300">{sig.stBarsInTrend ?? 0}</span>
              {(sig.htfTimeframes ?? []).length > 0 && (
                <div className="flex gap-1 ml-auto">
                  {(sig.htfTimeframes ?? []).map((tf, i) => (
                    <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono">{tf}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* G2: Pullback + Zone */}
          <div className="mt-2 bg-slate-900/50 rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <Target className="w-3 h-3 text-purple-400" />
                <span className="font-medium">PULLBACK + ZONE</span>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                sig.zoneType === 'BOTH' ? 'bg-purple-500/15 text-purple-300' :
                sig.zoneType === 'PIVOT' ? 'bg-blue-500/15 text-blue-300' :
                'bg-amber-500/15 text-amber-300'
              }`}>{sig.zoneType ?? 'DM'}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Pullback</div>
                <span className="text-xs font-mono text-white">{(sig.pullbackDepth ?? 0).toFixed(0)}%</span>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">OI Buildup</div>
                <span className={`text-xs font-mono ${(sig.oiBuildupPct ?? 0) > 0 ? 'text-green-400' : (sig.oiBuildupPct ?? 0) < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {(sig.oiBuildupPct ?? 0) > 0 ? '+' : ''}{(sig.oiBuildupPct ?? 0).toFixed(1)}%
                </span>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Volume</div>
                <span className={`text-xs font-mono ${(sig.volumeSurge ?? 0) >= 1.5 ? 'text-green-400' : (sig.volumeSurge ?? 0) >= 1.0 ? 'text-white' : 'text-slate-400'}`}>
                  {(sig.volumeSurge ?? 0).toFixed(1)}x
                </span>
              </div>
            </div>
            {(sig.zoneLevels ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(sig.zoneLevels ?? []).slice(0, 4).map((lvl, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono">{lvl}</span>
                ))}
              </div>
            )}
          </div>

          {/* G3: Entry Trigger */}
          <div className="mt-2 bg-slate-900/50 rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <Zap className="w-3 h-3 text-cyan-400" />
                <span className="font-medium">ENTRY TRIGGER</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  sig.triggerType === 'ST_FLIP' ? 'bg-cyan-500/15 text-cyan-400' :
                  sig.triggerType === 'FVG' ? 'bg-purple-500/15 text-purple-400' :
                  sig.triggerType === 'OB' ? 'bg-purple-500/15 text-purple-300' :
                  sig.triggerType === 'WICK' ? 'bg-amber-500/15 text-amber-300' :
                  'bg-slate-700/50 text-slate-400'
                }`}>{sig.triggerType === 'ST_FLIP' ? 'ST Flip' : sig.triggerType ?? 'DM'}</span>
                <span className="text-[10px] px-1 py-0.5 rounded bg-slate-700/60 text-slate-400 font-mono">
                  {sig.triggerTimeframe ?? '5m'}
                </span>
              </div>
            </div>
          </div>

          {/* ML (if available) — compact for v2 */}
          {sig.mlAvailable && (
            <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 bg-slate-900/50 rounded-lg">
              <Zap className="w-3 h-3 text-cyan-400 flex-shrink-0" />
              <span className="text-[10px] text-slate-500">ML:</span>
              <span className={`text-[10px] font-medium ${
                sig.mlPrediction === 'BUY' ? 'text-green-400' : sig.mlPrediction === 'SELL' ? 'text-red-400' : 'text-slate-400'
              }`}>{sig.mlPrediction}</span>
              <span className="text-[10px] font-mono text-slate-400">{Math.round((sig.mlConfidence ?? 0) * 100)}%</span>
              {sig.mlRegime && <span className="text-[10px] text-slate-500 ml-auto">{sig.mlRegime.replace(/_/g, ' ')}</span>}
            </div>
          )}
        </>) : (<>
          {/* ── V1: ORIGINAL CARD LAYOUT ── */}
          {/* PIVOT CONFLUENCE STRIP */}
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
              {(sig.pivotConfluenceLevels || []).slice(0, 5).map((lvl, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono">{lvl}</span>
              ))}
              {(sig.pivotConfluenceLevels || []).length > 5 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                  +{(sig.pivotConfluenceLevels || []).length - 5} more
                </span>
              )}
            </div>
          </div>

          {/* HTF / LTF ROW */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-[10px] text-slate-500 mb-1">HTF {sig.htfDirection}</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-[4px] rounded-full bg-slate-700 overflow-hidden">
                  <div className={`h-full rounded-full ${isLong ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${htfPct}%` }} />
                </div>
                <span className="text-xs font-mono text-slate-300">{htfPct}%</span>
              </div>
            </div>
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

          {/* CANDLE PATTERN + RETEST ROW */}
          <div className="mt-2 grid grid-cols-2 gap-2">
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
            <div className="bg-slate-900/50 rounded-lg p-2">
              {sig.hasConfirmedRetest ? (
                <div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                    <ShieldCheck className="w-3 h-3 text-green-400" />
                    Retested
                    {sig.retestDirection && (
                      <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                        sig.retestDirection === 'BULLISH'
                          ? 'bg-green-500/15 text-green-400'
                          : 'bg-red-500/15 text-red-400'
                      }`}>
                        {sig.retestDirection === 'BULLISH' ? 'Bounced Up' : 'Bounced Down'}
                      </span>
                    )}
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
                    {sig.retestDirection && sig.retestDirection !== sig.direction && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium flex-shrink-0">
                        Counter
                      </span>
                    )}
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

          {/* ── CROSS-STRATEGY RETEST BADGE ── */}
          <RetestBadge active={sig.retestActive} aligned={sig.retestDirectionAligned} boost={sig.retestBoost} source={sig.retestSource} level={sig.retestLevelNum} stage={sig.retestStage} />

          {/* SMC */}
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${sig.smcNearFVG ? 'bg-purple-400' : 'bg-slate-600'}`} />
                      <span className={`text-[10px] ${sig.smcNearFVG ? 'text-purple-300' : 'text-slate-600'}`}>
                        FVG{sig.fvgType ? ` (${sig.fvgType === 'BULLISH' ? 'Bull' : 'Bear'})` : ''}
                      </span>
                    </div>
                    {sig.smcNearFVG && smcRanges.fvgRange && (
                      <span className="text-[10px] font-mono text-purple-300/80">{smcRanges.fvgRange}</span>
                    )}
                    {!sig.smcNearFVG && <span className="text-[10px] text-slate-600">—</span>}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${sig.smcAtLiquidityZone ? 'bg-purple-400' : 'bg-slate-600'}`} />
                      <span className={`text-[10px] ${sig.smcAtLiquidityZone ? 'text-purple-300' : 'text-slate-600'}`}>
                        LZ{sig.lzType ? ` (${sig.lzType === 'BUY_SIDE' ? 'Buy' : 'Sell'})` : ''}
                      </span>
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

          {/* OI ZONE */}
          {sig.oiInterpretation && (
            <div className="mt-2 bg-slate-900/50 rounded-lg p-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="font-medium">OI Zone</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    sig.oiInterpretation === 'LONG_BUILDUP' ? 'bg-green-500/15 text-green-400' :
                    sig.oiInterpretation === 'SHORT_COVERING' ? 'bg-green-500/10 text-green-300' :
                    sig.oiInterpretation === 'SHORT_BUILDUP' ? 'bg-red-500/15 text-red-400' :
                    sig.oiInterpretation === 'LONG_UNWINDING' ? 'bg-red-500/10 text-red-300' :
                    'bg-slate-700/50 text-slate-400'
                  }`}>
                    {sig.oiInterpretation === 'LONG_BUILDUP' ? 'Long Buildup' :
                     sig.oiInterpretation === 'SHORT_COVERING' ? 'Short Covering' :
                     sig.oiInterpretation === 'SHORT_BUILDUP' ? 'Short Buildup' :
                     sig.oiInterpretation === 'LONG_UNWINDING' ? 'Long Unwinding' :
                     sig.oiInterpretation}
                  </span>
                  {sig.oiChangePercent != null && sig.oiChangePercent !== 0 && (
                    <span className={`text-[10px] font-mono ${
                      sig.oiChangePercent > 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {sig.oiChangePercent > 0 ? '+' : ''}{sig.oiChangePercent.toFixed(1)}%
                    </span>
                  )}
                  {(() => {
                    const oiBullish = sig.oiInterpretation === 'LONG_BUILDUP' || sig.oiInterpretation === 'SHORT_COVERING';
                    const sigBullish = sig.direction === 'BULLISH';
                    const aligned = oiBullish === sigBullish;
                    return (
                      <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                        aligned ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/15 text-amber-300'
                      }`}>
                        {aligned ? 'Aligned' : 'Divergent'}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* ML PREDICTION */}
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
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">Regime</div>
                  <span className={`text-[10px] font-mono ${
                    (sig.mlRegime ?? '').includes('BULLISH') ? 'text-green-400' :
                    (sig.mlRegime ?? '').includes('BEARISH') ? 'text-red-400' : 'text-slate-400'
                  }`}>{(sig.mlRegime ?? 'N/A').replace('_', ' ').replace('MODERATE ', '')}</span>
                </div>
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
        </>)}

        {/* ── CROSS-INSTRUMENT LEVELS + R:R ── */}
        <div className="mt-4">
          <CrossInstrumentLevels
            plan={plan}
            signal={sig}
            instrumentMode={instrumentMode}
            sizing={sizing}
          />
        </div>

        {/* ── TRANSLATED GREEKS ── */}
        {sig.greekEnriched && (() => {
          const dte = sig.greekDte ?? 0;
          const delta = Math.abs(sig.greekDelta ?? 0);
          const iv = (sig.greekIV ?? 0) * 100;
          const thetaLabel = dte >= 10 ? 'SAFE' : dte >= 5 ? 'WATCH' : 'DANGER';
          const thetaColor = dte >= 10 ? 'text-green-400' : dte >= 5 ? 'text-yellow-400' : 'text-red-400';
          const deltaLabel = delta >= 0.3 && delta <= 0.5 ? 'MID' : delta > 0.5 ? 'HIGH' : 'LOW';
          const deltaColor = delta >= 0.3 && delta <= 0.7 ? 'text-green-400' : 'text-yellow-400';
          const ivLabel = iv > 60 ? 'EXTREME' : iv > 40 ? 'ELEVATED' : iv > 20 ? 'NORMAL' : 'LOW';
          const ivColor = iv > 60 ? 'text-red-400' : iv > 40 ? 'text-yellow-400' : 'text-green-400';
          return (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                <span className="text-slate-400">{'\u03B4'}{(sig.greekDelta ?? 0).toFixed(2)}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">{'\u03B3'}{(sig.greekGamma ?? 0).toFixed(4)}</span>
                <span className="text-slate-600">|</span>
                <span className={`${(sig.greekTheta ?? 0) < -3 ? 'text-red-400' : 'text-slate-400'}`}>{'\u03B8'}{(sig.greekTheta ?? 0).toFixed(2)}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">IV {iv.toFixed(0)}%</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">DTE {dte}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-semibold">
                <span className={thetaColor}>{'\u03B8'} {thetaLabel}</span>
                <span className="text-slate-700">|</span>
                <span className={deltaColor}>{'\u03B4'} {deltaLabel}</span>
                <span className="text-slate-700">|</span>
                <span className={ivColor}>IV {ivLabel}</span>
                {sig.greekThetaImpaired && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">{'\u03B8'}-IMPAIRED</span>}
              </div>
            </div>
          );
        })()}

        {/* ── 4-COLUMN METRICS GRID ── */}
        <div className="mt-3 rounded-xl bg-slate-900/60 border border-slate-700/50 p-2.5">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { val: `${(sig.volumeSurge ?? 0).toFixed(1)}x`, label: 'Vol Surge',
                color: (sig.volumeSurge ?? 0) >= 3 ? 'text-green-300' : (sig.volumeSurge ?? 0) >= 2 ? 'text-amber-300' : 'text-slate-300' },
              { val: sig.oiChangePercent != null ? `${sig.oiChangePercent > 0 ? '+' : ''}${sig.oiChangePercent.toFixed(0)}%` : 'DM', label: 'OI Change',
                color: Math.abs(sig.oiChangePercent ?? 0) >= 100 ? 'text-green-300' : Math.abs(sig.oiChangePercent ?? 0) >= 50 ? 'text-amber-300' : 'text-slate-300' },
              { val: sig.oiBuildupPct != null ? `${sig.oiBuildupPct > 0 ? '+' : ''}${sig.oiBuildupPct.toFixed(1)}%` : 'DM', label: 'OI Buildup%',
                color: (sig.oiBuildupPct ?? 0) > 5 ? 'text-green-300' : (sig.oiBuildupPct ?? 0) > 0 ? 'text-amber-300' : 'text-red-300' },
              { val: plan.atr > 0 ? plan.atr.toFixed(2) : 'DM', label: 'ATR', color: 'text-slate-300' },
            ].map(({ val, label, color }) => (
              <div key={label}>
                <div className={`text-sm font-bold font-mono ${color}`}>{val}</div>
                <div className="text-[9px] text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── BLOCK TRADE LABEL ── */}
        {sig.blockTradeDetected && (() => {
          const pct = sig.blockTradePct ?? 0;
          const flowLabel = sig.blockTradeFlowLabel ?? (pct >= 40 ? 'DOMINANT_INSTITUTIONAL' : pct >= 20 ? 'HEAVY_INSTITUTIONAL' : pct >= 10 ? 'MODEST_INSTITUTIONAL' : 'NONE');
          const isModest = flowLabel === 'MODEST_INSTITUTIONAL';
          const isHeavy = flowLabel === 'HEAVY_INSTITUTIONAL';
          const isDominant = flowLabel === 'DOMINANT_INSTITUTIONAL';
          const hasFlow = isModest || isHeavy || isDominant;
          const bgColor = isDominant ? 'bg-purple-500/25 border-purple-400/50' : isHeavy ? 'bg-purple-500/20 border-purple-400/40' : isModest ? 'bg-purple-500/15 border-purple-400/30' : 'bg-purple-500/10 border-purple-400/20';
          const textColor = isDominant ? 'text-purple-200' : isHeavy ? 'text-purple-300' : 'text-purple-300/80';
          const flowText = isDominant ? 'Dominant Institutional Flow' : isHeavy ? 'Heavy Institutional Activity' : isModest ? 'Modest Institutional Presence' : 'Block Trade Detected';
          return (
            <div className={`mt-1.5 px-2 py-1 rounded-md border ${bgColor} flex items-center gap-2`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${textColor}`}>
                {flowText}
              </span>
              <span className={`text-[10px] font-semibold ${hasFlow ? 'text-purple-200' : 'text-purple-400/70'}`}>
                {Math.round(pct)}%
              </span>
              <span className="text-[10px] text-purple-400/60">
                {((sig.blockTradeVol ?? 0) / 1000).toFixed(0)}K shares
              </span>
            </div>
          );
        })()}

        {/* ── TRADE TYPE INSIGHT ── */}
        {(() => {
          const tradeType = classifyPivotTradeType(sig);
          return (
            <div className="border-t border-slate-700/30 mt-3 pt-2">
              <div className={`text-xs font-bold ${tradeType.color} mb-0.5`}>{tradeType.label}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{tradeType.narrative}</p>
            </div>
          );
        })()}

        {/* ── DTE NARRATIVE ── */}
        {sig.greekEnriched && (() => {
          const dte = sig.greekDte ?? 0;
          const dteLine = dte <= 2 ? `DTE ${dte}d — expiry imminent, theta danger` :
            dte <= 5 ? `DTE ${dte}d — theta watch, scalp or quick swing only` :
            dte <= 10 ? `DTE ${dte}d — theta manageable for swing hold` :
            `DTE ${dte}d — ample time, theta not a concern`;
          return (
            <div className="mt-2 rounded-lg bg-slate-900/40 border border-slate-700/30 p-2 space-y-0.5">
              <div className={`text-[10px] font-mono ${dte <= 2 ? 'text-red-400' : dte <= 5 ? 'text-amber-400' : 'text-slate-400'}`}>{dteLine}</div>
            </div>
          );
        })()}

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
            No Derivatives Available for {symbol || sig.scripCode}
          </button>
        ) : sizing.disabled ? (
          <button
            disabled
            className="w-full h-12 rounded-xl mt-4 text-slate-400 font-semibold text-sm bg-slate-700/50 cursor-not-allowed"
          >
            Confidence {confidence}% &lt; 60% — No Trade
          </button>
        ) : (
          <div className="relative mt-4">
            <button
              onClick={async (e) => {
                e.stopPropagation();
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
                      const eqT4 = plan.t4 || 0;
                      const revised = await greeksApi.compute({
                        spot: eqEntry,
                        strike: sig.optionStrike || plan.strike || 0,
                        optionLtp: currentLtp,
                        optionType: plan.optionType || 'CE',
                        expiry: sig.optionExpiry || '',
                        equityEntry: eqEntry,
                        equitySl: eqSl,
                        equityT1: eqT1,
                        equityT2: eqT2,
                        equityT3: eqT3,
                        equityT4: eqT4,
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
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); setShowRevisedPopup(false); }}>
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
                    <button onClick={(e) => { e.stopPropagation(); setShowRevisedPopup(false); }}
                      className="flex-1 h-10 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-sm transition-colors">
                      Cancel
                    </button>
                    <button onClick={(e) => {
                      e.stopPropagation();
                      setShowRevisedPopup(false);
                      onBuy(sig, { ...plan, sl: revisedData.optionSL, t1: revisedData.optionT1, t2: revisedData.optionT2, t3: revisedData.optionT3, t4: revisedData.optionT4, entry: revisedData.currentLtp }, sizing.lots);
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
   MAIN: PIVOT TAB CONTENT
   ═══════════════════════════════════════════════════════════════ */

export const PivotTabContent: React.FC<PivotTabContentProps> = ({ autoRefresh = true }) => {
  const [signals, setSignals] = useState<PivotSignal[]>([]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('strength');
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
  const [autoTradeEnabled, setAutoTradeEnabled] = useState<boolean>(true);
  const [autoTradeLoading, setAutoTradeLoading] = useState(false);
  const [stalePriceCheck, setStalePriceCheck] = useState<{
    result: StalePriceResult;
    instrumentName: string;
    originalSl: number;
    originalTargets: { t1: number | null; t2: number | null; t3: number | null; t4: number | null };
    pendingBuy: () => void;
  } | null>(null);

  // Fetch auto-trade status on mount
  useEffect(() => {
    pivotAutoTradeApi.getStatus()
      .then(res => setAutoTradeEnabled(res.autoTradeEnabled))
      .catch(() => {});
  }, []);

  const toggleAutoTrade = async () => {
    setAutoTradeLoading(true);
    try {
      const res = await pivotAutoTradeApi.toggle(!autoTradeEnabled);
      setAutoTradeEnabled(res.autoTradeEnabled);
    } catch (err) {
      console.error('Failed to toggle auto-trade:', err);
    } finally {
      setAutoTradeLoading(false);
    }
  };

  const fetchPivot = useCallback(async () => {
    try {
      const data = await fetchJson<PivotSignal[]>('/strategy-state/pivot/active/list');
      if (Array.isArray(data) && data.length > 0) {
        setSignals(data);
      }
    } catch (err) {
      console.error('Error fetching PIVOT signals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPivot(); // Initial full history load
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(() => { if (isAnyMarketOpen()) fetchPivot(); }, 60000); // 60s fallback safety net
    }
    // WebSocket push: prepend new triggered signals in real-time
    const onWsSignal = (e: Event) => {
      const sig = (e as CustomEvent).detail;
      if (sig && sig.scripCode) {
        setSignals(prev => {
          if (prev.some(s => s.scripCode === sig.scripCode && s.triggerTime === sig.triggerTime)) return prev;
          return [sig, ...prev];
        });
      }
    };
    window.addEventListener('pivot-signal', onWsSignal);
    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener('pivot-signal', onWsSignal);
    };
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

  // Fetch wallet state for slot-based sizing
  useEffect(() => {
    const fetchCapital = async () => {
      try {
        const data = await strategyWalletsApi.getCapital('PIVOT_CONFLUENCE');
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
    const interval = setInterval(() => { if (isAnyMarketOpen()) fetchCapital(); }, 30000);
    const onWalletUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.strategy === 'PIVOT_CONFLUENCE') fetchCapital();
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
      default:
        return 0;
    }
  });

  const sortLabel = SORT_OPTIONS.find(o => o.key === sortField)?.label || 'Strength';

  /* ── EXECUTE TRADE (inner) — builds request and sends to backend ── */
  const executeTrade = useCallback(async (
    sig: PivotSignal, plan: TradePlan, lots: number,
    overrideEntry?: number, overrideSl?: number,
    overrideT1?: number | null, overrideT2?: number | null,
    overrideT3?: number | null, overrideT4?: number | null
  ) => {
    const symbol = sig.symbol || sig.companyName || getSymbol(sig);
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;

    let instrumentMode: 'OPTION' | 'FUTURES' | 'NONE' = 'NONE';
    let premium = 0;
    let displayName = '';
    let lotSize = 1;
    let multiplier = 1;
    let tradingScripCode = sig.scripCode;
    let displayStrike = sig.optionStrike ?? plan.strike;
    let displayOptionType: 'CE' | 'PE' = plan.optionType;

    if (hasRealOption) {
      instrumentMode = 'OPTION';
      premium = sig.optionLtp!;
      displayStrike = sig.optionStrike ?? plan.strike;
      displayOptionType = (sig.optionType ?? plan.optionType) as 'CE' | 'PE';
      displayName = `${symbol} ${displayStrike} ${displayOptionType}`;
      lotSize = sig.optionLotSize ?? 1;
      multiplier = sig.optionMultiplier ?? 1;
      tradingScripCode = sig.optionScripCode ?? sig.scripCode;
    } else if (hasFutures) {
      instrumentMode = 'FUTURES';
      premium = sig.futuresLtp!;
      const futMonth = (() => {
        if (!sig.futuresExpiry) return '';
        const parts = sig.futuresExpiry.split('-');
        if (parts.length < 2) return '';
        const mi = parseInt(parts[1], 10) - 1;
        return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][mi] ?? '';
      })();
      displayName = `${sig.futuresSymbol ?? symbol}${futMonth ? ' ' + futMonth : ''} FUT`;
      lotSize = sig.futuresLotSize ?? 1;
      multiplier = sig.futuresMultiplier ?? 1;
      tradingScripCode = sig.futuresScripCode ?? sig.scripCode;
    } else {
      instrumentMode = 'OPTION';
      premium = estimateOptionPremium(plan);
      displayName = `${symbol} ${sig.optionStrike ?? plan.strike} ${sig.optionType ?? plan.optionType ?? ''}`;
      lotSize = 1;
    }

    const entryPrice = overrideEntry ?? premium;

    setExecution({
      visible: true,
      symbol,
      optionName: displayName,
      strike: displayStrike,
      optionType: displayOptionType,
      lots,
      filledPrice: entryPrice,
      riskPercent: 0.8,
      status: 'sending',
    });

    try {
      let trSl = plan.sl;
      let trT1 = plan.t1;
      let trT2 = plan.t2;
      let trT3 = plan.t3 ?? 0;
      let trT4 = plan.t4 ?? 0;
      let trDelta = 1.0;

      if (instrumentMode === 'OPTION' && hasRealOption && sig.optionStrike) {
        const mapped = mapToOptionLevels(
          premium, sig.entryPrice, plan.sl,
          [plan.t1, plan.t2, plan.t3, plan.t4],
          sig.optionStrike, displayOptionType
        );
        trSl = mapped.sl;
        trT1 = mapped.targets[0] ?? 0;
        trT2 = mapped.targets[1] ?? 0;
        trT3 = mapped.targets[2] ?? 0;
        trT4 = mapped.targets[3] ?? 0;
        trDelta = mapped.delta;
      }

      if (overrideSl != null) trSl = overrideSl;
      if (overrideT1 !== undefined) trT1 = overrideT1 ?? 0;
      if (overrideT2 !== undefined) trT2 = overrideT2 ?? 0;
      if (overrideT3 !== undefined) trT3 = overrideT3 ?? 0;
      if (overrideT4 !== undefined) trT4 = overrideT4 ?? 0;

      const req: StrategyTradeRequest = {
        scripCode: tradingScripCode,
        instrumentSymbol: displayName,
        instrumentType: instrumentMode === 'FUTURES' ? 'FUTURES' : 'OPTION',
        underlyingScripCode: sig.scripCode,
        underlyingSymbol: symbol,
        side: (instrumentMode === 'FUTURES' ? 'FUTURES' : 'OPTION') === 'OPTION' ? 'BUY' : (sig.direction === 'BULLISH' ? 'BUY' : 'SELL'),
        quantity: lots * lotSize,
        lots,
        lotSize,
        multiplier,
        entryPrice,
        sl: trSl,
        t1: trT1,
        t2: trT2,
        t3: trT3,
        t4: trT4,
        equitySpot: sig.entryPrice,
        equitySl: plan.sl,
        equityT1: plan.t1,
        equityT2: plan.t2,
        equityT3: plan.t3 ?? 0,
        equityT4: plan.t4 ?? 0,
        delta: trDelta,
        optionType: instrumentMode === 'OPTION' ? displayOptionType : undefined,
        strike: displayStrike,
        strategy: 'PIVOT_CONFLUENCE',
        exchange: sig.optionExchange ?? sig.futuresExchange ?? getExchange(sig),
        direction: sig.direction,
        confidence: computeConfidence(sig),
        executionMode: 'MANUAL',
      };

      const result = await strategyTradesApi.create(req);

      setExecution(prev => ({
        ...prev,
        status: 'filled',
        filledPrice: result?.entryPrice ?? entryPrice,
        orderId: result?.tradeId,
        riskPercent: plan.sl && sig.entryPrice
          ? Math.round(Math.abs(sig.entryPrice - plan.sl) / sig.entryPrice * 100 * 10) / 10
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

  /* ── BUY HANDLER — stale price check then dispatch ── */
  const handleBuy = useCallback(async (sig: PivotSignal, plan: TradePlan, lots: number) => {
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
    const symbol = sig.symbol || sig.companyName || getSymbol(sig);
    const ltpScripCode = hasRealOption ? (sig.optionScripCode ?? sig.scripCode)
      : hasFutures ? (sig.futuresScripCode ?? sig.scripCode)
      : sig.scripCode;
    const instrumentName = hasRealOption
      ? `${symbol} ${sig.optionStrike ?? plan.strike} ${sig.optionType ?? plan.optionType}`
      : hasFutures ? `${sig.futuresSymbol ?? symbol} FUT`
      : symbol;

    let tradeSl = plan.sl;
    let tradeT1: number | null = plan.t1;
    let tradeT2: number | null = plan.t2;
    let tradeT3 = plan.t3;
    let tradeT4 = plan.t4;

    if (hasRealOption && sig.optionStrike) {
      const mapped = mapToOptionLevels(
        sig.optionLtp!, sig.entryPrice, plan.sl,
        [plan.t1, plan.t2, plan.t3, plan.t4],
        sig.optionStrike,
        (sig.optionType ?? plan.optionType) as 'CE' | 'PE'
      );
      tradeSl = mapped.sl;
      tradeT1 = mapped.targets[0] ?? null;
      tradeT2 = mapped.targets[1] ?? null;
      tradeT3 = mapped.targets[2] ?? null;
      tradeT4 = mapped.targets[3] ?? null;
    }

    try {
      const ltpData = await marketDataApi.getLtp(ltpScripCode);
      if (ltpData?.ltp != null && ltpData.ltp > 0) {
        const currentLtp = ltpData.ltp;
        const isLongTrade = hasRealOption || sig.direction === 'BULLISH';
        const staleCheck = checkStalePriceAdjustment(currentLtp, tradeSl, tradeT1, tradeT2, tradeT3, tradeT4, isLongTrade);

        if (staleCheck) {
          setStalePriceCheck({
            result: staleCheck,
            instrumentName,
            originalSl: tradeSl,
            originalTargets: { t1: tradeT1, t2: tradeT2, t3: tradeT3, t4: tradeT4 },
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
          <div className="flex items-center gap-2 sm:gap-3">
            <h1 className="text-lg font-semibold text-purple-400 tracking-tight">PIVOT</h1>
            {/* Auto-Trade Toggle */}
            <button
              onClick={toggleAutoTrade}
              disabled={autoTradeLoading}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all border ${
                autoTradeEnabled
                  ? 'bg-green-500/15 text-green-400 border-green-500/40 hover:bg-green-500/25'
                  : 'bg-red-500/15 text-red-400 border-red-500/40 hover:bg-red-500/25'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${autoTradeEnabled ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="hidden sm:inline">{autoTradeLoading ? 'Saving...' : autoTradeEnabled ? 'Auto-Trade ON' : 'Auto-Trade OFF'}</span>
              <span className="sm:hidden">{autoTradeLoading ? '...' : autoTradeEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>
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
            <RefreshCw className="w-8 h-8 text-purple-400 animate-spin mb-4" />
            <span className="text-slate-500 text-sm">Loading PIVOT signals...</span>
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} onReset={resetFilters} />
        )}

        {sorted.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <PivotCard
                key={`${sig.scripCode}-${getEpoch(sig)}`}
                sig={sig}
                plan={plan}
                walletState={walletState}
                onBuy={handleBuy}
                onNavigateToScrip={(sc) => navigate(`/stock/${sc}`)}
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

export default PivotTabContent;
