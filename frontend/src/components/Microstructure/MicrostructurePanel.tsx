import React from 'react';

interface MicrostructureData {
    ofi: number;
    ofiZScore: number;
    ofiRegime: 'STRONG_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'STRONG_NEGATIVE';
    vpin: number;
    vpinRegime: 'HIGH_TOXIC' | 'MODERATE' | 'LOW';
    kyleLambda: number;
    lambdaZScore: number;
    depthImbalance: number;
    buyPressure: number;
    sellPressure: number;
    spread: number;
    spreadZScore: number;
}

interface MicrostructurePanelProps {
    data: MicrostructureData;
    absorptionDetected?: boolean;
    liquidityWithdrawal?: boolean;
}

export const MicrostructurePanel: React.FC<MicrostructurePanelProps> = ({
    data,
    absorptionDetected,
    liquidityWithdrawal
}) => {
    const getOFIColor = () => {
        switch (data.ofiRegime) {
            case 'STRONG_POSITIVE': return { text: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/50' };
            case 'POSITIVE': return { text: 'text-emerald-400/80', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
            case 'NEUTRAL': return { text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30' };
            case 'NEGATIVE': return { text: 'text-red-400/80', bg: 'bg-red-500/10', border: 'border-red-500/30' };
            case 'STRONG_NEGATIVE': return { text: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/50' };
        }
    };

    const getVPINColor = () => {
        if (data.vpin >= 0.7) return { text: 'text-red-400', bg: 'bg-red-500/20', label: 'HIGH TOXIC' };
        if (data.vpin >= 0.5) return { text: 'text-amber-400', bg: 'bg-amber-500/20', label: 'MODERATE' };
        return { text: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'LOW' };
    };

    const ofiColors = getOFIColor();
    const vpinColors = getVPINColor();

    const totalPressure = data.buyPressure + data.sellPressure;
    const buyPercent = totalPressure > 0 ? (data.buyPressure / totalPressure) * 100 : 50;

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Microstructure</h3>
                <div className="flex items-center gap-2">
                    {absorptionDetected && (
                        <span className="px-2 py-1 text-xs font-medium text-cyan-400 bg-cyan-500/20 rounded animate-pulse">
                            🧲 ABSORPTION
                        </span>
                    )}
                    {liquidityWithdrawal && (
                        <span className="px-2 py-1 text-xs font-medium text-amber-400 bg-amber-500/20 rounded animate-pulse">
                            ⚠️ LIQ EXIT
                        </span>
                    )}
                </div>
            </div>

            {/* Main Gauges Grid */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                {/* OFI Gauge */}
                <div className={`p-3 rounded-lg ${ofiColors.bg} border ${ofiColors.border}`}>
                    <div className="text-xs text-slate-500 mb-1">Order Flow Imbalance</div>
                    <div className="flex items-baseline justify-between">
                        <span className={`text-2xl font-bold ${ofiColors.text}`}>
                            {data.ofi > 0 ? '+' : ''}{data.ofi.toLocaleString()}
                        </span>
                        <span className="text-xs text-slate-500">z:{data.ofiZScore.toFixed(1)}</span>
                    </div>
                    <div className={`text-xs font-medium mt-1 ${ofiColors.text}`}>
                        {data.ofiRegime.replace(/_/g, ' ')}
                    </div>
                </div>

                {/* VPIN Gauge */}
                <div className={`p-3 rounded-lg ${vpinColors.bg} border border-slate-700/30`}>
                    <div className="text-xs text-slate-500 mb-1">VPIN (Informed Flow)</div>
                    <div className="flex items-baseline justify-between">
                        <span className={`text-2xl font-bold ${vpinColors.text}`}>
                            {(data.vpin * 100).toFixed(0)}%
                        </span>
                    </div>
                    <div className={`text-xs font-medium mt-1 ${vpinColors.text}`}>
                        {vpinColors.label}
                    </div>
                    {/* VPIN Bar */}
                    <div className="h-2 bg-slate-700 rounded-full mt-2 overflow-hidden">
                        <div
                            className={`h-full transition-all ${data.vpin >= 0.7 ? 'bg-red-400' : data.vpin >= 0.5 ? 'bg-amber-400' : 'bg-emerald-400'
                                }`}
                            style={{ width: `${data.vpin * 100}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Secondary Metrics */}
            <div className="grid grid-cols-3 gap-3 mb-4">
                {/* Kyle Lambda */}
                <div className="p-2 bg-slate-800/50 rounded-lg text-center">
                    <div className="text-[10px] text-slate-500 uppercase">Kyle λ</div>
                    <div className={`text-sm font-semibold ${data.lambdaZScore < -1 ? 'text-cyan-400' : data.lambdaZScore > 1 ? 'text-amber-400' : 'text-slate-300'
                        }`}>
                        {data.kyleLambda.toFixed(4)}
                    </div>
                    <div className="text-[10px] text-slate-500">z:{data.lambdaZScore.toFixed(1)}</div>
                </div>

                {/* Depth Imbalance */}
                <div className="p-2 bg-slate-800/50 rounded-lg text-center">
                    <div className="text-[10px] text-slate-500 uppercase">Depth Imb</div>
                    <div className={`text-sm font-semibold ${data.depthImbalance > 0.3 ? 'text-emerald-400' : data.depthImbalance < -0.3 ? 'text-red-400' : 'text-slate-300'
                        }`}>
                        {data.depthImbalance > 0 ? '+' : ''}{(data.depthImbalance * 100).toFixed(0)}%
                    </div>
                </div>

                {/* Spread */}
                <div className="p-2 bg-slate-800/50 rounded-lg text-center">
                    <div className="text-[10px] text-slate-500 uppercase">Spread</div>
                    <div className={`text-sm font-semibold ${data.spreadZScore > 1.5 ? 'text-amber-400' : 'text-slate-300'
                        }`}>
                        ₹{data.spread.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-500">z:{data.spreadZScore.toFixed(1)}</div>
                </div>
            </div>

            {/* Buy/Sell Pressure Bar */}
            <div>
                <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-emerald-400">Buy {buyPercent.toFixed(0)}%</span>
                    <span className="text-slate-500">Pressure</span>
                    <span className="text-red-400">Sell {(100 - buyPercent).toFixed(0)}%</span>
                </div>
                <div className="h-3 bg-slate-700 rounded-full overflow-hidden flex">
                    <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
                        style={{ width: `${buyPercent}%` }}
                    />
                    <div
                        className="h-full bg-gradient-to-r from-red-400 to-red-500"
                        style={{ width: `${100 - buyPercent}%` }}
                    />
                </div>
            </div>
        </div>
    );
};

export default MicrostructurePanel;
