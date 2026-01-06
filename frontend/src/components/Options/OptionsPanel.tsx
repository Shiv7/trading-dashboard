import type { QuantScore } from '../../types'

interface OptionsPanelProps {
  quantScore: QuantScore | null
}

export default function OptionsPanel({ quantScore }: OptionsPanelProps) {
  if (!quantScore) {
    return (
      <div className="card">
        <div className="card-header">Options Analytics</div>
        <div className="flex items-center justify-center h-32 text-slate-500">
          Loading options data...
        </div>
      </div>
    )
  }

  const { greeksSummary, ivSummary, optionsFlowSummary, breakdown } = quantScore

  // Greeks data
  const hasGreeks = greeksSummary && (
    greeksSummary.totalDelta !== undefined ||
    greeksSummary.totalGamma !== undefined
  )

  // IV data
  const hasIV = ivSummary && ivSummary.atmIV !== undefined

  // Options flow data
  const hasFlow = optionsFlowSummary && optionsFlowSummary.pcr !== undefined

  if (!hasGreeks && !hasIV && !hasFlow) {
    return (
      <div className="card">
        <div className="card-header">Options Analytics</div>
        <div className="flex items-center justify-center h-32 text-slate-500">
          <div className="text-center">
            <span className="text-2xl mb-2 block">📊</span>
            <span>No options data available for this stock</span>
          </div>
        </div>
      </div>
    )
  }

  const getDirectionColor = (direction: string | undefined) => {
    if (!direction) return 'text-slate-400'
    if (direction.includes('BULL') || direction.includes('LONG')) return 'text-emerald-400'
    if (direction.includes('BEAR') || direction.includes('SHORT')) return 'text-red-400'
    return 'text-slate-400'
  }

  const getPCRSignalColor = (signal: string | undefined) => {
    if (!signal) return 'text-slate-400 bg-slate-700/50'
    switch (signal) {
      case 'EXTREME_GREED':
      case 'BULLISH':
        return 'text-emerald-400 bg-emerald-500/20'
      case 'EXTREME_FEAR':
      case 'BEARISH':
        return 'text-red-400 bg-red-500/20'
      default:
        return 'text-amber-400 bg-amber-500/20'
    }
  }

  const formatNumber = (n: number | undefined, decimals = 2) => {
    if (n === undefined || n === null || isNaN(n)) return '-'
    return n.toFixed(decimals)
  }

  const formatPercent = (n: number | undefined) => {
    if (n === undefined || n === null || isNaN(n)) return '-'
    return `${(n * 100).toFixed(1)}%`
  }

  return (
    <div className="space-y-4">
      {/* Score Breakdown */}
      {breakdown && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Score Breakdown</span>
            <span className="text-xs text-slate-400">
              Raw: {formatNumber(breakdown.rawScore)} |
              Regime: {formatNumber(breakdown.regimeModifier, 2)}x
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Greeks', value: breakdown.greeksScore, max: 15, pct: breakdown.greeksPct },
              { label: 'IV Surface', value: breakdown.ivSurfaceScore, max: 12, pct: breakdown.ivSurfacePct },
              { label: 'Microstructure', value: breakdown.microstructureScore, max: 18, pct: breakdown.microstructurePct },
              { label: 'Options Flow', value: breakdown.optionsFlowScore, max: 15, pct: breakdown.optionsFlowPct },
              { label: 'Price Action', value: breakdown.priceActionScore, max: 12, pct: breakdown.priceActionPct },
              { label: 'Volume Profile', value: breakdown.volumeProfileScore, max: 8, pct: breakdown.volumeProfilePct },
              { label: 'Cross-Instrument', value: breakdown.crossInstrumentScore, max: 10, pct: breakdown.crossInstrumentPct },
              { label: 'Confluence', value: breakdown.confluenceScore, max: 10, pct: breakdown.confluencePct },
            ].map((item) => (
              <div key={item.label} className="bg-slate-700/30 rounded-lg p-3">
                <div className="text-xs text-slate-400 mb-1">{item.label}</div>
                <div className="flex items-end gap-1">
                  <span className="text-lg font-bold text-white">
                    {formatNumber(item.value, 1)}
                  </span>
                  <span className="text-xs text-slate-500">/{item.max}</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      (item.pct || 0) >= 70 ? 'bg-emerald-500' :
                      (item.pct || 0) >= 50 ? 'bg-amber-500' : 'bg-slate-500'
                    }`}
                    style={{ width: `${item.pct || 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Greeks Summary */}
      {hasGreeks && greeksSummary && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Greeks Exposure</span>
            <span className={`text-xs px-2 py-0.5 rounded ${getDirectionColor(greeksSummary.deltaBias)}`}>
              {greeksSummary.deltaBias || 'NEUTRAL'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Total Delta</div>
              <div className={`text-xl font-bold ${
                (greeksSummary.totalDelta || 0) > 0 ? 'text-emerald-400' :
                (greeksSummary.totalDelta || 0) < 0 ? 'text-red-400' : 'text-slate-400'
              }`}>
                {formatNumber(greeksSummary.totalDelta)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Total Gamma</div>
              <div className="text-xl font-bold text-purple-400">
                {formatNumber(greeksSummary.totalGamma, 4)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Total Vega</div>
              <div className="text-xl font-bold text-blue-400">
                {formatNumber(greeksSummary.totalVega)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Total Theta</div>
              <div className="text-xl font-bold text-amber-400">
                {formatNumber(greeksSummary.totalTheta)}
              </div>
            </div>
          </div>

          {/* Gamma Squeeze Risk */}
          {greeksSummary.gammaSqueezeRisk && (
            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-red-400 text-lg">⚠️</span>
                <div>
                  <div className="text-sm font-medium text-red-400">Gamma Squeeze Risk</div>
                  <div className="text-xs text-slate-400">
                    Max Gamma Strike: {formatNumber(greeksSummary.maxGammaStrike)} |
                    Distance: {formatNumber(greeksSummary.gammaSqueezeDistance)}%
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* IV Surface Summary */}
      {hasIV && ivSummary && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>IV Surface</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded ${
                ivSummary.ivSignal === 'HIGH' ? 'bg-red-500/20 text-red-400' :
                ivSummary.ivSignal === 'LOW' ? 'bg-emerald-500/20 text-emerald-400' :
                'bg-amber-500/20 text-amber-400'
              }`}>
                {ivSummary.ivSignal || 'MODERATE'}
              </span>
              {ivSummary.ivCrushRisk && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                  IV Crush Risk
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">ATM IV</div>
              <div className="text-xl font-bold text-white">
                {formatPercent(ivSummary.atmIV / 100)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">IV Rank</div>
              <div className={`text-xl font-bold ${
                (ivSummary.ivRank || 0) > 0.7 ? 'text-red-400' :
                (ivSummary.ivRank || 0) < 0.3 ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {formatPercent(ivSummary.ivRank)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">25-Delta Skew</div>
              <div className="text-xl font-bold text-white">
                {formatNumber(ivSummary.skew25Delta)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">IV Velocity</div>
              <div className={`text-xl font-bold ${
                (ivSummary.ivVelocity || 0) > 0 ? 'text-red-400' :
                (ivSummary.ivVelocity || 0) < 0 ? 'text-emerald-400' : 'text-slate-400'
              }`}>
                {ivSummary.ivVelocity > 0 ? '+' : ''}{formatNumber(ivSummary.ivVelocity)}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-700/20 rounded-lg p-2 flex items-center justify-between">
              <span className="text-slate-400">Smile Shape</span>
              <span className="text-white font-medium">{ivSummary.smileShape || '-'}</span>
            </div>
            <div className="bg-slate-700/20 rounded-lg p-2 flex items-center justify-between">
              <span className="text-slate-400">Term Structure</span>
              <span className="text-white font-medium">{ivSummary.termStructure || '-'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Options Flow Summary */}
      {hasFlow && optionsFlowSummary && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Options Flow</span>
            <span className={`text-xs px-2 py-0.5 rounded ${getPCRSignalColor(optionsFlowSummary.pcrSignal)}`}>
              {optionsFlowSummary.pcrSignal || 'NEUTRAL'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Put/Call Ratio</div>
              <div className={`text-xl font-bold ${
                (optionsFlowSummary.pcr || 0) > 1.2 ? 'text-red-400' :
                (optionsFlowSummary.pcr || 0) < 0.8 ? 'text-emerald-400' : 'text-white'
              }`}>
                {formatNumber(optionsFlowSummary.pcr)}
              </div>
              <div className={`text-xs ${
                (optionsFlowSummary.pcrChange || 0) > 0 ? 'text-red-400' :
                (optionsFlowSummary.pcrChange || 0) < 0 ? 'text-emerald-400' : 'text-slate-400'
              }`}>
                {optionsFlowSummary.pcrChange > 0 ? '+' : ''}{formatNumber(optionsFlowSummary.pcrChange)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">OI Buildup</div>
              <div className={`text-lg font-bold ${getDirectionColor(optionsFlowSummary.oiBuildupType)}`}>
                {optionsFlowSummary.oiBuildupType?.replace(/_/g, ' ') || '-'}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Futures</div>
              <div className={`text-lg font-bold ${getDirectionColor(optionsFlowSummary.futuresBuildup)}`}>
                {optionsFlowSummary.futuresBuildup?.replace(/_/g, ' ') || '-'}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Spot-Fut Premium</div>
              <div className={`text-xl font-bold ${
                (optionsFlowSummary.spotFuturePremium || 0) > 0.5 ? 'text-emerald-400' :
                (optionsFlowSummary.spotFuturePremium || 0) < -0.5 ? 'text-red-400' : 'text-white'
              }`}>
                {formatNumber(optionsFlowSummary.spotFuturePremium)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
