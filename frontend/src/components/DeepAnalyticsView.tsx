import { useState } from 'react'
import { Activity } from 'lucide-react'
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell } from 'recharts'
import type { AnalyticsResult, AdvancedAnalyticsResult } from '../utils/tradeAnalytics'
import { fmt, fmtINR, corrColor, corrBg } from '../utils/tradeAnalytics'

type ExchangeTag = 'ALL' | 'NSE' | 'MCX' | 'CDS'
const EXCHANGE_TAG_TO_CODE: Record<ExchangeTag, string | null> = { ALL: null, NSE: 'N', MCX: 'M', CDS: 'C' }

interface DeepAnalyticsViewProps {
  analytics: AnalyticsResult
  advAnalytics: AdvancedAnalyticsResult
}

export default function DeepAnalyticsView({ analytics, advAnalytics }: DeepAnalyticsViewProps) {
  const [activeScatter, setActiveScatter] = useState<string | null>(null)
  const [hourExTab, setHourExTab] = useState<ExchangeTag>('ALL')

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
                {Math.abs(analytics.avgLoss) > 0 ? fmt(Math.abs(analytics.avgWin) / Math.abs(analytics.avgLoss), 2) : '\u221E'}x
              </div>
            </div>
          </div>
        </div>

        {/* Hour of Day Performance -- with exchange bifurcation */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-slate-300">Performance by Hour (IST)</div>
            <div className="flex bg-slate-800 rounded-lg p-0.5">
              {(['ALL', 'NSE', 'MCX', 'CDS'] as ExchangeTag[]).map(tag => (
                <button key={tag} onClick={() => setHourExTab(tag)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${
                    hourExTab === tag
                      ? tag === 'NSE' ? 'bg-blue-600/80 text-white' : tag === 'MCX' ? 'bg-amber-600/80 text-white' : tag === 'CDS' ? 'bg-purple-600/80 text-white' : 'bg-indigo-600/80 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >{tag}</button>
              ))}
            </div>
          </div>
          {(() => {
            const exCode = EXCHANGE_TAG_TO_CODE[hourExTab]
            const hourData = exCode && analytics.byHourExchange[exCode]
              ? analytics.byHourExchange[exCode]
              : analytics.byHour
            const sortedHours = Object.entries(hourData).sort((a, b) => Number(a[0]) - Number(b[0]))
            const totalPnl = sortedHours.reduce((s, [, d]) => s + d.pnl, 0)
            const totalCount = sortedHours.reduce((s, [, d]) => s + d.count, 0)
            const totalWins = sortedHours.reduce((s, [, d]) => s + d.wins, 0)
            return (
              <>
                {totalCount > 0 && (
                  <div className="flex gap-3 mb-2 text-[10px]">
                    <span className="text-slate-500">{hourExTab !== 'ALL' ? hourExTab : 'All'}: <span className="text-white font-medium">{totalCount}</span> trades</span>
                    <span className={totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtINR(totalPnl)}</span>
                    <span className="text-slate-500">WR: <span className="text-white">{totalCount > 0 ? Math.round((totalWins / totalCount) * 100) : 0}%</span></span>
                  </div>
                )}
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sortedHours.map(([h, d]) => ({
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
                        {sortedHours.map(([h, d]) => (
                          <Cell key={h} fill={d.pnl >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {sortedHours.map(([h, d]) => (
                    <div key={h} className="text-[9px] text-center bg-slate-800 rounded px-1.5 py-0.5">
                      <span className="text-slate-500">{h}h</span>{' '}
                      <span className={d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{d.count}T/{Math.round((d.wins / d.count) * 100)}%</span>
                    </div>
                  ))}
                </div>
                {totalCount === 0 && hourExTab !== 'ALL' && (
                  <div className="text-center text-slate-600 text-xs py-8">No {hourExTab} trades this week</div>
                )}
              </>
            )
          })()}
        </div>
      </div>

      {/* Correlation Matrix */}
      <div className="card">
        <div className="text-sm font-semibold text-slate-300 mb-1">Correlation Matrix -- Metric vs P&L%</div>
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
              {' \u00B7 '}{scatterData[activeScatter].length} trades
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
                          <span className="text-[10px] text-slate-400 w-14 text-right">{z.count}T ·{fmt(z.winRate, 0)}%</span>
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
            value={analytics.profitFactor === Infinity ? '\u221E' : fmt(analytics.profitFactor, 2)}
            label="Profit Factor"
            status={analytics.profitFactor > 1.5 ? 'good' : analytics.profitFactor > 1 ? 'neutral' : 'bad'}
            hint={analytics.profitFactor > 1.5 ? 'Strong edge -- keep current approach' : analytics.profitFactor > 1 ? 'Marginal edge -- tighten parameters' : 'Negative edge -- needs parameter overhaul'}
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
            hint={analytics.winRate >= 55 ? 'Consistent hit rate' : analytics.winRate >= 45 ? 'Acceptable, focus on R improvement' : 'Low win rate -- check entry filters'}
          />
          <InsightCard
            title="Reward Quality"
            value={`${analytics.avgR >= 0 ? '+' : ''}${fmt(analytics.avgR, 2)}R`}
            label="Avg R-Multiple"
            status={analytics.avgR >= 0.5 ? 'good' : analytics.avgR >= 0 ? 'neutral' : 'bad'}
            hint={analytics.avgR >= 0.5 ? 'Good reward capture' : analytics.avgR >= 0 ? 'Marginal -- let winners run more' : 'Cutting winners too early'}
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
