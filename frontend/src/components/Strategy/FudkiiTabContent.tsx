import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, Zap, AlertTriangle, Loader2, Clock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchJson, strategyWalletsApi, strategyTradesApi, marketDataApi, greeksApi } from '../../services/api';
import type { StrategyTradeRequest } from '../../types/orders';
import { getOTMStrike, mapToOptionLevels, computeSlotSizing, SlotWalletState, isNseNoTradeWindow, checkStalePriceAdjustment } from '../../utils/tradingUtils';
import type { StalePriceResult } from '../../utils/tradingUtils';
import FundTopUpModal from '../Wallet/FundTopUpModal';
import StalePriceModal from './StalePriceModal';

/* ═══════════════════════════════════════════════════════════════
   TYPES & INTERFACES
   ═══════════════════════════════════════════════════════════════ */

interface FudkiiSignal {
  scripCode: string;
  symbol: string;
  companyName: string;
  exchange: string;
  triggered: boolean;
  direction: 'BULLISH' | 'BEARISH';
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
  cachedAt?: number;
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
  surgeT?: number;
  surgeTMinus1?: number;
  volumeT?: number;
  volumeTMinus1?: number;
  avgVolume?: number;
  blockTradeDetected?: boolean;
  blockTradeVol?: number;
  blockTradePct?: number;
  oiBuildupPct?: number;
  // Option enrichment from backend (real LTP, strike, lot size)
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

type SortField = 'strength' | 'confidence' | 'rr' | 'time' | 'volume' | 'timestamp';
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH';
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C';

interface FudkiiTabContentProps {
  autoRefresh?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function getEpoch(sig: FudkiiSignal): number {
  if (sig.triggerTimeEpoch) return sig.triggerTimeEpoch;
  if (sig.triggerTime) {
    const d = new Date(sig.triggerTime);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return sig.cachedAt || 0;
}

function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'DM';
  return Number(v.toFixed(2)).toString();
}

// getStrikeInterval, getOTMStrike: imported from ../../utils/tradingUtils

/** KII Score = (|OIChange%| + surgeT×100) / 2 — uncapped, above 100 = exceptional */
function computeKiiScore(sig: FudkiiSignal): number {
  const oiPct = Math.abs(sig.oiChangeRatio ?? 0);
  const surge = (sig.surgeT ?? 0) * 100;
  return Math.round((oiPct + surge) / 2);
}

/** Format trigger timestamp in IST */
function formatTriggerTime(sig: FudkiiSignal): string {
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

// approximateDelta, mapToOptionLevels: imported from ../../utils/tradingUtils

/** Real volume surge from backend (T candle volume / 6-candle avg); falls back to 0 if unavailable */
function computeVolumeSurge(sig: FudkiiSignal): number {
  if (sig.surgeT != null && sig.surgeT > 0) return Math.round(sig.surgeT * 10) / 10;
  return 0;
}


/** OI surge ratio from real FUT OI data (median-based abnormality); falls back to 0 if unavailable */
function computeOIChange(sig: FudkiiSignal): number {
  if (sig.oiChangeRatio != null) return Math.round(sig.oiChangeRatio * 10) / 10;
  return 0;
}

/** OI label color: green for new positions (LONG_BUILDUP, SHORT_BUILDUP), orange for exits */
function getOILabelStyle(label?: string): { text: string; color: string } {
  switch (label) {
    case 'LONG_BUILDUP': return { text: 'Long Buildup', color: 'text-green-400' };
    case 'SHORT_BUILDUP': return { text: 'Short Buildup', color: 'text-green-400' };
    case 'SHORT_COVERING': return { text: 'Short Covering', color: 'text-orange-400' };
    case 'LONG_UNWINDING': return { text: 'Long Unwinding', color: 'text-orange-400' };
    default: return { text: '', color: 'text-slate-500' };
  }
}

/** OI chip accent based on whether OI confirms signal direction */
/** Compute composite strength score (0-100) from all metrics */
function computeStrength(sig: FudkiiSignal, plan: TradePlan): number {
  const kii = computeKiiScore(sig);
  const vol = computeVolumeSurge(sig);
  const rr = plan.rr;
  const kiiNorm = Math.min(40, (kii / 150) * 40);
  const volNorm = Math.min(30, ((vol - 1) / 2.5) * 30);
  const rrNorm = Math.min(30, (rr / 4) * 30);
  return Math.min(100, Math.round(kiiNorm + volNorm + rrNorm));
}

// computeSlotSizing: imported from ../../utils/tradingUtils

/** Extract enriched trade plan from signal (OTM strikes) */
function extractTradePlan(sig: FudkiiSignal): TradePlan {
  const isLong = sig.direction === 'BULLISH';
  const optionType = isLong ? 'CE' : 'PE';
  const { strike, interval } = getOTMStrike(sig.triggerPrice, sig.direction);

  // ATR: prefer backend-enriched, fallback to BB-derived estimate
  const bw = (sig.bbUpper || 0) - (sig.bbLower || 0);
  const atrEstimate = sig.atr30m && sig.atr30m > 0
    ? sig.atr30m
    : bw > 0 ? bw / 2.5 : sig.triggerPrice * 0.004;

  // If backend enriched targets exist, use them
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
      atr: atrEstimate,
      optionType,
      strike,
      strikeInterval: interval,
    };
  }

  // Fallback: SuperTrend-based SL + R-multiple targets
  const sl = sig.superTrend || (isLong
    ? sig.triggerPrice - atrEstimate * 2
    : sig.triggerPrice + atrEstimate * 2);
  const risk = Math.abs(sig.triggerPrice - sl);
  const t1 = isLong ? sig.triggerPrice + risk * 2 : sig.triggerPrice - risk * 2;
  const t2 = isLong ? sig.triggerPrice + risk * 3 : sig.triggerPrice - risk * 3;
  const rr = risk > 0 ? (Math.abs(t1 - sig.triggerPrice) / risk) : 0;

  return {
    entry: sig.triggerPrice,
    sl, t1, t2, t3: null, t4: null,
    rr,
    hasPivots: false,
    atr: atrEstimate,
    optionType,
    strike,
    strikeInterval: interval,
  };
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
   FILTER DROPDOWN — Anchored right, matching sort dropdown style
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
  { key: 'timestamp', label: 'Recent' },
  { key: 'strength', label: 'Strength' },
  { key: 'confidence', label: 'KII Score' },
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
        }`}>
          R:R 1:{rr.toFixed(1)}
        </span>
        <span className="text-[11px] text-slate-500">Reward</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   METRICS CHIP ROW
   ═══════════════════════════════════════════════════════════════ */

const MetricsChip: React.FC<{ label: string; value: string; accent?: string; bold?: boolean }> = ({ label, value, accent, bold }) => (
  <div className={`flex-shrink-0 flex items-center gap-1 px-1.5 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-mono
    ${accent || 'bg-slate-700/50 text-slate-300'}`}>
    <span className="text-slate-500 text-[9px] sm:text-[10px]">{label}</span>
    <span className={bold ? 'font-bold text-white' : 'font-medium'}>{value}</span>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   FUDKII SIGNAL TRADING CARD
   ═══════════════════════════════════════════════════════════════ */

const FudkiiTradingCard: React.FC<{
  sig: FudkiiSignal;
  plan: TradePlan;
  walletState: SlotWalletState;
  onBuy: (sig: FudkiiSignal, plan: TradePlan, lots: number) => void;
  onRequestFunds: (sig: FudkiiSignal, plan: TradePlan, creditAmount: number, premium: number, lotSize: number, multiplier: number, kiiScore: number) => void;
  isFunded: boolean;
}> = ({ sig, plan, walletState, onBuy, onRequestFunds, isFunded }) => {
  const [pressing, setPressing] = useState(false);
  const [showRevisedPopup, setShowRevisedPopup] = useState(false);
  const [revisedData, setRevisedData] = useState<any>(null);
  const [loadingRevised, setLoadingRevised] = useState(false);
  const [ltpDriftPct, setLtpDriftPct] = useState<number | null>(null);
  const isLong = sig.direction === 'BULLISH';

  // Signal timing: within active 30m window vs expired
  const signalAgeMs = sig.triggerTimeEpoch ? Date.now() - sig.triggerTimeEpoch : 0;
  const isWithin30mWindow = signalAgeMs <= 30 * 60 * 1000;
  const isBeyond30mBoundary = !isWithin30mWindow;

  const isStale = ltpDriftPct !== null && ltpDriftPct > 10;

  // Colors
  const dirColor = isLong ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30';
  const buyBg = isLong ? 'bg-[#18C964]' : 'bg-[#FF4D6D]';
  const buyBgActive = isLong ? 'active:bg-[#15a854]' : 'active:bg-[#e6445f]';
  const buyHover = isLong ? 'hover:bg-[#16b85c]' : 'hover:bg-[#e84565]';
  const cardBorderGlow = isLong
    ? 'border-green-500/20 hover:border-green-500/40'
    : 'border-red-500/20 hover:border-red-500/40';

  // KII Score = (|OIChange%| + surgeT×100) / 2
  const kiiScore = computeKiiScore(sig);

  // Option: prefer real data from backend; check futures fallback for MCX/currency
  const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
  const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
  const noDerivatives = sig.optionAvailable === false && !hasFutures;
  // Currency pairs: the signal itself IS the FUT instrument, triggerPrice = FUT LTP
  const isCurrencyPair = /^(USD|EUR|GBP|JPY)INR$/i.test(sig.symbol);

  // Determine instrument mode: OPTION, FUTURES, or NONE
  let instrumentMode: 'OPTION' | 'FUTURES' | 'NONE' = 'NONE';
  let premium = 0;
  let displayInstrumentName = '';
  let lotSize = 1;
  let multiplier = 1;
  let isEstimatedPremium = false;

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
    displayInstrumentName = `${sig.symbol}${expiryMonth ? ' ' + expiryMonth : ''} ${displayStrike}${displayOptionType}`;
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
    displayInstrumentName = `${sig.futuresSymbol ?? sig.symbol}${futExpiryMonth ? ' ' + futExpiryMonth : ''} FUT`;
    lotSize = sig.futuresLotSize ?? 1;
    multiplier = sig.futuresMultiplier ?? 1;
  } else if (isCurrencyPair && noDerivatives) {
    // Currency FUT fallback: signal scrip IS the FUT contract, triggerPrice = FUT LTP
    instrumentMode = 'FUTURES';
    premium = sig.triggerPrice;
    displayInstrumentName = `${sig.symbol}`;
    lotSize = 1;
  } else if (!noDerivatives) {
    // Legacy fallback (old signals without optionAvailable field)
    instrumentMode = 'OPTION';
    premium = estimateOptionPremium(plan);
    displayInstrumentName = `${sig.symbol} ${plan.strike}${plan.optionType}`;
    lotSize = 1;
    isEstimatedPremium = true;
  }

  // Near-expiry warning: option expires within 2 trading days
  const isNearExpiry = (() => {
    const expiry = sig.optionExpiry ?? sig.futuresExpiry;
    if (!expiry || instrumentMode !== 'OPTION') return false;
    const expiryDate = new Date(expiry + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 2;
  })();

  const sizing = (instrumentMode === 'NONE')
    ? { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0, slotsUsed: 0, maxSlots: 0, exchangeFull: false }
    : computeSlotSizing(kiiScore > 100 ? 80 : kiiScore > 50 ? 65 : 50, walletState, premium, lotSize, multiplier,
        (sig.exchange || 'N').substring(0, 1).toUpperCase(), sig.riskReward ?? 2.0, 50);

  // Periodic LTP drift check (every 30s) for "!" badge
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

  // Real metrics from backend; IV and Delta are not available (no real options data)
  const volMultiplier = computeVolumeSurge(sig).toFixed(1);
  const oiVal = computeOIChange(sig);
  const oiChange = (oiVal >= 0 ? '+' : '') + oiVal;
  const oiStyle = getOILabelStyle(sig.oiLabel);
  const absOi = Math.abs(oiVal);
  const oiAccent = absOi >= 200 ? 'bg-emerald-500/20 text-emerald-300 font-bold' : absOi >= 100 ? 'bg-orange-500/15 text-orange-300' : absOi >= 30 ? 'bg-slate-500/15 text-slate-300' : 'bg-red-500/15 text-red-300';

  return (
    <div className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-clip transition-shadow duration-200 hover:shadow-lg`}>
      <div className="p-3 sm:p-4">

        {/* ── TOP SECTION ── */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-white leading-tight">
              {sig.symbol || sig.companyName || sig.scripCode}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-500">
                KII <span className="font-mono text-slate-400">{kiiScore}</span>
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-xs text-slate-500 font-mono">
                {formatTriggerTime(sig)}
              </span>
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

        {/* ── SL / Entry / Targets Grid ── */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">SL</span>
            <span className="font-mono text-sm font-semibold text-red-400">{fmt(plan.sl)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Entry</span>
            <span className="font-mono text-sm font-semibold text-white">{fmt(plan.entry)}</span>
          </div>
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

        {/* ── METRICS ROW ── */}
        <div className="mt-3 flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 custom-scrollbar -mx-1 px-1 min-w-0">
          <MetricsChip label="ATR" value={fmt(plan.atr)} />
          <MetricsChip label="Vol" value={`${volMultiplier}x`} bold accent="bg-amber-500/15 text-amber-300" />
          <MetricsChip label="OIChange%" value={`${oiChange}%`} accent={oiAccent} />
          {sig.oiBuildupPct != null && sig.oiBuildupPct !== 0 && (
            <MetricsChip
              label="OIBuildUp%"
              value={`${sig.oiBuildupPct > 0 ? '+' : ''}${sig.oiBuildupPct.toFixed(1)}%`}
              accent={sig.oiBuildupPct > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}
            />
          )}
        </div>

        {/* ── OI LABEL ── */}
        {oiStyle.text && (
          <div className="mt-1.5 px-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${oiStyle.color}`}>
              {oiStyle.text}
            </span>
          </div>
        )}

        {/* ── BLOCK TRADE LABEL ── */}
        {sig.blockTradeDetected && (
          <div className="mt-1.5 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-300">
              Block Trade Detected
            </span>
            <span className="ml-1.5 text-[10px] text-purple-400/70">
              {Math.round(sig.blockTradePct ?? 0)}% vol stripped, {((sig.blockTradeVol ?? 0) / 1000).toFixed(0)}K shares
            </span>
          </div>
        )}

        {/* ── INSUFFICIENT FUNDS LABEL (clickable → Add Funds) ── */}
        {sizing.insufficientFunds && !sizing.disabled && (
          <button
            onClick={() => onRequestFunds(sig, plan, sizing.creditAmount, premium, lotSize, multiplier, kiiScore)}
            className="mt-3 w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30 hover:bg-orange-500/20 transition-colors cursor-pointer text-left"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <span className="text-[11px] text-orange-400">Insufficient Funds — forced 1 lot (need +&#8377;{sizing.creditAmount.toLocaleString('en-IN')})</span>
            <span className="ml-auto text-[10px] text-orange-300 font-semibold whitespace-nowrap">Add Funds →</span>
          </button>
        )}

        {/* ── FUNDED TRADE BADGE ── */}
        {isFunded && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="text-emerald-400 font-bold text-sm">₹</span>
            <span className="text-[10px] text-emerald-400">Trade executed with added funds</span>
          </div>
        )}

        {/* ── FUTURES FALLBACK REASON ── */}
        {instrumentMode === 'FUTURES' && sig.optionFailureReason && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/25">
            <Zap className="w-3 h-3 text-blue-400/80 flex-shrink-0" />
            <span className="text-[10px] text-blue-400/80">
              FUT: {sig.optionFailureReason}
            </span>
          </div>
        )}

        {/* ── ESTIMATED DATA WARNING ── */}
        {isEstimatedPremium && instrumentMode !== 'NONE' && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/25">
            <AlertTriangle className="w-3 h-3 text-yellow-400/80 flex-shrink-0" />
            <span className="text-[10px] text-yellow-400/80">
              DM: Option LTP, lot size, strike — premium is estimated from ATR
            </span>
          </div>
        )}

        {/* ── DEBUG STRIP ── */}
        <div className="mt-2 flex gap-1 text-[9px] font-mono opacity-60 overflow-x-auto pb-0.5 custom-scrollbar -mx-1 px-1">
          <span className={`px-1 rounded whitespace-nowrap ${instrumentMode === 'NONE' ? 'bg-red-500/30 text-red-300' : instrumentMode === 'FUTURES' ? 'bg-blue-500/30 text-blue-300' : 'bg-green-500/30 text-green-300'}`}>
            {instrumentMode}
          </span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">KII={kiiScore}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">lots={sizing.lots}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">lotSz={lotSize}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">prem={fmt(premium)}</span>
          {isEstimatedPremium && <span className="px-1 rounded bg-yellow-500/30 text-yellow-300 whitespace-nowrap">EST</span>}
          {sig.blockTradeDetected && <span className="px-1 rounded bg-purple-500/30 text-purple-300 whitespace-nowrap">BLK {Math.round(sig.blockTradePct ?? 0)}%</span>}
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">alloc={sizing.allocPct}%</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">oa={String(sig.optionAvailable)}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">fa={String(sig.futuresAvailable)}</span>
        </div>

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
            KII Score {kiiScore} — Sizing Unavailable
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
                // After 30m boundary: always show revised popup with fresh Greeks
                // Within window + stale (>10% drift): also show popup
                if ((isBeyond30mBoundary || (isWithin30mWindow && isStale)) && instrumentMode === 'OPTION' && sig.optionScripCode) {
                  setLoadingRevised(true);
                  try {
                    const ltpRes = await marketDataApi.getLtp(sig.optionScripCode);
                    const currentLtp = ltpRes?.ltp;
                    if (currentLtp && currentLtp > 0) {
                      // Use plan values (ATR-based, wider targets suitable for manual trading)
                      // sig.target1/stopLoss are tight BB/ST-based targets for automated scalps
                      const eqEntry = plan.entry || sig.triggerPrice || 0;
                      const eqSl = plan.sl || 0;
                      const eqT1 = plan.t1 || 0;
                      const eqT2 = plan.t2 || 0;
                      const eqT3 = plan.t3 || 0;
                      const eqT4 = plan.t4 || 0;
                      // Always use frontend-computed ATM strike (plan.strike) for revised Greeks.
                      // sig.optionStrike may be stale (from pre-market when price was different).
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
                  <>{instrumentMode === 'OPTION' ? 'BUY' : (isLong ? 'BUY' : 'SELL')} {displayInstrumentName} @ &#8377;{fmt(premium)}/- * {sizing.lots} lot{sizing.lots > 1 ? 's' : ''}</>
                )}
              </span>
            </button>

            {/* Revised Greeks Popup — shown when clicking CTA beyond 30m boundary */}
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
        ? 'No FUDKII signals match your current filters. Try adjusting your criteria.'
        : 'Waiting for SuperTrend flip + Bollinger Band breakout confluence...'}
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
   MAIN: FUDKII TAB CONTENT
   ═══════════════════════════════════════════════════════════════ */

export const FudkiiTabContent: React.FC<FudkiiTabContentProps> = ({ autoRefresh = true }) => {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<FudkiiSignal[]>([]);
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
  const [fundModal, setFundModal] = useState<{
    strategyKey: string; creditAmount: number; sig: FudkiiSignal; plan: TradePlan;
    premium: number; lotSize: number; multiplier: number; kiiScore: number;
  } | null>(null);
  const [fundedScripCodes, setFundedScripCodes] = useState<Set<string>>(new Set());
  const [stalePriceCheck, setStalePriceCheck] = useState<{
    result: StalePriceResult;
    instrumentName: string;
    originalSl: number;
    originalTargets: { t1: number | null; t2: number | null; t3: number | null; t4: number | null };
    pendingBuy: () => void;
  } | null>(null);

  const fetchFudkii = useCallback(async () => {
    try {
      const data = await fetchJson<FudkiiSignal[]>('/strategy-state/fudkii/history/list');
      if (Array.isArray(data)) {
        setSignals(data);
      }
    } catch (err) {
      console.error('Error fetching FUDKII signals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFudkii(); // Initial full history load
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchFudkii, 60000); // 60s fallback safety net
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
    window.addEventListener('fudkii-signal', onWsSignal);
    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener('fudkii-signal', onWsSignal);
    };
  }, [autoRefresh, fetchFudkii]);

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
        const data = await strategyWalletsApi.getCapital('FUDKII');
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
      if (detail?.strategy === 'FUDKII') fetchCapital();
    };
    window.addEventListener('wallet-update', onWalletUpdate);
    return () => { clearInterval(interval); window.removeEventListener('wallet-update', onWalletUpdate); };
  }, []);

  /* ── FILTER ── */
  const hasActiveFilter = directionFilter !== 'ALL' || exchangeFilter !== 'ALL';

  // History endpoint only returns triggered=true signals for today — no client-side date filter needed
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
        return computeKiiScore(b.sig) - computeKiiScore(a.sig) || getEpoch(b.sig) - getEpoch(a.sig);
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

  const sortLabel = SORT_OPTIONS.find(o => o.key === sortField)?.label || 'Recent';

  /* ── EXECUTE TRADE (inner) — builds request and sends to backend ── */
  const executeTrade = useCallback(async (
    sig: FudkiiSignal, plan: TradePlan, lots: number,
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

    // Use override entry (current LTP) if provided
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

      // Apply stale-price overrides if provided
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
        strategy: 'FUDKII',
        exchange: sig.exchange || 'N',
        direction: sig.direction,
        confidence: computeKiiScore(sig),
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
  const handleBuy = useCallback(async (sig: FudkiiSignal, plan: TradePlan, lots: number) => {
    // Determine which scripCode to check LTP for
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
    const ltpScripCode = hasRealOption ? (sig.optionScripCode ?? sig.scripCode)
      : hasFutures ? (sig.futuresScripCode ?? sig.scripCode)
      : sig.scripCode;
    const instrumentName = hasRealOption
      ? `${sig.symbol} ${sig.optionStrike ?? plan.strike} ${sig.optionType ?? plan.optionType}`
      : hasFutures ? `${sig.futuresSymbol ?? sig.symbol} FUT`
      : sig.symbol;

    // Compute the trade-level SL/targets that would be used
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

    // Fetch current LTP
    try {
      const ltpData = await marketDataApi.getLtp(ltpScripCode);
      if (ltpData?.ltp != null && ltpData.ltp > 0) {
        const currentLtp = ltpData.ltp;
        const staleCheck = checkStalePriceAdjustment(currentLtp, tradeSl, tradeT1, tradeT2, tradeT3, tradeT4);

        if (staleCheck) {
          // Show modal — store pending trade details
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

        // LTP available but no adjustment needed — use current LTP as entry
        executeTrade(sig, plan, lots, currentLtp);
        return;
      }
    } catch {
      // LTP fetch failed — proceed with original price (graceful degradation)
    }

    // Fallback: no LTP available, proceed with signal price
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
      {/* ── STICKY HEADER (56px) ── */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50">
        <div className="flex items-center justify-between h-14 px-2 sm:px-4">
          {/* Left: Title */}
          <h1 className="text-lg font-semibold text-orange-400 tracking-tight">FUDKII</h1>

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
        <div className="px-2 sm:px-4 pb-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/80 text-[12px] text-slate-400 border border-slate-700/50">
            Sorted by {sortLabel}
          </span>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="pt-4 pb-8">
        {/* Loading */}
        {loading && signals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-orange-400 animate-spin mb-4" />
            <span className="text-slate-500 text-sm">Loading FUDKII signals...</span>
          </div>
        )}

        {/* Empty */}
        {!loading && sorted.length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} onReset={resetFilters} />
        )}

        {/* DEBUG: Card count */}
        {sorted.length > 0 && (
          <div className="mb-3 px-2 py-1 bg-yellow-500/20 border border-yellow-500/40 rounded text-yellow-300 text-xs font-mono">
            DEBUG: {sorted.length} cards rendered (from {signals.length} signals fetched)
          </div>
        )}

        {/* Cards Grid: 1 col mobile, 3 col desktop */}
        {sorted.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <FudkiiTradingCard
                key={`${sig.scripCode}-${getEpoch(sig)}`}
                sig={sig}
                plan={plan}
                walletState={walletState}
                onBuy={handleBuy}
                onRequestFunds={(s, p, credit, prem, lotSz, mult, kii) => {
                  setFundModal({ strategyKey: 'FUDKII', creditAmount: credit, sig: s, plan: p, premium: prem, lotSize: lotSz, multiplier: mult, kiiScore: kii });
                }}
                isFunded={fundedScripCodes.has(sig.scripCode)}
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
              const mappedConf = ctx.kiiScore > 100 ? 80 : ctx.kiiScore > 50 ? 65 : 50;
              const newSizing = computeSlotSizing(mappedConf, newWallet, ctx.premium, ctx.lotSize, ctx.multiplier, 'N', 2.0, 50);
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

export default FudkiiTabContent;
