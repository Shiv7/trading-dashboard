import { useState } from 'react'
import { Link } from 'react-router-dom'

interface MasterArchSignal {
  scripCode: string
  companyName: string
  timestamp: string
  decision: 'ENTER_NOW' | 'WATCHLIST' | 'MONITOR' | 'REJECT'
  finalScore: number
  directionConfidence: number
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  recommendedLots: number
  hedgeRecommended: boolean
  hedgeType?: string
  indexContextScore: number
  securityContextScore: number
  signalStrengthScore: number
  decisionReason: string
  actionable: boolean
}

interface MasterArchPanelProps {
  signals?: MasterArchSignal[]
}

export default function MasterArchPanel({ signals = [] }: MasterArchPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // Filter to only actionable signals
  const actionableSignals = signals.filter(s => s.actionable || s.decision === 'ENTER_NOW' || s.decision === 'WATCHLIST')

  const getDecisionStyle = (decision: string) => {
    switch (decision) {
      case 'ENTER_NOW':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 animate-pulse'
      case 'WATCHLIST':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/50'
      case 'MONITOR':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50'
      case 'REJECT':
        return 'bg-red-500/20 text-red-400 border-red-500/50'
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/50'
    }
  }

  const getScoreColor = (score: number) => {
    const absScore = Math.abs(score)
    if (absScore >= 0.75) return 'text-emerald-400'
    if (absScore >= 0.5) return 'text-amber-400'
    return 'text-slate-400'
  }

  if (actionableSignals.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <span>🎯 Master Architecture (FF1)</span>
          </div>
        </div>
        <div className="py-8 text-center text-slate-500">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">No actionable signals</p>
          <p className="text-xs mt-1 text-slate-600">FF1 signals will appear when opportunities are detected</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <span>🎯 Master Architecture (FF1)</span>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-xs text-purple-400">{actionableSignals.length} active</span>
          </div>
        </div>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
        {actionableSignals.map((signal) => (
          <div
            key={signal.scripCode}
            className={`border rounded-lg overflow-hidden transition-all ${
              expanded === signal.scripCode ? 'ring-1 ring-purple-500/50' : ''
            }`}
          >
            {/* Header Row */}
            <div
              className="p-3 bg-slate-700/30 cursor-pointer hover:bg-slate-700/50 transition-colors"
              onClick={() => setExpanded(expanded === signal.scripCode ? null : signal.scripCode)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Direction indicator */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                    signal.direction === 'BULLISH' ? 'bg-emerald-500/20' : 'bg-red-500/20'
                  }`}>
                    {signal.direction === 'BULLISH' ? '📈' : '📉'}
                  </div>

                  <div>
                    <Link
                      to={`/stock/${signal.scripCode}`}
                      className="font-medium text-white hover:text-purple-400 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {signal.companyName}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className={getScoreColor(signal.finalScore)}>
                        Score: {(signal.finalScore * 100).toFixed(0)}%
                      </span>
                      <span>•</span>
                      <span>Conf: {(signal.directionConfidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Decision badge */}
                  <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getDecisionStyle(signal.decision)}`}>
                    {signal.decision.replace('_', ' ')}
                  </span>

                  {/* Lots */}
                  {signal.recommendedLots > 0 && (
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs">
                      {signal.recommendedLots} lot{signal.recommendedLots > 1 ? 's' : ''}
                    </span>
                  )}

                  {/* Hedge */}
                  {signal.hedgeRecommended && (
                    <span className="px-2 py-1 bg-amber-500/20 text-amber-400 rounded text-xs">
                      🛡️ Hedge
                    </span>
                  )}

                  {/* Expand icon */}
                  <svg
                    className={`w-5 h-5 text-slate-400 transition-transform ${expanded === signal.scripCode ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Expanded Details */}
            {expanded === signal.scripCode && (
              <div className="p-3 bg-slate-800/30 border-t border-slate-700/50 animate-slideDown">
                {/* Component Scores */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center p-2 bg-slate-700/30 rounded">
                    <div className="text-xs text-slate-400">Index Context</div>
                    <div className={`text-sm font-medium ${getScoreColor(signal.indexContextScore)}`}>
                      {(signal.indexContextScore * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-center p-2 bg-slate-700/30 rounded">
                    <div className="text-xs text-slate-400">Security Context</div>
                    <div className={`text-sm font-medium ${getScoreColor(signal.securityContextScore)}`}>
                      {(signal.securityContextScore * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-center p-2 bg-slate-700/30 rounded">
                    <div className="text-xs text-slate-400">Signal Strength</div>
                    <div className={`text-sm font-medium ${getScoreColor(signal.signalStrengthScore)}`}>
                      {(signal.signalStrengthScore * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                {/* Decision Reason */}
                {signal.decisionReason && (
                  <div className="text-xs text-slate-400 p-2 bg-slate-700/20 rounded">
                    <span className="text-slate-500">Reason:</span> {signal.decisionReason}
                  </div>
                )}

                {/* Timestamp */}
                <div className="text-xs text-slate-500 mt-2 text-right">
                  {new Date(signal.timestamp).toLocaleTimeString()}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
