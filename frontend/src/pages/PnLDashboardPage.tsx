import { useState, useEffect } from 'react'
import { fetchJson, putJson } from '../services/api'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

type WalletType = 'PAPER' | 'REAL'
type Period = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL'

interface PnlSummary {
  initialCapital: number
  currentCapital: number
  realizedPnl: number
  unrealizedPnl: number
  dayPnl: number
  weekPnl: number
  monthPnl: number
  totalTradesCount: number
  winCount: number
  lossCount: number
  winRate: number
}

interface AdvancedMetrics {
  sharpeRatio: number
  maxDrawdown: number
  maxDrawdownAmount: number
  profitFactor: number
  expectancy: number
  avgRMultiple: number
  avgWin: number
  avgLoss: number
  bestTrade: number
  worstTrade: number
}

interface DailyPnl {
  date: string
  pnl: number
  cumulative: number
  trades: number
}

interface InstrumentPnl {
  scripCode: string
  companyName: string
  totalPnl: number
  trades: number
  winRate: number
}

interface StrategyPnl {
  strategy: string
  totalPnl: number
  trades: number
  winRate: number
}

interface TradeEntry {
  id: string
  tradeId: string
  scripCode: string
  companyName: string
  side: string
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  pnlPercent: number
  rMultiple: number
  exitReason: string
  entryTime: string
  exitTime: string
  durationMinutes: number
  strategy: string
  notes: string
  tags: string[]
  status: string
}

export default function PnLDashboardPage() {
  const [walletType, setWalletType] = useState<WalletType>('PAPER')
  const [period, setPeriod] = useState<Period>('1M')
  const [summary, setSummary] = useState<PnlSummary | null>(null)
  const [metrics, setMetrics] = useState<AdvancedMetrics | null>(null)
  const [equityCurve, setEquityCurve] = useState<DailyPnl[]>([])
  const [calendarData, setCalendarData] = useState<Record<string, number>>({})
  const [instruments, setInstruments] = useState<InstrumentPnl[]>([])
  const [strategies, setStrategies] = useState<StrategyPnl[]>([])
  const [journal, setJournal] = useState<TradeEntry[]>([])
  const [journalPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesText, setNotesText] = useState('')

  // Period days mapping for future use with daily PnL endpoint
  const _periodDays: Record<Period, number> = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 9999 }
  void _periodDays

  useEffect(() => {
    loadData()
  }, [walletType, period])

  useEffect(() => {
    loadJournal()
  }, [walletType, journalPage])

  const loadData = async () => {
    setLoading(true)
    const wt = walletType

    try {
      const [summaryData, metricsData, curveData, calData, instData, stratData] = await Promise.allSettled([
        fetchJson<PnlSummary>(`/pnl/summary?walletType=${wt}`),
        fetchJson<AdvancedMetrics>(`/pnl/metrics?walletType=${wt}`),
        fetchJson<DailyPnl[]>(`/pnl/equity-curve?walletType=${wt}`),
        fetchJson<Record<string, number>>(`/pnl/calendar?walletType=${wt}&year=${new Date().getFullYear()}`),
        fetchJson<InstrumentPnl[]>(`/pnl/by-instrument?walletType=${wt}`),
        fetchJson<StrategyPnl[]>(`/pnl/by-strategy?walletType=${wt}`),
      ])

      if (summaryData.status === 'fulfilled') setSummary(summaryData.value)
      if (metricsData.status === 'fulfilled') setMetrics(metricsData.value)
      if (curveData.status === 'fulfilled') setEquityCurve(curveData.value)
      if (calData.status === 'fulfilled') setCalendarData(calData.value)
      if (instData.status === 'fulfilled') setInstruments(instData.value)
      if (stratData.status === 'fulfilled') setStrategies(stratData.value)
    } catch { /* ignore partial failures */ }
    setLoading(false)
  }

  const loadJournal = async () => {
    try {
      const data = await fetchJson<{ content: TradeEntry[] }>(`/pnl/trade-journal?walletType=${walletType}&page=${journalPage}&size=20`)
      setJournal(data.content || [])
    } catch {
      setJournal([])
    }
  }

  const handleSaveNotes = async (tradeId: string) => {
    try {
      await putJson(`/pnl/trade-journal/${tradeId}/notes`, { notes: notesText })
      setEditingNotes(null)
      loadJournal()
    } catch { /* ignore */ }
  }

  const formatCurrency = (n: number) => {
    if (Math.abs(n) >= 100000) return (n >= 0 ? '+' : '') + (n / 100000).toFixed(1) + 'L'
    if (Math.abs(n) >= 1000) return (n >= 0 ? '+' : '') + (n / 1000).toFixed(1) + 'K'
    return (n >= 0 ? '+' : '') + n.toFixed(0)
  }

  const formatPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

  // Summary Cards
  const statCards = summary ? [
    { label: 'Total P&L', value: `₹${formatCurrency(summary.realizedPnl)}`, sub: formatPct((summary.realizedPnl / summary.initialCapital) * 100), positive: summary.realizedPnl >= 0 },
    { label: 'Win Rate', value: `${summary.winRate?.toFixed(1) || 0}%`, sub: `${summary.winCount}W / ${summary.lossCount}L`, positive: (summary.winRate || 0) >= 50 },
    { label: 'Sharpe Ratio', value: metrics?.sharpeRatio?.toFixed(2) || '-', sub: '', positive: (metrics?.sharpeRatio || 0) >= 1 },
    { label: 'Max Drawdown', value: metrics ? `${metrics.maxDrawdown?.toFixed(1)}%` : '-', sub: metrics ? `₹${formatCurrency(metrics.maxDrawdownAmount || 0)}` : '', positive: false },
    { label: 'Profit Factor', value: metrics?.profitFactor?.toFixed(1) || '-', sub: '', positive: (metrics?.profitFactor || 0) >= 1.5 },
  ] : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-white">P&L Analytics</h1>
        <div className="flex items-center gap-3">
          {/* Wallet Toggle */}
          <div className="flex bg-slate-800 rounded-lg p-1">
            {(['PAPER', 'REAL'] as WalletType[]).map(wt => (
              <button
                key={wt}
                onClick={() => setWalletType(wt)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  walletType === wt
                    ? wt === 'PAPER' ? 'bg-blue-500 text-white' : 'bg-amber-500 text-slate-900'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {wt === 'PAPER' ? '📝 Paper' : '💰 Real'}
              </button>
            ))}
          </div>
          {/* Period Selector */}
          <div className="flex bg-slate-800 rounded-lg p-1">
            {(['1W', '1M', '3M', '6M', '1Y', 'ALL'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  period === p ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {loading ? [...Array(5)].map((_, i) => (
          <div key={i} className="bg-slate-800/50 rounded-xl p-4 animate-pulse"><div className="h-16 bg-slate-700/30 rounded" /></div>
        )) : statCards.map((card, i) => (
          <div key={i} className={`bg-slate-800/50 backdrop-blur border rounded-xl p-4 ${
            card.positive ? 'border-emerald-500/20' : 'border-red-500/20'
          }`}>
            <p className="text-xs text-slate-400 mb-1">{card.label}</p>
            <p className={`text-2xl font-bold font-mono tabular-nums ${card.positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {card.value}
            </p>
            {card.sub && <p className="text-xs text-slate-500 mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Equity Curve */}
      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Equity Curve</h2>
        {equityCurve.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={equityCurve}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#f8fafc' }}
                formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, 'Cumulative P&L']}
              />
              <Area type="monotone" dataKey="cumulative" stroke="#10b981" fill="url(#equityGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-slate-500">No data available yet</div>
        )}
      </div>

      {/* Calendar Heatmap */}
      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Calendar Heatmap ({new Date().getFullYear()})</h2>
        <div className="flex flex-wrap gap-1">
          {Object.entries(calendarData).length > 0 ? (
            Object.entries(calendarData).map(([date, rawPnl]) => {
              const pnl = Number(rawPnl) || 0
              const intensity = Math.min(Math.abs(pnl) / 5000, 1)
              const color = pnl >= 0
                ? `rgba(16, 185, 129, ${0.2 + intensity * 0.6})`
                : `rgba(239, 68, 68, ${0.2 + intensity * 0.6})`
              return (
                <div
                  key={date}
                  className="w-3 h-3 rounded-sm cursor-pointer"
                  style={{ backgroundColor: color }}
                  title={`${date}: ₹${pnl.toFixed(0)}`}
                />
              )
            })
          ) : (
            <div className="w-full text-center text-slate-500 py-8">No trading data for this year</div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
          <span>Less</span>
          <div className="w-3 h-3 rounded-sm bg-red-500/30" />
          <div className="w-3 h-3 rounded-sm bg-red-500/60" />
          <div className="w-3 h-3 rounded-sm bg-slate-700" />
          <div className="w-3 h-3 rounded-sm bg-emerald-500/30" />
          <div className="w-3 h-3 rounded-sm bg-emerald-500/60" />
          <span>More</span>
        </div>
      </div>

      {/* Breakdowns Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Instrument */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">By Instrument</h2>
          {instruments.length > 0 ? (
            <div className="space-y-3">
              {instruments.slice(0, 10).map(inst => {
                const maxPnl = Math.max(...instruments.map(i => Math.abs(i.totalPnl)), 1)
                const width = (Math.abs(inst.totalPnl) / maxPnl) * 100
                return (
                  <div key={inst.scripCode} className="flex items-center gap-3">
                    <span className="text-sm text-white font-medium w-24 truncate">{inst.companyName || inst.scripCode}</span>
                    <div className="flex-1 h-5 bg-slate-700/30 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${inst.totalPnl >= 0 ? 'bg-emerald-500/40' : 'bg-red-500/40'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className={`text-sm font-mono tabular-nums w-20 text-right ${inst.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      ₹{formatCurrency(inst.totalPnl)}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8">No data</div>
          )}
        </div>

        {/* By Strategy */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">By Strategy</h2>
          {strategies.length > 0 ? (
            <div className="space-y-3">
              {strategies.map(strat => {
                const maxPnl = Math.max(...strategies.map(s => Math.abs(s.totalPnl)), 1)
                const width = (Math.abs(strat.totalPnl) / maxPnl) * 100
                return (
                  <div key={strat.strategy} className="flex items-center gap-3">
                    <span className="text-sm text-white font-medium w-24 truncate">{strat.strategy}</span>
                    <div className="flex-1 h-5 bg-slate-700/30 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${strat.totalPnl >= 0 ? 'bg-emerald-500/40' : 'bg-red-500/40'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className={`text-sm font-mono tabular-nums w-20 text-right ${strat.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      ₹{formatCurrency(strat.totalPnl)}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8">No data</div>
          )}
        </div>
      </div>

      {/* Trade Journal */}
      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Trade Journal</h2>
        </div>
        {journal.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Stock</th>
                <th className="text-left px-4 py-3">Side</th>
                <th className="text-right px-4 py-3">Entry</th>
                <th className="text-right px-4 py-3">Exit</th>
                <th className="text-right px-4 py-3">P&L</th>
                <th className="text-right px-4 py-3">R</th>
                <th className="text-left px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {journal.map(trade => (
                <>
                  <tr
                    key={trade.id}
                    onClick={() => setExpandedTrade(expandedTrade === trade.id ? null : trade.id)}
                    className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {trade.exitTime ? new Date(trade.exitTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-white font-medium">{trade.companyName || trade.scripCode}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        trade.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>{trade.side}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-slate-300 tabular-nums">{trade.entryPrice?.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-slate-300 tabular-nums">{trade.exitPrice?.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right font-mono text-sm font-medium tabular-nums ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trade.pnl >= 0 ? '+' : ''}₹{trade.pnl?.toFixed(0)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${(trade.rMultiple || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trade.rMultiple?.toFixed(1)}R
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{trade.exitReason}</td>
                  </tr>
                  {expandedTrade === trade.id && (
                    <tr key={`${trade.id}-detail`}>
                      <td colSpan={8} className="px-6 py-4 bg-slate-900/50 border-b border-slate-700/50">
                        <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
                          <div><span className="text-slate-500">Duration:</span> <span className="text-white">{trade.durationMinutes}m</span></div>
                          <div><span className="text-slate-500">Strategy:</span> <span className="text-white">{trade.strategy}</span></div>
                          <div><span className="text-slate-500">P&L %:</span> <span className={trade.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatPct(trade.pnlPercent)}</span></div>
                          <div><span className="text-slate-500">Qty:</span> <span className="text-white">{trade.quantity}</span></div>
                        </div>
                        {trade.tags?.length > 0 && (
                          <div className="flex gap-2 mb-3">
                            {trade.tags.map(tag => (
                              <span key={tag} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs">{tag}</span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2">
                          <label className="text-xs text-slate-500 block mb-1">Notes</label>
                          {editingNotes === trade.id ? (
                            <div className="flex gap-2">
                              <textarea
                                value={notesText}
                                onChange={e => setNotesText(e.target.value)}
                                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500 resize-none"
                                rows={2}
                              />
                              <div className="flex flex-col gap-1">
                                <button onClick={() => handleSaveNotes(trade.id)} className="px-3 py-1 bg-amber-500 text-slate-900 rounded text-xs font-medium">Save</button>
                                <button onClick={() => setEditingNotes(null)} className="px-3 py-1 bg-slate-700 text-slate-300 rounded text-xs">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <p
                              onClick={() => { setEditingNotes(trade.id); setNotesText(trade.notes || '') }}
                              className="text-sm text-slate-400 cursor-pointer hover:text-white transition-colors min-h-[24px]"
                            >
                              {trade.notes || 'Click to add notes...'}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center text-slate-500 py-12">No trades recorded yet</div>
        )}
      </div>
    </div>
  )
}
