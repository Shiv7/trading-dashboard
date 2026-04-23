import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, PlayCircle, RefreshCw, XCircle } from 'lucide-react'

/**
 * Health Check MVP — operational view for 17 critical cron/scraper/schedule jobs.
 * Polls /api/health-check every 60s, renders grouped table with status badges +
 * manual-trigger buttons for idempotent scrapers.
 */
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8085/api'

type Status = 'FRESH' | 'RETRYING' | 'STALE' | 'MISSING' | 'PENDING' | 'UNKNOWN'

interface JobStatus {
  id: string
  name: string
  purpose: string
  category: 'SCRAPER' | 'HOTSTOCKS' | 'TRADE_EXEC' | 'LIVE_FEED'
  serviceName: string
  humanSchedule: string
  affectedStrategies: string[]
  status: Status
  statusReason?: string | null
  lastRunEpochMs?: number | null
  nextRunEpochMs?: number | null
  canTrigger: boolean
  triggerEndpoint?: string | null
  attemptsToday?: number | null
}

const STATUS_STYLE: Record<Status, { icon: any; color: string; bg: string; border: string; label: string }> = {
  FRESH:    { icon: CheckCircle2,   color: 'text-emerald-300', bg: 'bg-emerald-500/15',  border: 'border-emerald-500/40', label: 'FRESH' },
  RETRYING: { icon: RefreshCw,      color: 'text-amber-300',   bg: 'bg-amber-500/15',    border: 'border-amber-500/40',   label: 'RETRYING' },
  STALE:    { icon: XCircle,        color: 'text-red-300',     bg: 'bg-red-500/15',      border: 'border-red-500/40',     label: 'STALE' },
  MISSING:  { icon: AlertTriangle,  color: 'text-red-200',     bg: 'bg-red-600/20',      border: 'border-red-600/50',     label: 'MISSING' },
  PENDING:  { icon: Clock,          color: 'text-slate-300',   bg: 'bg-slate-500/15',    border: 'border-slate-500/40',   label: 'PENDING' },
  UNKNOWN:  { icon: AlertTriangle,  color: 'text-slate-400',   bg: 'bg-slate-700/30',    border: 'border-slate-600/40',   label: 'UNKNOWN' }
}

const CATEGORY_LABEL: Record<JobStatus['category'], string> = {
  SCRAPER:    'Market-Pulse Scrapers',
  HOTSTOCKS:  'HotStocks Pipeline',
  TRADE_EXEC: 'Trade Execution',
  LIVE_FEED:  'Live Feeds'
}

function formatTime(ms?: number | null): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', hour12: false
  }) + ' IST'
}

function formatRelative(ms?: number | null): string {
  if (!ms) return '—'
  const diffSec = Math.round((Date.now() - ms) / 1000)
  if (diffSec < 0) {
    const future = Math.abs(diffSec)
    if (future < 60) return `in ${future}s`
    if (future < 3600) return `in ${Math.round(future/60)}m`
    return `in ${Math.round(future/3600)}h`
  }
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.round(diffSec/60)}m ago`
  if (diffSec < 86400) return `${Math.round(diffSec/3600)}h ago`
  return `${Math.round(diffSec/86400)}d ago`
}

export default function HealthCheckPage() {
  const [jobs, setJobs] = useState<JobStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState<string | null>(null)
  const [triggerResult, setTriggerResult] = useState<{ jobId: string; ok: boolean; msg: string } | null>(null)
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now())

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/health-check`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as JobStatus[]
      setJobs(data)
      setLastRefresh(Date.now())
    } catch (e) {
      console.error('[health-check] load failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 60_000)
    return () => clearInterval(iv)
  }, [load])

  const trigger = useCallback(async (jobId: string) => {
    setTriggering(jobId)
    setTriggerResult(null)
    try {
      const r = await fetch(`${API_BASE}/health-check/trigger/${jobId}`, { method: 'POST' })
      const body = await r.json().catch(() => ({ success: false, message: `HTTP ${r.status}` }))
      setTriggerResult({ jobId, ok: r.ok && body.success !== false, msg: body.message ?? 'ok' })
      // Refresh status after a trigger
      setTimeout(load, 3000)
    } catch (e: any) {
      setTriggerResult({ jobId, ok: false, msg: e?.message ?? 'failed' })
    } finally {
      setTriggering(null)
    }
  }, [load])

  const summary = useMemo(() => {
    const c: Record<Status, number> = { FRESH: 0, RETRYING: 0, STALE: 0, MISSING: 0, PENDING: 0, UNKNOWN: 0 }
    for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1
    return c
  }, [jobs])

  const grouped = useMemo(() => {
    const g: Record<JobStatus['category'], JobStatus[]> = {
      SCRAPER: [], HOTSTOCKS: [], TRADE_EXEC: [], LIVE_FEED: []
    }
    for (const j of jobs) g[j.category].push(j)
    return g
  }, [jobs])

  return (
    <div className="min-h-screen mobile-page-bottom">
      {/* Header */}
      <div className="bg-slate-800/95 backdrop-blur border-b border-slate-700 sticky top-0 z-10">
        <div className="px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-amber-400">Health Check</h1>
              <p className="text-[11px] text-slate-400">17 critical jobs · auto-refresh 60s · last load {formatTime(lastRefresh)}</p>
            </div>
          </div>
          <button
            onClick={load}
            className="px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 rounded-lg text-xs text-slate-300 flex items-center gap-2 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary strip */}
        <div className="px-4 pb-3 flex gap-2 flex-wrap">
          {(['FRESH','RETRYING','STALE','MISSING','PENDING','UNKNOWN'] as Status[]).map(s => {
            const n = summary[s]
            const sty = STATUS_STYLE[s]
            if (n === 0) return null
            const Icon = sty.icon
            return (
              <div key={s} className={`px-3 py-1.5 rounded-lg border ${sty.bg} ${sty.border} flex items-center gap-2`}>
                <Icon className={`w-3.5 h-3.5 ${sty.color}`} />
                <span className={`text-xs font-bold ${sty.color}`}>{n} {sty.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Trigger result banner */}
      {triggerResult && (
        <div className={`mx-4 mt-4 px-4 py-3 rounded-xl border text-sm ${triggerResult.ok ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300' : 'bg-red-500/10 border-red-500/40 text-red-300'}`}>
          <b>{triggerResult.jobId}</b>: {triggerResult.msg}
        </div>
      )}

      {/* Grouped tables */}
      <div className="px-4 py-4 space-y-6">
        {(['SCRAPER', 'HOTSTOCKS', 'TRADE_EXEC', 'LIVE_FEED'] as const).map(cat => {
          const rows = grouped[cat]
          if (!rows.length) return null
          return (
            <section key={cat} className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/50">
                <h2 className="text-sm font-bold text-white">{CATEGORY_LABEL[cat]} <span className="text-slate-500 font-normal">· {rows.length} jobs</span></h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-800/50 text-slate-400 text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Job</th>
                      <th className="text-left px-3 py-2">Schedule</th>
                      <th className="text-left px-3 py-2">Last Run</th>
                      <th className="text-left px-3 py-2">Next</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">Affects</th>
                      <th className="text-left px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {rows.map(j => {
                      const sty = STATUS_STYLE[j.status]
                      const Icon = sty.icon
                      return (
                        <tr key={j.id} className="hover:bg-slate-700/20 transition-colors">
                          <td className="px-3 py-2 align-top">
                            <div className="font-semibold text-slate-100">{j.name}</div>
                            <div className="text-[10px] text-slate-500 max-w-md">{j.purpose}</div>
                          </td>
                          <td className="px-3 py-2 align-top text-slate-300 text-[11px] max-w-[160px]">{j.humanSchedule}</td>
                          <td className="px-3 py-2 align-top">
                            <div className="text-slate-200">{formatTime(j.lastRunEpochMs)}</div>
                            <div className="text-[10px] text-slate-500">{formatRelative(j.lastRunEpochMs)}</div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="text-slate-200">{formatTime(j.nextRunEpochMs)}</div>
                            <div className="text-[10px] text-slate-500">{formatRelative(j.nextRunEpochMs)}</div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border ${sty.bg} ${sty.border}`}>
                              <Icon className={`w-3 h-3 ${sty.color}`} />
                              <span className={`text-[10px] font-bold ${sty.color}`}>{sty.label}</span>
                            </div>
                            {j.statusReason && (
                              <div className="text-[10px] text-slate-500 mt-1 max-w-xs">{j.statusReason}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex flex-wrap gap-1">
                              {j.affectedStrategies.slice(0, 3).map(s => (
                                <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">{s}</span>
                              ))}
                              {j.affectedStrategies.length > 3 && (
                                <span className="text-[9px] text-slate-500">+{j.affectedStrategies.length - 3}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            {j.canTrigger ? (
                              <button
                                onClick={() => trigger(j.id)}
                                disabled={triggering === j.id}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[11px] text-amber-300 disabled:opacity-50 transition-colors"
                              >
                                <PlayCircle className={`w-3 h-3 ${triggering === j.id ? 'animate-pulse' : ''}`} />
                                {triggering === j.id ? 'Running…' : 'Run Now'}
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-600 italic">not triggerable</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
