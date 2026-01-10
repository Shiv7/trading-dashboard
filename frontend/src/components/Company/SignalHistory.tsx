import type { Signal } from '../../types'

interface SignalHistoryProps {
    signals: Signal[]
    className?: string
}

export default function SignalHistory({ signals, className = '' }: SignalHistoryProps) {
    // Calculate stats
    const completedSignals = signals.filter(s => s.rMultiple !== undefined && s.rMultiple !== null)
    const wins = completedSignals.filter(s => (s.rMultiple || 0) > 0)
    const winRate = completedSignals.length > 0
        ? (wins.length / completedSignals.length) * 100
        : 0
    const avgR = completedSignals.length > 0
        ? completedSignals.reduce((sum, s) => sum + (s.rMultiple || 0), 0) / completedSignals.length
        : 0

    const formatDate = (timestamp: string) => {
        const date = new Date(timestamp)
        return date.toLocaleDateString('en-IN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const getStatusBadge = (signal: Signal) => {
        if (signal.rMultiple === undefined || signal.rMultiple === null) {
            if (signal.allGatesPassed) {
                return <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">ACTIVE</span>
            }
            return <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-500/20 text-slate-400">REJECTED</span>
        }
        if (signal.rMultiple > 0) {
            return <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">WIN</span>
        }
        return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">LOSS</span>
    }

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
            {/* Header with Stats */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                    Signal History & Returns
                </h3>
                <div className="flex items-center gap-4 text-xs">
                    <span className="text-slate-400">
                        Win Rate: <span className={`font-bold ${winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {winRate.toFixed(0)}%
                        </span>
                    </span>
                    <span className="text-slate-400">
                        Avg R: <span className={`font-bold ${avgR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {avgR >= 0 ? '+' : ''}{avgR.toFixed(2)}
                        </span>
                    </span>
                    <span className="text-slate-400">
                        Total: <span className="font-bold text-white">{signals.length}</span>
                    </span>
                </div>
            </div>

            {/* Signals Table */}
            {signals.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-slate-400 text-xs uppercase border-b border-slate-700">
                                <th className="text-left py-2 px-2">Date</th>
                                <th className="text-center px-2">Dir</th>
                                <th className="text-right px-2">Entry</th>
                                <th className="text-right px-2">Exit</th>
                                <th className="text-right px-2">R-Mult</th>
                                <th className="text-right px-2">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {signals.slice(0, 10).map((signal) => {
                                const isWin = (signal.rMultiple || 0) > 0
                                const hasResult = signal.rMultiple !== undefined && signal.rMultiple !== null

                                return (
                                    <tr
                                        key={signal.signalId}
                                        className={`border-b border-slate-700/50 ${hasResult
                                                ? isWin
                                                    ? 'bg-emerald-500/5'
                                                    : 'bg-red-500/5'
                                                : ''
                                            }`}
                                    >
                                        <td className="py-2 px-2 text-slate-300 text-xs">
                                            {formatDate(signal.timestamp)}
                                        </td>
                                        <td className="text-center px-2">
                                            <span className={`text-lg ${signal.direction === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'
                                                }`}>
                                                {signal.direction === 'BULLISH' ? '↑' : '↓'}
                                            </span>
                                        </td>
                                        <td className="text-right px-2 text-white">
                                            {signal.entryPrice?.toFixed(2) || '—'}
                                        </td>
                                        <td className="text-right px-2 text-white">
                                            {signal.actualPnl !== undefined
                                                ? (signal.entryPrice + (signal.actualPnl * (signal.direction === 'BULLISH' ? 1 : -1))).toFixed(2)
                                                : '—'}
                                        </td>
                                        <td className={`text-right px-2 font-bold ${hasResult
                                                ? isWin ? 'text-emerald-400' : 'text-red-400'
                                                : 'text-slate-400'
                                            }`}>
                                            {hasResult
                                                ? `${signal.rMultiple! >= 0 ? '+' : ''}${signal.rMultiple!.toFixed(2)}R`
                                                : '—'}
                                        </td>
                                        <td className="text-right px-2">
                                            {getStatusBadge(signal)}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="text-center py-8 text-slate-500">
                    <p className="text-sm">No signals for this stock yet</p>
                </div>
            )}

            {/* Show more button */}
            {signals.length > 10 && (
                <div className="mt-3 text-center">
                    <button className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                        Show all {signals.length} signals →
                    </button>
                </div>
            )}
        </div>
    )
}
