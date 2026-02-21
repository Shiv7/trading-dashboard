import { useState, useEffect } from 'react'
import { fetchJson } from '../../services/api'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

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

interface WalletPnLTabProps {
  walletType: 'PAPER' | 'REAL'
}

export default function WalletPnLTab({ walletType }: WalletPnLTabProps) {
  const [period, setPeriod] = useState<Period>('1M')
  const [summary, setSummary] = useState<PnlSummary | null>(null)
  const [metrics, setMetrics] = useState<AdvancedMetrics | null>(null)
  const [equityCurve, setEquityCurve] = useState<DailyPnl[]>([])
  const [instruments, setInstruments] = useState<InstrumentPnl[]>([])
  const [strategies, setStrategies] = useState<StrategyPnl[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [walletType, period])

  const loadData = async () => {
    setLoading(true)
    const wt = walletType

    try {
      const [summaryData, metricsData, curveData, instData, stratData] = await Promise.allSettled([
        fetchJson<PnlSummary>(`/pnl/summary?walletType=${wt}`),
        fetchJson<AdvancedMetrics>(`/pnl/metrics?walletType=${wt}`),
        fetchJson<DailyPnl[]>(`/pnl/equity-curve?walletType=${wt}`),
        fetchJson<InstrumentPnl[]>(`/pnl/by-instrument?walletType=${wt}`),
        fetchJson<StrategyPnl[]>(`/pnl/by-strategy?walletType=${wt}`),
      ])

      if (summaryData.status === 'fulfilled') setSummary(summaryData.value)
      if (metricsData.status === 'fulfilled') setMetrics(metricsData.value)
      if (curveData.status === 'fulfilled') setEquityCurve(curveData.value)
      if (instData.status === 'fulfilled') setInstruments(instData.value)
      if (stratData.status === 'fulfilled') setStrategies(stratData.value)
    } catch { /* ignore partial failures */ }
    setLoading(false)
  }

  const formatCurrency = (n: number) => {
    n = Number(n) || 0
    const sign = n > 0 ? '+' : n < 0 ? '-' : ''
    const abs = Math.abs(n)
    if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L'
    if (abs >= 1000) return sign + '₹' + (abs / 1000).toFixed(1) + 'K'
    return sign + '₹' + abs.toFixed(0)
  }

  const formatPct = (n: number) => {
    n = Number(n) || 0
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
  }

  const statCards = summary ? [
    { label: 'Total P&L', value: formatCurrency(summary.realizedPnl), sub: formatPct(summary.initialCapital ? (summary.realizedPnl / summary.initialCapital) * 100 : 0), positive: summary.realizedPnl >= 0 },
    { label: 'Win Rate', value: `${summary.winRate?.toFixed(1) || 0}%`, sub: `${summary.winCount}W / ${summary.lossCount}L`, positive: (summary.winRate || 0) >= 50 },
    { label: 'Sharpe Ratio', value: metrics?.sharpeRatio?.toFixed(2) || '-', sub: '', positive: (metrics?.sharpeRatio || 0) >= 1 },
    { label: 'Max Drawdown', value: metrics ? `${metrics.maxDrawdown?.toFixed(1)}%` : '-', sub: metrics ? formatCurrency(metrics.maxDrawdownAmount || 0) : '', positive: false },
    { label: 'Profit Factor', value: metrics?.profitFactor?.toFixed(1) || '-', sub: '', positive: (metrics?.profitFactor || 0) >= 1.5 },
  ] : []

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-slate-800/50 rounded-xl p-4"><div className="h-16 bg-slate-700/30 rounded" /></div>
          ))}
        </div>
        <div className="bg-slate-800/50 rounded-xl p-6"><div className="h-64 bg-slate-700/30 rounded" /></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base sm:text-lg font-semibold text-white shrink-0">P&L Analytics</h2>
        <div className="flex bg-slate-800 rounded-lg p-0.5 sm:p-1 overflow-x-auto">
          {(['1W', '1M', '3M', '6M', '1Y', 'ALL'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap ${
                period === p ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-4">
        {statCards.map((card, i) => (
          <div key={i} className={`bg-slate-800/50 backdrop-blur border rounded-xl p-3 sm:p-4 ${
            card.positive ? 'border-emerald-500/20' : 'border-red-500/20'
          } ${i === statCards.length - 1 && statCards.length % 2 !== 0 ? 'col-span-2 sm:col-span-1' : ''}`}>
            <p className="text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">{card.label}</p>
            <p className={`text-lg sm:text-2xl font-bold font-mono tabular-nums ${card.positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {card.value}
            </p>
            {card.sub && <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Equity Curve */}
      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-3 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Equity Curve</h3>
        {equityCurve.length > 0 ? (
          <ResponsiveContainer width="100%" height={220} className="sm:!h-[300px]">
            <AreaChart data={equityCurve}>
              <defs>
                <linearGradient id="walletEquityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#f8fafc' }}
                formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, 'Cumulative P&L']}
              />
              <Area type="monotone" dataKey="cumulative" stroke="#10b981" fill="url(#walletEquityGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-48 sm:h-64 flex items-center justify-center text-slate-500 text-sm">No data available yet</div>
        )}
      </div>

      {/* Breakdowns Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* By Strategy */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-3 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">By Strategy</h3>
          {strategies.length > 0 ? (
            <div className="space-y-2.5 sm:space-y-3">
              {strategies.map(strat => {
                const maxPnl = Math.max(...strategies.map(s => Math.abs(s.totalPnl)), 1)
                const width = (Math.abs(strat.totalPnl) / maxPnl) * 100
                return (
                  <div key={strat.strategy} className="flex items-center gap-2 sm:gap-3">
                    <span className={`text-xs sm:text-sm font-medium w-16 sm:w-24 truncate ${
                      strat.strategy === 'FUDKII' ? 'text-orange-400'
                      : strat.strategy === 'FUKAA' ? 'text-amber-400'
                      : strat.strategy === 'PIVOT' ? 'text-blue-400'
                      : 'text-white'
                    }`}>{strat.strategy}</span>
                    <div className="flex-1 h-4 sm:h-5 bg-slate-700/30 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${strat.totalPnl >= 0 ? 'bg-emerald-500/40' : 'bg-red-500/40'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <div className="text-right w-20 sm:w-28 shrink-0">
                      <span className={`text-xs sm:text-sm font-mono tabular-nums ${strat.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatCurrency(strat.totalPnl)}
                      </span>
                      <span className="text-[10px] sm:text-xs text-slate-500 ml-1 sm:ml-2">{strat.trades}t</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8 text-sm">No data</div>
          )}
        </div>

        {/* By Instrument */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-3 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">By Instrument</h3>
          {instruments.length > 0 ? (
            <div className="space-y-2.5 sm:space-y-3">
              {instruments.slice(0, 10).map(inst => {
                const maxPnl = Math.max(...instruments.map(i => Math.abs(i.totalPnl)), 1)
                const width = (Math.abs(inst.totalPnl) / maxPnl) * 100
                return (
                  <div key={inst.scripCode} className="flex items-center gap-2 sm:gap-3">
                    <span className="text-xs sm:text-sm text-white font-medium w-16 sm:w-24 truncate">{inst.companyName || inst.scripCode}</span>
                    <div className="flex-1 h-4 sm:h-5 bg-slate-700/30 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${inst.totalPnl >= 0 ? 'bg-emerald-500/40' : 'bg-red-500/40'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <div className="text-right w-20 sm:w-28 shrink-0">
                      <span className={`text-xs sm:text-sm font-mono tabular-nums ${inst.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatCurrency(inst.totalPnl)}
                      </span>
                      <span className="text-[10px] sm:text-xs text-slate-500 ml-1 sm:ml-2">{inst.winRate?.toFixed(0)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Quick Stats Row */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">Avg Win</p>
            <p className="text-sm sm:text-lg font-bold font-mono text-emerald-400">{formatCurrency(metrics.avgWin)}</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">Avg Loss</p>
            <p className="text-sm sm:text-lg font-bold font-mono text-red-400">{formatCurrency(metrics.avgLoss)}</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">Best Trade</p>
            <p className="text-sm sm:text-lg font-bold font-mono text-emerald-400">{formatCurrency(metrics.bestTrade)}</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">Worst Trade</p>
            <p className="text-sm sm:text-lg font-bold font-mono text-red-400">{formatCurrency(metrics.worstTrade)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
