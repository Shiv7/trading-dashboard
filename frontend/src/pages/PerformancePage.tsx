import { useEffect, useState } from 'react'
import { performanceApi } from '../services/api'
import type { PerformanceMetrics } from '../types'

const fmtINR = (n: number) => Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })

export default function PerformancePage() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [showAll, setShowAll] = useState(false)

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
    const interval = setInterval(loadMetrics, 30000) // auto-refresh every 30s
    return () => clearInterval(interval)
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
            {(metrics.totalPnl ?? 0) >= 0 ? '+' : '-'}₹{fmtINR(metrics.totalPnl ?? 0)}
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

      {/* Performance by Source */}
      {metrics.bySource && Object.keys(metrics.bySource).length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Performance by Signal Source</h3>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {Object.entries(metrics.bySource).map(([source, stats]) => {
              // Values are in seconds from backend
              const fmtMmSs = (totalSec: number) => {
                const s = Math.round(totalSec)
                const mins = Math.floor(s / 60)
                const secs = s % 60
                return `${mins}:${String(secs).padStart(2, '0')}`
              }
              const fmtHms = (totalSec: number) => {
                const s = Math.round(totalSec)
                const h = Math.floor(s / 3600)
                const mn = Math.floor((s % 3600) / 60)
                const sc = s % 60
                return `${h}:${String(mn).padStart(2, '0')}:${String(sc).padStart(2, '0')}`
              }
              return (
              <div key={source} className="bg-slate-700/50 rounded-lg p-4 min-w-[280px] flex-shrink-0">
                {/* Header: name + win rate */}
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-white text-lg">{source}</span>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded ${(stats.winRate ?? 0) >= 0.5 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {((stats.winRate ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
                {/* P&L */}
                <div className={`text-2xl font-bold mb-3 ${(stats.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(stats.totalPnl ?? 0) >= 0 ? '+' : '-'}₹{fmtINR(stats.totalPnl ?? 0)}
                </div>
                {/* Stats grid */}
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Trades</span>
                    <span className="text-white">{stats.trades ?? 0} ({stats.wins ?? 0}W / {stats.losses ?? 0}L)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg R</span>
                    <span className={`font-medium ${(stats.avgRMultiple ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(stats.avgRMultiple ?? 0) >= 0 ? '+' : ''}{(stats.avgRMultiple ?? 0).toFixed(2)}R
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max DD%/Trade</span>
                    <span className="text-red-400 font-medium">
                      {(stats.maxDrawdownPercent ?? 0) > 0 ? `-${(stats.maxDrawdownPercent ?? 0).toFixed(2)}%` : '0%'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Capital/Trade</span>
                    <span className="text-white">₹{fmtINR(stats.maxCapitalEmployed ?? 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg Hold</span>
                    <span className="text-white">{fmtMmSs(stats.avgHoldingTime ?? 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Min Hold</span>
                    <span className="text-white">{fmtHms(stats.minHoldingTime ?? 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Hold</span>
                    <span className="text-white">{fmtHms(stats.maxHoldingTime ?? 0)}</span>
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}

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
                  -₹{fmtINR(metrics.drawdown.maxDrawdown ?? 0)}
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
                <span className={`font-bold ${(metrics.drawdown.currentDrawdown ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {(metrics.drawdown.currentDrawdown ?? 0) > 0 ? '-' : ''}₹{fmtINR(metrics.drawdown.currentDrawdown ?? 0)}
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

      {/* Best Strategy by Exchange */}
      {metrics.bestByExchange && Object.keys(metrics.bestByExchange).length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Best Strategy by Category</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['MCX', 'NSE', 'Currency'].map(exch => {
              const best = metrics.bestByExchange[exch]
              if (!best) return (
                <div key={exch} className="bg-slate-700/30 rounded-lg p-4 text-center border border-slate-600/30">
                  <div className="text-sm font-medium text-slate-500 mb-2">{exch}</div>
                  <div className="text-slate-600 text-sm">No trades</div>
                </div>
              )
              return (
                <div key={exch} className="bg-slate-700/50 rounded-lg p-4 border border-slate-600/40">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-600/30 text-blue-300">{exch}</span>
                    <span className="text-emerald-400 font-bold text-lg">{best.strategy}</span>
                  </div>
                  <div className={`text-2xl font-bold mb-1 ${best.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {best.totalPnl >= 0 ? '+' : '-'}₹{fmtINR(best.totalPnl)}
                  </div>
                  <div className="text-xs text-slate-400">
                    {best.trades} trades | {best.wins}W/{best.losses}L | {(best.winRate * 100).toFixed(0)}% win
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Strategy Details Table */}
      {metrics.strategyDetails && metrics.strategyDetails.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Strategy Performance Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 text-slate-400">Strategy</th>
                  <th className="text-left py-2 text-slate-400">Category</th>
                  <th className="text-right py-2 text-slate-400">Trades</th>
                  <th className="text-right py-2 text-slate-400">W/L</th>
                  <th className="text-right py-2 text-slate-400">P&L</th>
                  <th className="text-right py-2 text-slate-400">Profit %</th>
                  <th className="text-right py-2 text-slate-400">ROI</th>
                  <th className="text-right py-2 text-slate-400">Max DD %</th>
                  <th className="text-right py-2 text-slate-400">Max Capital</th>
                </tr>
              </thead>
              <tbody>
                {metrics.strategyDetails.map((sd, i) => (
                  <tr key={i} className="border-b border-slate-700/50">
                    <td className="py-2 font-medium text-white">{sd.strategy}</td>
                    <td className="py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        sd.exchange === 'MCX' ? 'bg-amber-600/20 text-amber-400' :
                        sd.exchange === 'Currency' ? 'bg-purple-600/20 text-purple-400' :
                        'bg-blue-600/20 text-blue-400'
                      }`}>{sd.exchange}</span>
                    </td>
                    <td className="text-right py-2 text-white">{sd.trades}</td>
                    <td className="text-right py-2 text-white">{sd.wins}W/{sd.losses}L</td>
                    <td className={`text-right py-2 font-medium ${sd.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sd.totalPnl >= 0 ? '+' : '-'}₹{fmtINR(sd.totalPnl)}
                    </td>
                    <td className={`text-right py-2 font-medium ${sd.profitPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sd.profitPercent >= 0 ? '+' : ''}{sd.profitPercent.toFixed(2)}%
                    </td>
                    <td className={`text-right py-2 font-medium ${sd.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sd.roi >= 0 ? '+' : ''}{sd.roi.toFixed(2)}%
                    </td>
                    <td className="text-right py-2 text-red-400 font-medium">
                      {sd.maxDrawdownPercent > 0 ? `-${sd.maxDrawdownPercent.toFixed(1)}%` : '0%'}
                    </td>
                    <td className="text-right py-2 text-white">
                      ₹{fmtINR(sd.maxCapitalEmployed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
              {(showAll ? periodData : periodData?.slice(-10))?.reverse().map((row, i) => (
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
                    {(row.pnl ?? 0) >= 0 ? '+' : '-'}₹{fmtINR(row.pnl ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {periodData && periodData.length > 10 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-3 w-full py-2 text-sm text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors"
          >
            {showAll ? `Show Less (10 of ${periodData.length})` : `Show All ${periodData.length} Entries`}
          </button>
        )}
      </div>

      {/* Time Analysis */}
      {metrics.timeAnalysis && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Time Analysis</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-emerald-500/10 rounded-lg p-4 text-center border border-emerald-500/20">
              <div className="text-2xl font-bold text-emerald-400">
                {metrics.timeAnalysis.bestTradingHour >= 0 ? `${metrics.timeAnalysis.bestTradingHour}:00` : 'N/A'}
              </div>
              <div className="text-sm text-slate-400">Best Hour</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-4 text-center border border-red-500/20">
              <div className="text-2xl font-bold text-red-400">
                {metrics.timeAnalysis.worstTradingHour >= 0 ? `${metrics.timeAnalysis.worstTradingHour}:00` : 'N/A'}
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
                {(() => {
                  const s = Math.round(metrics.timeAnalysis.avgHoldingTime)
                  const mins = Math.floor(s / 60)
                  const secs = s % 60
                  return `${mins}:${String(secs).padStart(2, '0')}`
                })()}
              </div>
              <div className="text-sm text-slate-400">Avg Holding Time</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
