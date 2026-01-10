import React from 'react';

type SessionName =
    | 'PRE_MARKET'
    | 'OPENING_AUCTION'
    | 'OPENING_RANGE'
    | 'MORNING_TREND'
    | 'LUNCH_CHOP'
    | 'AFTERNOON'
    | 'POWER_HOUR';

type ExpiryPhase = 'FAR' | 'APPROACH' | 'NEAR' | 'EXPIRY_WEEK' | 'EXPIRY_DAY';

interface SessionBadgeProps {
    sessionName: SessionName;
    sessionQuality: number;  // 0-1
    isPrimeSession?: boolean;
}

interface ExpiryPhaseBadgeProps {
    expiryPhase: ExpiryPhase;
    daysToExpiry: number;
    oiSignalWeight?: number;
    gammaSignalWeight?: number;
}

const sessionConfig: Record<SessionName, { icon: string; color: string; bg: string; label: string }> = {
    PRE_MARKET: { icon: '🌙', color: 'text-slate-400', bg: 'bg-slate-700', label: 'Pre-Market' },
    OPENING_AUCTION: { icon: '🔔', color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Opening' },
    OPENING_RANGE: { icon: '📊', color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Opening Range' },
    MORNING_TREND: { icon: '🚀', color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'Morning Trend' },
    LUNCH_CHOP: { icon: '🍕', color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Lunch Chop' },
    AFTERNOON: { icon: '☀️', color: 'text-cyan-400', bg: 'bg-cyan-500/20', label: 'Afternoon' },
    POWER_HOUR: { icon: '⚡', color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Power Hour' }
};

const expiryConfig: Record<ExpiryPhase, { icon: string; color: string; bg: string; label: string }> = {
    FAR: { icon: '📅', color: 'text-slate-400', bg: 'bg-slate-700', label: 'Far' },
    APPROACH: { icon: '📆', color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Approaching' },
    NEAR: { icon: '⏰', color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Near' },
    EXPIRY_WEEK: { icon: '⚠️', color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Expiry Week' },
    EXPIRY_DAY: { icon: '🔥', color: 'text-red-400', bg: 'bg-red-500/20', label: 'EXPIRY DAY' }
};

export const SessionBadge: React.FC<SessionBadgeProps> = ({
    sessionName,
    sessionQuality,
    isPrimeSession
}) => {
    const config = sessionConfig[sessionName] || sessionConfig.MORNING_TREND;

    return (
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${config.bg} border border-slate-700/50`}>
            <span>{config.icon}</span>
            <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
            <div className="flex items-center gap-1 ml-1">
                <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full ${sessionQuality > 0.7 ? 'bg-emerald-400' : sessionQuality > 0.4 ? 'bg-amber-400' : 'bg-red-400'} rounded-full transition-all`}
                        style={{ width: `${sessionQuality * 100}%` }}
                    />
                </div>
                <span className="text-xs text-slate-500">{(sessionQuality * 100).toFixed(0)}%</span>
            </div>
            {isPrimeSession && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/20 rounded">PRIME</span>
            )}
        </div>
    );
};

export const ExpiryPhaseBadge: React.FC<ExpiryPhaseBadgeProps> = ({
    expiryPhase,
    daysToExpiry,
    oiSignalWeight,
    gammaSignalWeight
}) => {
    const config = expiryConfig[expiryPhase] || expiryConfig.FAR;

    return (
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${config.bg} border border-slate-700/50`}>
            <span>{config.icon}</span>
            <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
            <span className="text-xs text-slate-500">
                {daysToExpiry === 0 ? 'Today' : `${daysToExpiry}D`}
            </span>
            {(oiSignalWeight !== undefined || gammaSignalWeight !== undefined) && (
                <div className="flex items-center gap-2 ml-1 pl-2 border-l border-slate-700">
                    {oiSignalWeight !== undefined && (
                        <span className="text-xs text-slate-400">
                            OI: <span className={oiSignalWeight < 0.5 ? 'text-red-400' : 'text-slate-300'}>{(oiSignalWeight * 100).toFixed(0)}%</span>
                        </span>
                    )}
                    {gammaSignalWeight !== undefined && (
                        <span className="text-xs text-slate-400">
                            γ: <span className={gammaSignalWeight > 1.5 ? 'text-amber-400' : 'text-slate-300'}>{gammaSignalWeight.toFixed(1)}x</span>
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

export default SessionBadge;
