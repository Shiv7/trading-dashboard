import { useEffect, useState, useMemo } from 'react'
import { BarChart3, TrendingUp, TrendingDown, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell } from 'recharts'
import { strategyWalletsApi } from '../services/api'
import type { StrategyWalletSummary, StrategyWalletTrade } from '../services/api'
import { getStrategyColors, getStrategyBadgeClass } from '../utils/strategyColors'
import PerformanceCharts from '../components/Charts/PerformanceCharts'
import type { Trade } from '../types'

type StrategyTab = 'ALL' | string
type ViewMode = 'trades' | 'analytics' | 'deep'
type ResultFilter = 'ALL' | 'WIN' | 'LOSS'
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C'

const STRATEGY_KEYS = ['FUDKII', 'FUKAA', 'FUDKOI', 'PIVOT', 'MICROALPHA', 'MERE']

const fmt = (v: number, d = 2) => v.toFixed(d)
const fmtINR = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
const fmtTime = (ts: string) => {
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ', ' +
      d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
  } catch { return 'DM' }
}
const fmtDuration = (mins?: number | null) => {
  if (!mins) return 'DM'
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
}

/** Compute analytics from a list of trades */
function computeAnalytics(trades: StrategyWalletTrade[]) {
  const closed = trades.filter(t => t.exitTime)
  if (closed.length === 0) return null
  const wins = closed.filter(t => t.pnl > 0)
  const losses = closed.filter(t => t.pnl < 0)
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0)
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
  const profitFactor = Math.abs(avgLoss) > 0 ? (wins.reduce((s, t) => s + t.pnl, 0)) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0)) : wins.length > 0 ? Infinity : 0
  const avgR = closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / closed.length
  const bestTrade = closed.reduce((best, t) => t.pnl > best.pnl ? t : best, closed[0])
  const worstTrade = closed.reduce((worst, t) => t.pnl < worst.pnl ? t : worst, closed[0])
  const avgDuration = closed.reduce((s, t) => s + (t.durationMinutes ?? 0), 0) / closed.length

  // Max drawdown
  let peak = 0, maxDD = 0, cumPnl = 0
  const sorted = [...closed].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
  for (const t of sorted) {
    cumPnl += t.pnl
    if (cumPnl > peak) peak = cumPnl
    const dd = peak - cumPnl
    if (dd > maxDD) maxDD = dd
  }

  // By direction
  const bullish = closed.filter(t => t.direction === 'BULLISH' || t.side === 'LONG')
  const bearish = closed.filter(t => t.direction === 'BEARISH' || t.side === 'SHORT')
  const byDirection = {
    bullish: { count: bullish.length, pnl: bullish.reduce((s, t) => s + t.pnl, 0), winRate: bullish.length > 0 ? (bullish.filter(t => t.pnl > 0).length / bullish.length) * 100 : 0 },
    bearish: { count: bearish.length, pnl: bearish.reduce((s, t) => s + t.pnl, 0), winRate: bearish.length > 0 ? (bearish.filter(t => t.pnl > 0).length / bearish.length) * 100 : 0 },
  }

  // By exchange
  const byExchange: Record<string, { count: number; pnl: number; winRate: number }> = {}
  for (const ex of ['N', 'M', 'C']) {
    const exTrades = closed.filter(t => t.exchange === ex)
    if (exTrades.length > 0) {
      byExchange[ex] = { count: exTrades.length, pnl: exTrades.reduce((s, t) => s + t.pnl, 0), winRate: (exTrades.filter(t => t.pnl > 0).length / exTrades.length) * 100 }
    }
  }

  // By instrument type
  const byInstrument: Record<string, { count: number; pnl: number; winRate: number }> = {}
  for (const inst of ['OPTIONS', 'FUTURES', 'EQUITY']) {
    const instTrades = closed.filter(t => (t.instrumentType ?? 'EQUITY') === inst || (!t.instrumentType && inst === 'EQUITY'))
    if (instTrades.length > 0) {
      byInstrument[inst] = { count: instTrades.length, pnl: instTrades.reduce((s, t) => s + t.pnl, 0), winRate: (instTrades.filter(t => t.pnl > 0).length / instTrades.length) * 100 }
    }
  }

  // By confidence band
  const byConfidence: { band: string; count: number; pnl: number; winRate: number }[] = []
  const bands = [
    { label: '<60%', min: 0, max: 60 },
    { label: '60-70%', min: 60, max: 70 },
    { label: '70-80%', min: 70, max: 80 },
    { label: '80-90%', min: 80, max: 90 },
    { label: '90%+', min: 90, max: 101 },
  ]
  for (const b of bands) {
    const bandTrades = closed.filter(t => {
      const c = t.confidence ?? 0
      return c >= b.min && c < b.max
    })
    if (bandTrades.length > 0) {
      byConfidence.push({ band: b.label, count: bandTrades.length, pnl: bandTrades.reduce((s, t) => s + t.pnl, 0), winRate: (bandTrades.filter(t => t.pnl > 0).length / bandTrades.length) * 100 })
    }
  }

  // By exit reason
  const byExitReason: Record<string, { count: number; pnl: number }> = {}
  for (const t of closed) {
    const reason = t.exitReason || 'UNKNOWN'
    if (!byExitReason[reason]) byExitReason[reason] = { count: 0, pnl: 0 }
    byExitReason[reason].count++
    byExitReason[reason].pnl += t.pnl
  }

  // Top winners/losers by scrip
  const byScrip: Record<string, { count: number; pnl: number; wins: number }> = {}
  for (const t of closed) {
    const key = t.companyName || t.scripCode
    if (!byScrip[key]) byScrip[key] = { count: 0, pnl: 0, wins: 0 }
    byScrip[key].count++
    byScrip[key].pnl += t.pnl
    if (t.pnl > 0) byScrip[key].wins++
  }
  const topWinners = Object.entries(byScrip).sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 5)
  const topLosers = Object.entries(byScrip).sort((a, b) => a[1].pnl - b[1].pnl).slice(0, 5)

  // By hour of day (IST)
  const byHour: Record<number, { count: number; pnl: number; wins: number }> = {}
  for (const t of sorted) {
    try {
      const d = new Date(t.entryTime)
      const istH = parseInt(d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }))
      if (!byHour[istH]) byHour[istH] = { count: 0, pnl: 0, wins: 0 }
      byHour[istH].count++
      byHour[istH].pnl += t.pnl
      if (t.pnl > 0) byHour[istH].wins++
    } catch { /* skip */ }
  }

  // Streak analysis
  let currentStreak = 0, bestStreak = 0, worstStreak = 0, tempStreak = 0
  for (const t of sorted) {
    if (t.pnl > 0) {
      if (tempStreak >= 0) tempStreak++; else tempStreak = 1
    } else {
      if (tempStreak <= 0) tempStreak--; else tempStreak = -1
    }
    if (tempStreak > bestStreak) bestStreak = tempStreak
    if (tempStreak < worstStreak) worstStreak = tempStreak
    currentStreak = tempStreak
  }

  return {
    totalTrades: closed.length, wins: wins.length, losses: losses.length,
    totalPnl, winRate, avgWin, avgLoss, profitFactor, avgR,
    bestTrade, worstTrade, maxDrawdown: maxDD, avgDuration,
    byDirection, byExchange, byInstrument, byConfidence, byExitReason,
    topWinners, topLosers, byHour,
    streaks: { current: currentStreak, best: bestStreak, worst: worstStreak },
  }
}

/** Pearson correlation coefficient */
function pearsonCorr(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? null : num / denom
}

/** Compute correlation matrix and advanced metrics */
function computeAdvancedAnalytics(trades: StrategyWalletTrade[]) {
  const closed = trades.filter(t => t.exitTime && t.pnlPercent !== 0)
  if (closed.length < 3) return null

  const metrics = [
    { key: 'confidence', label: 'Confidence', extract: (t: StrategyWalletTrade) => t.confidence },
    { key: 'riskReward', label: 'Risk:Reward', extract: (t: StrategyWalletTrade) => t.riskReward },
    { key: 'atr', label: 'ATR', extract: (t: StrategyWalletTrade) => t.atr },
    { key: 'volumeSurge', label: 'Vol Surge', extract: (t: StrategyWalletTrade) => t.volumeSurge },
    { key: 'oiChangePercent', label: 'OI Change%', extract: (t: StrategyWalletTrade) => t.oiChangePercent },
    { key: 'blockDealPercent', label: 'Block Deal%', extract: (t: StrategyWalletTrade) => t.blockDealPercent },
    { key: 'rMultiple', label: 'R-Multiple', extract: (t: StrategyWalletTrade) => t.rMultiple },
    { key: 'durationMinutes', label: 'Duration(m)', extract: (t: StrategyWalletTrade) => t.durationMinutes },
  ]

  // Correlation matrix: each metric vs PnL%
  const correlations: { key: string; label: string; corr: number | null; n: number }[] = []
  const scatterData: Record<string, { x: number; y: number; name: string }[]> = {}

  for (const m of metrics) {
    const pairs = closed
      .map(t => ({ x: m.extract(t), y: t.pnlPercent, name: t.companyName || t.scripCode }))
      .filter(p => p.x != null && isFinite(p.x as number)) as { x: number; y: number; name: string }[]

    const corr = pairs.length >= 3 ? pearsonCorr(pairs.map(p => p.x), pairs.map(p => p.y)) : null
    correlations.push({ key: m.key, label: m.label, corr, n: pairs.length })
    if (pairs.length >= 3) scatterData[m.key] = pairs
  }

  // Cross-correlations between all metrics
  const crossCorr: { m1: string; m2: string; corr: number | null }[] = []
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const pairs = closed
        .map(t => ({ x: metrics[i].extract(t), y: metrics[j].extract(t) }))
        .filter(p => p.x != null && p.y != null && isFinite(p.x as number) && isFinite(p.y as number)) as { x: number; y: number }[]
      const c = pairs.length >= 3 ? pearsonCorr(pairs.map(p => p.x), pairs.map(p => p.y)) : null
      crossCorr.push({ m1: metrics[i].key, m2: metrics[j].key, corr: c })
    }
  }

  // Optimal parameter zones: for each metric, bucket into quartiles and show win rate + avg PnL
  const parameterZones: Record<string, { zone: string; count: number; winRate: number; avgPnl: number }[]> = {}
  for (const m of metrics) {
    const valid = closed.filter(t => m.extract(t) != null && isFinite(m.extract(t) as number))
    if (valid.length < 8) continue
    const vals = valid.map(t => m.extract(t) as number).sort((a, b) => a - b)
    const q1 = vals[Math.floor(vals.length * 0.25)]
    const q2 = vals[Math.floor(vals.length * 0.5)]
    const q3 = vals[Math.floor(vals.length * 0.75)]
    const zones = [
      { zone: `<${q1.toFixed(1)}`, filter: (v: number) => v < q1 },
      { zone: `${q1.toFixed(1)}-${q2.toFixed(1)}`, filter: (v: number) => v >= q1 && v < q2 },
      { zone: `${q2.toFixed(1)}-${q3.toFixed(1)}`, filter: (v: number) => v >= q2 && v < q3 },
      { zone: `>${q3.toFixed(1)}`, filter: (v: number) => v >= q3 },
    ]
    parameterZones[m.key] = zones.map(z => {
      const bucket = valid.filter(t => z.filter(m.extract(t) as number))
      return {
        zone: z.zone,
        count: bucket.length,
        winRate: bucket.length > 0 ? (bucket.filter(t => t.pnl > 0).length / bucket.length) * 100 : 0,
        avgPnl: bucket.length > 0 ? bucket.reduce((s, t) => s + t.pnl, 0) / bucket.length : 0,
      }
    })
  }

  return { correlations, scatterData, crossCorr, parameterZones, metrics }
}

/** Correlation color */
function corrColor(v: number | null): string {
  if (v === null) return 'text-slate-600'
  if (v >= 0.5) return 'text-emerald-400'
  if (v >= 0.2) return 'text-emerald-500/70'
  if (v > -0.2) return 'text-slate-400'
  if (v > -0.5) return 'text-red-500/70'
  return 'text-red-400'
}
function corrBg(v: number | null): string {
  if (v === null) return 'bg-slate-800/30'
  const abs = Math.abs(v)
  if (abs >= 0.5) return v > 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
  if (abs >= 0.2) return v > 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
  return 'bg-slate-800/30'
}

export default function TradesPage() {
  const [summaries, setSummaries] = useState<StrategyWalletSummary[]>([])
  const [trades, setTrades] = useState<StrategyWalletTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStrategy, setActiveStrategy] = useState<StrategyTab>('ALL')
  const [viewMode, setViewMode] = useState<ViewMode>('trades')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('ALL')
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL')
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [sums, allTrades] = await Promise.all([
          strategyWalletsApi.getSummaries().catch(() => []),
          strategyWalletsApi.getWeeklyTrades({ limit: 500 }).catch(() => []),
        ])
        setSummaries(sums)
        setTrades(allTrades)
      } catch (e) {
        console.error('Failed to load trades:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Filter trades
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (activeStrategy !== 'ALL' && t.strategy !== activeStrategy) return false
      if (resultFilter === 'WIN' && t.pnl <= 0) return false
      if (resultFilter === 'LOSS' && t.pnl >= 0) return false
      if (exchangeFilter !== 'ALL' && t.exchange !== exchangeFilter) return false
      return true
    }).sort((a, b) => new Date(b.exitTime || b.entryTime).getTime() - new Date(a.exitTime || a.entryTime).getTime())
  }, [trades, activeStrategy, resultFilter, exchangeFilter])

  const analytics = useMemo(() => computeAnalytics(filteredTrades), [filteredTrades])
  const advAnalytics = useMemo(() => computeAdvancedAnalytics(filteredTrades), [filteredTrades])

  // Convert to Trade[] for PerformanceCharts compatibility
  const chartsData = useMemo((): Trade[] => {
    return filteredTrades.filter(t => t.exitTime).map(t => ({
      tradeId: t.tradeId, signalId: '', scripCode: t.scripCode, companyName: t.companyName,
      side: t.side as 'LONG' | 'SHORT',
      status: t.pnl > 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS' as Trade['status'],
      entryPrice: t.entryPrice, entryTime: t.entryTime, exitPrice: t.exitPrice, exitTime: t.exitTime,
      quantity: t.quantity, stopLoss: t.stopLoss ?? 0, target1: t.target1 ?? 0,
      pnl: t.pnl, pnlPercent: t.pnlPercent, rMultiple: t.rMultiple ?? 0, durationMinutes: t.durationMinutes ?? 0,
      strategy: t.strategy, executionMode: t.executionMode,
    }))
  }, [filteredTrades])

  // Get active wallet summary
  const activeSummary = activeStrategy === 'ALL' ? null : summaries.find(s => s.strategy === activeStrategy)

  if (loading) {
    return (
      <div className="px-2 sm:px-4 lg:px-6 xl:px-8 py-6 max-w-[1600px] mx-auto space-y-6">
        <div className="h-10 w-64 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />)}
        </div>
        <div className="h-96 bg-slate-800 rounded-xl animate-pulse" />
      </div>
    )
  }

  return (
    <div className="px-2 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 max-w-[1600px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/20 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
          </div>
          <h1 className="text-xl lg:text-2xl font-bold text-white">Trade History</h1>
          <span className="text-sm text-slate-500">{filteredTrades.length} trades</span>
        </div>
        <div className="flex bg-slate-800 rounded-lg p-1">
          {(['trades', 'analytics', 'deep'] as ViewMode[]).map(vm => (
            <button key={vm} onClick={() => setViewMode(vm)}
              className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${viewMode === vm ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {vm === 'trades' ? 'Trades' : vm === 'analytics' ? 'Analytics' : 'Deep Analysis'}
            </button>
          ))}
        </div>
      </div>

      {/* Strategy Wallet Tabs */}
      <div className="overflow-x-auto pb-1 -mx-2 px-2 scrollbar-thin scrollbar-thumb-slate-700">
        <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
          <button onClick={() => setActiveStrategy('ALL')}
            className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all border ${
              activeStrategy === 'ALL' ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            ALL
            <span className="ml-1.5 text-[10px] opacity-70">{trades.length}</span>
          </button>
          {STRATEGY_KEYS.map(key => {
            const sum = summaries.find(s => s.strategy === key)
            const c = getStrategyColors(key)
            const isActive = activeStrategy === key
            const count = trades.filter(t => t.strategy === key).length
            return (
              <button key={key} onClick={() => setActiveStrategy(key)}
                className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all border ${
                  isActive ? `${c.bg} ${c.text} ${c.border}` : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{key}</span>
                  <span className="text-[10px] opacity-70">{count}</span>
                </div>
                {sum && (
                  <div className={`text-[10px] mt-0.5 ${sum.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtINR(sum.totalPnl)} ({fmt(sum.winRate, 0)}%)
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Wallet Summary Card (when strategy selected) */}
      {activeSummary && (
        <div className="card">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 lg:gap-4">
            <MetricCell label="Capital" value={fmtINR(activeSummary.currentCapital)} sub={`Initial: ${fmtINR(activeSummary.initialCapital)}`} />
            <MetricCell label="Total P&L" value={fmtINR(activeSummary.totalPnl)} color={activeSummary.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} sub={`${fmt(activeSummary.totalPnlPercent, 1)}%`} />
            <MetricCell label="Day P&L" value={fmtINR(activeSummary.dayPnl ?? 0)} color={(activeSummary.dayPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            <MetricCell label="Win Rate" value={`${fmt(activeSummary.winRate, 1)}%`} color={activeSummary.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'} sub={`${activeSummary.wins}W / ${activeSummary.losses}L`} />
            <MetricCell label="Available" value={fmtINR(activeSummary.availableMargin ?? 0)} />
            <MetricCell label="Trades" value={String(activeSummary.totalTrades)} sub={`${activeSummary.wins}W ${activeSummary.losses}L`} />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(['ALL', 'WIN', 'LOSS'] as ResultFilter[]).map(f => (
          <button key={f} onClick={() => setResultFilter(f)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              resultFilter === f
                ? f === 'WIN' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : f === 'LOSS' ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-blue-600 text-white border border-blue-500'
                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
            }`}
          >{f === 'ALL' ? 'All' : f === 'WIN' ? 'Winners' : 'Losers'}</button>
        ))}
        <span className="w-px bg-slate-700 mx-1" />
        {(['ALL', 'N', 'M', 'C'] as ExchangeFilter[]).map(f => (
          <button key={f} onClick={() => setExchangeFilter(f)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              exchangeFilter === f ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
            }`}
          >{f === 'ALL' ? 'All Exch' : f === 'N' ? 'NSE' : f === 'M' ? 'MCX' : 'CDS'}</button>
        ))}
      </div>

      {/* Content */}
      {viewMode === 'deep' ? (
        <DeepAnalyticsView analytics={analytics} advAnalytics={advAnalytics} />
      ) : viewMode === 'analytics' ? (
        <div className="space-y-5">
          {/* Key Metrics */}
          {analytics && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Total P&L" value={fmtINR(analytics.totalPnl)} positive={analytics.totalPnl >= 0} />
                <StatCard label="Win Rate" value={`${fmt(analytics.winRate, 1)}%`} positive={analytics.winRate >= 50} />
                <StatCard label="Profit Factor" value={analytics.profitFactor === Infinity ? '∞' : fmt(analytics.profitFactor, 2)} positive={analytics.profitFactor > 1} />
                <StatCard label="Max Drawdown" value={fmtINR(analytics.maxDrawdown)} positive={false} />
                <StatCard label="Avg R" value={`${analytics.avgR >= 0 ? '+' : ''}${fmt(analytics.avgR, 2)}R`} positive={analytics.avgR >= 0} />
                <StatCard label="Avg Duration" value={fmtDuration(analytics.avgDuration)} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Avg Win/Loss */}
                <div className="card">
                  <div className="text-sm font-semibold text-slate-300 mb-3">Win / Loss Analysis</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-500/10 rounded-lg p-3">
                      <div className="text-[10px] text-emerald-400/70 uppercase">Avg Win</div>
                      <div className="text-lg font-bold text-emerald-400">{fmtINR(analytics.avgWin)}</div>
                      <div className="text-[10px] text-slate-500">{analytics.wins} trades</div>
                    </div>
                    <div className="bg-red-500/10 rounded-lg p-3">
                      <div className="text-[10px] text-red-400/70 uppercase">Avg Loss</div>
                      <div className="text-lg font-bold text-red-400">{fmtINR(analytics.avgLoss)}</div>
                      <div className="text-[10px] text-slate-500">{analytics.losses} trades</div>
                    </div>
                    <div className="bg-cyan-500/10 rounded-lg p-3">
                      <div className="text-[10px] text-cyan-400/70 uppercase">Best Trade</div>
                      <div className="text-sm font-bold text-emerald-400">{fmtINR(analytics.bestTrade.pnl)}</div>
                      <div className="text-[10px] text-slate-400 truncate">{analytics.bestTrade.companyName || analytics.bestTrade.scripCode}</div>
                    </div>
                    <div className="bg-slate-700/30 rounded-lg p-3">
                      <div className="text-[10px] text-slate-400/70 uppercase">Worst Trade</div>
                      <div className="text-sm font-bold text-red-400">{fmtINR(analytics.worstTrade.pnl)}</div>
                      <div className="text-[10px] text-slate-400 truncate">{analytics.worstTrade.companyName || analytics.worstTrade.scripCode}</div>
                    </div>
                  </div>
                </div>

                {/* By Direction */}
                <div className="card">
                  <div className="text-sm font-semibold text-slate-300 mb-3">Direction Breakdown</div>
                  <div className="space-y-3">
                    {Object.entries(analytics.byDirection).map(([dir, data]) => (
                      <div key={dir} className="flex items-center gap-3">
                        <span className={`text-xs font-semibold w-16 ${dir === 'bullish' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {dir === 'bullish' ? 'LONG' : 'SHORT'}
                        </span>
                        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${dir === 'bullish' ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${data.winRate}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 w-20 text-right">{data.count}T · {fmt(data.winRate, 0)}%</span>
                        <span className={`text-xs font-mono w-20 text-right ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(data.pnl)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Exchange */}
                <div className="card">
                  <div className="text-sm font-semibold text-slate-300 mb-3">Exchange Breakdown</div>
                  <div className="space-y-3">
                    {Object.entries(analytics.byExchange).map(([ex, data]) => (
                      <div key={ex} className="flex items-center gap-3">
                        <span className="text-xs font-semibold w-16 text-amber-400">
                          {ex === 'N' ? 'NSE' : ex === 'M' ? 'MCX' : 'CDS'}
                        </span>
                        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${data.winRate}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 w-20 text-right">{data.count}T · {fmt(data.winRate, 0)}%</span>
                        <span className={`text-xs font-mono w-20 text-right ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(data.pnl)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Instrument */}
                <div className="card">
                  <div className="text-sm font-semibold text-slate-300 mb-3">Instrument Breakdown</div>
                  <div className="space-y-3">
                    {Object.entries(analytics.byInstrument).map(([inst, data]) => (
                      <div key={inst} className="flex items-center gap-3">
                        <span className={`text-xs font-semibold w-16 ${inst === 'OPTIONS' ? 'text-indigo-400' : inst === 'FUTURES' ? 'text-purple-400' : 'text-slate-300'}`}>
                          {inst === 'OPTIONS' ? 'OPT' : inst === 'FUTURES' ? 'FUT' : 'EQ'}
                        </span>
                        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${inst === 'OPTIONS' ? 'bg-indigo-500' : inst === 'FUTURES' ? 'bg-purple-500' : 'bg-slate-500'}`} style={{ width: `${data.winRate}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 w-20 text-right">{data.count}T · {fmt(data.winRate, 0)}%</span>
                        <span className={`text-xs font-mono w-20 text-right ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(data.pnl)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Confidence Band */}
                {analytics.byConfidence.length > 0 && (
                  <div className="card">
                    <div className="text-sm font-semibold text-slate-300 mb-3">Confidence Band Performance</div>
                    <div className="space-y-2">
                      {analytics.byConfidence.map(b => (
                        <div key={b.band} className="flex items-center gap-3">
                          <span className="text-xs font-mono text-cyan-400 w-16">{b.band}</span>
                          <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-cyan-500" style={{ width: `${b.winRate}%` }} />
                          </div>
                          <span className="text-xs text-slate-400 w-20 text-right">{b.count}T · {fmt(b.winRate, 0)}%</span>
                          <span className={`text-xs font-mono w-20 text-right ${b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(b.pnl)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Exit Reason Distribution */}
                <div className="card">
                  <div className="text-sm font-semibold text-slate-300 mb-3">Exit Reasons</div>
                  <div className="space-y-2">
                    {Object.entries(analytics.byExitReason).sort((a, b) => b[1].count - a[1].count).map(([reason, data]) => (
                      <div key={reason} className="flex items-center justify-between gap-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          reason.startsWith('T') ? 'bg-emerald-500/15 text-emerald-400' : reason === 'SL' ? 'bg-red-500/15 text-red-400' : reason === 'EOD' ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-700 text-slate-400'
                        }`}>{reason}</span>
                        <span className="text-xs text-slate-500">{data.count} trades</span>
                        <span className={`text-xs font-mono ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(data.pnl)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Top Winners / Losers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="card">
                  <div className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> Top Winners (by Security)
                  </div>
                  <div className="space-y-2">
                    {analytics.topWinners.filter(([,d]) => d.pnl > 0).map(([name, data]) => (
                      <div key={name} className="flex items-center justify-between">
                        <span className="text-xs text-white font-medium truncate max-w-[160px]">{name}</span>
                        <span className="text-[10px] text-slate-500">{data.count}T · {data.wins}W</span>
                        <span className="text-xs font-mono text-emerald-400">{fmtINR(data.pnl)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <div className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" /> Top Losers (by Security)
                  </div>
                  <div className="space-y-2">
                    {analytics.topLosers.filter(([,d]) => d.pnl < 0).map(([name, data]) => (
                      <div key={name} className="flex items-center justify-between">
                        <span className="text-xs text-white font-medium truncate max-w-[160px]">{name}</span>
                        <span className="text-[10px] text-slate-500">{data.count}T</span>
                        <span className="text-xs font-mono text-red-400">{fmtINR(data.pnl)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Equity Curve */}
              {chartsData.length > 0 && (
                <div className="card">
                  <div className="text-sm font-semibold text-slate-300 mb-3">Equity Curve & Drawdown</div>
                  <PerformanceCharts trades={chartsData} initialCapital={activeSummary?.initialCapital ?? 1000000} />
                </div>
              )}
            </>
          )}
          {!analytics && (
            <div className="card text-center py-16 text-slate-500">
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No closed trades to analyze</p>
            </div>
          )}
        </div>
      ) : (
        /* Trades Table */
        <div className="card overflow-hidden">
          {filteredTrades.length > 0 ? (
            <div className="overflow-x-auto">
              {/* Desktop table */}
              <table className="w-full text-sm hidden lg:table">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Security</th>
                    <th className="text-left px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Strategy</th>
                    <th className="text-left px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Dir</th>
                    <th className="text-right px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Entry</th>
                    <th className="text-right px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Exit</th>
                    <th className="text-right px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">P&L</th>
                    <th className="text-right px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">P&L%</th>
                    <th className="text-right px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">R</th>
                    <th className="text-center px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Targets</th>
                    <th className="text-left px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Exit</th>
                    <th className="text-right px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Duration</th>
                    <th className="text-right px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Conf</th>
                    <th className="text-left px-3 py-2.5 text-[10px] uppercase text-slate-500 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.map(t => (
                    <tr key={t.tradeId} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-white text-xs">{t.companyName || t.scripCode}</div>
                        <div className="text-[10px] text-slate-500">{t.instrumentType === 'OPTIONS' ? 'OPT' : t.instrumentType === 'FUTURES' ? 'FUT' : 'EQ'} · {t.exchange === 'N' ? 'NSE' : t.exchange === 'M' ? 'MCX' : 'CDS'}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${getStrategyBadgeClass(t.strategy)}`}>{t.strategy}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-semibold ${t.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{t.side === 'LONG' ? 'LONG' : 'SHORT'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-white">{fmt(t.entryPrice)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-white">{t.exitPrice ? fmt(t.exitPrice) : <span className="text-cyan-400 italic">Active</span>}</td>
                      <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(t.pnl)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono text-xs ${t.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{t.pnlPercent >= 0 ? '+' : ''}{fmt(t.pnlPercent, 1)}%</td>
                      <td className={`px-3 py-2.5 text-right font-mono text-xs ${(t.rMultiple ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{t.rMultiple != null ? `${(t.rMultiple ?? 0) >= 0 ? '+' : ''}${fmt(t.rMultiple ?? 0)}R` : <span className="text-slate-500 italic">DM</span>}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-0.5">
                          {[{ hit: t.stopHit, label: 'SL' }, { hit: t.target1Hit, label: 'T1' }, { hit: t.target2Hit, label: 'T2' }, { hit: t.target3Hit, label: 'T3' }, { hit: t.target4Hit, label: 'T4' }]
                            .map(({ hit, label }) => (
                              <span key={label} className={`w-5 h-5 flex items-center justify-center rounded text-[8px] font-bold ${
                                hit ? label === 'SL' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'
                              }`}>{label}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          (t.exitReason ?? '').startsWith('T') ? 'bg-emerald-500/15 text-emerald-400' : t.exitReason === 'SL' ? 'bg-red-500/15 text-red-400' : t.exitReason === 'EOD' ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-700 text-slate-400'
                        }`}>{t.exitReason || 'ACTIVE'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-400">{fmtDuration(t.durationMinutes)}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-cyan-400 font-mono">{t.confidence != null ? `${Math.round(t.confidence)}%` : <span className="text-slate-500 italic">DM</span>}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fmtTime(t.exitTime || t.entryTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile card layout */}
              <div className="lg:hidden space-y-2 p-2">
                {filteredTrades.map(t => (
                  <div key={t.tradeId} className="bg-slate-800/50 rounded-lg border border-slate-700/50 overflow-hidden">
                    <button onClick={() => setExpandedTrade(expandedTrade === t.tradeId ? null : t.tradeId)} className="w-full text-left p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-xs font-bold ${t.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{t.side === 'LONG' ? 'L' : 'S'}</span>
                          <span className="text-sm font-medium text-white truncate">{t.companyName || t.scripCode}</span>
                          <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${getStrategyBadgeClass(t.strategy)}`}>{t.strategy}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-sm font-bold font-mono ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(t.pnl)}</span>
                          {expandedTrade === t.tradeId ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                        <span>{t.instrumentType === 'OPTIONS' ? 'OPT' : t.instrumentType === 'FUTURES' ? 'FUT' : 'EQ'}</span>
                        <span>·</span>
                        <span>{t.exchange === 'N' ? 'NSE' : t.exchange === 'M' ? 'MCX' : 'CDS'}</span>
                        <span>·</span>
                        <span className={`font-medium ${(t.exitReason ?? '').startsWith('T') ? 'text-emerald-400' : t.exitReason === 'SL' ? 'text-red-400' : 'text-amber-400'}`}>{t.exitReason || 'ACTIVE'}</span>
                        <span className="ml-auto">{fmtTime(t.exitTime || t.entryTime)}</span>
                      </div>
                    </button>
                    {expandedTrade === t.tradeId && (
                      <div className="border-t border-slate-700 p-3 space-y-2">
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div><span className="text-slate-500 text-[10px]">Entry</span><div className="font-mono text-white">{fmt(t.entryPrice)}</div></div>
                          <div><span className="text-slate-500 text-[10px]">Exit</span><div className="font-mono text-white">{t.exitPrice ? fmt(t.exitPrice) : 'Active'}</div></div>
                          <div><span className="text-slate-500 text-[10px]">P&L%</span><div className={`font-mono ${t.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(t.pnlPercent, 1)}%</div></div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div><span className="text-slate-500 text-[10px]">R-Multiple</span><div className="font-mono text-white">{t.rMultiple != null ? `${fmt(t.rMultiple)}R` : 'DM'}</div></div>
                          <div><span className="text-slate-500 text-[10px]">Duration</span><div className="text-white">{fmtDuration(t.durationMinutes)}</div></div>
                          <div><span className="text-slate-500 text-[10px]">Confidence</span><div className="font-mono text-cyan-400">{t.confidence != null ? `${Math.round(t.confidence)}%` : 'DM'}</div></div>
                        </div>
                        <div className="flex gap-1 mt-1">
                          {[{ hit: t.stopHit, label: 'SL' }, { hit: t.target1Hit, label: 'T1' }, { hit: t.target2Hit, label: 'T2' }, { hit: t.target3Hit, label: 'T3' }, { hit: t.target4Hit, label: 'T4' }].map(({ hit, label }) => (
                            <span key={label} className={`flex-1 text-center py-1 rounded text-[10px] font-bold ${hit ? label === 'SL' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>{label}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-slate-500">
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No trades found</p>
              <p className="text-[10px] mt-1 text-slate-600">Adjust filters or wait for new trades</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Deep Analytics View — correlation matrix, scatter plots, hour performance, parameter zones */
function DeepAnalyticsView({ analytics, advAnalytics }: {
  analytics: ReturnType<typeof computeAnalytics>
  advAnalytics: ReturnType<typeof computeAdvancedAnalytics>
}) {
  const [activeScatter, setActiveScatter] = useState<string | null>(null)

  if (!analytics || !advAnalytics) {
    return (
      <div className="card text-center py-16 text-slate-500">
        <Activity className="w-12 h-12 mx-auto mb-3 opacity-40" />
        <p className="text-sm">Need at least 3 closed trades with signal metrics for deep analysis</p>
        <p className="text-[10px] mt-1 text-slate-600">Signal metrics (ATR, Volume Surge, OI Change%, etc.) are recorded for new trades going forward</p>
      </div>
    )
  }

  const { correlations, scatterData, parameterZones, metrics: metricDefs } = advAnalytics
  const hasSignalMetrics = correlations.some(c => c.n > 0 && ['atr', 'volumeSurge', 'oiChangePercent', 'blockDealPercent', 'riskReward'].includes(c.key))

  return (
    <div className="space-y-5">
      {/* Streaks + Hour performance row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Streaks & Edge stats */}
        <div className="card">
          <div className="text-sm font-semibold text-slate-300 mb-3">Trading Edge & Streaks</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className={`text-xl font-bold ${analytics.streaks.current >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {analytics.streaks.current >= 0 ? '+' : ''}{analytics.streaks.current}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Current Streak</div>
            </div>
            <div className="bg-emerald-500/10 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-emerald-400">+{analytics.streaks.best}</div>
              <div className="text-[10px] text-slate-500 mt-1">Best Win Streak</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-red-400">{analytics.streaks.worst}</div>
              <div className="text-[10px] text-slate-500 mt-1">Worst Loss Streak</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-[10px] text-slate-500">Expectancy per Trade</div>
              <div className={`text-lg font-bold font-mono ${analytics.totalPnl / analytics.totalTrades >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtINR(analytics.totalPnl / analytics.totalTrades)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-[10px] text-slate-500">Win/Loss Ratio</div>
              <div className={`text-lg font-bold font-mono ${Math.abs(analytics.avgWin) / Math.abs(analytics.avgLoss || 1) >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                {Math.abs(analytics.avgLoss) > 0 ? fmt(Math.abs(analytics.avgWin) / Math.abs(analytics.avgLoss), 2) : '∞'}x
              </div>
            </div>
          </div>
        </div>

        {/* Hour of Day Performance */}
        <div className="card">
          <div className="text-sm font-semibold text-slate-300 mb-3">Performance by Hour (IST)</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={Object.entries(analytics.byHour).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, d]) => ({
                hour: `${h}:00`,
                pnl: Math.round(d.pnl),
                winRate: d.count > 0 ? Math.round((d.wins / d.count) * 100) : 0,
                count: d.count,
              }))} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(value: number, name: string) => [name === 'pnl' ? fmtINR(value) : `${value}%`, name === 'pnl' ? 'P&L' : 'Win Rate']}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {Object.entries(analytics.byHour).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, d]) => (
                    <Cell key={h} fill={d.pnl >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(analytics.byHour).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, d]) => (
              <div key={h} className="text-[9px] text-center bg-slate-800 rounded px-1.5 py-0.5">
                <span className="text-slate-500">{h}h</span>{' '}
                <span className={d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{d.count}T/{Math.round((d.wins / d.count) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Correlation Matrix */}
      <div className="card">
        <div className="text-sm font-semibold text-slate-300 mb-1">Correlation Matrix — Metric vs P&L%</div>
        <div className="text-[10px] text-slate-500 mb-3">
          Values show Pearson correlation coefficient (-1 to +1). Strong positive = metric rising improves P&L.
          {!hasSignalMetrics && <span className="text-amber-400 ml-1">Signal metrics (ATR, Vol Surge, OI%, Block%) will populate as new trades are recorded.</span>}
        </div>
        <div className="overflow-x-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {correlations.map(c => (
              <button
                key={c.key}
                onClick={() => scatterData[c.key] && setActiveScatter(activeScatter === c.key ? null : c.key)}
                className={`rounded-lg p-3 text-center transition-all border ${
                  activeScatter === c.key ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700/50 hover:border-slate-600'
                } ${corrBg(c.corr)}`}
              >
                <div className="text-[10px] text-slate-400 mb-1 truncate">{c.label}</div>
                <div className={`text-lg font-bold font-mono ${corrColor(c.corr)}`}>
                  {c.corr !== null ? (c.corr >= 0 ? '+' : '') + c.corr.toFixed(2) : 'DM'}
                </div>
                <div className="text-[9px] text-slate-600 mt-0.5">{c.n} samples</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scatter Plot (when a metric is selected) */}
      {activeScatter && scatterData[activeScatter] && (
        <div className="card">
          <div className="text-sm font-semibold text-slate-300 mb-3">
            {correlations.find(c => c.key === activeScatter)?.label} vs P&L%
            <span className="text-[10px] text-slate-500 ml-2">
              r = {correlations.find(c => c.key === activeScatter)?.corr?.toFixed(3) ?? 'DM'}
              {' · '}{scatterData[activeScatter].length} trades
            </span>
          </div>
          <div className="h-64 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="x" type="number" name={correlations.find(c => c.key === activeScatter)?.label}
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  label={{ value: correlations.find(c => c.key === activeScatter)?.label, position: 'bottom', fill: '#64748b', fontSize: 11 }}
                />
                <YAxis
                  dataKey="y" type="number" name="P&L%"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  label={{ value: 'P&L%', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                  formatter={(value: number, name: string) => [
                    name === 'P&L%' ? `${value.toFixed(2)}%` : value.toFixed(2),
                    name
                  ]}
                  labelFormatter={() => ''}
                />
                <Scatter
                  data={scatterData[activeScatter]}
                  fill="#6366f1"
                  fillOpacity={0.7}
                  shape={(props: unknown) => {
                    const p = props as { cx: number; cy: number; payload?: { y?: number } }
                    const isWin = (p.payload?.y ?? 0) >= 0
                    return <circle cx={p.cx} cy={p.cy} r={4} fill={isWin ? '#10b981' : '#ef4444'} fillOpacity={0.7} stroke={isWin ? '#059669' : '#dc2626'} strokeWidth={1} />
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Parameter Optimization Zones */}
      {Object.keys(parameterZones).length > 0 && (
        <div className="card">
          <div className="text-sm font-semibold text-slate-300 mb-1">Parameter Optimization Zones</div>
          <div className="text-[10px] text-slate-500 mb-3">Quartile breakdown: which parameter ranges produce the best results?</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Object.entries(parameterZones).map(([key, zones]) => {
              const label = metricDefs?.find(m => m.key === key)?.label ?? key
              const bestZone = zones.reduce((best, z) => z.avgPnl > best.avgPnl ? z : best, zones[0])
              return (
                <div key={key} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <div className="text-xs font-semibold text-slate-300 mb-2">{label}</div>
                  <div className="space-y-1.5">
                    {zones.map(z => {
                      const isBest = z === bestZone && z.avgPnl > 0
                      return (
                        <div key={z.zone} className={`flex items-center gap-2 ${isBest ? 'bg-emerald-500/10 rounded px-1.5 py-0.5' : ''}`}>
                          <span className="text-[10px] font-mono text-cyan-400 w-24 shrink-0">{z.zone}</span>
                          <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${z.winRate >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.min(z.winRate, 100)}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-400 w-14 text-right">{z.count}T · {fmt(z.winRate, 0)}%</span>
                          <span className={`text-[10px] font-mono w-16 text-right ${z.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(z.avgPnl)}</span>
                          {isBest && <span className="text-[8px] text-emerald-400 font-bold">BEST</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Strategy Insights Summary */}
      <div className="card bg-gradient-to-br from-slate-800/80 to-indigo-900/20 border-indigo-500/20">
        <div className="text-sm font-semibold text-indigo-300 mb-3">Strategy Health Summary</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <InsightCard
            title="Edge Quality"
            value={analytics.profitFactor === Infinity ? '∞' : fmt(analytics.profitFactor, 2)}
            label="Profit Factor"
            status={analytics.profitFactor > 1.5 ? 'good' : analytics.profitFactor > 1 ? 'neutral' : 'bad'}
            hint={analytics.profitFactor > 1.5 ? 'Strong edge — keep current approach' : analytics.profitFactor > 1 ? 'Marginal edge — tighten parameters' : 'Negative edge — needs parameter overhaul'}
          />
          <InsightCard
            title="Risk Management"
            value={fmtINR(analytics.maxDrawdown)}
            label="Max Drawdown"
            status={analytics.maxDrawdown < Math.abs(analytics.totalPnl) * 0.5 ? 'good' : analytics.maxDrawdown < Math.abs(analytics.totalPnl) ? 'neutral' : 'bad'}
            hint={analytics.maxDrawdown < Math.abs(analytics.totalPnl) * 0.5 ? 'Drawdown well controlled' : 'Drawdown too high relative to returns'}
          />
          <InsightCard
            title="Consistency"
            value={`${fmt(analytics.winRate, 1)}%`}
            label="Win Rate"
            status={analytics.winRate >= 55 ? 'good' : analytics.winRate >= 45 ? 'neutral' : 'bad'}
            hint={analytics.winRate >= 55 ? 'Consistent hit rate' : analytics.winRate >= 45 ? 'Acceptable, focus on R improvement' : 'Low win rate — check entry filters'}
          />
          <InsightCard
            title="Reward Quality"
            value={`${analytics.avgR >= 0 ? '+' : ''}${fmt(analytics.avgR, 2)}R`}
            label="Avg R-Multiple"
            status={analytics.avgR >= 0.5 ? 'good' : analytics.avgR >= 0 ? 'neutral' : 'bad'}
            hint={analytics.avgR >= 0.5 ? 'Good reward capture' : analytics.avgR >= 0 ? 'Marginal — let winners run more' : 'Cutting winners too early'}
          />
        </div>
      </div>
    </div>
  )
}

/** Insight card for strategy health */
function InsightCard({ title, value, label, status, hint }: { title: string; value: string; label: string; status: 'good' | 'neutral' | 'bad'; hint: string }) {
  const statusColors = { good: 'border-emerald-500/30 bg-emerald-500/5', neutral: 'border-amber-500/30 bg-amber-500/5', bad: 'border-red-500/30 bg-red-500/5' }
  const statusDot = { good: 'bg-emerald-400', neutral: 'bg-amber-400', bad: 'bg-red-400' }
  const valueColor = { good: 'text-emerald-400', neutral: 'text-amber-400', bad: 'text-red-400' }
  return (
    <div className={`rounded-lg p-3 border ${statusColors[status]}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <div className={`w-2 h-2 rounded-full ${statusDot[status]}`} />
        <span className="text-[10px] text-slate-400 font-semibold uppercase">{title}</span>
      </div>
      <div className={`text-lg font-bold font-mono ${valueColor[status]}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">{hint}</div>
    </div>
  )
}

/** Small metric cell for wallet summary */
function MetricCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-slate-700/30 rounded-lg p-2.5 sm:p-3">
      <div className="text-[10px] sm:text-xs text-slate-400 mb-0.5">{label}</div>
      <div className={`text-sm sm:text-lg font-semibold truncate ${color || 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  )
}

/** Analytics stat card */
function StatCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-3 text-center">
      <div className={`text-lg sm:text-xl font-bold ${positive === undefined ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'}`}>{value}</div>
      <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}
