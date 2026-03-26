import { useState, useEffect, useCallback } from 'react'
import { riskApi } from '../../services/api'
import { getStrategyColors } from '../../utils/strategyColors'
import type { TradeIntelligenceReport } from '../../types'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'

interface TradeIntelligenceTabProps {
  dateRange: { from: number | null; to: number | null }
  strategyFilter: string
  exchangeFilter: string
}

// ─── Helpers ───────────────────────────────────────────────
const fmtINR = (v: number | null | undefined) => {
  if (v == null || isNaN(v)) return '₹0'
  const abs = Math.abs(v)
  if (abs >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`
  if (abs >= 100000) return `₹${(v / 100000).toFixed(2)}L`
  if (abs >= 1000) return `₹${(v / 1000).toFixed(1)}K`
  return `₹${v.toFixed(0)}`
}

const pct = (v: number | null | undefined, decimals = 1) => {
  if (v == null || isNaN(v)) return '0%'
  return `${v.toFixed(decimals)}%`
}

const fmtDuration = (mins: number) => {
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins.toFixed(0)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const EXIT_COLORS: Record<string, string> = {
  SL: '#ef4444',
  T1: '#34d399',
  T2: '#10b981',
  T3: '#60a5fa',
  T4: '#3b82f6',
  EOD: '#eab308',
  Other: '#64748b',
}

const R_BUCKET_COLORS: Record<string, string> = {
  '<-2R': '#991b1b',
  '-2R to -1R': '#dc2626',
  '-1R to 0R': '#f87171',
  '0R to 1R': '#86efac',
  '1R to 2R': '#22c55e',
  '2R to 3R': '#16a34a',
  '>3R': '#15803d',
}

const assessmentBadge = (assessment: string) => {
  switch (assessment) {
    case 'BEST': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
    case 'GOOD': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    case 'CAUTION': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
    case 'AVOID': return 'bg-red-500/20 text-red-400 border-red-500/40'
    case 'NO_ENTRIES': return 'bg-red-500/10 text-red-300 border-red-500/30'
    default: return 'bg-slate-500/20 text-slate-400 border-slate-500/40'
  }
}

// ─── Skeleton Placeholder ──────────────────────────────────
function SkeletonBlock({ h = 'h-48' }: { h?: string }) {
  return <div className={`card animate-pulse`}><div className={`${h} bg-slate-700 rounded`} /></div>
}

// ─── Section Header ────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

// ─── Insight Box ───────────────────────────────────────────
function InsightBox({ text, variant = 'info' }: { text: string; variant?: 'info' | 'warning' | 'success' }) {
  const colors = variant === 'warning'
    ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'
    : variant === 'success'
    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
    : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
  return (
    <div className={`mt-3 p-3 rounded-lg border text-xs ${colors}`}>
      <span className="font-medium">KEY INSIGHT: </span>{text}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────
export default function TradeIntelligenceTab({ dateRange, strategyFilter, exchangeFilter }: TradeIntelligenceTabProps) {
  const [data, setData] = useState<TradeIntelligenceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set())

  const loadData = useCallback(async () => {
    try {
      const params: { from?: number; to?: number; strategy?: string; exchange?: string } = {}
      if (dateRange.from) params.from = dateRange.from
      if (dateRange.to) params.to = dateRange.to
      if (strategyFilter && strategyFilter !== 'ALL') params.strategy = strategyFilter
      if (exchangeFilter && exchangeFilter !== 'ALL') params.exchange = exchangeFilter
      const result = await riskApi.getTradeIntelligence(params)
      setData(result)
      setError(null)
    } catch {
      setError('Failed to load trade intelligence data')
    } finally {
      setLoading(false)
    }
  }, [dateRange.from, dateRange.to, strategyFilter, exchangeFilter])

  useEffect(() => {
    setLoading(true)
    loadData()
    const interval = setInterval(loadData, 60000)
    return () => clearInterval(interval)
  }, [loadData])

  const toggleCluster = (name: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  // ─── Loading State ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonBlock h="h-24" />
        <SkeletonBlock h="h-64" />
        <SkeletonBlock h="h-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonBlock h="h-48" />
          <SkeletonBlock h="h-48" />
        </div>
        <SkeletonBlock h="h-48" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center text-slate-500 py-12">
        <p>No data available for this period</p>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>
    )
  }

  const { periodSummary: ps, exitDistribution, targetFunnel: tf, rMultipleDistribution,
    meanR, medianR, percentAbove1R, timeOfDayHeatmap, durationByOutcome,
    topInstruments, bottomInstruments, lossClusterAnalysis,
    periodComparison, strategyCorrelation,
    directionalAnalysis, dayOfWeekPerformance, strategyExchangeMatrix,
    confidenceAnalysis, partialExitAnalysis, streakAnalysis,
    holdingPeriodAnalysis, riskRewardAnalysis } = data

  // ─── Exit Distribution insights ─────────────────────────────
  const exitInsights: { text: string; variant: 'info' | 'warning' | 'success' }[] = []
  const exitEntries = Object.values(exitDistribution)
  for (const ed of exitEntries) {
    if (ed.slPercent > 45) {
      const totalSlCost = ed.slCount * Math.abs(ed.avgSlLoss)
      const estimatedSavings = Math.round(ed.slCount * 0.12)
      exitInsights.push({
        text: `${ed.strategy} SL hit rate is ${ed.slPercent.toFixed(1)}% — ${ed.slCount} trades hit SL. At avg loss of ${fmtINR(ed.avgSlLoss)}, this cost ${fmtINR(totalSlCost)}. ACTION: Widening SL by 0.3x ATR would save ~${estimatedSavings} trades. Also review entry timing — are you entering at candle open instead of waiting for confirmation?`,
        variant: 'warning',
      })
    }
    if (ed.slWithin5MinPercent > 60) {
      const quickSlCount = Math.round(ed.slCount * ed.slWithin5MinPercent / 100)
      exitInsights.push({
        text: `${ed.slWithin5MinPercent.toFixed(0)}% of ${ed.strategy} SL hits (${quickSlCount} trades) occur within 5min — this is an entry timing problem, not an SL distance problem. ACTION: Add a 2-candle confirmation delay before entry, or require price to hold above VWAP for 1 candle post-signal.`,
        variant: 'warning',
      })
    }
  }

  // ─── Best/Worst hour insights ─────────────────────────────
  const bestHour = timeOfDayHeatmap.reduce((best, h) => h.avgPnl > best.avgPnl ? h : best, timeOfDayHeatmap[0])
  const worstHour = timeOfDayHeatmap.reduce((worst, h) => h.avgPnl < worst.avgPnl ? h : worst, timeOfDayHeatmap[0])

  // ─── Exit distribution chart data ───────────────────────────
  const exitChartData = exitEntries.map(ed => ({
    strategy: ed.strategy,
    SL: ed.slPercent,
    T1: ed.t1Percent,
    T2: ed.t2Percent,
    T3: ed.t3Percent,
    T4: ed.t4Percent,
    EOD: ed.eodPercent,
    Other: ed.otherPercent,
  }))

  // ─── Duration chart data ─────────────────────────────────────
  const durationChartData = durationByOutcome.map(d => ({
    exitType: d.exitType,
    avgMin: d.avgDurationMin,
    medianMin: d.medianDurationMin,
    count: d.count,
  }))

  const durationExitColor = (exitType: string) => EXIT_COLORS[exitType] || EXIT_COLORS.Other

  // Date range label for display
  const dateLabel = (() => {
    if (!dateRange.from && !dateRange.to) return 'All Time'
    const fmt = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    if (dateRange.from && dateRange.to) return `${fmt(dateRange.from)} – ${fmt(dateRange.to)}`
    if (dateRange.from) return `From ${fmt(dateRange.from)}`
    return 'All Time'
  })()

  return (
    <div className="space-y-6">
      {/* ─── Date Range Indicator ─────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Showing data for:</span>
          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-medium rounded border border-blue-500/30">
            {dateLabel}
          </span>
          <span className="text-xs text-slate-600">|</span>
          <span className="text-xs text-slate-400">{ps.totalTrades} trades analysed</span>
        </div>
      </div>

      {/* ─── 1. Period Summary Banner ─────────────────────────────── */}
      <div className="card bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-4">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total Trades</div>
            <div className="text-xl font-bold text-white">{ps.totalTrades}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Win Rate</div>
            <div className={`text-xl font-bold ${ps.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
              {pct(ps.winRate)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Net P&L</div>
            <div className={`text-xl font-bold ${ps.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(ps.totalPnl)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Avg/Trade</div>
            <div className={`text-xl font-bold ${ps.avgPnlPerTrade >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(ps.avgPnlPerTrade)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Best Day</div>
            <div className="text-sm font-medium text-emerald-400">{fmtINR(ps.bestDayPnl)}</div>
            <div className="text-[10px] text-slate-500">{ps.bestDay || 'DM'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Worst Day</div>
            <div className="text-sm font-medium text-red-400">{fmtINR(ps.worstDayPnl)}</div>
            <div className="text-[10px] text-slate-500">{ps.worstDay || 'DM'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Profitable Days</div>
            <div className="text-xl font-bold text-white">
              {ps.profitableDays}<span className="text-sm text-slate-500">/{ps.totalTradingDays}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">SL Rate</div>
            <div className={`text-xl font-bold ${ps.slRate > 40 ? 'text-red-400' : ps.slRate > 30 ? 'text-yellow-400' : 'text-emerald-400'}`}>
              {pct(ps.slRate)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Expectancy</div>
            <div className={`text-xl font-bold ${meanR >= 0.3 ? 'text-emerald-400' : meanR >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
              {meanR.toFixed(2)}R
            </div>
            <div className="text-[10px] text-slate-500">{fmtINR(ps.avgPnlPerTrade)}/trade</div>
          </div>
        </div>
      </div>

      {/* ─── 2. Exit Distribution Chart ───────────────────────────── */}
      <div className="card">
        <SectionHeader title="Exit Distribution" subtitle="Breakdown of trade exits by type per strategy" />
        {exitChartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-slate-500">No exit data available</div>
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={exitChartData} layout="vertical" margin={{ top: 5, right: 30, left: 60, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
                  <YAxis type="category" dataKey="strategy" tick={{ fill: '#94a3b8', fontSize: 11 }} width={80} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
                    formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
                  />
                  <Bar dataKey="SL" stackId="exit" fill={EXIT_COLORS.SL} />
                  <Bar dataKey="T1" stackId="exit" fill={EXIT_COLORS.T1} />
                  <Bar dataKey="T2" stackId="exit" fill={EXIT_COLORS.T2} />
                  <Bar dataKey="T3" stackId="exit" fill={EXIT_COLORS.T3} />
                  <Bar dataKey="T4" stackId="exit" fill={EXIT_COLORS.T4} />
                  <Bar dataKey="EOD" stackId="exit" fill={EXIT_COLORS.EOD} />
                  <Bar dataKey="Other" stackId="exit" fill={EXIT_COLORS.Other} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-2 text-xs">
              {Object.entries(EXIT_COLORS).map(([key, color]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                  <span className="text-slate-400">{key}</span>
                </div>
              ))}
            </div>
            {exitInsights.map((insight, i) => (
              <InsightBox key={i} text={insight.text} variant={insight.variant} />
            ))}
          </>
        )}
      </div>

      {/* ─── 3. Target Progression Funnel ─────────────────────────── */}
      <div className="card">
        <SectionHeader title="Target Progression Funnel" subtitle="Trade survival through successive targets" />
        {tf.totalTrades === 0 ? (
          <div className="h-32 flex items-center justify-center text-sm text-slate-500">No funnel data available</div>
        ) : (
          <>
            <div className="space-y-3">
              {[
                { label: 'Entry', rate: 100, count: tf.totalTrades, color: 'bg-slate-500' },
                { label: 'T1 Hit', rate: tf.t1HitRate, count: Math.round(tf.totalTrades * tf.t1HitRate / 100), color: 'bg-emerald-400' },
                { label: 'T2 Hit', rate: tf.t2HitRate, count: Math.round(tf.totalTrades * tf.t2HitRate / 100), color: 'bg-emerald-500' },
                { label: 'T3 Hit', rate: tf.t3HitRate, count: Math.round(tf.totalTrades * tf.t3HitRate / 100), color: 'bg-blue-400' },
                { label: 'T4 Hit', rate: tf.t4HitRate, count: Math.round(tf.totalTrades * tf.t4HitRate / 100), color: 'bg-blue-500' },
              ].map(step => (
                <div key={step.label} style={{ width: `${Math.max(step.rate, 5)}%` }} className="mx-auto">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-300 font-medium">{step.label}</span>
                    <span className="text-xs text-slate-400">{pct(step.rate)} ({step.count})</span>
                  </div>
                  <div className="h-7 bg-slate-700 rounded overflow-hidden">
                    <div
                      className={`h-full ${step.color} rounded transition-all flex items-center justify-center`}
                      style={{ width: `${Math.max(step.rate, 2)}%` }}
                    >
                      <span className="text-[10px] font-bold text-white/90">{pct(step.rate)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Conversion rates */}
            <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-400">
              <span>T1 → T2: <span className="text-white font-medium">{pct(tf.t1ToT2Conversion)}</span></span>
              <span>T2 → T3: <span className="text-white font-medium">{pct(tf.t2ToT3Conversion)}</span></span>
              <span>T3 → T4: <span className="text-white font-medium">{pct(tf.t3ToT4Conversion)}</span></span>
            </div>
            {/* Avg times */}
            <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-500">
              <span>Avg to T1: {fmtDuration(tf.avgTimeToT1Min)}</span>
              <span>Avg to T2: {fmtDuration(tf.avgTimeToT2Min)}</span>
              <span>Avg to T3: {fmtDuration(tf.avgTimeToT3Min)}</span>
              <span>Avg to T4: {fmtDuration(tf.avgTimeToT4Min)}</span>
            </div>
            <InsightBox
              text={
                tf.t1HitRate >= 60
                  ? `Strong T1 conversion at ${pct(tf.t1HitRate)}. ${tf.t1ToT2Conversion < 40 ? 'However, T1→T2 conversion is weak — consider trailing stop optimization.' : 'Healthy progression through targets.'}`
                  : `T1 hit rate at ${pct(tf.t1HitRate)} is below optimal (>60%). Review entry quality and target distance.`
              }
              variant={tf.t1HitRate >= 60 ? 'success' : 'warning'}
            />
          </>
        )}
      </div>

      {/* ─── 4. R-Multiple Distribution ───────────────────────────── */}
      <div className="card">
        <SectionHeader title="R-Multiple Distribution" subtitle="Trade outcomes measured in risk units" />
        {rMultipleDistribution.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-slate-500">No R-multiple data available</div>
        ) : (
          <>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rMultipleDistribution} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="range" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(value: number, name: string) => {
                      if (name === 'percent') return [`${value.toFixed(1)}%`, 'of trades']
                      return [fmtINR(value), 'Avg P&L']
                    }}
                  />
                  <Bar dataKey="percent" radius={[4, 4, 0, 0]}>
                    {rMultipleDistribution.map((entry, idx) => (
                      <Cell key={idx} fill={R_BUCKET_COLORS[entry.range] || '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-6 mt-3 text-xs">
              <span className="text-slate-400">Mean R: <span className={`font-bold ${meanR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{meanR.toFixed(2)}</span></span>
              <span className="text-slate-400">Median R: <span className={`font-bold ${medianR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{medianR.toFixed(2)}</span></span>
              <span className="text-slate-400">Trades &gt; 1R: <span className="font-bold text-white">{pct(percentAbove1R)}</span></span>
            </div>
            <InsightBox
              text={
                meanR > 0 && medianR < 0
                  ? `Mean R is positive (${meanR.toFixed(2)}) but Median is negative (${medianR.toFixed(2)}) — your system depends on rare big winners. ACTION: Protect runners aggressively — never tighten trailing SL after T2. Cut position size by 30% if avg winner R drops below 2.0. ${pct(percentAbove1R)} of trades exceed 1R.`
                  : meanR > medianR * 1.5
                  ? `Mean R (${meanR.toFixed(2)}) significantly exceeds Median R (${medianR.toFixed(2)}) — tail wins drive profitability. IMPACT: ${pct(percentAbove1R)} of trades are above 1R but most trades are losers. ACTION: Do not reduce position size on winners. Let T3/T4 runners ride — they are carrying the P&L.`
                  : meanR < 0 && medianR < 0
                  ? `Both Mean R (${meanR.toFixed(2)}) and Median R (${medianR.toFixed(2)}) are negative — the system is losing money per unit of risk. ACTION: Pause live trading. Tighten entry criteria (raise min conviction by 10pts) and widen SL by 0.2x ATR to reduce noise exits.`
                  : meanR < medianR * 0.5
                  ? `Mean R (${meanR.toFixed(2)}) trails Median R (${medianR.toFixed(2)}) — a few large outlier losses are destroying edge. ACTION: Add a hard -2R max loss cap per trade. Review the bottom 5 trades for common patterns (same hour? same scrip?).`
                  : `Mean R (${meanR.toFixed(2)}) and Median R (${medianR.toFixed(2)}) are aligned — consistent risk-adjusted returns. ${pct(percentAbove1R)} of trades exceed 1R. System edge is stable.`
              }
              variant={meanR >= 0.5 ? 'success' : meanR >= 0 ? 'info' : 'warning'}
            />
          </>
        )}
      </div>

      {/* ─── 5. Performance by Hour (Heatmap) ─────────────────────── */}
      <div className="card">
        <SectionHeader title="Performance by Hour" subtitle="Intraday performance breakdown" />
        {timeOfDayHeatmap.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-sm text-slate-500">No hourly data available</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700">
                    <th className="text-left py-2 px-2">Hour</th>
                    <th className="text-right py-2 px-2">Trades</th>
                    <th className="text-right py-2 px-2">WinRate</th>
                    <th className="text-right py-2 px-2">Avg P&L</th>
                    <th className="text-right py-2 px-2">SL%</th>
                    <th className="text-center py-2 px-2">Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {timeOfDayHeatmap.map(h => (
                    <tr key={h.hour} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="py-2 px-2 text-white font-medium">{String(h.hour).padStart(2, '0')}:00</td>
                      <td className="py-2 px-2 text-right text-slate-300">{h.trades}</td>
                      <td className={`py-2 px-2 text-right font-medium ${h.winRate >= 55 ? 'text-emerald-400' : h.winRate >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {pct(h.winRate)}
                      </td>
                      <td className={`py-2 px-2 text-right font-medium ${h.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtINR(h.avgPnl)}
                      </td>
                      <td className={`py-2 px-2 text-right ${h.slPercent > 40 ? 'text-red-400' : 'text-slate-300'}`}>
                        {pct(h.slPercent)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${assessmentBadge(h.assessment)}`}>
                          {h.assessment}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bestHour && worstHour && timeOfDayHeatmap.length > 0 && (() => {
              const avoidHours = timeOfDayHeatmap.filter(h => h.assessment === 'AVOID')
              const avoidHourList = avoidHours.map(h => `${String(h.hour).padStart(2, '0')}:00`).join(', ')
              const avoidTrades = avoidHours.reduce((sum, h) => sum + h.trades, 0)
              const avoidLoss = avoidHours.reduce((sum, h) => sum + (h.avgPnl * h.trades), 0)
              return (
                <InsightBox
                  text={`Best hour: ${String(bestHour.hour).padStart(2, '0')}:00 (${pct(bestHour.winRate)} WR, avg ${fmtINR(bestHour.avgPnl)}, ${bestHour.trades} trades). Worst hour: ${String(worstHour.hour).padStart(2, '0')}:00 (${pct(worstHour.winRate)} WR, avg ${fmtINR(worstHour.avgPnl)}, ${worstHour.trades} trades).${avoidHours.length > 0 ? ` AVOID hours [${avoidHourList}] produced ${avoidTrades} trades with net P&L of ${fmtINR(avoidLoss)}. ACTION: Disable entries during these hours — this alone would have saved ${fmtINR(Math.abs(avoidLoss))}.` : ' No hours flagged as AVOID — timing is healthy.'}`}
                  variant={avoidHours.length > 0 ? 'warning' : 'info'}
                />
              )
            })()}
          </>
        )}
      </div>

      {/* ─── 6. Duration vs Outcome ───────────────────────────────── */}
      <div className="card">
        <SectionHeader title="Duration vs Outcome" subtitle="Average hold time by exit type" />
        {durationChartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-slate-500">No duration data available</div>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={durationChartData} layout="vertical" margin={{ top: 5, right: 30, left: 50, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v: number) => fmtDuration(v)} />
                <YAxis type="category" dataKey="exitType" tick={{ fill: '#94a3b8', fontSize: 11 }} width={50} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#e2e8f0' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'avgMin') return [fmtDuration(value), 'Avg Duration']
                    return [value, name]
                  }}
                />
                <Bar dataKey="avgMin" radius={[0, 4, 4, 0]}>
                  {durationChartData.map((entry, idx) => (
                    <Cell key={idx} fill={durationExitColor(entry.exitType)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ─── 7. Instrument Performance ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Winners */}
        <div className="card">
          <SectionHeader title="Top Winners" />
          {topInstruments.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-sm text-slate-500">No data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700">
                    <th className="text-left py-2 px-2">Scrip</th>
                    <th className="text-right py-2 px-2">Trades</th>
                    <th className="text-right py-2 px-2">WR</th>
                    <th className="text-right py-2 px-2">Total P&L</th>
                    <th className="text-right py-2 px-2">AvgR</th>
                  </tr>
                </thead>
                <tbody>
                  {topInstruments.map(inst => (
                    <tr key={inst.scripCode} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="py-2 px-2">
                        <div className="text-white font-medium text-xs">{inst.companyName || inst.scripCode}</div>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-300">{inst.trades}</td>
                      <td className={`py-2 px-2 text-right font-medium ${inst.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pct(inst.winRate)}
                      </td>
                      <td className="py-2 px-2 text-right text-emerald-400 font-medium">{fmtINR(inst.totalPnl)}</td>
                      <td className={`py-2 px-2 text-right ${inst.avgRMultiple >= 1 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                        {inst.avgRMultiple.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Worst Losers */}
        <div className="card">
          <SectionHeader title="Worst Losers" />
          {bottomInstruments.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-sm text-slate-500">No data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700">
                    <th className="text-left py-2 px-2">Scrip</th>
                    <th className="text-right py-2 px-2">Trades</th>
                    <th className="text-right py-2 px-2">Loss Rate</th>
                    <th className="text-right py-2 px-2">Total P&L</th>
                    <th className="text-right py-2 px-2">Avg Loss</th>
                    <th className="text-right py-2 px-2">SL%</th>
                  </tr>
                </thead>
                <tbody>
                  {bottomInstruments.map(inst => {
                    const lossRate = 100 - inst.winRate
                    return (
                    <tr key={inst.scripCode} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="py-2 px-2">
                        <div className="text-white font-medium text-xs">{inst.companyName || inst.scripCode}</div>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-300">{inst.trades}</td>
                      <td className={`py-2 px-2 text-right font-medium ${lossRate >= 50 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {pct(lossRate)}
                      </td>
                      <td className="py-2 px-2 text-right text-red-400 font-medium">{fmtINR(inst.totalPnl)}</td>
                      <td className="py-2 px-2 text-right text-red-400">{fmtINR(inst.avgPnl)}</td>
                      <td className={`py-2 px-2 text-right ${inst.slPercent > 50 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {pct(inst.slPercent)}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ─── 8. Loss Cluster Analysis ─────────────────────────────── */}
      {lossClusterAnalysis.length > 0 && (
        <div className="card">
          <SectionHeader title="Loss Cluster Analysis" subtitle="Detected patterns in losing trades" />
          <div className="space-y-2">
            {lossClusterAnalysis.map(cluster => {
              const isExpanded = expandedClusters.has(cluster.name)
              const isCritical = cluster.percentOfLosses > 30
              return (
                <div
                  key={cluster.name}
                  className={`rounded-lg border transition-colors ${
                    isCritical ? 'border-l-4 border-l-red-500 border-t-slate-700 border-r-slate-700 border-b-slate-700' : 'border-slate-700'
                  } bg-slate-800/50`}
                >
                  <button
                    onClick={() => toggleCluster(cluster.name)}
                    className="w-full flex items-center justify-between p-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-medium ${isCritical ? 'text-red-400' : 'text-white'}`}>
                        {cluster.name}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isCritical ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {pct(cluster.percentOfLosses)} of losses
                      </span>
                      <span className="text-xs text-slate-500">{cluster.tradeCount} trades</span>
                    </div>
                    <span className="text-slate-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-slate-700/50 pt-2">
                      <p className="text-xs text-slate-400">{cluster.description}</p>
                      <div className="flex gap-4 text-xs text-slate-500">
                        <span>Avg P&L: <span className="text-red-400 font-medium">{fmtINR(cluster.avgPnl)}</span></span>
                        <span>Avg Confidence: <span className="text-white">{cluster.avgConfidence.toFixed(0)}%</span></span>
                      </div>
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2 text-xs text-blue-300">
                        <span className="font-medium">Recommendation: </span>{cluster.recommendation}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── 9. Period Comparison ──────────────────────────────────── */}
      {periodComparison && (
        <div className="card">
          <SectionHeader title="Period Comparison" subtitle={`${periodComparison.current.label} vs ${periodComparison.previous.label}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-700">
                  <th className="text-left py-2 px-2">Metric</th>
                  <th className="text-right py-2 px-2">{periodComparison.current.label}</th>
                  <th className="text-right py-2 px-2">{periodComparison.previous.label}</th>
                  <th className="text-center py-2 px-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {([
                  { label: 'Trade Count', cur: periodComparison.current.tradeCount, prev: periodComparison.previous.tradeCount, fmt: (v: number) => String(v), higher: true },
                  { label: 'Win Rate', cur: periodComparison.current.winRate, prev: periodComparison.previous.winRate, fmt: (v: number) => pct(v), higher: true },
                  { label: 'Avg P&L', cur: periodComparison.current.avgPnl, prev: periodComparison.previous.avgPnl, fmt: fmtINR, higher: true },
                  { label: 'Total P&L', cur: periodComparison.current.totalPnl, prev: periodComparison.previous.totalPnl, fmt: fmtINR, higher: true },
                  { label: 'SL Rate', cur: periodComparison.current.slPercent, prev: periodComparison.previous.slPercent, fmt: (v: number) => pct(v), higher: false },
                  { label: 'Avg R', cur: periodComparison.current.avgRMultiple, prev: periodComparison.previous.avgRMultiple, fmt: (v: number) => v.toFixed(2), higher: true },
                  { label: 'Profit Factor', cur: periodComparison.current.profitFactor, prev: periodComparison.previous.profitFactor, fmt: (v: number) => v.toFixed(2), higher: true },
                  { label: 'Avg Hold (Win)', cur: periodComparison.current.avgHoldWin, prev: periodComparison.previous.avgHoldWin, fmt: fmtDuration, higher: false },
                  { label: 'Avg Hold (Loss)', cur: periodComparison.current.avgHoldLoss, prev: periodComparison.previous.avgHoldLoss, fmt: fmtDuration, higher: false },
                  { label: 'Profitable Days', cur: periodComparison.current.profitableDays, prev: periodComparison.previous.profitableDays, fmt: (v: number) => `${v}/${periodComparison.current.totalTradingDays}`, higher: true },
                ] as const).map(row => {
                  const delta = row.cur - row.prev
                  const improved = row.higher ? delta > 0 : delta < 0
                  const neutral = Math.abs(delta) < 0.01
                  return (
                    <tr key={row.label} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="py-2 px-2 text-slate-300">{row.label}</td>
                      <td className="py-2 px-2 text-right text-white font-medium">{row.fmt(row.cur)}</td>
                      <td className="py-2 px-2 text-right text-slate-400">{row.fmt(row.prev)}</td>
                      <td className="py-2 px-2 text-center">
                        {neutral ? (
                          <span className="text-slate-500 text-xs">--</span>
                        ) : (
                          <span className={`text-xs font-bold ${improved ? 'text-emerald-400' : 'text-red-400'}`}>
                            {improved ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {periodComparison.insight && (
            <InsightBox text={periodComparison.insight} variant="info" />
          )}
        </div>
      )}

      {/* ─── 10. Strategy Correlation Matrix ──────────────────────── */}
      {strategyCorrelation && strategyCorrelation.strategies.length > 1 && (
        <div className="card">
          <SectionHeader
            title="Strategy Correlation Matrix"
            subtitle={`Effective Diversification: ${strategyCorrelation.effectiveDiversification.toFixed(1)}%`}
          />
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="py-2 px-3 text-left text-slate-500" />
                  {strategyCorrelation.strategies.map(s => {
                    const colors = getStrategyColors(s)
                    return (
                      <th key={s} className={`py-2 px-3 text-center font-bold ${colors.text}`}>
                        {s}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {strategyCorrelation.strategies.map(row => {
                  const rowColors = getStrategyColors(row)
                  return (
                    <tr key={row} className="border-t border-slate-700/50">
                      <td className={`py-2 px-3 font-bold ${rowColors.text}`}>{row}</td>
                      {strategyCorrelation.strategies.map(col => {
                        const corr = strategyCorrelation.correlations[row]?.[col] ?? 0
                        const absCor = Math.abs(corr)
                        const cellBg = row === col
                          ? 'bg-slate-700/50'
                          : absCor > 0.7
                          ? 'bg-red-500/20'
                          : absCor > 0.3
                          ? 'bg-yellow-500/15'
                          : 'bg-emerald-500/10'
                        const cellText = row === col
                          ? 'text-slate-500'
                          : absCor > 0.7
                          ? 'text-red-400'
                          : absCor > 0.3
                          ? 'text-yellow-400'
                          : 'text-emerald-400'
                        return (
                          <td key={col} className={`py-2 px-3 text-center font-mono font-medium ${cellBg} ${cellText}`}>
                            {row === col ? '1.00' : corr.toFixed(2)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Legend */}
          <div className="flex gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/20" />&gt;0.7 High Correlation</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-500/15" />0.3-0.7 Moderate</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500/10" />&lt;0.3 Diversified</span>
          </div>
          {strategyCorrelation.insight && (
            <InsightBox text={strategyCorrelation.insight} variant={strategyCorrelation.effectiveDiversification >= 60 ? 'success' : 'warning'} />
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ─── DEEP ANALYTICS SECTION ──────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════ */}

      <div className="border-t border-slate-700 pt-4">
        <h2 className="text-lg font-bold text-white mb-4">Deep Strategy Intelligence</h2>
      </div>

      {/* ─── 11. Directional Analysis (LONG vs SHORT) ────────────── */}
      {directionalAnalysis && (directionalAnalysis.longStats?.trades > 0 || directionalAnalysis.shortStats?.trades > 0) && (
        <div className="card">
          <SectionHeader title="LONG vs SHORT Performance" subtitle="Directional edge by strategy" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {[directionalAnalysis.longStats, directionalAnalysis.shortStats].filter(s => s && s.trades > 0).map(s => (
              <div key={s.direction} className={`p-3 rounded-lg border ${s.direction === 'LONG' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${s.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {s.direction}
                  </span>
                  <span className="text-xs text-slate-500">{s.trades} trades</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div><div className="text-slate-500">WR</div><div className={s.winRate >= 50 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>{pct(s.winRate)}</div></div>
                  <div><div className="text-slate-500">Avg P&L</div><div className={s.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtINR(s.avgPnl)}</div></div>
                  <div><div className="text-slate-500">PF</div><div className={s.profitFactor >= 1 ? 'text-emerald-400' : 'text-red-400'}>{s.profitFactor.toFixed(2)}</div></div>
                  <div><div className="text-slate-500">Total P&L</div><div className={s.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtINR(s.totalPnl)}</div></div>
                  <div><div className="text-slate-500">Avg R</div><div className={s.avgRMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'}>{s.avgRMultiple.toFixed(2)}</div></div>
                  <div><div className="text-slate-500">SL%</div><div className={s.slPercent > 40 ? 'text-red-400' : 'text-white'}>{pct(s.slPercent)}</div></div>
                </div>
              </div>
            ))}
          </div>
          {directionalAnalysis.byStrategy && directionalAnalysis.byStrategy.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500 border-b border-slate-700">
                  <th className="text-left py-1.5 px-2">Strategy</th>
                  <th className="text-center py-1.5 px-2">Edge</th>
                  <th className="text-right py-1.5 px-2">LONG WR</th>
                  <th className="text-right py-1.5 px-2">LONG PF</th>
                  <th className="text-right py-1.5 px-2">SHORT WR</th>
                  <th className="text-right py-1.5 px-2">SHORT PF</th>
                </tr></thead>
                <tbody>
                  {directionalAnalysis.byStrategy.map(s => (
                    <tr key={s.strategy} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="py-1.5 px-2 text-white font-medium">{s.strategy}</td>
                      <td className="py-1.5 px-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          s.edge === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' :
                          s.edge === 'SHORT' ? 'bg-red-500/20 text-red-400' :
                          'bg-slate-500/20 text-slate-400'}`}>{s.edge}</span>
                      </td>
                      <td className={`py-1.5 px-2 text-right ${s.longStats?.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{s.longStats?.trades > 0 ? pct(s.longStats.winRate) : '--'}</td>
                      <td className={`py-1.5 px-2 text-right ${(s.longStats?.profitFactor ?? 0) >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>{s.longStats?.trades > 0 ? s.longStats.profitFactor.toFixed(2) : '--'}</td>
                      <td className={`py-1.5 px-2 text-right ${s.shortStats?.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{s.shortStats?.trades > 0 ? pct(s.shortStats.winRate) : '--'}</td>
                      <td className={`py-1.5 px-2 text-right ${(s.shortStats?.profitFactor ?? 0) >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>{s.shortStats?.trades > 0 ? s.shortStats.profitFactor.toFixed(2) : '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {directionalAnalysis.insight && <InsightBox text={directionalAnalysis.insight} variant="warning" />}
        </div>
      )}

      {/* ─── 12. Day of Week Performance ──────────────────────────── */}
      {dayOfWeekPerformance && dayOfWeekPerformance.length > 0 && (
        <div className="card">
          <SectionHeader title="Day of Week Performance" subtitle="Which days make or lose money?" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-500 border-b border-slate-700">
                <th className="text-left py-2 px-2">Day</th>
                <th className="text-right py-2 px-2">Trades</th>
                <th className="text-right py-2 px-2">Win Rate</th>
                <th className="text-right py-2 px-2">Avg P&L</th>
                <th className="text-right py-2 px-2">Total P&L</th>
                <th className="text-right py-2 px-2">SL%</th>
                <th className="text-center py-2 px-2">Assessment</th>
              </tr></thead>
              <tbody>
                {dayOfWeekPerformance.map(d => (
                  <tr key={d.day} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                    <td className="py-2 px-2 text-white font-medium">{d.day}</td>
                    <td className="py-2 px-2 text-right text-slate-300">{d.trades}</td>
                    <td className={`py-2 px-2 text-right ${d.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(d.winRate)}</td>
                    <td className={`py-2 px-2 text-right ${d.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(d.avgPnl)}</td>
                    <td className={`py-2 px-2 text-right font-medium ${d.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(d.totalPnl)}</td>
                    <td className={`py-2 px-2 text-right ${d.slPercent > 40 ? 'text-red-400' : 'text-slate-300'}`}>{pct(d.slPercent)}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${assessmentBadge(d.assessment)}`}>{d.assessment}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 13. Strategy × Exchange Matrix ───────────────────────── */}
      {strategyExchangeMatrix && strategyExchangeMatrix.length > 0 && (
        <div className="card">
          <SectionHeader title="Strategy × Exchange Heatmap" subtitle="Where does each strategy perform best?" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500 border-b border-slate-700">
                <th className="text-left py-2 px-2">Strategy</th>
                <th className="text-left py-2 px-2">Exchange</th>
                <th className="text-right py-2 px-2">Trades</th>
                <th className="text-right py-2 px-2">WR</th>
                <th className="text-right py-2 px-2">Avg P&L</th>
                <th className="text-right py-2 px-2">Total P&L</th>
                <th className="text-right py-2 px-2">SL%</th>
                <th className="text-right py-2 px-2">PF</th>
                <th className="text-right py-2 px-2">Avg R</th>
              </tr></thead>
              <tbody>
                {strategyExchangeMatrix.map(c => {
                  const colors = getStrategyColors(c.strategy)
                  return (
                    <tr key={`${c.strategy}-${c.exchange}`} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${c.profitFactor < 0.8 ? 'bg-red-500/5' : c.profitFactor > 1.5 ? 'bg-emerald-500/5' : ''}`}>
                      <td className={`py-1.5 px-2 font-bold ${colors.text}`}>{c.strategy}</td>
                      <td className="py-1.5 px-2 text-white">{c.exchange}</td>
                      <td className="py-1.5 px-2 text-right text-slate-300">{c.trades}</td>
                      <td className={`py-1.5 px-2 text-right ${c.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(c.winRate)}</td>
                      <td className={`py-1.5 px-2 text-right ${c.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(c.avgPnl)}</td>
                      <td className={`py-1.5 px-2 text-right font-medium ${c.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(c.totalPnl)}</td>
                      <td className={`py-1.5 px-2 text-right ${c.slPercent > 45 ? 'text-red-400' : 'text-slate-300'}`}>{pct(c.slPercent)}</td>
                      <td className={`py-1.5 px-2 text-right ${c.profitFactor >= 1.5 ? 'text-emerald-400' : c.profitFactor >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>{c.profitFactor.toFixed(2)}</td>
                      <td className={`py-1.5 px-2 text-right ${c.avgRMultiple >= 0.5 ? 'text-emerald-400' : c.avgRMultiple >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{c.avgRMultiple.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 14. Confidence vs Outcome ─────────────────────────────── */}
      {confidenceAnalysis && confidenceAnalysis.length > 0 && (
        <div className="card">
          <SectionHeader title="Confidence Score vs Outcome" subtitle="Does higher conviction = better trades?" />
          <div className="space-y-2">
            {confidenceAnalysis.map(b => (
              <div key={b.bucket} className={`flex items-center gap-3 p-2 rounded-lg ${b.profitable ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-red-500/5 border border-red-500/20'}`}>
                <span className="text-xs font-bold text-white w-16">{b.bucket}%</span>
                <div className="flex-1">
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${b.profitable ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.min(b.winRate, 100)}%` }} />
                  </div>
                </div>
                <span className={`text-xs font-medium w-12 text-right ${b.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(b.winRate)}</span>
                <span className={`text-xs w-16 text-right ${b.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(b.avgPnl)}</span>
                <span className="text-xs text-slate-500 w-12 text-right">{b.trades}t</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${b.profitable ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                  {b.profitable ? '+EV' : '-EV'}
                </span>
              </div>
            ))}
          </div>
          {(() => {
            const firstProfitable = confidenceAnalysis.find(b => b.profitable)
            const unprofitable = confidenceAnalysis.filter(b => !b.profitable)
            if (unprofitable.length > 0 && firstProfitable) {
              return <InsightBox text={`Confidence below ${firstProfitable.bucket}% is -EV (${unprofitable.map(u => u.bucket + '%').join(', ')} buckets are losing money). Raising the confidence gate would eliminate ${unprofitable.reduce((s, u) => s + u.trades, 0)} unprofitable trades.`} variant="warning" />
            }
            return null
          })()}
        </div>
      )}

      {/* ─── 15. Partial Exit (T1→T2→T3→T4) Flow ──────────────────── */}
      {partialExitAnalysis && partialExitAnalysis.tradesWithT1 > 0 && (
        <div className="card">
          <SectionHeader title="Partial Exit Flow Analysis" subtitle="What happens after T1 partial exit?" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">{partialExitAnalysis.tradesWithT1}</div>
              <div className="text-[10px] text-slate-500">Hit T1</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{partialExitAnalysis.t1ThenStopped}</div>
              <div className="text-[10px] text-slate-500">T1 then Stopped</div>
              <div className="text-[10px] text-red-400">{partialExitAnalysis.tradesWithT1 > 0 ? pct(partialExitAnalysis.t1ThenStopped / partialExitAnalysis.tradesWithT1 * 100) : '0%'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-emerald-400">{partialExitAnalysis.t1ThenT2}</div>
              <div className="text-[10px] text-slate-500">Reached T2</div>
              <div className="text-[10px] text-emerald-400">{partialExitAnalysis.tradesWithT1 > 0 ? pct(partialExitAnalysis.t1ThenT2 / partialExitAnalysis.tradesWithT1 * 100) : '0%'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-400">{partialExitAnalysis.reachedAllTargets}</div>
              <div className="text-[10px] text-slate-500">All Targets</div>
              <div className="text-[10px] text-blue-400">{partialExitAnalysis.tradesWithT1 > 0 ? pct(partialExitAnalysis.reachedAllTargets / partialExitAnalysis.tradesWithT1 * 100) : '0%'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-slate-500">Avg P&L of trades after T1 partial:</span>
            <span className={`text-sm font-bold ${partialExitAnalysis.avgPnlAfterT1Partial >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(partialExitAnalysis.avgPnlAfterT1Partial)}
            </span>
          </div>
          {partialExitAnalysis.insight && <InsightBox text={partialExitAnalysis.insight} variant={partialExitAnalysis.t1ThenStopped > partialExitAnalysis.t1ThenT2 ? 'warning' : 'success'} />}
        </div>
      )}

      {/* ─── 16. Win/Loss Streak Analysis ──────────────────────────── */}
      {streakAnalysis && (
        <div className="card">
          <SectionHeader title="Streak & Tilt Analysis" subtitle="Do you trade differently after wins vs losses?" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-emerald-400">{streakAnalysis.maxWinStreak}</div>
              <div className="text-[10px] text-slate-500">Max Win Streak</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{streakAnalysis.maxLossStreak}</div>
              <div className="text-[10px] text-slate-500">Max Loss Streak</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className={`text-2xl font-bold ${streakAnalysis.currentStreak >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {streakAnalysis.currentStreak > 0 ? `+${streakAnalysis.currentStreak}` : streakAnalysis.currentStreak}
              </div>
              <div className="text-[10px] text-slate-500">Current Streak</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className={`text-lg font-bold ${streakAnalysis.winRateAfterLoss >= streakAnalysis.winRateAfterWin ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {streakAnalysis.winRateAfterLoss >= streakAnalysis.winRateAfterWin ? 'NO TILT' : 'TILT'}
              </div>
              <div className="text-[10px] text-slate-500">Tilt Detection</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
              <div className="text-xs text-emerald-400 font-medium mb-1">After a WIN</div>
              <div className="text-xs text-slate-400">Next trade WR: <span className="text-white font-medium">{pct(streakAnalysis.winRateAfterWin)}</span></div>
              <div className="text-xs text-slate-400">Next trade Avg P&L: <span className={streakAnalysis.avgPnlAfterWin >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtINR(streakAnalysis.avgPnlAfterWin)}</span></div>
            </div>
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
              <div className="text-xs text-red-400 font-medium mb-1">After a LOSS</div>
              <div className="text-xs text-slate-400">Next trade WR: <span className="text-white font-medium">{pct(streakAnalysis.winRateAfterLoss)}</span></div>
              <div className="text-xs text-slate-400">Next trade Avg P&L: <span className={streakAnalysis.avgPnlAfterLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtINR(streakAnalysis.avgPnlAfterLoss)}</span></div>
            </div>
          </div>
          {streakAnalysis.insight && <InsightBox text={streakAnalysis.insight} variant={streakAnalysis.winRateAfterLoss >= streakAnalysis.winRateAfterWin ? 'success' : 'warning'} />}
        </div>
      )}

      {/* ─── 17. Holding Period vs Outcome ─────────────────────────── */}
      {holdingPeriodAnalysis && holdingPeriodAnalysis.length > 0 && (
        <div className="card">
          <SectionHeader title="Holding Period vs Outcome" subtitle="How long should you hold? Where's the sweet spot?" />
          <div className="space-y-2">
            {holdingPeriodAnalysis.map(h => {
              const isSweetSpot = h.assessment === 'SWEET_SPOT'
              return (
                <div key={h.bucket} className={`flex items-center gap-3 p-2 rounded-lg border ${
                  isSweetSpot ? 'border-emerald-500/40 bg-emerald-500/10' :
                  h.assessment === 'EXIT' ? 'border-red-500/30 bg-red-500/5' :
                  'border-slate-700 bg-slate-800/50'}`}>
                  <span className="text-xs font-bold text-white w-16">{h.bucket}</span>
                  <div className="flex-1">
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${h.avgPnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(Math.max(h.winRate, 5), 100)}%` }} />
                    </div>
                  </div>
                  <span className={`text-xs w-10 text-right ${h.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(h.winRate, 0)}</span>
                  <span className={`text-xs w-14 text-right ${h.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(h.avgPnl)}</span>
                  <span className="text-xs text-slate-500 w-8 text-right">{h.trades}t</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    isSweetSpot ? 'bg-emerald-500/20 text-emerald-400' :
                    h.assessment === 'GOOD' ? 'bg-blue-500/20 text-blue-400' :
                    h.assessment === 'EXIT' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400'}`}>
                    {isSweetSpot ? 'SWEET SPOT' : h.assessment}
                  </span>
                </div>
              )
            })}
          </div>
          {(() => {
            const sweetSpot = holdingPeriodAnalysis.find(h => h.assessment === 'SWEET_SPOT')
            const exitZone = holdingPeriodAnalysis.find(h => h.assessment === 'EXIT')
            if (sweetSpot && exitZone) {
              return <InsightBox text={`Optimal holding: ${sweetSpot.bucket} (${pct(sweetSpot.winRate)} WR, ${fmtINR(sweetSpot.avgPnl)} avg). Avoid holding beyond ${exitZone.bucket} — performance degrades.`} variant="success" />
            }
            return null
          })()}
        </div>
      )}

      {/* ─── 18. Risk/Reward Planned vs Actual ─────────────────────── */}
      {riskRewardAnalysis && (
        <div className="card">
          <SectionHeader title="Risk/Reward: Planned vs Actual" subtitle="Are you capturing what you planned?" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-white">{riskRewardAnalysis.avgPlannedRR > 0 ? riskRewardAnalysis.avgPlannedRR.toFixed(2) : 'DM'}</div>
              <div className="text-[10px] text-slate-500">Planned R:R</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className={`text-xl font-bold ${riskRewardAnalysis.avgActualRR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{riskRewardAnalysis.avgActualRR.toFixed(2)}</div>
              <div className="text-[10px] text-slate-500">Actual R:R</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className={`text-xl font-bold ${riskRewardAnalysis.avgWinnerR >= 1 ? 'text-emerald-400' : 'text-yellow-400'}`}>{riskRewardAnalysis.avgWinnerR.toFixed(2)}R</div>
              <div className="text-[10px] text-slate-500">Avg Winner</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-red-400">{riskRewardAnalysis.avgLoserR.toFixed(2)}R</div>
              <div className="text-[10px] text-slate-500">Avg Loser</div>
            </div>
          </div>
          <div className="flex items-center gap-4 mb-3 text-xs">
            <span className="text-slate-500">Trades {'>'}2R: <span className="text-emerald-400 font-medium">{riskRewardAnalysis.tradesAbove2R} ({pct(riskRewardAnalysis.percentAbove2R)})</span></span>
            <span className="text-slate-500">Trades {'>'}3R: <span className="text-emerald-400 font-medium">{riskRewardAnalysis.tradesAbove3R}</span></span>
            {riskRewardAnalysis.rrCapturePercent > 0 && (
              <span className="text-slate-500">RR Capture: <span className={riskRewardAnalysis.rrCapturePercent >= 50 ? 'text-emerald-400' : 'text-yellow-400'}>{pct(riskRewardAnalysis.rrCapturePercent)}</span></span>
            )}
          </div>
          {riskRewardAnalysis.insight && <InsightBox text={riskRewardAnalysis.insight} variant={riskRewardAnalysis.avgActualRR >= 0.5 ? 'success' : 'warning'} />}
        </div>
      )}

      {/* ─── Footer ────────────────────────────────────────────────── */}
      <div className="text-center text-xs text-slate-600">
        Last updated: {data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString('en-IN') : 'Unknown'}
      </div>
    </div>
  )
}
