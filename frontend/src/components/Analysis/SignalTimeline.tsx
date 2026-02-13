import { useState, useEffect } from 'react'
import { fetchJson } from '../../services/api'

interface SignalEntry {
  scripCode: string
  direction?: string
  score?: number
  entry?: number
  stopLoss?: number
  target1?: number
  target2?: number
  strategy?: string
  timestamp?: string
  isCurrent?: boolean
}

interface SignalTimelineProps {
  scripCode: string
}

export default function SignalTimeline({ scripCode }: SignalTimelineProps) {
  const [signals, setSignals] = useState<SignalEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!scripCode) return
    fetchJson<SignalEntry[]>(`/analysis/${scripCode}/signals`)
      .then(setSignals)
      .catch(() => setSignals([]))
      .finally(() => setLoading(false))
  }, [scripCode])

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <div className="h-6 w-36 bg-slate-700/50 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-slate-700/30 rounded animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
      <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Signal History
      </h3>

      {signals.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-4">No signals recorded</p>
      ) : (
        <div className="space-y-2">
          {signals.map((sig, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg border transition-all ${
                sig.isCurrent
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-slate-900/30 border-slate-700/30 hover:border-slate-600/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {sig.isCurrent && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-400 rounded">LIVE</span>
                  )}
                  <span className={`text-xs font-bold ${
                    sig.direction === 'BULLISH' ? 'text-emerald-400' :
                    sig.direction === 'BEARISH' ? 'text-red-400' : 'text-slate-400'
                  }`}>
                    {sig.direction || 'NEUTRAL'}
                  </span>
                  {sig.strategy && (
                    <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{sig.strategy}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {sig.score != null && (
                    <span className={`text-xs font-mono font-bold ${
                      sig.score >= 7 ? 'text-emerald-400' : sig.score >= 5 ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {sig.score.toFixed(1)}
                    </span>
                  )}
                  {sig.timestamp && (
                    <span className="text-[10px] text-slate-500">{new Date(sig.timestamp).toLocaleString()}</span>
                  )}
                </div>
              </div>
              {(sig.entry || sig.stopLoss || sig.target1) && (
                <div className="flex gap-4 text-[11px] text-slate-400 font-mono">
                  {sig.entry != null && <span>Entry: {sig.entry.toFixed(2)}</span>}
                  {sig.stopLoss != null && <span className="text-red-400">SL: {sig.stopLoss.toFixed(2)}</span>}
                  {sig.target1 != null && <span className="text-emerald-400">TP1: {sig.target1.toFixed(2)}</span>}
                  {sig.target2 != null && <span className="text-blue-400">TP2: {sig.target2.toFixed(2)}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
