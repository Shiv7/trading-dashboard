import { useState, useEffect } from 'react'
import { fetchJson } from '../../services/api'

interface Prediction {
  scripCode?: string
  available?: boolean
  direction?: string
  confidence?: number
  predictedPrice?: number
  predictedChange?: number
  timeframe?: string
  model?: string
  message?: string
}

interface MLPredictionCardProps {
  scripCode: string
}

export default function MLPredictionCard({ scripCode }: MLPredictionCardProps) {
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!scripCode) return
    fetchJson<Prediction>(`/analysis/${scripCode}/prediction`)
      .then(setPrediction)
      .catch(() => setPrediction(null))
      .finally(() => setLoading(false))
  }, [scripCode])

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <div className="h-6 w-32 bg-slate-700/50 rounded animate-pulse mb-3" />
        <div className="h-20 bg-slate-700/30 rounded animate-pulse" />
      </div>
    )
  }

  if (!prediction || prediction.available === false) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          ML Prediction
        </h3>
        <p className="text-sm text-slate-500 text-center py-3">ML prediction not available</p>
      </div>
    )
  }

  const confidence = prediction.confidence || 0
  const confidenceColor = confidence >= 70 ? 'text-emerald-400' : confidence >= 50 ? 'text-amber-400' : 'text-red-400'
  const confidenceBg = confidence >= 70 ? 'bg-emerald-500' : confidence >= 50 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        ML Prediction
        {prediction.model && (
          <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{prediction.model}</span>
        )}
      </h3>

      <div className="space-y-3">
        {/* Direction */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Direction</span>
          <span className={`text-sm font-bold ${
            prediction.direction === 'UP' || prediction.direction === 'BULLISH' ? 'text-emerald-400' :
            prediction.direction === 'DOWN' || prediction.direction === 'BEARISH' ? 'text-red-400' : 'text-slate-400'
          }`}>
            {prediction.direction === 'UP' || prediction.direction === 'BULLISH' ? 'Bullish' :
             prediction.direction === 'DOWN' || prediction.direction === 'BEARISH' ? 'Bearish' : 'Neutral'}
          </span>
        </div>

        {/* Confidence bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Confidence</span>
            <span className={`text-sm font-bold font-mono ${confidenceColor}`}>{confidence.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${confidenceBg}`}
              style={{ width: `${Math.min(100, confidence)}%` }}
            />
          </div>
        </div>

        {/* Predicted price */}
        {prediction.predictedPrice != null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Predicted Price</span>
            <span className="text-sm font-mono text-white">{prediction.predictedPrice.toFixed(2)}</span>
          </div>
        )}

        {/* Predicted change */}
        {prediction.predictedChange != null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Expected Move</span>
            <span className={`text-sm font-mono font-bold ${
              prediction.predictedChange >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {prediction.predictedChange >= 0 ? '+' : ''}{prediction.predictedChange.toFixed(2)}%
            </span>
          </div>
        )}

        {/* Timeframe */}
        {prediction.timeframe && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Timeframe</span>
            <span className="text-xs text-slate-300">{prediction.timeframe}</span>
          </div>
        )}
      </div>
    </div>
  )
}
