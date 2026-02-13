import { useState, useEffect } from 'react'
import { fetchJson } from '../../services/api'

interface RegimeData {
  regime?: string
  confidence?: number
  description?: string
  volatility?: string
  trend?: string
}

interface RegimeBadgeProps {
  scripCode: string
  inline?: boolean
}

export default function RegimeBadge({ scripCode, inline = false }: RegimeBadgeProps) {
  const [regime, setRegime] = useState<RegimeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!scripCode) return
    fetchJson<RegimeData>(`/analysis/${scripCode}/regime`)
      .then(setRegime)
      .catch(() => setRegime(null))
      .finally(() => setLoading(false))
  }, [scripCode])

  if (loading) {
    return <div className="h-6 w-20 bg-slate-700/50 rounded animate-pulse" />
  }

  if (!regime) return null

  const regimeType = (regime.regime || 'UNKNOWN').toUpperCase()
  const confidence = regime.confidence || 0

  const getRegimeStyle = () => {
    if (regimeType.includes('BULL') || regimeType === 'UP' || regimeType === 'TRENDING_UP') {
      return { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'Bullish' }
    }
    if (regimeType.includes('BEAR') || regimeType === 'DOWN' || regimeType === 'TRENDING_DOWN') {
      return { bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-400', label: 'Bearish' }
    }
    if (regimeType.includes('RANG') || regimeType === 'SIDEWAYS') {
      return { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-400', label: 'Ranging' }
    }
    return { bg: 'bg-slate-500/15', border: 'border-slate-500/30', text: 'text-slate-400', label: regimeType }
  }

  const style = getRegimeStyle()

  if (inline) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${style.bg} ${style.border} ${style.text} border`}>
        <span className={`w-1.5 h-1.5 rounded-full ${style.text.replace('text-', 'bg-')}`} />
        {style.label}
        {confidence > 0 && <span className="opacity-70">{confidence.toFixed(0)}%</span>}
      </span>
    )
  }

  return (
    <div className={`rounded-xl p-4 border ${style.bg} ${style.border}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Market Regime
        </h3>
        <span className={`text-lg font-bold ${style.text}`}>{style.label}</span>
      </div>

      {confidence > 0 && (
        <div className="mt-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Confidence</span>
            <span className={`font-mono ${style.text}`}>{confidence.toFixed(1)}%</span>
          </div>
          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${style.text.replace('text-', 'bg-')}`}
              style={{ width: `${Math.min(100, confidence)}%` }}
            />
          </div>
        </div>
      )}

      {regime.volatility && (
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-slate-400">Volatility</span>
          <span className="text-slate-300">{regime.volatility}</span>
        </div>
      )}

      {regime.description && (
        <p className="mt-2 text-xs text-slate-400">{regime.description}</p>
      )}
    </div>
  )
}
