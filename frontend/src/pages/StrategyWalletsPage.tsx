import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Filter, ArrowUpDown, Check, TrendingUp, TrendingDown, Target, Briefcase } from 'lucide-react'
import { strategyWalletsApi, walletApi } from '../services/api'
import type { StrategyWalletSummary, StrategyWalletTrade } from '../services/api'
import type { Position } from '../types'
import PositionCard from '../components/Wallet/PositionCard'

// ─── Types ───────────────────────────────────────────────
type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH'
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C'
type StrategyFilter = 'ALL' | 'FUDKII' | 'FUKAA' | 'PIVOT' | 'MICROALPHA'
type SortField = 'exitTime' | 'pnl' | 'pnlPercent' | 'companyName' | 'strategy'

// ─── Strategy color map ──────────────────────────────────
const STRATEGY_COLORS: Record<string, { border: string; bg: string; text: string; accent: string }> = {
  FUDKII:     { border: 'border-amber-500/40',  bg: 'bg-amber-500/10',  text: 'text-amber-400',  accent: 'from-amber-500 to-amber-600' },
  FUKAA:      { border: 'border-orange-500/40',  bg: 'bg-orange-500/10', text: 'text-orange-400', accent: 'from-orange-500 to-orange-600' },
  PIVOT:      { border: 'border-blue-500/40',    bg: 'bg-blue-500/10',   text: 'text-blue-400',   accent: 'from-blue-500 to-blue-600' },
  MICROALPHA: { border: 'border-purple-500/40',  bg: 'bg-purple-500/10', text: 'text-purple-400', accent: 'from-purple-500 to-purple-600' },
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

// ─── Filter Dropdown ─────────────────────────────────────
const FilterDropdown: React.FC<{
  direction: DirectionFilter
  exchange: ExchangeFilter
  strategy: StrategyFilter
  onDirectionChange: (d: DirectionFilter) => void
  onExchangeChange: (e: ExchangeFilter) => void
  onStrategyChange: (s: StrategyFilter) => void
  onClose: () => void
  onReset: () => void
}> = ({ direction, exchange, strategy, onDirectionChange, onExchangeChange, onStrategyChange, onClose, onReset }) => (
  <div className="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 p-3 sm:p-4 min-w-[240px] sm:min-w-[280px] animate-slideDown mobile-dropdown-full">
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

    {/* Exchange */}
    <div className="mb-4">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Instrument</div>
      <div className="flex gap-2">
        {([
          { key: 'ALL' as ExchangeFilter, label: 'All' },
          { key: 'N' as ExchangeFilter, label: 'NSE' },
          { key: 'M' as ExchangeFilter, label: 'MCX' },
          { key: 'C' as ExchangeFilter, label: 'Currency' },
        ]).map(({ key, label }) => (
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

    {/* Strategy */}
    <div className="mb-4">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Strategy</div>
      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'ALL' as StrategyFilter, label: 'All' },
          { key: 'FUDKII' as StrategyFilter, label: 'FUDKII' },
          { key: 'FUKAA' as StrategyFilter, label: 'FUKAA' },
          { key: 'PIVOT' as StrategyFilter, label: 'PIVOT' },
          { key: 'MICROALPHA' as StrategyFilter, label: 'MICRO' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onStrategyChange(key)}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              strategy === key
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
)

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

// ═════════════════════════════════════════════════════════
//  MAIN PAGE COMPONENT
// ═════════════════════════════════════════════════════════
export default function StrategyWalletsPage() {
  const [summaries, setSummaries] = useState<StrategyWalletSummary[]>([])
  const [trades, setTrades] = useState<StrategyWalletTrade[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Filters
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL')
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL')
  const [strategyFilter, setStrategyFilter] = useState<StrategyFilter>('ALL')
  const [sortField, setSortField] = useState<SortField>('exitTime')

  // Dropdown toggles
  const [showFilter, setShowFilter] = useState(false)
  const [showSort, setShowSort] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  const hasFilters = directionFilter !== 'ALL' || exchangeFilter !== 'ALL' || strategyFilter !== 'ALL'

  const loadData = useCallback(async () => {
    try {
      const [s, t, w] = await Promise.all([
        strategyWalletsApi.getSummaries(),
        strategyWalletsApi.getWeeklyTrades({
          strategy: strategyFilter !== 'ALL' ? strategyFilter : undefined,
          direction: directionFilter !== 'ALL' ? directionFilter : undefined,
          exchange: exchangeFilter !== 'ALL' ? exchangeFilter : undefined,
          sortBy: sortField,
        }),
        walletApi.getWallet(),
      ])
      if (s) setSummaries(s)
      if (t) setTrades(t)
      if (w?.positions) {
        // Show all today's trades as cards: active first, then closed
        const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
        const todayPositions = w.positions.filter(p => {
          if (p.quantity > 0) return true // Always show open positions
          // Show closed positions from today
          if (p.openedAt) {
            const opened = new Date(p.openedAt)
            return opened.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) === today
          }
          return false
        })
        // Sort: active (qty > 0) first, then closed
        todayPositions.sort((a, b) => {
          if (a.quantity > 0 && b.quantity <= 0) return -1
          if (a.quantity <= 0 && b.quantity > 0) return 1
          return 0
        })
        setPositions(todayPositions)
      }
    } catch (err) {
      console.error('Error loading strategy wallets:', err)
    } finally {
      setLoading(false)
    }
  }, [directionFilter, exchangeFilter, strategyFilter, sortField])

  useEffect(() => {
    setLoading(true)
    loadData()
    let interval: ReturnType<typeof setInterval> | null = null
    if (autoRefresh) {
      interval = setInterval(loadData, 5000)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [loadData, autoRefresh])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilter(false)
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSort(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const resetFilters = () => {
    setDirectionFilter('ALL')
    setExchangeFilter('ALL')
    setStrategyFilter('ALL')
  }

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
            {/* Filter */}
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => { setShowFilter(!showFilter); setShowSort(false) }}
                className={`relative p-1.5 sm:p-2 rounded-lg transition-colors ${showFilter ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-700/50 text-slate-400 hover:text-white'}`}
              >
                <Filter className="w-4 h-4" />
                {hasFilters && <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400" />}
              </button>
              {showFilter && (
                <FilterDropdown
                  direction={directionFilter}
                  exchange={exchangeFilter}
                  strategy={strategyFilter}
                  onDirectionChange={setDirectionFilter}
                  onExchangeChange={setExchangeFilter}
                  onStrategyChange={setStrategyFilter}
                  onClose={() => setShowFilter(false)}
                  onReset={resetFilters}
                />
              )}
            </div>

            {/* Sort */}
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => { setShowSort(!showSort); setShowFilter(false) }}
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
      <div className="px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* ── 4 Wallet Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-4">
          {(summaries.length > 0 ? summaries : Array.from({ length: 4 }, (_, i) => ({
            strategy: ['FUDKII', 'FUKAA', 'PIVOT_CONFLUENCE', 'MICROALPHA'][i],
            displayName: ['FUDKII', 'FUKAA', 'PIVOT', 'MICROALPHA'][i],
            initialCapital: 100000, currentCapital: 100000, totalPnl: 0, totalPnlPercent: 0,
            totalTrades: 0, wins: 0, losses: 0, winRate: 0,
          }))).map(s => {
            const colors = STRATEGY_COLORS[s.displayName] || STRATEGY_COLORS['FUDKII']
            const positive = s.totalPnl >= 0
            return (
              <div
                key={s.strategy}
                className={`bg-slate-800/60 backdrop-blur border ${colors.border} rounded-xl p-3 sm:p-6 hover:bg-slate-800/80 transition-all`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2 sm:mb-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-gradient-to-br ${colors.accent} shrink-0`} />
                    <h3 className={`text-xs sm:text-base font-bold ${colors.text} truncate`}>{s.displayName}</h3>
                  </div>
                  <span className={`text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5 rounded shrink-0 ${positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {s.winRate.toFixed(0)}%
                  </span>
                </div>

                {/* Capital */}
                <div className="text-base sm:text-2xl font-bold font-mono tabular-nums text-white mb-0.5 sm:mb-1 truncate">
                  {formatINR(s.currentCapital)}
                </div>

                {/* P&L */}
                <div className={`flex items-center gap-1 text-xs sm:text-sm font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {positive ? <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" /> : <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />}
                  <span className="truncate">{positive ? '+' : ''}{formatINR(s.totalPnl)}</span>
                  <span className="text-[10px] sm:text-xs opacity-75 shrink-0">({s.totalPnlPercent.toFixed(1)}%)</span>
                </div>

                {/* Stats */}
                <div className="mt-2 sm:mt-4 flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-slate-500">
                  <span>{s.totalTrades}t</span>
                  <span className="text-emerald-500">{s.wins}W</span>
                  <span className="text-red-500">{s.losses}L</span>
                </div>

                {/* Win/Loss bar */}
                {s.totalTrades > 0 && (
                  <div className="mt-1.5 sm:mt-2 h-1 sm:h-1.5 rounded-full bg-slate-700 overflow-hidden flex">
                    <div className="bg-emerald-500 rounded-l-full" style={{ width: `${s.winRate}%` }} />
                    <div className="bg-red-500 rounded-r-full flex-1" />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Active Trades ── */}
        {(() => {
          const activePositions = positions.filter(p => p.quantity > 0)
          const exitedPositions = positions.filter(p => p.quantity <= 0)
          return (
            <>
              {activePositions.length > 0 && (
                <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-cyan-400" />
                    <h2 className="text-sm font-bold text-white">Active Trades</h2>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/20 text-cyan-400">
                      {activePositions.length}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {activePositions.map(pos => (
                        <PositionCard key={pos.positionId} position={pos} onUpdate={loadData} />
                      ))}
                    </div>
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
                      {exitedPositions.length}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {exitedPositions.map(pos => (
                        <PositionCard key={pos.positionId} position={pos} onUpdate={loadData} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {/* ── Weekly Trades Table ── */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Trades This Week</h2>
            <span className="text-xs text-slate-500">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
          </div>

          {loading && trades.length === 0 ? (
            <div className="p-8 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Loading trades...</p>
            </div>
          ) : trades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-14 h-14 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
                <Target className="w-6 h-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-400 mb-1">No trades this week</p>
              {hasFilters && (
                <button onClick={resetFilters} className="text-xs text-blue-400 hover:text-blue-300 mt-2">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile Card Layout */}
              <div className="md:hidden divide-y divide-slate-700/30">
                {trades.map((t, i) => {
                  const positive = t.pnl >= 0
                  const sc = STRATEGY_COLORS[t.strategy] || STRATEGY_COLORS['FUDKII']
                  return (
                    <div key={t.tradeId || i} className="px-3 py-3 space-y-2">
                      {/* Row 1: Security + P&L */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-sm text-white truncate">{t.companyName || t.scripCode}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              t.direction === 'BULLISH'
                                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                : 'bg-red-500/15 text-red-400 border border-red-500/30'
                            }`}>
                              {t.direction === 'BULLISH' ? 'BULL' : 'BEAR'}
                            </span>
                            <TargetBadge trade={t} />
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${sc.bg} ${sc.text} border ${sc.border}`}>
                              {t.strategy}
                            </span>
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
                    {trades.map((t, i) => {
                      const positive = t.pnl >= 0
                      const sc = STRATEGY_COLORS[t.strategy] || STRATEGY_COLORS['FUDKII']
                      return (
                        <tr key={t.tradeId || i} className="hover:bg-slate-700/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-white truncate max-w-[160px]">{t.companyName || t.scripCode}</div>
                            <div className="text-[10px] text-slate-500">{t.scripCode}</div>
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
                              {t.direction === 'BULLISH' ? 'BULL' : 'BEAR'}
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
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sc.bg} ${sc.text} border ${sc.border}`}>
                              {t.strategy}
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
    </div>
  )
}
