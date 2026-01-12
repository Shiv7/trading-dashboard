import { useEffect, useState } from 'react'
import { performanceApi } from '../services/api'
import type { PerformanceMetrics } from '../types'

export default function PerformancePage() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')

  useEffect(() => {
    async function loadMetrics() {
      try {
        const data = await performanceApi.getMetrics()
        setMetrics(data)
      } catch (error) {
        console.error('Error loading performance metrics:', error)
      } finally {
        setLoading(false)
      }
    }
    loadMetrics()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-12 bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="text-center text-slate-500 py-12">
        <p>Unable to load performance metrics</p>
      </div>
    )
  }

  const periodData = period === 'daily'
    ? metrics.dailyPerformance
    : period === 'weekly'
      ? metrics.weeklyPerformance
      : metrics.monthlyPerformance

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-white">Performance Analytics</h1>
        <span className="text-sm text-slate-400">
          Last updated: {new Date(metrics.lastUpdated).toLocaleString()}
        </span>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <div className="card text-center">
          <div className="text-3xl font-bold text-white">{metrics.totalTrades ?? 0}</div>
          <div className="text-sm text-slate-400">Total Trades</div>
        </div>
        <div className="card text-center">
          <div className={`text-3xl font-bold ${(metrics.winRate ?? 0) >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
            {((metrics.winRate ?? 0) * 100).toFixed(1)}%
          </div>
          <div className="text-sm text-slate-400">Win Rate</div>
        </div>
        <div className="card text-center">
          <div className={`text-3xl font-bold ${(metrics.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(metrics.totalPnl ?? 0) >= 0 ? '+' : ''}₹{((metrics.totalPnl ?? 0) / 1000).toFixed(1)}K
          </div>
          <div className="text-sm text-slate-400">Total P&L</div>
        </div>
        <div className="card text-center">
          <div className={`text-3xl font-bold ${(metrics.avgRMultiple ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(metrics.avgRMultiple ?? 0) >= 0 ? '+' : ''}{(metrics.avgRMultiple ?? 0).toFixed(2)}R
          </div>
          <div className="text-sm text-slate-400">Avg R-Multiple</div>
        </div>
        <div className="card text-center">
          <div className={`text-3xl font-bold ${(metrics.profitFactor ?? 0) >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(metrics.profitFactor ?? 0).toFixed(2)}
          </div>
          <div className="text-sm text-slate-400">Profit Factor</div>
        </div>
      </div>

      {/* Win/Loss Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Win/Loss Stats */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Win/Loss Breakdown</h3>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1 bg-emerald-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-emerald-400">{metrics.wins}</div>
              <div className="text-sm text-slate-400">Wins</div>
            </div>
            <div className="flex-1 bg-red-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{metrics.losses}</div>
              <div className="text-sm text-slate-400">Losses</div>
            </div>
          </div>
          {/* Visual bar */}
          <div className="h-4 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
              style={{ width: `${(metrics.winRate ?? 0) * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-sm text-slate-400">
            <span>{((metrics.winRate ?? 0) * 100).toFixed(1)}% wins</span>
            <span>{((1 - (metrics.winRate ?? 0)) * 100).toFixed(1)}% losses</span>
          </div>
        </div>

        {/* Drawdown Analysis */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Drawdown Analysis</h3>
          {metrics.drawdown && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Max Drawdown</span>
                <span className="text-red-400 font-bold">
                  -₹{Math.abs(metrics.drawdown.maxDrawdown ?? 0).toFixed(0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Max Drawdown %</span>
                <span className="text-red-400 font-bold">
                  -{(metrics.drawdown.maxDrawdownPercent ?? 0).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Current Drawdown</span>
                <span className={`font-bold ${(metrics.drawdown.currentDrawdown ?? 0) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {(metrics.drawdown.currentDrawdown ?? 0) >= 0 ? '+' : ''}₹{(metrics.drawdown.currentDrawdown ?? 0).toFixed(0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Recovery Period</span>
                <span className="text-white">{metrics.drawdown.recoveryPeriod ?? 0} trades</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Streaks */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Streak Analysis</h3>
        {metrics.streaks && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-700/50 rounded-lg p-4 text-center">
              <div className={`text-2xl font-bold ${
                metrics.streaks.currentStreakType === 'WIN' ? 'text-emerald-400' :
                metrics.streaks.currentStreakType === 'LOSS' ? 'text-red-400' : 'text-slate-400'
              }`}>
                {metrics.streaks.currentStreak}
              </div>
              <div className="text-sm text-slate-400">Current Streak</div>
              <div className="text-xs text-slate-500">{metrics.streaks.currentStreakType}</div>
            </div>
            <div className="bg-emerald-500/10 rounded-lg p-4 text-center border border-emerald-500/20">
              <div className="text-2xl font-bold text-emerald-400">{metrics.streaks.maxWinStreak}</div>
              <div className="text-sm text-slate-400">Max Win Streak</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-4 text-center border border-red-500/20">
              <div className="text-2xl font-bold text-red-400">{metrics.streaks.maxLossStreak}</div>
              <div className="text-sm text-slate-400">Max Loss Streak</div>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">
                {(metrics.streaks.avgWinStreak ?? 0).toFixed(1)} / {(metrics.streaks.avgLossStreak ?? 0).toFixed(1)}
              </div>
              <div className="text-sm text-slate-400">Avg Win/Loss Streak</div>
            </div>
          </div>
        )}
      </div>

      {/* Performance by Period */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Performance Timeline</h3>
          <div className="flex gap-2">
            {(['daily', 'weekly', 'monthly'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  period === p
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 text-slate-400">Period</th>
                <th className="text-right py-2 text-slate-400">Trades</th>
                <th className="text-right py-2 text-slate-400">Wins</th>
                <th className="text-right py-2 text-slate-400">Losses</th>
                <th className="text-right py-2 text-slate-400">Win Rate</th>
                <th className="text-right py-2 text-slate-400">P&L</th>
              </tr>
            </thead>
            <tbody>
              {periodData?.slice(-10).reverse().map((row, i) => (
                <tr key={i} className="border-b border-slate-700/50">
                  <td className="py-2 text-white">
                    {'date' in row ? row.date : 'weekStart' in row ? row.weekStart : (row as { month: string }).month}
                  </td>
                  <td className="text-right py-2 text-white">{row.trades ?? 0}</td>
                  <td className="text-right py-2 text-emerald-400">{row.wins ?? 0}</td>
                  <td className="text-right py-2 text-red-400">{row.losses ?? 0}</td>
                  <td className="text-right py-2">
                    <span className={(row.winRate ?? 0) >= 0.5 ? 'text-emerald-400' : 'text-red-400'}>
                      {((row.winRate ?? 0) * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className={`text-right py-2 font-medium ${(row.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(row.pnl ?? 0) >= 0 ? '+' : ''}₹{(row.pnl ?? 0).toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Performance by Source */}
      {metrics.bySource && Object.keys(metrics.bySource).length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Performance by Signal Source</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(metrics.bySource).map(([source, stats]) => (
              <div key={source} className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white">{source}</span>
                  <span className={`text-sm ${(stats.winRate ?? 0) >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {((stats.winRate ?? 0) * 100).toFixed(0)}% win
                  </span>
                </div>
                <div className="text-sm text-slate-400">
                  {stats.trades ?? 0} trades | {stats.wins ?? 0}W / {stats.losses ?? 0}L
                </div>
                <div className={`text-lg font-bold mt-2 ${(stats.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(stats.totalPnl ?? 0) >= 0 ? '+' : ''}₹{(stats.totalPnl ?? 0).toFixed(0)}
                </div>
                <div className="text-xs text-slate-500">
                  Avg R: {(stats.avgRMultiple ?? 0) >= 0 ? '+' : ''}{(stats.avgRMultiple ?? 0).toFixed(2)}R
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time Analysis */}
      {metrics.timeAnalysis && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Time Analysis</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-emerald-500/10 rounded-lg p-4 text-center border border-emerald-500/20">
              <div className="text-2xl font-bold text-emerald-400">
                {metrics.timeAnalysis.bestTradingHour}:00
              </div>
              <div className="text-sm text-slate-400">Best Hour</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-4 text-center border border-red-500/20">
              <div className="text-2xl font-bold text-red-400">
                {metrics.timeAnalysis.worstTradingHour}:00
              </div>
              <div className="text-sm text-slate-400">Worst Hour</div>
            </div>
            <div className="bg-emerald-500/10 rounded-lg p-4 text-center border border-emerald-500/20">
              <div className="text-2xl font-bold text-emerald-400">
                {metrics.timeAnalysis.bestTradingDay}
              </div>
              <div className="text-sm text-slate-400">Best Day</div>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">
                {metrics.timeAnalysis.avgHoldingTime}m
              </div>
              <div className="text-sm text-slate-400">Avg Holding Time</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
