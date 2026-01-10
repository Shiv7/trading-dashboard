import React from 'react';

interface ReversalPanelProps {
    reversalScore: number;  // 0-10
    direction: 'BULLISH' | 'BEARISH' | 'NONE';
    exhaustionType?: 'BUYING_EXHAUSTION' | 'SELLING_EXHAUSTION';
    exhaustionStrength?: number;
    ofiFlipDetected?: boolean;
    ofiFlipMagnitude?: number;
    absorptionDetected?: boolean;
    confluenceZone?: { type: 'SUPPORT' | 'RESISTANCE'; strength: number; price: number };
    signals: string[];
}

export const ReversalPanel: React.FC<ReversalPanelProps> = ({
    reversalScore,
    direction,
    exhaustionType,
    exhaustionStrength,
    ofiFlipDetected,
    ofiFlipMagnitude,
    absorptionDetected,
    confluenceZone,
    signals
}) => {
    const getScoreColor = (score: number) => {
        if (score >= 7) return { text: 'text-emerald-400', bg: 'bg-emerald-500', glow: 'shadow-emerald-500/50' };
        if (score >= 5) return { text: 'text-amber-400', bg: 'bg-amber-500', glow: 'shadow-amber-500/50' };
        if (score >= 3) return { text: 'text-orange-400', bg: 'bg-orange-500', glow: 'shadow-orange-500/50' };
        return { text: 'text-slate-400', bg: 'bg-slate-500', glow: '' };
    };

    const colors = getScoreColor(reversalScore);

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Reversal Detection</h3>
                {direction !== 'NONE' && (
                    <span className={`px-2 py-1 text-xs font-medium rounded ${direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                        {direction === 'BULLISH' ? '🔄📈' : '🔄📉'} {direction}
                    </span>
                )}
            </div>

            {/* Score Gauge */}
            <div className="flex items-center gap-4 mb-4">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center ${colors.glow} shadow-lg`}
                    style={{
                        background: `conic-gradient(${colors.bg.replace('bg-', '')} ${reversalScore * 10}%, transparent 0)`,
                        padding: '4px'
                    }}>
                    <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center">
                        <div className="text-center">
                            <div className={`text-2xl font-bold ${colors.text}`}>{reversalScore.toFixed(1)}</div>
                            <div className="text-[10px] text-slate-500">/10</div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 space-y-2">
                    {/* Exhaustion */}
                    {exhaustionType && (
                        <div className={`flex items-center justify-between p-2 rounded-lg ${exhaustionType === 'SELLING_EXHAUSTION' ? 'bg-emerald-500/10' : 'bg-red-500/10'
                            }`}>
                            <span className="text-xs text-slate-400">
                                {exhaustionType === 'SELLING_EXHAUSTION' ? '😮‍💨 Sell Exhaustion' : '😤 Buy Exhaustion'}
                            </span>
                            <span className={`text-xs font-medium ${exhaustionType === 'SELLING_EXHAUSTION' ? 'text-emerald-400' : 'text-red-400'
                                }`}>
                                {((exhaustionStrength ?? 0) * 100).toFixed(0)}%
                            </span>
                        </div>
                    )}

                    {/* OFI Flip */}
                    {ofiFlipDetected && (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-purple-500/10">
                            <span className="text-xs text-slate-400">🔄 OFI Flip</span>
                            <span className="text-xs font-medium text-purple-400">
                                Mag: {ofiFlipMagnitude?.toLocaleString() ?? 'N/A'}
                            </span>
                        </div>
                    )}

                    {/* Absorption */}
                    {absorptionDetected && (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-cyan-500/10">
                            <span className="text-xs text-slate-400">🧲 Absorption</span>
                            <span className="text-xs font-medium text-cyan-400">Detected</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Confluence Zone */}
            {confluenceZone && (
                <div className={`p-2 rounded-lg mb-3 ${confluenceZone.type === 'SUPPORT' ? 'bg-emerald-500/10 border border-emerald-500/20' :
                    'bg-red-500/10 border border-red-500/20'
                    }`}>
                    <div className="flex items-center justify-between text-xs">
                        <span className={confluenceZone.type === 'SUPPORT' ? 'text-emerald-400' : 'text-red-400'}>
                            📍 At {confluenceZone.type}
                        </span>
                        <span className="text-slate-300">
                            ₹{confluenceZone.price.toFixed(2)} (Str: {confluenceZone.strength.toFixed(1)})
                        </span>
                    </div>
                </div>
            )}

            {/* Contributing Signals */}
            {signals.length > 0 && (
                <div>
                    <div className="text-[10px] text-slate-500 uppercase mb-2">Contributing Signals</div>
                    <div className="flex flex-wrap gap-1">
                        {signals.map((signal, idx) => (
                            <span key={idx} className="px-2 py-1 text-xs bg-slate-700/50 text-slate-300 rounded">
                                {signal.replace(/_/g, ' ')}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReversalPanel;
