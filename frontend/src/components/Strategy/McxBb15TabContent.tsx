import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, Zap, AlertTriangle, Loader2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchJson, strategyTradesApi, strategyWalletsApi, marketDataApi, greeksApi } from '../../services/api';
import type { StrategyTradeRequest } from '../../types/orders';
import { getOTMStrike, mapToOptionLevels, computeSlotSizing, SlotWalletState, checkStalePriceAdjustment, isAnyMarketOpen } from '../../utils/tradingUtils';
import type { StalePriceResult } from '../../utils/tradingUtils';
import FundTopUpModal from '../Wallet/FundTopUpModal';
import StalePriceModal from './StalePriceModal';
import CrossInstrumentLevels from './CrossInstrumentLevels';
import { LiquiditySourceBadge, RetestBadge } from './SignalBadges';

type SortField = 'timestamp' | 'score' | 'rr' | 'surge';
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH';

/* ═══════════════════════════════════════════════════════════════
   TYPES & INTERFACES
   ═══════════════════════════════════════════════════════════════ */

interface McxBbTrigger {
  scripCode: string;
  symbol: string;
  companyName: string;
  exchange: string;  // always "M"
  triggered: boolean;
  direction: string;
  triggerPrice: number;
  triggerScore: number;  // 0-100
  bbUpper: number;
  bbLower: number;
  stopLoss: number;
  target1: number;
  target2?: number | null;
  target3?: number | null;
  target4?: number | null;
  pivotSource?: boolean;
  riskReward: number;
  surgeT: number;
  oiChangeRatio: number;
  volumeT: number;
  signalSource: string;
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
  // Rich insight fields
  bbMiddle?: number;
  atr30m?: number;
  expansionRate?: number;
  bodyOutsideRatio?: number;
  technicalScore?: number;
  institutionalScore?: number;
  institutionalClass?: string;
  combinedConviction?: number;
  sizeClass?: string;
  sessionType?: string;
  sessionWeight?: number;
  oiInterpretation?: string;
  instFlowScore?: number;
  instSizeScore?: number;
  instStealthScore?: number;
  instOiScore?: number;
  triggerTime?: string;
  timestamp?: number;
  // Liquidity source
  liquiditySource?: string;
  // Retest
  retestActive?: boolean;
  retestLevel?: number;
  retestSource?: string;
  retestStage?: string;
  retestDirectionAligned?: boolean;
  retestBoost?: number;
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

interface McxBb15TabContentProps {
  autoRefresh?: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'DM';
  return Number(v.toFixed(2)).toString();
}

/** Estimate option premium for OTM strike */
function estimateOptionPremium(plan: TradePlan): number {
  return Math.round(Math.max(plan.atr * 3, plan.entry * 0.008) * 10) / 10;
}

/** Extract trade plan from MCX-BB signal */
function extractTradePlan(sig: McxBbTrigger): TradePlan {
  const isLong = sig.direction === 'BULLISH';
  const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE';
  const { strike, interval } = getOTMStrike(sig.triggerPrice, sig.direction);

  // ATR: derive from BB width
  const bw = (sig.bbUpper || 0) - (sig.bbLower || 0);
  const atr = bw > 0 ? bw / 2.5 : sig.triggerPrice * 0.004;

  const entry = sig.triggerPrice;
  const sl = sig.stopLoss;
  const risk = Math.abs(entry - sl);
  const isLongDir = sig.direction === 'BULLISH';

  return {
    entry,
    sl,
    t1: sig.target1 ?? null,
    t2: sig.target2 ?? (risk > 0 ? (isLongDir ? entry + risk * 3 : entry - risk * 3) : null),
    t3: sig.target3 ?? (risk > 0 ? (isLongDir ? entry + risk * 4 : entry - risk * 4) : null),
    t4: sig.target4 ?? (risk > 0 ? (isLongDir ? entry + risk * 5 : entry - risk * 5) : null),
    rr: sig.riskReward ?? 0,
    hasPivots: sig.pivotSource === true,
    atr,
    optionType,
    strike,
    strikeInterval: interval,
  };
}

/* RiskRewardBar removed — now handled by CrossInstrumentLevels */

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
   FILTER DROPDOWN — Direction only (MCX-BB is MCX-only, no exchange filter)
   ═══════════════════════════════════════════════════════════════ */

const FilterDropdown: React.FC<{
  direction: DirectionFilter;
  onDirectionChange: (d: DirectionFilter) => void;
  onClose: () => void;
  onReset: () => void;
}> = ({ direction, onDirectionChange, onClose, onReset }) => (
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
                  : 'bg-lime-500/20 text-lime-400 border border-lime-500/40'
                : 'bg-slate-700/50 text-slate-400 border border-transparent hover:bg-slate-700'
            }`}
          >
            {d === 'ALL' ? 'All' : d === 'BULLISH' ? 'Bullish' : 'Bearish'}
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
  { key: 'score', label: 'Score' },
  { key: 'rr', label: 'R:R' },
  { key: 'surge', label: 'Volume Surge' },
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
            ? 'text-lime-400 bg-lime-500/10'
            : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
        }`}
      >
        {label}
        {current === key && <Check className="w-3.5 h-3.5 inline ml-2 text-lime-400" />}
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
        ? 'No MCX-BB-15-30 signals match your current filters. Try adjusting your criteria.'
        : 'Waiting for MCX Bollinger Band breakout signals...'}
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
   BB SCORE + TRADE TYPE HELPERS
   ═══════════════════════════════════════════════════════════════ */

function computeBbScore(sig: McxBbTrigger): { total: number; bbBreak: number; volume: number; oi: number; momentum: number } {
  const bbUpper = sig.bbUpper ?? 0;
  const bbLower = sig.bbLower ?? 0;
  const price = sig.triggerPrice ?? 0;
  const isLong = sig.direction === 'BULLISH';
  const band = isLong ? bbUpper : bbLower;
  const breakDist = band > 0 ? Math.abs(price - band) / band * 100 : 0;
  const bbBreakScore = Math.min(100, breakDist * 50); // 2% break = 100
  const volumeScore = Math.min(100, (sig.surgeT ?? 0) * 50);
  const oiScore = Math.min(100, Math.abs(sig.oiChangeRatio ?? 0) * 0.4);
  const momentumScore = sig.triggerScore ?? 50;
  const total = Math.round(bbBreakScore * 0.30 + volumeScore * 0.25 + oiScore * 0.20 + momentumScore * 0.15 + 50 * 0.10);
  return { total, bbBreak: Math.round(bbBreakScore * 0.30), volume: Math.round(volumeScore * 0.25), oi: Math.round(oiScore * 0.20), momentum: Math.round(momentumScore * 0.15) };
}

function classifyMcxBbTradeType(sig: McxBbTrigger): { label: string; narrative: string; color: string } {
  const dte = sig.greekDte ?? 15;
  const surgeT = sig.surgeT ?? 0;
  if (dte < 5) return { label: 'GAMMA SCALP', narrative: `DTE ${dte}d + BB breakout. Take T1, tight trail. Don't hold overnight.`, color: 'text-orange-400' };
  if (surgeT > 3) return { label: 'MOMENTUM', narrative: `Strong volume ${surgeT.toFixed(1)}x on BB breakout. Trail to T2.`, color: 'text-green-400' };
  return { label: 'STANDARD', narrative: `BB breakout confirmed. Follow exit plan.`, color: 'text-blue-400' };
}

/* ═══════════════════════════════════════════════════════════════
   MCX-BB-15 TRADING CARD — Same layout as FUKAA
   ═══════════════════════════════════════════════════════════════ */

const McxBbCard: React.FC<{
  trigger: McxBbTrigger;
  plan: TradePlan;
  walletState: SlotWalletState;
  onBuy: (sig: McxBbTrigger, plan: TradePlan, lots: number) => void;
  onRequestFunds: (sig: McxBbTrigger, plan: TradePlan, creditAmount: number, premium: number, lotSize: number, multiplier: number, confidence: number) => void;
  isFunded: boolean;
  onNavigateToScrip: (scripCode: string) => void;
}> = ({ trigger, plan, walletState, onBuy, onRequestFunds, isFunded, onNavigateToScrip }) => {
  const [pressing, setPressing] = useState(false);
  const [showRevisedPopup, setShowRevisedPopup] = useState(false);
  const [revisedData, setRevisedData] = useState<any>(null);
  const [loadingRevised, setLoadingRevised] = useState(false);
  const [ltpDriftPct, setLtpDriftPct] = useState<number | null>(null);
  const isLong = trigger.direction === 'BULLISH';

  const signalAgeMs = trigger.timestamp ? Date.now() - trigger.timestamp :
    trigger.triggerTime ? Date.now() - new Date(trigger.triggerTime).getTime() : 0;
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

  const displayName = trigger.symbol || trigger.companyName || trigger.scripCode;

  // Confidence: triggerScore is already 0-100
  const confidence = Math.round(trigger.triggerScore);

  // Option: prefer real data from backend; check futures fallback for MCX
  const hasRealOption = trigger.optionAvailable === true && trigger.optionLtp != null && trigger.optionLtp > 0;
  const hasFutures = trigger.futuresAvailable === true && trigger.futuresLtp != null && trigger.futuresLtp > 0;
  const noDerivatives = trigger.optionAvailable === false && !hasFutures;

  // Determine instrument mode: OPTION, FUTURES, or NONE
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
  } else if (!noDerivatives) {
    // Legacy fallback (old signals without optionAvailable field)
    instrumentMode = 'OPTION';
    premium = estimateOptionPremium(plan);
    displayInstrumentName = `${trigger.symbol} ${trigger.optionStrike ?? plan.strike} ${trigger.optionType ?? plan.optionType}`;
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
        'M', trigger.riskReward ?? 2.0, 60);

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
    const iv = setInterval(() => { if (isAnyMarketOpen()) checkDrift(); }, 30000);
    return () => clearInterval(iv);
  }, [scripForDrift, premiumForDrift]);

  return (
    <div onClick={() => onNavigateToScrip(trigger.scripCode)} className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-clip transition-shadow duration-200 hover:shadow-lg cursor-pointer`}>
      <div className="p-3 sm:p-4">

        {/* -- TOP SECTION -- */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white leading-tight">{displayName}</h3>
              {/* Timestamp + age */}
              {(() => {
                const ts = trigger.timestamp || (trigger.triggerTime ? new Date(trigger.triggerTime).getTime() : 0);
                if (!ts) return null;
                const d = new Date(ts);
                const hh = d.getHours().toString().padStart(2, '0');
                const mm = d.getMinutes().toString().padStart(2, '0');
                const ageMin = Math.floor((Date.now() - ts) / 60000);
                const ageStr = ageMin < 1 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`;
                const ageColor = ageMin <= 5 ? 'text-green-400' : ageMin <= 30 ? 'text-amber-400' : 'text-red-400';
                return (
                  <span className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-slate-500 font-mono">{hh}:{mm}</span>
                    <span className={`font-semibold ${ageColor}`}>{ageStr}</span>
                  </span>
                );
              })()}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {/* Sizing tier badge */}
              {(() => {
                const sc = trigger.sizeClass || 'MINIMUM';
                const scColors: Record<string, string> = {
                  FULL: 'bg-green-500/20 text-green-400 border-green-500/30',
                  STANDARD: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                  REDUCED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                  MINIMUM: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
                };
                return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${scColors[sc] || scColors.MINIMUM}`}>{sc}</span>;
              })()}
              <span className="text-[10px] text-slate-500 font-mono">{trigger.exchange === 'M' ? 'MCX' : trigger.exchange === 'N' ? 'NSE' : trigger.exchange}</span>
              <LiquiditySourceBadge source={trigger.liquiditySource} />
              {/* Session badge with weight */}
              {trigger.sessionType && (
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                  (trigger.sessionWeight ?? 1) >= 1.25 ? 'bg-green-500/15 text-green-400' :
                  (trigger.sessionWeight ?? 1) >= 1.1 ? 'bg-amber-500/15 text-amber-400' :
                  'bg-slate-600/30 text-slate-400'
                }`}>
                  {trigger.sessionType.replace(/_/g, ' ')} {(trigger.sessionWeight ?? 1) > 1 ? `${trigger.sessionWeight}x` : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${dirColor}`}>
              {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isLong ? 'Bullish' : 'Bearish'}
            </span>
            {/* OI interpretation badge */}
            {trigger.oiInterpretation && (
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                trigger.oiInterpretation === 'LONG_BUILDUP' ? 'bg-green-500/15 text-green-400' :
                trigger.oiInterpretation === 'SHORT_BUILDUP' ? 'bg-red-500/15 text-red-400' :
                trigger.oiInterpretation === 'LONG_UNWINDING' ? 'bg-orange-500/15 text-orange-400' :
                trigger.oiInterpretation === 'SHORT_COVERING' ? 'bg-cyan-500/15 text-cyan-400' :
                'bg-slate-600/30 text-slate-400'
              }`}>{trigger.oiInterpretation.replace(/_/g, ' ')}</span>
            )}
          </div>
        </div>

        {/* ── DUAL SCORE BARS: Technical + Institutional ── */}
        <div className="mt-2.5 space-y-1.5">
          {/* Technical Score */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-medium w-12">Technical</span>
            <div className="flex-1 h-[5px] rounded-full bg-slate-700/60 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${(trigger.technicalScore ?? 0) >= 70 ? 'bg-cyan-400' : (trigger.technicalScore ?? 0) >= 50 ? 'bg-green-400' : (trigger.technicalScore ?? 0) >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${Math.min(trigger.technicalScore ?? 0, 100)}%` }} />
            </div>
            <span className={`text-xs font-bold font-mono w-7 text-right ${(trigger.technicalScore ?? 0) >= 70 ? 'text-cyan-400' : (trigger.technicalScore ?? 0) >= 50 ? 'text-green-400' : (trigger.technicalScore ?? 0) >= 30 ? 'text-amber-400' : 'text-red-400'}`}>
              {trigger.technicalScore ?? 0}
            </span>
          </div>
          {/* Institutional Score */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-medium w-12">Inst.</span>
            <div className="flex-1 h-[5px] rounded-full bg-slate-700/60 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${(trigger.institutionalScore ?? 0) >= 50 ? 'bg-violet-400' : (trigger.institutionalScore ?? 0) >= 25 ? 'bg-blue-400' : 'bg-slate-500'}`}
                style={{ width: `${Math.min(trigger.institutionalScore ?? 0, 100)}%` }} />
            </div>
            <span className={`text-xs font-bold font-mono w-7 text-right ${(trigger.institutionalScore ?? 0) >= 50 ? 'text-violet-400' : (trigger.institutionalScore ?? 0) >= 25 ? 'text-blue-400' : 'text-slate-400'}`}>
              {trigger.institutionalScore ?? 0}
            </span>
          </div>
          {/* Institutional 4-component mini breakdown */}
          {(trigger.institutionalScore ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 ml-14 text-[8px] font-mono">
              <span className="text-violet-400/70">Flow <span className="text-violet-300">{trigger.instFlowScore ?? 0}/30</span></span>
              <span className="text-slate-700">|</span>
              <span className="text-violet-400/70">Size <span className="text-violet-300">{trigger.instSizeScore ?? 0}/30</span></span>
              <span className="text-slate-700">|</span>
              <span className="text-violet-400/70">Stealth <span className="text-violet-300">{trigger.instStealthScore ?? 0}/20</span></span>
              <span className="text-slate-700">|</span>
              <span className="text-violet-400/70">OI <span className="text-violet-300">{trigger.instOiScore ?? 0}/20</span></span>
            </div>
          )}
          {/* Combined conviction */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-medium w-12">Final</span>
            <div className="flex-1 h-[6px] rounded-full bg-slate-700/60 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${confidence >= 75 ? 'bg-emerald-400' : confidence >= 55 ? 'bg-green-400' : confidence >= 35 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${Math.min(confidence, 100)}%` }} />
            </div>
            <span className={`text-sm font-bold font-mono w-7 text-right ${confidence >= 75 ? 'text-lime-400' : confidence >= 55 ? 'text-green-400' : confidence >= 35 ? 'text-amber-400' : 'text-red-400'}`}>
              {confidence}
            </span>
          </div>
        </div>

        {/* ── BB BREAKOUT DETAILS ── */}
        <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[10px]">
          <span className="font-mono text-slate-400">
            {isLong ? `Close > Upper by ${((trigger.triggerPrice - (trigger.bbUpper ?? 0)) / (trigger.bbUpper || 1) * 100).toFixed(1)}%` :
              `Close < Lower by ${(((trigger.bbLower ?? 0) - trigger.triggerPrice) / (trigger.bbLower || 1) * 100).toFixed(1)}%`}
          </span>
          {(trigger.bodyOutsideRatio ?? 0) > 0 && (
            <>
              <span className="text-slate-700">|</span>
              <span className={`font-mono ${(trigger.bodyOutsideRatio ?? 0) >= 0.8 ? 'text-green-400' : 'text-slate-400'}`}>
                Body {((trigger.bodyOutsideRatio ?? 0) * 100).toFixed(0)}% outside
              </span>
            </>
          )}
          {(trigger.expansionRate ?? 0) > 0 && (
            <>
              <span className="text-slate-700">|</span>
              <span className={`font-mono ${(trigger.expansionRate ?? 0) >= 0.05 ? 'text-cyan-400' : 'text-slate-400'}`}>
                Expand {((trigger.expansionRate ?? 0) * 100).toFixed(1)}%
              </span>
            </>
          )}
        </div>

        {/* ── 5-COLUMN METRICS GRID ── */}
        <div className="mt-3 rounded-xl bg-slate-900/60 border border-slate-700/50 p-2.5">
          <div className="grid grid-cols-5 gap-1.5 text-center">
            {[
              { val: `${(trigger.surgeT ?? 0).toFixed(1)}x`, label: 'Vol Surge',
                color: (trigger.surgeT ?? 0) >= 3 ? 'text-green-300' : (trigger.surgeT ?? 0) >= 2 ? 'text-amber-300' : 'text-slate-300' },
              { val: `${(trigger.oiChangeRatio ?? 0) > 0 ? '+' : ''}${(trigger.oiChangeRatio ?? 0).toFixed(0)}%`, label: 'OI Chg',
                color: Math.abs(trigger.oiChangeRatio ?? 0) >= 100 ? 'text-green-300' : Math.abs(trigger.oiChangeRatio ?? 0) >= 50 ? 'text-amber-300' : 'text-slate-300' },
              { val: trigger.volumeT > 0 ? (trigger.volumeT >= 100000 ? `${(trigger.volumeT / 100000).toFixed(1)}L` : `${(trigger.volumeT / 1000).toFixed(0)}K`) : 'DM', label: 'Volume',
                color: 'text-slate-300' },
              { val: (trigger.atr30m ?? 0) > 0 ? trigger.atr30m!.toFixed(1) : (plan.atr > 0 ? plan.atr.toFixed(1) : 'DM'), label: 'ATR',
                color: 'text-slate-300' },
              { val: `${((trigger.bbUpper ?? 0) > 0 && (trigger.bbLower ?? 0) > 0 ? (((trigger.bbUpper! - trigger.bbLower!) / ((trigger.bbMiddle ?? trigger.triggerPrice) || 1)) * 100).toFixed(1) : 'DM')}${typeof ((trigger.bbUpper ?? 0) > 0 && (trigger.bbLower ?? 0) > 0 ? 1 : '') === 'number' ? '%' : ''}`,
                label: 'BB Width',
                color: (() => { const w = (trigger.bbUpper ?? 0) > 0 && (trigger.bbLower ?? 0) > 0 ? ((trigger.bbUpper! - trigger.bbLower!) / ((trigger.bbMiddle ?? trigger.triggerPrice) || 1)) * 100 : 0; return w > 0 && w < 2 ? 'text-cyan-300' : w < 4 ? 'text-green-300' : 'text-slate-300'; })() },
            ].map(({ val, label, color }) => (
              <div key={label}>
                <div className={`text-sm font-bold font-mono ${color}`}>{val}</div>
                <div className="text-[8px] text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
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

        {/* ── RETEST BADGE ── */}
        <RetestBadge active={trigger.retestActive} aligned={trigger.retestDirectionAligned} boost={trigger.retestBoost} source={trigger.retestSource} level={trigger.retestLevel} stage={trigger.retestStage} />

        {/* ── TRANSLATED GREEKS ── */}
        {trigger.greekEnriched && (() => {
          const dte = trigger.greekDte ?? 0;
          const delta = Math.abs(trigger.greekDelta ?? 0);
          const iv = (trigger.greekIV ?? 0) * 100;
          const thetaLabel = dte >= 10 ? 'SAFE' : dte >= 5 ? 'WATCH' : 'DANGER';
          const thetaColor = dte >= 10 ? 'text-green-400' : dte >= 5 ? 'text-yellow-400' : 'text-red-400';
          const deltaLabel = delta >= 0.3 && delta <= 0.5 ? 'MID' : delta > 0.5 ? 'HIGH' : 'LOW';
          const deltaColor = delta >= 0.3 && delta <= 0.7 ? 'text-green-400' : 'text-yellow-400';
          const ivLabel = iv > 60 ? 'EXTREME' : iv > 40 ? 'ELEVATED' : iv > 20 ? 'NORMAL' : 'LOW';
          const ivColor = iv > 60 ? 'text-red-400' : iv > 40 ? 'text-yellow-400' : 'text-green-400';
          return (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono">
                <span className="text-slate-400">{'\u03B4'}{(trigger.greekDelta ?? 0).toFixed(2)}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">{'\u03B3'}{(trigger.greekGamma ?? 0).toFixed(4)}</span>
                <span className="text-slate-600">|</span>
                <span className={`${(trigger.greekTheta ?? 0) < -3 ? 'text-red-400' : 'text-slate-400'}`}>{'\u03B8'}{(trigger.greekTheta ?? 0).toFixed(2)}</span>
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
                {trigger.greekThetaImpaired && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">{'\u03B8'}-IMPAIRED</span>}
              </div>
            </div>
          );
        })()}

        {/* ── TRADE NARRATIVE ── */}
        {(() => {
          const tradeType = classifyMcxBbTradeType(trigger);
          const instClass = trigger.institutionalClass || 'UNKNOWN';
          const instLabel = instClass === 'INSTITUTIONAL' ? 'Institutional flow detected' :
            instClass === 'MIXED' ? 'Mixed retail + institutional' : 'Retail-dominated flow';
          const instColor = instClass === 'INSTITUTIONAL' ? 'text-violet-400' :
            instClass === 'MIXED' ? 'text-blue-400' : 'text-slate-500';
          const sessionNarrative = (() => {
            const st = trigger.sessionType || '';
            const w = trigger.sessionWeight ?? 1;
            if (st === 'US_OVERLAP') return 'COMEX/NYMEX peak — real price discovery window';
            if (st === 'EUROPE_OVERLAP') return 'LME overlap — London institutional flow';
            if (st === 'FII_OPEN') return 'FII heavy — overnight allocation orders executing';
            if (st === 'CLOSING_RUSH') return 'FII+DII EOD rebalancing — high conviction window';
            if (st === 'EUROPE_FLOW') return 'Europe morning — fresh FII allocation orders';
            if (st === 'DOMESTIC_OPEN') return 'Domestic institutional open — hedger orders';
            if (w >= 1.2) return 'High-activity institutional session';
            return '';
          })();
          return (
            <div className="mt-2 space-y-1">
              <div className="flex items-start gap-2 text-[10px]">
                <span className={`font-bold ${tradeType.color} whitespace-nowrap`}>{tradeType.label}</span>
                <span className="text-slate-400">{tradeType.narrative}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className={`font-semibold ${instColor}`}>{instLabel}</span>
                {instClass === 'INSTITUTIONAL' && <span className="text-violet-400/60">({trigger.institutionalScore}/100)</span>}
              </div>
              {sessionNarrative && (
                <div className="text-[10px] text-slate-500 italic">{sessionNarrative}</div>
              )}
            </div>
          );
        })()}

        {/* -- INSUFFICIENT FUNDS LABEL (clickable -> Add Funds) -- */}
        {sizing.insufficientFunds && !sizing.disabled && (
          <button
            onClick={(e) => { e.stopPropagation(); onRequestFunds(trigger, plan, sizing.creditAmount, premium, lotSize, multiplier, confidence); }}
            className="mt-3 w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30 hover:bg-orange-500/20 transition-colors cursor-pointer text-left"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <span className="text-[11px] text-orange-400">Insufficient Funds — forced 1 lot (need +&#8377;{sizing.creditAmount.toLocaleString('en-IN')})</span>
            <span className="ml-auto text-[10px] text-orange-300 font-semibold whitespace-nowrap">Add Funds →</span>
          </button>
        )}

        {/* -- FUNDED TRADE BADGE -- */}
        {isFunded && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-lime-500/10 border border-lime-500/25">
            <span className="text-lime-400 font-bold text-sm">₹</span>
            <span className="text-[10px] text-lime-400">Trade executed with added funds</span>
          </div>
        )}

        {/* -- FUTURES FALLBACK REASON -- */}
        {instrumentMode === 'FUTURES' && trigger.optionAvailable === false && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/25">
            <Zap className="w-3 h-3 text-blue-400/80 flex-shrink-0" />
            <span className="text-[10px] text-blue-400/80">
              FUT: Options not available, using futures contract
            </span>
          </div>
        )}

        {/* -- ESTIMATED DATA WARNING -- */}
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
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">score={confidence}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">lots={sizing.lots}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">lotSz={lotSize}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">prem={Number(premium.toFixed(2))}</span>
          {isEstimatedPremium && <span className="px-1 rounded bg-yellow-500/30 text-yellow-300 whitespace-nowrap">EST</span>}
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">alloc={sizing.allocPct}%</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">oa={String(trigger.optionAvailable)}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">fa={String(trigger.futuresAvailable)}</span>
        </div>

        {/* -- BUY BUTTON -- */}
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
          <div className="relative mt-4">
            {isNearExpiry && (
              <span className="absolute -top-2 right-2 z-10 px-2 py-0.5 rounded text-[10px] font-bold text-white bg-red-500">
                Expiry in 2 days!
              </span>
            )}
            <button
              onClick={async (e) => {
                e.stopPropagation();
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
                        strike: trigger.optionStrike || plan.strike || 0,
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
   MAIN: MCX-BB-15 TAB CONTENT
   ═══════════════════════════════════════════════════════════════ */

export const McxBb15TabContent: React.FC<McxBb15TabContentProps> = ({ autoRefresh = true }) => {
  const navigate = useNavigate();
  const [triggers, setTriggers] = useState<McxBbTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
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
    strategyKey: string; creditAmount: number; sig: McxBbTrigger; plan: TradePlan;
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

  const fetchTriggers = useCallback(async () => {
    try {
      const data = await fetchJson<McxBbTrigger[]>('/strategy-state/mcxbb15/triggers');
      if (Array.isArray(data)) {
        setTriggers(data);
      }
    } catch (err) {
      console.error('Error fetching MCX-BB-15 triggers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTriggers(); // Initial load
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(() => { if (isAnyMarketOpen()) fetchTriggers(); }, 60000); // 60s fallback safety net
    }
    // WebSocket push: prepend new triggered signals in real-time
    const onWsSignal = (e: Event) => {
      const sig = (e as CustomEvent).detail;
      if (sig && sig.scripCode) {
        setTriggers(prev => {
          if (prev.some(s => s.scripCode === sig.scripCode)) return prev;
          return [sig, ...prev];
        });
      }
    };
    window.addEventListener('mcxbb-signal', onWsSignal);
    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener('mcxbb-signal', onWsSignal);
    };
  }, [autoRefresh, fetchTriggers]);

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
        const data = await strategyWalletsApi.getCapital('MCX_BB_15');
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
      if (detail?.strategy === 'MCX_BB_15' || detail?.strategy === 'MCX-BB-15') fetchCapital();
    };
    window.addEventListener('wallet-update', onWalletUpdate);
    return () => { clearInterval(interval); window.removeEventListener('wallet-update', onWalletUpdate); };
  }, []);

  /* -- FILTER -- */
  const hasActiveFilter = directionFilter !== 'ALL';

  let filtered = triggers.filter(t => t.triggered);
  if (directionFilter !== 'ALL') {
    filtered = filtered.filter(s => s.direction === directionFilter);
  }

  /* -- ENRICH WITH TRADE PLANS -- */
  const enriched = filtered.map(sig => ({ sig, plan: extractTradePlan(sig) }));

  /* -- SORT -- */
  const sorted = [...enriched].sort((a, b) => {
    switch (sortField) {
      case 'score':
        return b.sig.triggerScore - a.sig.triggerScore;
      case 'rr':
        return b.plan.rr - a.plan.rr;
      case 'surge':
        return (b.sig.surgeT ?? 0) - (a.sig.surgeT ?? 0);
      case 'timestamp':
      default:
        return 0; // preserve server order (most recent first)
    }
  });

  const sortLabel = SORT_OPTIONS.find(o => o.key === sortField)?.label || 'Recent';

  /* -- EXECUTE TRADE (inner) -- builds request and sends to backend -- */
  const executeTrade = useCallback(async (
    sig: McxBbTrigger, plan: TradePlan, lots: number,
    overrideEntry?: number, overrideSl?: number,
    overrideT1?: number | null, overrideT2?: number | null,
    overrideT3?: number | null, overrideT4?: number | null
  ) => {
    const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
    const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
    const isLong = sig.direction === 'BULLISH';

    let premium = 0;
    let instrumentSymbol = '';
    let instrumentType: 'OPTION' | 'FUTURES' = 'OPTION';
    let lotSize = 1;
    let multiplier = 1;
    let tradingScripCode = sig.scripCode;
    let strike = sig.optionStrike ?? plan.strike;
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
    } else {
      premium = estimateOptionPremium(plan);
      instrumentSymbol = `${sig.symbol} ${sig.optionStrike ?? plan.strike} ${sig.optionType ?? plan.optionType ?? ''}`;
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

      const confidence = Math.round(sig.triggerScore);

      const req: StrategyTradeRequest = {
        scripCode: tradingScripCode,
        instrumentSymbol,
        instrumentType,
        underlyingScripCode: sig.scripCode,
        underlyingSymbol: sig.symbol || sig.scripCode,
        side: instrumentType === 'OPTION' ? 'BUY' : (isLong ? 'BUY' : 'SELL'),
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
        optionType: instrumentType === 'OPTION' ? optionType : undefined,
        strike,
        strategy: 'MCX_BB_15',
        exchange: sig.exchange,
        direction: isLong ? 'BULLISH' : 'BEARISH',
        confidence,
        executionMode: 'MANUAL',
      };

      const result = await strategyTradesApi.create(req);

      setExecution(prev => ({
        ...prev,
        status: 'filled',
        filledPrice: result?.entryPrice ?? entryPrice,
        orderId: result?.tradeId,
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

  /* -- BUY HANDLER -- stale price check then dispatch -- */
  const handleBuy = useCallback(async (sig: McxBbTrigger, plan: TradePlan, lots: number) => {
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
    setShowFilter(false);
  }, []);

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="relative">
      {/* -- STICKY HEADER (56px) -- */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50">
        <div className="flex items-center justify-between h-14 px-2 sm:px-4">
          {/* Left: Title */}
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-lime-400" />
            <h1 className="text-lg font-semibold text-lime-400 tracking-tight">MCX-BB-15</h1>
          </div>

          {/* Right: Filter + Sort icons */}
          <div className="flex items-center gap-2">
            {/* Filter */}
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => { e.stopPropagation(); setShowFilter(!showFilter); setShowSort(false); }}
                className={`relative p-2 rounded-lg transition-colors ${
                  hasActiveFilter
                    ? 'bg-lime-500/15 text-lime-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Filter className="w-5 h-5" />
                {hasActiveFilter && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400" />
                )}
              </button>
              {showFilter && (
                <FilterDropdown
                  direction={directionFilter}
                  onDirectionChange={setDirectionFilter}
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

      {/* -- CONTENT -- */}
      <div className="pt-4 pb-8">
        {/* Loading */}
        {loading && triggers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-lime-400 animate-spin mb-4" />
            <span className="text-slate-500 text-sm">Loading MCX-BB-15-30 signals...</span>
          </div>
        )}

        {/* Empty */}
        {!loading && sorted.length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} onReset={resetFilters} />
        )}

        {/* Cards Grid: 1 col mobile, 3 col desktop */}
        {sorted.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 xl:gap-6 xl:px-4">
            {sorted.map(({ sig, plan }) => (
              <McxBbCard
                key={sig.scripCode}
                trigger={sig}
                plan={plan}
                walletState={walletState}
                onBuy={handleBuy}
                onRequestFunds={(s, p, credit, prem, lotSz, mult, conf) => {
                  setFundModal({ strategyKey: 'MCX_BB_15', creditAmount: credit, sig: s, plan: p, premium: prem, lotSize: lotSz, multiplier: mult, confidence: conf });
                }}
                isFunded={fundedScripCodes.has(sig.scripCode)}
                onNavigateToScrip={(sc) => navigate(`/stock/${sc}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* -- EXECUTION OVERLAY -- */}
      <ExecutionOverlay
        state={execution}
        onClose={() => setExecution(s => ({ ...s, visible: false }))}
        onViewPosition={() => {
          setExecution(s => ({ ...s, visible: false }));
          navigate('/wallets');
        }}
      />

      {/* -- FUND TOP-UP MODAL -- */}
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
              const newSizing = computeSlotSizing(ctx.confidence, newWallet, ctx.premium, ctx.lotSize, ctx.multiplier, 'M', 2.0, 60);
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

export default McxBb15TabContent;
