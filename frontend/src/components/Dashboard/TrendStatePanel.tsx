import type { ACLData, FUDKIIData } from '../../types'

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

      {/* FUDKII Signals - SuperTrend + BB Breakout */}
      {activeIgnitions.length > 0 && (
        <div className="border-t border-slate-700/50 pt-3 mt-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-slate-400">🔥 FUDKII Signals (ST + BB)</span>
            <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded">
              {activeIgnitions.length}
            </span>
          </div>

          <div className="space-y-2">
            {activeIgnitions.slice(0, 5).map((signal) => (
              <div
                key={signal.scripCode}
                className={`p-3 rounded-lg border ${
                  signal.direction === 'BULLISH'
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {signal.direction === 'BULLISH' ? '🚀' : '💥'}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-white">
                        {signal.symbol || signal.companyName || signal.scripCode}
                      </div>
                      <div className="text-xs text-slate-400">
                        {signal.exchange && <span className="mr-1">[{signal.exchange}]</span>}
                        @ {signal.triggerPrice?.toFixed(2)} | Score: {signal.triggerScore?.toFixed(0)}
                      </div>
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded ${
                    signal.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {signal.direction}
                  </span>
                </div>

                {/* SuperTrend + BB indicator */}
                <div className="flex gap-1 mb-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    signal.trendChanged ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-500'
                  }`}>
                    ST Flip
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    signal.trend === 'UP' ? 'bg-emerald-500/20 text-emerald-400' :
                    signal.trend === 'DOWN' ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-500'
                  }`}>
                    ST {signal.trend}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    signal.pricePosition === 'ABOVE_UPPER' ? 'bg-emerald-500/20 text-emerald-400' :
                    signal.pricePosition === 'BELOW_LOWER' ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-500'
                  }`}>
                    BB {signal.pricePosition?.replace('_', ' ')}
                  </span>
                </div>

                {/* BB Levels */}
                <div className="text-xs text-slate-500 space-y-0.5">
                  <div className="flex justify-between">
                    <span>BB Upper:</span>
                    <span className="text-slate-400">{signal.bbUpper?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SuperTrend:</span>
                    <span className={signal.trend === 'UP' ? 'text-emerald-400' : 'text-red-400'}>
                      {signal.superTrend?.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>BB Lower:</span>
                    <span className="text-slate-400">{signal.bbLower?.toFixed(2)}</span>
                  </div>
                </div>

                {/* Reason */}
                {signal.reason && (
                  <div className="mt-2 text-xs text-slate-500 truncate" title={signal.reason}>
                    {signal.reason}
                  </div>
                )}
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
