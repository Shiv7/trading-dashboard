import { useState, useEffect, useCallback, useMemo } from 'react'
import { isAnyMarketOpen } from '../utils/tradingUtils'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8085/api'
const ML_BASE = `${API_BASE}/ml`

// ─── Types ───────────────────────────────────────────────────────────────────

interface RegimeInfo {
  version?: string
  exchange?: string
  trainedAt?: string
  metrics?: {
    n_samples: number
    log_likelihood: number
    n_regimes: number
    regime_distribution: Record<string, number>
  }
  error?: string
}

interface QualityInfo {
  version?: string
  metrics?: {
    cv_auc_mean: number
    cv_auc_std: number
    n_samples: number
    n_positive: number
    n_negative: number
  }
  topFeatures?: Array<{ name: string; importance: number }>
  error?: string
}

interface ShadowLog {
  signalId: string
  strategy: string
  scripCode: string
  direction: string
  entryPrice: number
  ruleBasedDecision: string
  skipReason?: string
  mlDecision: {
    shouldTrade: boolean
    recommendedSize: number
    sampledProbability: number
    expectedWinRate: number
    regime: string
  }
  signalContext?: {
    rankScore: number
    capitalAllocated: number
    conviction: number
    isOption: boolean
  }
  agreement: boolean
  disagreementType: string
  outcomeRecorded?: boolean
  outcome?: {
    isWin: boolean
    netPnl: number
    exitReason: string
  }
  timestamp: string | number[]
}

interface BayesianDist {
  alpha: number
  beta: number
  winRate: string
  winRateNum: number
  totalSamples: number
  ciLow: number
  ciHigh: number
}

interface Analytics {
  today: { signals: number; trades: number; skips: number; agreement: number }
  disagreement: {
    bulletsDodgedPnl: number; bulletsDodgedCount: number; bulletsDodgedAvg: number; bulletsDodgedWinRate: number
    missedOpportunities: number; mlEdge: number
  }
  linkage: { totalShadowLogs: number; totalTrades: number; outcomesLinked: number; linkageRate: number }
  heatmap: {
    cells: Array<{ strategy: string; regime: string; winRate: number; samples: number }>
    strategies: string[]; regimes: string[]
  }
  hourly: Array<{ hour: number; wins: number; losses: number; total: number; winRate: number }>
  strategyBreakdown: Array<{ strategy: string; trades: number; skips: number; agree: number; disagree: number; agreementRate: number }>
  readiness: {
    score: number; dataSufficiency: boolean; dataSufficiencyProgress: number
    outcomesLinked: boolean; highAgreement: boolean; agreementRate: number
    mlHasEdge: boolean; bayesianConverged: boolean; convergedStrategies: number
  }
  regimeShiftsToday: number
  exchangeBreakdown: Array<{ exchange: string; wins: number; losses: number; total: number; winRate: number; totalPnl: number }>
  confidenceDistribution: Array<{ range: string; count: number }>
}

interface TrainResult {
  status?: string; cv_auc_mean?: number; n_samples?: number
  regime_distribution?: Record<string, number>; error?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const REGIME_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  TRENDING_UP:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  TRENDING_DOWN:   { bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/30',    dot: 'bg-rose-400' },
  MEAN_REVERTING:  { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30',   dot: 'bg-amber-400' },
  HIGH_VOLATILITY: { bg: 'bg-violet-500/10',  text: 'text-violet-400',  border: 'border-violet-500/30',  dot: 'bg-violet-400' },
  UNKNOWN:         { bg: 'bg-slate-500/10',   text: 'text-slate-400',   border: 'border-slate-500/30',   dot: 'bg-slate-400' },
}

const rs = (r: string) => REGIME_STYLES[r] || REGIME_STYLES.UNKNOWN

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const data = await r.json()
    if (data?.error) return null
    return data
  } catch { return null }
}

function formatPnl(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 100000) return (n > 0 ? '+' : '-') + (abs / 100000).toFixed(2) + 'L'
  if (abs >= 1000) return (n > 0 ? '+' : '-') + (abs / 1000).toFixed(1) + 'K'
  return (n > 0 ? '+' : '') + n.toFixed(0)
}

function formatTs(ts: string | number[] | undefined): string {
  if (!ts) return '-'
  if (Array.isArray(ts) && ts.length >= 5)
    return `${String(ts[3]).padStart(2,'0')}:${String(ts[4]).padStart(2,'0')}`
  if (typeof ts === 'string') {
    try { return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }
    catch { return '-' }
  }
  return '-'
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ReadinessRing({ score }: { score: number }) {
  const r = 40, c = 2 * Math.PI * r
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444'
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={c} strokeDashoffset={c - (c * score / 100)}
        strokeLinecap="round" transform="rotate(-90 50 50)" />
      <text x="50" y="46" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold">{score}</text>
      <text x="50" y="62" textAnchor="middle" fill="#94a3b8" fontSize="10">/100</text>
    </svg>
  )
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      <span className={ok ? 'text-slate-300' : 'text-slate-500'}>{label}</span>
    </div>
  )
}

function HeatmapCell({ winRate, samples }: { winRate: number; samples: number }) {
  if (samples === 0) return <td className="p-2 text-center text-xs text-slate-600">-</td>
  const intensity = winRate / 100
  const bg = winRate >= 65 ? `rgba(16,185,129,${0.15 + intensity * 0.35})`
            : winRate >= 50 ? `rgba(245,158,11,${0.15 + (intensity - 0.5) * 0.7})`
            : `rgba(239,68,68,${0.15 + (1 - intensity) * 0.35})`
  return (
    <td className="p-2 text-center" style={{ background: bg }}>
      <div className="text-sm font-semibold text-white">{winRate}%</div>
      <div className="text-[10px] text-slate-400">{samples}s</div>
    </td>
  )
}

function ConfidenceBar({ data }: { data: Array<{ range: string; count: number }> }) {
  const max = Math.max(1, ...data.map(d => d.count))
  return (
    <div className="flex items-end gap-1 h-24">
      {data.map((d, i) => {
        const h = (d.count / max) * 100
        const color = i < 4 ? 'bg-rose-500/60' : i < 6 ? 'bg-amber-500/60' : 'bg-emerald-500/60'
        return (
          <div key={d.range} className="flex-1 flex flex-col items-center gap-0.5">
            <div className={`w-full rounded-t ${color}`} style={{ height: `${Math.max(2, h)}%` }}
              title={`${d.range}: ${d.count}`} />
            <span className="text-[8px] text-slate-500">{(i * 10)}</span>
          </div>
        )
      })}
    </div>
  )
}

function HourlyChart({ data }: { data: Array<{ hour: number; wins: number; losses: number; total: number; winRate: number }> }) {
  if (data.length === 0) return <p className="text-slate-500 text-xs italic">No hourly data yet</p>
  const max = Math.max(1, ...data.map(d => d.total))
  return (
    <div className="flex items-end gap-1 h-28">
      {data.map(d => {
        const h = (d.total / max) * 100
        const winH = d.total > 0 ? (d.wins / d.total) * h : 0
        return (
          <div key={d.hour} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.hour}:00 — ${d.wins}W/${d.losses}L (${d.winRate}%)`}>
            <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: `${Math.max(4, h)}%` }}>
              <div className="bg-emerald-500/70" style={{ height: `${winH}%` }} />
              <div className="bg-rose-500/50 flex-1" />
            </div>
            <span className="text-[9px] text-slate-500">{d.hour}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MLShadowPage() {
  const [regime, setRegime] = useState<RegimeInfo | null>(null)
  const [quality, setQuality] = useState<QualityInfo | null>(null)
  const [shadowLogs, setShadowLogs] = useState<ShadowLog[]>([])
  const [distributions, setDistributions] = useState<Record<string, BayesianDist>>({})
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [training, setTraining] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const refresh = useCallback(async () => {
    const [r, q, logs, dists, a] = await Promise.all([
      fetchJson<RegimeInfo>(`${ML_BASE}/regime/info`),
      fetchJson<QualityInfo>(`${ML_BASE}/quality/info`),
      fetchJson<ShadowLog[]>(`${ML_BASE}/shadow/logs?limit=50`),
      fetchJson<Record<string, BayesianDist>>(`${ML_BASE}/bayesian/distributions`),
      fetchJson<Analytics>(`${ML_BASE}/shadow/analytics`),
    ])
    if (r) setRegime(r)
    if (q) setQuality(q)
    if (logs) setShadowLogs(Array.isArray(logs) ? logs : [])
    if (dists) setDistributions(dists)
    if (a) setAnalytics(a)
    setLastRefresh(new Date())
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(() => { if (isAnyMarketOpen()) refresh() }, 30000)
    return () => clearInterval(interval)
  }, [refresh])

  const trainModels = async () => {
    setTraining('Reconstructing features...')
    try {
      const reconRes = await fetch(`${ML_BASE}/reconstruct`, { method: 'POST' })
      const reconResult = await reconRes.json()
      setTraining(`Reconstructed ${reconResult.records || 0} records. Training...`)
      const [qRes, rRes] = await Promise.all([
        fetch(`${ML_BASE}/quality/train`, { method: 'POST' }),
        fetch(`${ML_BASE}/regime/train`, { method: 'POST' }),
      ])
      const qResult: TrainResult = await qRes.json()
      const rResult: TrainResult = await rRes.json()
      setTraining(`Quality AUC: ${qResult.cv_auc_mean?.toFixed(3) || 'N/A'} | Regime: ${rResult.status || 'N/A'} (${rResult.n_samples || 0} candles)`)
      setTimeout(refresh, 1000)
    } catch (e) { setTraining(`Error: ${e}`) }
  }

  const initBayesian = async () => {
    setTraining('Initializing Bayesian from history...')
    try {
      const r = await fetch(`${ML_BASE}/bayesian/init-from-history`, { method: 'POST' })
      const result = await r.json()
      const strategies = Object.entries(result).map(([k, v]: [string, any]) => `${k}: ${v.winRate}`).join(', ')
      setTraining(`Initialized: ${strategies}`)
      setTimeout(refresh, 1000)
    } catch (e) { setTraining(`Error: ${e}`) }
  }

  // Derived values
  const topRegime = useMemo(() => {
    if (!regime?.metrics?.regime_distribution) return null
    return Object.entries(regime.metrics.regime_distribution).sort((a, b) => b[1] - a[1])[0]
  }, [regime])

  const dominantRegime = topRegime ? topRegime[0] : 'UNKNOWN'
  const regimeStyle = rs(dominantRegime)

  // Filter to only show active strategies in Bayesian
  const activeStrategies = useMemo(() => {
    return Object.entries(distributions)
      .filter(([, d]) => d.totalSamples >= 1)
      .sort((a, b) => b[1].totalSamples - a[1].totalSamples)
  }, [distributions])

  const readiness = analytics?.readiness

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">

      {/* ════════ REGIME BANNER ════════ */}
      <div className={`${regimeStyle.bg} border-b ${regimeStyle.border} px-4 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${regimeStyle.dot} animate-pulse`} />
          <span className={`font-semibold text-sm ${regimeStyle.text}`}>
            {dominantRegime.replace(/_/g, ' ')}
          </span>
          {regime?.version && (
            <span className="text-slate-500 text-xs">Model v{regime.version}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-500 text-xs">
            {regime?.metrics?.n_samples?.toLocaleString() || 0} candles
          </span>
          {analytics && (
            <span className="text-slate-500 text-xs">
              {analytics.regimeShiftsToday} regime shift{analytics.regimeShiftsToday !== 1 ? 's' : ''} today
            </span>
          )}
          <span className="text-slate-600 text-[10px]">
            Updated {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* ════════ HEADER ════════ */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">ML Shadow Intelligence</h1>
            <p className="text-xs text-slate-500">Shadow mode — ML decisions logged, not executed</p>
          </div>
          <div className="flex gap-2">
            <button onClick={trainModels}
              className="px-3 py-1.5 bg-blue-600/20 text-blue-400 text-xs rounded-lg border border-blue-500/30 hover:bg-blue-600/30 transition">
              Train Models
            </button>
            <button onClick={initBayesian}
              className="px-3 py-1.5 bg-violet-600/20 text-violet-400 text-xs rounded-lg border border-violet-500/30 hover:bg-violet-600/30 transition">
              Init Bayesian
            </button>
            <button onClick={refresh}
              className="px-3 py-1.5 bg-slate-700/50 text-slate-400 text-xs rounded-lg border border-slate-600/30 hover:bg-slate-600/50 transition">
              Refresh
            </button>
          </div>
        </div>

        {training && (
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2 text-blue-300 text-xs">
            {training}
          </div>
        )}

        {/* ════════ FIRST FOLD: THE VERDICT ════════ */}

        {/* Quick Stats Strip */}
        {analytics && (
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Signals Today', value: analytics.today.signals, color: 'text-white' },
              { label: 'Trades Taken', value: analytics.today.trades, color: 'text-emerald-400' },
              { label: 'Skipped', value: analytics.today.skips, color: 'text-slate-400' },
              { label: 'ML Agreement', value: `${analytics.today.agreement}%`, color: analytics.today.agreement >= 70 ? 'text-emerald-400' : 'text-amber-400' },
              { label: 'Shadow Logs', value: analytics.linkage.totalShadowLogs, color: 'text-slate-300' },
            ].map(s => (
              <div key={s.label} className="bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Three Cards: ML Edge | Disagreement | Readiness */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Card 1: ML Edge */}
          <div className="bg-gradient-to-br from-slate-800/80 to-slate-800/40 border border-slate-700/60 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">ML Edge</h3>
              <span className="text-[10px] text-slate-600">vs rules</span>
            </div>
            {analytics && analytics.disagreement.bulletsDodgedCount > 0 ? (
              <>
                <div className={`text-3xl font-bold ${analytics.disagreement.mlEdge >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatPnl(analytics.disagreement.mlEdge)}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  ML would have {analytics.disagreement.mlEdge >= 0 ? 'saved' : 'lost'} this vs rules
                </p>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">Bullets Dodged</span>
                    <span className="text-xs text-rose-400">{analytics.disagreement.bulletsDodgedCount} trades, avg {formatPnl(analytics.disagreement.bulletsDodgedAvg)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">Their Win Rate</span>
                    <span className="text-xs text-slate-300">{analytics.disagreement.bulletsDodgedWinRate}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">Missed Opportunities</span>
                    <span className="text-xs text-amber-400">{analytics.disagreement.missedOpportunities} signals</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="text-2xl font-bold text-slate-600">--</div>
                <p className="text-xs text-slate-500 mt-2">Collecting data. Edge analysis appears after trades close with disagreements.</p>
              </div>
            )}
          </div>

          {/* Card 2: When We Disagree */}
          <div className="bg-gradient-to-br from-slate-800/80 to-slate-800/40 border border-slate-700/60 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">When We Disagree</h3>
            </div>
            {analytics && (analytics.linkage.totalShadowLogs > 0) ? (
              <>
                <div className="space-y-4">
                  {/* ML says SKIP, Rules traded */}
                  <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-rose-400 text-xs font-semibold">ML: SKIP</span>
                      <span className="text-slate-600 text-xs">/</span>
                      <span className="text-emerald-400 text-xs font-semibold">Rules: TRADE</span>
                    </div>
                    {analytics.disagreement.bulletsDodgedCount > 0 ? (
                      <div className="text-sm text-slate-300">
                        {analytics.disagreement.bulletsDodgedCount} trades, avg PnL: <span className={analytics.disagreement.bulletsDodgedAvg >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatPnl(analytics.disagreement.bulletsDodgedAvg)}</span>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 italic">Awaiting outcomes...</div>
                    )}
                  </div>

                  {/* ML says TRADE, Rules skipped */}
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-emerald-400 text-xs font-semibold">ML: TRADE</span>
                      <span className="text-slate-600 text-xs">/</span>
                      <span className="text-rose-400 text-xs font-semibold">Rules: SKIP</span>
                    </div>
                    <div className="text-sm text-slate-300">
                      {analytics.disagreement.missedOpportunities} signals skipped by rules
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      Hypothetical P&L unknown (not traded)
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <div className="text-2xl font-bold text-slate-600">--</div>
                <p className="text-xs text-slate-500 mt-2">Disagreement analysis appears when signals start flowing.</p>
              </div>
            )}
          </div>

          {/* Card 3: ML Readiness */}
          <div className="bg-gradient-to-br from-slate-800/80 to-slate-800/40 border border-slate-700/60 rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Go-Live Readiness</h3>
            </div>
            {readiness ? (
              <div className="flex items-start gap-4">
                <ReadinessRing score={readiness.score} />
                <div className="flex-1 space-y-1.5 pt-1">
                  <CheckItem ok={readiness.dataSufficiency} label={`Data: ${readiness.dataSufficiencyProgress}/100 logs`} />
                  <CheckItem ok={readiness.outcomesLinked} label={`Outcomes: ${analytics?.linkage.linkageRate || 0}% linked`} />
                  <CheckItem ok={readiness.highAgreement} label={`Agreement: ${readiness.agreementRate}%`} />
                  <CheckItem ok={readiness.mlHasEdge} label={readiness.mlHasEdge ? 'ML has positive edge' : 'ML edge: pending data'} />
                  <CheckItem ok={readiness.bayesianConverged} label={`Bayesian: ${readiness.convergedStrategies}/3 converged`} />
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="text-2xl font-bold text-slate-600">--</div>
                <p className="text-xs text-slate-500 mt-2">Loading...</p>
              </div>
            )}
          </div>
        </div>

        {/* ════════ SECOND FOLD: INTELLIGENCE LAYER ════════ */}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Strategy x Regime Heatmap */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Strategy x Regime Win Rate</h3>
            {analytics && analytics.heatmap.cells.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-[10px] text-slate-500 pb-2 pr-2">Strategy</th>
                      {analytics.heatmap.regimes.map(r => (
                        <th key={r} className={`text-center text-[10px] pb-2 px-1 ${rs(r).text}`}>
                          {r.replace(/_/g, ' ').substring(0, 8)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.heatmap.strategies.map(s => (
                      <tr key={s} className="border-t border-slate-700/30">
                        <td className="text-xs text-slate-300 py-1 pr-2 font-medium">{s}</td>
                        {analytics.heatmap.regimes.map(r => {
                          const cell = analytics.heatmap.cells.find(c => c.strategy === s && c.regime === r)
                          return <HeatmapCell key={r} winRate={cell?.winRate || 0} samples={cell?.samples || 0} />
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-slate-500 text-xs italic text-center py-6">Heatmap populates as Bayesian distributions build per regime</p>
            )}
          </div>

          {/* Confidence Distribution + Time of Day */}
          <div className="space-y-4">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">ML Confidence Distribution</h3>
              {analytics && analytics.confidenceDistribution.some(d => d.count > 0) ? (
                <>
                  <ConfidenceBar data={analytics.confidenceDistribution} />
                  <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                    <span>Low confidence</span>
                    <span>High confidence</span>
                  </div>
                </>
              ) : (
                <p className="text-slate-500 text-xs italic text-center py-4">Distribution appears after signals flow</p>
              )}
            </div>

            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Win Rate by Hour</h3>
              <HourlyChart data={analytics?.hourly || []} />
              {analytics && analytics.hourly.length > 0 && (
                <div className="flex justify-center gap-4 mt-2 text-[10px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500/70" />Wins</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-rose-500/50" />Losses</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Exchange Breakdown + Models */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Exchange Cards */}
          {analytics && analytics.exchangeBreakdown.length > 0 ? (
            analytics.exchangeBreakdown.map(ex => (
              <div key={ex.exchange} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white">{ex.exchange}</h3>
                  <span className={`text-lg font-bold ${ex.winRate >= 60 ? 'text-emerald-400' : ex.winRate >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {ex.winRate}%
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{ex.wins}W / {ex.losses}L</span>
                  <span className={ex.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatPnl(ex.totalPnl)}</span>
                </div>
              </div>
            ))
          ) : (
            <>
              {['NSE', 'MCX', 'CDS'].map(ex => (
                <div key={ex} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-2">{ex}</h3>
                  <p className="text-xs text-slate-500 italic">Awaiting data</p>
                </div>
              ))}
            </>
          )}
        </div>

        {/* ════════ MODEL CARDS ════════ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Regime Model */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Regime Detection (HMM)</h3>
              {regime?.version && <span className="text-[10px] text-slate-600">v{regime.version}</span>}
            </div>
            {regime?.metrics?.regime_distribution ? (
              <div className="space-y-2">
                {Object.entries(regime.metrics.regime_distribution)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, count]) => {
                    const total = regime.metrics?.n_samples || 1
                    const pct = (count / total) * 100
                    return (
                      <div key={name} className="flex items-center gap-2">
                        <span className={`w-16 text-xs ${rs(name).text}`}>{name.replace(/_/g, ' ').substring(0, 10)}</span>
                        <div className="flex-1 bg-slate-700/50 rounded-full h-2">
                          <div className={`h-2 rounded-full ${rs(name).dot}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    )
                  })}
              </div>
            ) : (
              <p className="text-slate-500 text-xs italic">Not trained — click Train Models</p>
            )}
          </div>

          {/* Quality Model */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Signal Quality (XGBoost)</h3>
              {quality?.version && <span className="text-[10px] text-slate-600">v{quality.version}</span>}
            </div>
            {quality?.metrics ? (
              <>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className={`text-2xl font-bold ${quality.metrics.cv_auc_mean >= 0.6 ? 'text-emerald-400' : quality.metrics.cv_auc_mean >= 0.5 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {quality.metrics.cv_auc_mean.toFixed(3)}
                  </span>
                  <span className="text-xs text-slate-500">AUC ({quality.metrics.n_samples} samples)</span>
                </div>
                {quality.topFeatures && (
                  <div className="space-y-1.5">
                    {quality.topFeatures.slice(0, 5).map(f => (
                      <div key={f.name} className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 w-28 truncate">{f.name}</span>
                        <div className="flex-1 bg-slate-700/50 rounded-full h-1.5">
                          <div className="bg-blue-500/70 h-1.5 rounded-full" style={{ width: `${Math.min(100, f.importance * 1200)}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400 w-10 text-right">{(f.importance * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-slate-500 text-xs italic">Not trained — click Train Models</p>
            )}
          </div>
        </div>

        {/* ════════ THIRD FOLD: BAYESIAN + LOGS ════════ */}

        {/* Bayesian Distributions */}
        {activeStrategies.length > 0 && (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Bayesian Win Rate (Thompson Sampling)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {activeStrategies.map(([key, dist]) => {
                const convergence = Math.min(100, (dist.totalSamples / 50) * 100)
                const status = dist.totalSamples < 10 ? 'Exploring' : dist.totalSamples < 30 ? 'Learning' : 'Stable'
                const statusColor = dist.totalSamples < 10 ? 'text-amber-400' : dist.totalSamples < 30 ? 'text-blue-400' : 'text-emerald-400'
                return (
                  <div key={key} className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/20">
                    <div className="text-[10px] text-slate-400 mb-1 truncate" title={key}>{key}</div>
                    <div className="text-xl font-bold text-white">{dist.winRate}</div>
                    <div className="flex items-center gap-1 mt-1">
                      <div className="flex-1 bg-slate-600/50 rounded-full h-1">
                        <div className="bg-blue-400/70 h-1 rounded-full" style={{ width: `${convergence}%` }} />
                      </div>
                      <span className={`text-[9px] ${statusColor}`}>{status}</span>
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1">
                      {dist.totalSamples}s | CI: {dist.ciLow}-{dist.ciHigh}%
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Shadow Logs Table */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Recent Shadow Decisions</h3>
            <span className="text-[10px] text-slate-600">{shadowLogs.length} entries</span>
          </div>
          {shadowLogs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] text-slate-500 border-b border-slate-700/50">
                    <th className="pb-2 pr-2">Time</th>
                    <th className="pb-2 pr-2">Strategy</th>
                    <th className="pb-2 pr-2">Scrip</th>
                    <th className="pb-2 pr-2">Dir</th>
                    <th className="pb-2 pr-2">Rule</th>
                    <th className="pb-2 pr-2">ML</th>
                    <th className="pb-2 pr-2">Prob</th>
                    <th className="pb-2 pr-2">Regime</th>
                    <th className="pb-2 pr-2">Rank</th>
                    <th className="pb-2 pr-2">Outcome</th>
                    <th className="pb-2">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {shadowLogs.map((log, i) => {
                    const isDisagree = !log.agreement
                    return (
                      <tr key={i} className={`border-b border-slate-700/20 ${isDisagree ? 'bg-amber-500/5' : ''}`}>
                        <td className="py-1.5 pr-2 text-slate-400">{formatTs(log.timestamp)}</td>
                        <td className="py-1.5 pr-2 text-slate-300 font-medium">{log.strategy}</td>
                        <td className="py-1.5 pr-2 text-slate-300">{log.scripCode}</td>
                        <td className="py-1.5 pr-2">
                          <span className={log.direction === 'BULLISH' ? 'text-emerald-400' : log.direction === 'BEARISH' ? 'text-rose-400' : 'text-slate-400'}>
                            {log.direction === 'BULLISH' ? 'BUL' : log.direction === 'BEARISH' ? 'BER' : log.direction?.substring(0, 3) || '-'}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${log.ruleBasedDecision === 'TRADE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-600/30 text-slate-400'}`}>
                            {log.ruleBasedDecision}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${log.mlDecision?.shouldTrade ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                            {log.mlDecision?.shouldTrade ? 'TRADE' : 'SKIP'}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-slate-300">
                          {((log.mlDecision?.sampledProbability || 0) * 100).toFixed(0)}%
                        </td>
                        <td className="py-1.5 pr-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${rs(log.mlDecision?.regime || 'UNKNOWN').bg} ${rs(log.mlDecision?.regime || 'UNKNOWN').text} ${rs(log.mlDecision?.regime || 'UNKNOWN').border} border`}>
                            {(log.mlDecision?.regime || 'N/A').substring(0, 6)}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-slate-400">
                          {log.signalContext?.rankScore?.toFixed(1) || '-'}
                        </td>
                        <td className="py-1.5 pr-2">
                          {log.outcomeRecorded && log.outcome ? (
                            <span className={log.outcome.isWin ? 'text-emerald-400' : 'text-rose-400'}>
                              {log.outcome.isWin ? 'W' : 'L'} {formatPnl(log.outcome.netPnl)}
                            </span>
                          ) : log.ruleBasedDecision === 'TRADE' ? (
                            <span className="text-slate-600 text-[10px]">open</span>
                          ) : (
                            <span className="text-slate-700">-</span>
                          )}
                        </td>
                        <td className="py-1.5">
                          {log.agreement ? (
                            <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold inline-flex items-center justify-center">Y</span>
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-rose-500/15 text-rose-400 text-[10px] font-bold inline-flex items-center justify-center">N</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-slate-600 text-sm mb-1">No shadow logs yet</div>
              <p className="text-slate-700 text-xs">Logs appear during market hours as signals flow through the pipeline</p>
            </div>
          )}
        </div>

        {/* Outcome Linkage Footer */}
        {analytics && (
          <div className="flex items-center justify-between text-[10px] text-slate-600 px-2">
            <span>Outcome linkage: {analytics.linkage.outcomesLinked}/{analytics.linkage.totalTrades} trades ({analytics.linkage.linkageRate}%)</span>
            <span>Auto-refreshes every 30s</span>
            <span>SHADOW MODE — ML decisions are logged only, not executed</span>
          </div>
        )}

      </div>
    </div>
  )
}
