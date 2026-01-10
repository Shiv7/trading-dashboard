import type { FamilyScore } from '../../types'

interface PriceNarrativeProps {
    score: FamilyScore | null
    className?: string
}

interface NarrativePoint {
    type: 'support' | 'resistance' | 'momentum' | 'regime' | 'flow' | 'pattern'
    text: string
    positive: boolean
}

export default function PriceNarrative({ score, className = '' }: PriceNarrativeProps) {
    if (!score) {
        return (
            <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
                <div className="text-slate-500 text-center py-4">Select a stock to see price narrative</div>
            </div>
        )
    }

    // Generate narrative points from FamilyScore data
    const generateNarrativePoints = (): NarrativePoint[] => {
        const points: NarrativePoint[] = []

        // VCP Support/Resistance
        if (score.vcpSupportScore > 0.7) {
            points.push({
                type: 'support',
                text: `Strong support cluster at ${(score.vcpSupportScore * 100).toFixed(0)}% confidence`,
                positive: score.direction === 'BULLISH'
            })
        }
        if (score.vcpResistanceScore > 0.7) {
            points.push({
                type: 'resistance',
                text: `Strong resistance zone at ${(score.vcpResistanceScore * 100).toFixed(0)}% confidence`,
                positive: score.direction === 'BEARISH'
            })
        }

        // IPU Momentum
        if (score.ipuMomentumState === 'ACCELERATING') {
            points.push({
                type: 'momentum',
                text: 'Momentum accelerating — institutional interest rising',
                positive: true
            })
        } else if (score.ipuMomentumState === 'DECELERATING') {
            points.push({
                type: 'momentum',
                text: 'Momentum decelerating — watch for reversal',
                positive: false
            })
        } else if (score.ipuMomentumState === 'EXHAUSTION') {
            points.push({
                type: 'momentum',
                text: 'Exhaustion detected — trend may be ending',
                positive: false
            })
        }

        // IPU X-Factor
        if (score.ipuXfactor) {
            points.push({
                type: 'flow',
                text: '⚡ X-Factor active — unusual institutional activity',
                positive: true
            })
        }

        // Regime
        if (score.securityAligned) {
            points.push({
                type: 'regime',
                text: `Security aligned with ${score.indexRegimeLabel} index regime`,
                positive: true
            })
        } else {
            points.push({
                type: 'regime',
                text: `Security NOT aligned with index (Index: ${score.indexRegimeLabel})`,
                positive: false
            })
        }

        // OI Signal
        if (score.oiSignal) {
            const isPositive = score.oiSignal.includes('BULLISH') === (score.direction === 'BULLISH')
            points.push({
                type: 'flow',
                text: `OI Signal: ${score.oiSignal.replace(/_/g, ' ')}`,
                positive: isPositive
            })
        }

        // Futures Buildup
        if (score.futuresBuildup && score.futuresBuildup !== 'NEUTRAL') {
            const isLongBuildup = score.futuresBuildup.includes('LONG')
            points.push({
                type: 'flow',
                text: `Futures: ${score.futuresBuildup.replace(/_/g, ' ')}`,
                positive: (isLongBuildup && score.direction === 'BULLISH') ||
                    (!isLongBuildup && score.direction === 'BEARISH')
            })
        }

        // VCP Runway
        if (score.vcpRunway > 0.7) {
            points.push({
                type: 'pattern',
                text: `${(score.vcpRunway * 100).toFixed(0)}% runway to next level — room to run`,
                positive: true
            })
        } else if (score.vcpRunway < 0.3) {
            points.push({
                type: 'pattern',
                text: 'Limited runway — approaching key level soon',
                positive: false
            })
        }

        return points
    }

    const narrativePoints = generateNarrativePoints()

    // Generate main summary
    const generateSummary = (): string => {
        const price = score.close.toFixed(2)
        const direction = score.direction === 'BULLISH' ? 'bullish' :
            score.direction === 'BEARISH' ? 'bearish' : 'neutral'

        let summary = `Price at ₹${price} with ${direction} bias. `

        if (score.vcpSupportScore > 0.6 && score.direction === 'BULLISH') {
            summary += 'Holding above key support cluster. '
        } else if (score.vcpResistanceScore > 0.6 && score.direction === 'BEARISH') {
            summary += 'Rejected at resistance zone. '
        }

        if (score.ipuFinalScore > 0.6) {
            summary += 'Institutional participation detected. '
        }

        if (score.securityAligned) {
            summary += 'Aligned with broader market regime.'
        } else {
            summary += 'Diverging from index — use caution.'
        }

        return summary
    }

    const getIconForType = (type: string) => {
        switch (type) {
            case 'support': return '🛡️'
            case 'resistance': return '🚧'
            case 'momentum': return '📈'
            case 'regime': return '🌍'
            case 'flow': return '💰'
            case 'pattern': return '📊'
            default: return '•'
        }
    }

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="text-amber-400">💡</span>
                Why Price Is Here
            </h3>

            {/* Main Summary */}
            <div className="bg-slate-700/30 rounded-lg p-3 mb-4">
                <p className="text-sm text-slate-200 leading-relaxed">
                    {generateSummary()}
                </p>
            </div>

            {/* Key Factors */}
            <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Key Factors</h4>
                {narrativePoints.map((point, i) => (
                    <div
                        key={i}
                        className={`flex items-start gap-2 p-2 rounded-lg text-sm ${point.positive
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : 'bg-red-500/10 text-red-300'
                            }`}
                    >
                        <span className="flex-shrink-0">{getIconForType(point.type)}</span>
                        <span>{point.text}</span>
                    </div>
                ))}
            </div>

            {/* Controlling Party */}
            <div className="mt-4 pt-3 border-t border-slate-700">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Controlling Party:</span>
                    <span className={`font-bold px-3 py-1 rounded ${score.direction === 'BULLISH'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : score.direction === 'BEARISH'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-slate-700 text-slate-400'
                        }`}>
                        {score.direction === 'BULLISH' ? '🐂 BUYERS' :
                            score.direction === 'BEARISH' ? '🐻 SELLERS' : '⚖️ BALANCED'}
                    </span>
                </div>
            </div>
        </div>
    )
}
