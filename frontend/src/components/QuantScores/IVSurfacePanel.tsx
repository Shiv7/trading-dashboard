import type { IVSummary } from '../../types'

interface IVSurfacePanelProps {
    data: IVSummary
}

export default function IVSurfacePanel({ data }: IVSurfacePanelProps) {
    const fmt = (n: number | undefined, decimals = 2) => n == null || isNaN(n) ? '-' : n.toFixed(decimals)
    const fmtPct = (n: number | undefined) => n == null || isNaN(n) ? '-' : `${(n * 100).toFixed(1)}%`

    // IV Signal interpretation
    const getIVSignalColor = (signal?: string) => {
        if (signal === 'HIGH') return 'text-red-400'
        if (signal === 'LOW') return 'text-emerald-400'
        return 'text-amber-400'
    }

    const getIVSignalBg = (signal?: string) => {
        if (signal === 'HIGH') return 'bg-red-500/20'
        if (signal === 'LOW') return 'bg-emerald-500/20'
        return 'bg-amber-500/20'
    }

    // Term structure color
    const getTermStructureColor = (structure?: string) => {
        if (structure === 'CONTANGO') return 'text-emerald-400'
        if (structure === 'BACKWARDATION') return 'text-red-400'
        return 'text-slate-400'
    }

    // IV Rank interpretation
    const getIVRankLevel = (rank?: number) => {
        if (!rank) return { label: 'Unknown', color: 'text-slate-400' }
        if (rank >= 0.8) return { label: 'Extremely High', color: 'text-red-400' }
        if (rank >= 0.6) return { label: 'High', color: 'text-amber-400' }
        if (rank >= 0.4) return { label: 'Moderate', color: 'text-slate-400' }
        if (rank >= 0.2) return { label: 'Low', color: 'text-blue-400' }
        return { label: 'Extremely Low', color: 'text-emerald-400' }
    }

    // Smile shape interpretation
    const getSmileIcon = (shape?: string) => {
        if (shape === 'SMIRK') return '📉'
        if (shape === 'STEEP_SKEW') return '📐'
        return '🔔'
    }

    const ivRankLevel = getIVRankLevel(data.ivRank)

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="text-blue-400">σ</span> IV Surface Analysis
                </h3>
                <div className={`px-2 py-1 rounded text-xs font-medium ${getIVSignalBg(data.ivSignal)} ${getIVSignalColor(data.ivSignal)}`}>
                    IV {data.ivSignal || 'MODERATE'}
                </div>
            </div>

            {/* Main IV Metrics */}
            <div className="grid grid-cols-3 gap-3">
                {/* ATM IV */}
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">ATM IV</div>
                    <div className="text-xl font-bold text-white">
                        {fmt(data.atmIV)}%
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1">Implied Volatility</div>
                </div>

                {/* IV Rank */}
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">IV Rank</div>
                    <div className={`text-xl font-bold ${ivRankLevel.color}`}>
                        {fmtPct(data.ivRank)}
                    </div>
                    <div className="mt-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all ${(data.ivRank || 0) >= 0.7 ? 'bg-red-500' :
                                    (data.ivRank || 0) >= 0.4 ? 'bg-amber-500' : 'bg-emerald-500'
                                }`}
                            style={{ width: `${(data.ivRank || 0) * 100}%` }}
                        />
                    </div>
                    <div className={`text-[9px] mt-1 ${ivRankLevel.color}`}>{ivRankLevel.label}</div>
                </div>

                {/* 25-Delta Skew */}
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">25Δ Skew</div>
                    <div className={`text-xl font-bold ${(data.skew25Delta || 0) > 5 ? 'text-red-400' :
                            (data.skew25Delta || 0) < -5 ? 'text-emerald-400' : 'text-slate-400'
                        }`}>
                        {fmt(data.skew25Delta)}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1">Put-Call Divergence</div>
                </div>
            </div>

            {/* IV Visualization - Smile Shape */}
            <div className="bg-slate-700/30 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">Volatility Smile</span>
                    <span className="text-xs text-slate-400">{getSmileIcon(data.smileShape)} {data.smileShape || 'NORMAL'}</span>
                </div>
                <div className="h-16 relative">
                    {/* SVG Smile Visualization */}
                    <svg viewBox="0 0 200 50" className="w-full h-full">
                        {/* Background grid */}
                        <line x1="100" y1="5" x2="100" y2="45" stroke="#334155" strokeWidth="0.5" />
                        <line x1="10" y1="25" x2="190" y2="25" stroke="#334155" strokeWidth="0.5" />

                        {/* Smile curve based on shape */}
                        {data.smileShape === 'SMIRK' ? (
                            <path d="M 10 35 Q 60 42, 100 25 Q 140 20, 190 15" fill="none" stroke="#3b82f6" strokeWidth="2" />
                        ) : data.smileShape === 'STEEP_SKEW' ? (
                            <path d="M 10 10 Q 60 25, 100 25 Q 140 25, 190 40" fill="none" stroke="#3b82f6" strokeWidth="2" />
                        ) : (
                            <path d="M 10 30 Q 60 40, 100 25 Q 140 40, 190 30" fill="none" stroke="#3b82f6" strokeWidth="2" />
                        )}

                        {/* ATM marker */}
                        <circle cx="100" cy="25" r="4" fill="#3b82f6" />

                        {/* Labels */}
                        <text x="10" y="48" fill="#64748b" fontSize="8">OTM Put</text>
                        <text x="85" y="48" fill="#64748b" fontSize="8">ATM</text>
                        <text x="160" y="48" fill="#64748b" fontSize="8">OTM Call</text>
                    </svg>
                </div>
                <div className="text-[10px] text-slate-500 text-center">
                    {data.smileShape === 'SMIRK' ? 'Puts command premium - bearish sentiment' :
                        data.smileShape === 'STEEP_SKEW' ? 'Strong directional skew - high crash risk pricing' :
                            'Symmetric smile - balanced vol expectations'}
                </div>
            </div>

            {/* Term Structure */}
            <div className="bg-slate-700/30 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">Term Structure</span>
                    <span className={`text-xs font-medium ${getTermStructureColor(data.termStructure)}`}>
                        {data.termStructure || 'FLAT'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="text-center flex-1">
                        <div className="text-[10px] text-slate-400">Near-Term</div>
                        <div className="text-sm font-medium text-white">
                            {fmt(data.nearTermIV)}%
                        </div>
                    </div>
                    <div className="flex-1 relative h-4">
                        <div className="absolute inset-0 flex items-center">
                            <div className={`h-0.5 flex-1 ${data.termStructure === 'CONTANGO' ? 'bg-gradient-to-r from-blue-500 to-emerald-500' :
                                    data.termStructure === 'BACKWARDATION' ? 'bg-gradient-to-r from-red-500 to-blue-500' :
                                        'bg-slate-600'
                                }`} />
                        </div>
                        <div className="absolute inset-0 flex justify-center items-center">
                            <span className="text-xs">{data.termStructure === 'CONTANGO' ? '→' : data.termStructure === 'BACKWARDATION' ? '←' : '−'}</span>
                        </div>
                    </div>
                    <div className="text-center flex-1">
                        <div className="text-[10px] text-slate-400">Far-Term</div>
                        <div className="text-sm font-medium text-white">
                            {fmt(data.farTermIV)}%
                        </div>
                    </div>
                </div>
                <div className="text-[10px] text-slate-500 text-center mt-2">
                    {data.termStructure === 'CONTANGO' ? 'Normal - far-term IV > near-term' :
                        data.termStructure === 'BACKWARDATION' ? 'Inverted - near-term IV > far-term (event expected)' :
                            'Flat term structure'}
                </div>
            </div>

            {/* IV Crush Risk */}
            {data.ivCrushRisk && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <div className="flex items-start gap-2">
                        <span className="text-yellow-400 text-lg">⚠️</span>
                        <div className="flex-1">
                            <div className="text-sm font-bold text-yellow-400 mb-1">IV Crush Risk</div>
                            <div className="text-xs text-slate-400">
                                High IV rank suggests elevated volatility expectations. Consider:
                            </div>
                            <ul className="text-[10px] text-slate-500 mt-1 space-y-0.5 list-disc list-inside">
                                <li>Selling premium strategies (iron condors, strangles)</li>
                                <li>Avoiding long options near events</li>
                                <li>Using spreads to reduce vega exposure</li>
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* IV Velocity */}
            <div className="flex items-center justify-between p-2 bg-slate-700/20 rounded-lg text-[10px]">
                <span className="text-slate-400">IV Velocity (rate of change):</span>
                <span className={`font-medium ${(data.ivVelocity || 0) > 2 ? 'text-red-400' :
                        (data.ivVelocity || 0) < -2 ? 'text-emerald-400' : 'text-slate-400'
                    }`}>
                    {(data.ivVelocity || 0) > 0 ? '+' : ''}{fmt(data.ivVelocity)} pts/day
                </span>
            </div>
        </div>
    )
}
