import React from 'react'

interface FamilyBiasPanelProps {
    familyBias?: string
    bullishAlignment?: number
    bearishAlignment?: number
    fullyAligned?: boolean
    hasDivergence?: boolean
    divergences?: string[]
    shortSqueezeSetup?: boolean
    longSqueezeSetup?: boolean
    familyInterpretation?: string
    direction?: string
    className?: string
}

export const FamilyBiasPanel: React.FC<FamilyBiasPanelProps> = ({
    familyBias,
    bullishAlignment,
    bearishAlignment,
    fullyAligned,
    hasDivergence,
    divergences,
    shortSqueezeSetup,
    longSqueezeSetup,
    familyInterpretation,
    direction,
    className = ''
}) => {
    const getBiasColor = (bias: string | undefined) => {
        switch (bias) {
            case 'BULLISH':
                return { bg: 'bg-emerald-500/20', border: 'border-emerald-500/50', text: 'text-emerald-400', icon: '🟢' }
            case 'WEAK_BULLISH':
                return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', icon: '🟡' }
            case 'BEARISH':
                return { bg: 'bg-red-500/20', border: 'border-red-500/50', text: 'text-red-400', icon: '🔴' }
            case 'WEAK_BEARISH':
                return { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', icon: '🟠' }
            case 'NEUTRAL':
            default:
                return { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-400', icon: '⚪' }
        }
    }

    const getBiasLabel = (bias: string | undefined) => {
        switch (bias) {
            case 'BULLISH': return 'BULLISH'
            case 'WEAK_BULLISH': return 'WEAK BULLISH'
            case 'BEARISH': return 'BEARISH'
            case 'WEAK_BEARISH': return 'WEAK BEARISH'
            case 'NEUTRAL': return 'NEUTRAL'
            default: return 'UNKNOWN'
        }
    }

    const biasStyle = getBiasColor(familyBias)

    // Check alignment with signal direction
    const isAlignedWithSignal = () => {
        if (!familyBias || !direction) return null

        const isLong = direction === 'LONG' || direction === 'BULLISH'
        const isShort = direction === 'SHORT' || direction === 'BEARISH'
        const isBullishBias = familyBias.includes('BULLISH')
        const isBearishBias = familyBias.includes('BEARISH')

        if ((isLong && isBullishBias) || (isShort && isBearishBias)) {
            return { aligned: true, text: '✅ Family Aligned with Signal' }
        }
        if ((isLong && isBearishBias) || (isShort && isBullishBias)) {
            return { aligned: false, text: '⚠️ Family Diverges from Signal' }
        }
        return { aligned: null, text: 'ℹ️ Neutral Family Bias' }
    }

    const alignment = isAlignedWithSignal()

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="text-blue-400">🏛️</span>
                Family Bias
                {fullyAligned && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                        FULLY ALIGNED
                    </span>
                )}
            </h3>

            {/* Family Bias Badge */}
            {familyBias && (
                <div className={`mb-4 p-3 rounded-lg border ${biasStyle.bg} ${biasStyle.border}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">{biasStyle.icon}</span>
                            <div>
                                <div className={`text-lg font-bold ${biasStyle.text}`}>
                                    {getBiasLabel(familyBias)}
                                </div>
                                <div className="text-xs text-slate-400">Multi-Instrument Analysis</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Alignment Gauge */}
            {(bullishAlignment !== undefined || bearishAlignment !== undefined) && (
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-400">Alignment Distribution</span>
                    </div>

                    <div className="relative h-8 bg-slate-700 rounded overflow-hidden flex">
                        {/* Bearish section */}
                        {bearishAlignment !== undefined && bearishAlignment > 0 && (
                            <div
                                className="bg-gradient-to-r from-red-500 to-red-400 flex items-center justify-center text-xs font-bold text-white"
                                style={{ width: `${bearishAlignment}%` }}
                            >
                                {bearishAlignment >= 15 && `${bearishAlignment.toFixed(0)}%`}
                            </div>
                        )}

                        {/* Bullish section */}
                        {bullishAlignment !== undefined && bullishAlignment > 0 && (
                            <div
                                className="bg-gradient-to-l from-emerald-500 to-emerald-400 flex items-center justify-center text-xs font-bold text-white"
                                style={{ width: `${bullishAlignment}%` }}
                            >
                                {bullishAlignment >= 15 && `${bullishAlignment.toFixed(0)}%`}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-between mt-1 text-xs">
                        <span className="text-red-400">← BEARISH</span>
                        <span className="text-emerald-400">BULLISH →</span>
                    </div>
                </div>
            )}

            {/* Squeeze Setups */}
            {(shortSqueezeSetup || longSqueezeSetup) && (
                <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl">💥</span>
                        <div>
                            <div className="text-amber-400 font-medium text-sm">
                                {shortSqueezeSetup ? 'Short Squeeze Setup' : 'Long Squeeze Setup'}
                            </div>
                            <div className="text-xs text-slate-400">
                                {shortSqueezeSetup ? 'Heavy short positioning detected' : 'Heavy long positioning detected'}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Divergence Alert */}
            {hasDivergence && divergences && divergences.length > 0 && (
                <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded">
                    <div className="flex items-start gap-2">
                        <span className="text-xl mt-0.5">⚠️</span>
                        <div className="flex-1">
                            <div className="text-amber-400 font-medium text-sm mb-1">
                                Divergence Detected
                            </div>
                            <ul className="text-xs text-slate-300 space-y-1">
                                {divergences.map((div, idx) => (
                                    <li key={idx} className="flex items-start gap-1">
                                        <span className="text-amber-400">•</span>
                                        <span>{div}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Alignment with Signal */}
            {alignment && (
                <div className={`p-3 rounded-lg border ${
                    alignment.aligned === true ? 'bg-emerald-500/10 border-emerald-500/30' :
                    alignment.aligned === false ? 'bg-amber-500/10 border-amber-500/30' :
                    'bg-blue-500/10 border-blue-500/30'
                }`}>
                    <div className={`text-sm font-medium ${
                        alignment.aligned === true ? 'text-emerald-400' :
                        alignment.aligned === false ? 'text-amber-400' :
                        'text-blue-400'
                    }`}>
                        {alignment.text}
                    </div>
                </div>
            )}

            {/* Family Interpretation */}
            {familyInterpretation && (
                <div className="mt-3 p-2 bg-slate-700/50 rounded text-xs text-slate-300 border-l-2 border-blue-400">
                    {familyInterpretation}
                </div>
            )}
        </div>
    )
}

export default FamilyBiasPanel
