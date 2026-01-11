import type { QuantScore } from '../../types'
import { TIMEFRAMES } from '../../hooks/useTimeframeScores'

interface MTFOptionsFlowPanelProps {
  scores: QuantScore[]
}

const formatNumber = (n: number | undefined, decimals = 2): string => {
  if (n === undefined || n === null || isNaN(n)) return '-'
  return n.toFixed(decimals)
}

export function MTFOptionsFlowPanel({ scores }: MTFOptionsFlowPanelProps) {
  // Create map for quick lookup
  const scoreMap = new Map<string, QuantScore>()
  scores.forEach(s => {
    if (s.timeframe) scoreMap.set(s.timeframe, s)
  })

  const getPcrColor = (pcr: number | undefined) => {
    if (!pcr) return 'text-slate-400'
    if (pcr > 1.3) return 'text-red-400'  // Extreme fear/bearish
    if (pcr > 1.0) return 'text-red-400/80'
    if (pcr < 0.7) return 'text-emerald-400'  // Extreme greed/bullish
    if (pcr < 1.0) return 'text-emerald-400/80'
    return 'text-slate-400'
  }

  const getPcrChangeColor = (change: number | undefined) => {
    if (!change) return 'text-slate-400'
    if (change > 0.05) return 'text-red-400'  // PCR rising = bearish
    if (change < -0.05) return 'text-emerald-400'  // PCR falling = bullish
    return 'text-slate-400'
  }

  const getOiSignalColor = (signal: string | undefined) => {
    if (!signal) return 'text-slate-400'
    if (signal.includes('CALL') || signal.includes('LONG_BUILD')) return 'text-emerald-400'
    if (signal.includes('PUT') || signal.includes('SHORT_BUILD')) return 'text-red-400'
    if (signal.includes('UNWINDING')) return 'text-amber-400'
    return 'text-slate-400'
  }

  const getFuturesColor = (buildup: string | undefined) => {
    if (!buildup) return 'text-slate-400'
    if (buildup === 'LONG_BUILDUP') return 'text-emerald-400'
    if (buildup === 'SHORT_BUILDUP') return 'text-red-400'
    if (buildup === 'LONG_UNWINDING') return 'text-amber-400'
    if (buildup === 'SHORT_COVERING') return 'text-blue-400'
    return 'text-slate-400'
  }

  const getPremiumColor = (premium: number | undefined) => {
    if (!premium) return 'text-slate-400'
    if (premium > 0.5) return 'text-emerald-400'  // Futures trading at premium
    if (premium < -0.5) return 'text-red-400'
    return 'text-slate-400'
  }

  // Calculate PCR trend
  const pcrValues = TIMEFRAMES.map(tf => scoreMap.get(tf)?.optionsFlowSummary?.pcr)
  const calculatePcrTrend = (): { direction: 'RISING' | 'FALLING' | 'STABLE', interpretation: string } => {
    const validPcrs = pcrValues.filter(v => v !== undefined) as number[]
    if (validPcrs.length < 2) return { direction: 'STABLE', interpretation: 'Insufficient data' }

    const firstHalf = validPcrs.slice(0, Math.floor(validPcrs.length / 2))
    const secondHalf = validPcrs.slice(Math.floor(validPcrs.length / 2))

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length

    const diff = avgSecond - avgFirst
    if (diff > 0.1) return { direction: 'RISING', interpretation: 'Bearish - Put buying increasing' }
    if (diff < -0.1) return { direction: 'FALLING', interpretation: 'Bullish - Call buying increasing' }
    return { direction: 'STABLE', interpretation: 'Neutral - PCR stable across timeframes' }
  }

  const pcrTrend = calculatePcrTrend()

  // Check for divergence between options and futures
  const checkDivergence = (): string | null => {
    let bullishOptions = 0, bearishOptions = 0
    let bullishFutures = 0, bearishFutures = 0

    scores.forEach(s => {
      const pcr = s.optionsFlowSummary?.pcr
      const futures = s.optionsFlowSummary?.futuresBuildup

      if (pcr && pcr < 0.9) bullishOptions++
      if (pcr && pcr > 1.1) bearishOptions++
      if (futures === 'LONG_BUILDUP') bullishFutures++
      if (futures === 'SHORT_BUILDUP') bearishFutures++
    })

    if (bullishOptions > bearishOptions && bearishFutures > bullishFutures) {
      return 'Divergence: Options bullish but Futures bearish'
    }
    if (bearishOptions > bullishOptions && bullishFutures > bearishFutures) {
      return 'Divergence: Options bearish but Futures bullish'
    }
    return null
  }

  const divergence = checkDivergence()

  if (scores.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-2">Options Flow Evolution</h3>
        <div className="text-center text-slate-500 py-6">
          No options flow data available
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Options Flow Evolution</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded ${
          pcrTrend.direction === 'FALLING' ? 'bg-emerald-500/20 text-emerald-400' :
          pcrTrend.direction === 'RISING' ? 'bg-red-500/20 text-red-400' :
          'bg-slate-700 text-slate-400'
        }`}>
          PCR {pcrTrend.direction}
        </span>
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="text-left py-2 px-1 text-slate-400 font-medium">Metric</th>
            {TIMEFRAMES.map(tf => (
              <th key={tf} className="text-center py-2 px-1 text-slate-400 font-medium">{tf}</th>
            ))}
            <th className="text-center py-2 px-1 text-slate-400 font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {/* PCR */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">PCR</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const pcr = s?.optionsFlowSummary?.pcr
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getPcrColor(pcr)}`}>
                  {formatNumber(pcr)}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1">
              <span className={pcrTrend.direction === 'FALLING' ? 'text-emerald-400' :
                             pcrTrend.direction === 'RISING' ? 'text-red-400' : 'text-slate-400'}>
                {pcrTrend.direction === 'FALLING' ? '\u2198' :
                 pcrTrend.direction === 'RISING' ? '\u2197' : '\u2192'}
              </span>
            </td>
          </tr>
          {/* PCR Change */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">PCR \u0394</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const change = s?.optionsFlowSummary?.pcrChange
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getPcrChangeColor(change)}`}>
                  {change !== undefined ? (change > 0 ? '+' : '') + formatNumber(change) : '-'}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
          {/* OI Signal */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">OI Signal</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const signal = s?.optionsFlowSummary?.oiBuildupType
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getOiSignalColor(signal)}`}>
                  {signal ? signal.replace(/_/g, ' ').slice(0, 8) : '-'}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
          {/* Futures Buildup */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">Futures</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const futures = s?.optionsFlowSummary?.futuresBuildup
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getFuturesColor(futures)}`}>
                  {futures ? futures.replace(/_/g, ' ').slice(0, 8) : '-'}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
          {/* Spot-Future Premium */}
          <tr>
            <td className="py-1.5 px-1 text-slate-300">Premium</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const premium = s?.optionsFlowSummary?.spotFuturePremium
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getPremiumColor(premium)}`}>
                  {premium !== undefined ? (premium > 0 ? '+' : '') + formatNumber(premium) + '%' : '-'}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
        </tbody>
      </table>

      {/* Trend and Divergence Summary */}
      <div className="mt-3 space-y-2">
        <div className="text-xs text-slate-400 bg-slate-700/20 rounded-lg p-2">
          <span className="text-slate-300 font-medium">Trend: </span>
          <span className={
            pcrTrend.direction === 'FALLING' ? 'text-emerald-400' :
            pcrTrend.direction === 'RISING' ? 'text-red-400' : ''
          }>
            {pcrTrend.interpretation}
          </span>
        </div>
        {divergence && (
          <div className="text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 flex items-center gap-2">
            <span className="text-amber-400">\u26A0\uFE0F</span>
            <span className="text-amber-400">{divergence}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default MTFOptionsFlowPanel
