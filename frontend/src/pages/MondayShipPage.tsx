import { useEffect, useState } from 'react'
import axios from 'axios'

// Monday 2026-04-20 Ship — paper-mode observation dashboard
// NIFTY Index Trader + Nifty50 Basket + RETEST v2 all feed signal_rich_audit.
// This page shows today's live signals + per-strategy summary.

interface Signal {
  _id?: string
  strategy: string
  path?: string            // RETEST | TREND — added 2026-04-22 hybrid ship
  scripCode: string
  symbol: string
  direction: string
  entryTime: string
  triggerPrice: number
  stopLoss: number
  target1: number
  riskPoints: number
  ibh?: number
  ibl?: number
  executionMode: string
  state: string
  mtfState?: Record<string, unknown>
  oiState?: Record<string, unknown>
}

interface Summary {
  date: string
  [key: string]: unknown
}

const API_BASE = '/api/monday-ship'

interface ShadowStats {
  date: string
  totalWithCompositeScore: number
  perSource: Record<string, Record<string, number>>
  avgScoresPerSource: Record<string, { n: number; avgScore: number }>
  recent: Array<{
    firstSeenAt: string
    strategy: string
    scripCode: string
    symbol?: string
    optionType?: string
    compositeScore?: number
    compositeDecision?: string
    compositeReason?: string
    batchOutcome?: string
  }>
}

export default function MondayShipPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [shadow, setShadow] = useState<ShadowStats | null>(null)
  const [selectedStrategy, setSelectedStrategy] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [sigRes, sumRes, shadowRes] = await Promise.all([
        axios.get(`${API_BASE}/signals`, {
          params: selectedStrategy ? { strategy: selectedStrategy } : undefined
        }),
        axios.get(`${API_BASE}/summary`),
        axios.get(`${API_BASE}/shadow-stats`)
      ])
      setSignals(sigRes.data || [])
      setSummary(sumRes.data)
      setShadow(shadowRes.data)
    } catch (e) {
      console.error('fetch failed', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [selectedStrategy])

  const strategies = ['NIFTY_INDEX_TRADER', 'NIFTY50_BASKET', 'RETEST_V2']

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Monday 2026-04-20 Ship — Paper Mode Observation</h1>
      <p className="text-sm text-gray-600 mb-4">
        Live signals from NIFTY Index Trader, Nifty50 Basket, and RETEST v2. No real trades
        until Tuesday review. Refreshes every 30s.
      </p>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {strategies.map(strategy => {
            const s = (summary[strategy] as {
              total_signals?: number
              long_signals?: number
              short_signals?: number
            }) || {}
            return (
              <div
                key={strategy}
                onClick={() => setSelectedStrategy(selectedStrategy === strategy ? '' : strategy)}
                className={`border rounded-lg p-4 cursor-pointer hover:shadow-md transition ${
                  selectedStrategy === strategy ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <h3 className="font-semibold text-sm mb-2">{strategy}</h3>
                <div className="text-2xl font-bold">{s.total_signals || 0}</div>
                <div className="text-xs text-gray-500 mt-1">
                  L: {s.long_signals || 0} / S: {s.short_signals || 0}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Composite-gate shadow panel (2026-04-23) ── */}
      {shadow && (
        <div className="border-2 border-purple-400 rounded-lg p-4 mb-6 bg-purple-50">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-purple-900">
              Shadow OptionCompositeGate
              <span className="text-xs font-normal text-purple-700 ml-2">
                (log-only; {shadow.totalWithCompositeScore} evaluations today)
              </span>
            </h2>
            <span className="text-xs text-gray-500">
              Existing RR gate still enforces. Composite gets promoted once calibrated.
            </span>
          </div>

          {/* Per-source decision breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {Object.entries(shadow.perSource).map(([source, decisions]) => {
              const avg = shadow.avgScoresPerSource?.[source]
              const total = Object.values(decisions).reduce((a, b) => a + b, 0)
              return (
                <div key={source} className="bg-white rounded p-3 border">
                  <div className="font-semibold text-sm text-purple-800">{source}</div>
                  <div className="text-xs text-gray-500 mb-2">
                    {total} sig{avg && <span> · avg={avg.avgScore}</span>}
                  </div>
                  <div className="space-y-1">
                    {Object.entries(decisions).map(([dec, n]) => (
                      <div key={dec} className="flex justify-between text-xs">
                        <span className={`font-mono ${
                          dec === 'PASS_T2' ? 'text-emerald-700' :
                          dec === 'PASS_T1' ? 'text-blue-700' :
                          dec === 'REJECT' ? 'text-red-600' : 'text-gray-500'
                        }`}>{dec}</span>
                        <span className="font-semibold">{n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {Object.keys(shadow.perSource).length === 0 && (
              <div className="col-span-5 text-center text-sm text-gray-500 italic py-4">
                No composite evaluations yet today (waiting for option-strategy signals)
              </div>
            )}
          </div>

          {/* Recent 15 shadow decisions */}
          {shadow.recent.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold text-xs text-purple-700 mb-2">Last 15 evaluations</h3>
              <div className="overflow-x-auto rounded border bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-purple-100">
                    <tr>
                      <th className="p-1.5 text-left">Time</th>
                      <th className="p-1.5 text-left">Source</th>
                      <th className="p-1.5 text-left">Scrip</th>
                      <th className="p-1.5 text-left">Symbol</th>
                      <th className="p-1.5 text-left">Opt</th>
                      <th className="p-1.5 text-right">Score</th>
                      <th className="p-1.5 text-left">Decision</th>
                      <th className="p-1.5 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shadow.recent.map((r, i) => (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="p-1.5 font-mono text-[10px]">
                          {new Date(r.firstSeenAt).toLocaleTimeString('en-IN', {
                            timeZone: 'Asia/Kolkata', hour12: false
                          })}
                        </td>
                        <td className="p-1.5">{r.strategy}</td>
                        <td className="p-1.5 font-mono text-[10px]">{r.scripCode}</td>
                        <td className="p-1.5">{r.symbol || '—'}</td>
                        <td className="p-1.5">{r.optionType || '—'}</td>
                        <td className={`p-1.5 text-right font-bold ${
                          (r.compositeScore || 0) >= 75 ? 'text-emerald-700' :
                          (r.compositeScore || 0) >= 60 ? 'text-blue-700' :
                          'text-red-600'
                        }`}>{r.compositeScore}</td>
                        <td className="p-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            r.compositeDecision === 'PASS_T2' ? 'bg-emerald-100 text-emerald-700' :
                            r.compositeDecision === 'PASS_T1' ? 'bg-blue-100 text-blue-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {r.compositeDecision}
                          </span>
                        </td>
                        <td className="p-1.5 text-[10px] text-gray-600 max-w-md truncate" title={r.compositeReason}>
                          {r.compositeReason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <select
          value={selectedStrategy}
          onChange={e => setSelectedStrategy(e.target.value)}
          className="border rounded px-3 py-1 text-sm"
        >
          <option value="">All strategies</option>
          {strategies.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={fetchData}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-1 rounded text-sm disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="text-sm text-gray-500">{signals.length} signals</span>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Time (IST)</th>
              <th className="p-2 text-left">Strategy</th>
              <th className="p-2 text-left">Path</th>
              <th className="p-2 text-left">Symbol</th>
              <th className="p-2 text-left">Dir</th>
              <th className="p-2 text-right">Entry</th>
              <th className="p-2 text-right">SL</th>
              <th className="p-2 text-right">T1</th>
              <th className="p-2 text-right">Risk</th>
              <th className="p-2 text-right">IBH</th>
              <th className="p-2 text-right">IBL</th>
              <th className="p-2 text-left">Mode</th>
              <th className="p-2 text-left">State</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((sig, i) => (
              <tr key={sig._id || i} className="border-t hover:bg-gray-50">
                <td className="p-2 font-mono text-xs">
                  {sig.entryTime ? new Date(sig.entryTime).toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata', hour12: false
                  }) : '—'}
                </td>
                <td className="p-2 text-xs">{sig.strategy}</td>
                <td className="p-2 text-xs">
                  {sig.path ? (
                    <span className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                      sig.path === 'RETEST'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-orange-100 text-orange-700'
                    }`}>
                      {sig.path}
                    </span>
                  ) : <span className="text-slate-500 italic text-[10px]">DM</span>}
                </td>
                <td className="p-2 font-semibold">{sig.symbol}</td>
                <td className={`p-2 font-bold ${sig.direction === 'LONG' ? 'text-green-600' : 'text-red-600'}`}>
                  {sig.direction}
                </td>
                <td className="p-2 text-right font-mono">{fmt(sig.triggerPrice)}</td>
                <td className="p-2 text-right font-mono text-red-600">{fmt(sig.stopLoss)}</td>
                <td className="p-2 text-right font-mono text-green-600">{fmt(sig.target1)}</td>
                <td className="p-2 text-right font-mono text-xs">{fmt(sig.riskPoints)}</td>
                <td className="p-2 text-right font-mono text-xs text-gray-500">
                  {sig.ibh ? fmt(sig.ibh) : '—'}
                </td>
                <td className="p-2 text-right font-mono text-xs text-gray-500">
                  {sig.ibl ? fmt(sig.ibl) : '—'}
                </td>
                <td className="p-2 text-xs">
                  <span className={`px-2 py-0.5 rounded ${
                    sig.executionMode === 'PAPER' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {sig.executionMode}
                  </span>
                </td>
                <td className="p-2 text-xs">{sig.state}</td>
              </tr>
            ))}
            {signals.length === 0 && !loading && (
              <tr>
                <td colSpan={13} className="p-8 text-center text-gray-500">
                  No signals today.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Endpoint: {API_BASE}/signals — updates automatically. Click a strategy card to filter.
      </p>
    </div>
  )
}

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(2)
}
