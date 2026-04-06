import type { FamilyScore } from '../../types'
import type { MarketNarrative, MarketIntelligence } from '../../store/dashboardStore'

interface PriceNarrativeProps {
    score: FamilyScore | null
    narrative?: MarketNarrative
    intelligence?: MarketIntelligence
    className?: string
}

interface NarrativePoint {
    type: 'support' | 'resistance' | 'momentum' | 'regime' | 'flow' | 'pattern'
    text: string
    positive: boolean
}

export default function PriceNarrative({ score, narrative, intelligence, className = '' }: PriceNarrativeProps) {
    if (!score && !narrative) {
        return (
            <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
                <div className="text-slate-500 text-center py-4">Select a stock to see price narrative</div>
            </div>
        )
    }

    // If we have real narrative data from Kafka, use it
    if (narrative) {
        return (
            <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
                <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span className="text-amber-400">💡</span>
                    Market Narrative
                </h3>

                {/* Headline */}
                {narrative.headline && (
                    <div className="bg-gradient-to-r from-slate-700/50 to-slate-800/50 rounded-lg p-3 mb-4 border border-slate-600/30">
                        <p className="text-sm font-medium text-white">{narrative.headline}</p>
                    </div>
                )}

                {/* One-liner summary */}
                {narrative.oneLiner && (
                    <div className="bg-slate-700/30 rounded-lg p-3 mb-4">
                        <p className="text-sm text-slate-200 leading-relaxed">{narrative.oneLiner}</p>
                    </div>
                )}

                {/* Intelligence highlights */}
                {intelligence && (
                    <div className="space-y-2 mb-4">
                        {intelligence.isActionableMoment && (
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 text-emerald-300 text-sm">
                                <span>🎯</span>
                                <span>Actionable Moment - High probability setup detected</span>
                            </div>
                        )}
                        {intelligence.hasReadySetups && (
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/10 text-blue-300 text-sm">
                                <span>📊</span>
                                <span>Active setups ready for entry</span>
                            </div>
                        )}
                        {intelligence.recommendation && (
                            <div className={`flex items-start gap-2 p-2 rounded-lg text-sm ${
                                intelligence.recommendation.direction === 'BULLISH'
                                    ? 'bg-emerald-500/10 text-emerald-300'
                                    : intelligence.recommendation.direction === 'BEARISH'
                                        ? 'bg-red-500/10 text-red-300'
                                        : 'bg-slate-500/10 text-slate-300'
                            }`}>
                                <span>💡</span>
                                <div>
                                    <div className="font-medium">{intelligence.recommendation.action} - {intelligence.recommendation.direction}</div>
                                    <div className="text-xs opacity-80 mt-1">{intelligence.recommendation.rationale}</div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Posture and Control */}
                <div className="mt-4 pt-3 border-t border-slate-700">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Market Posture:</span>
                        <span className={`font-bold px-3 py-1 rounded ${
                            narrative.posture?.includes('BULL') ? 'bg-emerald-500/20 text-emerald-400' :
                            narrative.posture?.includes('BEAR') ? 'bg-red-500/20 text-red-400' :
                            'bg-slate-700 text-slate-400'
                        }`}>
                            {narrative.posture || 'NEUTRAL'}
                        </span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-2">
                        <span className="text-slate-400">Control Side:</span>
                        <span className={`font-bold px-3 py-1 rounded ${
                            narrative.controlSide === 'BUYERS' ? 'bg-emerald-500/20 text-emerald-400' :
                            narrative.controlSide === 'SELLERS' ? 'bg-red-500/20 text-red-400' :
                            'bg-slate-700 text-slate-400'
                        }`}>
                            {narrative.controlSide === 'BUYERS' ? '🐂 BUYERS' :
                             narrative.controlSide === 'SELLERS' ? '🐻 SELLERS' : '⚖️ BALANCED'}
                        </span>
                    </div>
                </div>
            </div>
        )
    }

    // Fallback: Generate narrative points from FamilyScore data
    // At this point, we know score is not null (checked above)
    if (!score) return null

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
        const price = score.close > 0 ? `₹${score.close.toFixed(2)}` : 'DM'
        const direction = score.direction === 'BULLISH' ? 'bullish' :
            score.direction === 'BEARISH' ? 'bearish' : 'neutral'

        let summary = `Price at ${price} with ${direction} bias. `

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

    // Track what data is missing — show DM indicators
    const missingInputs: string[] = []
    if (score.close === 0) missingInputs.push('Price')
    if (score.vcpCombinedScore === 0 && score.vcpSupportScore === 0) missingInputs.push('VCP')
    if (score.ipuFinalScore === 0 && score.ipuMomentumState === 'STEADY') missingInputs.push('IPU')
    if (!score.oiSignal || score.oiSignal === '') missingInputs.push('OI')
    if (!score.futuresBuildup || score.futuresBuildup === '') missingInputs.push('F&O')

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 ${className}`}>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wide flex items-center gap-1.5">
                    Why Price Is Here
                </h3>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${score.direction === 'BULLISH'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : score.direction === 'BEARISH'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-slate-700 text-slate-400'
                    }`}>
                    {score.direction === 'BULLISH' ? 'BUYERS' :
                        score.direction === 'BEARISH' ? 'SELLERS' : 'BALANCED'}
                </span>
            </div>

            {/* Main Summary — compact */}
            <p className="text-xs text-slate-300 leading-relaxed mb-2">
                {generateSummary()}
            </p>

            {/* Key Factors — only show if we have them */}
            {narrativePoints.length > 0 && (
                <div className="space-y-1">
                    {narrativePoints.map((point, i) => (
                        <div
                            key={i}
                            className={`flex items-start gap-1.5 px-2 py-1 rounded text-xs ${point.positive
                                    ? 'bg-emerald-500/10 text-emerald-300'
                                    : 'bg-red-500/10 text-red-300'
                                }`}
                        >
                            <span className="flex-shrink-0 text-[10px]">{getIconForType(point.type)}</span>
                            <span>{point.text}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Show missing data sources */}
            {missingInputs.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-700/50">
                    <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[9px] text-slate-500">Missing:</span>
                        {missingInputs.map(m => (
                            <span key={m} className="text-[9px] text-red-400/70 italic bg-red-500/5 px-1 rounded">
                                {m}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
