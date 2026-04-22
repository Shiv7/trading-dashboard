import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { RefreshCw, Filter, ArrowUpDown, Check, TrendingUp, TrendingDown, Target, Briefcase, Plus, X, ChevronDown } from 'lucide-react'
import { strategyWalletsApi, liveTradesApi } from '../services/api'
import { isAnyMarketOpen } from '../utils/tradingUtils'
import type { StrategyWalletSummary, StrategyWalletTrade } from '../services/api'
import type { Position } from '../types'
import PositionCard from '../components/Wallet/PositionCard'
import FundTopUpModal from '../components/Wallet/FundTopUpModal'
import { STRATEGY_COLORS } from '../utils/strategyColors'
import { estimateSlippage, estimateSlippagePct, formatSlippage } from '../utils/slippageUtils'
// ─── Types ───────────────────────────────────────────────
type SortField = 'exitTime' | 'pnl' | 'pnlPercent' | 'companyName' | 'strategy'

// ─── Section Filter Types ────────────────────────────────
type SectionFilterTag =
  | 'NSE' | 'MCX' | 'CURRENCY'
  | 'OPTIONS' | 'FUT' | 'EQUITY'
  | 'PROFIT' | 'LOSS'
  | 'FUDKII' | 'FUKAA' | 'FUDKOI' | 'RETEST' | 'MICROALPHA' | 'MERE' | 'QUANT' | 'HOTSTOCKS'
  | 'MCX_BB_15' | 'MCX_BB_30' | 'NSE_BB_30'
  | 'MOST_RECENT'

const SECTION_FILTER_GROUPS: { label: string; tags: { key: SectionFilterTag; label: string; color: string }[] }[] = [
  {
    label: 'Exchange',
    tags: [
      { key: 'NSE', label: 'NSE', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
      { key: 'MCX', label: 'MCX', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
      { key: 'CURRENCY', label: 'CDS', color: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
    ],
  },
  {
    label: 'Instrument',
    tags: [
      { key: 'OPTIONS', label: 'Options', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
      { key: 'FUT', label: 'Futures', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
      { key: 'EQUITY', label: 'Equity', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
    ],
  },
  {
    label: 'P&L',
    tags: [
      { key: 'PROFIT', label: 'Profit', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
      { key: 'LOSS', label: 'Loss', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
    ],
  },
  {
    label: 'Strategy',
    tags: [
      { key: 'FUDKII', label: 'FUDKII', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
      { key: 'FUKAA', label: 'FUKAA', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
      { key: 'FUDKOI', label: 'FUDKOI', color: 'bg-pink-500/15 text-pink-400 border-pink-500/30' },
      { key: 'MICROALPHA', label: 'MICRO', color: 'bg-lime-500/15 text-lime-400 border-lime-500/30' },
      { key: 'RETEST', label: 'RETEST', color: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
      { key: 'MERE', label: 'MERE', color: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' },
      { key: 'QUANT', label: 'QUANT', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
      { key: 'HOTSTOCKS', label: 'HOTSTOCKS', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
      { key: 'MCX_BB_15', label: 'MCX-BB-15', color: 'bg-lime-500/15 text-lime-400 border-lime-500/30' },
      { key: 'MCX_BB_30', label: 'MCX-BB-30', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
      { key: 'NSE_BB_30', label: 'NSE-BB-30', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
    ],
  },
  {
    label: 'Sort',
    tags: [
      { key: 'MOST_RECENT', label: 'Most Recent', color: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
    ],
  },
]

function useSectionFilter() {
  const [active, setActive] = useState<Set<SectionFilterTag>>(new Set())
  const toggle = useCallback((tag: SectionFilterTag) => {
    setActive(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }, [])
  const clear = useCallback(() => setActive(new Set()), [])
  return { active, toggle, clear }
}

function getExchangeTag(exchange?: string): SectionFilterTag | null {
  if (!exchange) return null
  const e = exchange.toUpperCase()
  if (e === 'N' || e === 'NSE' || e === 'B' || e === 'BSE') return 'NSE'
  if (e === 'M' || e === 'MCX') return 'MCX'
  if (e === 'C' || e === 'CDS' || e === 'CURRENCY') return 'CURRENCY'
  return null
}

function getInstrumentTag(instrumentType?: string): SectionFilterTag | null {
  if (!instrumentType) return 'EQUITY'
  const t = instrumentType.toUpperCase()
  if (t === 'OPTION') return 'OPTIONS'
  if (t === 'FUTURES' || t === 'FUT') return 'FUT'
  return 'EQUITY'
}

function getStrategyTag(strategy?: string): SectionFilterTag | null {
  if (!strategy) return null
  const s = strategy.toUpperCase()
  if (s.includes('FUDKOI')) return 'FUDKOI'
  if (s.includes('FUDKII')) return 'FUDKII'
  if (s.includes('FUKAA')) return 'FUKAA'
  if (s.includes('RETEST')) return 'RETEST'
  // PIVOT suspended 2026-04-02 — historical PIVOT trades will show without strategy filter
  if (s.includes('MICRO')) return 'MICROALPHA'
  if (s.includes('MERE')) return 'MERE'
  if (s.includes('QUANT')) return 'QUANT'
  if (s.includes('HOTSTOCKS') || s.includes('HOTSTOCK')) return 'HOTSTOCKS'
  if (s.includes('MCX_BB_15') || s.includes('MCX-BB-15')) return 'MCX_BB_15'
  if (s.includes('MCX_BB_30') || s.includes('MCX-BB-30')) return 'MCX_BB_30'
  if (s.includes('NSE_BB_30') || s.includes('NSE-BB-30')) return 'NSE_BB_30'
  return null
}

function matchesSectionFilters(
  active: Set<SectionFilterTag>,
  exchange?: string,
  instrumentType?: string,
  strategy?: string,
  pnl?: number,
): boolean {
  if (active.size === 0) return true

  const exchangeTags: SectionFilterTag[] = ['NSE', 'MCX', 'CURRENCY']
  const instrumentTags: SectionFilterTag[] = ['OPTIONS', 'FUT', 'EQUITY']
  const pnlTags: SectionFilterTag[] = ['PROFIT', 'LOSS']
  const strategyTags: SectionFilterTag[] = ['FUKAA', 'FUDKOI', 'FUDKII', 'RETEST', 'MICROALPHA', 'MERE', 'QUANT', 'HOTSTOCKS', 'MCX_BB_15', 'MCX_BB_30', 'NSE_BB_30']

  const activeExchange = exchangeTags.filter(t => active.has(t))
  const activeInstrument = instrumentTags.filter(t => active.has(t))
  const activePnl = pnlTags.filter(t => active.has(t))
  const activeStrategy = strategyTags.filter(t => active.has(t))

  // Within each group: OR logic. Between groups: AND logic.
  if (activeExchange.length > 0) {
    const tag = getExchangeTag(exchange)
    if (!tag || !activeExchange.includes(tag)) return false
  }
  if (activeInstrument.length > 0) {
    const tag = getInstrumentTag(instrumentType)
    if (!tag || !activeInstrument.includes(tag)) return false
  }
  if (activePnl.length > 0) {
    const isProfit = (pnl ?? 0) >= 0
    if (activePnl.includes('PROFIT') && !activePnl.includes('LOSS') && !isProfit) return false
    if (activePnl.includes('LOSS') && !activePnl.includes('PROFIT') && isProfit) return false
  }
  if (activeStrategy.length > 0) {
    const tag = getStrategyTag(strategy)
    if (!tag || !activeStrategy.includes(tag)) return false
  }
  return true
}

// ─── Section Filter Bar ──────────────────────────────────
const SectionFilterBar: React.FC<{
  active: Set<SectionFilterTag>
  onToggle: (tag: SectionFilterTag) => void
  onClear: () => void
}> = ({ active, onToggle, onClear }) => {
  const [expanded, setExpanded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
          active.size > 0
            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
            : 'bg-slate-700/50 text-slate-400 border border-transparent hover:text-white hover:bg-slate-700'
        }`}
      >
        <Filter className="w-3 h-3" />
        <span>Filter</span>
        {active.size > 0 && (
          <span className="ml-0.5 px-1.5 py-0 rounded-full bg-orange-500/30 text-orange-300 text-[9px] font-bold">{active.size}</span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 p-3 min-w-[260px] sm:min-w-[320px] animate-slideDown">
          {SECTION_FILTER_GROUPS.map(group => (
            <div key={group.label} className="mb-3 last:mb-0">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 font-medium">{group.label}</div>
              <div className="flex gap-1.5 flex-wrap">
                {group.tags.map(({ key, label, color }) => (
                  <button
                    key={key}
                    onClick={() => onToggle(key)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-all border ${
                      active.has(key)
                        ? `${color} ring-1 ring-offset-0 ring-current`
                        : 'bg-slate-700/40 text-slate-500 border-transparent hover:bg-slate-700 hover:text-slate-300'
                    }`}
                  >
                    {active.has(key) && <Check className="w-2.5 h-2.5 inline mr-0.5" />}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {active.size > 0 && (
            <button
              onClick={() => { onClear(); setExpanded(false) }}
              className="mt-2 w-full text-center text-[10px] text-slate-500 hover:text-red-400 transition-colors py-1"
            >
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const SORT_OPTIONS: { key: SortField; label: string }[] = [
  { key: 'exitTime', label: 'Exit Time' },
  { key: 'pnl', label: 'P&L' },
  { key: 'pnlPercent', label: 'P&L %' },
  { key: 'companyName', label: 'Security' },
  { key: 'strategy', label: 'Strategy' },
]

// ─── Helpers ─────────────────────────────────────────────
function formatINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatNum(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) + ' ' +
           d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
  } catch { return '-' }
}

// ─── Sort Dropdown ───────────────────────────────────────
const SortDropdown: React.FC<{
  current: SortField
  onSelect: (f: SortField) => void
  onClose: () => void
}> = ({ current, onSelect, onClose }) => (
  <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 py-1 min-w-[180px] animate-slideDown">
    {SORT_OPTIONS.map(({ key, label }) => (
      <button
        key={key}
        onClick={() => { onSelect(key); onClose() }}
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
)

// ─── Target Status Badge ─────────────────────────────────
function TargetBadge({ trade }: { trade: StrategyWalletTrade }) {
  if (trade.exitReason === 'ACTIVE') {
    return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 animate-pulse">LIVE</span>
  }
  if (trade.stopHit) {
    return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">SL</span>
  }
  // Find highest target hit
  const level = trade.target4Hit ? 'T4' : trade.target3Hit ? 'T3' : trade.target2Hit ? 'T2' : trade.target1Hit ? 'T1' : null
  if (level) {
    return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">{level}</span>
  }
  // Show exit reason badge for non-target/non-SL exits
  const reason = trade.exitReason
  if (reason) {
    if (reason.includes('SWITCH')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">SWITCH</span>
    if (reason.includes('EOD')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-600/40 text-slate-400 border border-slate-500/30">EOD</span>
  }
  return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-500">-</span>
}

// ─── Drawer Helpers ──────────────────────────────────────
function DM() {
  return <span className="text-slate-500 italic text-[10px]">DM</span>
}

function valOrDM(val: number | null | undefined, formatter: (n: number) => string = formatNum): ReactNode {
  return val != null ? <span className="font-mono">{formatter(val)}</span> : <DM />
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function DrawerRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-xs text-white">{value}</span>
    </div>
  )
}

function getTradeDisplayName(t: StrategyWalletTrade): string {
  return t.instrumentSymbol || t.companyName || t.scripCode
}

function getInstrumentTypeLabel(t: StrategyWalletTrade): string | null {
  if (t.instrumentType === 'OPTION') return 'OPT'
  if (t.instrumentType === 'FUTURES') return 'FUT'
  if (t.instrumentType) return t.instrumentType
  return null
}

// ─── Trade Detail Drawer ─────────────────────────────────
function TradeDetailDrawer({ trade, onClose }: { trade: StrategyWalletTrade; onClose: () => void }) {
  const positive = trade.pnl >= 0
  const sc = STRATEGY_COLORS[trade.strategy] || STRATEGY_COLORS['FUDKII']
  const displayName = getTradeDisplayName(trade)

  const exchCode = (trade.exchange || 'N').charAt(0).toUpperCase()
  // Prefer backend orderbook-aware slippage; fall back to static tick model
  const tradeSlippage = (trade.estimatedEntrySlippageTotal != null && trade.estimatedEntrySlippageTotal > 0)
    ? trade.estimatedEntrySlippageTotal
    : estimateSlippage(trade.entryPrice, trade.quantity, exchCode)
  const tradeSlipPct = (trade.estimatedSlippagePct != null && trade.estimatedSlippagePct > 0)
    ? trade.estimatedSlippagePct
    : estimateSlippagePct(trade.entryPrice, trade.quantity, exchCode)

  const hasDualLegs = trade.equitySl != null || trade.optionSl != null
    || trade.equityT1 != null || trade.optionT1 != null

  const exitLevel = trade.stopHit ? 'SL'
    : trade.target4Hit ? 'T4'
    : trade.target3Hit ? 'T3'
    : trade.target2Hit ? 'T2'
    : trade.target1Hit ? 'T1'
    : trade.exitReason === 'ACTIVE' ? 'Active'
    : trade.exitReason || 'Unknown'

  const exitLevelColor = trade.stopHit ? 'text-red-400'
    : (trade.target1Hit || trade.target2Hit || trade.target3Hit || trade.target4Hit) ? 'text-emerald-400'
    : trade.exitReason === 'ACTIVE' ? 'text-cyan-400'
    : 'text-slate-400'

  // Duration formatting
  const durationStr = trade.durationMinutes != null
    ? `${Math.floor(trade.durationMinutes / 60)}h ${trade.durationMinutes % 60}m`
    : trade.exitReason === 'ACTIVE' ? null : null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn" />
      {/* Drawer panel */}
      <div
        className="relative w-full max-w-md bg-slate-900 border-l border-slate-700 overflow-y-auto animate-slideRight"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur border-b border-slate-700 px-4 py-3 flex items-center justify-between z-10">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-white truncate">{displayName}</div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sc.bg} ${sc.text} border ${sc.border}`}>
                {trade.strategy}
              </span>
              {trade.variant && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/15 text-violet-400 border border-violet-500/30">
                  {trade.variant.replace('MERE_', '').replace('_', ' ')}
                </span>
              )}
              {trade.executionMode === 'MANUAL' && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-500/15 text-slate-400 border border-slate-500/30">
                  MANUAL
                </span>
              )}
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                trade.direction === 'BULLISH'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                {trade.direction}
              </span>
              {(() => {
                const itype = getInstrumentTypeLabel(trade)
                return itype ? (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">{itype}</span>
                ) : null
              })()}
              <span className="text-[9px] text-slate-500 font-mono">{trade.scripCode}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors ml-2 shrink-0">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* P&L Card */}
          <div className={`rounded-xl p-4 border ${positive ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Profit & Loss</div>
            <div className={`text-2xl font-bold font-mono tabular-nums ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {positive ? '+' : ''}{formatINR(trade.pnl)}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className={`text-sm font-mono ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                {positive ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
              </span>
              {trade.rMultiple != null && (
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                  trade.rMultiple >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  {trade.rMultiple >= 0 ? '+' : ''}{trade.rMultiple.toFixed(2)}R
                </span>
              )}
            </div>
            {(trade.totalCharges ?? 0) > 0 && (
              <div className="mt-3 pt-2 border-t border-slate-700/50 space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Gross P&L</span>
                  <span className={(trade.pnl + (trade.totalCharges ?? 0)) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {(trade.pnl + (trade.totalCharges ?? 0)) >= 0 ? '+' : ''}{formatINR(trade.pnl + (trade.totalCharges ?? 0))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Charges</span>
                  <span className="text-red-400">-{formatINR(trade.totalCharges ?? 0)}</span>
                </div>
                {tradeSlippage > 0 && (
                  <div className="flex justify-between">
                    <span className="text-amber-500/80">Est. Slippage</span>
                    <span className="text-amber-500/80">~{formatSlippage(tradeSlippage)} <span className="text-[10px]">({tradeSlipPct.toFixed(1)}%)</span></span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-slate-700/40">
                  <span className="text-slate-300 font-medium">Net P&L</span>
                  <span className={`font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                    {positive ? '+' : ''}{formatINR(trade.pnl)}
                  </span>
                </div>
              </div>
            )}
            {(trade.totalCharges ?? 0) === 0 && tradeSlippage > 0 && (
              <div className="mt-3 pt-2 border-t border-slate-700/50 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-amber-500/80">Est. Slippage</span>
                  <span className="text-amber-500/80">~{formatSlippage(tradeSlippage)} <span className="text-[10px]">({tradeSlipPct.toFixed(1)}%)</span></span>
                </div>
              </div>
            )}
          </div>

          {/* Entry / Exit */}
          <DrawerSection title="Entry / Exit">
            <DrawerRow label="Entry Price" value={<span className="font-mono">{formatNum(trade.entryPrice)}</span>} />
            <DrawerRow label="Exit Price" value={
              trade.exitReason === 'ACTIVE'
                ? <span className="text-cyan-400 font-mono">{formatNum(trade.exitPrice)} (Live)</span>
                : <span className="font-mono">{formatNum(trade.exitPrice)}</span>
            } />
            <DrawerRow label="Entry Time" value={formatTime(trade.entryTime)} />
            <DrawerRow label="Exit Time" value={
              trade.exitTime
                ? formatTime(trade.exitTime)
                : trade.exitReason === 'ACTIVE'
                  ? <span className="text-cyan-400 text-[10px] font-bold animate-pulse">Active</span>
                  : <DM />
            } />
            <DrawerRow label="Exited At" value={<span className={`font-bold ${exitLevelColor}`}>{exitLevel}</span>} />
            <DrawerRow label="Exit Reason" value={trade.exitReason || <DM />} />
          </DrawerSection>

          {/* Levels */}
          {hasDualLegs ? (
            <>
              <DrawerSection title="Equity / FUT Leg">
                <DrawerRow label="SL" value={valOrDM(trade.equitySl)} />
                <DrawerRow label="T1" value={valOrDM(trade.equityT1)} />
                <DrawerRow label="T2" value={valOrDM(trade.equityT2)} />
                <DrawerRow label="T3" value={valOrDM(trade.equityT3)} />
                <DrawerRow label="T4" value={valOrDM(trade.equityT4)} />
              </DrawerSection>
              <DrawerSection title="Option Leg">
                <DrawerRow label="SL" value={valOrDM(trade.optionSl)} />
                <DrawerRow label="T1" value={valOrDM(trade.optionT1)} />
                <DrawerRow label="T2" value={valOrDM(trade.optionT2)} />
                <DrawerRow label="T3" value={valOrDM(trade.optionT3)} />
                <DrawerRow label="T4" value={valOrDM(trade.optionT4)} />
              </DrawerSection>
            </>
          ) : (() => {
            // Only show levels that have data; hide section if all are missing
            const levels = [
              { label: 'Stop Loss', val: trade.stopLoss },
              { label: 'Target 1', val: trade.target1 },
              { label: 'Target 2', val: trade.target2 },
              { label: 'Target 3', val: trade.target3 },
              { label: 'Target 4', val: trade.target4 },
            ]
            const available = levels.filter(l => l.val != null)
            if (available.length === 0) return null
            return (
              <DrawerSection title="Levels">
                {available.map(l => (
                  <DrawerRow key={l.label} label={l.label} value={<span className="font-mono">{formatNum(l.val!)}</span>} />
                ))}
              </DrawerSection>
            )
          })()}

          {/* Trade Details */}
          <DrawerSection title="Details">
            <DrawerRow label="Direction" value={
              <span className={trade.direction === 'BULLISH' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                {trade.direction}
              </span>
            } />
            <DrawerRow label="Side" value={trade.side} />
            <DrawerRow label="Quantity" value={<span className="font-mono">{trade.quantity}</span>} />
            <DrawerRow label="Capital Used" value={<span className="font-mono">{formatINR(trade.capitalEmployed)}</span>} />
            <DrawerRow label="Strategy" value={
              <span className="flex items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sc.bg} ${sc.text} border ${sc.border}`}>{trade.strategy}</span>
                {trade.variant && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/15 text-violet-400 border border-violet-500/30">
                    {trade.variant.replace('MERE_', '').replace('_', ' ')}
                  </span>
                )}
                {trade.executionMode === 'MANUAL' && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-500/15 text-slate-400 border border-slate-500/30">MANUAL</span>
                )}
              </span>
            } />
            {trade.rMultiple != null && (
              <DrawerRow label="R-Multiple" value={
                <span className={`font-mono ${trade.rMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {trade.rMultiple >= 0 ? '+' : ''}{trade.rMultiple.toFixed(2)}R
                </span>
              } />
            )}
            <DrawerRow label="Duration" value={
              durationStr
                ? durationStr
                : trade.exitReason === 'ACTIVE'
                  ? <span className="text-cyan-400">Running</span>
                  : <DM />
            } />
            {trade.confidence != null && (
              <DrawerRow label="Confidence" value={`${trade.confidence.toFixed(0)}%`} />
            )}
          </DrawerSection>

          {/* Target Hit Status */}
          <DrawerSection title="Target Status">
            <div className="grid grid-cols-5 gap-2 mt-1">
              {([
                { label: 'SL', hit: trade.stopHit, isStop: true },
                { label: 'T1', hit: trade.target1Hit, isStop: false },
                { label: 'T2', hit: trade.target2Hit, isStop: false },
                { label: 'T3', hit: trade.target3Hit, isStop: false },
                { label: 'T4', hit: trade.target4Hit, isStop: false },
              ] as const).map(({ label, hit, isStop }) => (
                <div key={label} className={`text-center py-2 rounded-lg text-[10px] font-bold border ${
                  hit
                    ? isStop
                      ? 'bg-red-500/20 text-red-400 border-red-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-600 border-slate-700'
                }`}>
                  {label}
                </div>
              ))}
            </div>
          </DrawerSection>
        </div>

        {/* Close button footer */}
        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur border-t border-slate-700 p-3">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium text-slate-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════
//  MAIN PAGE COMPONENT
// ═════════════════════════════════════════════════════════
export default function StrategyWalletsPage() {
  const [summaries, setSummaries] = useState<StrategyWalletSummary[]>([])
  const [trades, setTrades] = useState<StrategyWalletTrade[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedTrade, setSelectedTrade] = useState<StrategyWalletTrade | null>(null)

  // Sort
  const [sortField, setSortField] = useState<SortField>('exitTime')

  // Section-level filters (independent per section)
  const activeFilter = useSectionFilter()
  // Exited section shares the active filter so toggling strategy/exchange/PnL
  // on either bar filters both views — fixes the bug where filtering
  // {FUDKII,FUKAA,FUDKOI} on Active still showed MICROALPHA in Exited.
  const exitedFilter = activeFilter
  const weeklyFilter = useSectionFilter()

  // Fund top-up modal
  const [fundModalStrategy, setFundModalStrategy] = useState<string | null>(null)
  const [cbResetLoading, setCbResetLoading] = useState<string | null>(null)
  const [unlockConfirmStrategy, setUnlockConfirmStrategy] = useState<string | null>(null)
  const [unlockInput, setUnlockInput] = useState('')

  // Dropdown toggles
  const [showSort, setShowSort] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(async () => {
    try {
      const [s, t, live] = await Promise.all([
        strategyWalletsApi.getSummaries(),
        strategyWalletsApi.getWeeklyTrades({
          sortBy: sortField,
        }),
        liveTradesApi.getLiveData(),
      ])
      if (s) setSummaries(s)
      if (t) setTrades(t)
      if (live) {
        // Normalize API fields (entryPrice→avgEntryPrice, pct names, null-safe numerics)
        const normalizePos = (p: any): Position => ({
          ...p,
          avgEntryPrice: p.avgEntryPrice ?? p.entryPrice ?? 0,
          currentPrice: p.currentPrice ?? p.exitPrice ?? p.avgEntryPrice ?? p.entryPrice ?? 0,
          quantity: p.quantity ?? p.remainingQuantity ?? p.totalQuantity ?? 0,
          unrealizedPnl: p.unrealizedPnl ?? 0,
          unrealizedPnlPercent: p.unrealizedPnlPercent ?? p.unrealizedPnlPct ?? 0,
          realizedPnl: p.realizedPnl ?? p.pnl ?? 0,
          stopLoss: p.stopLoss ?? 0,
          target1: p.target1 ?? 0,
          target2: p.target2 ?? 0,
          openedAt: p.openedAt ?? '',
          lastUpdated: p.lastUpdated ?? p.closedAt ?? p.openedAt ?? '',
          status: p.status ?? 'UNKNOWN',
          companyName: p.companyName ?? p.symbol ?? p.scripCode ?? '',
          side: p.side ?? 'LONG',
          positionId: p.positionId ?? p.tradeId ?? p.scripCode ?? '',
        })
        const allPositions = [
          ...(live.activePositions || []).map((p: any) => ({ ...normalizePos(p), __exited: false })),
          ...(live.todayExits || []).map((p: any) => ({ ...normalizePos(p), __exited: true })),
        ]
        allPositions.sort((a, b) => {
          if (a.quantity > 0 && b.quantity <= 0) return -1
          if (a.quantity <= 0 && b.quantity > 0) return 1
          return 0
        })
        setPositions(allPositions)
      }
    } catch (err) {
      console.error('Error loading strategy wallets:', err)
    } finally {
      setLoading(false)
    }
  }, [sortField])

  useEffect(() => {
    setLoading(true)
    loadData()
    let interval: ReturnType<typeof setInterval> | null = null
    if (autoRefresh) {
      interval = setInterval(() => { if (isAnyMarketOpen()) loadData() }, 5000)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [loadData, autoRefresh])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSort(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Compute filtered weekly trades ──
  const filteredWeekly = useMemo(() => {
    const activeSet = weeklyFilter.active
    if (activeSet.size === 0) return trades

    const filtered = trades.filter(t => {
      // Strategy filter — direct, no abstraction
      // Strategy filter: match against active tags using normalized strategy name
      const knownStrategyTags: SectionFilterTag[] = summaries.map(s => getStrategyTag(s.strategy)).filter(Boolean) as SectionFilterTag[]
      const activeStrategies = knownStrategyTags.filter(tag => activeSet.has(tag))
      if (activeStrategies.length > 0) {
        const tag = getStrategyTag(t.strategy)
        if (!tag || !activeStrategies.includes(tag)) return false
      }
      // Exchange filter
      const exchangeTags: SectionFilterTag[] = ['NSE', 'MCX', 'CURRENCY']
      const activeExchange = exchangeTags.filter(tag => activeSet.has(tag))
      if (activeExchange.length > 0) {
        const tag = getExchangeTag(t.exchange)
        if (!tag || !activeExchange.includes(tag)) return false
      }
      // Instrument filter
      const instrumentTags: SectionFilterTag[] = ['OPTIONS', 'FUT', 'EQUITY']
      const activeInstrument = instrumentTags.filter(tag => activeSet.has(tag))
      if (activeInstrument.length > 0) {
        const tag = getInstrumentTag(t.instrumentType ?? undefined)
        if (!tag || !activeInstrument.includes(tag)) return false
      }
      // P&L filter
      const activePnl = (['PROFIT', 'LOSS'] as SectionFilterTag[]).filter(tag => activeSet.has(tag))
      if (activePnl.length > 0) {
        const isProfit = (t.pnl ?? 0) >= 0
        if (activePnl.includes('PROFIT') && !activePnl.includes('LOSS') && !isProfit) return false
        if (activePnl.includes('LOSS') && !activePnl.includes('PROFIT') && isProfit) return false
      }
      return true
    })

    // Sort by most recent if that tag is active
    if (activeSet.has('MOST_RECENT')) {
      filtered.sort((a, b) => {
        const ta = a.entryTime ? new Date(a.entryTime).getTime() : 0
        const tb = b.entryTime ? new Date(b.entryTime).getTime() : 0
        return tb - ta
      })
    }

    return filtered
  }, [trades, weeklyFilter.active])

  return (
    <div className="min-h-screen mobile-page-bottom">
      {/* ══ Sticky Header ══ */}
      <div className="bg-slate-800/95 backdrop-blur border-b border-slate-700 sticky top-0 z-10">
        <div className="px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            </div>
            <h1 className="text-base sm:text-xl font-bold text-white truncate">Strategy Wallets</h1>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Sort */}
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setShowSort(!showSort)}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-medium transition-colors ${showSort ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-700/50 text-slate-400 hover:text-white'}`}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{SORT_OPTIONS.find(o => o.key === sortField)?.label || 'Sort'}</span>
                <span className="sm:hidden">Sort</span>
              </button>
              {showSort && (
                <SortDropdown
                  current={sortField}
                  onSelect={setSortField}
                  onClose={() => setShowSort(false)}
                />
              )}
            </div>

            {/* Auto-refresh */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs font-medium ${
                autoRefresh ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
              }`}
            >
              <div className={`w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
              <span className="hidden sm:inline">Live</span>
            </button>

            {/* Refresh */}
            <button onClick={loadData} className="p-1.5 sm:p-2 hover:bg-slate-700 rounded transition-colors" disabled={loading}>
              <RefreshCw className={`w-3.5 sm:w-4 h-3.5 sm:h-4 ${loading ? 'animate-spin text-blue-400' : 'text-slate-400'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ══ Content ══ */}
      <div className="px-1.5 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* ── Wallet Cards (horizontal scroll) ── */}
        <div className="overflow-x-auto pb-2 -mx-1.5 sm:-mx-4 px-1.5 sm:px-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          <div className="flex gap-2 sm:gap-4" style={{ minWidth: 'max-content' }}>
          {(summaries.length > 0 ? summaries : Array.from({ length: 11 }, (_, i) => ({
            strategy: ['FUDKII', 'FUKAA', 'FUDKOI', 'RETEST', 'MICROALPHA', 'MERE', 'QUANT', 'HOTSTOCKS', 'MCX_BB_15', 'MCX_BB_30', 'NSE_BB_30'][i],
            displayName: ['FUDKII', 'FUKAA', 'FUDKOI', 'RETEST', 'MICROALPHA', 'MERE', 'QUANT', 'HOTSTOCKS', 'MCX-BB-15', 'MCX-BB-30', 'NSE-BB-30'][i],
            initialCapital: 1000000, currentCapital: 1000000, totalPnl: 0, totalPnlPercent: 0,
            totalTrades: 0, wins: 0, losses: 0, winRate: 0, mcxUsedMargin: 0,
          }))).map(s => {
            const colors = STRATEGY_COLORS[s.displayName] || STRATEGY_COLORS['FUDKII']
            const positive = s.totalPnl >= 0
            return (
              <div
                key={s.strategy}
                className={`bg-slate-800/60 backdrop-blur border ${colors.border} rounded-xl p-3 sm:p-6 hover:bg-slate-800/80 transition-all min-w-[150px] sm:min-w-[200px] flex-shrink-0`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2 sm:mb-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-gradient-to-br ${colors.accent} shrink-0`} />
                    <h3 className={`text-xs sm:text-base font-bold ${colors.text} truncate`}>{s.displayName}</h3>
                  </div>
                  <span className={`text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5 rounded shrink-0 ${positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {(s.winRate ?? 0).toFixed(0)}%
                  </span>
                </div>

                {/* Cumulative Lockdown Banner (RED — permanent) */}
                {s.cumulativeLockdown && (
                  <div className="mb-2 p-2 rounded-lg bg-red-900/40 border border-red-500/50 text-[10px] sm:text-xs">
                    <div className="font-bold text-red-400 mb-1">CUMULATIVE LOCKDOWN</div>
                    <div className="text-red-300/80 mb-1">Drawdown exceeded 30% of initial capital</div>
                    {s.cumulativeLockdownAt && <div className="text-red-300/60 mb-1.5">Since: {s.cumulativeLockdownAt}</div>}
                    <button
                      onClick={(e) => { e.stopPropagation(); setUnlockConfirmStrategy(s.strategy); setUnlockInput('') }}
                      className="w-full text-center py-1 px-2 rounded bg-red-800/60 hover:bg-red-700/60 text-red-300 border border-red-600/40 transition-all"
                    >
                      Unlock & Resume
                    </button>
                  </div>
                )}

                {/* Daily Circuit Breaker Banner (AMBER — auto-resets) */}
                {s.circuitBreakerTripped && !s.cumulativeLockdown && (
                  <div className="mb-2 p-2 rounded-lg bg-amber-900/30 border border-amber-500/40 text-[10px] sm:text-xs">
                    <div className="font-bold text-amber-400 mb-1">DAILY LOSS LIMIT REACHED</div>
                    <div className="text-amber-300/70 mb-1.5">{s.circuitBreakerReason || 'Trading paused until reset'}</div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (!confirm('Daily loss limit was hit. Resuming allows new trades for the rest of today. Continue?')) return
                        setCbResetLoading(s.strategy)
                        try {
                          await strategyWalletsApi.resetCircuitBreaker(s.strategy)
                          loadData()
                        } catch (err) { console.error('CB reset failed', err) }
                        finally { setCbResetLoading(null) }
                      }}
                      disabled={cbResetLoading === s.strategy}
                      className="w-full text-center py-1 px-2 rounded bg-amber-800/50 hover:bg-amber-700/50 text-amber-300 border border-amber-600/30 transition-all disabled:opacity-50"
                    >
                      {cbResetLoading === s.strategy ? 'Resetting...' : 'Resume Trading'}
                    </button>
                  </div>
                )}

                {/* Capital */}
                <div className="text-base sm:text-2xl font-bold font-mono tabular-nums text-white mb-0.5 sm:mb-1 truncate">
                  {formatINR(s.currentCapital)}
                </div>

                {/* P&L */}
                <div className={`flex items-center gap-1 text-xs sm:text-sm font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {positive ? <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" /> : <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />}
                  <span className="truncate">{positive ? '+' : ''}{formatINR(s.totalPnl)}</span>
                  <span className="text-[10px] sm:text-xs opacity-75 shrink-0">({(s.totalPnlPercent ?? 0).toFixed(1)}%)</span>
                </div>

                {/* Stats */}
                <div className="mt-2 sm:mt-4 flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-slate-500">
                  <span>{s.totalTrades}t</span>
                  <span className="text-emerald-500">{s.wins}W</span>
                  <span className="text-red-500">{s.losses}L</span>
                </div>
                {/* Available Capital */}
                <div className="mt-1 text-[10px] sm:text-xs text-slate-500 font-mono tabular-nums">
                  Avail.cap <span className="text-slate-400">{formatINR(s.availableMargin ?? 0)}</span>
                </div>
                {/* Aggregate Est. Slippage for this strategy */}
                {(() => {
                  const stratTrades = trades.filter(t => t.strategy === s.strategy || t.strategy === s.displayName)
                  if (stratTrades.length === 0) return null
                  const totalSlip = stratTrades.reduce((sum, t) => {
                    const ex = (t.exchange || 'N').charAt(0).toUpperCase()
                    return sum + estimateSlippage(t.entryPrice, t.quantity, ex)
                  }, 0)
                  return totalSlip > 0 ? (
                    <div className="mt-0.5 text-[10px] text-amber-500/70 font-mono tabular-nums">
                      Est.slip <span className="text-amber-500/80">~{formatSlippage(totalSlip)}</span>
                    </div>
                  ) : null
                })()}

                {/* MCX Capital */}
                {(s.mcxUsedMargin ?? 0) > 0 && (
                  <div className="mt-1.5 sm:mt-2 flex items-center justify-between text-[10px] sm:text-xs">
                    <span className="text-slate-500">MCX</span>
                    <span className="text-yellow-400 font-mono tabular-nums">{formatINR(s.mcxUsedMargin ?? 0)}</span>
                  </div>
                )}

                {/* Win/Loss bar */}
                {s.totalTrades > 0 && (
                  <div className="mt-1.5 sm:mt-2 h-1 sm:h-1.5 rounded-full bg-slate-700 overflow-hidden flex">
                    <div className="bg-emerald-500 rounded-l-full" style={{ width: `${s.winRate}%` }} />
                    <div className="bg-red-500 rounded-r-full flex-1" />
                  </div>
                )}

                {/* Add Funds button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setFundModalStrategy(s.strategy) }}
                  className="mt-2 sm:mt-3 w-full flex items-center justify-center gap-1 text-[10px] sm:text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded px-2 py-1 transition-all"
                >
                  <Plus className="w-3 h-3" />
                  Add Funds
                </button>
              </div>
            )
          })}
          </div>
        </div>

        {/* Fund Top-Up Modal */}
        {fundModalStrategy && (
          <FundTopUpModal
            strategyKey={fundModalStrategy}
            walletEvent={null}
            onClose={() => setFundModalStrategy(null)}
            onFunded={() => { setFundModalStrategy(null); loadData() }}
          />
        )}

        {/* Cumulative Unlock Confirmation Modal */}
        {unlockConfirmStrategy && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setUnlockConfirmStrategy(null)}>
            <div className="bg-slate-800 border border-red-500/50 rounded-xl p-6 max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-red-400 font-bold text-lg mb-3">Unlock Cumulative Lockdown</h3>
              <p className="text-slate-300 text-sm mb-2">
                This wallet has lost more than 30% of its initial capital. Unlocking resumes all trading.
              </p>
              <p className="text-slate-400 text-xs mb-4">Type <span className="font-mono text-white">UNLOCK</span> to confirm:</p>
              <input
                type="text"
                value={unlockInput}
                onChange={e => setUnlockInput(e.target.value)}
                placeholder="Type UNLOCK"
                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white font-mono text-sm mb-4 focus:outline-none focus:border-red-500"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setUnlockConfirmStrategy(null)}
                  className="flex-1 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (unlockInput !== 'UNLOCK') return
                    try {
                      await strategyWalletsApi.unlockCumulativeLockdown(unlockConfirmStrategy)
                      setUnlockConfirmStrategy(null)
                      loadData()
                    } catch (err) { console.error('Unlock failed', err) }
                  }}
                  disabled={unlockInput !== 'UNLOCK'}
                  className="flex-1 py-2 rounded bg-red-700 hover:bg-red-600 text-white text-sm font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Unlock & Resume
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Active Trades ── */}
        {(() => {
          // positions already contains active + today's exits from /api/live
          const activePositions = positions.filter(p => !(p as any).__exited)
          const exitedPositions = positions.filter(p => (p as any).__exited)

          const filterPos = (list: Position[], filter: { active: Set<SectionFilterTag> }) => {
            let filtered = list.filter(p => matchesSectionFilters(
              filter.active,
              p.exchange,
              p.instrumentType,
              p.strategy,
              p.unrealizedPnl ?? p.realizedPnl ?? 0,
            ))
            if (filter.active.has('MOST_RECENT')) {
              filtered = [...filtered].sort((a, b) => {
                const ta = a.openedAt ? new Date(a.openedAt).getTime() : 0
                const tb = b.openedAt ? new Date(b.openedAt).getTime() : 0
                return tb - ta
              })
            }
            return filtered
          }

          const filteredActive = filterPos(activePositions, activeFilter)
          const filteredExited = filterPos(exitedPositions, exitedFilter)
          const hasAnyFilter = activeFilter.active.size > 0

          return (
            <>
              {/* Shared filter bar — one state drives both Active + Exited.
                  Always rendered so filters are usable even when Active is empty
                  (user can still filter Exited Today with no Active positions). */}
              <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                  Filter — Active & Exited
                </span>
                <SectionFilterBar active={activeFilter.active} onToggle={activeFilter.toggle} onClear={activeFilter.clear} />
              </div>

              {activePositions.length > 0 && (
                <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-cyan-400" />
                    <h2 className="text-sm font-bold text-white">Active Trades</h2>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/20 text-cyan-400">
                      {hasAnyFilter ? `${filteredActive.length}/${activePositions.length}` : activePositions.length}
                    </span>
                  </div>
                  <div className="p-2 sm:p-4">
                    {filteredActive.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                        {filteredActive.map(pos => (
                          <PositionCard key={pos.positionId} position={pos} onUpdate={loadData} />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-xs text-slate-500">
                        No trades match filters
                        <button onClick={activeFilter.clear} className="ml-2 text-blue-400 hover:text-blue-300">Clear</button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Exited Today ── */}
              {exitedPositions.length > 0 && (
                <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-slate-400" />
                    <h2 className="text-sm font-bold text-white">Exited Today</h2>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-600/40 text-slate-400">
                      {hasAnyFilter ? `${filteredExited.length}/${exitedPositions.length}` : exitedPositions.length}
                    </span>
                  </div>
                  <div className="p-2 sm:p-4">
                    {filteredExited.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                        {filteredExited.map(pos => (
                          <PositionCard key={pos.positionId} position={pos} onUpdate={loadData} exited />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-xs text-slate-500">
                        No trades match filters
                        <button onClick={exitedFilter.clear} className="ml-2 text-blue-400 hover:text-blue-300">Clear</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {/* ── Weekly Trades Table ── */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">Trades This Week</h2>
              <span className="text-xs text-slate-500">
                {weeklyFilter.active.size > 0 ? `${filteredWeekly.length}/${trades.length}` : trades.length} trade{trades.length !== 1 ? 's' : ''}
              </span>
            </div>
            <SectionFilterBar active={weeklyFilter.active} onToggle={weeklyFilter.toggle} onClear={weeklyFilter.clear} />
          </div>

          {loading && trades.length === 0 ? (
            <div className="p-8 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Loading trades...</p>
            </div>
          ) : filteredWeekly.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-14 h-14 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
                <Target className="w-6 h-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-400 mb-1">{trades.length === 0 ? 'No trades this week' : 'No trades match filters'}</p>
              {weeklyFilter.active.size > 0 && (
                <button onClick={() => weeklyFilter.clear()} className="text-xs text-blue-400 hover:text-blue-300 mt-2">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile Card Layout */}
              <div className="md:hidden divide-y divide-slate-700/30">
                {filteredWeekly.map((t, i) => {
                  const positive = t.pnl >= 0
                  const sc = STRATEGY_COLORS[t.strategy] || STRATEGY_COLORS['FUDKII']
                  return (
                    <div key={`${t.tradeId || 'trade'}-${i}`} className="px-3 py-3 space-y-2 cursor-pointer hover:bg-slate-700/20 transition-colors" onClick={() => setSelectedTrade(t)}>
                      {/* Row 1: Security name + P&L */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm text-white truncate">{getTradeDisplayName(t)}</div>
                          {/* Row 2: All badges */}
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              t.direction === 'BULLISH'
                                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                : 'bg-red-500/15 text-red-400 border border-red-500/30'
                            }`}>
                              {t.side === 'BUY' ? 'LONG' : t.side === 'SELL' ? 'SHORT' : (t.direction === 'BULLISH' ? 'LONG' : 'SHORT')}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sc.bg} ${sc.text} border ${sc.border}`}>
                              {t.strategy}
                            </span>
                            {t.variant && t.variant !== t.strategy && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/15 text-violet-400 border border-violet-500/30">
                                {t.variant.replace('MERE_', '').replace('_', ' ')}
                              </span>
                            )}
                            {(() => {
                              const itype = getInstrumentTypeLabel(t)
                              return itype ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                                  {itype}
                                </span>
                              ) : null
                            })()}
                            {t.executionMode === 'MANUAL' && (
                              <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-slate-500/15 text-slate-400 border border-slate-500/30">MANUAL</span>
                            )}
                            <TargetBadge trade={t} />
                            <span className="text-[10px] text-slate-500">{t.quantity} qty</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-bold font-mono tabular-nums ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {positive ? '+' : ''}{formatNum(t.pnl)}
                          </div>
                          <div className={`text-[10px] font-mono ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {positive ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                          </div>
                          {(() => {
                            const ex = (t.exchange || 'N').charAt(0).toUpperCase()
                            const sp = estimateSlippagePct(t.entryPrice, t.quantity, ex)
                            const slipAmt = estimateSlippage(t.entryPrice, t.quantity, ex)
                            return slipAmt > 0 ? (
                              <div className={`text-[9px] font-mono ${sp > 1 ? 'text-amber-500/70' : 'text-slate-600'}`}>~slip ₹{slipAmt < 1000 ? Math.round(slipAmt) : (slipAmt/1000).toFixed(1) + 'K'}</div>
                            ) : null
                          })()}
                        </div>
                      </div>
                      {/* Row 2: Entry/Exit prices + times */}
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <div className="flex items-center gap-3">
                          <span>Entry: <span className="text-slate-300 font-mono">{formatNum(t.entryPrice)}</span></span>
                          <span>Exit: <span className={`font-mono ${t.exitReason === 'ACTIVE' ? 'text-cyan-400' : 'text-slate-300'}`}>{formatNum(t.exitPrice)}</span></span>
                        </div>
                        <div>
                          {t.exitReason === 'ACTIVE' || !t.exitTime
                            ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">Active</span>
                            : <span>{formatTime(t.exitTime)}</span>
                          }
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop Table Layout */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                      <th className="px-4 py-3 font-medium">Security</th>
                      <th className="px-3 py-3 font-medium text-right">Entry</th>
                      <th className="px-3 py-3 font-medium text-right">Exit</th>
                      <th className="px-3 py-3 font-medium text-center">Dir</th>
                      <th className="px-3 py-3 font-medium text-right">Capital</th>
                      <th className="px-3 py-3 font-medium text-right">Equity</th>
                      <th className="px-3 py-3 font-medium text-center">Target</th>
                      <th className="px-3 py-3 font-medium text-right">P&L</th>
                      <th className="px-3 py-3 font-medium text-right">P&L%</th>
                      <th className="px-3 py-3 font-medium">Entry Time</th>
                      <th className="px-3 py-3 font-medium">Exit Time</th>
                      <th className="px-3 py-3 font-medium">Strategy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {filteredWeekly.map((t, i) => {
                      const positive = t.pnl >= 0
                      const sc = STRATEGY_COLORS[t.strategy] || STRATEGY_COLORS['FUDKII']
                      return (
                        <tr key={`${t.tradeId || 'trade'}-${i}`} className="hover:bg-slate-700/20 transition-colors cursor-pointer" onClick={() => setSelectedTrade(t)}>
                          <td className="px-4 py-3">
                            <div className="font-medium text-white truncate max-w-[240px]">
                              {getTradeDisplayName(t)}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-slate-500">{t.scripCode}</span>
                              {(() => {
                                const itype = getInstrumentTypeLabel(t)
                                return itype ? (
                                  <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">{itype}</span>
                                ) : null
                              })()}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs text-slate-300">{formatNum(t.entryPrice)}</td>
                          <td className="px-3 py-3 text-right font-mono text-xs">
                            {t.exitReason === 'ACTIVE'
                              ? <span className="text-cyan-400">{formatNum(t.exitPrice)}</span>
                              : <span className="text-slate-300">{formatNum(t.exitPrice)}</span>
                            }
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              t.direction === 'BULLISH'
                                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                : 'bg-red-500/15 text-red-400 border border-red-500/30'
                            }`}>
                              {t.side === 'BUY' ? 'LONG' : t.side === 'SELL' ? 'SHORT' : (t.direction === 'BULLISH' ? 'LONG' : 'SHORT')}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs text-slate-300">{formatINR(t.capitalEmployed)}</td>
                          <td className="px-3 py-3 text-right font-mono text-xs text-slate-300">{t.quantity}</td>
                          <td className="px-3 py-3 text-center">
                            <TargetBadge trade={t} />
                          </td>
                          <td className={`px-3 py-3 text-right font-mono text-xs font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {positive ? '+' : ''}{formatNum(t.pnl)}
                          </td>
                          <td className={`px-3 py-3 text-right font-mono text-xs font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {positive ? '+' : ''}{t.pnlPercent.toFixed(2)}%
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-400 whitespace-nowrap">{formatTime(t.entryTime)}</td>
                          <td className="px-3 py-3 text-xs whitespace-nowrap">
                            {t.exitReason === 'ACTIVE' || !t.exitTime
                              ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">Active</span>
                              : <span className="text-slate-400">{formatTime(t.exitTime)}</span>
                            }
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-1">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sc.bg} ${sc.text} border ${sc.border}`}>
                                {t.strategy}
                              </span>
                              {t.variant && t.variant !== t.strategy && (
                                <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-violet-500/15 text-violet-400 border border-violet-500/30">
                                  {t.variant.replace('MERE_', '').replace('_', ' ')}
                                </span>
                              )}
                              {t.executionMode === 'MANUAL' && (
                                <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-slate-500/15 text-slate-400 border border-slate-500/30">M</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Trade Detail Drawer */}
      {selectedTrade && (
        <TradeDetailDrawer
          trade={selectedTrade}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </div>
  )
}
