import type { QuantScore, QuantScoreBreakdown } from '../../types'
import { TIMEFRAMES } from '../../hooks/useTimeframeScores'

interface MTFScoreHeatmapProps {
  scores: QuantScore[]
}

const SCORE_CATEGORIES = [
  { key: 'greeksScore', pctKey: 'greeksPct', label: 'Greeks', max: 15 },
  { key: 'ivSurfaceScore', pctKey: 'ivSurfacePct', label: 'IV Surface', max: 12 },
  { key: 'microstructureScore', pctKey: 'microstructurePct', label: 'Microstructure', max: 18 },
  { key: 'optionsFlowScore', pctKey: 'optionsFlowPct', label: 'Options Flow', max: 15 },
  { key: 'priceActionScore', pctKey: 'priceActionPct', label: 'Price Action', max: 12 },
  { key: 'volumeProfileScore', pctKey: 'volumeProfilePct', label: 'Volume', max: 8 },
  { key: 'crossInstrumentScore', pctKey: 'crossInstrumentPct', label: 'Cross-Instr', max: 10 },
  { key: 'confluenceScore', pctKey: 'confluencePct', label: 'Confluence', max: 10 },
] as const

export function MTFScoreHeatmap({ scores }: MTFScoreHeatmapProps) {
  // Create a map for quick lookup
  const scoreMap = new Map<string, QuantScore>()
  scores.forEach(s => {
    if (s.timeframe) scoreMap.set(s.timeframe, s)
  })

  const getScoreColor = (score: number, max: number) => {
    const pct = (score / max) * 100
    if (pct >= 80) return 'bg-emerald-500/40 text-emerald-300'
    if (pct >= 60) return 'bg-emerald-500/20 text-emerald-400'
    if (pct >= 40) return 'bg-amber-500/20 text-amber-400'
    if (pct >= 20) return 'bg-red-500/20 text-red-400'
    return 'bg-slate-700/50 text-slate-500'
  }

  const getTotalScoreColor = (score: number) => {
    if (score >= 75) return 'bg-emerald-500/30 text-emerald-300'
    if (score >= 60) return 'bg-emerald-500/20 text-emerald-400'
    if (score >= 45) return 'bg-amber-500/20 text-amber-400'
    if (score >= 30) return 'bg-red-500/20 text-red-400'
    return 'bg-slate-700/50 text-slate-400'
  }

  const getDirectionIcon = (direction?: string) => {
    if (direction === 'BULLISH') return { icon: '\u25B2', color: 'text-emerald-400' }
    if (direction === 'BEARISH') return { icon: '\u25BC', color: 'text-red-400' }
    return { icon: '\u25CF', color: 'text-slate-500' }
  }

  // Helper to get score from breakdown
  const getBreakdownScore = (breakdown: QuantScoreBreakdown | undefined, key: string): number => {
    if (!breakdown) return 0
    return (breakdown as unknown as Record<string, number>)[key] || 0
  }

  // Helper to get pct sentinel from breakdown (-1 = N/A, -2 = DM, >= 0 = real)
  const getBreakdownPct = (breakdown: QuantScoreBreakdown | undefined, pctKey: string): number | null => {
    if (!breakdown) return null
    const val = (breakdown as unknown as Record<string, number>)[pctKey]
    return val !== undefined ? val : null
  }

  // Calculate consensus for each category
  const calculateConsensus = (key: string) => {
    let above50 = 0
    let total = 0
    const cat = SCORE_CATEGORIES.find(c => c.key === key)
    if (!cat) return { percentage: 0, icon: '\u25CF' }

    scores.forEach(s => {
      if (s.breakdown) {
        const score = getBreakdownScore(s.breakdown, key)
        if ((score / cat.max) >= 0.5) above50++
        total++
      }
    })

    const pct = total > 0 ? (above50 / total) * 100 : 0
    return {
      percentage: pct,
      icon: pct >= 75 ? '\u25B2' : pct >= 50 ? '\u25D0' : '\u25BC'
    }
  }

  // Calculate overall consensus
  const calculateOverallConsensus = () => {
    if (scores.length === 0) return { direction: 'NEUTRAL', percentage: 0 }

    let bullish = 0, bearish = 0
    scores.forEach(s => {
      if (s.direction === 'BULLISH') bullish++
      else if (s.direction === 'BEARISH') bearish++
    })

    const total = scores.length
    if (bullish > bearish) {
      return { direction: 'BULLISH', percentage: (bullish / total) * 100 }
    } else if (bearish > bullish) {
      return { direction: 'BEARISH', percentage: (bearish / total) * 100 }
    }
    return { direction: 'NEUTRAL', percentage: 50 }
  }

  const overallConsensus = calculateOverallConsensus()

  // Find recommended horizon based on score alignment
  const getRecommendedHorizon = () => {
    // Calculate average score for each horizon
    const ltfScores: number[] = [] // 1m, 5m
    const mtfScores: number[] = [] // 15m, 30m
    const htfScores: number[] = [] // 1h, 2h, 4h, 1d

    scores.forEach(s => {
      const tf = s.timeframe
      if (tf === '1m' || tf === '5m') ltfScores.push(s.quantScore || 0)
      else if (tf === '15m' || tf === '30m') mtfScores.push(s.quantScore || 0)
      else htfScores.push(s.quantScore || 0)
    })

    const avgLtf = ltfScores.length > 0 ? ltfScores.reduce((a, b) => a + b, 0) / ltfScores.length : 0
    const avgMtf = mtfScores.length > 0 ? mtfScores.reduce((a, b) => a + b, 0) / mtfScores.length : 0
    const avgHtf = htfScores.length > 0 ? htfScores.reduce((a, b) => a + b, 0) / htfScores.length : 0

    if (avgHtf >= 70 && avgHtf > avgLtf) return 'SWING'
    if (avgLtf >= 70 && avgLtf > avgHtf) return 'SCALP'
    if (avgMtf >= 60) return 'INTRADAY'
    return 'WAIT'
  }

  if (scores.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-2">QuantScore by Timeframe</h3>
        <div className="text-center text-slate-500 py-8">
          No multi-timeframe data available yet
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">QuantScore Breakdown by Timeframe</h3>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded ${
            overallConsensus.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
            overallConsensus.direction === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
            'bg-slate-700 text-slate-400'
          }`}>
            {overallConsensus.percentage.toFixed(0)}% {overallConsensus.direction}
          </span>
          <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400">
            Horizon: {getRecommendedHorizon()}
          </span>
        </div>
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="text-left py-2 px-1 text-slate-400 font-medium">Component</th>
            {TIMEFRAMES.map(tf => (
              <th key={tf} className="text-center py-2 px-1 text-slate-400 font-medium">{tf}</th>
            ))}
            <th className="text-center py-2 px-1 text-slate-400 font-medium">Consensus</th>
          </tr>
        </thead>
        <tbody>
          {SCORE_CATEGORIES.map(cat => {
            const consensus = calculateConsensus(cat.key)
            return (
              <tr key={cat.key} className="border-b border-slate-700/30">
                <td className="py-1.5 px-1 text-slate-300">{cat.label} ({cat.max})</td>
                {TIMEFRAMES.map(tf => {
                  const s = scoreMap.get(tf)
                  const score = getBreakdownScore(s?.breakdown, cat.key)
                  const pct = getBreakdownPct(s?.breakdown, cat.pctKey)
                  const isNA = pct !== null && pct === -1
                  const isDM = pct !== null && pct === -2
                  return (
                    <td key={tf} className="text-center py-1.5 px-1">
                      {isNA ? (
                        <span className="inline-block w-8 py-0.5 rounded bg-slate-700/30 text-slate-500">N/A</span>
                      ) : isDM ? (
                        <span className="inline-block w-8 py-0.5 rounded bg-amber-500/20 text-amber-400 animate-pulse">DM</span>
                      ) : (
                        <span className={`inline-block w-8 py-0.5 rounded ${getScoreColor(score, cat.max)}`}>
                          {score.toFixed(1)}
                        </span>
                      )}
                    </td>
                  )
                })}
                <td className="text-center py-1.5 px-1">
                  <span className={`${consensus.percentage >= 75 ? 'text-emerald-400' : consensus.percentage >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {consensus.icon} {consensus.percentage.toFixed(0)}%
                  </span>
                </td>
              </tr>
            )
          })}
          {/* Total row */}
          <tr className="border-t-2 border-slate-600 font-medium">
            <td className="py-2 px-1 text-white">TOTAL (100)</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const score = s?.quantScore || 0
              return (
                <td key={tf} className="text-center py-2 px-1">
                  <span className={`inline-block w-10 py-0.5 rounded font-bold ${getTotalScoreColor(score)}`}>
                    {score.toFixed(0)}
                  </span>
                </td>
              )
            })}
            <td className="text-center py-2 px-1">
              <span className={`font-bold ${
                overallConsensus.direction === 'BULLISH' ? 'text-emerald-400' :
                overallConsensus.direction === 'BEARISH' ? 'text-red-400' :
                'text-slate-400'
              }`}>
                {overallConsensus.direction === 'BULLISH' ? 'BUY' :
                 overallConsensus.direction === 'BEARISH' ? 'SELL' : 'WAIT'}
              </span>
            </td>
          </tr>
          {/* Direction row */}
          <tr className="border-t border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-400">Direction</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const dir = getDirectionIcon(s?.direction)
              return (
                <td key={tf} className="text-center py-1.5 px-1">
                  <span className={`text-sm ${dir.color}`}>{dir.icon}</span>
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1">
              <span className="text-amber-400">{overallConsensus.percentage.toFixed(0)}%</span>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Analysis footer */}
      <div className="mt-3 text-xs text-slate-400 bg-slate-700/20 rounded-lg p-2">
        <span className="text-slate-300 font-medium">Analysis: </span>
        {overallConsensus.direction === 'BULLISH' && overallConsensus.percentage >= 75 ? (
          'Strong bullish consensus across timeframes - higher conviction'
        ) : overallConsensus.direction === 'BEARISH' && overallConsensus.percentage >= 75 ? (
          'Strong bearish consensus across timeframes - higher conviction'
        ) : overallConsensus.percentage < 60 ? (
          'Timeframe divergence detected - lower conviction, wait for alignment'
        ) : (
          'Moderate consensus - consider using aligned timeframes for entry'
        )}
      </div>
    </div>
  )
}

export default MTFScoreHeatmap
