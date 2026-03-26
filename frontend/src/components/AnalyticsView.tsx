import { TrendingUp, TrendingDown, Activity, Clock, Calendar, Target, Layers } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { getStrategyBadgeClass } from '../utils/strategyColors'
import PerformanceCharts from './Charts/PerformanceCharts'
import type { AnalyticsResult, RegimeAnalyticsResult, RegimeBand } from '../utils/tradeAnalytics'
import { fmt, fmtINR, fmtDuration } from '../utils/tradeAnalytics'
import type { Trade } from '../types'

interface AnalyticsViewProps {
  analytics: AnalyticsResult
  chartsData: Trade[]
  initialCapital: number
  activeStrategy: string
  regimeAnalytics?: RegimeAnalyticsResult
  liveDrawdown?: number
  unrealizedPnl?: number
  walletTotalPnl?: number
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

/** Regime band bar renderer */
function RegimeBandRow({ band, maxCount }: { band: RegimeBand; maxCount: number }) {
  const barW = maxCount > 0 ? (band.count / maxCount) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono w-16 shrink-0 text-slate-400">{band.label}</span>
      <div className="flex-1 h-3 bg-slate-700/50 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${band.winRate >= 55 ? 'bg-emerald-500/70' : band.winRate >= 45 ? 'bg-amber-500/70' : 'bg-red-500/60'}`}
          style={{ width: `${Math.max(barW, 4)}%` }} />
      </div>
      <span className="text-[10px] text-slate-500 w-8 text-right">{band.count}</span>
      <span className={`text-[10px] font-bold w-10 text-right ${band.winRate >= 55 ? 'text-emerald-400' : band.winRate >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
        {fmt(band.winRate, 0)}%
      </span>
      <span className={`text-[10px] font-mono w-14 text-right ${band.avgR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {band.avgR >= 0 ? '+' : ''}{fmt(band.avgR, 2)}R
      </span>
      <span className={`text-[10px] font-mono w-16 text-right ${band.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {fmtINR(band.totalPnl)}
      </span>
    </div>
  )
}

export default function AnalyticsView({ analytics, chartsData, initialCapital, activeStrategy, regimeAnalytics, liveDrawdown, unrealizedPnl, walletTotalPnl }: AnalyticsViewProps) {
  if (!analytics) {
    return (
      <div className="card text-center py-16 text-slate-500">
        <Activity className="w-12 h-12 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No closed trades to analyze</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Total P&L" value={fmtINR(walletTotalPnl ?? analytics.totalPnl)} positive={(walletTotalPnl ?? analytics.totalPnl) >= 0} />
        {unrealizedPnl !== undefined && unrealizedPnl !== 0 && (
          <StatCard label="Unrealized P&L" value={fmtINR(unrealizedPnl)} positive={unrealizedPnl >= 0} />
        )}
        <StatCard label="Win Rate" value={`${fmt(analytics.winRate, 1)}%`} positive={analytics.winRate >= 50} />
        <StatCard label="Profit Factor" value={analytics.profitFactor === Infinity ? '\u221E' : fmt(analytics.profitFactor, 2)} positive={analytics.profitFactor > 1} />
        <StatCard label="Max Drawdown" value={fmtINR(analytics.maxDrawdown)} positive={false} />
        {liveDrawdown !== undefined && liveDrawdown > 0 && (
          <StatCard label="Live Drawdown" value={fmtINR(liveDrawdown)} positive={false} />
        )}
        <StatCard label="Avg R" value={`${analytics.avgR >= 0 ? '+' : ''}${fmt(analytics.avgR, 2)}R`} positive={analytics.avgR >= 0} />
        <StatCard label="Avg Duration" value={fmtDuration(analytics.avgDuration)} />
      </div>

      {/* ═══ Strategy Comparison (ALL view only) ═══ */}
      {activeStrategy === 'ALL' && analytics.byStrategy && analytics.byStrategy.length > 1 && (
        <div className="card">
          <div className="text-sm font-semibold text-slate-300 mb-1">Strategy Comparison</div>
          <div className="text-[10px] text-slate-500 mb-3">Cross-strategy performance ranking — sorted by total P&L</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left text-slate-500 font-medium py-1.5 pr-3">Strategy</th>
                  <th className="text-right text-slate-500 font-medium py-1.5 px-2">Trades</th>
                  <th className="text-right text-slate-500 font-medium py-1.5 px-2">Win Rate</th>
                  <th className="text-right text-slate-500 font-medium py-1.5 px-2">P&L</th>
                  <th className="text-right text-slate-500 font-medium py-1.5 px-2">Avg P&L</th>
                  <th className="text-right text-slate-500 font-medium py-1.5 px-2">Avg R</th>
                  <th className="text-right text-slate-500 font-medium py-1.5 px-2">PF</th>
                  <th className="text-right text-slate-500 font-medium py-1.5 px-2">Avg Hold</th>
                  <th className="text-right text-slate-500 font-medium py-1.5 px-2">Edge</th>
                  <th className="text-left text-slate-500 font-medium py-1.5 pl-2">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {analytics.byStrategy.map((s, i) => {
                  const hasEdge = s.avgPnl > 0 && s.profitFactor > 1
                  const isTop = i === 0 && s.pnl > 0
                  const isWorst = i === analytics.byStrategy.length - 1 && s.pnl < 0
                  const contribWidth = Math.min(Math.abs(s.pnlContribution), 100)
                  return (
                    <tr key={s.name} className={`border-b border-slate-800/50 ${isTop ? 'bg-emerald-500/5' : isWorst ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2 pr-3">
                        <span className="text-xs font-bold text-white">{s.name}</span>
                        {isTop && <span className="ml-1.5 text-[8px] text-emerald-400 font-bold">BEST</span>}
                        {isWorst && <span className="ml-1.5 text-[8px] text-red-400 font-bold">WORST</span>}
                      </td>
                      <td className="text-right py-2 px-2 text-slate-400">{s.count}</td>
                      <td className="text-right py-2 px-2">
                        <span className={`font-bold ${s.winRate >= 50 ? 'text-emerald-400' : s.winRate >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{fmt(s.winRate, 0)}%</span>
                      </td>
                      <td className={`text-right py-2 px-2 font-mono font-bold ${s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(s.pnl)}</td>
                      <td className={`text-right py-2 px-2 font-mono ${s.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(s.avgPnl)}</td>
                      <td className={`text-right py-2 px-2 font-mono ${s.avgR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{s.avgR >= 0 ? '+' : ''}{fmt(s.avgR, 2)}R</td>
                      <td className={`text-right py-2 px-2 font-bold ${s.profitFactor >= 1.5 ? 'text-emerald-400' : s.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
                        {s.profitFactor === Infinity ? '\u221E' : fmt(s.profitFactor, 2)}
                      </td>
                      <td className="text-right py-2 px-2 text-slate-400">{fmtDuration(s.avgDur)}</td>
                      <td className="text-right py-2 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          hasEdge ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}>{hasEdge ? 'YES' : 'NO'}</span>
                      </td>
                      <td className="py-2 pl-2 w-28">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${s.pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${contribWidth}%` }} />
                          </div>
                          <span className={`text-[9px] font-mono ${s.pnlContribution >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{s.pnlContribution >= 0 ? '+' : ''}{fmt(s.pnlContribution, 0)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Portfolio Insights */}
          {(() => {
            const edgeStrategies = analytics.byStrategy.filter(s => s.avgPnl > 0 && s.profitFactor > 1)
            const bleedStrategies = analytics.byStrategy.filter(s => s.pnl < 0)
            const bestStrategy = analytics.byStrategy[0]
            const totalCapitalAtRisk = analytics.byStrategy.length * 1000000 // 10L each
            const portfolioROI = totalCapitalAtRisk > 0 ? (analytics.totalPnl / totalCapitalAtRisk) * 100 : 0
            return (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-800/60 rounded-lg p-2.5">
                  <div className="text-[9px] text-slate-500 uppercase mb-1">Strategies with Edge</div>
                  <div className="text-sm font-bold text-white">{edgeStrategies.length}/{analytics.byStrategy.length}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">
                    {edgeStrategies.length > 0 ? edgeStrategies.map(s => s.name).join(', ') : 'None yet'}
                  </div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-2.5">
                  <div className="text-[9px] text-slate-500 uppercase mb-1">Capital Bleeders</div>
                  <div className={`text-sm font-bold ${bleedStrategies.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{bleedStrategies.length} strategies</div>
                  <div className="text-[9px] text-red-400/70 mt-0.5">
                    {bleedStrategies.length > 0 ? bleedStrategies.map(s => `${s.name} (${fmtINR(s.pnl)})`).join(', ') : 'None — all profitable'}
                  </div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-2.5">
                  <div className="text-[9px] text-slate-500 uppercase mb-1">Portfolio ROI ({analytics.byStrategy.length} × 10L)</div>
                  <div className={`text-sm font-bold ${portfolioROI >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{portfolioROI >= 0 ? '+' : ''}{fmt(portfolioROI, 2)}%</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">
                    {bestStrategy && bestStrategy.pnl > 0 ? `${bestStrategy.name} carrying ${fmt(Math.abs(bestStrategy.pnlContribution), 0)}% of P&L` : 'No dominant strategy yet'}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}

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

        {/* Direction + Exchange Breakdown — Pie Charts side by side */}
        <div className="card">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Direction Pie */}
            <div>
              <div className="text-sm font-semibold text-slate-300 mb-2">Direction Breakdown</div>
              {(() => {
                const isOptionView = activeStrategy === 'ALL'
                  ? analytics.byInstrument['OPTIONS'] && !analytics.byInstrument['EQUITY'] && !analytics.byInstrument['FUTURES']
                  : activeStrategy !== 'ALL'
                const dirData = Object.entries(analytics.byDirection).map(([dir, data]) => ({
                  name: isOptionView ? (dir === 'bullish' ? 'CE' : 'PE') : (dir === 'bullish' ? 'LONG' : 'SHORT'),
                  value: data.count,
                  pnl: data.pnl,
                  winRate: data.winRate,
                  color: dir === 'bullish' ? '#10b981' : '#ef4444',
                }))
                return (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie data={dirData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={3} strokeWidth={0}>
                          {dirData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                          formatter={(value: number, name: string) => [`${value} trades`, name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2">
                      {dirData.map(d => (
                        <div key={d.name} className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="text-xs font-semibold text-white w-12">{d.name}</span>
                          <span className="text-[10px] text-slate-400">{d.value}T &middot; {fmt(d.winRate, 0)}%</span>
                          <span className={`text-[10px] font-mono ml-auto ${d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(d.pnl)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Exchange Pie */}
            <div>
              <div className="text-sm font-semibold text-slate-300 mb-2">Exchange Breakdown</div>
              {(() => {
                const exchColors: Record<string, string> = { N: '#3b82f6', M: '#f59e0b', C: '#a855f7' }
                const exchLabels: Record<string, string> = { N: 'NSE', M: 'MCX', C: 'CDS' }
                const exchData = Object.entries(analytics.byExchange).map(([ex, data]) => ({
                  name: exchLabels[ex] || ex,
                  value: data.count,
                  pnl: data.pnl,
                  winRate: data.winRate,
                  color: exchColors[ex] || '#64748b',
                }))
                return (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie data={exchData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={3} strokeWidth={0}>
                          {exchData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                          formatter={(value: number, name: string) => [`${value} trades`, name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2">
                      {exchData.map(d => (
                        <div key={d.name} className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="text-xs font-semibold text-white w-12">{d.name}</span>
                          <span className="text-[10px] text-slate-400">{d.value}T &middot; {fmt(d.winRate, 0)}%</span>
                          <span className={`text-[10px] font-mono ml-auto ${d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(d.pnl)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Combined Performance Breakdown — Duration, Position Size, Entry Hour, Lot Count */}
        <div className="card lg:col-span-2">
          <div className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4" /> Performance Breakdown
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
            {/* Duration */}
            {analytics.byConfidence.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-cyan-400 uppercase mb-2">{analytics.confidenceBandTitle}</div>
                <div className="space-y-1.5">
                  {analytics.byConfidence.map(b => {
                    const best = analytics.byConfidence.reduce((a, c) => c.avgPnl > a.avgPnl ? c : a, analytics.byConfidence[0])
                    const isBest = b === best && b.avgPnl > 0
                    return (
                      <div key={b.band} className={`flex items-center gap-2 ${isBest ? 'bg-emerald-500/10 rounded-lg px-1.5 py-0.5' : ''}`}>
                        <span className="text-[10px] font-mono text-cyan-400 w-16 shrink-0">{b.band}</span>
                        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${b.winRate >= 50 ? 'bg-cyan-500' : 'bg-red-500/70'}`} style={{ width: `${b.winRate}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400 w-16 text-right">{b.count}T &middot;{fmt(b.winRate, 0)}%</span>
                        <span className={`text-[10px] font-mono w-16 text-right ${b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(b.pnl)}</span>
                        {isBest && <span className="text-[7px] text-emerald-400 font-bold">BEST</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Position Size */}
            {analytics.byCapital.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-amber-400 uppercase mb-2">Position Size</div>
                <div className="space-y-1.5">
                  {analytics.byCapital.map(b => {
                    const best = analytics.byCapital.reduce((a, c) => c.avgPnl > a.avgPnl ? c : a, analytics.byCapital[0])
                    const isBest = b === best && b.avgPnl > 0
                    return (
                      <div key={b.band} className={`flex items-center gap-2 ${isBest ? 'bg-emerald-500/10 rounded-lg px-1.5 py-0.5' : ''}`}>
                        <span className="text-[10px] font-mono text-amber-400 w-16 shrink-0">{b.band}</span>
                        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${b.winRate >= 50 ? 'bg-amber-500' : 'bg-red-500/70'}`} style={{ width: `${b.winRate}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400 w-16 text-right">{b.count}T &middot;{fmt(b.winRate, 0)}%</span>
                        <span className={`text-[10px] font-mono w-16 text-right ${b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(b.pnl)}</span>
                        {isBest && <span className="text-[7px] text-emerald-400 font-bold">BEST</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Separator between top and bottom row */}
            <div className="sm:col-span-2 border-t border-slate-700/40 my-1" />

            {/* Entry Hour */}
            {analytics.byEntryHour.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-cyan-400 uppercase mb-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Entry Hour (IST)
                </div>
                <div className="space-y-1.5">
                  {analytics.byEntryHour.map(b => {
                    const best = analytics.byEntryHour.reduce((a, c) => c.avgPnl > a.avgPnl ? c : a, analytics.byEntryHour[0])
                    const isBest = b === best && b.avgPnl > 0
                    return (
                      <div key={b.band} className={`flex items-center gap-2 ${isBest ? 'bg-emerald-500/10 rounded-lg px-1.5 py-0.5' : ''}`}>
                        <span className="text-[10px] font-mono text-cyan-400 w-12 shrink-0">{b.band}</span>
                        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${b.winRate >= 50 ? 'bg-cyan-500' : 'bg-red-500/70'}`} style={{ width: `${b.winRate}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400 w-16 text-right">{b.count}T &middot;{fmt(b.winRate, 0)}%</span>
                        <span className={`text-[10px] font-mono w-16 text-right ${b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(b.pnl)}</span>
                        {isBest && <span className="text-[7px] text-emerald-400 font-bold">BEST</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Lot Count */}
            {analytics.byLots.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-indigo-400 uppercase mb-2 flex items-center gap-1">
                  <Layers className="w-3 h-3" /> Lot Count
                </div>
                <div className="space-y-1.5">
                  {analytics.byLots.map(b => {
                    const activeLots = analytics.byLots.filter(l => l.parentCount > 0)
                    const best = activeLots.length > 0 ? activeLots.reduce((a, c) => c.avgPnl > a.avgPnl ? c : a, activeLots[0]) : null
                    const isBest = best && b === best && b.avgPnl > 0
                    const isEmpty = b.parentCount === 0
                    return (
                      <div key={b.lotsLabel} className={`flex items-center gap-2 ${isEmpty ? 'opacity-40' : ''} ${isBest ? 'bg-emerald-500/10 rounded-lg px-1.5 py-0.5' : ''}`}>
                        <span className={`text-[10px] font-mono w-12 shrink-0 ${isEmpty ? 'text-slate-600' : 'text-indigo-400'}`}>{b.lotsLabel} lots</span>
                        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          {!isEmpty && <div className={`h-full rounded-full ${b.winRate >= 50 ? 'bg-indigo-500' : 'bg-red-500/70'}`} style={{ width: `${b.winRate}%` }} />}
                        </div>
                        <span className={`text-[10px] w-16 text-right ${isEmpty ? 'text-slate-600' : 'text-slate-400'}`}>{isEmpty ? '—' : `${b.parentCount}P &middot;${fmt(b.winRate, 0)}%`}</span>
                        <span className={`text-[10px] font-mono w-16 text-right ${isEmpty ? 'text-slate-600' : b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{isEmpty ? '—' : fmtINR(b.pnl)}</span>
                        {isBest && <span className="text-[7px] text-emerald-400 font-bold">BEST</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* R-Multiple Distribution */}
        {analytics.byRBand.length > 0 && (
          <div className="card">
            <div className="text-sm font-semibold text-slate-300 mb-3">R-Multiple Distribution</div>
            <div className="space-y-2">
              {analytics.byRBand.map(b => (
                <div key={b.band} className="flex items-center gap-3">
                  <span className={`text-xs font-mono w-20 shrink-0 ${b.band.includes('-') && !b.band.startsWith('>') ? 'text-red-400' : 'text-emerald-400'}`}>{b.band}</span>
                  <div className="flex-1 h-4 bg-slate-700 rounded overflow-hidden relative">
                    <div
                      className={`h-full rounded ${b.pnl >= 0 ? 'bg-emerald-500/50' : 'bg-red-500/50'}`}
                      style={{ width: `${Math.min((b.count / analytics.totalTrades) * 100, 100)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white font-medium">
                      {b.count} ({fmt((b.count / analytics.totalTrades) * 100, 0)}%)
                    </span>
                  </div>
                  <span className={`text-xs font-mono w-20 text-right ${b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(b.pnl)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Signal Quality Regime Analysis ═══ */}
        {regimeAnalytics && (() => {
          const ra = regimeAnalytics
          const hasData = ra.dataAvailability.some(d => d.pct >= 10)
          const regimeSections: { title: string; color: string; bands: RegimeBand[] }[] = [
            { title: 'Volume Surge', color: 'text-purple-400', bands: ra.regimes.volumeSurge },
            { title: 'OI Change%', color: 'text-orange-400', bands: ra.regimes.oiChange },
            { title: 'ATR (Volatility)', color: 'text-teal-400', bands: ra.regimes.atr },
            { title: 'Risk:Reward', color: 'text-blue-400', bands: ra.regimes.riskReward },
            { title: 'Block Deal%', color: 'text-pink-400', bands: ra.regimes.blockDeal },
          ].filter(s => s.bands.length > 0)

          if (!hasData || regimeSections.length === 0) return null
          return (
            <div className="card lg:col-span-2">
              <div className="text-sm font-semibold text-slate-300 mb-1 flex items-center gap-2">
                <Activity className="w-4 h-4" /> Signal Quality Regime Analysis
              </div>
              <div className="text-[10px] text-slate-500 mb-3">Performance segmented by signal-level metrics — which conditions produce winners vs losers</div>

              {/* Data availability banner */}
              {ra.dataAvailability.every(d => d.pct < 30) && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4 text-[10px] text-amber-400">
                  Signal metrics data is accumulating — {ra.dataAvailability.find(d => d.count > 0)?.count ?? 0} trades with metrics so far.
                  Insights will sharpen as more trades are recorded.
                </div>
              )}

              {/* Column headers */}
              <div className="flex items-center gap-2 mb-2 text-[9px] text-slate-600 uppercase font-semibold">
                <span className="w-16">Band</span>
                <span className="flex-1">Distribution</span>
                <span className="w-8 text-right">N</span>
                <span className="w-10 text-right">WR</span>
                <span className="w-14 text-right">Avg R</span>
                <span className="w-16 text-right">P&L</span>
              </div>

              {/* Regime grids */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                {regimeSections.map(section => {
                  const maxCount = Math.max(...section.bands.map(b => b.count))
                  return (
                    <div key={section.title}>
                      <div className={`text-[11px] font-semibold ${section.color} mb-2`}>{section.title}</div>
                      <div className="space-y-1">
                        {section.bands.map(band => (
                          <RegimeBandRow key={band.label} band={band} maxCount={maxCount} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Per-strategy regime breakdown (ALL view) */}
              {ra.byStrategyRegime && activeStrategy === 'ALL' && Object.keys(ra.byStrategyRegime).length > 1 && (
                <div className="mt-5 border-t border-slate-700/40 pt-4">
                  <div className="text-[11px] font-semibold text-slate-300 mb-3">Strategy x Regime Breakdown</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="border-b border-slate-700/50">
                          <th className="text-left text-slate-500 py-1 pr-2">Strategy</th>
                          <th className="text-center text-purple-400/70 px-2" colSpan={3}>Vol Surge</th>
                          <th className="text-center text-orange-400/70 px-2" colSpan={3}>OI Change</th>
                          <th className="text-center text-blue-400/70 px-2" colSpan={3}>Risk:Reward</th>
                        </tr>
                        <tr className="border-b border-slate-800/50">
                          <th></th>
                          {['<1x','1-2x','2x+','<50%','50-100%','100%+','<1.5','1.5-2.5','2.5+'].map(h => (
                            <th key={h} className="text-[8px] text-slate-600 px-1 py-0.5">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(ra.byStrategyRegime).map(([strat, data]) => (
                          <tr key={strat} className="border-b border-slate-800/30">
                            <td className="py-1.5 pr-2 font-bold text-white">{strat}</td>
                            {[...data.volumeSurge, ...data.oiChange, ...data.riskReward].map((b, i) => (
                              <td key={i} className="text-center px-1">
                                {b.count > 0 ? (
                                  <span className={`font-bold ${b.winRate >= 55 ? 'text-emerald-400' : b.winRate >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                                    {fmt(b.winRate, 0)}%
                                    <span className="text-slate-600 font-normal"> ({b.count})</span>
                                  </span>
                                ) : <span className="text-slate-700">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actionable Insights */}
              {ra.insights.length > 0 && (
                <div className="mt-4 border-t border-slate-700/40 pt-4">
                  <div className="text-[11px] font-semibold text-slate-300 mb-2">Actionable Insights</div>
                  <div className="space-y-1.5">
                    {ra.insights.map((insight, i) => {
                      const isPositive = insight.includes('Strong') || insight.includes('powered')
                      const isWarning = insight.includes('cluster') || insight.includes('consider') || insight.includes('Weak')
                      return (
                        <div key={i} className={`text-[10px] px-3 py-1.5 rounded-lg border-l-2 ${
                          isWarning ? 'border-red-500 bg-red-500/5 text-red-300'
                          : isPositive ? 'border-emerald-500 bg-emerald-500/5 text-emerald-300'
                          : 'border-indigo-500 bg-indigo-500/5 text-slate-300'
                        }`}>
                          {insight}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* Target Progression Funnel */}
        {analytics.targetFunnel.length > 0 && (
          <div className="card">
            <div className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <Target className="w-4 h-4" /> Target Progression Funnel
            </div>
            <div className="space-y-2">
              {analytics.targetFunnel.map(f => {
                const colorMap: Record<string, string> = {
                  'SL Only': 'bg-red-500', 'T1': 'bg-amber-500', 'T2': 'bg-cyan-500', 'T3': 'bg-emerald-500', 'T4': 'bg-green-500',
                }
                const textColorMap: Record<string, string> = {
                  'SL Only': 'text-red-400', 'T1': 'text-amber-400', 'T2': 'text-cyan-400', 'T3': 'text-emerald-400', 'T4': 'text-green-400',
                }
                const isEmpty = f.count === 0
                return (
                  <div key={f.level} className={`flex items-center gap-3 ${isEmpty ? 'opacity-40' : ''}`}>
                    <span className={`text-xs font-semibold w-16 shrink-0 ${isEmpty ? 'text-slate-600' : (textColorMap[f.level] || 'text-slate-400')}`}>{f.level}</span>
                    <div className="flex-1 h-5 bg-slate-700/50 rounded overflow-hidden relative">
                      {!isEmpty && (
                        <div
                          className={`h-full rounded ${colorMap[f.level] || 'bg-slate-500'}`}
                          style={{ width: `${Math.max(f.pctOfTotal, 2)}%`, opacity: 0.6 }}
                        />
                      )}
                      <span className={`absolute inset-0 flex items-center px-2 text-[9px] font-medium ${isEmpty ? 'text-slate-600' : 'text-white'}`}>
                        {isEmpty ? '0 (0%)' : `${f.count} (${fmt(f.pctOfTotal, 0)}%)`}
                      </span>
                    </div>
                    <span className={`text-xs font-mono w-20 text-right ${isEmpty ? 'text-slate-600' : f.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{isEmpty ? '—' : fmtINR(f.pnl)}</span>
                    <span className={`text-[10px] w-16 text-right ${isEmpty ? 'text-slate-600' : 'text-slate-500'}`}>{isEmpty ? '—' : `avg ${fmtINR(f.avgPnl)}`}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Performance by Day of Week */}
        {analytics.byDayOfWeek.length > 0 && (
          <div className="card">
            <div className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Performance by Day
            </div>
            <div className="flex gap-2 justify-between">
              {analytics.byDayOfWeek.map(d => {
                const best = analytics.byDayOfWeek.reduce((a, c) => c.avgPnl > a.avgPnl ? c : a, analytics.byDayOfWeek[0])
                const isBest = d === best && d.avgPnl > 0
                return (
                  <div key={d.day} className={`flex-1 rounded-lg p-2 text-center ${isBest ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-slate-800/60'}`}>
                    <div className="text-[10px] font-semibold text-slate-400 uppercase">{d.dayShort}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{d.count}T</div>
                    <div className={`text-xs font-bold mt-1 ${d.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(d.winRate, 0)}%</div>
                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden mt-1">
                      <div className={`h-full rounded-full ${d.winRate >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${d.winRate}%` }} />
                    </div>
                    <div className={`text-[10px] font-mono mt-1 ${d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(d.pnl)}</div>
                    {isBest && <div className="text-[7px] text-emerald-400 font-bold mt-0.5">BEST</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Performance by Premium Range */}
        {analytics.byPremiumRange.length > 0 && (
          <div className="card">
            <div className="text-sm font-semibold text-slate-300 mb-3">Performance by Premium Range</div>
            <div className="space-y-2">
              {analytics.byPremiumRange.map(b => {
                const best = analytics.byPremiumRange.reduce((a, c) => c.avgPnl > a.avgPnl ? c : a, analytics.byPremiumRange[0])
                const isBest = b === best && b.avgPnl > 0
                const labelColor = b.band.includes('500') ? 'text-indigo-400' : b.band.includes('150') ? 'text-indigo-400' : b.band.includes('50') ? 'text-cyan-400' : b.band.includes('10') && !b.band.startsWith('<') ? 'text-amber-400' : 'text-red-400'
                return (
                  <div key={b.band} className={`flex items-center gap-3 ${isBest ? 'bg-emerald-500/10 rounded-lg px-2 py-1' : ''}`}>
                    <span className={`text-xs font-mono w-20 shrink-0 ${labelColor}`}>{b.band}</span>
                    <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${b.winRate >= 50 ? 'bg-cyan-500' : 'bg-red-500/70'}`} style={{ width: `${b.winRate}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 w-20 text-right">{b.count}T &middot; {fmt(b.winRate, 0)}%</span>
                    <span className={`text-xs font-mono w-20 text-right ${b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(b.pnl)}</span>
                    {isBest && <span className="text-[8px] text-emerald-400 font-bold">BEST</span>}
                  </div>
                )
              })}
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
                  reason === 'SL-T2-R' ? 'bg-cyan-500/15 text-cyan-400' : reason.startsWith('T') ? 'bg-emerald-500/15 text-emerald-400' : reason === 'SL' || reason === 'SL-OP' || reason === 'SL-EQ' ? 'bg-red-500/15 text-red-400' : reason === 'EOD' ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-700 text-slate-400'
                }`}>{reason}</span>
                <span className="text-xs text-slate-500">{data.count} trades</span>
                <span className={`text-xs font-mono ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(data.pnl)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Edge & Risk Profile */}
        <div className="card">
          <div className="text-sm font-semibold text-slate-300 mb-3">Edge & Risk Profile</div>
          {(() => {
            const wr = analytics.winRate / 100
            const avgW = Math.abs(analytics.avgWin)
            const avgL = Math.abs(analytics.avgLoss)
            const rr = avgL > 0 ? avgW / avgL : 0
            const expectancy = avgL > 0 ? (wr * avgW) - ((1 - wr) * avgL) : 0
            const expectancyPct = avgL > 0 ? (expectancy / avgL) * 100 : 0
            const payoffNeeded = wr > 0 ? (1 - wr) / wr : 0
            const edgeSurplus = rr - payoffNeeded
            const kellyPct = avgL > 0 ? ((wr * avgW - (1 - wr) * avgL) / avgW) * 100 : 0
            const consecutive5LossProb = Math.pow(1 - wr, 5) * 100
            const ruinRisk = consecutive5LossProb > 20 ? 'HIGH' : consecutive5LossProb > 5 ? 'MODERATE' : 'LOW'
            const verdictColor = edgeSurplus > 0.3 ? 'text-emerald-400' : edgeSurplus > 0 ? 'text-amber-400' : 'text-red-400'
            const verdictBg = edgeSurplus > 0.3 ? 'bg-emerald-500/10 border-emerald-500/20' : edgeSurplus > 0 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20'
            const verdict = edgeSurplus > 0.3 ? 'Strong Edge' : edgeSurplus > 0 ? 'Marginal Edge' : 'No Edge'

            return (
              <div className="space-y-3">
                {/* Key metrics */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-800/60 rounded-lg p-2">
                    <div className="text-[9px] text-slate-500 uppercase">Risk:Reward</div>
                    <div className={`text-sm font-bold ${rr >= 1.5 ? 'text-emerald-400' : rr >= 1 ? 'text-amber-400' : 'text-red-400'}`}>1:{fmt(rr, 2)}</div>
                    <div className="text-[9px] text-slate-500">Need 1:{fmt(payoffNeeded, 2)} to break even</div>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg p-2">
                    <div className="text-[9px] text-slate-500 uppercase">Expectancy/Trade</div>
                    <div className={`text-sm font-bold ${expectancy >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(expectancy)}</div>
                    <div className="text-[9px] text-slate-500">{expectancyPct >= 0 ? '+' : ''}{fmt(expectancyPct, 0)}% of avg loss</div>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg p-2">
                    <div className="text-[9px] text-slate-500 uppercase">Kelly Criterion</div>
                    <div className={`text-sm font-bold ${kellyPct > 0 ? 'text-cyan-400' : 'text-red-400'}`}>{fmt(Math.max(kellyPct, 0), 1)}%</div>
                    <div className="text-[9px] text-slate-500">Optimal capital per trade</div>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg p-2">
                    <div className="text-[9px] text-slate-500 uppercase">5-Loss Streak Prob</div>
                    <div className={`text-sm font-bold ${ruinRisk === 'LOW' ? 'text-emerald-400' : ruinRisk === 'MODERATE' ? 'text-amber-400' : 'text-red-400'}`}>{fmt(consecutive5LossProb, 1)}%</div>
                    <div className={`text-[9px] ${ruinRisk === 'LOW' ? 'text-emerald-400/60' : ruinRisk === 'MODERATE' ? 'text-amber-400/60' : 'text-red-400/60'}`}>{ruinRisk} risk</div>
                  </div>
                </div>
                {/* Verdict */}
                <div className={`rounded-lg border p-2 text-center ${verdictBg}`}>
                  <div className={`text-sm font-bold ${verdictColor}`}>{verdict}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">
                    {edgeSurplus > 0.3
                      ? `R:R exceeds breakeven by ${fmt(edgeSurplus, 2)} — strategy has a durable edge`
                      : edgeSurplus > 0
                      ? `R:R barely covers breakeven (+${fmt(edgeSurplus, 2)}) — tighten SL or improve entries`
                      : `R:R below breakeven by ${fmt(Math.abs(edgeSurplus), 2)} — win rate or R:R must improve`
                    }
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Premium Decay & Theta Impact */}
        {analytics.premiumErosion && (
          <div className="card lg:col-span-2">
            <div className="text-sm font-semibold text-slate-300 mb-1">Premium Decay & Theta Impact</div>
            <div className="text-[10px] text-slate-500 mb-3">How option premium changes over holding duration — key for timing exits</div>
            {/* Summary Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <div className="bg-slate-800/80 border border-slate-700/50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-400 uppercase">Avg Erosion/hr</div>
                <div className={`text-sm font-bold ${analytics.premiumErosion.summary.avgErosionRate >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {analytics.premiumErosion.summary.avgErosionRate >= 0 ? '+' : ''}{fmt(analytics.premiumErosion.summary.avgErosionRate, 1)}%/hr
                </div>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-center">
                <div className="text-[10px] text-emerald-400/70 uppercase">Avg Winner Gain</div>
                <div className="text-sm font-bold text-emerald-400">+{fmt(analytics.premiumErosion.summary.avgWinPremGain, 1)}%</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center">
                <div className="text-[10px] text-red-400/70 uppercase">Avg Loser Loss</div>
                <div className="text-sm font-bold text-red-400">{fmt(analytics.premiumErosion.summary.avgLossPremLoss, 1)}%</div>
              </div>
              <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-2 text-center">
                <div className="text-[10px] text-cyan-400/70 uppercase">Sweet Spot</div>
                <div className="text-sm font-bold text-cyan-400">{analytics.premiumErosion.summary.sweetSpotBand}</div>
                <div className="text-[9px] text-cyan-400/60">{fmt(analytics.premiumErosion.summary.sweetSpotWR, 0)}% WR</div>
              </div>
            </div>
            {/* Hold Time Insights */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <div className="bg-slate-800/60 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500 uppercase">Option Trades</div>
                <div className="text-xs font-bold text-white">{analytics.premiumErosion.summary.totalOptionTrades}</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500 uppercase">Median Hold</div>
                <div className="text-xs font-bold text-white">{fmtDuration(analytics.premiumErosion.summary.medianHoldMinutes)}</div>
              </div>
              <div className="bg-emerald-500/5 rounded-lg p-2 text-center">
                <div className="text-[9px] text-emerald-400/60 uppercase">Winner Avg Hold</div>
                <div className="text-xs font-bold text-emerald-400">{fmtDuration(analytics.premiumErosion.summary.winAvgHoldMin)}</div>
              </div>
              <div className="bg-red-500/5 rounded-lg p-2 text-center">
                <div className="text-[9px] text-red-400/60 uppercase">Loser Avg Hold</div>
                <div className="text-xs font-bold text-red-400">{fmtDuration(analytics.premiumErosion.summary.lossAvgHoldMin)}</div>
              </div>
            </div>
            {/* Theta Edge Insight */}
            {analytics.premiumErosion.summary.thetaEdge > 0 && (
              <div className={`text-[10px] px-3 py-1.5 rounded-lg mb-4 ${
                analytics.premiumErosion.summary.winAvgHoldMin < analytics.premiumErosion.summary.lossAvgHoldMin
                  ? 'bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400/80 border border-amber-500/20'
              }`}>
                {analytics.premiumErosion.summary.winAvgHoldMin < analytics.premiumErosion.summary.lossAvgHoldMin
                  ? `Winners exit ${fmt(analytics.premiumErosion.summary.lossAvgHoldMin - analytics.premiumErosion.summary.winAvgHoldMin, 0)}min faster than losers — quick exits preserve premium gains`
                  : `Losers exit ${fmt(analytics.premiumErosion.summary.winAvgHoldMin - analytics.premiumErosion.summary.lossAvgHoldMin, 0)}min faster (SL hit) — winners need more time to develop`
                }
              </div>
            )}
            {/* Duration Bands */}
            <div className="text-[10px] text-slate-500 mb-2 uppercase font-medium">Premium Change by Hold Duration</div>
            <div className="space-y-2">
              {analytics.premiumErosion.bands.map(b => {
                const isSweetSpot = b.band === analytics.premiumErosion!.summary.sweetSpotBand
                return (
                  <div key={b.band} className={`flex items-center gap-3 ${isSweetSpot ? 'bg-cyan-500/10 rounded-lg px-2 py-1' : ''}`}>
                    <span className={`text-xs font-mono w-16 shrink-0 ${isSweetSpot ? 'text-cyan-400' : 'text-slate-400'}`}>{b.band}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={b.avgPremiumChange >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {b.avgPremiumChange >= 0 ? '+' : ''}{fmt(b.avgPremiumChange, 1)}% prem
                        </span>
                        <span className="text-slate-500">{fmt(b.avgErosionPerHour, 1)}%/hr</span>
                        <span className={`${b.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(b.winRate, 0)}% WR</span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mt-0.5">
                        <div className={`h-full rounded-full ${b.avgPremiumChange >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.min(Math.abs(b.avgPremiumChange), 100)}%` }} />
                      </div>
                    </div>
                    <span className="text-xs text-slate-500 w-10 text-right">{b.count}T</span>
                    <span className={`text-xs font-mono w-20 text-right ${b.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(b.avgPnl)}</span>
                    {isSweetSpot && <span className="text-[8px] text-cyan-400 font-bold">BEST</span>}
                  </div>
                )
              })}
            </div>

            {/* ═══ Layer 2: Deep Theta Intelligence ═══ */}
            {(() => {
              const pe = analytics.premiumErosion!
              const winGainRate = pe.summary.winAvgHoldMin > 0 ? pe.summary.avgWinPremGain / (pe.summary.winAvgHoldMin / 60) : 0
              const lossBleedRate = pe.summary.lossAvgHoldMin > 0 ? Math.abs(pe.summary.avgLossPremLoss) / (pe.summary.lossAvgHoldMin / 60) : 0
              const velocityRatio = lossBleedRate > 0 ? winGainRate / lossBleedRate : 0
              const thetaCostPerTrade = 0.4 * (pe.summary.avgHoldMinutes / 60) // est. %
              const fastWinPct = pe.bands.find(b => b.band === '<15m')
              const slowLossPct = pe.bands.find(b => b.band === '1-2h' || b.band === '2-4h' || b.band === '4h+')
              const isThetaTrap = slowLossPct && slowLossPct.winRate < 35 && slowLossPct.count >= 3
              const avgHoldHrs = pe.summary.avgHoldMinutes / 60
              const winSpeedAdvantage = pe.summary.winAvgHoldMin < pe.summary.lossAvgHoldMin
                ? ((pe.summary.lossAvgHoldMin - pe.summary.winAvgHoldMin) / pe.summary.lossAvgHoldMin) * 100
                : 0

              return (
                <div className="mt-5 border-t border-slate-700/40 pt-4">
                  <div className="text-[10px] text-slate-500 mb-3 uppercase font-medium">Deep Theta Intelligence</div>

                  {/* Velocity Comparison */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-emerald-400/60 uppercase">Win Premium Speed</div>
                      <div className="text-sm font-bold text-emerald-400">+{fmt(winGainRate, 1)}%/hr</div>
                      <div className="text-[9px] text-slate-500">Avg gain velocity</div>
                    </div>
                    <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-red-400/60 uppercase">Loss Bleed Speed</div>
                      <div className="text-sm font-bold text-red-400">-{fmt(lossBleedRate, 1)}%/hr</div>
                      <div className="text-[9px] text-slate-500">Avg loss velocity</div>
                    </div>
                    <div className={`border rounded-lg p-2 text-center ${velocityRatio >= 1.5 ? 'bg-emerald-500/10 border-emerald-500/20' : velocityRatio >= 1 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                      <div className="text-[9px] text-slate-400 uppercase">Velocity Ratio</div>
                      <div className={`text-sm font-bold ${velocityRatio >= 1.5 ? 'text-emerald-400' : velocityRatio >= 1 ? 'text-amber-400' : 'text-red-400'}`}>{fmt(velocityRatio, 2)}x</div>
                      <div className="text-[9px] text-slate-500">{velocityRatio >= 1.5 ? 'Winners move faster' : velocityRatio >= 1 ? 'Balanced' : 'Losers bleed faster'}</div>
                    </div>
                    <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-purple-400/60 uppercase">Est. Theta Drag</div>
                      <div className="text-sm font-bold text-purple-400">-{fmt(thetaCostPerTrade, 2)}%</div>
                      <div className="text-[9px] text-slate-500">Per trade @ {fmt(avgHoldHrs, 1)}hr avg</div>
                    </div>
                  </div>

                  {/* Theta Trap Alert + Win Speed Advantage */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    {isThetaTrap ? (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-red-400">THETA TRAP DETECTED</span>
                        </div>
                        <div className="text-[9px] text-red-400/80">
                          Long-hold trades ({slowLossPct!.band}) show {fmt(slowLossPct!.winRate, 0)}% WR across {slowLossPct!.count} trades.
                          Premium decays while waiting — consider tighter time-based exits.
                        </div>
                      </div>
                    ) : (
                      <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-emerald-400">No Theta Trap</span>
                        </div>
                        <div className="text-[9px] text-emerald-400/70">
                          Long-hold trades aren't systematically losing to theta decay. Exit timing is healthy.
                        </div>
                      </div>
                    )}
                    <div className={`rounded-lg p-2.5 border ${winSpeedAdvantage > 20 ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-slate-800/60 border-slate-700/40'}`}>
                      <div className="text-xs font-bold text-cyan-400 mb-1">
                        {winSpeedAdvantage > 0 ? `Winners ${fmt(winSpeedAdvantage, 0)}% Faster` : 'Losers Exit Faster (SL)'}
                      </div>
                      <div className="text-[9px] text-slate-400">
                        {winSpeedAdvantage > 20
                          ? `Winners capture gains in ${fmtDuration(pe.summary.winAvgHoldMin)} vs losers bleeding for ${fmtDuration(pe.summary.lossAvgHoldMin)} — directional conviction is working`
                          : winSpeedAdvantage > 0
                          ? `Marginal speed difference (${fmtDuration(pe.summary.winAvgHoldMin)} vs ${fmtDuration(pe.summary.lossAvgHoldMin)}) — theta impact similar for both`
                          : `SL hits fast (${fmtDuration(pe.summary.lossAvgHoldMin)}), winners need time (${fmtDuration(pe.summary.winAvgHoldMin)}) — signals need development time`
                        }
                      </div>
                    </div>
                  </div>

                  {/* Quick Win vs Slow Win breakdown */}
                  {fastWinPct && (
                    <div className="bg-slate-800/40 rounded-lg p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold text-white">Speed vs Patience Trade-off</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-[10px]">
                        <div>
                          <div className="text-cyan-400 font-bold">Quick (&lt;15m)</div>
                          <div className="text-slate-400">{fastWinPct.count}T &middot; {fmt(fastWinPct.winRate, 0)}% WR</div>
                          <div className={`font-mono ${fastWinPct.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>avg {fmtINR(fastWinPct.avgPnl)}</div>
                          <div className="text-slate-500 text-[9px]">Theta: negligible</div>
                        </div>
                        {pe.bands.filter(b => b.band === '15-30m' || b.band === '30-60m').map(b => (
                          <div key={b.band}>
                            <div className="text-amber-400 font-bold">{b.band}</div>
                            <div className="text-slate-400">{b.count}T &middot; {fmt(b.winRate, 0)}% WR</div>
                            <div className={`font-mono ${b.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>avg {fmtINR(b.avgPnl)}</div>
                            <div className="text-slate-500 text-[9px]">Theta: -{fmt(0.4 * (b.band === '15-30m' ? 0.375 : 0.75), 2)}%</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

      </div>

      {/* Strategy Curve, Drawdown, R-Multiples & Streak Analysis */}
      {chartsData.length > 0 && (
        <div className="card">
          <div className="text-sm font-semibold text-slate-300 mb-3">{activeStrategy === 'ALL' ? 'Portfolio' : activeStrategy} Curve & Drawdown</div>
          <PerformanceCharts trades={chartsData} initialCapital={initialCapital} activeStrategy={activeStrategy} />
        </div>
      )}

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
                <span className="text-[10px] text-slate-500">{data.count}T ·{data.wins}W</span>
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
    </div>
  )
}

// Re-export StatCard for use in other components if needed
export { StatCard, getStrategyBadgeClass as _getStrategyBadgeClass }
