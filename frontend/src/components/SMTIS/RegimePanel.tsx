import React from 'react';

type RegimeLevel = 'STRONG_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'STRONG_NEGATIVE';

interface MetricRegime {
    name: string;
    value: number;
    regime: RegimeLevel;
    zScore: number;
    percentile: number;
    flipDetected: boolean;
    flipType?: 'BEARISH_TO_BULLISH' | 'BULLISH_TO_BEARISH';
}

interface RegimePanelProps {
    regimes: MetricRegime[];
    absorptionDetected?: boolean;
    absorptionType?: string;
    liquidityWithdrawal?: boolean;
    informedFlowActive?: boolean;
    informedFlowDirection?: string;
}

const regimeColors: Record<RegimeLevel, { bar: string; text: string; bg: string }> = {
    STRONG_POSITIVE: { bar: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    POSITIVE: { bar: 'bg-emerald-400/60', text: 'text-emerald-400/80', bg: 'bg-emerald-500/5' },
    NEUTRAL: { bar: 'bg-slate-500', text: 'text-slate-400', bg: 'bg-slate-500/10' },
    NEGATIVE: { bar: 'bg-red-400/60', text: 'text-red-400/80', bg: 'bg-red-500/5' },
    STRONG_NEGATIVE: { bar: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-500/10' }
};

const regimeLabels: Record<RegimeLevel, string> = {
    STRONG_POSITIVE: 'STRONG +',
    POSITIVE: 'POSITIVE',
    NEUTRAL: 'NEUTRAL',
    NEGATIVE: 'NEGATIVE',
    STRONG_NEGATIVE: 'STRONG -'
};

export const RegimePanel: React.FC<RegimePanelProps> = ({
    regimes,
    absorptionDetected,
    absorptionType,
    liquidityWithdrawal,
    informedFlowActive,
    informedFlowDirection
}) => {
    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Market Regimes</h3>
                <div className="flex items-center gap-2">
                    {absorptionDetected && (
                        <span className="px-2 py-1 text-xs font-medium text-cyan-400 bg-cyan-500/20 rounded animate-pulse">
                            🧲 {absorptionType || 'ABSORPTION'}
                        </span>
                    )}
                    {liquidityWithdrawal && (
                        <span className="px-2 py-1 text-xs font-medium text-amber-400 bg-amber-500/20 rounded animate-pulse">
                            ⚠️ LIQUIDITY WITHDRAWAL
                        </span>
                    )}
                    {informedFlowActive && (
                        <span className={`px-2 py-1 text-xs font-medium rounded ${informedFlowDirection === 'BULLISH' ? 'text-emerald-400 bg-emerald-500/20' : 'text-red-400 bg-red-500/20'
                            }`}>
                            🎯 INFORMED FLOW
                        </span>
                    )}
                </div>
            </div>

            {/* Regime Bars */}
            <div className="space-y-3">
                {regimes.map((regime, idx) => {
                    const colors = regimeColors[regime.regime];
                    return (
                        <div key={idx} className={`p-2 rounded-lg ${colors.bg}`}>
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-slate-300 uppercase w-20">{regime.name}</span>
                                    {regime.flipDetected && (
                                        <span className="px-1.5 py-0.5 text-[10px] font-bold text-amber-300 bg-amber-500/30 rounded animate-pulse">
                                            🔄 FLIP!
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-medium ${colors.text}`}>
                                        {regimeLabels[regime.regime]}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                        z:{regime.zScore > 0 ? '+' : ''}{regime.zScore.toFixed(1)}
                                    </span>
                                </div>
                            </div>

                            {/* Progress Bar */}
                            <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
                                {/* Center line */}
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-500" />

                                {/* Filled bar */}
                                <div
                                    className={`absolute h-full ${colors.bar} rounded-full transition-all duration-300`}
                                    style={{
                                        left: regime.percentile >= 50 ? '50%' : `${regime.percentile}%`,
                                        width: regime.percentile >= 50 ? `${regime.percentile - 50}%` : `${50 - regime.percentile}%`,
                                    }}
                                />
                            </div>

                            <div className="flex justify-between mt-1">
                                <span className="text-[10px] text-slate-600">0%</span>
                                <span className="text-[10px] text-slate-500">{regime.percentile.toFixed(0)}th pctl</span>
                                <span className="text-[10px] text-slate-600">100%</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default RegimePanel;
