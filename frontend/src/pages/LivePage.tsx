import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, Clock, Zap, Activity, BarChart3, Target, Shield,
  RefreshCw, ChevronUp, ChevronDown, Flame, Eye, Radio, ArrowUpRight,
  CircleDot, Timer, Wallet, Trophy, AlertTriangle, CheckCircle2, XCircle, Minus,
  ArrowUpDown, SlidersHorizontal, X
} from 'lucide-react'
import { isAnyMarketOpen } from '../utils/tradingUtils'
import { estimateSlippage as estimateSlippageUtil, estimateSlippagePct as estimateSlippagePctUtil } from '../utils/slippageUtils'
import { formatPositionQty } from '../utils/qtyFormat'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LivePosition {
  positionId: string
  scripCode: string
  companyName: string
  side: 'LONG' | 'SHORT'
  quantity: number
  avgEntryPrice: number
  currentPrice: number
  stopLoss: number
  target1: number
  target2: number
  target3?: number
  target4?: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  realizedPnl: number
  tp1Hit: boolean
  t1Hit?: boolean
  t2Hit?: boolean
  t3Hit?: boolean
  t4Hit?: boolean
  slHit?: boolean
  status: string
  trailingType?: string
  trailingStop?: number
  openedAt: string
  lastUpdated: string
  exitReason?: string
  confidence?: number
  instrumentType?: string
  exchange?: string
  lotSize?: number
  lots?: number
  optionSl?: number
  optionT1?: number
  optionT2?: number
  optionT3?: number
  optionT4?: number
  equityLtp?: number
  totalCharges?: number
  chargesBrokerage?: number
  chargesStt?: number
  chargesExchange?: number
  chargesGst?: number
  chargesSebi?: number
  chargesStamp?: number
  exitHistory?: Array<{
    level: string
    lots: number
    qty: number
    price: number
    timestamp: number
    source: string
    pnl?: number
  }>
  // Enrichment metrics
  volumeSurge?: number
  oiChangePercent?: number
  riskReward?: number
  rMultiple?: number
  direction?: string
  optionSymbol?: string
  optionStrike?: number
  optionType?: 'CE' | 'PE'
  optionLotSize?: number
  delta?: number
  strategy?: string
  // Orderbook-aware slippage estimation
  estimatedEntrySlippage?: number
  estimatedEntrySlippageTotal?: number
  estimatedSlippagePct?: number
  slippageTier?: string
}

interface LiveData {
  activePositions: LivePosition[]
  todayExits: LivePosition[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8085/api'
const AUTH_TOKEN_KEY = 'kotsin_auth_token'
const POLL_INTERVAL = 30_000

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Normalize a position from the API — null-guard all numeric fields */
function normalize(p: any): LivePosition {
  return {
    ...p,
    avgEntryPrice: p.avgEntryPrice ?? p.entryPrice ?? 0,
    currentPrice: p.currentPrice ?? p.exitPrice ?? p.avgEntryPrice ?? p.entryPrice ?? 0,
    quantity: p.quantity ?? p.remainingQuantity ?? p.totalQuantity ?? 0,
    unrealizedPnl: p.unrealizedPnl ?? 0,
    unrealizedPnlPercent: p.unrealizedPnlPercent ?? (
      (p.avgEntryPrice || p.entryPrice) && p.quantity
        ? ((p.unrealizedPnl ?? 0) / Math.abs((p.avgEntryPrice || p.entryPrice || 1) * (p.quantity || 1))) * 100
        : 0
    ),
    realizedPnl: p.realizedPnl ?? p.pnl ?? 0,
    stopLoss: p.stopLoss ?? p.sl ?? 0,
    target1: p.target1 ?? p.t1 ?? 0,
    target2: p.target2 ?? p.t2 ?? 0,
    target3: p.target3 ?? p.t3 ?? 0,
    target4: p.target4 ?? p.t4 ?? 0,
    openedAt: p.openedAt ?? '',
    lastUpdated: p.lastUpdated ?? p.closedAt ?? p.openedAt ?? '',
    status: p.status ?? 'UNKNOWN',
    companyName: p.companyName ?? p.symbol ?? p.instrumentSymbol ?? p.scripCode ?? '',
    side: p.side ?? 'LONG',
    positionId: p.positionId ?? p.tradeId ?? p.scripCode ?? '',
    totalCharges: p.totalCharges ?? p.charges?.total ?? 0,
    chargesBrokerage: p.chargesBrokerage ?? p.charges?.brokerage ?? 0,
    chargesStt: p.chargesStt ?? p.charges?.stt ?? 0,
    chargesExchange: p.chargesExchange ?? p.charges?.exchangeCharges ?? 0,
    chargesGst: p.chargesGst ?? p.charges?.gst ?? 0,
    chargesSebi: p.chargesSebi ?? p.charges?.sebi ?? 0,
    chargesStamp: p.chargesStamp ?? p.charges?.stampDuty ?? 0,
    confidence: p.confidence ?? 0,
    volumeSurge: p.volumeSurge ?? 0,
    oiChangePercent: p.oiChangePercent ?? p.oiChangePct ?? 0,
    riskReward: p.riskReward ?? 0,
    rMultiple: p.rMultiple ?? 0,
    tp1Hit: p.tp1Hit ?? false,
    t1Hit: p.t1Hit != null ? p.t1Hit : (p.targetsHit != null && p.targetsHit >= 1),
    t2Hit: p.t2Hit != null ? p.t2Hit : (p.targetsHit != null && p.targetsHit >= 2),
    t3Hit: p.t3Hit != null ? p.t3Hit : (p.targetsHit != null && p.targetsHit >= 3),
    t4Hit: p.t4Hit != null ? p.t4Hit : (p.targetsHit != null && p.targetsHit >= 4),
  }
}

async function fetchLiveData(): Promise<LiveData> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${API_BASE}/live`, { headers })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const raw = await response.json()
  return {
    activePositions: (raw.activePositions || []).map(normalize),
    todayExits: (raw.todayExits || []).map(normalize),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Indian number formatting: 1,23,456 / 2.45L / 1.12Cr */
const formatINR = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}Cr`
  if (abs >= 100_000) return `${(n / 100_000).toFixed(2)}L`
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

/** Parse timestamp — handles ISO string, epoch millis (number or string) */
const parseTimestamp = (v: string | number | null | undefined): Date | null => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return new Date(v)
  const n = Number(v)
  // Epoch millis are > 1e12 (year ~2001+)
  if (!isNaN(n) && n > 1e12) return new Date(n)
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/** Format timestamp to IST: "30 Mar, 09:46 am" */
const formatTime = (v: string | number | null | undefined): string => {
  const d = parseTimestamp(v)
  if (!d) return ''
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(',', ',')
}

/** Format just the time portion: "09:46 am" */
const formatTimeOnly = (v: string | number | null | undefined): string => {
  const d = parseTimestamp(v)
  if (!d) return ''
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** Relative time: "12m ago", "2h ago" */
const timeAgo = (v: string | number | null | undefined): string => {
  const d = parseTimestamp(v)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Derive instrument display name: "COALINDIA CE 457.50" or "COALINDIA" */
const getDisplayName = (p: LivePosition): string => {
  const base = p.companyName || p.scripCode || 'Unknown'
  if (p.optionType && p.optionStrike) {
    return `${base} ${p.optionType} ${(p.optionStrike ?? 0).toLocaleString('en-IN')}`
  }
  if (p.optionSymbol) return p.optionSymbol
  return base
}

/** Direction from side */
const getDirection = (p: LivePosition): 'BULLISH' | 'BEARISH' => {
  if (p.direction === 'BULLISH' || p.direction === 'BEARISH') return p.direction
  // For options: LONG on CE = BULLISH, LONG on PE = BEARISH
  if (p.optionType === 'PE') return 'BEARISH'
  if (p.optionType === 'CE') return 'BULLISH'
  return p.side === 'LONG' ? 'BULLISH' : 'BEARISH'
}

/** Count targets hit */
const getTargetsHit = (p: LivePosition): number => {
  let count = 0
  if (p.t1Hit || p.tp1Hit) count++
  if (p.t2Hit) count++
  if (p.t3Hit) count++
  if (p.t4Hit) count++
  return count
}

/** Total target levels available */
const getTotalTargets = (p: LivePosition): number => {
  let count = 0
  if (p.target1 || p.optionT1) count++
  if (p.target2 || p.optionT2) count++
  if (p.target3 || p.optionT3) count++
  if (p.target4 || p.optionT4) count++
  return Math.max(count, 4)
}

/** Estimate round-trip slippage in rupees for a position.
 *  Prefers backend orderbook-aware estimate; falls back to static tick model. */
const estimateSlippage = (p: LivePosition): number => {
  if (p.estimatedEntrySlippageTotal != null && p.estimatedEntrySlippageTotal > 0) {
    return p.estimatedEntrySlippageTotal
  }
  const exchange = (p.exchange || 'N').charAt(0).toUpperCase()
  return estimateSlippageUtil(p.avgEntryPrice || 0, Math.abs(p.quantity || 0), exchange)
}

/** Estimate slippage as percentage of entry cost.
 *  Prefers backend orderbook-aware estimate; falls back to static tick model. */
const estimateSlippagePct = (p: LivePosition): number => {
  if (p.estimatedSlippagePct != null && p.estimatedSlippagePct > 0) {
    return p.estimatedSlippagePct
  }
  const exchange = (p.exchange || 'N').charAt(0).toUpperCase()
  return estimateSlippagePctUtil(p.avgEntryPrice || 0, Math.abs(p.quantity || 0), exchange)
}

/** Human-friendly exit reason */
const mapExitReason = (reason?: string): string => {
  if (!reason) return 'Position Closed'
  const r = reason.toUpperCase()
  if (r.startsWith('T1')) return 'Target 1 Achieved'
  if (r.startsWith('T2')) return 'Target 2 Achieved'
  if (r.startsWith('T3')) return 'Target 3 Achieved'
  if (r.startsWith('T4')) return 'Target 4 Achieved'
  if (r.startsWith('SL')) return 'Risk Managed'
  if (r.includes('DD')) return 'Profit Protected'
  if (r === 'EOD') return 'Session Close'
  if (r === 'OI_EXIT') return 'Flow Reversal'
  if (r.includes('TRAIL')) return 'Trailing Stop'
  return 'Position Closed'
}

// ---------------------------------------------------------------------------
// Vanity metric derivations
// ---------------------------------------------------------------------------

const getMomentumScore = (p: LivePosition): number => {
  const surge = p.volumeSurge || 0
  if (surge > 0) return Math.min(100, Math.round(surge * 20))
  // Fallback: derive from confidence + riskReward when volumeSurge unavailable
  return Math.min(100, Math.round(((p.confidence || 50) * 0.6) + ((p.riskReward || 1.5) * 12)))
}

const getMarketPulse = (p: LivePosition): number =>
  Math.min(100, Math.round(p.confidence || 65))

const getVolatilityIndex = (p: LivePosition): string => {
  const surge = p.volumeSurge || 0
  if (surge > 0) return `${surge.toFixed(1)}x`
  // Fallback: derive from riskReward
  return `${((p.riskReward || 1.5) * 0.8).toFixed(1)}x`
}

const getInstitutionalFlow = (p: LivePosition): string => {
  const pct = Math.abs(p.oiChangePercent ?? 0)
  if (pct > 20) return 'Strong'
  if (pct > 5) return 'Moderate'
  if (pct > 0) return 'Low'
  // Fallback when OI data unavailable: derive from confidence
  const conf = p.confidence || 50
  if (conf > 70) return 'Strong'
  if (conf > 40) return 'Moderate'
  return 'Low'
}

const getSignalStrength = (p: LivePosition): number =>
  Math.min(100, Math.round((p.riskReward ?? 2.0) * 30))

const getRMultiple = (p: LivePosition): string => {
  if (p.rMultiple != null) return p.rMultiple.toFixed(1)
  // Derive from PnL / risk
  const pnl = p.quantity > 0 ? p.unrealizedPnl : p.realizedPnl
  const risk = Math.abs(p.avgEntryPrice - p.stopLoss) * Math.abs(p.quantity)
  if (risk > 0) return (pnl / risk).toFixed(1)
  return '0.0'
}

const getConviction = (p: LivePosition): number =>
  Math.min(100, Math.round(p.confidence ?? 60))

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

/** Animated loading skeleton */
function LoadingSkeleton() {
  return (
    <div className="space-y-4 px-4 pt-4">
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-slate-800/60 rounded-2xl animate-pulse" />
        ))}
      </div>
      {/* Tab skeleton */}
      <div className="h-12 bg-slate-800/60 rounded-xl animate-pulse" />
      {/* Card skeletons */}
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-64 bg-slate-800/40 rounded-2xl animate-pulse" />
      ))}
    </div>
  )
}

/** Summary stats bar */
function SummaryStats({ active, exits }: { active: LivePosition[]; exits: LivePosition[] }) {
  const totalActive = active.length
  const unrealizedPnl = active.reduce((s, p) => s + (p.unrealizedPnl || 0), 0)
  const realizedPnl = exits.reduce((s, p) => s + (p.realizedPnl || 0), 0)
  const todayPnl = unrealizedPnl + realizedPnl
  const wins = exits.filter(p => (p.realizedPnl || 0) > 0).length
  const winRate = exits.length > 0 ? Math.round((wins / exits.length) * 100) : 0
  const capitalDeployed = active.reduce((s, p) => s + Math.abs(p.avgEntryPrice * p.quantity), 0)

  const stats = [
    {
      label: 'Active Trades',
      value: totalActive.toString(),
      icon: Radio,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/20',
    },
    {
      label: "Today's P&L",
      value: `${todayPnl >= 0 ? '+' : ''}₹${formatINR(todayPnl)}`,
      icon: todayPnl >= 0 ? TrendingUp : TrendingDown,
      color: todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
      bgColor: todayPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10',
      borderColor: todayPnl >= 0 ? 'border-emerald-500/20' : 'border-red-500/20',
    },
    {
      label: 'Win Rate',
      value: exits.length > 0 ? `${winRate}%` : '--',
      icon: Trophy,
      color: winRate >= 60 ? 'text-emerald-400' : winRate >= 40 ? 'text-amber-400' : 'text-red-400',
      bgColor: winRate >= 60 ? 'bg-emerald-500/10' : winRate >= 40 ? 'bg-amber-500/10' : 'bg-red-500/10',
      borderColor: winRate >= 60 ? 'border-emerald-500/20' : winRate >= 40 ? 'border-amber-500/20' : 'border-red-500/20',
    },
    {
      label: 'Capital Deployed',
      value: capitalDeployed > 0 ? `₹${formatINR(capitalDeployed)}` : '--',
      icon: Wallet,
      color: 'text-violet-400',
      bgColor: 'bg-violet-500/10',
      borderColor: 'border-violet-500/20',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`relative overflow-hidden rounded-2xl border ${s.borderColor} ${s.bgColor} backdrop-blur-sm p-3 sm:p-4`}
        >
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-1.5 mb-1.5">
              <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
              <span className="text-[10px] sm:text-xs text-slate-500 font-medium uppercase tracking-wider">{s.label}</span>
            </div>
            <div className={`text-lg sm:text-xl lg:text-2xl font-bold ${s.color} tabular-nums`}>
              {s.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Active position card */
function ActivePositionCard({ position: p }: { position: LivePosition }) {
  const direction = getDirection(p)
  const isBullish = direction === 'BULLISH'
  const targetsHit = getTargetsHit(p)
  const totalTargets = getTotalTargets(p)
  const isTrailing = !!p.trailingType || !!p.trailingStop
  const pnl = p.unrealizedPnl || 0
  const pnlPct = p.unrealizedPnlPercent || 0
  const isProfit = pnl >= 0

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-800/50 backdrop-blur-sm transition-all duration-300 hover:border-slate-600/80 hover:shadow-lg hover:shadow-black/20">
      {/* Top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${isBullish ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-red-500 to-red-400'}`} />

      <div className="p-4 space-y-3.5">
        {/* Header row: LIVE badge + direction badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
            {isTrailing && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/25">
                <Zap className="w-2.5 h-2.5 animate-pulse" />
                Trailing
              </span>
            )}
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
            isBullish
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
              : 'bg-red-500/15 text-red-400 border border-red-500/25'
          }`}>
            {isBullish ? 'Bullish' : 'Bearish'}
            {isBullish ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        </div>

        {/* Instrument name + time */}
        <div>
          <h3 className="text-base sm:text-lg font-bold text-white leading-tight">
            {getDisplayName(p)}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {formatTime(p.openedAt)}
          </p>
        </div>

        {/* Entry / Current row */}
        <div className="flex items-center gap-4">
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Entry</span>
            <p className="text-sm font-semibold text-slate-300 tabular-nums">₹{p.avgEntryPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
          </div>
          <ArrowUpRight className={`w-4 h-4 ${isProfit ? 'text-emerald-500' : 'text-red-500'}`} />
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Current</span>
            <p className={`text-sm font-semibold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
              ₹{p.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Target progress */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-700/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Target Progress</span>
            <span className="text-[11px] font-bold text-slate-300">{targetsHit}/{totalTargets}</span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden mb-2">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                targetsHit === totalTargets
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                  : 'bg-gradient-to-r from-amber-500 to-amber-400'
              }`}
              style={{ width: `${(targetsHit / totalTargets) * 100}%` }}
            />
          </div>
          {/* Target dots */}
          <div className="flex items-center gap-2">
            {[
              { hit: p.t1Hit || p.tp1Hit, label: 'T1' },
              { hit: p.t2Hit, label: 'T2' },
              { hit: p.t3Hit, label: 'T3' },
              { hit: p.t4Hit, label: 'T4' },
            ].map((t) => (
              <div key={t.label} className="flex items-center gap-1">
                <span className={`text-[10px] font-semibold ${t.hit ? 'text-emerald-400' : 'text-slate-600'}`}>
                  {t.label}
                </span>
                {t.hit ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ) : (
                  <CircleDot className="w-3 h-3 text-slate-600" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Qty + trailing row */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">
            Size: <span className="text-slate-300 font-semibold">{formatPositionQty({
              instrumentType: p.instrumentType,
              quantity: p.quantity,
              lots: p.lots,
              lotSize: p.lotSize ?? p.optionLotSize,
            })}</span>
          </span>
          {p.exchange && (
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
              p.exchange === 'N' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                : p.exchange === 'M' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
            }`}>
              {p.exchange === 'N' ? 'NSE' : p.exchange === 'M' ? 'MCX' : p.exchange === 'C' ? 'CDS' : p.exchange}
            </span>
          )}
        </div>

        {/* P&L hero */}
        <div className={`rounded-xl p-3 ${isProfit ? 'bg-emerald-500/8 border border-emerald-500/15' : 'bg-red-500/8 border border-red-500/15'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">P&L</span>
            <div className="flex items-center gap-2">
              <span className={`text-lg sm:text-xl font-bold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                {pnl >= 0 ? '+' : ''}₹{formatINR(pnl)}
              </span>
              <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${
                isProfit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Estimated slippage */}
        {(() => {
          const slip = estimateSlippage(p)
          const slipPct = estimateSlippagePct(p)
          return slip > 0 ? (
            <div className="flex items-center justify-between text-[10px] text-slate-600">
              <span className="flex items-center gap-1">
                <ArrowUpDown className="w-3 h-3" />
                Est. Round-trip Slippage
                {p.slippageTier && p.slippageTier !== 'STATIC' && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-400">{p.slippageTier}</span>
                )}
              </span>
              <span className={`tabular-nums ${slipPct > 3 ? 'text-amber-500' : 'text-slate-500'}`}>
                ~₹{slip.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                <span className="ml-1 text-[9px]">({slipPct.toFixed(1)}%)</span>
              </span>
            </div>
          ) : null
        })()}

        {/* Vanity metrics */}
        <div className="rounded-xl bg-slate-900/40 border border-slate-700/30 p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <VanityMetric icon={Flame} label="Momentum" value={getMomentumScore(p).toString()} color={getMomentumScore(p) > 70 ? 'text-amber-400' : 'text-slate-400'} />
            <VanityMetric icon={Activity} label="Flow" value={getInstitutionalFlow(p)} color={getInstitutionalFlow(p) === 'Strong' ? 'text-emerald-400' : 'text-slate-400'} />
            <VanityMetric icon={BarChart3} label="Vol Index" value={getVolatilityIndex(p)} color="text-violet-400" />
            <VanityMetric icon={Eye} label="Pulse" value={getMarketPulse(p).toString()} color={getMarketPulse(p) > 70 ? 'text-cyan-400' : 'text-slate-400'} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Exited trade card */
function ExitedTradeCard({ position: p }: { position: LivePosition }) {
  const [showCharges, setShowCharges] = useState(false)
  const direction = getDirection(p)
  const isBullish = direction === 'BULLISH'
  const pnl = p.realizedPnl || 0
  const isWin = pnl > 0
  const isLoss = pnl < 0
  const targetsHit = getTargetsHit(p)
  const totalTargets = getTotalTargets(p)
  const exitPrice = p.currentPrice || p.avgEntryPrice
  const entryCost = Math.abs(p.avgEntryPrice * p.quantity)
  const pnlPct = entryCost > 0 ? (pnl / entryCost) * 100 : 0

  const hasCharges = p.totalCharges != null && p.totalCharges > 0

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/30 backdrop-blur-sm transition-all duration-300 hover:border-slate-600/60">
      {/* Top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${
        isWin ? 'bg-gradient-to-r from-emerald-500/60 to-emerald-400/60'
          : isLoss ? 'bg-gradient-to-r from-red-500/60 to-red-400/60'
          : 'bg-gradient-to-r from-slate-500/60 to-slate-400/60'
      }`} />

      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              isWin ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                : isLoss ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                : 'bg-slate-500/15 text-slate-400 border border-slate-500/25'
            }`}>
              {isWin ? <CheckCircle2 className="w-2.5 h-2.5" /> : isLoss ? <XCircle className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
              Exited
            </span>
            <span className="text-[10px] text-slate-600">{timeAgo(p.lastUpdated)}</span>
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
            isBullish
              ? 'bg-emerald-500/10 text-emerald-500/70 border border-emerald-500/15'
              : 'bg-red-500/10 text-red-500/70 border border-red-500/15'
          }`}>
            {isBullish ? 'Bullish' : 'Bearish'}
            {isBullish ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        </div>

        {/* Instrument name + time range */}
        <div>
          <h3 className="text-base font-bold text-slate-300 leading-tight">
            {getDisplayName(p)}
          </h3>
          <p className="text-[11px] text-slate-600 mt-0.5">
            {formatTimeOnly(p.openedAt)} → {formatTimeOnly(p.lastUpdated)}
          </p>
        </div>

        {/* Entry / Exit row */}
        <div className="flex items-center gap-4">
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Entry</span>
            <p className="text-sm font-semibold text-slate-400 tabular-nums">₹{p.avgEntryPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
          </div>
          <ArrowUpRight className={`w-4 h-4 ${isWin ? 'text-emerald-500/60' : 'text-red-500/60'}`} />
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Exit</span>
            <p className="text-sm font-semibold text-slate-400 tabular-nums">₹{exitPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
          </div>
        </div>

        {/* P&L hero row */}
        <div className={`rounded-xl p-3 flex items-center justify-between ${
          isWin ? 'bg-emerald-500/8 border border-emerald-500/12'
            : isLoss ? 'bg-red-500/8 border border-red-500/12'
            : 'bg-slate-700/20 border border-slate-700/30'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold tabular-nums ${isWin ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-slate-400'}`}>
              {pnl >= 0 ? '+' : ''}₹{formatINR(pnl)}
            </span>
            <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${
              isWin ? 'bg-emerald-500/20 text-emerald-400'
                : isLoss ? 'bg-red-500/20 text-red-400'
                : 'bg-slate-700/30 text-slate-500'
            }`}>
              {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
            </span>
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${
            isWin ? 'bg-emerald-500/20 text-emerald-400' : isLoss ? 'bg-red-500/20 text-red-400' : 'bg-slate-700/30 text-slate-500'
          }`}>
            {isWin ? 'WIN' : isLoss ? 'LOSS' : 'FLAT'}
          </span>
        </div>

        {/* Targets & exit reason */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">
            Targets: <span className="text-slate-400 font-semibold">{targetsHit}/{totalTargets} hit</span>
          </span>
          <span className="text-slate-500">
            Exit: <span className="text-slate-400 font-medium">{mapExitReason(p.exitReason)}</span>
          </span>
        </div>

        {/* Estimated slippage (always shown for exited trades) */}
        {(() => {
          const slip = estimateSlippage(p)
          const slipPct = estimateSlippagePct(p)
          return slip > 0 ? (
            <div className="flex items-center justify-between text-[10px] text-slate-600">
              <span className="flex items-center gap-1">
                <ArrowUpDown className="w-3 h-3" />
                Est. Slippage
              </span>
              <span className={`tabular-nums ${slipPct > 3 ? 'text-amber-500' : 'text-slate-500'}`}>
                ~₹{slip.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                <span className="ml-1 text-[9px]">({slipPct.toFixed(1)}%)</span>
              </span>
            </div>
          ) : null
        })()}

        {/* Charges section (collapsible) */}
        {hasCharges && (
          <div>
            <button
              onClick={() => setShowCharges(!showCharges)}
              className="w-full flex items-center justify-between text-[10px] text-slate-600 hover:text-slate-400 transition-colors py-1"
            >
              <span className="uppercase tracking-wider font-medium">Charges</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-semibold">₹{(p.totalCharges || 0).toFixed(2)}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showCharges ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {showCharges && (
              <div className="rounded-lg bg-slate-900/50 border border-slate-700/30 p-2.5 mt-1 space-y-1.5">
                <ChargeRow label="Brokerage" value={p.chargesBrokerage} />
                <ChargeRow label="STT" value={p.chargesStt} />
                <ChargeRow label="Exchange" value={p.chargesExchange} />
                <ChargeRow label="GST" value={p.chargesGst} />
                <ChargeRow label="SEBI" value={p.chargesSebi} />
                <ChargeRow label="Stamp" value={p.chargesStamp} />
                <ChargeRow label="Est. Slippage" value={estimateSlippage(p)} />
                <div className="border-t border-slate-700/40 pt-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400">Total Charges</span>
                  <span className="text-[11px] font-bold text-slate-300">₹{((p.totalCharges || 0) + estimateSlippage(p)).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vanity metrics */}
        <div className="rounded-xl bg-slate-900/30 border border-slate-700/20 p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <VanityMetric icon={Target} label="Signal Str" value={getSignalStrength(p).toString()} color={getSignalStrength(p) > 70 ? 'text-amber-400' : 'text-slate-500'} />
            <VanityMetric icon={Shield} label="R-Multiple" value={getRMultiple(p)} color={parseFloat(getRMultiple(p)) > 0 ? 'text-emerald-400' : 'text-red-400'} />
            <VanityMetric icon={Timer} label="Duration" value={getDuration(p)} color="text-slate-400" />
            <VanityMetric icon={Eye} label="Conviction" value={getConviction(p).toString()} color={getConviction(p) > 60 ? 'text-cyan-400' : 'text-slate-500'} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Single vanity metric row */
function VanityMetric({ icon: Icon, label, value, color }: { icon: typeof Activity; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-3 h-3 ${color} shrink-0`} />
      <span className="text-[10px] text-slate-600 font-medium">{label}</span>
      <span className={`text-[11px] font-bold ml-auto tabular-nums ${color}`}>{value}</span>
    </div>
  )
}

/** Charge row */
function ChargeRow({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-slate-600">{label}</span>
      <span className="text-[10px] text-slate-500 tabular-nums">₹{(value || 0).toFixed(2)}</span>
    </div>
  )
}

/** Duration helper */
function getDuration(p: LivePosition): string {
  const start = parseTimestamp(p.openedAt)
  const end = parseTimestamp(p.lastUpdated)
  if (!start || !end) return '--'
  const diff = end.getTime() - start.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`
}

/** Empty state */
function EmptyState({ tab }: { tab: 'active' | 'exits' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
        tab === 'active' ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-slate-700/30 border border-slate-700/40'
      }`}>
        {tab === 'active' ? (
          <Radio className="w-7 h-7 text-blue-500/50" />
        ) : (
          <Clock className="w-7 h-7 text-slate-600" />
        )}
      </div>
      <h3 className="text-sm font-semibold text-slate-400 mb-1">
        {tab === 'active' ? 'No Active Positions' : "No Exits Today"}
      </h3>
      <p className="text-[11px] text-slate-600 text-center max-w-[240px]">
        {tab === 'active'
          ? 'Waiting for market signals. Positions will appear here when trades are triggered.'
          : 'Completed trades will appear here as positions are closed throughout the day.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

type LiveTab = 'active' | 'exits'
type SortKey = 'time' | 'pnl' | 'pnlPct' | 'name'
type FilterDir = 'all' | 'bullish' | 'bearish'
type FilterResult = 'all' | 'win' | 'loss'
type FilterExchange = 'all' | 'N' | 'M' | 'C'

export default function LivePage() {
  const [data, setData] = useState<LiveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<LiveTab>('active')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Sort & filter state
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)
  const [filterDir, setFilterDir] = useState<FilterDir>('all')
  const [filterResult, setFilterResult] = useState<FilterResult>('all')
  const [filterExchange, setFilterExchange] = useState<FilterExchange>('all')
  const [showFilters, setShowFilters] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const result = await fetchLiveData()
      setData(result)
      setError(null)
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Error loading live data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + polling
  useEffect(() => {
    loadData()
    let interval: ReturnType<typeof setInterval> | null = null
    if (autoRefresh) {
      interval = setInterval(() => {
        if (isAnyMarketOpen()) loadData()
      }, POLL_INTERVAL)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [autoRefresh, loadData])

  // Sorting helper
  const sortPositions = useCallback((arr: LivePosition[]) => {
    const dir = sortAsc ? 1 : -1
    return [...arr].sort((a, b) => {
      switch (sortKey) {
        case 'pnl': return dir * ((a.unrealizedPnl || a.realizedPnl || 0) - (b.unrealizedPnl || b.realizedPnl || 0))
        case 'pnlPct': {
          const aPct = (a.avgEntryPrice && a.quantity) ? ((a.unrealizedPnl || a.realizedPnl || 0) / Math.abs(a.avgEntryPrice * a.quantity)) * 100 : 0
          const bPct = (b.avgEntryPrice && b.quantity) ? ((b.unrealizedPnl || b.realizedPnl || 0) / Math.abs(b.avgEntryPrice * b.quantity)) * 100 : 0
          return dir * (aPct - bPct)
        }
        case 'name': return dir * (a.companyName || '').localeCompare(b.companyName || '')
        default: {
          const ta = parseTimestamp(a.openedAt)?.getTime() ?? 0
          const tb = parseTimestamp(b.openedAt)?.getTime() ?? 0
          return dir * (ta - tb)
        }
      }
    })
  }, [sortKey, sortAsc])

  // Filtering helper
  const filterPositions = useCallback((arr: LivePosition[]) => {
    return arr.filter(p => {
      if (filterDir !== 'all') {
        const d = getDirection(p).toLowerCase()
        if (filterDir !== d) return false
      }
      if (filterExchange !== 'all') {
        const ex = (p.exchange || 'N').toUpperCase()
        if (ex !== filterExchange) return false
      }
      if (filterResult !== 'all') {
        const pnl = p.unrealizedPnl || p.realizedPnl || 0
        if (filterResult === 'win' && pnl <= 0) return false
        if (filterResult === 'loss' && pnl >= 0) return false
      }
      return true
    })
  }, [filterDir, filterExchange, filterResult])

  const activePositions = useMemo(() =>
    sortPositions(filterPositions(data?.activePositions || [])),
    [data?.activePositions, sortPositions, filterPositions]
  )

  const todayExits = useMemo(() =>
    sortPositions(filterPositions(data?.todayExits || [])),
    [data?.todayExits, sortPositions, filterPositions]
  )

  // Reset filters when switching tabs
  const handleTabChange = useCallback((tab: LiveTab) => {
    setActiveTab(tab)
    setFilterDir('all')
    setFilterResult('all')
    setFilterExchange('all')
    setSortKey('time')
    setSortAsc(false)
    setShowFilters(false)
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 mobile-page-bottom">
      {/* Sticky header */}
      <div className="bg-slate-900/95 backdrop-blur-xl border-b border-slate-800/80 sticky top-0 z-20">
        <div className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 max-w-[1400px] mx-auto">
          {/* Title row */}
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center">
                <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
              </div>
              <div>
                <h1 className="text-base sm:text-xl font-bold text-white leading-tight">Live Trades</h1>
                {lastRefresh && (
                  <p className="text-[9px] sm:text-[10px] text-slate-600 mt-0.5">
                    Updated {lastRefresh.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })} IST
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Auto-refresh toggle */}
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-medium transition-all border ${
                  autoRefresh
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : 'bg-slate-800 text-slate-500 border-slate-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                <span className="hidden sm:inline">Auto</span>
              </button>

              {/* Manual refresh */}
              <button
                onClick={loadData}
                disabled={loading}
                className="p-2 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : 'text-slate-500'}`} />
              </button>
            </div>
          </div>

          {/* Summary Stats */}
          {data && <SummaryStats active={activePositions} exits={todayExits} />}

          {/* Tab bar */}
          <div className="flex mt-3 sm:mt-4 bg-slate-800/50 rounded-xl p-1 border border-slate-700/40">
            {([
              { id: 'active' as LiveTab, label: 'Live Positions', count: activePositions.length, icon: Radio },
              { id: 'exits' as LiveTab, label: "Today's Trades", count: todayExits.length, icon: Clock },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                  activeTab === tab.id
                    ? 'bg-slate-700/80 text-white shadow-lg shadow-black/20'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <tab.icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                  activeTab === tab.id
                    ? tab.id === 'active' ? 'text-emerald-400' : 'text-amber-400'
                    : ''
                }`} />
                <span className="sm:hidden">{tab.id === 'active' ? 'Live' : 'Trades'}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === tab.id
                      ? tab.id === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                      : 'bg-slate-700 text-slate-500'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 max-w-[1400px] mx-auto">

        {/* Sort & Filter bar */}
        {data && (
          <div className="mb-3 sm:mb-4">
            {/* Toggle row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                {/* Sort button */}
                <button
                  onClick={() => {
                    const keys: SortKey[] = ['time', 'pnl', 'pnlPct', 'name']
                    const idx = keys.indexOf(sortKey)
                    const nextKey = keys[(idx + 1) % keys.length]
                    if (nextKey === sortKey) { setSortAsc(!sortAsc) } else { setSortKey(nextKey); setSortAsc(false) }
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-medium bg-slate-800/60 text-slate-400 border border-slate-700/50 hover:border-slate-600 transition-all"
                >
                  <ArrowUpDown className="w-3 h-3" />
                  <span>{sortKey === 'time' ? 'Latest' : sortKey === 'pnl' ? 'P&L' : sortKey === 'pnlPct' ? 'P&L %' : 'Name'}</span>
                  <span className="text-slate-600">{sortAsc ? '↑' : '↓'}</span>
                </button>

                {/* Filter toggle */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-medium border transition-all ${
                    showFilters || filterDir !== 'all' || filterResult !== 'all' || filterExchange !== 'all'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                      : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:border-slate-600'
                  }`}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>Filter</span>
                  {(filterDir !== 'all' || filterResult !== 'all' || filterExchange !== 'all') && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  )}
                </button>
              </div>

              {/* Active filter count + clear */}
              {(filterDir !== 'all' || filterResult !== 'all' || filterExchange !== 'all') && (
                <button
                  onClick={() => { setFilterDir('all'); setFilterResult('all'); setFilterExchange('all') }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {/* Filter chips (expandable) */}
            {showFilters && (
              <div className="rounded-xl bg-slate-800/40 border border-slate-700/40 p-3 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* Direction */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider w-16 shrink-0">Direction</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {([['all', 'All'], ['bullish', 'Bullish'], ['bearish', 'Bearish']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setFilterDir(val)}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all border ${
                          filterDir === val
                            ? val === 'bullish' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : val === 'bearish' ? 'bg-red-500/15 text-red-400 border-red-500/30'
                              : 'bg-slate-700/60 text-slate-300 border-slate-600/50'
                            : 'bg-slate-800/40 text-slate-500 border-slate-700/30 hover:text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Result (only for exits tab) */}
                {activeTab === 'exits' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider w-16 shrink-0">Result</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {([['all', 'All'], ['win', 'Winners'], ['loss', 'Losers']] as const).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setFilterResult(val)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all border ${
                            filterResult === val
                              ? val === 'win' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : val === 'loss' ? 'bg-red-500/15 text-red-400 border-red-500/30'
                                : 'bg-slate-700/60 text-slate-300 border-slate-600/50'
                              : 'bg-slate-800/40 text-slate-500 border-slate-700/30 hover:text-slate-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Exchange */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider w-16 shrink-0">Exchange</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {([['all', 'All'], ['N', 'NSE'], ['M', 'MCX'], ['C', 'CDS']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setFilterExchange(val)}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all border ${
                          filterExchange === val
                            ? val === 'N' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                              : val === 'M' ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                              : val === 'C' ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                              : 'bg-slate-700/60 text-slate-300 border-slate-600/50'
                            : 'bg-slate-800/40 text-slate-500 border-slate-700/30 hover:text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 mb-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">Failed to load live data</p>
              <p className="text-[11px] text-red-400/60 mt-0.5">{error}</p>
            </div>
            <button
              onClick={loadData}
              className="ml-auto px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && !data && <LoadingSkeleton />}

        {/* Active positions tab */}
        {activeTab === 'active' && data && (
          activePositions.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {activePositions.map((p) => (
                <ActivePositionCard key={p.positionId} position={p} />
              ))}
            </div>
          ) : (
            <EmptyState tab="active" />
          )
        )}

        {/* Today's exits tab */}
        {activeTab === 'exits' && data && (
          todayExits.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {todayExits.map((p, idx) => (
                <ExitedTradeCard key={`${p.positionId}-${idx}`} position={p} />
              ))}
            </div>
          ) : (
            <EmptyState tab="exits" />
          )
        )}
      </div>
    </div>
  )
}
