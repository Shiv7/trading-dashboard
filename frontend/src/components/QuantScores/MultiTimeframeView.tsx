import { useState } from 'react'
import type { QuantScore } from '../../types'

// Standard timeframes in order from smallest to largest
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1H', '2H', '4H', '1D'] as const
type Timeframe = typeof TIMEFRAMES[number]

interface MultiTimeframeViewProps {
    scores: QuantScore[]  // All scores for a single scripCode across timeframes
    scripCode: string
    symbol?: string
}

export default function MultiTimeframeView({ scores, scripCode, symbol }: MultiTimeframeViewProps) {
    const [selectedTf, setSelectedTf] = useState<Timeframe | null>(null)

    // Group scores by timeframe
    const scoresByTimeframe = new Map<string, QuantScore>()
    scores.forEach(s => {
        if (s.timeframe) scoresByTimeframe.set(s.timeframe, s)
    })

    // Calculate average across all timeframes
    const avgScore = scores.length > 0
        ? scores.reduce((sum, s) => sum + (s.quantScore || 0), 0) / scores.length
        : 0

    const getScoreColor = (score: number) => {
        if (score >= 75) return 'bg-emerald-500'
        if (score >= 60) return 'bg-blue-500'
        if (score >= 45) return 'bg-amber-500'
        return 'bg-slate-600'
    }

    const getTextColor = (score: number) => {
        if (score >= 75) return 'text-emerald-400'
        if (score >= 60) return 'text-blue-400'
        if (score >= 45) return 'text-amber-400'
        return 'text-slate-400'
    }

    const getDirectionIcon = (direction?: string) => {
        if (direction === 'BULLISH') return '↑'
        if (direction === 'BEARISH') return '↓'
        return '−'
    }

    const getDirectionColor = (direction?: string) => {
        if (direction === 'BULLISH') return 'text-emerald-400'
        if (direction === 'BEARISH') return 'text-red-400'
        return 'text-slate-400'
    }

    // Direction consistency across timeframes
    const directions = scores.map(s => s.direction).filter(Boolean)
    const bullishCount = directions.filter(d => d === 'BULLISH').length
    const bearishCount = directions.filter(d => d === 'BEARISH').length
    const consistencyPct = directions.length > 0
        ? (Math.max(bullishCount, bearishCount) / directions.length) * 100
        : 0
    const dominantDirection = bullishCount > bearishCount ? 'BULLISH' : bearishCount > bullishCount ? 'BEARISH' : 'NEUTRAL'

    const selectedScore = selectedTf ? scoresByTimeframe.get(selectedTf) : null

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        📊 Multi-Timeframe Analysis
                        <span className="text-sm text-slate-400 font-normal">({symbol || scripCode})</span>
                    </h3>
                    <p className="text-xs text-slate-500">Score roll-up from tick to daily timeframes</p>
                </div>
                <div className="text-right">
                    <div className={`text-2xl font-bold ${getTextColor(avgScore)}`}>
                        {avgScore.toFixed(1)}
                    </div>
                    <div className="text-[10px] text-slate-500">Avg Score</div>
                </div>
            </div>

            {/* Direction Consistency */}
            <div className="flex items-center gap-3 p-2 bg-slate-700/30 rounded-lg">
                <span className="text-xs text-slate-400">Direction Consistency:</span>
                <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full ${dominantDirection === 'BULLISH' ? 'bg-emerald-500' : dominantDirection === 'BEARISH' ? 'bg-red-500' : 'bg-slate-600'}`}
                        style={{ width: `${consistencyPct}%` }}
                    />
                </div>
                <span className={`text-xs font-medium ${getDirectionColor(dominantDirection)}`}>
                    {consistencyPct.toFixed(0)}% {dominantDirection}
                </span>
            </div>

            {/* Timeframe Grid */}
            <div className="grid grid-cols-8 gap-1">
                {TIMEFRAMES.map((tf) => {
                    const score = scoresByTimeframe.get(tf)
                    const hasData = !!score
                    const isSelected = selectedTf === tf
                    return (
                        <button
                            key={tf}
                            onClick={() => setSelectedTf(isSelected ? null : tf)}
                            disabled={!hasData}
                            className={`relative p-2 rounded-lg transition-all ${isSelected
                                ? 'ring-2 ring-amber-500 bg-slate-700'
                                : hasData
                                    ? 'bg-slate-700/50 hover:bg-slate-700'
                                    : 'bg-slate-800/50 opacity-40 cursor-not-allowed'
                                }`}
                        >
                            <div className="text-[10px] text-slate-400 mb-1">{tf}</div>
                            {hasData && score ? (
                                <>
                                    <div className={`h-12 ${getScoreColor(score.quantScore)} rounded-sm relative overflow-hidden`}>
                                        <div
                                            className="absolute inset-0 bg-black/30"
                                            style={{ top: `${100 - score.quantScore}%` }}
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-white text-xs font-bold">
                                                {score.quantScore.toFixed(0)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className={`text-center text-sm mt-1 ${getDirectionColor(score.direction)}`}>
                                        {getDirectionIcon(score.direction)}
                                    </div>
                                </>
                            ) : (
                                <div className="h-12 flex items-center justify-center text-slate-600 text-xs">
                                    N/A
                                </div>
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Selected Timeframe Details */}
            {selectedScore && (
                <div className="border-t border-slate-700 pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-white">
                            {selectedTf} Details
                        </h4>
                        <span className={`px-2 py-1 rounded text-xs ${selectedScore.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
                            selectedScore.direction === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
                                'bg-slate-700 text-slate-400'
                            }`}>
                            {selectedScore.direction} • {selectedScore.quantLabel?.replace('_', ' ')}
                        </span>
                    </div>

                    {/* Breakdown bars */}
                    {selectedScore.breakdown && (
                        <div className="grid grid-cols-4 gap-2 text-[10px]">
                            {[
                                { label: 'Greeks', value: selectedScore.breakdown.greeksScore, max: 15 },
                                { label: 'IV', value: selectedScore.breakdown.ivSurfaceScore, max: 12 },
                                { label: 'Micro', value: selectedScore.breakdown.microstructureScore, max: 18 },
                                { label: 'Flow', value: selectedScore.breakdown.optionsFlowScore, max: 15 },
                                { label: 'Price', value: selectedScore.breakdown.priceActionScore, max: 12 },
                                { label: 'Volume', value: selectedScore.breakdown.volumeProfileScore, max: 8 },
                                { label: 'Cross', value: selectedScore.breakdown.crossInstrumentScore, max: 10 },
                                { label: 'Conf', value: selectedScore.breakdown.confluenceScore, max: 10 },
                            ].map(({ label, value, max }) => {
                                const pct = ((value || 0) / max) * 100
                                return (
                                    <div key={label}>
                                        <div className="flex justify-between text-slate-400 mb-0.5">
                                            <span>{label}</span>
                                            <span className="text-white">{(value || 0).toFixed(1)}/{max}</span>
                                        </div>
                                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-slate-600'}`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Time info */}
                    <div className="text-[10px] text-slate-500 text-right">
                        Updated: {selectedScore.humanReadableTime || new Date(selectedScore.timestamp).toLocaleString()}
                    </div>
                </div>
            )}
        </div>
    )
}
