import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { strategyWalletsApi } from '../services/api'
import type { StrategyWalletSummary, StrategyWalletTrade } from '../services/api'
import { getStrategyColors } from '../utils/strategyColors'
import { computeAnalytics, computeAdvancedAnalytics, fmt, fmtINR } from '../utils/tradeAnalytics'
import AnalyticsView from '../components/AnalyticsView'
import DeepAnalyticsView from '../components/DeepAnalyticsView'
import type { Trade } from '../types'

type PnlTab = 'analytics' | 'deep'
type StrategyTab = 'ALL' | string
type ResultFilter = 'ALL' | 'WIN' | 'LOSS'
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C'

// Known strategies in display order
const KNOWN_STRATEGIES = ['FUDKII', 'FUKAA', 'FUDKOI', 'PIVOT', 'MICROALPHA', 'MERE', 'QUANT', 'MCX-BB', 'MCX-BBT+1']

// ── Period helpers for analytics tabs ──
type AnalyticsPeriod = 'TODAY' | '1W' | '1M' | 'QTR' | '1Y' | 'ALL' | 'DATE'

function getQuarterStart(d: Date): Date {
  const m = d.getMonth()
  let qMonth: number
  if (m >= 3 && m <= 5) qMonth = 3
  else if (m >= 6 && m <= 8) qMonth = 6
  else if (m >= 9 && m <= 11) qMonth = 9
  else qMonth = 0
  return new Date(d.getFullYear(), qMonth, 1)
}

// PnL analytics reset date — ignore all trade_outcomes before this date.
// Change this when strategies/wallets are reset. Later: per-strategy reset dates.
const PNL_RESET_DATE_IST = '2026-03-19' // YYYY-MM-DD in IST

function getPnlResetTimestamp(): number {
  const [y, m, d] = PNL_RESET_DATE_IST.split('-').map(Number)
  const istOffset = 5.5 * 60 * 60 * 1000
  return new Date(Date.UTC(y, m - 1, d) - istOffset).getTime()
}

function analyticsPeriodToRange(key: AnalyticsPeriod, customDate?: string): { from?: number; to?: number } {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  const todayIST = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffset)
  const resetTs = getPnlResetTimestamp()

  // Clamp: never go before the reset date
  const clamp = (ts: number) => Math.max(ts, resetTs)

  switch (key) {
    case 'TODAY': return { from: clamp(todayIST.getTime()) }
    case '1W': return { from: clamp(todayIST.getTime() - 7 * 86400000) }
    case '1M': return { from: clamp(todayIST.getTime() - 30 * 86400000) }
    case 'QTR': {
      const qs = getQuarterStart(istNow)
      const utcQs = new Date(Date.UTC(qs.getFullYear(), qs.getMonth(), qs.getDate()) - istOffset)
      return { from: clamp(utcQs.getTime()) }
    }
    case '1Y': return { from: clamp(todayIST.getTime() - 365 * 86400000) }
    case 'DATE': {
      if (!customDate) return { from: clamp(todayIST.getTime()) }
      const [y, m, d] = customDate.split('-').map(Number)
      const dayStart = new Date(Date.UTC(y, m - 1, d) - istOffset)
      if (dayStart.getTime() < resetTs) return { from: resetTs, to: dayStart.getTime() + 86400000 }
      return { from: dayStart.getTime(), to: dayStart.getTime() + 86400000 }
    }
    case 'ALL':
    default: return { from: resetTs }
  }
}

const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  TODAY: 'Today', '1W': '1 Week', '1M': '1 Month', QTR: 'Quarter', '1Y': '1 Year', ALL: 'All Time', DATE: 'Pick Date'
}

export default function PnLDashboardPage() {
  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<PnlTab>('analytics')

  // ── Trade data state ──
  const [trades, setTrades] = useState<StrategyWalletTrade[]>([])
  const [summaries, setSummaries] = useState<StrategyWalletSummary[]>([])
  const [tradesLoading, setTradesLoading] = useState(false)
  const [tradesLoaded, setTradesLoaded] = useState(false)
  const [activeStrategy, setActiveStrategy] = useState<StrategyTab>('ALL')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('ALL')
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL')
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>('ALL')
  const [customDate, setCustomDate] = useState<string>(() => {
    const now = new Date()
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
    return ist.toISOString().slice(0, 10)
  })

  // Track last-known trade count to detect new exits
  const lastTradeCountRef = useRef<number>(-1)

  // ── Full trade data loading (on mount, period change, or trade exit detected) ──
  const loadTradeData = useCallback(async (p: AnalyticsPeriod, date?: string, isAutoRefresh = false) => {
    if (!isAutoRefresh) setTradesLoading(true)
    try {
      const range = analyticsPeriodToRange(p, date)
      const [sums, allTrades] = await Promise.all([
        strategyWalletsApi.getSummaries().catch(() => []),
        strategyWalletsApi.getWeeklyTrades({ limit: 5000, ...range }).catch(() => []),
      ])
      setSummaries(sums)
      setTrades(allTrades)
      setTradesLoaded(true)
      lastTradeCountRef.current = sums.reduce((s: number, w: StrategyWalletSummary) => s + w.totalTrades, 0)
    } catch (e) {
      console.error('Failed to load trade data for analytics:', e)
    }
    if (!isAutoRefresh) setTradesLoading(false)
  }, [])

  // ── Smart refresh: poll summaries every 30s, reload trades only when a trade exits ──
  useEffect(() => {
    loadTradeData(analyticsPeriod, customDate)
    const interval = setInterval(async () => {
      try {
        const sums = await strategyWalletsApi.getSummaries().catch(() => [])
        if (sums.length === 0) return
        const newCount = sums.reduce((s: number, w: StrategyWalletSummary) => s + w.totalTrades, 0)
        // Always update summaries (for live unrealizedPnl / wallet stats)
        setSummaries(sums)
        // Full trade reload only when trade count changed (a trade exited)
        if (lastTradeCountRef.current >= 0 && newCount !== lastTradeCountRef.current) {
          lastTradeCountRef.current = newCount
          const range = analyticsPeriodToRange(analyticsPeriod, customDate)
          const allTrades = await strategyWalletsApi.getWeeklyTrades({ limit: 5000, ...range }).catch(() => [])
          setTrades(allTrades)
        }
      } catch { /* silent */ }
    }, 30000)
    return () => clearInterval(interval)
  }, [analyticsPeriod, customDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dynamic strategy keys ──
  const STRATEGY_KEYS = useMemo(() => {
    const fromTrades = new Set(trades.map(t => t.strategy).filter(Boolean))
    const fromSummaries = new Set(summaries.map(s => s.strategy).filter(Boolean))
    const all = new Set([...fromTrades, ...fromSummaries])
    const ordered = KNOWN_STRATEGIES.filter(k => all.has(k))
    for (const k of all) {
      if (!ordered.includes(k) && k !== 'MANUAL') ordered.push(k)
    }
    return ordered
  }, [trades, summaries])

  // ── Filtered trades for analytics ──
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
      pnl: t.pnl, pnlPercent: t.pnlPercent, rMultiple: t.rMultiple ?? (t as any).rmultiple ?? 0, durationMinutes: t.durationMinutes ?? 0,
      strategy: t.strategy, executionMode: t.executionMode,
      // Pass through target/exit data for streak analysis
      target1Hit: t.target1Hit, target2Hit: t.target2Hit, target3Hit: t.target3Hit, target4Hit: t.target4Hit,
      exitReason: t.exitReason, target2: t.target2, instrumentType: t.instrumentType,
    } as Trade))
  }, [filteredTrades])

  const activeSummary = activeStrategy === 'ALL' ? null : summaries.find(s => s.strategy === activeStrategy)

  // Live drawdown: realized P&L peak vs (realized + unrealized) current equity
  const liveDrawdown = useMemo(() => {
    const relevantSummaries = activeStrategy === 'ALL'
      ? summaries
      : summaries.filter(s => s.strategy === activeStrategy)
    const totalUnrealized = relevantSummaries.reduce((s, w) => s + (w.unrealizedPnl ?? 0), 0)
    if (totalUnrealized === 0 || !analytics) return null
    // Current equity = realized cumulative P&L + unrealized
    const currentEquity = analytics.totalPnl + totalUnrealized
    // If current equity dips below the realized peak, that's live drawdown
    const realizedPeak = analytics.totalPnl > 0 ? analytics.totalPnl : 0
    if (currentEquity < realizedPeak) {
      return realizedPeak - currentEquity
    }
    return null
  }, [summaries, activeStrategy, analytics])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-display font-bold text-white">P&L Analytics</h1>
          {/* Tab Selector */}
          <div className="flex bg-slate-800 rounded-lg p-1">
            {([
              { key: 'analytics' as PnlTab, label: 'Analytics' },
              { key: 'deep' as PnlTab, label: 'Deep Analysis' },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  activeTab === tab.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
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
                const c = getStrategyColors(key)
                const isActive = activeStrategy === key
                const stratTrades = trades.filter(t => t.strategy === key)
                const closedStrat = stratTrades.filter(t => t.exitTime)
                const count = stratTrades.length
                const stratPnl = closedStrat.reduce((s, t) => s + t.pnl, 0)
                const stratWinRate = closedStrat.length > 0
                  ? (closedStrat.filter(t => t.pnl > 0).length / closedStrat.length) * 100 : 0
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
                    {closedStrat.length > 0 && (
                      <div className={`text-[10px] mt-0.5 ${stratPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtINR(stratPnl)} ({fmt(stratWinRate, 0)}%)
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Period filter */}
            {(['TODAY', '1W', '1M', 'QTR', '1Y', 'ALL'] as AnalyticsPeriod[]).map(p => (
              <button key={p} onClick={() => setAnalyticsPeriod(p)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  analyticsPeriod === p ? 'bg-indigo-600 text-white border border-indigo-500' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                }`}
              >{ANALYTICS_PERIOD_LABELS[p]}</button>
            ))}
            <input
              type="date"
              value={analyticsPeriod === 'DATE' ? customDate : ''}
              onChange={e => {
                setCustomDate(e.target.value)
                setAnalyticsPeriod('DATE')
              }}
              onClick={() => { if (analyticsPeriod !== 'DATE') setAnalyticsPeriod('DATE') }}
              max={new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                analyticsPeriod === 'DATE'
                  ? 'bg-indigo-600 text-white border border-indigo-500'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
              } [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-60`}
            />
            <span className="w-px h-5 bg-slate-700 mx-0.5" />
            {/* Result filter */}
            {(['ALL', 'WIN', 'LOSS'] as ResultFilter[]).map(f => (
              <button key={f} onClick={() => setResultFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  resultFilter === f
                    ? f === 'WIN' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : f === 'LOSS' ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-blue-600 text-white border border-blue-500'
                    : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                }`}
              >{f === 'ALL' ? 'All' : f === 'WIN' ? 'Winners' : 'Losers'}</button>
            ))}
            <span className="w-px h-5 bg-slate-700 mx-0.5" />
            {/* Exchange filter */}
            {(['ALL', 'N', 'M', 'C'] as ExchangeFilter[]).map(f => (
              <button key={f} onClick={() => setExchangeFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  exchangeFilter === f
                    ? f === 'N' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                      : f === 'M' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : f === 'C' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                      : 'bg-blue-600 text-white border border-blue-500'
                    : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                }`}
              >{f === 'ALL' ? 'All Exch' : f === 'N' ? 'NSE' : f === 'M' ? 'MCX' : 'CDS'}</button>
            ))}
            {tradesLoading && <span className="text-[10px] text-slate-500 animate-pulse ml-2">Loading trades...</span>}
          </div>

      {/* ═══ Tab Content ═══ */}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        tradesLoading && !tradesLoaded ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-slate-800 rounded-xl animate-pulse" />)}
            </div>
            <div className="h-64 bg-slate-800 rounded-xl animate-pulse" />
          </div>
        ) : (
          <AnalyticsView
            analytics={analytics}
            chartsData={chartsData}
            initialCapital={activeSummary?.initialCapital ?? 1000000}
            activeStrategy={activeStrategy}
            liveDrawdown={liveDrawdown ?? undefined}
            unrealizedPnl={(activeStrategy === 'ALL'
              ? summaries.reduce((s, w) => s + (w.unrealizedPnl ?? 0), 0)
              : activeSummary?.unrealizedPnl) ?? undefined}
          />
        )
      )}

      {/* Deep Analysis Tab */}
      {activeTab === 'deep' && (
        tradesLoading && !tradesLoaded ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="h-64 bg-slate-800 rounded-xl animate-pulse" />
              <div className="h-64 bg-slate-800 rounded-xl animate-pulse" />
            </div>
          </div>
        ) : (
          <DeepAnalyticsView analytics={analytics} advAnalytics={advAnalytics} />
        )
      )}
    </div>
  )
}
