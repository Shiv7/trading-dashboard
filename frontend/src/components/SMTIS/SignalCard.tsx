import React from 'react';

type SignalHorizon = 'SCALP' | 'SWING' | 'POSITIONAL';
type SignalDirection = 'LONG' | 'SHORT';

interface SignalModifiers {
    timeModifier: number;
    expiryModifier: number;
    gexModifier: number;
    vpinModifier: number;
    lambdaModifier: number;
    mtfModifier: number;
}

interface TradingSignal {
    signalId: string;
    familyId: string;
    symbol: string;
    timestamp: number;
    horizon: SignalHorizon;
    direction: SignalDirection;
    signalType: string;
    confidence: number;
    entryPrice: number;
    entryReasons: string[];
    stopLoss: number;
    target1: number;
    target2?: number;
    riskReward: number;
    supportingEvents: string[];
    modifiers: SignalModifiers;
    gexRegime?: string;
    session?: string;
    mtfAlignment?: string;
    recommendedSize: number;
    validUntil: number;
}

interface SignalCardProps {
    signal: TradingSignal;
    onTrade?: (signal: TradingSignal) => void;
}

const horizonConfig: Record<SignalHorizon, { color: string; bg: string; label: string }> = {
    SCALP: { color: 'text-cyan-400', bg: 'bg-cyan-500/20', label: '⚡ SCALP' },
    SWING: { color: 'text-purple-400', bg: 'bg-purple-500/20', label: '🌊 SWING' },
    POSITIONAL: { color: 'text-amber-400', bg: 'bg-amber-500/20', label: '📈 POSITIONAL' }
};

export const SignalCard: React.FC<SignalCardProps> = ({ signal, onTrade }) => {
    const horizon = horizonConfig[signal.horizon];
    const isLong = signal.direction === 'LONG';

    const riskPercent = ((signal.entryPrice - signal.stopLoss) / signal.entryPrice * 100);
    const rewardPercent = ((signal.target1 - signal.entryPrice) / signal.entryPrice * 100);

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getConfidenceColor = (conf: number) => {
        if (conf >= 0.8) return 'text-emerald-400';
        if (conf >= 0.7) return 'text-yellow-400';
        if (conf >= 0.6) return 'text-amber-400';
        return 'text-red-400';
    };

    const getModifierColor = (mod: number) => {
        if (mod >= 1.1) return 'text-emerald-400';
        if (mod >= 0.9) return 'text-slate-300';
        return 'text-red-400';
    };

    return (
        <div className={`bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl border ${isLong ? 'border-emerald-500/30' : 'border-red-500/30'
            } overflow-hidden`}>
            {/* Header */}
            <div className={`px-4 py-3 ${isLong ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className={`text-2xl ${isLong ? '' : 'rotate-180'}`}>
                            {isLong ? '🚀' : '📉'}
                        </span>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className={`text-lg font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {signal.direction}
                                </span>
                                <span className="text-white font-semibold">{signal.symbol}</span>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded ${horizon.bg} ${horizon.color}`}>
                                {horizon.label}
                            </span>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className={`text-2xl font-bold ${getConfidenceColor(signal.confidence)}`}>
                            {(signal.confidence * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-slate-500">Confidence</div>
                    </div>
                </div>
            </div>

            {/* Trade Parameters */}
            <div className="p-4">
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center p-2 bg-slate-800/50 rounded-lg">
                        <div className="text-xs text-slate-500 mb-1">Entry</div>
                        <div className="text-lg font-semibold text-white">₹{signal.entryPrice.toFixed(2)}</div>
                    </div>
                    <div className="text-center p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                        <div className="text-xs text-red-400/70 mb-1">Stop Loss</div>
                        <div className="text-lg font-semibold text-red-400">₹{signal.stopLoss.toFixed(2)}</div>
                        <div className="text-[10px] text-red-400/50">-{Math.abs(riskPercent).toFixed(2)}%</div>
                    </div>
                    <div className="text-center p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                        <div className="text-xs text-emerald-400/70 mb-1">Target 1</div>
                        <div className="text-lg font-semibold text-emerald-400">₹{signal.target1.toFixed(2)}</div>
                        <div className="text-[10px] text-emerald-400/50">+{rewardPercent.toFixed(2)}%</div>
                    </div>
                </div>

                {/* R:R Badge */}
                <div className="flex items-center justify-center mb-4">
                    <div className="px-4 py-2 bg-slate-700/50 rounded-lg">
                        <span className="text-sm text-slate-400">Risk:Reward</span>
                        <span className={`ml-2 text-lg font-bold ${signal.riskReward >= 2 ? 'text-emerald-400' :
                                signal.riskReward >= 1.5 ? 'text-yellow-400' : 'text-amber-400'
                            }`}>
                            1:{signal.riskReward.toFixed(1)}
                        </span>
                    </div>
                </div>

                {/* Entry Reasons */}
                <div className="mb-4">
                    <div className="text-xs text-slate-500 mb-2">Entry Reasons:</div>
                    <div className="flex flex-wrap gap-1">
                        {signal.entryReasons.map((reason, idx) => (
                            <span
                                key={idx}
                                className="px-2 py-1 text-xs bg-slate-700/50 text-slate-300 rounded"
                            >
                                {reason.replace(/_/g, ' ')}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Context */}
                <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
                    {signal.gexRegime && (
                        <div className={`px-2 py-1 rounded text-center ${signal.gexRegime === 'TRENDING' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                            }`}>
                            GEX: {signal.gexRegime}
                        </div>
                    )}
                    {signal.session && (
                        <div className="px-2 py-1 rounded bg-slate-700/50 text-slate-300 text-center">
                            {signal.session.replace(/_/g, ' ')}
                        </div>
                    )}
                    {signal.mtfAlignment && (
                        <div className={`px-2 py-1 rounded text-center ${signal.mtfAlignment.includes('ALIGNED') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                            }`}>
                            {signal.mtfAlignment.replace(/_/g, ' ')}
                        </div>
                    )}
                </div>

                {/* Modifiers */}
                <div className="mb-4">
                    <div className="text-xs text-slate-500 mb-2">Confidence Modifiers:</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Time:</span>
                            <span className={getModifierColor(signal.modifiers.timeModifier)}>
                                {signal.modifiers.timeModifier.toFixed(2)}x
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">GEX:</span>
                            <span className={getModifierColor(signal.modifiers.gexModifier)}>
                                {signal.modifiers.gexModifier.toFixed(2)}x
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">MTF:</span>
                            <span className={getModifierColor(signal.modifiers.mtfModifier)}>
                                {signal.modifiers.mtfModifier.toFixed(2)}x
                            </span>
                        </div>
                    </div>
                </div>

                {/* Position Size */}
                <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg mb-4">
                    <span className="text-xs text-slate-500">Recommended Size:</span>
                    <span className={`text-sm font-semibold ${signal.recommendedSize >= 1 ? 'text-emerald-400' :
                            signal.recommendedSize >= 0.5 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                        {(signal.recommendedSize * 100).toFixed(0)}% of normal
                    </span>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                    <button
                        onClick={() => onTrade?.(signal)}
                        className={`flex-1 py-2 rounded-lg font-semibold transition-all ${isLong
                                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                                : 'bg-red-500 hover:bg-red-600 text-white'
                            }`}
                    >
                        Trade {signal.direction}
                    </button>
                    <button className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all">
                        📋
                    </button>
                </div>

                {/* Valid Until */}
                <div className="text-center text-[10px] text-slate-500 mt-2">
                    Valid until {formatTime(signal.validUntil)}
                </div>
            </div>
        </div>
    );
};

export default SignalCard;
