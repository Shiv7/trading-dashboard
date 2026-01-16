import React from 'react'

interface SessionContextPanelProps {
    sessionPosition?: number
    sessionPositionDesc?: string
    vBottomDetected?: boolean
    vTopDetected?: boolean
    failedBreakoutCount?: number
    failedBreakdownCount?: number
    currentSession?: string
    direction?: string
    className?: string
}

export const SessionContextPanel: React.FC<SessionContextPanelProps> = ({
    sessionPosition,
    sessionPositionDesc,
    vBottomDetected,
    vTopDetected,
    failedBreakoutCount,
    failedBreakdownCount,
    currentSession,
    direction,
    className = ''
}) => {
    const getPositionColor = (pos: number | undefined) => {
        if (pos === undefined) return 'bg-slate-600'
        if (pos <= 10) return 'bg-emerald-500' // At support
        if (pos <= 30) return 'bg-emerald-400'
        if (pos >= 90) return 'bg-red-500'     // At resistance
        if (pos >= 70) return 'bg-red-400'
        return 'bg-blue-400'                    // Mid-range
    }

    const getPositionText = (pos: number | undefined) => {
        if (pos === undefined) return 'Unknown'
        if (pos <= 10) return 'AT SESSION LOW'
        if (pos <= 30) return 'NEAR SUPPORT'
        if (pos >= 90) return 'AT SESSION HIGH'
        if (pos >= 70) return 'NEAR RESISTANCE'
        return 'MID-RANGE'
    }

    const getPositionEmoji = (pos: number | undefined) => {
        if (pos === undefined) return '❓'
        if (pos <= 20) return '⬇️'
        if (pos >= 80) return '⬆️'
        return '↔️'
    }

    // Context interpretation
    const getContextInterpretation = () => {
        if (sessionPosition === undefined) return null

        const isLong = direction === 'LONG' || direction === 'BULLISH'
        const isShort = direction === 'SHORT' || direction === 'BEARISH'

        if (vBottomDetected && isLong) {
            return { color: 'text-emerald-400', text: '✅ V-Bottom Reversal - Optimal Long Entry', icon: '🔄' }
        }
        if (vTopDetected && isShort) {
            return { color: 'text-red-400', text: '✅ V-Top Distribution - Optimal Short Entry', icon: '🔄' }
        }
        if (sessionPosition <= 15 && isLong) {
            return { color: 'text-emerald-400', text: '✅ Buying at Support - Good Risk/Reward', icon: '📍' }
        }
        if (sessionPosition >= 85 && isShort) {
            return { color: 'text-red-400', text: '✅ Selling at Resistance - Good Risk/Reward', icon: '📍' }
        }
        if (sessionPosition >= 85 && isLong) {
            return { color: 'text-amber-400', text: '⚠️ Buying at Resistance - Higher Risk', icon: '⚠️' }
        }
        if (sessionPosition <= 15 && isShort) {
            return { color: 'text-amber-400', text: '⚠️ Selling at Support - Higher Risk', icon: '⚠️' }
        }
        return { color: 'text-blue-400', text: 'ℹ️ Mid-Range Entry', icon: 'ℹ️' }
    }

    const interpretation = getContextInterpretation()

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="text-blue-400">📊</span>
                Session Context
                {currentSession && (
                    <span className="ml-auto text-xs font-normal text-slate-400">
                        {currentSession.replace(/_/g, ' ')}
                    </span>
                )}
            </h3>

            {/* Position in Range */}
            <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">Position in Session Range</span>
                    <span className="text-sm font-medium text-white flex items-center gap-1">
                        {getPositionEmoji(sessionPosition)}
                        {sessionPosition !== undefined ? `${sessionPosition.toFixed(0)}%` : 'N/A'}
                    </span>
                </div>

                {/* Visual Range Bar */}
                <div className="relative h-6 bg-slate-700 rounded overflow-hidden">
                    {sessionPosition !== undefined && (
                        <>
                            {/* Fill bar */}
                            <div
                                className={`absolute top-0 left-0 h-full ${getPositionColor(sessionPosition)} transition-all duration-300`}
                                style={{ width: `${sessionPosition}%` }}
                            />
                            {/* Marker */}
                            <div
                                className="absolute top-0 h-full w-0.5 bg-white shadow-lg"
                                style={{ left: `${sessionPosition}%` }}
                            />
                        </>
                    )}

                    {/* Labels */}
                    <div className="absolute inset-0 flex items-center justify-between px-2 text-xs font-medium">
                        <span className="text-emerald-300">SUPPORT</span>
                        <span className="text-slate-300">{getPositionText(sessionPosition)}</span>
                        <span className="text-red-300">RESISTANCE</span>
                    </div>
                </div>
            </div>

            {/* Pattern Detection */}
            {(vBottomDetected || vTopDetected) && (
                <div className="mb-3 p-2 bg-blue-500/10 border border-blue-500/30 rounded">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-2xl">🔄</span>
                        <div>
                            <div className="text-blue-400 font-medium">
                                {vBottomDetected ? 'V-Bottom Reversal Detected' : 'V-Top Distribution Detected'}
                            </div>
                            <div className="text-xs text-slate-400">
                                {vBottomDetected ? 'Selling exhaustion → Bullish reversal' : 'Buying exhaustion → Bearish reversal'}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Failed Breakouts/Breakdowns */}
            {(failedBreakoutCount || failedBreakdownCount) && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                    {failedBreakoutCount !== undefined && failedBreakoutCount > 0 && (
                        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded">
                            <div className="text-xs text-slate-400">Failed Breakouts</div>
                            <div className="text-lg font-bold text-red-400">{failedBreakoutCount}</div>
                            <div className="text-xs text-slate-500">Resistance holding</div>
                        </div>
                    )}
                    {failedBreakdownCount !== undefined && failedBreakdownCount > 0 && (
                        <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded">
                            <div className="text-xs text-slate-400">Failed Breakdowns</div>
                            <div className="text-lg font-bold text-emerald-400">{failedBreakdownCount}</div>
                            <div className="text-xs text-slate-500">Support holding</div>
                        </div>
                    )}
                </div>
            )}

            {/* Context Interpretation */}
            {interpretation && (
                <div className={`p-3 rounded-lg border ${
                    interpretation.color.includes('emerald') ? 'bg-emerald-500/10 border-emerald-500/30' :
                    interpretation.color.includes('red') ? 'bg-red-500/10 border-red-500/30' :
                    interpretation.color.includes('amber') ? 'bg-amber-500/10 border-amber-500/30' :
                    'bg-blue-500/10 border-blue-500/30'
                }`}>
                    <div className="flex items-start gap-2">
                        <span className="text-xl">{interpretation.icon}</span>
                        <div className={`text-sm font-medium ${interpretation.color}`}>
                            {interpretation.text}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default SessionContextPanel
