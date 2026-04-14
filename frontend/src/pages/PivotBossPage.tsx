import { useEffect, useState } from 'react'

interface AuditRow {
  id: string
  scripCode: string
  symbol?: string
  triggeredAt: string
  decision: string
  setupId?: number
  direction?: string
  biasScore?: number
  cprRegime?: string
  twoDayRelation?: string
  gapClass?: string
  entryPrice?: number
  stopLoss?: number
  target1?: number
  target2?: number
  target3?: number
  rrOnUnderlying?: number
  optionScripCode?: string
  optionLtp?: number
}

const SETUP_NAMES: Record<number, string> = {
  1: 'IB Breakout Retest Bull',
  2: 'IB Breakout Retest Bear',
  3: 'Cam H3 Breakout Retest',
  4: 'Cam L3 Breakout Retest',
  5: 'H4/L4 Extension',
  6: 'Open >R1 Fade to P',
  7: 'Open <S1 Fade to P',
  8: 'H3↔L3 Range Reversal',
  9: 'Failed Breakout Reversal',
  10: 'Gap and Go',
  11: 'Gap Fill',
  12: 'Double Touch',
}

const fmt = (n?: number, d = 2) =>
  n === undefined || n === null ? <span className="text-slate-500 italic text-[10px]">DM</span> : n.toFixed(d)

export default function PivotBossPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = () => {
      setLoading(true)
      fetch('/api/pivotboss/audit?decision=FIRED&days=2&limit=100')
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(d => { setRows(d); setError(null) })
        .catch(e => setError(String(e)))
        .finally(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="p-4 text-slate-200">
      <div className="flex items-baseline justify-between mb-3">
        <h1 className="text-xl font-semibold">PivotBoss Live Signals</h1>
        <span className="text-xs text-slate-400">{rows.length} fired in last 2 days</span>
      </div>
      {error && <div className="bg-red-500/20 text-red-400 text-xs p-2 rounded mb-2">ERR {error}</div>}
      {loading && rows.length === 0 && <div className="text-sm text-slate-400">Loading…</div>}
      <div className="overflow-x-auto rounded border border-slate-700">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="px-2 py-1 text-left">Time (IST)</th>
              <th className="px-2 py-1 text-left">Scrip</th>
              <th className="px-2 py-1 text-left">Setup</th>
              <th className="px-2 py-1 text-left">Dir</th>
              <th className="px-2 py-1 text-right">Bias</th>
              <th className="px-2 py-1 text-left">Regime</th>
              <th className="px-2 py-1 text-left">2-Day</th>
              <th className="px-2 py-1 text-right">Entry</th>
              <th className="px-2 py-1 text-right">SL</th>
              <th className="px-2 py-1 text-right">T1</th>
              <th className="px-2 py-1 text-right">T2</th>
              <th className="px-2 py-1 text-right">T3</th>
              <th className="px-2 py-1 text-right">R:R</th>
              <th className="px-2 py-1 text-left">Option</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                <td className="px-2 py-1">{new Date(r.triggeredAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}</td>
                <td className="px-2 py-1">{r.symbol || r.scripCode}</td>
                <td className="px-2 py-1">{r.setupId ? `#${r.setupId} ${SETUP_NAMES[r.setupId] ?? ''}` : '-'}</td>
                <td className={`px-2 py-1 ${r.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>{r.direction || '-'}</td>
                <td className="px-2 py-1 text-right">{fmt(r.biasScore, 0)}</td>
                <td className="px-2 py-1">{r.cprRegime || '-'}</td>
                <td className="px-2 py-1">{r.twoDayRelation || '-'}</td>
                <td className="px-2 py-1 text-right">{fmt(r.entryPrice)}</td>
                <td className="px-2 py-1 text-right text-rose-300">{fmt(r.stopLoss)}</td>
                <td className="px-2 py-1 text-right text-emerald-300">{fmt(r.target1)}</td>
                <td className="px-2 py-1 text-right text-emerald-300">{fmt(r.target2)}</td>
                <td className="px-2 py-1 text-right text-emerald-300">{fmt(r.target3)}</td>
                <td className="px-2 py-1 text-right">{fmt(r.rrOnUnderlying)}</td>
                <td className="px-2 py-1">{r.optionScripCode ? `${r.optionScripCode} @ ${fmt(r.optionLtp)}` : <span className="text-slate-500 italic text-[10px]">DM</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
