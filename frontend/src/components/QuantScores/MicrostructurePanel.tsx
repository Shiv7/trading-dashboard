import type { MicrostructureSummary } from '../../types'

interface MicrostructurePanelProps {
    data: MicrostructureSummary
}

export default function MicrostructurePanel({ data }: MicrostructurePanelProps) {
    const fmtPct = (n: number | undefined) => n == null || isNaN(n) ? '-' : `${(n * 100).toFixed(1)}%`
    const fmt = (n: number | undefined, decimals = 2) => n == null || isNaN(n) ? '-' : n.toFixed(decimals)

    // Interpret flow direction and strength
    const getFlowColor = (direction?: string) => {
        if (direction === 'BUYING') return 'text-emerald-400'
        if (direction === 'SELLING') return 'text-red-400'
        return 'text-slate-400'
    }

    const getFlowBg = (direction?: string) => {
        if (direction === 'BUYING') return 'bg-emerald-500'
        if (direction === 'SELLING') return 'bg-red-500'
        return 'bg-slate-600'
    }

    // VPIN interpretation (high = informed trading)
    const getVPINLevel = (vpin?: number) => {
        if (!vpin) return { label: 'Unknown', color: 'text-slate-400', risk: 'LOW' }
        if (vpin >= 0.7) return { label: 'High Risk', color: 'text-red-400', risk: 'HIGH' }
        if (vpin >= 0.5) return { label: 'Moderate', color: 'text-amber-400', risk: 'MEDIUM' }
        return { label: 'Normal', color: 'text-emerald-400', risk: 'LOW' }
    }

    const vpinLevel = getVPINLevel(data.avgVPIN)

    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="text-cyan-400">⚡</span> Microstructure Analysis
                </h3>
                <div className={`px-2 py-1 rounded text-xs font-medium ${data.flowDirection === 'BUYING' ? 'bg-emerald-500/20 text-emerald-400' :
                        data.flowDirection === 'SELLING' ? 'bg-red-500/20 text-red-400' :
                            'bg-slate-700 text-slate-400'
                    }`}>
                    {data.flowDirection} ({fmtPct(data.flowStrength)})
                </div>
            </div>

            {/* Main Metrics Grid */}
            <div className="grid grid-cols-2 gap-3">
                {/* Order Flow Imbalance */}
                <div className="bg-slate-700/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-400">Order Flow Imbalance</span>
                        <span className="text-xs text-slate-500">OFI</span>
                    </div>
                    <div className={`text-lg font-bold ${(data.avgOFI || 0) > 0 ? 'text-emerald-400' : (data.avgOFI || 0) < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {(data.avgOFI || 0) > 0 ? '+' : ''}{fmt(data.avgOFI, 0)}
                    </div>
                    <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden relative">
                        <div className="absolute inset-0 flex">
                            <div className="w-1/2 border-r border-slate-600" />
                        </div>
                        <div
                            className={`absolute top-0 bottom-0 ${(data.avgOFI || 0) >= 0 ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-red-500'}`}
                            style={{ width: `${Math.min(Math.abs(data.avgOFI || 0) / 1000 * 50, 50)}%` }}
                        />
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                        {(data.avgOFI || 0) > 100 ? 'Strong buying pressure' :
                            (data.avgOFI || 0) < -100 ? 'Strong selling pressure' :
                                'Balanced flow'}
                    </div>
                </div>

                {/* VPIN */}
                <div className="bg-slate-700/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-400">Informed Trading Prob.</span>
                        <span className="text-xs text-slate-500">VPIN</span>
                    </div>
                    <div className={`text-lg font-bold ${vpinLevel.color}`}>
                        {fmtPct(data.avgVPIN)}
                    </div>
                    <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all ${(data.avgVPIN || 0) >= 0.7 ? 'bg-red-500' :
                                    (data.avgVPIN || 0) >= 0.5 ? 'bg-amber-500' : 'bg-emerald-500'
                                }`}
                            style={{ width: `${(data.avgVPIN || 0) * 100}%` }}
                        />
                    </div>
                    <div className={`text-[10px] mt-1 ${vpinLevel.color}`}>
                        {vpinLevel.label} - {vpinLevel.risk} informed trading risk
                    </div>
                </div>

                {/* Depth Imbalance */}
                <div className="bg-slate-700/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-400">Book Depth Imbalance</span>
                        <span className="text-xs text-slate-500">BDI</span>
                    </div>
                    <div className={`text-lg font-bold ${(data.avgDepthImbalance || 0) > 0.2 ? 'text-emerald-400' :
                            (data.avgDepthImbalance || 0) < -0.2 ? 'text-red-400' : 'text-slate-400'
                        }`}>
                        {fmtPct(data.avgDepthImbalance)}
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                        <div className="flex-1 h-4 bg-red-500/30 rounded-l relative overflow-hidden">
                            <div className="absolute right-0 top-0 bottom-0 bg-red-500"
                                style={{ width: `${Math.max(0, (0.5 - (data.avgDepthImbalance || 0) / 2)) * 100}%` }} />
                        </div>
                        <div className="flex-1 h-4 bg-emerald-500/30 rounded-r relative overflow-hidden">
                            <div className="absolute left-0 top-0 bottom-0 bg-emerald-500"
                                style={{ width: `${Math.max(0, (0.5 + (data.avgDepthImbalance || 0) / 2)) * 100}%` }} />
                        </div>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                        <span>Bids</span>
                        <span>Asks</span>
                    </div>
                </div>

                {/* Kyle Lambda */}
                <div className="bg-slate-700/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-400">Price Impact</span>
                        <span className="text-xs text-slate-500">Kyle λ</span>
                    </div>
                    <div className="text-lg font-bold text-cyan-400">
                        {fmt(data.avgKyleLambda, 5)}
                    </div>
                    <div className="mt-2 bg-gradient-to-r from-emerald-500/20 via-amber-500/20 to-red-500/20 h-2 rounded-full relative">
                        <div
                            className="absolute top-0 bottom-0 w-1 bg-white rounded"
                            style={{ left: `${Math.min((data.avgKyleLambda || 0) * 10000, 100)}%` }}
                        />
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                        {(data.avgKyleLambda || 0) > 0.0001 ? 'High impact (illiquid)' :
                            (data.avgKyleLambda || 0) > 0.00005 ? 'Moderate impact' :
                                'Low impact (liquid)'}
                    </div>
                </div>
            </div>

            {/* Summary Indicators */}
            <div className="flex items-center gap-2 p-2 bg-slate-700/20 rounded-lg text-[10px]">
                <div className={`w-2 h-2 rounded-full ${getFlowBg(data.flowDirection)}`} />
                <span className="text-slate-400">Flow:</span>
                <span className={getFlowColor(data.flowDirection)}>{data.flowDirection || 'BALANCED'}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Strength:</span>
                <span className="text-white font-medium">{fmtPct(data.flowStrength)}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Risk:</span>
                <span className={vpinLevel.color}>{vpinLevel.risk}</span>
            </div>
        </div>
    )
}
