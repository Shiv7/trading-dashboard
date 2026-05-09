import { useEffect, useState } from 'react'
import MondayShipPage from './MondayShipPage'

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

interface BasketRow {
  id: string
  strategy: string
  path: string                // RETEST | TREND
  scripCode: string
  symbol?: string
  exchange?: string
  direction?: string          // LONG | SHORT
  entryTime?: string
  breakTime?: string
  retestTime?: string
  triggerPrice?: number
  entryPrice?: number
  stopLoss?: number
  target1?: number
  riskPoints?: number
  t1RMultiple?: number
  ibh?: number
  ibl?: number
  ibRange?: number
  executionMode?: string      // PAPER | LIVE
  state?: string
  createdAt?: string
  // Phase 1 enrichment
  convictionScore?: number
  convictionGrade?: string    // A | B | C | F
  convictionComponents?: Record<string, number>
  convictionRationale?: string
  ofi?: number
  vpin?: number
  depthImbalance?: number
  buyPressure?: number
  volumeMultiplier?: number
  largeTradeCount?: number
  oiInterpretation?: string
  pivotConfluenceLabels?: string[]
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

const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : '-'

type TabKey = 'twelve-setups' | 'nifty50-basket' | 'crude-basket' | 'monday-ship'

export default function PivotBossPage() {
  const [tab, setTab] = useState<TabKey>('twelve-setups')

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'twelve-setups',  label: 'PivotBoss 12 Setups' },
    { key: 'nifty50-basket', label: 'Nifty50 Basket Retest' },
    { key: 'crude-basket',   label: 'Crude Oil Retest (MCX)' },
    { key: 'monday-ship',    label: 'Monday Ship (Paper)' },
  ]

  return (
    <div className="p-4 text-slate-200">
      <div className="flex items-center gap-2 mb-3">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1 text-xs rounded border ${tab === t.key
              ? 'bg-blue-600 text-white border-blue-500'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'twelve-setups' && <TwelveSetupsTab />}
      {tab === 'nifty50-basket' && (
        <BasketRetestTab strategy="NIFTY50_BASKET" title="Nifty50 Basket Retest" />
      )}
      {tab === 'crude-basket' && (
        <BasketRetestTab strategy="CRUDE_BASKET" title="Crude Oil Retest (MCX)" />
      )}
      {tab === 'monday-ship' && <MondayShipPage />}
    </div>
  )
}

function TwelveSetupsTab() {
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
    <div>
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
                <td className="px-2 py-1">{fmtTime(r.triggeredAt)}</td>
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

interface BasketRetestTabProps {
  strategy: string  // "NIFTY50_BASKET" | "CRUDE_BASKET"
  title: string
}

function BasketRetestTab({ strategy, title }: BasketRetestTabProps) {
  const [rows, setRows] = useState<BasketRow[]>([])
  const [pathFilter, setPathFilter] = useState<'ALL' | 'RETEST' | 'TREND'>('ALL')
  const [modeFilter, setModeFilter] = useState<'ALL' | 'PAPER' | 'LIVE'>('ALL')
  const [days, setDays] = useState<number>(2)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<Array<{ day: string; retest: number; trend: number; total: number }>>([])

  useEffect(() => {
    const load = () => {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('strategy', strategy)
      params.set('days', String(days))
      params.set('limit', '300')
      if (pathFilter !== 'ALL') params.set('path', pathFilter)
      if (modeFilter !== 'ALL') params.set('mode', modeFilter)

      fetch(`/api/pivotboss/basket-audit?${params.toString()}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then((d: BasketRow[]) => { setRows(d); setError(null) })
        .catch(e => setError(String(e)))
        .finally(() => setLoading(false))

      fetch(`/api/pivotboss/basket-audit/daily-stats?days=7&strategy=${strategy}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(setStats)
        .catch(() => { /* stats are optional */ })
    }
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [strategy, pathFilter, modeFilter, days])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <span className="text-xs text-slate-400">{rows.length} signals in last {days} day{days === 1 ? '' : 's'}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="text-slate-400">Path:</span>
        {(['ALL', 'RETEST', 'TREND'] as const).map(p => (
          <button
            key={p}
            onClick={() => setPathFilter(p)}
            className={`px-2 py-0.5 rounded border ${pathFilter === p
              ? 'bg-blue-600 text-white border-blue-500'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
          >
            {p}
          </button>
        ))}
        <span className="text-slate-400 ml-3">Mode:</span>
        {(['ALL', 'PAPER', 'LIVE'] as const).map(m => (
          <button
            key={m}
            onClick={() => setModeFilter(m)}
            className={`px-2 py-0.5 rounded border ${modeFilter === m
              ? 'bg-blue-600 text-white border-blue-500'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
          >
            {m}
          </button>
        ))}
        <span className="text-slate-400 ml-3">Days:</span>
        {[1, 2, 7].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2 py-0.5 rounded border ${days === d
              ? 'bg-blue-600 text-white border-blue-500'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {stats.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {stats.map(s => (
            <div key={s.day} className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300">
              <span className="text-slate-400">{s.day}:</span> {s.total} signals
              <span className="ml-1 text-emerald-400">{s.retest}R</span>
              <span className="ml-1 text-amber-400">{s.trend}T</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="bg-red-500/20 text-red-400 text-xs p-2 rounded mb-2">ERR {error}</div>}
      {loading && rows.length === 0 && <div className="text-sm text-slate-400">Loading…</div>}

      <div className="overflow-x-auto rounded border border-slate-700">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="px-2 py-1 text-left">Time (IST)</th>
              <th className="px-2 py-1 text-left">Symbol</th>
              <th className="px-2 py-1 text-left">ScripCode</th>
              <th className="px-2 py-1 text-left">Path</th>
              <th className="px-2 py-1 text-left">Dir</th>
              <th className="px-2 py-1 text-center" title="Conviction grade A/B/C/F + 0-100 score">Conv</th>
              <th className="px-2 py-1 text-right">Entry</th>
              <th className="px-2 py-1 text-right">SL</th>
              <th className="px-2 py-1 text-right">T1</th>
              <th className="px-2 py-1 text-right">Risk</th>
              <th className="px-2 py-1 text-right">R:R</th>
              <th className="px-2 py-1 text-right">IB hi</th>
              <th className="px-2 py-1 text-right">IB lo</th>
              <th className="px-2 py-1 text-left">Mode</th>
              <th className="px-2 py-1 text-left">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const pathColor = r.path === 'RETEST' ? 'text-emerald-400' : 'text-amber-400'
              const dirColor = r.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
              const modeColor = r.executionMode === 'LIVE'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-slate-700/40 text-slate-300 border border-slate-600/40'
              return (
                <tr key={r.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                  <td className="px-2 py-1">{fmtTime(r.entryTime || r.createdAt)}</td>
                  <td className="px-2 py-1">{r.symbol || <span className="text-slate-500 italic text-[10px]">DM</span>}</td>
                  <td className="px-2 py-1 text-slate-400">{r.scripCode}</td>
                  <td className={`px-2 py-1 ${pathColor}`}>{r.path || '-'}</td>
                  <td className={`px-2 py-1 ${dirColor}`}>{r.direction || '-'}</td>
                  <td className="px-2 py-1 text-center">
                    <ConvictionCell row={r} />
                  </td>
                  <td className="px-2 py-1 text-right">{fmt(r.entryPrice ?? r.triggerPrice)}</td>
                  <td className="px-2 py-1 text-right text-rose-300">{fmt(r.stopLoss)}</td>
                  <td className="px-2 py-1 text-right text-emerald-300">{fmt(r.target1)}</td>
                  <td className="px-2 py-1 text-right">{fmt(r.riskPoints)}</td>
                  <td className="px-2 py-1 text-right">{fmt(r.t1RMultiple, 1)}</td>
                  <td className="px-2 py-1 text-right text-slate-400">{fmt(r.ibh)}</td>
                  <td className="px-2 py-1 text-right text-slate-400">{fmt(r.ibl)}</td>
                  <td className="px-2 py-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${modeColor}`}>{r.executionMode || 'DM'}</span>
                  </td>
                  <td className="px-2 py-1 text-slate-400">{r.state || '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ConvictionCell({ row }: { row: BasketRow }) {
  const grade = row.convictionGrade
  const score = row.convictionScore
  if (grade == null || score == null) return <span className="text-slate-500 italic text-[10px]">DM</span>

  const cls = grade === 'A' ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
            : grade === 'B' ? 'bg-blue-500/25 text-blue-300 border border-blue-500/40'
            : grade === 'C' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
            : 'bg-rose-500/25 text-rose-300 border border-rose-500/40'

  const tooltip = [
    row.convictionRationale ? `Rationale: ${row.convictionRationale}` : '',
    row.convictionComponents
      ? Object.entries(row.convictionComponents).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' ')
      : '',
    row.pivotConfluenceLabels && row.pivotConfluenceLabels.length > 0
      ? `pivots: ${row.pivotConfluenceLabels.join(', ')}` : '',
    row.ofi != null ? `ofi=${row.ofi.toFixed(0)}` : '',
    row.vpin != null ? `vpin=${row.vpin.toFixed(2)}` : '',
    row.oiInterpretation ? `oi=${row.oiInterpretation}` : '',
  ].filter(Boolean).join(' | ')

  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] cursor-help ${cls}`} title={tooltip}>
      {grade} {score.toFixed(0)}
    </span>
  )
}
