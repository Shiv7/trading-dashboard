import React from 'react';

interface GreeksSummary {
    totalDelta: number;
    totalGamma: number;
    totalVega: number;
    totalTheta: number;
    callDelta: number;
    putDelta: number;
    netDelta: number;
    totalGex: number;
    gexRegime: 'TRENDING' | 'MEAN_REVERTING';
    maxGammaStrike: number;
    gammaWallUp?: number;
    gammaWallDown?: number;
    gammaSqueezeRisk: boolean;
    gammaSqueezeDistance?: number;
}

interface GreeksPanelProps {
    greeks: GreeksSummary;
    spotPrice: number;
}

export const GreeksPanel: React.FC<GreeksPanelProps> = ({ greeks, spotPrice }) => {
    const formatGreek = (value: number, decimals = 0) => {
        if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
        if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'K';
        return value.toFixed(decimals);
    };

    const isTrending = greeks.gexRegime === 'TRENDING';
    const gexColor = isTrending ? 'text-purple-400' : 'text-blue-400';
    const gexBg = isTrending ? 'bg-purple-500/20' : 'bg-blue-500/20';

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Greeks Portfolio</h3>
                <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${gexBg} ${gexColor}`}>
                        {isTrending ? '📈 TRENDING' : '↔️ MEAN REVERTING'}
                    </span>
                    {greeks.gammaSqueezeRisk && (
                        <span className="px-2 py-1 text-xs font-medium text-amber-400 bg-amber-500/20 rounded animate-pulse">
                            🎰 SQUEEZE RISK
                        </span>
                    )}
                </div>
            </div>

            {/* GEX Display */}
            <div className={`p-3 rounded-lg ${gexBg} border border-slate-700/30 mb-4`}>
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs text-slate-500 mb-1">Gamma Exposure (GEX)</div>
                        <div className={`text-2xl font-bold ${gexColor}`}>
                            {greeks.totalGex > 0 ? '+' : ''}{formatGreek(greeks.totalGex)}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-xs text-slate-500 mb-1">Max γ Strike</div>
                        <div className="text-lg font-semibold text-white">₹{greeks.maxGammaStrike.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-500">
                            {((greeks.maxGammaStrike - spotPrice) / spotPrice * 100).toFixed(1)}% from spot
                        </div>
                    </div>
                </div>
                <div className="text-xs text-slate-400 mt-2 p-2 bg-slate-800/50 rounded">
                    {isTrending
                        ? '⚠️ Dealers SHORT gamma - moves will amplify, breakouts will RUN'
                        : '✓ Dealers LONG gamma - moves will dampen, breakouts may fail'
                    }
                </div>
            </div>

            {/* Greeks Grid */}
            <div className="grid grid-cols-4 gap-2 mb-4">
                <div className="p-2 bg-slate-800/50 rounded-lg text-center">
                    <div className="text-[10px] text-slate-500 uppercase">Delta Δ</div>
                    <div className={`text-sm font-semibold ${greeks.netDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {greeks.netDelta > 0 ? '+' : ''}{formatGreek(greeks.netDelta)}
                    </div>
                </div>
                <div className="p-2 bg-slate-800/50 rounded-lg text-center">
                    <div className="text-[10px] text-slate-500 uppercase">Gamma Γ</div>
                    <div className="text-sm font-semibold text-purple-400">
                        {formatGreek(greeks.totalGamma)}
                    </div>
                </div>
                <div className="p-2 bg-slate-800/50 rounded-lg text-center">
                    <div className="text-[10px] text-slate-500 uppercase">Theta Θ</div>
                    <div className="text-sm font-semibold text-amber-400">
                        {formatGreek(greeks.totalTheta)}
                    </div>
                </div>
                <div className="p-2 bg-slate-800/50 rounded-lg text-center">
                    <div className="text-[10px] text-slate-500 uppercase">Vega ν</div>
                    <div className="text-sm font-semibold text-cyan-400">
                        {formatGreek(greeks.totalVega)}
                    </div>
                </div>
            </div>

            {/* Delta Breakdown */}
            <div className="p-3 bg-slate-800/50 rounded-lg">
                <div className="text-xs text-slate-500 mb-2">Delta Breakdown</div>
                <div className="flex items-center gap-2">
                    <div className="flex-1">
                        <div className="flex justify-between text-xs mb-1">
                            <span className="text-amber-400">Calls: {formatGreek(greeks.callDelta)}</span>
                            <span className="text-purple-400">Puts: {formatGreek(greeks.putDelta)}</span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden flex">
                            <div
                                className="h-full bg-amber-400"
                                style={{ width: `${Math.abs(greeks.callDelta) / (Math.abs(greeks.callDelta) + Math.abs(greeks.putDelta)) * 100}%` }}
                            />
                            <div className="h-full bg-purple-400 flex-1" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Gamma Walls */}
            {(greeks.gammaWallUp || greeks.gammaWallDown) && (
                <div className="mt-3 flex items-center justify-between text-xs">
                    {greeks.gammaWallDown && (
                        <div className="flex items-center gap-1 text-red-400">
                            <span>⬇️ Wall:</span>
                            <span className="font-semibold">₹{greeks.gammaWallDown.toLocaleString()}</span>
                        </div>
                    )}
                    {greeks.gammaWallUp && (
                        <div className="flex items-center gap-1 text-emerald-400">
                            <span>⬆️ Wall:</span>
                            <span className="font-semibold">₹{greeks.gammaWallUp.toLocaleString()}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default GreeksPanel;
