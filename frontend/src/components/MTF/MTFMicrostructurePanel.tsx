import type { QuantScore } from '../../types'
import { TIMEFRAMES } from '../../hooks/useTimeframeScores'

interface MTFMicrostructurePanelProps {
  scores: QuantScore[]
}

const formatNumber = (n: number | undefined, decimals = 2): string => {
  if (n === undefined || n === null || isNaN(n)) return '-'
  if (Math.abs(n) >= 1000) {
    return `${(n / 1000).toFixed(1)}K`
  }
  return n.toFixed(decimals)
}

const formatPercent = (n: number | undefined): string => {
  if (n === undefined || n === null || isNaN(n)) return '-'
  return `${(n * 100).toFixed(0)}%`
}

export function MTFMicrostructurePanel({ scores }: MTFMicrostructurePanelProps) {
  // Create map for quick lookup
  const scoreMap = new Map<string, QuantScore>()
  scores.forEach(s => {
    if (s.timeframe) scoreMap.set(s.timeframe, s)
  })

  const getOfiColor = (ofi: number | undefined) => {
    if (!ofi) return 'text-slate-400'
    if (ofi > 5000) return 'text-emerald-400'
    if (ofi > 0) return 'text-emerald-500/80'
    if (ofi < -5000) return 'text-red-400'
    if (ofi < 0) return 'text-red-500/80'
    return 'text-slate-400'
  }

  const getVpinColor = (vpin: number | undefined) => {
    if (!vpin) return 'text-slate-400'
    if (vpin >= 0.7) return 'text-red-400'  // High toxic flow
    if (vpin >= 0.5) return 'text-amber-400'
    return 'text-emerald-400'
  }

  const getPressureColor = (pressure: number | undefined) => {
    if (!pressure) return 'text-slate-400'
    if (pressure >= 0.6) return 'text-emerald-400'
    if (pressure >= 0.4) return 'text-slate-400'
    return 'text-red-400'
  }

  const getDepthColor = (depth: number | undefined) => {
    if (!depth) return 'text-slate-400'
    if (depth > 0.1) return 'text-emerald-400'
    if (depth < -0.1) return 'text-red-400'
    return 'text-slate-400'
  }

  // Calculate trends across timeframes
  const calculateTrend = (values: (number | undefined)[]): 'UP' | 'DOWN' | 'FLAT' => {
    const validValues = values.filter(v => v !== undefined && !isNaN(v!)) as number[]
    if (validValues.length < 2) return 'FLAT'

    // Compare first half average to second half average
    const midPoint = Math.floor(validValues.length / 2)
    const firstHalf = validValues.slice(0, midPoint).reduce((a, b) => a + b, 0) / midPoint
    const secondHalf = validValues.slice(midPoint).reduce((a, b) => a + b, 0) / (validValues.length - midPoint)

    const diff = secondHalf - firstHalf
    if (Math.abs(diff) < 0.05 * Math.abs(firstHalf || 1)) return 'FLAT'
    return diff > 0 ? 'UP' : 'DOWN'
  }

  const ofiValues = TIMEFRAMES.map(tf => scoreMap.get(tf)?.microstructureSummary?.avgOFI)
  const vpinValues = TIMEFRAMES.map(tf => scoreMap.get(tf)?.microstructureSummary?.avgVPIN)
  const buyPressureValues = TIMEFRAMES.map(tf => scoreMap.get(tf)?.microstructureSummary?.aggressiveBuyRatio)

  const ofiTrend = calculateTrend(ofiValues)
  const vpinTrend = calculateTrend(vpinValues)
  const pressureTrend = calculateTrend(buyPressureValues)

  const getTrendIcon = (trend: 'UP' | 'DOWN' | 'FLAT') => {
    switch (trend) {
      case 'UP': return { icon: '\u2197', color: 'text-emerald-400' }
      case 'DOWN': return { icon: '\u2198', color: 'text-red-400' }
      default: return { icon: '\u2192', color: 'text-slate-400' }
    }
  }

  if (scores.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-2">Microstructure Across Timeframes</h3>
        <div className="text-center text-slate-500 py-6">
          No microstructure data available
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Microstructure Across Timeframes</h3>
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`${getTrendIcon(ofiTrend).color}`}>
            OFI {getTrendIcon(ofiTrend).icon}
          </span>
          <span className={`${getTrendIcon(vpinTrend).color}`}>
            VPIN {getTrendIcon(vpinTrend).icon}
          </span>
        </div>
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
          {/* OFI */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">OFI</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const ofi = s?.microstructureSummary?.avgOFI
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getOfiColor(ofi)}`}>
                  {ofi !== undefined ? (ofi > 0 ? '+' : '') + formatNumber(ofi, 0) : '-'}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1">
              <span className={getTrendIcon(ofiTrend).color}>{getTrendIcon(ofiTrend).icon}</span>
            </td>
          </tr>
          {/* VPIN */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">VPIN</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const vpin = s?.microstructureSummary?.avgVPIN
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getVpinColor(vpin)}`}>
                  {formatPercent(vpin)}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1">
              <span className={getTrendIcon(vpinTrend).color}>{getTrendIcon(vpinTrend).icon}</span>
            </td>
          </tr>
          {/* Kyle Lambda */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">Kyle \u03BB</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const lambda = s?.microstructureSummary?.avgKyleLambda
              return (
                <td key={tf} className="text-center py-1.5 px-1 text-purple-400">
                  {formatNumber(lambda, 4)}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
          {/* Depth Imbalance */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">Depth Imb</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const depth = s?.microstructureSummary?.avgDepthImbalance
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getDepthColor(depth)}`}>
                  {depth !== undefined ? (depth > 0 ? '+' : '') + formatPercent(depth) : '-'}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
          {/* Spread */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">Spread</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const spread = s?.microstructureSummary?.avgSpread
              return (
                <td key={tf} className="text-center py-1.5 px-1 text-blue-400">
                  {spread !== undefined && spread > 0 ? `\u20B9${formatNumber(spread)}` : '-'}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
          {/* Buy Pressure */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">Buy Press</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const buy = s?.microstructureSummary?.aggressiveBuyRatio
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getPressureColor(buy)}`}>
                  {formatPercent(buy)}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1">
              <span className={getTrendIcon(pressureTrend).color}>{getTrendIcon(pressureTrend).icon}</span>
            </td>
          </tr>
          {/* Sell Pressure */}
          <tr className="border-b border-slate-700/30">
            <td className="py-1.5 px-1 text-slate-300">Sell Press</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const sell = s?.microstructureSummary?.aggressiveSellRatio
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${getPressureColor(sell ? 1 - sell : undefined)}`}>
                  {formatPercent(sell)}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
          {/* Flow Direction */}
          <tr>
            <td className="py-1.5 px-1 text-slate-300">Flow Dir</td>
            {TIMEFRAMES.map(tf => {
              const s = scoreMap.get(tf)
              const dir = s?.microstructureSummary?.flowDirection
              const color = dir === 'BUYING' ? 'text-emerald-400' :
                           dir === 'SELLING' ? 'text-red-400' : 'text-slate-400'
              return (
                <td key={tf} className={`text-center py-1.5 px-1 ${color}`}>
                  {dir ? dir.slice(0, 4) : '-'}
                </td>
              )
            })}
            <td className="text-center py-1.5 px-1 text-slate-500">-</td>
          </tr>
        </tbody>
      </table>

      {/* Trend Summary */}
      <div className="mt-3 text-xs text-slate-400 bg-slate-700/20 rounded-lg p-2">
        <span className="text-slate-300 font-medium">Trend: </span>
        {ofiTrend === 'UP' && pressureTrend === 'UP' ? (
          <span className="text-emerald-400">OFI and buy pressure building across timeframes - institutional accumulation</span>
        ) : ofiTrend === 'DOWN' && pressureTrend === 'DOWN' ? (
          <span className="text-red-400">OFI and buy pressure declining - institutional distribution</span>
        ) : vpinTrend === 'UP' ? (
          <span className="text-amber-400">VPIN rising - increasing informed trading activity</span>
        ) : (
          <span>Mixed signals across timeframes - monitor for clarity</span>
        )}
      </div>
    </div>
  )
}

export default MTFMicrostructurePanel
