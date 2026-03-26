import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { BarChart3, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import { strategyWalletsApi } from '../services/api'
import type { StrategyWalletSummary, StrategyWalletTrade } from '../services/api'
import { getStrategyColors, getStrategyBadgeClass } from '../utils/strategyColors'
import { fmt, fmtINR, fmtDuration } from '../utils/tradeAnalytics'

type StrategyTab = 'ALL' | string
type ResultFilter = 'ALL' | 'WIN' | 'LOSS'
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C'

// Display order for strategy tabs — strategies not in this list appear at end.
// Actual strategy names come from backend API (StrategyNameResolver is single source of truth).
const STRATEGY_DISPLAY_ORDER = ['FUKAA', 'FUDKOI', 'FUDKII', 'PIVOT', 'MICROALPHA', 'MERE', 'QUANT', 'MCX-BB-15', 'MCX-BB-30', 'NSE-BB-30']

const fmtTime = (ts: string) => {
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) + ', ' +
      d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
  } catch { return 'DM' }
}

// ── Period helpers ──
type PeriodKey = 'TODAY' | '1W' | '1M' | 'QTR' | '1Y' | 'ALL' | 'DATE'

/** Indian fiscal quarters: Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar */
function getQuarterStart(d: Date): Date {
  const m = d.getMonth() // 0-based
  let qMonth: number
  if (m >= 3 && m <= 5) qMonth = 3      // Apr
  else if (m >= 6 && m <= 8) qMonth = 6  // Jul
  else if (m >= 9 && m <= 11) qMonth = 9 // Oct
  else qMonth = 0                        // Jan
  const year = qMonth === 0 ? d.getFullYear() : d.getFullYear()
  return new Date(year, qMonth, 1)
}

function periodToRange(key: PeriodKey, customDate?: string): { from?: number; to?: number } {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  // Build "today 00:00 IST" in UTC
  const istNow = new Date(now.getTime() + istOffset)
  const todayIST = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffset)

  switch (key) {
    case 'TODAY': return { from: todayIST.getTime() }
    case '1W': return { from: todayIST.getTime() - 7 * 86400000 }
    case '1M': return { from: todayIST.getTime() - 30 * 86400000 }
    case 'QTR': {
      const qs = getQuarterStart(istNow)
      const utcQs = new Date(Date.UTC(qs.getFullYear(), qs.getMonth(), qs.getDate()) - istOffset)
      return { from: utcQs.getTime() }
    }
    case '1Y': return { from: todayIST.getTime() - 365 * 86400000 }
    case 'DATE': {
      if (!customDate) return { from: todayIST.getTime() }
      const [y, m, d] = customDate.split('-').map(Number)
      const dayStart = new Date(Date.UTC(y, m - 1, d) - istOffset)
      return { from: dayStart.getTime(), to: dayStart.getTime() + 86400000 }
    }
    case 'ALL':
    default: return {}
  }
}

const PERIOD_LABELS: Record<PeriodKey, string> = {
  TODAY: 'Today', '1W': '1 Week', '1M': '1 Month', QTR: 'Quarter', '1Y': '1 Year', ALL: 'All Time', DATE: 'Pick Date'
}

// Hourly range options
const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 9) // 9..24

export default function TradesPage() {
  const [summaries, setSummaries] = useState<StrategyWalletSummary[]>([])
  const [trades, setTrades] = useState<StrategyWalletTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStrategy, setActiveStrategy] = useState<StrategyTab>('ALL')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('ALL')
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL')
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodKey>('ALL')
  const [customDate, setCustomDate] = useState<string>(() => {
    const now = new Date()
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
    return ist.toISOString().slice(0, 10)
  })
  const [hourFrom, setHourFrom] = useState<number | null>(null)
  const [hourTo, setHourTo] = useState<number | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = useCallback(async (p: PeriodKey, date?: string) => {
    try {
      const range = periodToRange(p, date)
      const [sums, allTrades] = await Promise.all([
        strategyWalletsApi.getSummaries().catch(() => []),
        strategyWalletsApi.getWeeklyTrades({ limit: 5000, ...range }).catch(() => []),
      ])
      setSummaries(sums)
      setTrades(allTrades)
    } catch (e) {
      console.error('Failed to load trades:', e)
    }
  }, [])

  // Initial load — all time
  useEffect(() => {
    loadData(period, customDate).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when period or date changes
  useEffect(() => {
    if (!loading) {
      setLoading(true)
      loadData(period, customDate).finally(() => setLoading(false))
    }
  }, [period, customDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time: listen for trade-outcome events from WebSocket and refresh
  useEffect(() => {
    const handler = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => loadData(period, customDate), 1000)
    }
    window.addEventListener('trade-outcome', handler)
    return () => {
      window.removeEventListener('trade-outcome', handler)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [loadData, period, customDate])

  // Dynamic strategy keys: known order first, then any new strategies from trades
  const STRATEGY_KEYS = useMemo(() => {
    const fromSummaries = summaries.map(s => s.strategy).filter(Boolean)
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const k of STRATEGY_DISPLAY_ORDER) {
      if (fromSummaries.includes(k) && !seen.has(k)) { ordered.push(k); seen.add(k) }
    }
    for (const k of fromSummaries) {
      if (!seen.has(k) && k !== 'MANUAL') { ordered.push(k); seen.add(k) }
    }
    return ordered
  }, [summaries])

  // Filter trades — strategy, result, exchange, hour range (all client-side)
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (activeStrategy !== 'ALL' && t.strategy !== activeStrategy) return false
      if (resultFilter === 'WIN' && t.pnl <= 0) return false
      if (resultFilter === 'LOSS' && t.pnl >= 0) return false
      if (exchangeFilter !== 'ALL' && t.exchange !== exchangeFilter) return false
      // Hour range filter
      if (hourFrom !== null || hourTo !== null) {
        try {
          const d = new Date(t.entryTime)
          const istH = parseInt(d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }))
          if (hourFrom !== null && istH < hourFrom) return false
          if (hourTo !== null && istH > hourTo) return false
        } catch { return false }
      }
      return true
    }).sort((a, b) => new Date(b.exitTime || b.entryTime).getTime() - new Date(a.exitTime || a.entryTime).getTime())
  }, [trades, activeStrategy, resultFilter, exchangeFilter, hourFrom, hourTo])

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
      <div className="space-y-2">
        {/* Row 1: Period + Result + Exchange */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Period filter */}
          {(['TODAY', '1W', '1M', 'QTR', '1Y', 'ALL'] as PeriodKey[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                period === p ? 'bg-indigo-600 text-white border border-indigo-500' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
              }`}
            >{PERIOD_LABELS[p]}</button>
          ))}
          <input
            type="date"
            value={period === 'DATE' ? customDate : ''}
            onChange={e => {
              setCustomDate(e.target.value)
              setPeriod('DATE')
            }}
            onClick={() => { if (period !== 'DATE') setPeriod('DATE') }}
            max={new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)}
            className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
              period === 'DATE'
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
        </div>
        {/* Row 2: Hour range */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-slate-500 font-medium">Hour (IST):</span>
          <select value={hourFrom ?? ''} onChange={e => setHourFrom(e.target.value ? Number(e.target.value) : null)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-300 focus:border-indigo-500 outline-none">
            <option value="">From</option>
            {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}:00</option>)}
          </select>
          <span className="text-slate-600 text-[10px]">—</span>
          <select value={hourTo ?? ''} onChange={e => setHourTo(e.target.value ? Number(e.target.value) : null)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-300 focus:border-indigo-500 outline-none">
            <option value="">To</option>
            {HOUR_OPTIONS.map(h => <option key={h} value={h}>{h}:00</option>)}
          </select>
          {(hourFrom !== null || hourTo !== null) && (
            <button onClick={() => { setHourFrom(null); setHourTo(null) }}
              className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30">
              Clear
            </button>
          )}
          {hourFrom !== null && hourTo !== null && hourFrom <= hourTo && (
            <span className="text-[10px] text-slate-500">
              Showing {hourFrom}:00 – {hourTo}:00 IST
            </span>
          )}
        </div>
      </div>

      {/* Trades Table */}
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
