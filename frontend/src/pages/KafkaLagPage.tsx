import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, AlertTriangle, Activity, CheckCircle2 } from 'lucide-react'
import { API_BASE, fetchWithAuth } from '../services/api'

/**
 * KafkaLagPage — consumer-group lag per topic per group.
 *
 * Polls /api/admin/kafka-lag every 30s. Flags rows lag > 1000 red because the
 * trading-signal topics (trading-signals-v2 / kotsin_FUDKII / kotsin_FUKAA /
 * kotsin_FUDKOI) are the pre-trade-execution pipe — any significant backlog
 * there means the next signal arrives stale.
 */

const POLL_MS = 30_000
const LAG_THRESHOLD = 1000

// Topics considered critical — lag > threshold here always flags red.
const CRITICAL_TOPICS = new Set([
  'trading-signals-v2',
  'kotsin_FUDKII',
  'kotsin_FUKAA',
  'kotsin_FUDKOI',
])

interface LagRow {
  topic: string
  group: string
  lag: number
  partitions: number
  members: number
}

interface ApiError {
  error: string
  detail?: string
  bootstrap?: string
}

function isApiError(v: unknown): v is ApiError {
  return !!v && typeof v === 'object' && 'error' in (v as Record<string, unknown>)
}

export default function KafkaLagPage() {
  const [rows, setRows] = useState<LagRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastFetched, setLastFetched] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWithAuth(`${API_BASE}/admin/kafka-lag`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(isApiError(body) ? `${body.error}: ${body.detail ?? ''}` : `HTTP ${res.status}`)
        setRows([])
      } else {
        const body = await res.json()
        if (Array.isArray(body)) {
          setRows(body as LagRow[])
          setError(null)
        } else if (isApiError(body)) {
          setError(`${body.error}: ${body.detail ?? ''}`)
          setRows([])
        } else {
          setError('Unexpected response shape')
          setRows([])
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setRows([])
    } finally {
      setLastFetched(Date.now())
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const criticalBacklog = rows.filter(r =>
    CRITICAL_TOPICS.has(r.topic) && r.lag > LAG_THRESHOLD
  ).length
  const totalLag = rows.reduce((s, r) => s + (r.lag || 0), 0)

  return (
    <div className="text-slate-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-semibold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-amber-400" />
            Kafka Consumer Lag
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Lag per topic per consumer group. Polls every 30s. Critical topics flag red when lag &gt; {LAG_THRESHOLD}.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 rounded-lg text-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Rows</div>
          <div className="text-xl font-semibold text-white mt-1">{rows.length}</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Total lag</div>
          <div className="text-xl font-semibold text-white mt-1">{totalLag.toLocaleString()}</div>
        </div>
        <div className={`border rounded-lg p-3 ${criticalBacklog > 0 ? 'bg-red-500/15 border-red-500/50' : 'bg-slate-800/50 border-slate-700/60'}`}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Critical backlogs</div>
          <div className={`text-xl font-semibold mt-1 ${criticalBacklog > 0 ? 'text-red-300' : 'text-white'}`}>{criticalBacklog}</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Last fetched</div>
          <div className="text-sm font-medium text-slate-200 mt-1">
            {lastFetched ? new Date(lastFetched).toLocaleTimeString('en-IN', { hour12: false }) : 'DM'}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/15 border border-red-500/40 rounded-lg p-3 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">Unable to fetch lag</div>
            <div className="text-xs text-red-400/80 mt-0.5">{error}</div>
          </div>
        </div>
      )}

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Topic</th>
              <th className="text-left px-4 py-2.5 font-medium">Group</th>
              <th className="text-right px-4 py-2.5 font-medium">Lag</th>
              <th className="text-right px-4 py-2.5 font-medium">Partitions</th>
              <th className="text-right px-4 py-2.5 font-medium">Members</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && !error && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-slate-500 text-sm">
                  No consumer-group lag data. <span className="text-slate-600">(Broker may be idle.)</span>
                </td>
              </tr>
            )}
            {rows.map((r, idx) => {
              const isCritical = CRITICAL_TOPICS.has(r.topic)
              const isRed = r.lag > LAG_THRESHOLD
              const rowBg = isRed
                ? 'bg-red-500/15 hover:bg-red-500/20'
                : idx % 2 === 0 ? 'bg-slate-900/40 hover:bg-slate-800/40' : 'hover:bg-slate-800/40'
              return (
                <tr key={`${r.topic}|${r.group}`} className={`border-t border-slate-800/60 ${rowBg}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs ${isCritical ? 'text-amber-300' : 'text-slate-200'}`}>{r.topic}</span>
                      {isCritical && (
                        <span className="text-[9px] uppercase tracking-wider bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                          critical
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{r.group}</td>
                  <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${isRed ? 'text-red-300 font-semibold' : 'text-slate-200'}`}>
                    {r.lag?.toLocaleString?.() ?? r.lag}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-400">{r.partitions}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-400">{r.members}</td>
                  <td className="px-4 py-2.5">
                    {isRed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-red-500/20 text-red-300 px-2 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3" />
                        Backlog
                      </span>
                    ) : r.members === 0 ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-slate-700/40 text-slate-400 px-2 py-0.5 rounded">
                        No consumers
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded">
                        <CheckCircle2 className="w-3 h-3" />
                        Healthy
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
