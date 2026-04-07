import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Filter, ArrowUpDown, TrendingUp, TrendingDown,
  Check, Zap, AlertTriangle, Loader2, Clock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchJson, strategyWalletsApi, strategyTradesApi, marketDataApi, greeksApi } from '../../services/api';
import type { StrategyTradeRequest } from '../../types/orders';
import { getOTMStrike, mapToOptionLevels, computeSlotSizing, SlotWalletState, isNseNoTradeWindow, checkStalePriceAdjustment, isAnyMarketOpen } from '../../utils/tradingUtils';
import type { StalePriceResult } from '../../utils/tradingUtils';
import FundTopUpModal from '../Wallet/FundTopUpModal';
import StalePriceModal from './StalePriceModal';
import ConfluenceBadge from './ConfluenceBadge';
import { LiquiditySourceBadge, RetestBadge } from './SignalBadges';

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
  blockTradeFlowLabel?: string;
  oiBuildupPct?: number;
  // KII Quality Adjustment
  effectiveKii?: number;
  rawKii?: number;
  gapFactor?: number;
  expiryFactor?: number;
  gapPct?: number;
  excessGapPct?: number;
  // Gap Quality Score (GQS) — gap-fill trap detection
  gapQualityScore?: number;
  gqsGapAtrRatio?: number;
  gqsGapAtrScore?: number;
  gqsCandleScore?: number;
  gqsBlockFactor?: number;
  gqsDivergenceScore?: number;
  gqsRecoveryScore?: number;
  gqsCandleOpposesGap?: boolean;
  gqsGapRecoveryPct?: number;
  kiiLabel?: string;
  volumeLabel?: string;
  oiChangeLabel?: string;
  oiBuildupLabel?: string;
  gapWarning?: string;
  expiryWarning?: string;
  vixContext?: string;
  indiaVix?: number;
  vixRegime?: string;
  vixAmplifier?: number;
  vixCoupling?: number;
  alignmentScore?: number;
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
  // GIFT Nifty overnight
  giftNiftyOvernightChangePct?: number;
  niftyGapPct?: number;
  optionLotAllocation?: string;
  optionRRpassed?: boolean;
  // ConfluentTargetEngine v2 metadata
  confluenceGrade?: string;
  confluenceRejectReason?: string;
  confluenceFortressScore?: number;
  confluenceRoomRatio?: number;
  confluenceEntryQuality?: string;
  confluenceSlScore?: number;
  confluenceT1Score?: number;
  confluenceLotAllocation?: string;
  confluenceZoneCount?: number;
  confluenceTimePhase?: string;
  confluenceScore?: number;
  hybridRank?: number;
  confluenceSL?: number;
  confluenceT1?: number;
  confluenceT2?: number;
  confluenceT3?: number;
  confluenceT4?: number;
  confluenceRR?: number;
  // Part B: Option confluence
  confluenceOptSL?: number;
  confluenceOptT1?: number;
  confluenceOptT2?: number;
  confluenceOptT3?: number;
  confluenceOptT4?: number;
  confluenceOptRR?: number;
  confluenceOptSlScore?: number;
  confluenceOptT1Score?: number;
  confluenceOptT2Score?: number;
  confluenceOptT3Score?: number;
  confluenceOptT4Score?: number;
  confluenceOptZoneCount?: number;
  // Liquidity source
  liquiditySource?: string;
  // Retest enrichment
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

/* ═══════════════════════════════════════════════════════════════
   SIGNAL CARD UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

type TradeType = 'QUICK_SCALP' | 'CAUTION' | 'GAMMA_SCALP' | 'MOMENTUM' | 'SWING' | 'STANDARD';

function classifyTradeType(sig: FudkiiSignal): { type: TradeType; label: string; color: string } {
  const thetaImpaired = sig.greekThetaImpaired === true;
  const align = (sig.alignmentScore ?? 0) * 100;
  const gapF = sig.gapFactor ?? 1;
  const dte = sig.greekDte ?? 30;
  const gammaBoost = sig.greekGammaBoost ?? 0;
  const gamma = sig.greekGamma ?? 0;
  const iv = sig.greekIV ?? 20;

  if (thetaImpaired)
    return { type: 'QUICK_SCALP', label: 'QUICK SCALP \u2014 all-out at T1', color: 'text-red-400' };
  if (align < 30 && gapF < 0.5)
    return { type: 'CAUTION', label: 'CAUTION \u2014 gap against market, volume inflated', color: 'text-amber-400' };
  if (dte <= 2 && gamma > 0.005)
    return { type: 'GAMMA_SCALP', label: 'GAMMA SCALP \u2014 fast in, fast out', color: 'text-orange-400' };
  if (gammaBoost > 0.2 && align > 50)
    return { type: 'MOMENTUM', label: 'MOMENTUM \u2014 trail to T4', color: 'text-green-400' };
  if (dte > 10 && iv < 20)
    return { type: 'SWING', label: 'SWING \u2014 patient hold, wider stops', color: 'text-cyan-400' };
  return { type: 'STANDARD', label: 'STANDARD \u2014 partial exits T1 \u2192 T4', color: 'text-blue-400' };
}

function generateTradeNarrative(sig: FudkiiSignal, tradeType: TradeType, lotAlloc: number[]): string {
  const delta = sig.greekDelta ?? 0;
  const dte = sig.greekDte ?? 0;
  const theta = sig.greekTheta ?? 0;
  const premium = sig.optionLtp ?? 0;
  const deflation = sig.gapFactor != null ? Math.round((1 - sig.gapFactor) * 100) : 0;
  const oiLabel = sig.oiLabel ?? '';
  const blockPct = sig.blockTradePct ?? 0;
  const blockDetected = sig.blockTradeDetected === true;
  const align = Math.round((sig.alignmentScore ?? 0) * 100);
  const coupling = sig.vixCoupling ?? 0.8;
  const exchange = sig.exchange ?? 'N';

  const oiDesc = oiLabel === 'LONG_BUILDUP' ? 'OI buildup confirms fresh longs'
    : oiLabel === 'SHORT_BUILDUP' ? 'OI buildup confirms fresh shorts'
    : oiLabel === 'SHORT_COVERING' ? 'Short covering in progress'
    : oiLabel === 'LONG_UNWINDING' ? 'Long unwinding in progress' : '';

  const blockDesc = blockDetected && blockPct >= 20
    ? `institutional ${sig.direction === 'BULLISH' ? 'buying' : 'selling'} into `
    : blockDetected ? 'modest institutional presence in ' : '';

  const gapDesc = deflation > 0
    ? ` Volume surge is ${deflation <= 30 ? 'genuine' : 'partially inflated'} (${deflation > 0 ? deflation + '% deflated' : 'no deflation'}).`
    : '';

  const deltaDesc = delta > 0 && premium > 0
    ? ` \u20B9${delta.toFixed(2)} option move per \u20B91 underlying${sig.greekGammaBoost && sig.greekGammaBoost > 0.15 ? ', accelerating on T2+' : ''}.`
    : '';

  switch (tradeType) {
    case 'QUICK_SCALP': {
      const thetaPct = premium > 0 ? Math.abs(theta / premium * 100).toFixed(1) : '0';
      return `${blockDesc}${blockDesc ? 'a strong signal' : oiDesc || 'Strong signal detected'}. But \u03B8 eats \u20B9${Math.abs(theta).toFixed(2)}/day (${thetaPct}% of premium) \u2014 cannot hold overnight. 100% exit at T1. T2\u2013T4 are for reference only. If T1 doesn\u2019t hit by 3:00 PM, consider manual exit.`;
    }
    case 'CAUTION': {
      const stockGap = Math.abs(sig.excessGapPct ?? 0).toFixed(1);
      return `Stock gapped ${stockGap}% ${sig.gapPct && sig.gapPct > 0 ? 'up' : 'down'} against market trend. ${blockDetected ? '' : 'No institutional support \u2014 zero block trades. '}Volume is ${deflation}% gap-driven.${deltaDesc} If taken: tight SL, all-out at T1, do not trail.`;
    }
    case 'GAMMA_SCALP':
      return `${blockDesc}${oiDesc || 'Near-expiry signal'} with DTE ${dte}. Extreme \u03B3 means \u03B4 shifts rapidly.${deltaDesc}${gapDesc} Exit at T1\u2013T2, don\u2019t overstay.`;
    case 'MOMENTUM':
      return `${blockDesc}${align > 50 ? 'trend-aligned gap' : 'confirmed trend'}.${gapDesc}${deltaDesc} ${oiDesc ? oiDesc + '.' : ''} Hold for targets.`;
    case 'SWING': {
      const thetaDaily = premium > 0 ? Math.abs(theta / premium * 100).toFixed(1) : '0';
      return `${oiDesc || 'Genuine signal'}. DTE ${dte} means minimal \u03B8 (${thetaDaily}%/day).${deltaDesc}${gapDesc} Patient hold viable.${exchange !== 'N' && coupling < 0.3 ? ' VIX-decoupled.' : ''}`;
    }
    default:
      return `${blockDesc ? blockDesc + 'a ' : ''}${oiDesc || 'Standard signal'}.${gapDesc}${deltaDesc} Follow lot-split exit plan.`;
  }
}

function inferBlockDirection(sig: FudkiiSignal): { arrow: string; text: string } | null {
  if (!sig.blockTradeDetected) return null;
  const oiLabel = sig.oiLabel ?? '';
  switch (oiLabel) {
    case 'LONG_BUILDUP': return { arrow: '\u25B2', text: 'Institutional Buying' };
    case 'SHORT_BUILDUP': return { arrow: '\u25BC', text: 'Institutional Selling' };
    case 'SHORT_COVERING': return { arrow: '\u25B2', text: 'Institutional Covering' };
    case 'LONG_UNWINDING': return { arrow: '\u25BC', text: 'Institutional Unwinding' };
    default: return { arrow: sig.direction === 'BULLISH' ? '\u25B2' : '\u25BC', text: 'Institutional Activity' };
  }
}

function generateGapNarrative(sig: FudkiiSignal): string[] {
  const lines: string[] = [];
  const exchange = (sig.exchange ?? 'N').toUpperCase();
  const coupling = sig.vixCoupling ?? 0.8;
  const giftNifty = sig.giftNiftyOvernightChangePct ?? 0;
  const gapPct = sig.gapPct ?? 0;
  const niftyGap = sig.niftyGapPct ?? 0;
  const excessGap = sig.excessGapPct ?? 0;
  const align = Math.round((sig.alignmentScore ?? 0) * 100);
  const gapF = sig.gapFactor ?? 1;
  const deflation = Math.round((1 - gapF) * 100);
  const symbol = sig.symbol || sig.scripCode;

  if (exchange === 'M' || exchange === 'MCX') {
    lines.push('MCX decoupled from Nifty (0% VIX sensitivity)');
    if (symbol.match(/GOLD|SILVER/i)) lines.push('Gold/Silver is safe-haven \u2014 moves inverse to equity risk');
    if (Math.abs(gapPct) >= 0.3) lines.push(`Gap ${gapPct > 0 ? '+' : ''}${gapPct.toFixed(1)}% \u2014 full gap is commodity-specific`);
  } else if (exchange === 'C' || exchange === 'CDS') {
    lines.push(`CDS 30% coupled with Nifty via FII flows`);
    if (Math.abs(gapPct) >= 0.3) lines.push(`Gap ${gapPct > 0 ? '+' : ''}${gapPct.toFixed(1)}% \u2014 negligible`);
  } else {
    if (giftNifty !== 0) lines.push(`GIFT Nifty ${giftNifty > 0 ? '+' : ''}${giftNifty.toFixed(1)}% overnight`);
    if (Math.abs(gapPct) >= 0.3) {
      lines.push(`${symbol} ${gapPct > 0 ? '+' : ''}${gapPct.toFixed(1)}% gap (Nifty ${niftyGap > 0 ? '+' : ''}${niftyGap.toFixed(1)}%, stock ${excessGap > 0 ? '+' : ''}${excessGap.toFixed(1)}%)`);
      const alignDesc = align > 60 ? 'WITH trend' : align > 30 ? 'MIXED signals' : 'AGAINST market';
      const riskDesc = align > 60 ? 'low fill risk' : align > 30 ? 'uncertain fill risk' : 'high fill risk';
      lines.push(`Gap ${alignDesc}, ${align}% aligned \u2014 ${riskDesc}`);
      if (deflation > 0) {
        const volDesc = deflation <= 30 ? `partly genuine, deflated only ${deflation}%`
          : deflation <= 50 ? `partially inflated, deflated ${deflation}%`
          : `likely gap-driven, heavily deflated ${deflation}%`;
        lines.push(`Volume surge ${volDesc}`);
      }
    }
  }
  return lines;
}

function generateExpiryNarrative(sig: FudkiiSignal): string[] {
  const dte = sig.greekDte ?? 0;
  const expF = sig.expiryFactor ?? 1;
  const deflation = Math.round((1 - expF) * 100);
  const theta = sig.greekTheta ?? 0;
  const premium = sig.optionLtp ?? 0;
  const gammaBoost = sig.greekGammaBoost ?? 0;
  const lines: string[] = [];
  if (!sig.greekEnriched && dte === 0) return lines;

  if (dte <= 1) {
    lines.push(`Expiry TOMORROW \u2014 heavy rollover, OI deflated ${deflation}%`);
    const thetaPct = premium > 0 ? `${Math.abs(theta / premium * 100).toFixed(1)}% of premium` : '';
    lines.push(`DTE ${dte}: extreme \u03B3 but \u03B8 decays \u20B9${Math.abs(theta).toFixed(2)}/day${thetaPct ? ` (${thetaPct})` : ''}`);
  } else if (dte <= 3) {
    lines.push(`Expiry in ${dte}d \u2014 rollover noise, OI deflated ${deflation}%`);
    lines.push(`DTE ${dte}: high \u03B3${gammaBoost > 0.2 ? ', \u03B4 accelerates targets on T2+' : ', monitor \u03B8 carefully'}`);
  } else if (dte <= 7) {
    lines.push(`Expiry in ${dte}d \u2014 mild rollover noise, OI deflated ${deflation}%`);
    lines.push(`DTE ${dte}: moderate \u03B8, \u03B3 accelerates targets on T2+`);
  } else {
    lines.push(`Expiry in ${dte}d \u2014 OI genuine, no rollover effect`);
    lines.push(`DTE ${dte}: low \u03B8 decay, patient hold viable`);
  }
  return lines;
}

function generateVixNarrative(sig: FudkiiSignal): string[] {
  const vix = sig.indiaVix ?? 0;
  const regime = sig.vixRegime ?? (vix >= 30 ? 'Extreme' : vix >= 25 ? 'High' : vix >= 20 ? 'Elevated' : vix >= 15 ? 'Normal' : 'Low');
  const coupling = sig.vixCoupling ?? 0.8;
  const exchange = (sig.exchange ?? 'N').toUpperCase();
  const symbol = sig.symbol ?? '';
  const isLong = sig.direction === 'BULLISH';
  const lines: string[] = [];
  if (vix <= 0) return lines;

  lines.push(`VIX ${vix.toFixed(1)} ${regime}`);

  if (exchange === 'M' || exchange === 'MCX') {
    if (symbol.match(/GOLD|SILVER/i)) lines.push('MCX Gold/Silver \u2014 does NOT affect pricing');
    else lines.push('MCX (10% coupled) \u2014 minimal VIX impact');
  } else if (exchange === 'C' || exchange === 'CDS') {
    lines.push('CDS 30% coupled \u2014 moderate FII flow effect');
  } else {
    const meaning = vix >= 30 ? 'crisis-level, gap risk both ways'
      : vix >= 25 ? `panic ${isLong ? 'may reverse' : 'amplifies'} ${isLong ? 'CE' : 'PE'} premium`
      : vix >= 20 ? 'wider swings favor option premium'
      : vix >= 15 ? 'fair premium moves'
      : 'calm market, muted premium response';
    lines.push(`NSE 80% coupled \u2014 ${meaning}`);
  }
  return lines;
}

function computeLotSplit(lotAllocation: string | undefined, totalLots: number): number[] {
  const pcts = (lotAllocation || '40,30,20,10').split(',').map(Number);
  if (totalLots <= 0) return [0, 0, 0, 0];
  // Largest remainder method for lot-aligned splits
  const raw = pcts.map(p => (p / 100) * totalLots);
  const floored = raw.map(Math.floor);
  let remaining = totalLots - floored.reduce((a, b) => a + b, 0);
  const remainders = raw.map((r, i) => ({ i, rem: r - floored[i] })).sort((a, b) => b.rem - a.rem);
  for (const r of remainders) {
    if (remaining <= 0) break;
    floored[r.i]++;
    remaining--;
  }
  return floored;
}

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

  // Prefer ConfluentTargetEngine levels (what actually gets traded).
  // Fall back to legacy EntryLevelCalculator levels if confluence not available.
  const hasConfluence = (sig.confluenceSL ?? 0) > 0 && (sig.confluenceT1 ?? 0) > 0;
  if (hasConfluence) {
    return {
      entry: sig.triggerPrice,
      sl: sig.confluenceSL!,
      t1: sig.confluenceT1 ?? null,
      t2: sig.confluenceT2 ?? null,
      t3: sig.confluenceT3 ?? null,
      t4: sig.confluenceT4 ?? null,
      rr: sig.confluenceRR ?? sig.riskReward ?? 0,
      hasPivots: true,
      atr: atrEstimate,
      optionType,
      strike,
      strikeInterval: interval,
    };
  }

  // Legacy fallback: EntryLevelCalculator targets
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
   FUDKII SIGNAL TRADING CARD — v2 (cross-instrumental)
   ═══════════════════════════════════════════════════════════════ */

const FudkiiTradingCard: React.FC<{
  sig: FudkiiSignal;
  plan: TradePlan;
  walletState: SlotWalletState;
  onBuy: (sig: FudkiiSignal, plan: TradePlan, lots: number) => void;
  onRequestFunds: (sig: FudkiiSignal, plan: TradePlan, creditAmount: number, premium: number, lotSize: number, multiplier: number, kiiScore: number) => void;
  isFunded: boolean;
  onNavigateToScrip: (scripCode: string) => void;
}> = ({ sig, plan, walletState, onBuy, onRequestFunds, isFunded, onNavigateToScrip }) => {
  const [pressing, setPressing] = useState(false);
  const [showRevisedPopup, setShowRevisedPopup] = useState(false);
  const [revisedData, setRevisedData] = useState<any>(null);
  const [loadingRevised, setLoadingRevised] = useState(false);
  const [ltpDriftPct, setLtpDriftPct] = useState<number | null>(null);
  const isLong = sig.direction === 'BULLISH';

  // Signal timing
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

  // KII
  const kiiScore = computeKiiScore(sig);
  const effectiveKii = sig.effectiveKii && sig.effectiveKii > 0 ? Math.round(sig.effectiveKii) : kiiScore;
  const rawKii = sig.rawKii && sig.rawKii > 0 ? Math.round(sig.rawKii) : kiiScore;
  const kiiBarPct = Math.min(100, (effectiveKii / 150) * 100);
  const kiiBarColor = effectiveKii >= 80 ? 'bg-green-500' : effectiveKii >= 50 ? 'bg-amber-500' : 'bg-red-500';

  // KII deflation text
  const volDeflation = sig.gapFactor != null && sig.gapFactor < 0.99 ? Math.round((1 - sig.gapFactor) * 100) : 0;
  const oiDeflation = sig.expiryFactor != null && sig.expiryFactor < 0.99 ? Math.round((1 - sig.expiryFactor) * 100) : 0;

  // Instrument detection
  const hasRealOption = sig.optionAvailable === true && sig.optionLtp != null && sig.optionLtp > 0;
  const hasFutures = sig.futuresAvailable === true && sig.futuresLtp != null && sig.futuresLtp > 0;
  const noDerivatives = sig.optionAvailable === false && !hasFutures;
  const isCurrencyPair = /^(USD|EUR|GBP|JPY)INR$/i.test(sig.symbol);

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
    displayInstrumentName = `${sig.symbol || sig.companyName || sig.scripCode} ${expiryMonth ? expiryMonth + ' ' : ''}${displayStrike} ${displayOptionType}`;
    lotSize = sig.optionLotSize ?? 1;
    multiplier = sig.optionMultiplier ?? 1;
  } else if (hasFutures) {
    instrumentMode = 'FUTURES';
    premium = sig.futuresLtp!;
    displayInstrumentName = `${sig.futuresSymbol ?? sig.symbol ?? sig.scripCode} FUT`;
    lotSize = sig.futuresLotSize ?? 1;
    multiplier = sig.futuresMultiplier ?? 1;
  } else if (isCurrencyPair && noDerivatives) {
    instrumentMode = 'FUTURES';
    premium = sig.triggerPrice;
    displayInstrumentName = '';
    lotSize = 1;
  } else if (!noDerivatives) {
    instrumentMode = 'OPTION';
    premium = estimateOptionPremium(plan);
    displayInstrumentName = `${sig.symbol || sig.companyName || sig.scripCode} ${sig.optionStrike ?? plan.strike} ${sig.optionType ?? plan.optionType}`;
    lotSize = 1;
    isEstimatedPremium = true;
  }

  const sizing = (instrumentMode === 'NONE')
    ? { lots: 0, quantity: 0, disabled: true, insufficientFunds: false, creditAmount: 0, allocPct: 0, slotsUsed: 0, maxSlots: 0, exchangeFull: false }
    : computeSlotSizing(kiiScore > 100 ? 80 : kiiScore > 50 ? 65 : 50, walletState, premium, lotSize, multiplier,
        (sig.exchange || 'N').substring(0, 1).toUpperCase(), sig.riskReward ?? 2.0, 50);

  // Cross-instrumental levels — prefer confluence option levels when available
  const hasConflOpt = (sig.confluenceOptSL ?? 0) > 0 && (sig.confluenceOptT1 ?? 0) > 0;
  const hasOptionLevels = hasConflOpt || ((sig.optionSL ?? 0) > 0 && (sig.optionT1 ?? 0) > 0);
  const hasFuturesLevels = (sig.futuresSL ?? 0) > 0 && (sig.futuresT1 ?? 0) > 0;
  const optSL = hasConflOpt ? (sig.confluenceOptSL ?? 0) : (sig.optionSL ?? 0);
  const optT1 = hasConflOpt ? (sig.confluenceOptT1 ?? 0) : (sig.optionT1 ?? 0);
  const optT2 = hasConflOpt ? (sig.confluenceOptT2 ?? 0) : (sig.optionT2 ?? 0);
  const optT3 = hasConflOpt ? (sig.confluenceOptT3 ?? 0) : (sig.optionT3 ?? 0);
  const optT4 = hasConflOpt ? (sig.confluenceOptT4 ?? 0) : (sig.optionT4 ?? 0);
  const optRR = hasConflOpt ? (sig.confluenceOptRR ?? plan.rr) : (sig.optionRR ?? plan.rr);

  // Lot allocation
  const lotAlloc = computeLotSplit(sig.optionLotAllocation ?? sig.lotAllocation, sizing.lots);
  const isAllOutT1 = lotAlloc[0] === sizing.lots;

  // Trade type classification
  const tradeInfo = classifyTradeType(sig);
  const narrative = generateTradeNarrative(sig, tradeInfo.type, lotAlloc);

  // Market context
  const blockDir = inferBlockDirection(sig);
  const gapLines = generateGapNarrative(sig);
  const expiryLines = generateExpiryNarrative(sig);
  const vixLines = generateVixNarrative(sig);

  // Metrics
  const volMultiplier = computeVolumeSurge(sig).toFixed(1);
  const oiVal = computeOIChange(sig);
  const oiChange = (oiVal >= 0 ? '+' : '') + oiVal;
  const oiStyle = getOILabelStyle(sig.oiLabel);
  const blockPct = sig.blockTradePct ?? 0;
  const flowLabel = sig.blockTradeFlowLabel ?? (blockPct >= 40 ? 'DOMINANT_INSTITUTIONAL' : blockPct >= 20 ? 'HEAVY_INSTITUTIONAL' : blockPct >= 10 ? 'MODEST_INSTITUTIONAL' : 'NONE');
  const flowText = flowLabel === 'DOMINANT_INSTITUTIONAL' ? 'Dominant' : flowLabel === 'HEAVY_INSTITUTIONAL' ? 'Heavy' : flowLabel === 'MODEST_INSTITUTIONAL' ? 'Modest' : '';

  // LTP drift check
  const scripForDrift = sig.optionScripCode || '';
  const premiumForDrift = premium;
  useEffect(() => {
    if (!scripForDrift || premiumForDrift <= 0) return;
    const checkDrift = async () => {
      try {
        const res = await marketDataApi.getLtp(scripForDrift);
        if (res?.ltp && res.ltp > 0) setLtpDriftPct(Math.abs(res.ltp - premiumForDrift) / premiumForDrift * 100);
      } catch {}
    };
    checkDrift();
    const iv = setInterval(() => { if (isAnyMarketOpen()) checkDrift(); }, 30000);
    return () => clearInterval(iv);
  }, [scripForDrift, premiumForDrift]);

  // Format helpers
  const fmtEq = (v: number | null | undefined) => v != null && v > 0 ? Number(v.toFixed(0)).toLocaleString('en-IN') : 'DM';
  const fmtOpt = (v: number) => v > 0 ? '\u20B9' + v.toFixed(2) : 'DM';
  const fmtFut = (v: number) => v > 0 ? '\u20B9' + Number(v.toFixed(2)).toLocaleString('en-IN') : 'DM';

  const exitLabel = (idx: number, lots: number) => {
    if (lots <= 0) return '\u2014';
    if (idx === 0 && isAllOutT1) return `\u2713 ${lots} lot${lots > 1 ? 's' : ''} (100%) \u2190 ALL OUT`;
    if (idx === 0) return `\u2717 All ${sizing.lots} lot${sizing.lots > 1 ? 's' : ''}`;
    if (isAllOutT1 && idx > 0) return '\u2014';
    const pct = sizing.lots > 0 ? Math.round(lots / sizing.lots * 100) : 0;
    if (idx <= 2) return `\u2713 ${lots} lot${lots > 1 ? 's' : ''} (${pct}%)`;
    if (idx === 3) return `Trail (${pct}%)`;
    return `Runner (${pct}%)`;
  };

  // Level data: [label, eqValue, optValue, exitText, isHit]
  const levels: [string, number | null, number, string, boolean][] = [
    ['SL', plan.sl, instrumentMode === 'OPTION' ? optSL : 0, exitLabel(0, sizing.lots), false],
    ['T1', plan.t1, instrumentMode === 'OPTION' ? optT1 : 0, exitLabel(1, lotAlloc[0]), false],
    ['T2', plan.t2, instrumentMode === 'OPTION' ? optT2 : 0, exitLabel(2, lotAlloc[1]), false],
    ['T3', plan.t3, instrumentMode === 'OPTION' ? optT3 : 0, exitLabel(3, lotAlloc[2]), false],
    ['T4', plan.t4, instrumentMode === 'OPTION' ? optT4 : 0, exitLabel(4, lotAlloc[3]), false],
  ];

  return (
    <div
      onClick={() => onNavigateToScrip(sig.scripCode)}
      className={`bg-slate-800/90 backdrop-blur-sm rounded-2xl border ${cardBorderGlow}
      overflow-clip transition-shadow duration-200 hover:shadow-lg cursor-pointer`}>
      <div className="p-3 sm:p-4">

        {/* ── HEADER ── */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-white leading-tight flex items-center gap-2">
              {sig.symbol || sig.companyName || sig.scripCode}
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">
              <span>{sig.exchange || 'NSE'}</span>
              <span className="text-slate-700">&bull;</span>
              <span>{formatTriggerTime(sig)}</span>
              {displayInstrumentName && (
                <>
                  <span className="text-slate-700">&bull;</span>
                  <span className="text-slate-400 font-medium truncate">{displayInstrumentName}</span>
                  <LiquiditySourceBadge source={sig.liquiditySource} />
                </>
              )}
              {premium > 0 && premium < 10 && instrumentMode === 'OPTION' && (
                <span className="text-[9px] text-amber-500/70 whitespace-nowrap">
                  ~{((premium < 5 ? 6 : 4) * 0.05 / premium * 100).toFixed(1)}% slip
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isNseNoTradeWindow(sig.exchange, sig.triggerTime) && (
              <span className="p-1 rounded-full bg-amber-500/15 border border-amber-500/30" title="NSE no-trade window">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
              </span>
            )}
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${dirColor}`}>
              {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isLong ? 'Bullish' : 'Bearish'}
            </span>
          </div>
        </div>

        {/* ── KII BAR ── */}
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 font-medium w-6">KII</span>
            <div className="flex-1 h-[6px] rounded-full bg-slate-700/60 overflow-hidden">
              <div className={`h-full rounded-full ${kiiBarColor} transition-all`} style={{ width: `${kiiBarPct}%` }} />
            </div>
            <span className={`text-sm font-bold font-mono ${effectiveKii >= 80 ? 'text-green-400' : effectiveKii >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              {effectiveKii}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
            {rawKii !== effectiveKii ? (
              <>{rawKii} &rarr; {effectiveKii}
                {volDeflation > 0 && <span className="ml-2">vol <span className="text-amber-400">&darr;{volDeflation}%</span></span>}
                {oiDeflation > 0 && <span className="ml-2">OI <span className="text-amber-400">&darr;{oiDeflation}%</span></span>}
              </>
            ) : (
              <span>
                {effectiveKii} &rarr; {effectiveKii}
                {(sig.exchange ?? '').match(/^M/i) ? '  MCX decoupled \u2014 no Nifty gap adjustment' : '  no adjustments'}
              </span>
            )}
          </div>
        </div>

        {/* ── THIN SEPARATOR ── */}
        <div className="border-t border-slate-700/30 my-3" />

        {/* ── LEVELS GRID ── */}
        <div className="space-y-1">
          {levels.map(([label, eqVal, optVal, exitText], i) => {
            const isSL = i === 0;
            const labelColor = isSL ? 'text-red-400' : 'text-emerald-400';
            const eqColor = isSL ? 'text-red-400' : 'text-green-400';
            const optColor = isSL ? 'text-red-400/80' : 'text-green-400/80';
            const dimmed = isAllOutT1 && i >= 2;
            return (
              <div key={label} className={`grid ${hasOptionLevels || hasFuturesLevels ? 'grid-cols-[32px_1fr_1fr_1fr]' : 'grid-cols-[32px_1fr_1fr]'} gap-1 items-center ${dimmed ? 'opacity-40' : ''}`}>
                <span className={`text-[11px] font-semibold ${labelColor}`}>{label}</span>
                <span className={`font-mono text-[12px] ${eqColor}`}>{fmtEq(eqVal)}</span>
                {(hasOptionLevels || hasFuturesLevels) && (
                  <span className={`font-mono text-[12px] ${optColor}`}>
                    {instrumentMode === 'OPTION' && hasOptionLevels ? fmtOpt(optVal) : hasFuturesLevels ? fmtFut(instrumentMode === 'FUTURES' && i === 0 ? (sig.futuresSL ?? 0) : i === 1 ? (sig.futuresT1 ?? 0) : i === 2 ? (sig.futuresT2 ?? 0) : i === 3 ? (sig.futuresT3 ?? 0) : (sig.futuresT4 ?? 0)) : 'DM'}
                  </span>
                )}
                <span className="text-[10px] text-slate-500 truncate">{exitText}</span>
              </div>
            );
          })}
        </div>

        {/* ── R:R BAR ── */}
        <div className="mt-3">
          <div className="flex h-[6px] rounded-full overflow-hidden">
            <div className="bg-red-500/80 rounded-l-full" style={{ width: `${100 / (1 + Math.max(optRR, 0))}%` }} />
            <div className="bg-green-500/80 rounded-r-full" style={{ width: `${100 - 100 / (1 + Math.max(optRR, 0))}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-slate-500">Risk</span>
            <span className="font-mono text-xs">
              {hasOptionLevels && (
                <span className={`font-bold ${optRR >= 2 ? 'text-green-400' : optRR >= 1.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                  R:R {optRR.toFixed(1)} opt
                </span>
              )}
              {hasOptionLevels && plan.rr > 0 && <span className="text-slate-600 mx-1">/</span>}
              {plan.rr > 0 && (
                <span className="text-slate-400">{plan.rr.toFixed(1)} eq</span>
              )}
            </span>
            <span className="flex items-center gap-1 text-[10px]">
              {plan.hasPivots ? (
                <span className="text-blue-400 font-medium">[Pivot]</span>
              ) : (
                <span className="text-slate-500">[ST]</span>
              )}
              <span className="text-slate-500">Reward</span>
            </span>
          </div>
        </div>

        {/* ── CONFLUENCE QUALITY ── */}
        {sig.confluenceGrade && (
          <ConfluenceBadge
            grade={sig.confluenceGrade}
            rejectReason={sig.confluenceRejectReason}
            fortressScore={sig.confluenceFortressScore}
            roomRatio={sig.confluenceRoomRatio}
            entryQuality={sig.confluenceEntryQuality}
            slScore={sig.confluenceSlScore}
            t1Score={sig.confluenceT1Score}
            lotAllocation={sig.confluenceLotAllocation}
            zoneCount={sig.confluenceZoneCount}
            timePhase={sig.confluenceTimePhase}
            confluenceScore={sig.confluenceScore}
            hybridRank={sig.hybridRank}
            conflSL={sig.confluenceSL}
            conflT1={sig.confluenceT1}
            conflT2={sig.confluenceT2}
            conflT3={sig.confluenceT3}
            conflT4={sig.confluenceT4}
            conflRR={sig.confluenceRR}
            conflOptSL={sig.confluenceOptSL}
            conflOptT1={sig.confluenceOptT1}
            conflOptT2={sig.confluenceOptT2}
            conflOptT3={sig.confluenceOptT3}
            conflOptT4={sig.confluenceOptT4}
            conflOptRR={sig.confluenceOptRR}
            conflOptSlScore={sig.confluenceOptSlScore}
            conflOptT1Score={sig.confluenceOptT1Score}
            conflOptZoneCount={sig.confluenceOptZoneCount}
          />
        )}

        {/* ── RETEST BADGE ── */}
        <RetestBadge active={sig.retestActive} aligned={sig.retestDirectionAligned} boost={sig.retestBoost} source={sig.retestSource} level={sig.retestLevel} stage={sig.retestStage} />

        {/* ── MARKET SECTION ── */}
        <div className="mt-3 rounded-xl bg-slate-900/60 border border-slate-700/50 p-2.5">
          {/* Metric columns */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { val: `${volMultiplier}x`, label: sig.volumeLabel || 'Volume', sub: 'Volume',
                color: parseFloat(volMultiplier) >= 3 ? 'text-green-300' : parseFloat(volMultiplier) >= 2 ? 'text-amber-300' : 'text-slate-300' },
              { val: `${oiChange}%`, label: sig.oiChangeLabel || 'OI Chg', sub: 'OI Chg',
                color: Math.abs(oiVal) >= 100 ? 'text-green-300' : Math.abs(oiVal) >= 50 ? 'text-amber-300' : 'text-slate-300' },
              { val: sig.oiBuildupPct != null ? `${sig.oiBuildupPct > 0 ? '+' : ''}${sig.oiBuildupPct.toFixed(1)}%` : 'DM',
                label: sig.oiBuildupLabel || 'Buildup', sub: 'Buildup',
                color: (sig.oiBuildupPct ?? 0) > 5 ? 'text-green-300' : (sig.oiBuildupPct ?? 0) > 0 ? 'text-amber-300' : 'text-red-300' },
              { val: fmt(plan.atr), label: 'ATR', sub: 'ATR', color: 'text-slate-300' },
            ].map(({ val, label, sub, color }) => (
              <div key={sub}>
                <div className={`text-sm font-bold font-mono ${color}`}>{val}</div>
                <div className="text-[9px] text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* OI interpretation */}
          {oiStyle.text && (
            <div className="mt-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                oiStyle.color.includes('green') ? 'bg-green-500/15 border-green-500/30' :
                oiStyle.color.includes('orange') ? 'bg-orange-500/15 border-orange-500/30' :
                'bg-slate-700/50 border-slate-600/30'
              } ${oiStyle.color}`}>
                {oiStyle.text}
              </span>
            </div>
          )}

          {/* Block trade */}
          {sig.blockTradeDetected && blockDir && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span className={`text-[11px] font-bold ${isLong ? 'text-green-400' : 'text-red-400'}`}>{blockDir.arrow}</span>
              <span className="text-[11px] font-semibold text-purple-300">{blockDir.text}</span>
              <span className="text-[11px] font-bold text-purple-200">+{Math.round(blockPct)}%</span>
              <span className="text-[10px] text-purple-400/70">{((sig.blockTradeVol ?? 0) / 1000).toFixed(0)}K shares</span>
            </div>
          )}
          {sig.blockTradeDetected && flowText && (
            <div className="text-[10px] text-purple-400/60 mt-0.5">
              {flowText} &mdash; {Math.round(blockPct)}% of session volume is large block deals
            </div>
          )}
          {!sig.blockTradeDetected && (
            <div className="text-[10px] text-slate-600 mt-2 italic">No block trades detected</div>
          )}
        </div>

        {/* ── GAP + EXPIRY + VIX NARRATIVE ── */}
        {(gapLines.length > 0 || expiryLines.length > 0 || vixLines.length > 0) && (
          <div className="mt-2 rounded-xl bg-slate-900/40 border border-slate-700/30 p-2.5 space-y-0.5">
            {gapLines.map((line, i) => (
              <div key={`g${i}`} className={`text-[10px] font-mono ${i === 0 ? 'text-slate-400' : i <= 1 ? 'text-slate-400/90' : 'text-amber-400/80'}`}>{line}</div>
            ))}
            {expiryLines.length > 0 && gapLines.length > 0 && <div className="h-px bg-slate-700/20 my-1" />}
            {expiryLines.map((line, i) => (
              <div key={`e${i}`} className={`text-[10px] font-mono ${i === 0 ? 'text-orange-400/80' : 'text-orange-400/60'}`}>{line}</div>
            ))}
            {vixLines.length > 0 && (gapLines.length > 0 || expiryLines.length > 0) && <div className="h-px bg-slate-700/20 my-1" />}
            {vixLines.map((line, i) => (
              <div key={`v${i}`} className={`text-[10px] font-mono ${(sig.indiaVix ?? 15) >= 25 ? 'text-red-400/70' : (sig.indiaVix ?? 15) >= 20 ? 'text-blue-400/70' : 'text-blue-400/50'}`}>{line}</div>
            ))}
          </div>
        )}

        {/* ── TRADE INSIGHT ── */}
        <div className="border-t border-slate-700/30 mt-3 pt-3">
          <div className={`text-xs font-bold ${tradeInfo.color} mb-1`}>
            {tradeInfo.type === 'QUICK_SCALP' && '\u26A1 '}{tradeInfo.type === 'CAUTION' && '\u26A0 '}{tradeInfo.label}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">{narrative}</p>
        </div>

        {/* ── INSUFFICIENT FUNDS ── */}
        {sizing.insufficientFunds && !sizing.disabled && (
          <button
            onClick={(e) => { e.stopPropagation(); onRequestFunds(sig, plan, sizing.creditAmount, premium, lotSize, multiplier, kiiScore); }}
            className="mt-3 w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30 hover:bg-orange-500/20 transition-colors cursor-pointer text-left"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <span className="text-[11px] text-orange-400">Insufficient Funds &mdash; forced 1 lot (need +&#8377;{sizing.creditAmount.toLocaleString('en-IN')})</span>
            <span className="ml-auto text-[10px] text-orange-300 font-semibold whitespace-nowrap">Add Funds &rarr;</span>
          </button>
        )}

        {/* ── FUNDED BADGE ── */}
        {isFunded && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <span className="text-emerald-400 font-bold text-sm">&#8377;</span>
            <span className="text-[10px] text-emerald-400">Trade executed with added funds</span>
          </div>
        )}

        {/* ── GREEKS ROW ── */}
        {sig.greekEnriched && (
          <div className="mt-2 flex items-center gap-1 flex-wrap text-[10px] font-mono">
            <span className="text-slate-400">{'\u03B4'}{(sig.greekDelta ?? 0).toFixed(2)}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">{'\u03B3'}{(sig.greekGamma ?? 0).toFixed(4)}</span>
            <span className="text-slate-600">|</span>
            <span className={`${(sig.greekTheta ?? 0) < -3 ? 'text-red-400' : 'text-slate-400'}`}>{'\u03B8'}{(sig.greekTheta ?? 0).toFixed(2)}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">{'\u03BD'}{(sig.greekVega ?? 0).toFixed(2)}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">IV {(sig.greekIV ?? 0).toFixed(0)}%</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">DTE {sig.greekDte ?? 0}</span>
            {sig.greekThetaImpaired && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">{'\u03B8'}-IMPAIRED</span>}
          </div>
        )}

        {/* ── DEBUG STRIP ── */}
        <div className="mt-2 flex gap-1 text-[9px] font-mono opacity-50 overflow-x-auto pb-0.5 custom-scrollbar -mx-1 px-1">
          <span className={`px-1 rounded whitespace-nowrap ${instrumentMode === 'NONE' ? 'bg-red-500/30 text-red-300' : instrumentMode === 'FUTURES' ? 'bg-blue-500/30 text-blue-300' : 'bg-green-500/30 text-green-300'}`}>
            {instrumentMode}
          </span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">eKII={effectiveKii}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">gapF={sig.gapFactor?.toFixed(2) ?? '1.00'}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">expF={sig.expiryFactor?.toFixed(2) ?? '1.00'}</span>
          <span className={`px-1 rounded whitespace-nowrap ${(sig.gapQualityScore ?? 1) < 0.10 ? 'bg-red-500/40 text-red-300 font-bold' : (sig.gapQualityScore ?? 1) < 0.50 ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-600/50 text-slate-300'}`}>
            GQS={sig.gapQualityScore?.toFixed(3) ?? '1.000'}
          </span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">align={Math.round((sig.alignmentScore ?? 0) * 100)}%</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">slM={sig.greekSlMethod || 'N/A'}</span>
          <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">{'\u03B3'}B={sig.greekGammaBoost?.toFixed(2) ?? '0'}</span>
        </div>

        {/* ── GQS DETAIL STRIP (only when GQS < 0.50 — shows why signal was penalized) ── */}
        {sig.gapQualityScore != null && sig.gapQualityScore < 0.50 && (
          <div className="mt-1 flex gap-1 text-[9px] font-mono overflow-x-auto pb-0.5 custom-scrollbar -mx-1 px-1">
            <span className="px-1 rounded bg-red-500/20 text-red-300 whitespace-nowrap">
              Gap/ATR={sig.gqsGapAtrRatio?.toFixed(1) ?? 'DM'}x
            </span>
            <span className={`px-1 rounded whitespace-nowrap ${sig.gqsCandleOpposesGap ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
              {sig.gqsCandleOpposesGap ? 'Recovery candle' : 'Continuation'}
            </span>
            <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">
              GapRecov={sig.gqsGapRecoveryPct?.toFixed(0) ?? 'DM'}%
            </span>
            <span className="px-1 rounded bg-slate-600/50 text-slate-300 whitespace-nowrap">
              Scores: ATR={sig.gqsGapAtrScore?.toFixed(2)} Cdl={sig.gqsCandleScore?.toFixed(2)} Blk={sig.gqsBlockFactor?.toFixed(2)} Div={sig.gqsDivergenceScore?.toFixed(2)} Rec={sig.gqsRecoveryScore?.toFixed(2)}
            </span>
          </div>
        )}

        {/* ── CTA BUTTON ── */}
        {instrumentMode === 'NONE' ? (
          <button
            disabled
            className="w-full h-12 rounded-xl mt-3 text-slate-500 font-semibold text-sm bg-slate-700/30 border border-slate-600/30 cursor-not-allowed"
          >
            No Derivatives Available for {sig.symbol || sig.scripCode}
          </button>
        ) : sizing.disabled ? (
          <button
            disabled
            className="w-full h-12 rounded-xl mt-3 text-slate-400 font-semibold text-sm bg-slate-700/50 cursor-not-allowed"
          >
            KII {effectiveKii} &mdash; Sizing Unavailable
          </button>
        ) : (
          <div className="relative mt-3">
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if ((isBeyond30mBoundary || (isWithin30mWindow && isStale)) && instrumentMode === 'OPTION' && sig.optionScripCode) {
                  setLoadingRevised(true);
                  try {
                    const ltpRes = await marketDataApi.getLtp(sig.optionScripCode);
                    const currentLtp = ltpRes?.ltp;
                    if (currentLtp && currentLtp > 0) {
                      const eqEntry = plan.entry || sig.triggerPrice || 0;
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
                        equityEntry: eqEntry, equitySl: eqSl,
                        equityT1: eqT1, equityT2: eqT2, equityT3: eqT3, equityT4: eqT4,
                      });
                      setRevisedData({ ...revised, currentLtp, originalLtp: premium, signalAge: Math.round(signalAgeMs / 60000), slotsFullOverride: sizing.exchangeFull });
                      setShowRevisedPopup(true);
                    } else {
                      if (sizing.exchangeFull) {
                        if (window.confirm(`Exchange slots full (${sizing.maxSlots}/${sizing.maxSlots}). Override?`)) onBuy(sig, plan, sizing.lots);
                      } else onBuy(sig, plan, sizing.lots);
                    }
                  } catch { onBuy(sig, plan, sizing.lots); }
                  finally { setLoadingRevised(false); }
                } else if (sizing.exchangeFull) {
                  if (window.confirm(`Exchange slots full (${sizing.maxSlots}/${sizing.maxSlots}). Override?`)) onBuy(sig, plan, sizing.lots);
                } else onBuy(sig, plan, sizing.lots);
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
                {isStale && isWithin30mWindow && <span className="text-yellow-300 text-base animate-pulse" title={`LTP drifted ${ltpDriftPct?.toFixed(1)}%`}>{'\u26A0'}</span>}
                {sizing.exchangeFull && !isBeyond30mBoundary && <span className="text-[10px] text-amber-300 bg-amber-500/20 px-1 rounded">SLOTS FULL</span>}
                {loadingRevised ? 'Computing...' : (
                  <>{instrumentMode === 'OPTION' ? 'BUY' : (isLong ? 'BUY' : 'SELL')} {displayInstrumentName} @ &#8377;{fmt(premium)} &times; {sizing.lots} lot{sizing.lots > 1 ? 's' : ''}</>
                )}
              </span>
            </button>

            {/* Revised Greeks Popup */}
            {showRevisedPopup && revisedData && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); setShowRevisedPopup(false); }}>
                <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-white mb-1">Revised Trade Levels</h3>
                  <p className="text-xs text-slate-400 mb-4">Signal is {revisedData.signalAge}m old &mdash; levels recomputed with current LTP</p>
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
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setShowRevisedPopup(false)}
                      className="flex-1 h-10 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-sm transition-colors">Cancel</button>
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
      interval = setInterval(() => { if (isAnyMarketOpen()) fetchFudkii(); }, 60000); // 60s fallback safety net
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
    const interval = setInterval(() => { if (isAnyMarketOpen()) fetchCapital(); }, 30000);
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
      instrumentSymbol = `${sig.symbol} ${sig.optionStrike ?? plan.strike} ${sig.optionType ?? plan.optionType ?? ''}`;
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
        const isLongTrade = hasRealOption || sig.direction === 'BULLISH';
        const staleCheck = checkStalePriceAdjustment(currentLtp, tradeSl, tradeT1, tradeT2, tradeT3, tradeT4, isLongTrade);

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
                onNavigateToScrip={(sc) => navigate(`/stock/${sc}`)}
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
