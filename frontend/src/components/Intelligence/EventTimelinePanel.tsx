import React from 'react'

interface EventTimelinePanelProps {
    detectedEvents?: string[]
    eventCount?: number
    matchedEvents?: string[]
    confirmedEvents?: number
    failedEvents?: number
    eventConfirmationRate?: number
    className?: string
}

export const EventTimelinePanel: React.FC<EventTimelinePanelProps> = ({
    detectedEvents,
    eventCount,
    matchedEvents,
    confirmedEvents,
    failedEvents,
    eventConfirmationRate,
    className = ''
}) => {
    const getEventIcon = (event: string) => {
        if (event.includes('FLIP') || event.includes('REVERSAL')) return '🔄'
        if (event.includes('BREAKOUT')) return '🚀'
        if (event.includes('BREAKDOWN')) return '📉'
        if (event.includes('EXHAUSTION')) return '😮‍💨'
        if (event.includes('SQUEEZE')) return '🗜️'
        if (event.includes('ABSORPTION')) return '🛡️'
        if (event.includes('MOMENTUM')) return '⚡'
        if (event.includes('DIVERGENCE')) return '↔️'
        if (event.includes('SUPPORT') || event.includes('RESISTANCE')) return '📍'
        if (event.includes('TOUCH')) return '👆'
        return '🔵'
    }

    const formatEventName = (event: string) => {
        return event
            .replace(/_/g, ' ')
            .toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    }

    const getConfirmationColor = (rate: number | undefined) => {
        if (rate === undefined) return 'text-slate-400'
        if (rate >= 70) return 'text-emerald-400'
        if (rate >= 50) return 'text-blue-400'
        if (rate >= 30) return 'text-amber-400'
        return 'text-red-400'
    }

    const getConfirmationGrade = (rate: number | undefined) => {
        if (rate === undefined) return 'N/A'
        if (rate >= 80) return 'A+'
        if (rate >= 70) return 'A'
        if (rate >= 60) return 'B'
        if (rate >= 50) return 'C'
        if (rate >= 40) return 'D'
        return 'F'
    }

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="text-blue-400">📋</span>
                Event Tracking
                {eventCount !== undefined && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
                        {eventCount} Events
                    </span>
                )}
            </h3>

            {/* Confirmation Stats */}
            {(confirmedEvents !== undefined || failedEvents !== undefined || eventConfirmationRate !== undefined) && (
                <div className="grid grid-cols-3 gap-2 mb-4">
                    {confirmedEvents !== undefined && (
                        <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded text-center">
                            <div className="text-xs text-slate-400">Confirmed</div>
                            <div className="text-lg font-bold text-emerald-400">{confirmedEvents}</div>
                            <div className="text-xs text-emerald-300">✓</div>
                        </div>
                    )}
                    {failedEvents !== undefined && (
                        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-center">
                            <div className="text-xs text-slate-400">Failed</div>
                            <div className="text-lg font-bold text-red-400">{failedEvents}</div>
                            <div className="text-xs text-red-300">✗</div>
                        </div>
                    )}
                    {eventConfirmationRate !== undefined && (
                        <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded text-center">
                            <div className="text-xs text-slate-400">Rate</div>
                            <div className={`text-lg font-bold ${getConfirmationColor(eventConfirmationRate)}`}>
                                {eventConfirmationRate.toFixed(0)}%
                            </div>
                            <div className={`text-xs ${getConfirmationColor(eventConfirmationRate)}`}>
                                Grade: {getConfirmationGrade(eventConfirmationRate)}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Event List */}
            {detectedEvents && detectedEvents.length > 0 && (
                <div>
                    <div className="text-xs text-slate-400 mb-2">Detected Events</div>
                    <div className="space-y-2">
                        {detectedEvents.slice(0, 8).map((event, idx) => {
                            const isMatched = matchedEvents?.includes(event)
                            return (
                                <div
                                    key={idx}
                                    className={`p-2 rounded border ${
                                        isMatched
                                            ? 'bg-blue-500/10 border-blue-500/30'
                                            : 'bg-slate-700/50 border-slate-600/30'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">{getEventIcon(event)}</span>
                                        <div className="flex-1">
                                            <div className={`text-sm font-medium ${
                                                isMatched ? 'text-blue-400' : 'text-slate-300'
                                            }`}>
                                                {formatEventName(event)}
                                            </div>
                                        </div>
                                        {isMatched && (
                                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                                                MATCHED
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {detectedEvents.length > 8 && (
                        <div className="mt-2 text-center">
                            <button className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                                Show all {detectedEvents.length} events
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* No Events */}
            {(!detectedEvents || detectedEvents.length === 0) && (
                <div className="text-center py-6 text-slate-500 text-sm">
                    No events detected
                </div>
            )}

            {/* Learning Status */}
            {eventConfirmationRate !== undefined && (
                <div className="mt-4 p-3 bg-slate-700/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">🧠</span>
                        <div className="text-sm font-medium text-white">Adaptive Learning</div>
                    </div>
                    <div className="text-xs text-slate-400">
                        The system has learned from {(confirmedEvents || 0) + (failedEvents || 0)} historical events.
                        Current prediction accuracy: <span className={`font-medium ${getConfirmationColor(eventConfirmationRate)}`}>
                            {eventConfirmationRate.toFixed(1)}%
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}

export default EventTimelinePanel
