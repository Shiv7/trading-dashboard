import { useState, useEffect } from 'react'
import { fetchJson } from '../../services/api'

interface PivotData {
  pp?: number
  r1?: number
  r2?: number
  r3?: number
  s1?: number
  s2?: number
  s3?: number
  message?: string
}

interface PivotLevelsProps {
  scripCode: string
  currentPrice?: number
}

export default function PivotLevels({ scripCode, currentPrice }: PivotLevelsProps) {
  const [pivots, setPivots] = useState<PivotData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!scripCode) return
    fetchJson<PivotData>(`/analysis/${scripCode}/pivots`)
      .then(setPivots)
      .catch(() => setPivots(null))
      .finally(() => setLoading(false))
  }, [scripCode])

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <div className="h-6 w-28 bg-slate-700/50 rounded animate-pulse mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className="h-8 bg-slate-700/30 rounded animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!pivots || pivots.message) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <h3 className="text-sm font-bold text-white mb-2">Pivot Levels</h3>
        <p className="text-sm text-slate-500 text-center py-4">Pivot data not available</p>
      </div>
    )
  }

  const levels = [
    { label: 'R3', value: pivots.r3, type: 'resistance' },
    { label: 'R2', value: pivots.r2, type: 'resistance' },
    { label: 'R1', value: pivots.r1, type: 'resistance' },
    { label: 'PP', value: pivots.pp, type: 'pivot' },
    { label: 'S1', value: pivots.s1, type: 'support' },
    { label: 'S2', value: pivots.s2, type: 'support' },
    { label: 'S3', value: pivots.s3, type: 'support' },
  ].filter(l => l.value != null)

  const getDistancePercent = (level: number): string => {
    if (!currentPrice || currentPrice === 0) return ''
    const pct = ((level - currentPrice) / currentPrice) * 100
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
  }

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
      <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Pivot Levels
      </h3>

      <div className="space-y-1.5">
        {levels.map(level => {
          const isNearCurrent = currentPrice && level.value &&
            Math.abs(level.value - currentPrice) / currentPrice < 0.005

          return (
            <div
              key={level.label}
              className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                level.type === 'pivot'
                  ? 'bg-amber-500/10 border border-amber-500/20'
                  : isNearCurrent
                    ? 'bg-blue-500/10 border border-blue-500/20'
                    : 'bg-slate-900/30'
              }`}
            >
              <span className={`text-xs font-bold ${
                level.type === 'resistance' ? 'text-red-400' :
                level.type === 'support' ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {level.label}
              </span>
              <span className="text-sm font-mono text-white">
                {level.value?.toFixed(2)}
              </span>
              {currentPrice && level.value && (
                <span className={`text-[10px] font-mono ${
                  level.value > currentPrice ? 'text-red-400' : 'text-emerald-400'
                }`}>
                  {getDistancePercent(level.value)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {currentPrice && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Current Price</span>
            <span className="text-white font-mono font-bold">{currentPrice.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
