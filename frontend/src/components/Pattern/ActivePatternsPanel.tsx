import React from 'react';

type PatternStatus = 'STARTED' | 'PROGRESSING' | 'COMPLETED' | 'INVALIDATED' | 'EXPIRED';
type PatternCategory = 'REVERSAL' | 'CONTINUATION' | 'BREAKOUT' | 'SQUEEZE' | 'EXHAUSTION';

interface ActivePattern {
    sequenceId: string;
    templateId: string;
    familyId: string;
    symbol: string;
    status: PatternStatus;
    category: PatternCategory;
    direction: 'BULLISH' | 'BEARISH';
    progress: number;  // 0-100
    matchedEventsCount: number;
    totalRequiredEvents: number;
    currentConfidence: number;
    expiresAt: number;
    startPrice: number;
    currentPrice: number;
    matchedEvents: string[];
}

interface ActivePatternsPanelProps {
    patterns: ActivePattern[];
    onPatternClick?: (pattern: ActivePattern) => void;
}

const patternIcons: Record<string, string> = {
    REVERSAL_FROM_SUPPORT: '🔄📈',
    REVERSAL_FROM_RESISTANCE: '🔄📉',
    GAMMA_SQUEEZE_LONG: '🎰🚀',
    BREAKOUT_CONFIRMATION: '🚀💥',
    TREND_CONTINUATION: '📈➡️'
};

const categoryColors: Record<PatternCategory, { bg: string; border: string; text: string }> = {
    REVERSAL: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400' },
    CONTINUATION: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400' },
    BREAKOUT: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' },
    SQUEEZE: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400' },
    EXHAUSTION: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' }
};

const statusColors: Record<PatternStatus, { bg: string; text: string }> = {
    STARTED: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    PROGRESSING: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
    COMPLETED: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
    INVALIDATED: { bg: 'bg-red-500/20', text: 'text-red-400' },
    EXPIRED: { bg: 'bg-slate-500/20', text: 'text-slate-400' }
};

export const ActivePatternsPanel: React.FC<ActivePatternsPanelProps> = ({ patterns, onPatternClick }) => {
    const activePatterns = patterns.filter(p => p.status === 'STARTED' || p.status === 'PROGRESSING');
    const completedPatterns = patterns.filter(p => p.status === 'COMPLETED');

    const formatTime = (timestamp: number) => {
        const now = Date.now();
        const diff = timestamp - now;
        if (diff <= 0) return 'Expired';
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m`;
        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Active Patterns</h3>
                <div className="flex items-center gap-2">
                    <span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-400 rounded">
                        {activePatterns.length} Active
                    </span>
                    {completedPatterns.length > 0 && (
                        <span className="px-2 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-400 rounded">
                            {completedPatterns.length} Triggered
                        </span>
                    )}
                </div>
            </div>

            {/* Patterns List */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
                {patterns.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm">No active patterns</div>
                ) : (
                    patterns.map((pattern) => {
                        const catColors = categoryColors[pattern.category];
                        const statusColor = statusColors[pattern.status];
                        const priceChange = ((pattern.currentPrice - pattern.startPrice) / pattern.startPrice) * 100;

                        return (
                            <button
                                key={pattern.sequenceId}
                                onClick={() => onPatternClick?.(pattern)}
                                className={`w-full p-3 rounded-lg ${catColors.bg} border ${catColors.border} hover:scale-[1.02] transition-all text-left`}
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">{patternIcons[pattern.templateId] || '📊'}</span>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-white">
                                                    {pattern.templateId.replace(/_/g, ' ')}
                                                </span>
                                                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${pattern.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                                                    }`}>
                                                    {pattern.direction}
                                                </span>
                                            </div>
                                            <span className="text-xs text-slate-500">{pattern.symbol}</span>
                                        </div>
                                    </div>
                                    <div className={`px-2 py-1 rounded text-xs font-medium ${statusColor.bg} ${statusColor.text}`}>
                                        {pattern.status === 'COMPLETED' ? '✅ TRIGGERED' : pattern.status}
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="mb-2">
                                    <div className="flex items-center justify-between text-xs mb-1">
                                        <span className="text-slate-500">
                                            {pattern.matchedEventsCount}/{pattern.totalRequiredEvents} events
                                        </span>
                                        <span className="text-slate-400">{pattern.progress.toFixed(0)}%</span>
                                    </div>
                                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${pattern.status === 'COMPLETED' ? 'bg-emerald-400' :
                                                    pattern.status === 'INVALIDATED' ? 'bg-red-400' :
                                                        catColors.text.replace('text-', 'bg-')
                                                } transition-all`}
                                            style={{ width: `${pattern.progress}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Bottom Stats */}
                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-3">
                                        <span className="text-slate-500">
                                            Conf: <span className={catColors.text}>{(pattern.currentConfidence * 100).toFixed(0)}%</span>
                                        </span>
                                        <span className={priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                                        </span>
                                    </div>
                                    {pattern.status !== 'COMPLETED' && pattern.status !== 'INVALIDATED' && (
                                        <span className="text-slate-500">⏰ {formatTime(pattern.expiresAt)}</span>
                                    )}
                                </div>

                                {/* Matched Events */}
                                {pattern.matchedEvents.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {pattern.matchedEvents.map((evt, idx) => (
                                            <span key={idx} className="px-1.5 py-0.5 text-[10px] bg-slate-700/50 text-slate-400 rounded">
                                                ✓ {evt.replace(/_/g, ' ')}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default ActivePatternsPanel;
