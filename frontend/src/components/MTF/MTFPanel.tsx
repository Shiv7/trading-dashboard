import React, { useState } from 'react';

type TimeframeKey = '1m' | '2m' | '3m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D';
type BiasDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

interface TimeframeData {
    timeframe: TimeframeKey;
    bias: BiasDirection;
    strength: number;  // 0-1
    superTrendDirection?: 'BULLISH' | 'BEARISH';
    ofiRegime?: string;
    volumeRegime?: string;
    bbPosition?: string;
    vwapDistance?: number;
}

interface MTFPanelProps {
    data: TimeframeData[];
    ltfConsensus?: BiasDirection;
    mtfConsensus?: BiasDirection;
    htfConsensus?: BiasDirection;
    alignmentScore?: number;
    recommendedHorizon?: 'SCALP' | 'SWING' | 'POSITIONAL';
}

const timeframeOrder: TimeframeKey[] = ['1m', '2m', '3m', '5m', '15m', '30m', '1H', '4H', '1D'];

export const MTFPanel: React.FC<MTFPanelProps> = ({
    data,
    ltfConsensus,
    mtfConsensus,
    htfConsensus,
    alignmentScore,
    recommendedHorizon
}) => {
    const [expandedTf, setExpandedTf] = useState<TimeframeKey | null>(null);

    const getBiasColor = (bias: BiasDirection) => {
        switch (bias) {
            case 'BULLISH': return { text: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30' };
            case 'BEARISH': return { text: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30' };
            default: return { text: 'text-slate-400', bg: 'bg-slate-500/20', border: 'border-slate-500/30' };
        }
    };

    const dataMap = new Map(data.map(d => [d.timeframe, d]));

    const ConsensusBox: React.FC<{ label: string; consensus?: BiasDirection }> = ({ label, consensus }) => {
        if (!consensus) return null;
        const colors = getBiasColor(consensus);
        return (
            <div className={`px-2 py-1 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
                {label}: {consensus}
            </div>
        );
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Multi-Timeframe Analysis</h3>
                <div className="flex items-center gap-2">
                    {alignmentScore !== undefined && (
                        <div className={`px-2 py-1 rounded text-xs font-medium ${alignmentScore >= 0.8 ? 'bg-emerald-500/20 text-emerald-400' :
                            alignmentScore >= 0.5 ? 'bg-amber-500/20 text-amber-400' :
                                'bg-red-500/20 text-red-400'
                            }`}>
                            Alignment: {(alignmentScore * 100).toFixed(0)}%
                        </div>
                    )}
                    {recommendedHorizon && (
                        <div className="px-2 py-1 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
                            → {recommendedHorizon}
                        </div>
                    )}
                </div>
            </div>

            {/* Consensus Row */}
            <div className="flex items-center gap-2 mb-4">
                <ConsensusBox label="LTF" consensus={ltfConsensus} />
                <ConsensusBox label="MTF" consensus={mtfConsensus} />
                <ConsensusBox label="HTF" consensus={htfConsensus} />
            </div>

            {/* Timeframe Grid */}
            <div className="grid grid-cols-9 gap-1">
                {timeframeOrder.map(tf => {
                    const tfData = dataMap.get(tf);
                    if (!tfData) return (
                        <div key={tf} className="p-2 bg-slate-800/30 rounded text-center">
                            <div className="text-[10px] text-slate-600">{tf}</div>
                            <div className="text-xs text-slate-600">-</div>
                        </div>
                    );

                    const colors = getBiasColor(tfData.bias);
                    const isExpanded = expandedTf === tf;

                    return (
                        <div key={tf}>
                            <button
                                onClick={() => setExpandedTf(isExpanded ? null : tf)}
                                className={`w-full p-2 rounded-lg ${colors.bg} border ${colors.border} transition-all hover:scale-105`}
                            >
                                <div className="text-[10px] text-slate-400 mb-1">{tf}</div>
                                <div className={`text-sm font-bold ${colors.text}`}>
                                    {tfData.bias === 'BULLISH' ? '▲' : tfData.bias === 'BEARISH' ? '▼' : '●'}
                                </div>
                                {/* Strength bar */}
                                <div className="h-1 bg-slate-700 rounded-full mt-1 overflow-hidden">
                                    <div
                                        className={`h-full ${colors.bg.replace('/20', '')}`}
                                        style={{ width: `${tfData.strength * 100}%` }}
                                    />
                                </div>
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Expanded Details */}
            {expandedTf && dataMap.get(expandedTf) && (
                <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <div className="text-sm font-medium text-white mb-2">{expandedTf} Details</div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                        {dataMap.get(expandedTf)!.superTrendDirection && (
                            <div>
                                <span className="text-slate-500">SuperTrend:</span>
                                <span className={`ml-1 ${dataMap.get(expandedTf)!.superTrendDirection === 'BULLISH'
                                    ? 'text-emerald-400' : 'text-red-400'
                                    }`}>
                                    {dataMap.get(expandedTf)!.superTrendDirection}
                                </span>
                            </div>
                        )}
                        {dataMap.get(expandedTf)!.ofiRegime && (
                            <div>
                                <span className="text-slate-500">OFI:</span>
                                <span className="text-slate-300 ml-1">{dataMap.get(expandedTf)!.ofiRegime}</span>
                            </div>
                        )}
                        {dataMap.get(expandedTf)!.bbPosition && (
                            <div>
                                <span className="text-slate-500">BB:</span>
                                <span className="text-slate-300 ml-1">{dataMap.get(expandedTf)!.bbPosition}</span>
                            </div>
                        )}
                        {dataMap.get(expandedTf)!.vwapDistance !== undefined && (
                            <div>
                                <span className="text-slate-500">VWAP:</span>
                                <span className={`ml-1 ${dataMap.get(expandedTf)!.vwapDistance! > 0 ? 'text-emerald-400' : 'text-red-400'
                                    }`}>
                                    {dataMap.get(expandedTf)!.vwapDistance! > 0 ? '+' : ''}
                                    {dataMap.get(expandedTf)!.vwapDistance!.toFixed(2)}%
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MTFPanel;
