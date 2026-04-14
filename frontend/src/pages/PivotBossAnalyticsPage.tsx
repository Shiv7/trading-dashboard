import { useEffect, useState } from 'react'

interface SetupStat {
  setupId: number
  fired: number
  rejected: number
  total: number
  fireRate: number
  avgBias: number
}

interface RegimeCell {
  cprRegime: string
  twoDayRelation: string
  fired: number
  total: number
  fireRate: number
}

const SETUP_NAMES: Record<number, string> = {
  1: 'IB Breakout Bull',  2: 'IB Breakout Bear',  3: 'Cam H3 Retest',  4: 'Cam L3 Retest',
  5: 'H4/L4 Extension',   6: 'Open>R1 Fade',      7: 'Open<S1 Fade',   8: 'H3↔L3 Reversal',
  9: 'Failed Breakout',   10: 'Gap and Go',       11: 'Gap Fill',      12: 'Double Touch',
}

const cellShade = (rate: number) => {
  if (rate >= 0.5) return 'bg-emerald-500/30'
  if (rate >= 0.3) return 'bg-emerald-500/15'
  if (rate >= 0.15) return 'bg-amber-500/15'
  return 'bg-rose-500/10'
}

export default function PivotBossAnalyticsPage() {
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<SetupStat[]>([])
  const [matrix, setMatrix] = useState<RegimeCell[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/pivotboss/analytics/setup-stats?days=${days}`).then(r => r.json()),
      fetch(`/api/pivotboss/analytics/regime-matrix?days=${days}`).then(r => r.json()),
    ])
      .then(([s, m]) => { setStats(s); setMatrix(m); setErr(null) })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <div className="p-4 text-slate-200 space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">PivotBoss Analytics — R&amp;F</h1>
        <div className="space-x-1 text-xs">
          {[1, 7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2 py-1 rounded ${days === d ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>
      {err && <div className="bg-red-500/20 text-red-400 text-xs p-2 rounded">ERR {err}</div>}
      {loading && <div className="text-sm text-slate-400">Loading…</div>}

      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Per-Setup Performance</h2>
        <div className="overflow-x-auto rounded border border-slate-700">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-800 text-slate-400">
              <tr>
                <th className="px-2 py-1 text-left">#</th>
                <th className="px-2 py-1 text-left">Setup</th>
                <th className="px-2 py-1 text-right">Fired</th>
                <th className="px-2 py-1 text-right">Rejected</th>
                <th className="px-2 py-1 text-right">Total</th>
                <th className="px-2 py-1 text-right">Fire Rate</th>
                <th className="px-2 py-1 text-right">Avg Bias</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.setupId} className="border-t border-slate-700">
                  <td className="px-2 py-1">{s.setupId}</td>
                  <td className="px-2 py-1">{SETUP_NAMES[s.setupId] || '-'}</td>
                  <td className="px-2 py-1 text-right text-emerald-300">{s.fired}</td>
                  <td className="px-2 py-1 text-right text-rose-300">{s.rejected}</td>
                  <td className="px-2 py-1 text-right">{s.total}</td>
                  <td className={`px-2 py-1 text-right ${cellShade(s.fireRate)}`}>{(s.fireRate * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1 text-right">{s.avgBias.toFixed(0)}</td>
                </tr>
              ))}
              {stats.length === 0 && !loading && (
                <tr><td colSpan={7} className="text-center px-2 py-3 text-slate-500 italic text-[10px]">DM (no audit rows in window)</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Regime × Two-Day Relation</h2>
        <div className="overflow-x-auto rounded border border-slate-700">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-800 text-slate-400">
              <tr>
                <th className="px-2 py-1 text-left">CPR Regime</th>
                <th className="px-2 py-1 text-left">2-Day Relation</th>
                <th className="px-2 py-1 text-right">Fired</th>
                <th className="px-2 py-1 text-right">Total</th>
                <th className="px-2 py-1 text-right">Fire Rate</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((c, i) => (
                <tr key={i} className="border-t border-slate-700">
                  <td className="px-2 py-1">{c.cprRegime}</td>
                  <td className="px-2 py-1">{c.twoDayRelation}</td>
                  <td className="px-2 py-1 text-right text-emerald-300">{c.fired}</td>
                  <td className="px-2 py-1 text-right">{c.total}</td>
                  <td className={`px-2 py-1 text-right ${cellShade(c.fireRate)}`}>{(c.fireRate * 100).toFixed(0)}%</td>
                </tr>
              ))}
              {matrix.length === 0 && !loading && (
                <tr><td colSpan={5} className="text-center px-2 py-3 text-slate-500 italic text-[10px]">DM</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
