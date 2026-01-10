import React from 'react';

interface IVSummary {
    atmIV: number;
    ivRank: number;  // 0-100
    ivPercentile: number;
    ivSignal: 'HIGH' | 'LOW' | 'NORMAL';
    ivVelocity: number;
    atmCallIV: number;
    atmPutIV: number;
    ivSkew: number;
    ivSkewZScore: number;
    ivSkewTrend: 'RISING' | 'STABLE' | 'FALLING';
    termStructure: 'CONTANGO' | 'BACKWARDATION' | 'FLAT';
    nearTermIV?: number;
    farTermIV?: number;
    recommendedStrategy?: string;
}

interface IVSurfacePanelProps {
    data: IVSummary;
}

export const IVSurfacePanel: React.FC<IVSurfacePanelProps> = ({ data }) => {
    const getIVRankColor = (rank: number) => {
        if (rank >= 70) return { text: 'text-red-400', bg: 'bg-red-500/20', label: 'HIGH' };
        if (rank <= 30) return { text: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'LOW' };
        return { text: 'text-amber-400', bg: 'bg-amber-500/20', label: 'NORMAL' };
    };

    const ivRankStyle = getIVRankColor(data.ivRank);

    const getSkewInterpretation = () => {
        if (data.ivSkewZScore > 2) return { text: 'Extreme Fear', color: 'text-red-400', contrarian: 'Contrarian: LONG' };
        if (data.ivSkewZScore < -2) return { text: 'Extreme Greed', color: 'text-emerald-400', contrarian: 'Contrarian: SHORT' };
        if (data.ivSkew > 0) return { text: 'Put Premium', color: 'text-amber-400', contrarian: null };
        return { text: 'Call Premium', color: 'text-cyan-400', contrarian: null };
    };

    const skewInfo = getSkewInterpretation();

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">IV Surface</h3>
                <span className={`px-2 py-1 text-xs font-medium rounded ${ivRankStyle.bg} ${ivRankStyle.text}`}>
                    IV Rank: {data.ivRank}%
                </span>
            </div>

            {/* Main IV Display */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className={`p-3 rounded-lg ${ivRankStyle.bg} border border-slate-700/30`}>
                    <div className="text-xs text-slate-500 mb-1">ATM Implied Volatility</div>
                    <div className={`text-2xl font-bold ${ivRankStyle.text}`}>
                        {data.atmIV.toFixed(1)}%
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                        Velocity: {data.ivVelocity > 0 ? '+' : ''}{data.ivVelocity.toFixed(2)}%
                    </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/30">
                    <div className="text-xs text-slate-500 mb-1">IV Percentile</div>
                    <div className="text-2xl font-bold text-white">{data.ivPercentile}%</div>
                    <div className="h-2 bg-slate-700 rounded-full mt-2 overflow-hidden">
                        <div
                            className={`h-full ${data.ivPercentile >= 70 ? 'bg-red-400' :
                                    data.ivPercentile <= 30 ? 'bg-emerald-400' : 'bg-amber-400'
                                }`}
                            style={{ width: `${data.ivPercentile}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Call vs Put IV */}
            <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20 text-center">
                    <div className="text-[10px] text-amber-400/70">ATM Call IV</div>
                    <div className="text-lg font-semibold text-amber-400">{data.atmCallIV.toFixed(1)}%</div>
                </div>
                <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/20 text-center">
                    <div className="text-[10px] text-purple-400/70">ATM Put IV</div>
                    <div className="text-lg font-semibold text-purple-400">{data.atmPutIV.toFixed(1)}%</div>
                </div>
            </div>

            {/* IV Skew */}
            <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/30 mb-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">IV Skew (Put-Call)</span>
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${skewInfo.color}`}>
                            {data.ivSkew > 0 ? '+' : ''}{data.ivSkew.toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-slate-500">
                            z:{data.ivSkewZScore.toFixed(1)}
                        </span>
                    </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                    <span className={skewInfo.color}>{skewInfo.text}</span>
                    <span className={`text-xs ${data.ivSkewTrend === 'RISING' ? 'text-red-400' :
                            data.ivSkewTrend === 'FALLING' ? 'text-emerald-400' : 'text-slate-400'
                        }`}>
                        {data.ivSkewTrend === 'RISING' ? '↑' : data.ivSkewTrend === 'FALLING' ? '↓' : '→'} {data.ivSkewTrend}
                    </span>
                </div>
                {skewInfo.contrarian && (
                    <div className="mt-2 px-2 py-1 bg-slate-700/50 rounded text-xs text-amber-400">
                        💡 {skewInfo.contrarian}
                    </div>
                )}
            </div>

            {/* Term Structure */}
            <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                <span className="text-xs text-slate-500">Term Structure:</span>
                <span className={`text-xs font-medium ${data.termStructure === 'CONTANGO' ? 'text-emerald-400' :
                        data.termStructure === 'BACKWARDATION' ? 'text-red-400' : 'text-slate-400'
                    }`}>
                    {data.termStructure}
                    {data.nearTermIV && data.farTermIV && (
                        <span className="text-slate-500 ml-1">
                            ({data.nearTermIV.toFixed(0)}% → {data.farTermIV.toFixed(0)}%)
                        </span>
                    )}
                </span>
            </div>

            {/* Recommended Strategy */}
            {data.recommendedStrategy && (
                <div className="mt-3 p-2 bg-purple-500/10 rounded-lg border border-purple-500/20">
                    <span className="text-xs text-purple-400">
                        📊 Recommended: {data.recommendedStrategy}
                    </span>
                </div>
            )}
        </div>
    );
};

export default IVSurfacePanel;
