import { IPUSignal } from '../../types/indicators'

interface IPUPanelProps {
    data: IPUSignal;
}

export function IPUPanel({ data }: IPUPanelProps) {
    const getScoreColor = (score: number) => {
        if (score >= 0.7) return 'text-emerald-400'
        if (score >= 0.4) return 'text-amber-400'
        return 'text-slate-400'
    }

    return (
        <div className="card">
            <div className="card-header flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <span>🏛️ IPU Details</span>
                    {data.hasXFactor && (
                        <span className="text-yellow-400 animate-pulse text-xs border border-yellow-400 px-1 rounded">
                            ⚡ X-FACTOR
                        </span>
                    )}
                </div>
                <div className={`text-xl font-bold ${getScoreColor(data.ipuFinalScore)}`}>
                    {(data.ipuFinalScore * 100).toFixed(0)}%
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
                {/* Core Components */}
                <div className="bg-slate-700/30 p-3 rounded-lg">
                    <div className="text-xs text-slate-400 mb-2 uppercase tracking-wider">Components</div>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span>Inst. Proxy</span>
                            <span className={getScoreColor(data.institutionalProxy)}>
                                {(data.institutionalProxy * 100).toFixed(0)}%
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>Momentum</span>
                            <span className={getScoreColor(data.momentum)}>
                                {(data.momentum * 100).toFixed(0)}%
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>Urgency</span>
                            <span className={getScoreColor(data.urgency)}>
                                {(data.urgency * 100).toFixed(0)}%
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>Exhaustion</span>
                            <span className={data.exhaustion > 0.7 ? 'text-red-400' : 'text-slate-300'}>
                                {(data.exhaustion * 100).toFixed(0)}%
                            </span>
                        </div>
                    </div>
                </div>

                {/* Volume & Context */}
                <div className="bg-slate-700/30 p-3 rounded-lg">
                    <div className="text-xs text-slate-400 mb-2 uppercase tracking-wider">Volume Flow</div>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span>Aggressive</span>
                            <span className="text-white">{data.aggressiveVolumeRatio.toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Expansion</span>
                            <span className={data.volumeExpansionPct > 0 ? 'text-emerald-400' : 'text-slate-400'}>
                                {data.volumeExpansionPct > 0 ? '+' : ''}{data.volumeExpansionPct.toFixed(1)}%
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>Liquidity</span>
                            <span className={data.liquidityTier === 'Low' ? 'text-red-400' : 'text-emerald-400'}>
                                {data.liquidityTier}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>Direction</span>
                            <span className={data.ipuDirection === 'BULLISH' ? 'text-emerald-400' : data.ipuDirection === 'BEARISH' ? 'text-red-400' : 'text-slate-400'}>
                                {data.ipuDirection}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Triggers & Alerts */}
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className={`p-2 rounded border text-center ${data.dibTriggered ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                    DIB (Demand)
                </div>
                <div className={`p-2 rounded border text-center ${data.vibTriggered ? 'bg-red-500/20 border-red-500/50 text-red-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                    VIB (Supply)
                </div>
            </div>

            {data.gapStatus !== 'NONE' && (
                <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-center text-blue-300">
                    GAP: {data.gapStatus} (x{data.gapConvictionMultiplier})
                </div>
            )}
        </div>
    )
}
