import React from 'react'
import type { ActiveSetup } from '../../store/dashboardStore'

interface ActiveSetupsPanelProps {
    setups?: ActiveSetup[]
    className?: string
}

export const ActiveSetupsPanel: React.FC<ActiveSetupsPanelProps> = ({ setups, className = '' }) => {
    if (!setups || setups.length === 0) {
        return (
            <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
                <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span className="text-blue-400">🎯</span>
                    Active Setups
                </h3>
                <div className="text-center py-4 text-slate-500 text-sm">
                    No active setups detected
                </div>
            </div>
        )
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'READY': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
            case 'FORMING': return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            case 'TRIGGERED': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
            case 'EXPIRED': return 'bg-slate-500/20 text-slate-400 border-slate-500/30'
            default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30'
        }
    }

    const getDirectionIcon = (direction: string) => {
        if (direction === 'BULLISH' || direction === 'LONG') return '📈'
        if (direction === 'BEARISH' || direction === 'SHORT') return '📉'
        return '↔️'
    }

    const formatSetupType = (type: string | undefined) => {
        if (!type) return 'Unknown Setup'
        return type.replace(/_/g, ' ').toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    }

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 ${className}`}>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="text-blue-400">🎯</span>
                Active Setups
                <span className="ml-auto text-xs font-normal text-slate-400">
                    {setups.length} active
                </span>
            </h3>

            <div className="space-y-3">
                {setups.slice(0, 5).map((setup, idx) => (
                    <div
                        key={setup.setupId || idx}
                        className={`p-3 rounded-lg border ${getStatusColor(setup.status)}`}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span>{getDirectionIcon(setup.direction)}</span>
                                <span className="font-medium text-sm">
                                    {formatSetupType(setup.setupType)}
                                </span>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${getStatusColor(setup.status)}`}>
                                {setup.status}
                            </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                                <div className="text-slate-500">Confidence</div>
                                <div className={`font-medium ${
                                    setup.confidence >= 0.7 ? 'text-emerald-400' :
                                    setup.confidence >= 0.5 ? 'text-amber-400' : 'text-slate-400'
                                }`}>
                                    {(setup.confidence * 100).toFixed(0)}%
                                </div>
                            </div>
                            {setup.entryPrice && (
                                <div>
                                    <div className="text-slate-500">Entry</div>
                                    <div className="text-white font-medium">
                                        {setup.entryPrice.toFixed(2)}
                                    </div>
                                </div>
                            )}
                            {setup.target && (
                                <div>
                                    <div className="text-slate-500">Target</div>
                                    <div className="text-emerald-400 font-medium">
                                        {setup.target.toFixed(2)}
                                    </div>
                                </div>
                            )}
                        </div>

                        {setup.stopLoss && (
                            <div className="mt-2 pt-2 border-t border-slate-700/50 text-xs">
                                <span className="text-slate-500">Stop Loss: </span>
                                <span className="text-red-400 font-medium">{setup.stopLoss.toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {setups.length > 5 && (
                <div className="mt-3 text-center">
                    <button className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                        Show all {setups.length} setups
                    </button>
                </div>
            )}
        </div>
    )
}

export default ActiveSetupsPanel
