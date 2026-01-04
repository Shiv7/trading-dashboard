import type { Regime } from '../../types'

interface RegimePanelProps {
  regime: Regime | null
}

export default function RegimePanel({ regime }: RegimePanelProps) {
  if (!regime) {
    return (
      <div className="card animate-pulse">
        <div className="card-header">
          <span>🌍 Market Regime</span>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="text-slate-500">Waiting for regime data...</div>
        </div>
      </div>
    )
  }

  const getRegimeColor = (label: string) => {
    if (label.includes('STRONG_BULLISH')) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    if (label.includes('BULLISH')) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    if (label.includes('STRONG_BEARISH')) return 'text-red-400 bg-red-500/10 border-red-500/30'
    if (label.includes('BEARISH')) return 'text-red-400 bg-red-500/10 border-red-500/20'
    if (label.includes('CHOPPY')) return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    return 'text-slate-400 bg-slate-500/10 border-slate-500/20'
  }

  const getStrengthBar = (strength: number) => {
    const pct = Math.abs(strength) * 100
    const isPositive = strength >= 0
    return (
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  }

  const getVolatilityIcon = (state: string) => {
    switch (state) {
      case 'HIGH': return '🔥'
      case 'LOW': return '😴'
      case 'EXPANDING': return '📈'
      case 'CONTRACTING': return '📉'
      default: return '➖'
    }
  }

  const timeframes = [
    { label: '1D', tf: regime.tf1DLabel, strength: regime.tf1DStrength },
    { label: '2H', tf: regime.tf2HLabel, strength: regime.tf2HStrength },
    { label: '30m', tf: regime.tf30mLabel, strength: regime.tf30mStrength },
  ]

  return (
    <div className="card">
      <div className="card-header">
        <span>🌍 Market Regime</span>
        <span className="text-xs text-slate-500">
          {new Date(regime.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Main Regime Display */}
      <div className={`p-4 rounded-lg border mb-4 text-center ${getRegimeColor(regime.label)}`}>
        <div className="text-2xl font-bold mb-1">
          {regime.label.replace(/_/g, ' ')}
        </div>
        <div className="text-sm opacity-75">
          {regime.indexName}
        </div>
      </div>

      {/* Strength & Coherence */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-slate-700/30 p-3 rounded-lg">
          <div className="text-xs text-slate-400 mb-2">Strength</div>
          {getStrengthBar(regime.regimeStrength)}
          <div className="text-right text-xs mt-1 text-slate-300">
            {(regime.regimeStrength * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-slate-700/30 p-3 rounded-lg">
          <div className="text-xs text-slate-400 mb-2">Coherence</div>
          {getStrengthBar(regime.regimeCoherence)}
          <div className="text-right text-xs mt-1 text-slate-300">
            {(regime.regimeCoherence * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Multi-Timeframe Breakdown */}
      <div className="mb-4">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">
          Timeframe Alignment
        </div>
        <div className="grid grid-cols-3 gap-2">
          {timeframes.map((tf) => (
            <div
              key={tf.label}
              className={`p-2 rounded-lg border text-center ${getRegimeColor(tf.tf)}`}
            >
              <div className="text-xs text-slate-400 mb-1">{tf.label}</div>
              <div className="text-sm font-medium">
                {tf.tf.replace(/_/g, ' ').substring(0, 8)}
              </div>
              <div className="text-xs opacity-75 mt-1">
                {(tf.strength * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Flow Agreement & Volatility */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Flow Agreement:</span>
          <span className={`font-medium ${regime.flowAgreement >= 2 ? 'text-emerald-400' : regime.flowAgreement <= -2 ? 'text-red-400' : 'text-slate-300'}`}>
            {regime.flowAgreement}/3
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Volatility:</span>
          <span className="flex items-center gap-1">
            {getVolatilityIcon(regime.volatilityState)}
            <span className="text-slate-300">{regime.volatilityState}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
