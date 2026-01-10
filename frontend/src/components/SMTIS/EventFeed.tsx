import React from 'react';

type EventStatus = 'DETECTED' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';
type EventCategory = 'MICROSTRUCTURE' | 'TECHNICAL' | 'OPTIONS' | 'PRICE';

interface DetectedEvent {
    eventId: string;
    eventType: string;
    category: EventCategory;
    status: EventStatus;
    detectedAt: number;
    expectedDirection: 'BULLISH' | 'BEARISH';
    details?: Record<string, unknown>;
    priceAtDetection: number;
    confirmationWindowMs?: number;
}

interface EventFeedProps {
    events: DetectedEvent[];
    maxEvents?: number;
}

const eventTypeLabels: Record<string, { icon: string; label: string }> = {
    OFI_FLIP: { icon: '🔄', label: 'OFI Flip' },
    VOLUME_DELTA_FLIP: { icon: '📊', label: 'Volume Flip' },
    SELLING_EXHAUSTION: { icon: '😮‍💨', label: 'Sell Exhaustion' },
    BUYING_EXHAUSTION: { icon: '😤', label: 'Buy Exhaustion' },
    ABSORPTION: { icon: '🧲', label: 'Absorption' },
    LIQUIDITY_WITHDRAWAL: { icon: '💨', label: 'Liquidity Exit' },
    SWEEP: { icon: '🧹', label: 'Level Sweep' },
    SUPERTREND_FLIP: { icon: '📈', label: 'ST Flip' },
    BB_UPPER_TOUCH: { icon: '⬆️', label: 'BB Upper' },
    BB_LOWER_TOUCH: { icon: '⬇️', label: 'BB Lower' },
    BB_SQUEEZE_START: { icon: '🤏', label: 'BB Squeeze' },
    PIVOT_TEST: { icon: '📍', label: 'Pivot Test' },
    CALL_OI_SURGE: { icon: '📞', label: 'Call OI Surge' },
    PUT_OI_SURGE: { icon: '📴', label: 'Put OI Surge' },
    PUT_OI_UNWINDING: { icon: '🔓', label: 'Put Unwinding' },
    CALL_OI_UNWINDING: { icon: '🔓', label: 'Call Unwinding' },
    IV_SKEW_EXTREME: { icon: '📐', label: 'IV Skew' },
    GAMMA_SQUEEZE_SETUP: { icon: '🎰', label: 'Gamma Squeeze' },
    BREAKOUT_ATTEMPT: { icon: '🚀', label: 'Breakout' },
    BREAKDOWN_ATTEMPT: { icon: '📉', label: 'Breakdown' },
    NEW_SESSION_HIGH: { icon: '🏔️', label: 'New High' },
    RETEST: { icon: '🔁', label: 'Retest' }
};

const statusConfig: Record<EventStatus, { color: string; bg: string; icon: string }> = {
    DETECTED: { color: 'text-blue-400', bg: 'bg-blue-500/20', icon: '🔵' },
    PENDING: { color: 'text-amber-400', bg: 'bg-amber-500/20', icon: '🟡' },
    CONFIRMED: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', icon: '✅' },
    FAILED: { color: 'text-red-400', bg: 'bg-red-500/20', icon: '❌' },
    EXPIRED: { color: 'text-slate-400', bg: 'bg-slate-500/20', icon: '⏰' }
};

const categoryColors: Record<EventCategory, string> = {
    MICROSTRUCTURE: 'border-l-cyan-400',
    TECHNICAL: 'border-l-purple-400',
    OPTIONS: 'border-l-amber-400',
    PRICE: 'border-l-emerald-400'
};

export const EventFeed: React.FC<EventFeedProps> = ({ events, maxEvents = 10 }) => {
    const sortedEvents = [...events]
        .sort((a, b) => b.detectedAt - a.detectedAt)
        .slice(0, maxEvents);

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const activeCount = events.filter(e => e.status === 'DETECTED' || e.status === 'PENDING').length;

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Event Feed</h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{activeCount} Active</span>
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                </div>
            </div>

            {/* Events List */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
                {sortedEvents.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm">No events detected</div>
                ) : (
                    sortedEvents.map((event) => {
                        const typeInfo = eventTypeLabels[event.eventType] || { icon: '📌', label: event.eventType };
                        const statusInfo = statusConfig[event.status];
                        const categoryBorder = categoryColors[event.category];

                        return (
                            <div
                                key={event.eventId}
                                className={`p-3 rounded-lg bg-slate-800/50 border-l-2 ${categoryBorder} hover:bg-slate-800 transition-colors`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <span>{typeInfo.icon}</span>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-white">{typeInfo.label}</span>
                                                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${event.expectedDirection === 'BULLISH'
                                                        ? 'text-emerald-400 bg-emerald-500/20'
                                                        : 'text-red-400 bg-red-500/20'
                                                    }`}>
                                                    {event.expectedDirection}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[10px] text-slate-500 uppercase">{event.category}</span>
                                                <span className="text-[10px] text-slate-600">•</span>
                                                <span className="text-[10px] text-slate-500">₹{event.priceAtDetection.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${statusInfo.bg}`}>
                                            <span>{statusInfo.icon}</span>
                                            <span className={`text-xs font-medium ${statusInfo.color}`}>{event.status}</span>
                                        </div>
                                        <span className="text-[10px] text-slate-500 mt-1 block">
                                            {formatTime(event.detectedAt)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default EventFeed;
