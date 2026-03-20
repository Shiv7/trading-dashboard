import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, Zap, AlertTriangle, Loader2, BarChart2, Clock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchJson, strategyTradesApi, strategyWalletsApi, marketDataApi, greeksApi } from '../../services/api';
import type { StrategyTradeRequest } from '../../types/orders';
import { getOTMStrike, mapToOptionLevels, computeSlotSizing, SlotWalletState, isNseNoTradeWindow, checkStalePriceAdjustment } from '../../utils/tradingUtils';
import type { StalePriceResult } from '../../utils/tradingUtils';
import FundTopUpModal from '../Wallet/FundTopUpModal';
import StalePriceModal from './StalePriceModal';
import CrossInstrumentLevels from './CrossInstrumentLevels';

type SortField = 'strength' | 'confidence' | 'rr' | 'time' | 'volume' | 'oi' | 'timestamp';
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH';
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C';

/* ═══════════════════════════════════════════════════════════════
   TYPES & INTERFACES
   ═══════════════════════════════════════════════════════════════ */

interface FudkoiTrigger {
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
  rank: number;
  volumeTMinus1: number;
  volumeT: number;
  volumeTPlus1: number;
  avgVolume: number;
  surgeTMinus1: number;
  surgeT: number;
  surgeTPlus1: number;
  cachedAt: number;
  target1?: number | null;
  target2?: number | null;
  target3?: number | null;
  target4?: number | null;
  stopLoss?: number;
  riskReward?: number;
  pivotSource?: boolean;
  atr30m?: number;
  oiChangeRatio?: number;
  oiChangePct?: number;
  oiInterpretation?: string;
  oiLabel?: string;
  blockTradeDetected?: boolean;
  blockTradeVol?: number;
  blockTradePct?: number;
  blockTradeFlowLabel?: string;
  oiBuildupPct?: number;
  signalSource?: string;
  // Gap Quality Score (GQS)
  gapQualityScore?: number;
  gqsGapAtrRatio?: number;
  gqsCandleScore?: number;
  gqsBlockFactor?: number;
  gqsDivergenceScore?: number;
  gqsRecoveryScore?: number;
  gqsCandleOpposesGap?: boolean;
  gqsGapRecoveryPct?: number;
  effectiveKii?: number;
  gapPct?: number;
  // Option enrichment from backend
  optionAvailable?: boolean;
  optionFailureReason?: string;
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
  t1: number | null;
  t2: number | null;
  t3: number | null;
  t4: number | null;
  rr: number;
  hasPivots: boolean;
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

interface FudkoiTabContentProps {
  autoRefresh?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'DM';
  return Number(v.toFixed(2)).toString();
}

function computeConfidence(sig: FudkoiTrigger): number {
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
  // OI bonus: high OI surge signals get extra confidence — scaled for real OI% values
  const oiVal = Math.abs(sig.oiChangeRatio ?? 0);
  const oiBoost = Math.min(10, (oiVal / 300) * 10);
  conf += oiBoost;
  return Math.min(97, Math.max(55, Math.round(conf)));
}

function formatTriggerTime(sig: FudkoiTrigger): string {
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

/** Real volume surge from backend (T candle volume / 6-candle avg); falls back to 0 if unavailable */
function computeVolumeSurge(sig: FudkoiTrigger): number {
  if (sig.surgeT != null && sig.surgeT > 0) return Math.round(sig.surgeT * 10) / 10;
  return 0;
}

function extractTradePlan(sig: FudkoiTrigger): TradePlan {
  const isLong = sig.direction === 'BULLISH';
  const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE';
  const { strike, interval } = getOTMStrike(sig.triggerPrice, sig.direction);

  const bw = (sig.bbUpper || 0) - (sig.bbLower || 0);
  const atr = sig.atr30m && sig.atr30m > 0
    ? sig.atr30m
    : bw > 0 ? bw / 2.5 : sig.triggerPrice * 0.004;

  if (sig.target1 != null && sig.stopLoss != null) {
    return {
      entry: sig.triggerPrice,
      sl: sig.stopLoss,
      t1: sig.target1 ?? null,
      t2: sig.target2 ?? null,
      t3: sig.target3 ?? null,
      t4: sig.target4 ?? null,
      rr: sig.riskReward ?? 0,
      hasPivots: sig.pivotSource === true,
      atr,
      optionType,
      strike,
      strikeInterval: interval,
    };
  }

  const sl = sig.superTrend || (isLong
    ? sig.triggerPrice - atr * 2
    : sig.triggerPrice + atr * 2);
  const risk = Math.abs(sig.triggerPrice - sl);
  const t1 = isLong ? sig.triggerPrice + risk * 2 : sig.triggerPrice - risk * 2;
  const t2 = isLong ? sig.triggerPrice + risk * 3 : sig.triggerPrice - risk * 3;
  const rr = risk > 0 ? (Math.abs(t1 - sig.triggerPrice) / risk) : 0;

  return {
    entry: sig.triggerPrice,
    sl, t1, t2, t3: null, t4: null,
    rr,
    hasPivots: false,
    atr,
    optionType,
    strike,
    strikeInterval: interval,
  };
}


function computeOIChange(sig: FudkoiTrigger): number {
  if (sig.oiChangeRatio != null) return Math.round(sig.oiChangeRatio * 10) / 10;
  return 0;
}

function computeKoiScore(sig: FudkoiTrigger): { total: number; oiMomentum: number; oiBuildup: number; volConfirm: number; acceleration: number; block: number } {
  const oiMomentumScore = Math.min(100, Math.abs(sig.oiChangePct ?? sig.oiChangeRatio ?? 0) * 0.5);
  const oiBuildupScore = Math.min(100, Math.max(0, sig.oiBuildupPct ?? 0) * 2);
  const volumeConfirmation = Math.min(100, (sig.surgeT ?? 0) * 50);
  const accelerationScore = 30; // OI velocity not yet in signal
  const blockDealScore = Math.min(100, (sig.blockTradePct ?? 0) * 2.5);
  const total = Math.round(oiMomentumScore * 0.35 + oiBuildupScore * 0.25 + volumeConfirmation * 0.15 + accelerationScore * 0.15 + blockDealScore * 0.10);
  return { total, oiMomentum: Math.round(oiMomentumScore * 0.35), oiBuildup: Math.round(oiBuildupScore * 0.25), volConfirm: Math.round(volumeConfirmation * 0.15), acceleration: Math.round(accelerationScore * 0.15), block: Math.round(blockDealScore * 0.10) };
}

function classifyFudkoiTradeType(sig: FudkoiTrigger): { label: string; narrative: string; color: string } {
  const dte = sig.greekDte ?? 15;
  const oiPct = Math.abs(sig.oiChangePct ?? sig.oiChangeRatio ?? 0);
  const label = sig.oiLabel ?? '';
  const isUnwinding = label === 'LONG_UNWINDING' || label === 'SHORT_COVERING';
  if (dte < 3) return { label: 'QUICK SCALP', narrative: `DTE ${dte}d — exit at T1. OI conviction strong but theta too aggressive.`, color: 'text-red-400' };
  if (oiPct > 200 && !isUnwinding) return { label: 'MOMENTUM', narrative: `Extreme OI change (${oiPct.toFixed(0)}%) with fresh buildup. OI acceleration supports holding. Trail SL after T1.`, color: 'text-green-400' };
  if (isUnwinding) return { label: 'CAUTION', narrative: `OI is unwinding — the move may be exhausting. Tight SL, quick exit at T1. Watch for reversal.`, color: 'text-amber-400' };
  return { label: 'STANDARD', narrative: `OI conviction confirmed. Follow lot-split exit plan: partial exits T1 → T4.`, color: 'text-blue-400' };
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

/** OI surge threshold label per exchange */
function getOIThresholdLabel(exchange: string): string {
  switch (exchange) {
    case 'M': return '>1x';
    case 'N': return '>1.5x';
    case 'C': return '>1x';
    default: return '';
  }
}

function getEpoch(sig: FudkoiTrigger): number {
  if (sig.triggerTimeEpoch) return sig.triggerTimeEpoch;
  if (sig.triggerTime) {
    const d = new Date(sig.triggerTime);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return sig.cachedAt || 0;
}

function computeStrength(sig: FudkoiTrigger, plan: TradePlan): number {
  const conf = computeConfidence(sig);
  const oi = Math.abs(sig.oiChangeRatio ?? 0);
  const rr = plan.rr;
  const vol = computeVolumeSurge(sig);
  const confNorm = ((conf - 55) / 42) * 25;
  const oiNorm = Math.min(30, (oi / 300) * 30);   // OI weighted higher for FUDKOI — scaled for uncapped real OI%
  const rrNorm = Math.min(25, (rr / 4) * 25);
  const volNorm = Math.min(20, ((vol - 1) / 2.5) * 20);
  return Math.min(100, Math.round(confNorm + oiNorm + rrNorm + volNorm));
}

/* ═══════════════════════════════════════════════════════════════
   R:R VISUAL BAR
   ═══════════════════════════════════════════════════════════════ */

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
  <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 p-3 sm:p-4 min-w-[240px] sm:min-w-[260px] animate-slideDown mobile-dropdown-full">
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
  { key: 'oi', label: 'OI Change %' },
  { key: 'strength', label: 'Strength' },
  { key: 'confidence', label: 'Confidence %' },
  { key: 'rr', label: 'R:R' },
  { key: 'time', label: 'Latest Trigger' },
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
      <BarChart2 className="w-7 h-7 text-slate-600" />
    </div>
    <h3 className="text-white font-medium text-lg mb-1">No FUDKOI Signals</h3>
    <p className="text-slate-500 text-sm mb-5 max-w-xs">
      {hasFilters
        ? 'No FUDKOI signals match your current filters. Try adjusting your criteria.'
        : 'Waiting for FUDKII signals with high OI Change% (MCX >100%, NSE >150%, Currency >100%)...'}
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
   FUDKOI TRADING CARD
   ═══════════════════════════════════════════════════════════════ */

const FudkoiCard: React.FC<{
  trigger: FudkoiTrigger;
  plan: TradePlan;
  walletState: SlotWalletState;
  onBuy: (sig: FudkoiTrigger, plan: TradePlan, lots: number) => void;
  onRequestFunds: (sig: FudkoiTrigger, plan: TradePlan, creditAmount: number, premium: number, lotSize: number, multiplier: number, confidence: number) => void;
  isFunded: boolean;
}> = ({ trigger, plan, walletState, onBuy, onRequestFunds, isFunded }) => {
  const [pressing, setPressing] = useState(false);
  const [showRevisedPopup, setShowRevisedPopup] = useState(false);
  const [revisedData, setRevisedData] = useState<any>(null);
  const [loadingRevised, setLoadingRevised] = useState(false);
  const [ltpDriftPct, setLtpDriftPct] = useState<number | null>(null);
  const isLong = trigger.direction === 'BULLISH';

  const signalAgeMs = trigger.triggerTimeEpoch ? Date.now() - trigger.triggerTimeEpoch : 0;
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

  const displayName = trigger.symbol || trigger.companyName || trigger.scripCode;
  const confidence = computeConfidence(trigger);

  const hasRealOption = trigger.optionAvailable === true && trigger.optionLtp != null && trigger.optionLtp > 0;
  const hasFutures = trigger.futuresAvailable === true && trigger.futuresLtp != null && trigger.futuresLtp > 0;
  const noDerivatives = trigger.optionAvailable === false && !hasFutures;
  const isCurrencyPair = /^(USD|EUR|GBP|JPY)INR$/i.test(trigger.symbol);

  let instrumentMode: 'OPTION' | 'FUTURES' | 'NONE' = 'NONE';
  let premium = 0;
  let displayInstrumentName = '';
  let lotSize = 1;
  let multiplier = 1;
  let isEstimatedPremium = false;

  if (hasRealOption) {
    instrumentMode = 'OPTION';
    premium = trigger.optionLtp!;
    const displayStrike = trigger.optionStrike ?? plan.strike;
    const displayOptionType = trigger.optionType ?? plan.optionType;
    const expiryMonth = (() => {
      if (!trigger.optionExpiry) return '';
      const parts = trigger.optionExpiry.split('-');
      if (parts.length < 2) return '';
      const monthIdx = parseInt(parts[1], 10) - 1;
      return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][monthIdx] ?? '';
    })();
    displayInstrumentName = `${trigger.symbol}${expiryMonth ? ' ' + expiryMonth : ''} ${displayStrike} ${displayOptionType}`;
    lotSize = trigger.optionLotSize ?? 1;
    multiplier = trigger.optionMultiplier ?? 1;
  } else if (hasFutures) {
    instrumentMode = 'FUTURES';
    premium = trigger.futuresLtp!;
    const futExpiryMonth = (() => {
      if (!trigger.futuresExpiry) return '';
      const parts = trigger.futuresExpiry.split('-');
      if (parts.length < 2) return '';
      const monthIdx = parseInt(parts[1], 10) - 1;
      return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][monthIdx] ?? '';
    })();
    displayInstrumentName = `${trigger.futuresSymbol ?? trigger.symbol}${futExpiryMonth ? ' ' + futExpiryMonth : ''} FUT`;
    lotSize = trigger.futuresLotSize ?? 1;
    multiplier = trigger.futuresMultiplier ?? 1;
  } else if (isCurrencyPair && noDerivatives) {
    instrumentMode = 'FUTURES';
    premium = trigger.triggerPrice;
    displayInstrumentName = `${trigger.symbol}`;
    lotSize = 1;
  } else if (!noDerivatives) {
    instrumentMode = 'OPTION';
    premium = estimateOptionPremium(plan);
    displayInstrumentName = `${trigger.symbol} ${plan.strike} ${plan.optionType}`;
    lotSize = 1;
    isEstimatedPremium = true;
  }

  // Near-expiry warning: option expires within 2 trading days
  const isNearExpiry = (() => {
    const expiry = trigger.optionExpiry ?? trigger.futuresExpiry;
    if (!expiry || instrumentMode !== 'OPTION') return false;
    const expiryDate = new Date(expiry + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 2;
  })();

  const sizing = (instrumentMode === 'NONE')
    ? { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0, slotsUsed: 0, maxSlots: 0, exchangeFull: false }
    : computeSlotSizing(confidence, walletState, premium, lotSize, multiplier,
        (trigger.exchange || 'N').substring(0, 1).toUpperCase(), trigger.riskReward ?? 2.0, 60);

  // Periodic LTP drift check (every 30s) for stale badge
  const scripForDrift = trigger.optionScripCode || '';
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

  const koi = computeKoiScore(trigger);
  const tradeType = classifyFudkoiTradeType(trigger);

  const volMultiplier = computeVolumeSurge(trigger).toFixed(1);
  const oiVal = computeOIChange(trigger);
  const oiChange = (oiVal >= 0 ? '+' : '') + oiVal;
  const oiStyle = getOILabelStyle(trigger.oiLabel);
  const absOi = Math.abs(oiVal);
  const exchangeLabel = trigger.exchange === 'M' ? 'MCX' : trigger.exchange === 'N' ? 'NSE' : trigger.exchange === 'C' ? 'CUR' : trigger.exchange;

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
                Confidence <span className="font-mono text-slate-400">{confidence}%</span>
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-xs text-slate-500 font-mono">
                {formatTriggerTime(trigger)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isNseNoTradeWindow(trigger.exchange, trigger.triggerTime) && (
              <span className="p-1 rounded-full bg-amber-500/15 border border-amber-500/30" title="NSE no-trade window (3:15–3:30 PM)">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-500/15 text-teal-400 border border-teal-500/30`}>
              {exchangeLabel}
            </span>
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${dirColor}`}>
              {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isLong ? 'Bullish' : 'Bearish'}
            </span>
          </div>
        </div>

        {/* ── KOI SCORE ── */}
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 font-medium w-8">KOI</span>
            <div className="flex-1 h-[6px] rounded-full bg-slate-700/60 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${koi.total >= 76 ? 'bg-cyan-400' : koi.total >= 51 ? 'bg-green-400' : koi.total >= 26 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.min(koi.total, 100)}%` }} />
            </div>
            <span className={`text-sm font-bold font-mono ${koi.total >= 76 ? 'text-cyan-400' : koi.total >= 51 ? 'text-green-400' : koi.total >= 26 ? 'text-amber-400' : 'text-red-400'}`}>
              {koi.total}
            </span>
            <span className={`text-[9px] font-semibold ${koi.total >= 76 ? 'text-cyan-400' : koi.total >= 51 ? 'text-green-400' : koi.total >= 26 ? 'text-amber-400' : 'text-red-400'}`}>
              {koi.total >= 76 ? 'EXTREME' : koi.total >= 51 ? 'STRONG' : koi.total >= 26 ? 'MODERATE' : 'WEAK'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 mt-1.5 text-[9px] font-mono">
            <span className="text-slate-500">OI Shift <span className="text-slate-300">{koi.oiMomentum}/35</span></span>
            <span className="text-slate-500">Buildup <span className="text-slate-300">{koi.oiBuildup}/25</span></span>
            <span className="text-slate-500">Vol <span className="text-slate-300">{koi.volConfirm}/15</span></span>
            <span className="text-slate-500">Accel <span className="text-slate-300">{koi.acceleration}/15</span></span>
            <span className="text-slate-500">Block <span className="text-slate-300">{koi.block}/10</span></span>
          </div>
        </div>

        {/* ── CROSS-INSTRUMENT LEVELS + R:R ── */}
        <div className="mt-4">
          <CrossInstrumentLevels
            plan={plan}
            signal={trigger}
            instrumentMode={instrumentMode}
            sizing={sizing}
          />
        </div>

        {/* OI CHANGE HERO STRIP */}
        <div className="mt-3 bg-teal-500/10 border border-teal-500/20 rounded-lg p-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-teal-400">
              <BarChart2 className="w-3.5 h-3.5" />
              <span className="font-semibold">OI Change</span>
              <span className="text-teal-500/70 text-[10px]">(threshold {getOIThresholdLabel(trigger.exchange)})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-mono text-lg font-bold ${oiVal > 5 ? 'text-teal-300' : 'text-teal-400'}`}>
                {oiChange}%
              </span>
            </div>
          </div>
          {oiStyle.text && (
            <div className="mt-1">
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${oiStyle.color}`}>
                {oiStyle.text}
              </span>
            </div>
          )}
          {/* OI Interpretation Narrative */}
          <div className="mt-2 text-[10px] leading-relaxed space-y-1">
            {(() => {
              const buildup = trigger.oiBuildupPct ?? 0;
              const label = trigger.oiLabel ?? '';
              const surgeT = trigger.surgeT ?? 0;
              const lines: string[] = [];
              // OI interpretation
              if (label === 'LONG_BUILDUP') lines.push('Fresh longs being created. Buyers adding with rising price \u2014 bullish conviction.');
              else if (label === 'SHORT_BUILDUP') lines.push('Fresh shorts being created. Sellers aggressively building \u2014 bearish conviction.');
              else if (label === 'SHORT_COVERING') lines.push('Shorts exiting. Price rising as shorts close \u2014 could be temporary.');
              else if (label === 'LONG_UNWINDING') lines.push('Longs exiting. Profit-booking or stop-outs. Bearish but momentum may fade.');
              // Buildup context
              if (Math.abs(buildup) > 5) lines.push(`OI ${buildup > 0 ? 'growing' : 'shrinking'} ${Math.abs(buildup).toFixed(1)}% \u2014 ${buildup > 0 ? 'accumulation pattern' : 'distribution pattern'}.`);
              // Volume confirmation
              if (surgeT >= 2) lines.push(`Volume ${surgeT.toFixed(1)}x confirms OI move is real, not thin-market noise.`);
              else if (surgeT > 0 && surgeT < 1.5) lines.push('Low volume relative to OI change \u2014 possible rollover or synthetic position.');
              return lines.map((line, i) => <div key={i} className="text-teal-400/70">{line}</div>);
            })()}
          </div>
        </div>


        {/* ── TRANSLATED GREEKS (only when greekEnriched) ── */}
        {trigger.greekEnriched && (() => {
          const theta = trigger.greekTheta ?? 0;
          const delta = Math.abs(trigger.greekDelta ?? 0);
          const iv = (trigger.greekIV ?? 0) * 100;
          const dte = trigger.greekDte ?? 0;
          const thetaTag = theta > -2 ? { label: 'SAFE', color: 'text-green-400', bg: 'bg-green-500/15' } : theta > -5 ? { label: 'WATCH', color: 'text-amber-400', bg: 'bg-amber-500/15' } : { label: 'DANGER', color: 'text-red-400', bg: 'bg-red-500/15' };
          const deltaTag = delta < 0.3 ? { label: 'LOW', color: 'text-slate-400' } : delta < 0.6 ? { label: 'MID', color: 'text-blue-400' } : { label: 'HIGH', color: 'text-green-400' };
          const ivLabel = iv > 50 ? 'Expensive' : iv > 30 ? 'Fair' : 'Cheap';
          const ivColor = iv > 50 ? 'text-red-400' : iv > 30 ? 'text-amber-400' : 'text-green-400';
          return (
            <div className="mt-2 rounded-lg bg-violet-500/10 border border-violet-500/20 p-2">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-slate-500">{'\u03B8'}</span>
                  <span className={`text-[10px] font-bold ${thetaTag.color}`}>{theta.toFixed(1)}</span>
                  <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${thetaTag.bg} ${thetaTag.color}`}>{thetaTag.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-slate-500">{'\u03B4'}</span>
                  <span className={`text-[10px] font-bold ${deltaTag.color}`}>{(trigger.greekDelta ?? 0).toFixed(2)}</span>
                  <span className={`text-[9px] ${deltaTag.color}`}>{deltaTag.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-slate-500">IV</span>
                  <span className={`text-[10px] font-bold ${ivColor}`}>{iv.toFixed(0)}%</span>
                  <span className={`text-[9px] ${ivColor}`}>{ivLabel}</span>
                </div>
                {trigger.optionRR != null && trigger.optionRR > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-slate-500">R:R</span>
                    <span className="text-[10px] font-bold text-emerald-400">{trigger.optionRR.toFixed(1)}</span>
                  </div>
                )}
                {trigger.greekThetaImpaired && (
                  <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                    {'\u03B8'}-IMPAIRED
                  </span>
                )}
              </div>
              {/* DTE Narrative */}
              {dte > 0 && (
                <div className="mt-1.5 text-[10px] text-slate-400 leading-relaxed">
                  {dte <= 2
                    ? <span className="text-red-400 font-semibold">DTE {dte}d - Expiry imminent. Theta decay accelerating. Exit at T1, do not hold overnight.</span>
                    : dte <= 5
                    ? <span className="text-amber-400">DTE {dte}d - Mid-expiry zone. Theta noticeable on premium. Partial exit at T1, trail remainder.</span>
                    : <span>DTE {dte}d - Comfortable time buffer. Full lot-split exit plan viable (T1 through T4).</span>
                  }
                </div>
              )}
            </div>
          );
        })()}

        {/* METRICS GRID */}
        <div className="mt-3 rounded-xl bg-slate-900/60 border border-slate-700/50 p-2.5">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { val: `${volMultiplier}x`, label: 'Vol Surge', color: parseFloat(volMultiplier) >= 3 ? 'text-green-300' : parseFloat(volMultiplier) >= 2 ? 'text-amber-300' : 'text-slate-300' },
              { val: `${oiChange}%`, label: 'OI Change', color: absOi >= 100 ? 'text-green-300' : absOi >= 50 ? 'text-amber-300' : 'text-slate-300' },
              { val: trigger.oiBuildupPct != null ? `${trigger.oiBuildupPct > 0 ? '+' : ''}${trigger.oiBuildupPct.toFixed(1)}%` : 'DM', label: 'OI Buildup%', color: (trigger.oiBuildupPct ?? 0) > 5 ? 'text-green-300' : (trigger.oiBuildupPct ?? 0) > 0 ? 'text-amber-300' : 'text-red-300' },
              { val: fmt(plan.atr), label: 'ATR', color: 'text-slate-300' },
            ].map(({ val, label, color }) => (
              <div key={label}>
                <div className={`text-sm font-bold font-mono ${color}`}>{val}</div>
                <div className="text-[9px] text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* OI LABEL */}
        {oiStyle.text && (
          <div className="mt-1.5 px-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${oiStyle.color}`}>
              {oiStyle.text}
            </span>
          </div>
        )}

        {/* BLOCK TRADE LABEL */}
        {trigger.blockTradeDetected && (() => {
          const pct = trigger.blockTradePct ?? 0;
          const flowLabel = trigger.blockTradeFlowLabel ?? (pct >= 40 ? 'DOMINANT_INSTITUTIONAL' : pct >= 20 ? 'HEAVY_INSTITUTIONAL' : pct >= 10 ? 'MODEST_INSTITUTIONAL' : 'NONE');
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
                {((trigger.blockTradeVol ?? 0) / 1000).toFixed(0)}K shares
              </span>
            </div>
          );
        })()}

        {/* ── TRADE TYPE INSIGHT ── */}
        <div className="border-t border-slate-700/30 mt-3 pt-2">
          <div className={`text-xs font-bold ${tradeType.color} mb-0.5`}>{tradeType.label}</div>
          <p className="text-[11px] text-slate-400 leading-relaxed">{tradeType.narrative}</p>
        </div>

        {/* INSUFFICIENT FUNDS LABEL (clickable → Add Funds) */}
        {sizing.insufficientFunds && !sizing.disabled && (
          <button
            onClick={() => onRequestFunds(trigger, plan, sizing.creditAmount, premium, lotSize, multiplier, confidence)}
            className="mt-3 w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30 hover:bg-orange-500/20 transition-colors cursor-pointer text-left"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <span className="text-[11px] text-orange-400">Insufficient Funds &#8212; forced 1 lot (need +&#8377;{sizing.creditAmount.toLocaleString('en-IN')})</span>
            <span className="ml-auto text-[10px] text-orange-300 font-semibold whitespace-nowrap">Add Funds →</span>
          </button>
        )}

        {/* FUNDED TRADE BADGE */}
        {isFunded && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="text-emerald-400 font-bold text-sm">₹</span>
            <span className="text-[10px] text-emerald-400">Trade executed with added funds</span>
          </div>
        )}

        {/* FUTURES FALLBACK REASON */}
        {instrumentMode === 'FUTURES' && trigger.optionFailureReason && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/25">
            <Zap className="w-3 h-3 text-blue-400/80 flex-shrink-0" />
            <span className="text-[10px] text-blue-400/80">
              FUT: {trigger.optionFailureReason}
            </span>
          </div>
        )}

        {/* ESTIMATED DATA WARNING */}
        {isEstimatedPremium && instrumentMode !== 'NONE' && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/25">
            <AlertTriangle className="w-3 h-3 text-yellow-400/80 flex-shrink-0" />
            <span className="text-[10px] text-yellow-400/80">
              DM: Option LTP, lot size, strike — premium is estimated from ATR
            </span>
          </div>
        )}

        {/* DEBUG STRIP */}
        <div className="mt-2 flex gap-1 text-[9px] font-mono opacity-60 overflow-x-auto pb-0.5 custom-scrollbar -mx-1 px-1">
          <span className={`px-1 rounded whitespace-nowrap ${instrumentMode === 'NONE' ? 'bg-red-500/30 text-red-300' : instrumentMode === 'FUTURES' ? 'bg-blue-500/30 text-blue-300' : 'bg-green-500/30 text-green-300'}`}>
            {instrumentMode}
          </span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">conf={confidence}%</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">lots={sizing.lots}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">lotSz={lotSize}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">prem={fmt(premium)}</span>
          {isEstimatedPremium && <span className="px-1 rounded bg-yellow-500/30 text-yellow-300 whitespace-nowrap">EST</span>}
          {trigger.blockTradeDetected && (() => {
  const pct = trigger.blockTradePct ?? 0;
  const label = pct >= 40 ? 'DOM' : pct >= 20 ? 'HVY' : pct >= 10 ? 'MOD' : 'BLK';
  const bg = pct >= 40 ? 'bg-purple-500/40 text-purple-200' : pct >= 20 ? 'bg-purple-500/30 text-purple-300' : 'bg-purple-500/20 text-purple-300';
  return <span className={`px-1 rounded ${bg} whitespace-nowrap`}>{label} {Math.round(pct)}%</span>;
})()}
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">alloc={sizing.allocPct}%</span>
          <span className={`px-1 rounded whitespace-nowrap ${(trigger.gapQualityScore ?? 1) < 0.10 ? 'bg-red-500/40 text-red-300 font-bold' : (trigger.gapQualityScore ?? 1) < 0.50 ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-600/50 text-slate-300'}`}>
            GQS={trigger.gapQualityScore?.toFixed(3) ?? '1.000'}
          </span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">oa={String(trigger.optionAvailable)}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">fa={String(trigger.futuresAvailable)}</span>
        </div>

        {/* GQS DETAIL (shown when penalized) */}
        {trigger.gapQualityScore != null && trigger.gapQualityScore < 0.50 && (
          <div className="mt-1 flex gap-1 text-[9px] font-mono overflow-x-auto pb-0.5 custom-scrollbar -mx-1 px-1">
            <span className="px-1 rounded bg-red-500/20 text-red-300 whitespace-nowrap">
              Gap/ATR={trigger.gqsGapAtrRatio?.toFixed(1) ?? 'DM'}x
            </span>
            <span className={`px-1 rounded whitespace-nowrap ${trigger.gqsCandleOpposesGap ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
              {trigger.gqsCandleOpposesGap ? 'Recovery candle' : 'Continuation'}
            </span>
            <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">
              GapRecov={trigger.gqsGapRecoveryPct?.toFixed(0) ?? 'DM'}%
            </span>
            <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">
              ATR={trigger.gqsGapAtrRatio?.toFixed(1)} Cdl={trigger.gqsCandleScore?.toFixed(2)} Blk={trigger.gqsBlockFactor?.toFixed(2)} Div={trigger.gqsDivergenceScore?.toFixed(2)} Rec={trigger.gqsRecoveryScore?.toFixed(2)}
            </span>
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
            Confidence {confidence}% &lt; 60% &#8212; No Trade
          </button>
        ) : (
          <div className="relative mt-4">
            {isNearExpiry && (
              <span className="absolute -top-2 right-2 z-10 px-2 py-0.5 rounded text-[10px] font-bold text-white bg-red-500">
                Expiry in 2 days!
              </span>
            )}
            <button
              onClick={async () => {
                if ((isBeyond30mBoundary || (isWithin30mWindow && isStale)) && instrumentMode === 'OPTION' && trigger.optionScripCode) {
                  setLoadingRevised(true);
                  try {
                    const ltpRes = await marketDataApi.getLtp(trigger.optionScripCode);
                    const currentLtp = ltpRes?.ltp;
                    if (currentLtp && currentLtp > 0) {
                      const eqEntry = plan.entry || trigger.triggerPrice || 0;
                      const eqSl = plan.sl || 0;
                      const eqT1 = plan.t1 || 0;
                      const eqT2 = plan.t2 || 0;
                      const eqT3 = plan.t3 || 0;
                      const eqT4 = plan.t4 || 0;
                      const revised = await greeksApi.compute({
                        spot: eqEntry,
                        strike: plan.strike || trigger.optionStrike || 0,
                        optionLtp: currentLtp,
                        optionType: plan.optionType || 'CE',
                        expiry: trigger.optionExpiry || '',
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
                        if (window.confirm(`Exchange slots are full (${sizing.maxSlots}/${sizing.maxSlots}). Manual override — proceed?`)) onBuy(trigger, plan, sizing.lots);
                      } else {
                        onBuy(trigger, plan, sizing.lots);
                      }
                    }
                  } catch (e) {
                    console.error('Greeks compute failed:', e);
                    onBuy(trigger, plan, sizing.lots);
                  } finally {
                    setLoadingRevised(false);
                  }
                } else if (sizing.exchangeFull) {
                  if (window.confirm(`Exchange slots are full (${sizing.maxSlots}/${sizing.maxSlots}). Manual override — proceed?`)) onBuy(trigger, plan, sizing.lots);
                } else {
                  onBuy(trigger, plan, sizing.lots);
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
                  <>{instrumentMode === 'OPTION' ? 'BUY' : (isLong ? 'BUY' : 'SELL')} {displayInstrumentName} @ &#8377;{fmt(premium)}/- * {sizing.lots} lot{sizing.lots > 1 ? 's' : ''}</>
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
                      onBuy(trigger, { ...plan, sl: revisedData.optionSL, t1: revisedData.optionT1, t2: revisedData.optionT2, t3: revisedData.optionT3, t4: revisedData.optionT4, entry: revisedData.currentLtp }, sizing.lots);
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
   MAIN: FUDKOI TAB CONTENT
   ═══════════════════════════════════════════════════════════════ */

export const FudkoiTabContent: React.FC<FudkoiTabContentProps> = ({ autoRefresh = true }) => {
  const navigate = useNavigate();
  const [triggers, setTriggers] = useState<FudkoiTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('oi');
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
  const [fundModal, setFundModal] = useState<{
    strategyKey: string; creditAmount: number; sig: FudkoiTrigger; plan: TradePlan;
    premium: number; lotSize: number; multiplier: number; confidence: number;
  } | null>(null);
  const [fundedScripCodes, setFundedScripCodes] = useState<Set<string>>(new Set());
  const [stalePriceCheck, setStalePriceCheck] = useState<{
    result: StalePriceResult;
    instrumentName: string;
    originalSl: number;
    originalTargets: { t1: number | null; t2: number | null; t3: number | null; t4: number | null };
    pendingBuy: () => void;
  } | null>(null);

  const fetchFudkoi = useCallback(async () => {
    try {
      const data = await fetchJson<FudkoiTrigger[]>('/strategy-state/fudkoi/history/list');
      if (Array.isArray(data)) {
        setTriggers(data);
      }
    } catch (err) {
      console.error('Error fetching FUDKOI triggers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFudkoi(); // Initial full history load
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchFudkoi, 60000); // 60s fallback safety net
    }
    // WebSocket push: prepend new triggered signals in real-time
    const onWsSignal = (e: Event) => {
      const sig = (e as CustomEvent).detail;
      if (sig && sig.scripCode) {
        setTriggers(prev => {
          if (prev.some(s => s.scripCode === sig.scripCode && s.triggerTimeEpoch === sig.triggerTimeEpoch)) return prev;
          return [sig, ...prev];
        });
      }
    };
    window.addEventListener('fudkoi-signal', onWsSignal);
    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener('fudkoi-signal', onWsSignal);
    };
  }, [autoRefresh, fetchFudkoi]);

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

  useEffect(() => {
    const fetchCapital = async () => {
      try {
        const data = await strategyWalletsApi.getCapital('FUDKOI');
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
      if (detail?.strategy === 'FUDKOI') fetchCapital();
    };
    window.addEventListener('wallet-update', onWalletUpdate);
    return () => { clearInterval(interval); window.removeEventListener('wallet-update', onWalletUpdate); };
  }, []);

  const hasActiveFilter = directionFilter !== 'ALL' || exchangeFilter !== 'ALL';

  let filtered = triggers.filter(t => t.triggered !== false);
  if (directionFilter !== 'ALL') {
    filtered = filtered.filter(s => s.direction === directionFilter);
  }
  if (exchangeFilter !== 'ALL') {
    filtered = filtered.filter(s => s.exchange === exchangeFilter);
  }

  const enriched = filtered.map(sig => ({ sig, plan: extractTradePlan(sig) }));

  const sorted = [...enriched].sort((a, b) => {
    switch (sortField) {
      case 'oi':
        return (b.sig.oiChangeRatio ?? 0) - (a.sig.oiChangeRatio ?? 0) || getEpoch(b.sig) - getEpoch(a.sig);
      case 'strength':
        return computeStrength(b.sig, b.plan) - computeStrength(a.sig, a.plan) || getEpoch(b.sig) - getEpoch(a.sig);
      case 'confidence':
        return computeConfidence(b.sig) - computeConfidence(a.sig) || getEpoch(b.sig) - getEpoch(a.sig);
      case 'rr':
        return b.plan.rr - a.plan.rr || getEpoch(b.sig) - getEpoch(a.sig);
      case 'time':
        return getEpoch(b.sig) - getEpoch(a.sig);
      case 'volume':
        return computeVolumeSurge(b.sig) - computeVolumeSurge(a.sig) || getEpoch(b.sig) - getEpoch(a.sig);
      case 'timestamp':
        return getEpoch(b.sig) - getEpoch(a.sig);
      default:
        return 0;
    }
  });

  const sortLabel = SORT_OPTIONS.find(o => o.key === sortField)?.label || 'OI Change %';

  /* ── EXECUTE TRADE (inner) — builds request and sends to backend ── */
  const executeTrade = useCallback(async (
    sig: FudkoiTrigger, plan: TradePlan, lots: number,
    overrideEntry?: number, overrideSl?: number,
    overrideT1?: number | null, overrideT2?: number | null,
    overrideT3?: number | null, overrideT4?: number | null
  ) => {
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
    const isCurrencyPair = /^(USD|EUR|GBP|JPY)INR$/i.test(sig.symbol);

    let premium = 0;
    let instrumentSymbol = '';
    let instrumentType: 'OPTION' | 'FUTURES' = 'OPTION';
    let lotSize = 1;
    let multiplier = 1;
    let tradingScripCode = sig.scripCode;
    let strike = sig.optionStrike ?? plan.strike;
    let optionType: 'CE' | 'PE' = (sig.optionType ?? plan.optionType) as 'CE' | 'PE';

    if (hasRealOption) {
      premium = sig.optionLtp!;
      instrumentSymbol = `${sig.symbol} ${strike} ${optionType}`;
      lotSize = sig.optionLotSize ?? 1;
      multiplier = sig.optionMultiplier ?? 1;
      tradingScripCode = sig.optionScripCode ?? sig.scripCode;
      instrumentType = 'OPTION';
    } else if (hasFutures) {
      premium = sig.futuresLtp!;
      const futMonth = (() => {
        if (!sig.futuresExpiry) return '';
        const parts = sig.futuresExpiry.split('-');
        if (parts.length < 2) return '';
        const mi = parseInt(parts[1], 10) - 1;
        return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][mi] ?? '';
      })();
      instrumentSymbol = `${sig.futuresSymbol ?? sig.symbol}${futMonth ? ' ' + futMonth : ''} FUT`;
      lotSize = sig.futuresLotSize ?? 1;
      multiplier = sig.futuresMultiplier ?? 1;
      tradingScripCode = sig.futuresScripCode ?? sig.scripCode;
      instrumentType = 'FUTURES';
    } else if (isCurrencyPair) {
      premium = sig.triggerPrice;
      instrumentSymbol = `${sig.symbol}`;
      tradingScripCode = sig.scripCode;
      lotSize = 1;
      instrumentType = 'FUTURES';
    } else {
      premium = estimateOptionPremium(plan);
      instrumentSymbol = `${sig.symbol} ${plan.strike} ${plan.optionType ?? ''}`;
      instrumentType = 'OPTION';
    }

    const entryPrice = overrideEntry ?? premium;

    setExecution({
      visible: true,
      symbol: sig.symbol || sig.scripCode,
      optionName: instrumentSymbol,
      strike,
      optionType,
      lots,
      filledPrice: entryPrice,
      riskPercent: plan.sl && sig.triggerPrice
        ? Math.round(Math.abs(sig.triggerPrice - plan.sl) / sig.triggerPrice * 100 * 10) / 10
        : 0.8,
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
          premium, sig.triggerPrice, plan.sl,
          [plan.t1, plan.t2, plan.t3, plan.t4],
          strike, optionType
        );
        tradeSl = mapped.sl;
        tradeT1 = mapped.targets[0] ?? 0;
        tradeT2 = mapped.targets[1] ?? 0;
        tradeT3 = mapped.targets[2] ?? 0;
        tradeT4 = mapped.targets[3] ?? 0;
        delta = mapped.delta;
      }

      if (overrideSl != null) tradeSl = overrideSl;
      if (overrideT1 !== undefined) tradeT1 = overrideT1 ?? 0;
      if (overrideT2 !== undefined) tradeT2 = overrideT2 ?? 0;
      if (overrideT3 !== undefined) tradeT3 = overrideT3 ?? 0;
      if (overrideT4 !== undefined) tradeT4 = overrideT4 ?? 0;

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
        multiplier,
        entryPrice,
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
        optionType: hasRealOption ? (sig.optionType as 'CE' | 'PE') : undefined,
        strike: sig.optionStrike ?? plan.strike,
        strategy: 'FUDKOI',
        exchange: sig.exchange || 'N',
        direction: sig.direction as 'BULLISH' | 'BEARISH',
        confidence: computeConfidence(sig),
        executionMode: 'MANUAL',
      };

      const result = await strategyTradesApi.create(req);

      setExecution(prev => ({
        ...prev,
        status: result?.success ? 'filled' : 'error',
        filledPrice: result?.entryPrice ?? entryPrice,
        orderId: result?.tradeId,
        errorMessage: result.error,
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
  const handleBuy = useCallback(async (sig: FudkoiTrigger, plan: TradePlan, lots: number) => {
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
    let tradeT1 = plan.t1;
    let tradeT2 = plan.t2;
    let tradeT3 = plan.t3;
    let tradeT4 = plan.t4;

    if (hasRealOption) {
      const mapped = mapToOptionLevels(
        sig.optionLtp!, sig.triggerPrice, plan.sl,
        [plan.t1, plan.t2, plan.t3, plan.t4],
        sig.optionStrike ?? plan.strike,
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
      {/* STICKY HEADER */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50">
        <div className="flex items-center justify-between h-14 px-2 sm:px-4">
          <h1 className="text-lg font-semibold text-teal-400 tracking-tight">FUDKOI</h1>

          <div className="flex items-center gap-2">
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

      {/* CONTENT */}
      <div className="pt-4 pb-8">
        {loading && triggers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-teal-400 animate-spin mb-4" />
            <span className="text-slate-500 text-sm">Loading FUDKOI signals...</span>
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} onReset={resetFilters} />
        )}

        {sorted.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <FudkoiCard
                key={`${sig.scripCode}-${getEpoch(sig)}`}
                trigger={sig}
                plan={plan}
                walletState={walletState}
                onBuy={handleBuy}
                onRequestFunds={(s, p, credit, prem, lotSz, mult, conf) => {
                  setFundModal({ strategyKey: 'FUDKOI', creditAmount: credit, sig: s, plan: p, premium: prem, lotSize: lotSz, multiplier: mult, confidence: conf });
                }}
                isFunded={fundedScripCodes.has(sig.scripCode)}
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

      {/* ── FUND TOP-UP MODAL ── */}
      {fundModal && (
        <FundTopUpModal
          strategyKey={fundModal.strategyKey}
          walletEvent={null}
          onClose={() => setFundModal(null)}
          onFunded={async () => {
            const ctx = fundModal;
            setFundModal(null);
            try {
              const data = await strategyWalletsApi.getCapital(ctx.strategyKey);
              const newWallet: SlotWalletState = {
                availableMargin: data?.availableMargin ?? data?.currentCapital ?? walletState.availableMargin,
                usedMargin: data?.usedMargin ?? 0,
                currentBalance: data?.currentCapital ?? walletState.currentBalance,
                openPositionCount: data?.openPositionCount ?? 0,
                positionsByExchange: data?.positionsByExchange ?? { N: 0, M: 0, C: 0 },
              };
              setWalletState(newWallet);
              const newSizing = computeSlotSizing(ctx.confidence, newWallet, ctx.premium, ctx.lotSize, ctx.multiplier, 'N', 2.0, 60);
              if (!newSizing.disabled && newSizing.lots > 0) {
                setFundedScripCodes(prev => new Set(prev).add(ctx.sig.scripCode));
                handleBuy(ctx.sig, ctx.plan, newSizing.lots);
              }
            } catch { /* ignore */ }
          }}
        />
      )}

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

export default FudkoiTabContent;
