import type { GreeksSummary } from '../../types'

interface GreeksExposurePanelProps {
    data: GreeksSummary
    currentPrice?: number
}

export default function GreeksExposurePanel({ data, currentPrice }: GreeksExposurePanelProps) {
    const fmt = (n: number | undefined, decimals = 2) => n == null || isNaN(n) ? '-' : n.toFixed(decimals)
    const fmtK = (n: number | undefined) => {
        if (n == null || isNaN(n)) return '-'
        if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`
        if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`
        return n.toFixed(2)
    }

    // Delta interpretation
    const getDeltaBiasColor = (bias?: string) => {
        if (bias?.includes('BULL')) return 'text-emerald-400'
        if (bias?.includes('BEAR')) return 'text-red-400'
        return 'text-slate-400'
    }

    const getDeltaBiasBg = (bias?: string) => {
        if (bias?.includes('BULL')) return 'bg-emerald-500/20'
        if (bias?.includes('BEAR')) return 'bg-red-500/20'
        return 'bg-slate-700'
    }

    // Vega structure color
    const getVegaColor = (structure?: string) => {
        if (structure === 'LONG_VEGA') return 'text-blue-400'
        if (structure === 'SHORT_VEGA') return 'text-amber-400'
        return 'text-slate-400'
    }

    // Gamma squeeze risk calculations
    const gammaDistance = data.gammaSqueezeDistance || 0
    const maxGammaStrike = data.maxGammaStrike || 0

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="text-purple-400">Δ</span> Greeks Exposure
                </h3>
                <div className={`px-2 py-1 rounded text-xs font-medium ${getDeltaBiasBg(data.deltaBias)} ${getDeltaBiasColor(data.deltaBias)}`}>
                    {data.deltaBias || 'NEUTRAL'}
                </div>
            </div>

            {/* Main Greeks Grid */}
            <div className="grid grid-cols-4 gap-2">
                {/* Delta */}
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">Delta (Δ)</div>
                    <div className={`text-xl font-bold ${(data.totalDelta || 0) > 0 ? 'text-emerald-400' : (data.totalDelta || 0) < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {fmtK(data.totalDelta)}
                    </div>
                    <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden relative">
                        <div className="absolute inset-0 flex">
                            <div className="w-1/2" />
                        </div>
                        <div
                            className={`absolute top-0 bottom-0 ${(data.totalDelta || 0) >= 0 ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-red-500'}`}
                            style={{ width: `${Math.min(Math.abs(data.totalDelta || 0) / 100000 * 50, 50)}%` }}
                        />
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1">Price sensitivity</div>
                </div>

                {/* Gamma */}
                <div className="bg-slate-700/30 rounded-lg p-3 text-center relative">
                    <div className="text-[10px] text-slate-400 mb-1">Gamma (Γ)</div>
                    <div className="text-xl font-bold text-purple-400">
                        {fmt(data.totalGamma, 4)}
                    </div>
                    <div className="mt-2 h-1.5 bg-gradient-to-r from-slate-700 via-purple-500/30 to-purple-500 rounded-full" />
                    <div className="text-[9px] text-slate-500 mt-1">Convexity</div>
                    {data.gammaSqueezeRisk && (
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" title="Gamma Squeeze Risk" />
                    )}
                </div>

                {/* Vega */}
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">Vega (ν)</div>
                    <div className={`text-xl font-bold ${getVegaColor(data.vegaStructure)}`}>
                        {fmtK(data.totalVega)}
                    </div>
                    <div className="mt-2 h-1.5 bg-gradient-to-r from-blue-500 via-slate-700 to-amber-500 rounded-full" />
                    <div className="text-[9px] text-slate-500 mt-1">{data.vegaStructure?.replace('_', ' ') || 'Volatility'}</div>
                </div>

                {/* Theta */}
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-slate-400 mb-1">Theta (Θ)</div>
                    <div className={`text-xl font-bold ${(data.totalTheta || 0) < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {fmtK(data.totalTheta)}
                    </div>
                    <div className="mt-2 h-1.5 bg-gradient-to-r from-amber-500 to-slate-700 rounded-full" />
                    <div className="text-[9px] text-slate-500 mt-1">Time decay/day</div>
                </div>
            </div>

            {/* Gamma Squeeze Risk Alert */}
            {data.gammaSqueezeRisk && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <div className="flex items-start gap-2">
                        <span className="text-red-400 text-lg">⚠️</span>
                        <div className="flex-1">
                            <div className="text-sm font-bold text-red-400 mb-1">Gamma Squeeze Risk Detected</div>
                            <div className="text-xs text-slate-400 space-y-1">
                                <div className="flex justify-between">
                                    <span>Distance to Max Gamma Strike:</span>
                                    <span className="text-white font-medium">{fmt(gammaDistance)}%</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Max Gamma Strike:</span>
                                    <span className="text-white font-medium">₹{fmt(maxGammaStrike, 0)}</span>
                                </div>
                                {currentPrice && (
                                    <div className="flex justify-between">
                                        <span>Current Price:</span>
                                        <span className="text-white font-medium">₹{fmt(currentPrice, 2)}</span>
                                    </div>
                                )}
                            </div>
                            {/* Visual proximity bar */}
                            <div className="mt-2 relative">
                                <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className="absolute h-full bg-gradient-to-r from-amber-500 to-red-500"
                                        style={{ width: `${100 - Math.min(gammaDistance, 10) * 10}%` }}
                                    />
                                </div>
                                <div
                                    className="absolute top-0 w-0.5 h-3 bg-white"
                                    style={{ left: `${100 - Math.min(gammaDistance, 10) * 10}%` }}
                                />
                            </div>
                            <div className="text-[10px] text-red-400 mt-1">
                                Price approaching max gamma - expect volatility amplification
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Risk Score */}
            <div className="flex items-center justify-between p-2 bg-slate-700/20 rounded-lg">
                <span className="text-xs text-slate-400">Overall Risk Score:</span>
                <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all ${(data.riskScore || 0) >= 0.7 ? 'bg-red-500' :
                                    (data.riskScore || 0) >= 0.4 ? 'bg-amber-500' : 'bg-emerald-500'
                                }`}
                            style={{ width: `${(data.riskScore || 0) * 100}%` }}
                        />
                    </div>
                    <span className={`text-xs font-medium ${(data.riskScore || 0) >= 0.7 ? 'text-red-400' :
                            (data.riskScore || 0) >= 0.4 ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                        {((data.riskScore || 0) * 100).toFixed(0)}%
                    </span>
                </div>
            </div>
        </div>
    )
}
