import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Bar,
} from 'recharts'
import type { Trade } from '../../types'

interface PerformanceChartsProps {
  trades: Trade[]
  initialCapital?: number
}

interface EquityPoint {
  date: string
  timestamp: number
  equity: number
  pnl: number
  cumPnl: number
  drawdown: number
  drawdownPct: number
  rMultiple: number
  cumR: number
  tradeCount: number
}

export default function PerformanceCharts({ trades, initialCapital = 100000 }: PerformanceChartsProps) {
  const { equityCurve, stats } = useMemo(() => {
    // Sort trades by exit time (closed trades only)
    const closedTrades = trades
      .filter(t => t.exitTime && t.status !== 'ACTIVE')
      .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime())

    if (closedTrades.length === 0) {
      return { equityCurve: [], stats: null }
    }

    let cumPnl = 0
    let cumR = 0
    let maxEquity = initialCapital
    let maxDrawdown = 0
    let maxDrawdownPct = 0
    let winStreak = 0
    let maxWinStreak = 0
    let loseStreak = 0
    let maxLoseStreak = 0

    const equityCurve: EquityPoint[] = closedTrades.map((trade, idx) => {
      cumPnl += trade.pnl
      cumR += trade.rMultiple
      const equity = initialCapital + cumPnl

      // Track max equity for drawdown
      if (equity > maxEquity) {
        maxEquity = equity
      }

      // Calculate drawdown
      const drawdown = maxEquity - equity
      const drawdownPct = (drawdown / maxEquity) * 100

      // Track max drawdown
      if (drawdownPct > maxDrawdownPct) {
        maxDrawdown = drawdown
        maxDrawdownPct = drawdownPct
      }

      // Track streaks
      if (trade.pnl > 0) {
        winStreak++
        loseStreak = 0
        if (winStreak > maxWinStreak) maxWinStreak = winStreak
      } else {
        loseStreak++
        winStreak = 0
        if (loseStreak > maxLoseStreak) maxLoseStreak = loseStreak
      }

      return {
        date: new Date(trade.exitTime!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        timestamp: new Date(trade.exitTime!).getTime(),
        equity,
        pnl: trade.pnl,
        cumPnl,
        drawdown: -drawdown, // Negative for display
        drawdownPct: -drawdownPct,
        rMultiple: trade.rMultiple,
        cumR,
        tradeCount: idx + 1,
      }
    })

    const finalEquity = equityCurve[equityCurve.length - 1]?.equity || initialCapital
    const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100
    const avgR = closedTrades.length > 0 ? cumR / closedTrades.length : 0
    const profitFactor = closedTrades.reduce((sum, t) => sum + (t.pnl > 0 ? t.pnl : 0), 0) /
      Math.abs(closedTrades.reduce((sum, t) => sum + (t.pnl < 0 ? t.pnl : 0), 0)) || 0

    return {
      equityCurve,
      stats: {
        totalReturn,
        maxDrawdown,
        maxDrawdownPct,
        avgR,
        profitFactor,
        maxWinStreak,
        maxLoseStreak,
        sharpeEstimate: totalReturn / (maxDrawdownPct || 1), // Simplified
      }
    }
  }, [trades, initialCapital])

  if (equityCurve.length < 2) {
    return (
      <div className="card">
        <div className="card-header">📊 Performance Analytics</div>
        <div className="flex items-center justify-center h-48 text-slate-500">
          <div className="text-center">
            <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            <p>Need at least 2 closed trades for analytics</p>
          </div>
        </div>
      </div>
    )
  }

  const formatCurrency = (value: number) => {
    if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)}L`
    if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(1)}K`
    return `₹${value.toFixed(0)}`
  }

  return (
    <div className="space-y-6">
      {/* Advanced Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
            <div className="text-xs text-emerald-400 mb-1">Total Return</div>
            <div className={`text-2xl font-bold ${stats.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {stats.totalReturn >= 0 ? '+' : ''}{stats.totalReturn.toFixed(1)}%
            </div>
          </div>
          <div className="card bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20">
            <div className="text-xs text-red-400 mb-1">Max Drawdown</div>
            <div className="text-2xl font-bold text-red-400">
              {stats.maxDrawdownPct.toFixed(1)}%
            </div>
            <div className="text-xs text-slate-500">{formatCurrency(stats.maxDrawdown)}</div>
          </div>
          <div className="card bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <div className="text-xs text-blue-400 mb-1">Profit Factor</div>
            <div className={`text-2xl font-bold ${stats.profitFactor >= 1.5 ? 'text-emerald-400' : stats.profitFactor >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
              {stats.profitFactor.toFixed(2)}
            </div>
          </div>
          <div className="card bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <div className="text-xs text-purple-400 mb-1">Return/DD Ratio</div>
            <div className={`text-2xl font-bold ${stats.sharpeEstimate >= 2 ? 'text-emerald-400' : stats.sharpeEstimate >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
              {stats.sharpeEstimate.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Equity Curve */}
      <div className="card">
        <div className="card-header">
          <span>💰 Equity Curve</span>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <div className="w-3 h-1 bg-emerald-500 rounded" />
              Equity
            </span>
            <span className="flex items-center gap-1">
              <div className="w-3 h-1 bg-slate-500 rounded" />
              Baseline
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={equityCurve} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
            />
            <YAxis
              orientation="right"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              tickFormatter={formatCurrency}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(value: number, name: string) => {
                if (name === 'equity') return [formatCurrency(value), 'Equity']
                return [value, name]
              }}
            />
            <ReferenceLine y={initialCapital} stroke="#475569" strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#equityGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Drawdown Chart */}
      <div className="card">
        <div className="card-header">
          <span>📉 Drawdown</span>
          <span className="text-xs text-red-400">
            Max: {stats?.maxDrawdownPct.toFixed(1)}%
          </span>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={equityCurve} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis
              orientation="right"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              formatter={(value: number) => [`${Math.abs(value).toFixed(2)}%`, 'Drawdown']}
            />
            <ReferenceLine y={0} stroke="#475569" />
            <Area
              type="monotone"
              dataKey="drawdownPct"
              stroke="#ef4444"
              strokeWidth={1.5}
              fill="url(#drawdownGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* R-Multiple Distribution */}
      <div className="card">
        <div className="card-header">
          <span>📊 Trade Distribution (R-Multiples)</span>
          <span className="text-xs text-slate-400">
            Cumulative: {equityCurve[equityCurve.length - 1]?.cumR.toFixed(1)}R
          </span>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={equityCurve} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis
              orientation="right"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(1)}R`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              formatter={(value: number, name: string) => {
                if (name === 'rMultiple') return [`${value.toFixed(2)}R`, 'R-Multiple']
                if (name === 'pnl') return [formatCurrency(value), 'P&L']
                return [value, name]
              }}
            />
            <ReferenceLine y={0} stroke="#475569" />
            <Bar
              dataKey="rMultiple"
              fill="#3b82f6"
              radius={[2, 2, 0, 0]}
              maxBarSize={20}
              shape={((props: { x: number; y: number; width: number; height: number; payload: EquityPoint }) => {
                const { x, y, width, height, payload } = props
                const isPositive = payload.rMultiple >= 0
                return (
                  <rect
                    x={x}
                    y={isPositive ? y : y - Math.abs(height)}
                    width={width}
                    height={Math.abs(height)}
                    fill={isPositive ? '#10b981' : '#ef4444'}
                    rx={2}
                  />
                )
              }) as any}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Streaks Info */}
      {stats && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-emerald-400 text-lg">🔥</span>
              <span className="text-sm text-slate-300">Best Win Streak</span>
            </div>
            <div className="text-3xl font-bold text-emerald-400">{stats.maxWinStreak}</div>
            <div className="text-xs text-slate-500">consecutive wins</div>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-red-400 text-lg">❄️</span>
              <span className="text-sm text-slate-300">Worst Lose Streak</span>
            </div>
            <div className="text-3xl font-bold text-red-400">{stats.maxLoseStreak}</div>
            <div className="text-xs text-slate-500">consecutive losses</div>
          </div>
        </div>
      )}
    </div>
  )
}
