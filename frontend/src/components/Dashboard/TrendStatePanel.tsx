interface ACLData {
  aclState: 'EARLY_TREND' | 'MID_TREND' | 'LATE_TREND' | 'EXHAUSTION' | 'TRANSITION' | 'UNKNOWN'
  exhaustionNear: boolean
  trendDirection: number
  aclMultiplier: number
  agreementScore: number
  trendAge30m: number
  trendAge2H: number
  trendAge4H: number
  trendAge1D: number
  flow30m?: number
  flow2H?: number
  flow4H?: number
  flow1D?: number
}

interface FUDKIIData {
  scripCode: string
  companyName: string
  ignitionFlag: boolean
  direction: 'BULLISH_IGNITION' | 'BEARISH_IGNITION' | 'NO_IGNITION'
  fudkiiStrength: number
  simultaneityScore: number
  priceBreaking: boolean
  volumeSurging: boolean
  momentumPositive: boolean
  atrExpanding: boolean
  flowConfirming: boolean
}

interface TrendStatePanelProps {
  acl?: ACLData
  activeIgnitions?: FUDKIIData[]
  indexName?: string
}

export default function TrendStatePanel({ acl, activeIgnitions = [], indexName = 'NIFTY50' }: TrendStatePanelProps) {
  const getStateStyle = (state: string) => {
    switch (state) {
      case 'EARLY_TREND':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      case 'MID_TREND':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      case 'LATE_TREND':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      case 'EXHAUSTION':
        return 'bg-red-500/20 text-red-400 border-red-500/30'
      case 'TRANSITION':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30'
    }
  }

  const getFlowIcon = (flow: number | undefined) => {
    if (flow === undefined) return '➖'
    if (flow > 0) return '🟢'
    if (flow < 0) return '🔴'
    return '⚪'
  }

  const getTrendBar = (age: number, max: number = 20) => {
    const pct = Math.min((age / max) * 100, 100)
    const color = pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500'
    return (
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <span>📊 Trend State & Ignitions</span>
        {acl?.exhaustionNear && (
          <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded animate-pulse">
            ⚠️ Exhaustion Near
          </span>
        )}
      </div>

      {/* ACL State */}
      {acl && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">{indexName} Cycle</span>
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStateStyle(acl.aclState)}`}>
              {acl.aclState.replace('_', ' ')}
            </span>
          </div>

          {/* Trend Age Bars */}
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">30m ({acl.trendAge30m} bars)</span>
                <span>{getFlowIcon(acl.flow30m)}</span>
              </div>
              {getTrendBar(acl.trendAge30m)}
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">2H ({acl.trendAge2H} bars)</span>
                <span>{getFlowIcon(acl.flow2H)}</span>
              </div>
              {getTrendBar(acl.trendAge2H)}
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">4H ({acl.trendAge4H} bars)</span>
                <span>{getFlowIcon(acl.flow4H)}</span>
              </div>
              {getTrendBar(acl.trendAge4H)}
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">1D ({acl.trendAge1D} bars)</span>
                <span>{getFlowIcon(acl.flow1D)}</span>
              </div>
              {getTrendBar(acl.trendAge1D)}
            </div>
          </div>

          {/* Agreement & Multiplier */}
          <div className="flex items-center justify-between mt-3 text-xs">
            <span className="text-slate-400">
              TF Agreement: <span className={acl.agreementScore >= 3 ? 'text-emerald-400' : 'text-slate-300'}>{acl.agreementScore}/4</span>
            </span>
            <span className="text-slate-400">
              Multiplier: <span className={acl.aclMultiplier >= 1 ? 'text-emerald-400' : 'text-amber-400'}>{acl.aclMultiplier.toFixed(2)}x</span>
            </span>
          </div>
        </div>
      )}

      {/* Active Ignitions */}
      {activeIgnitions.length > 0 && (
        <div className="border-t border-slate-700/50 pt-3 mt-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-slate-400">🔥 Active Ignitions</span>
            <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded">
              {activeIgnitions.length}
            </span>
          </div>

          <div className="space-y-2">
            {activeIgnitions.slice(0, 5).map((ignition) => (
              <div
                key={ignition.scripCode}
                className={`p-2 rounded-lg border ${
                  ignition.direction === 'BULLISH_IGNITION'
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {ignition.direction === 'BULLISH_IGNITION' ? '🚀' : '💥'}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-white">{ignition.companyName}</div>
                      <div className="text-xs text-slate-400">
                        Strength: {(ignition.fudkiiStrength * 100).toFixed(0)}% | Conditions: {ignition.simultaneityScore}/5
                      </div>
                    </div>
                  </div>
                </div>

                {/* Condition indicators */}
                <div className="flex gap-1 mt-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${ignition.priceBreaking ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                    Price
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${ignition.volumeSurging ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                    Vol
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${ignition.momentumPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                    Mom
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${ignition.atrExpanding ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                    ATR
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${ignition.flowConfirming ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                    Flow
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!acl && activeIgnitions.length === 0 && (
        <div className="py-6 text-center text-slate-500">
          <p className="text-sm">Waiting for trend data...</p>
        </div>
      )}
    </div>
  )
}
