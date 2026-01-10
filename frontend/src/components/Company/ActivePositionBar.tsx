import type { Position } from '../../types'

interface ActivePositionBarProps {
    position: Position | null
    onClose?: () => void
    className?: string
}

export default function ActivePositionBar({ position, onClose, className = '' }: ActivePositionBarProps) {
    if (!position) return null

    const isLong = position.side === 'LONG'
    const pnl = position.unrealizedPnl
    const pnlPercent = position.unrealizedPnlPercent

    // Calculate R-multiple (rough estimate)
    const riskPerUnit = Math.abs(position.avgEntryPrice - position.stopLoss)
    const rMultiple = riskPerUnit > 0
        ? ((position.currentPrice - position.avgEntryPrice) * (isLong ? 1 : -1)) / riskPerUnit
        : 0

    return (
        <div className={`fixed bottom-0 left-0 right-0 z-50 ${className}`}>
            <div className="bg-slate-900/95 border-t border-slate-700 backdrop-blur-sm px-6 py-3">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    {/* Left: Position Info */}
                    <div className="flex items-center gap-4">
                        <span className="text-slate-400 text-sm">Active Position:</span>
                        <span className="font-bold text-white">{position.companyName || position.scripCode}</span>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${isLong
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}>
                            {position.side}
                        </span>
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                            <span>@</span>
                            <span className="text-white">{position.avgEntryPrice.toFixed(2)}</span>
                            <span>→</span>
                            <span className="text-white">{position.currentPrice.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Center: Levels */}
                    <div className="hidden md:flex items-center gap-4 text-xs text-slate-400">
                        <span>
                            SL: <span className="text-red-400">{position.stopLoss.toFixed(2)}</span>
                        </span>
                        <span>
                            T1: <span className="text-emerald-400">{position.target1.toFixed(2)}</span>
                        </span>
                        {position.tp1Hit && (
                            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs">
                                T1 HIT ✓
                            </span>
                        )}
                    </div>

                    {/* Right: P&L and Actions */}
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <div className={`text-xl font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(0)}
                            </div>
                            <div className="text-xs text-slate-400">
                                <span className={pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                    {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                                </span>
                                <span className="mx-1">|</span>
                                <span className={rMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                    {rMultiple >= 0 ? '+' : ''}{rMultiple.toFixed(1)}R
                                </span>
                            </div>
                        </div>

                        {onClose && (
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-red-500 text-white rounded-lg font-medium 
                  hover:bg-red-600 transition-colors text-sm"
                            >
                                Close Position
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
