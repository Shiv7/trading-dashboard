import { useState } from 'react'
import { ordersApi } from '../../services/api'
import type { ModifyPositionRequest, TrailingType } from '../../types'

interface PositionActionsProps {
    scripCode: string
    currentSl?: number
    currentTp1?: number
    currentTp2?: number
    currentPrice: number
    trailingActive?: boolean
    onUpdate?: () => void
}

export default function PositionActions({
    scripCode,
    currentSl,
    currentTp1,
    currentTp2,
    currentPrice,
    trailingActive = false,
    onUpdate,
}: PositionActionsProps) {
    const [loading, setLoading] = useState(false)
    const [showModify, setShowModify] = useState(false)
    const [showClose, setShowClose] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Modify form state
    const [newSl, setNewSl] = useState(currentSl || 0)
    const [newTp1, setNewTp1] = useState(currentTp1 || 0)
    const [newTp2, setNewTp2] = useState(currentTp2 || 0)
    const [trailingType, setTrailingType] = useState<TrailingType>('NONE')
    const [trailingValue, setTrailingValue] = useState(1)

    const handleClose = async () => {
        setLoading(true)
        setError(null)
        try {
            await ordersApi.closePosition(scripCode)
            setShowClose(false)
            onUpdate?.()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to close position')
        } finally {
            setLoading(false)
        }
    }

    const handleModify = async () => {
        setLoading(true)
        setError(null)

        const request: ModifyPositionRequest = {
            sl: newSl > 0 ? newSl : undefined,
            tp1: newTp1 > 0 ? newTp1 : undefined,
            tp2: newTp2 > 0 ? newTp2 : undefined,
            trailingType: trailingType !== 'NONE' ? trailingType : undefined,
            trailingValue: trailingType !== 'NONE' ? trailingValue : undefined,
            trailingActive: trailingType !== 'NONE' ? true : undefined,
        }

        try {
            await ordersApi.modifyPosition(scripCode, request)
            setShowModify(false)
            onUpdate?.()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to modify position')
        } finally {
            setLoading(false)
        }
    }

    const toggleTrailing = async () => {
        setLoading(true)
        try {
            await ordersApi.modifyPosition(scripCode, {
                trailingActive: !trailingActive,
                trailingType: !trailingActive ? 'PCT' : 'NONE',
                trailingValue: 1,
            })
            onUpdate?.()
        } catch (err) {
            console.error('Failed to toggle trailing:', err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="relative">
            {/* Quick Action Buttons */}
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                    onClick={(e) => { e.preventDefault(); setShowModify(true) }}
                    className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/30 transition-colors"
                    disabled={loading}
                >
                    ✏️ Modify
                </button>
                <button
                    onClick={(e) => { e.preventDefault(); toggleTrailing() }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${trailingActive
                            ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                            : 'bg-slate-600 text-slate-400 hover:bg-slate-500'
                        }`}
                    disabled={loading}
                >
                    {trailingActive ? '🔒 Trailing ON' : '📊 Trail'}
                </button>
                <button
                    onClick={(e) => { e.preventDefault(); setShowClose(true) }}
                    className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors"
                    disabled={loading}
                >
                    ❌ Close
                </button>
            </div>

            {/* Close Confirmation Modal */}
            {showClose && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowClose(false)}>
                    <div className="bg-slate-800 rounded-xl p-6 max-w-sm mx-4 border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-white mb-2">Close Position?</h3>
                        <p className="text-slate-400 text-sm mb-4">
                            Are you sure you want to close your position in <span className="text-white font-medium">{scripCode}</span>?
                            This will exit at market price.
                        </p>
                        {error && (
                            <div className="bg-red-500/20 text-red-400 px-3 py-2 rounded-lg text-sm mb-4">
                                {error}
                            </div>
                        )}
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowClose(false)}
                                className="flex-1 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                                disabled={loading}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleClose}
                                className="flex-1 py-2 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors"
                                disabled={loading}
                            >
                                {loading ? 'Closing...' : 'Confirm Close'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modify Modal */}
            {showModify && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowModify(false)}>
                    <div className="bg-slate-800 rounded-xl max-w-md mx-4 border border-slate-700" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-700">
                            <h3 className="text-lg font-bold text-white">Modify Position</h3>
                            <p className="text-slate-400 text-sm">{scripCode} • LTP: ₹{currentPrice.toFixed(2)}</p>
                        </div>

                        <div className="p-4 space-y-4">
                            {error && (
                                <div className="bg-red-500/20 text-red-400 px-3 py-2 rounded-lg text-sm">
                                    {error}
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-sm text-red-400 mb-1 block">Stop Loss</label>
                                    <input
                                        type="number"
                                        value={newSl}
                                        onChange={(e) => setNewSl(Number(e.target.value))}
                                        className="w-full bg-slate-700 border border-red-500/30 rounded-lg px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                                        step="0.05"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm text-emerald-400 mb-1 block">Target 1</label>
                                    <input
                                        type="number"
                                        value={newTp1}
                                        onChange={(e) => setNewTp1(Number(e.target.value))}
                                        className="w-full bg-slate-700 border border-emerald-500/30 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                                        step="0.05"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm text-blue-400 mb-1 block">Target 2</label>
                                    <input
                                        type="number"
                                        value={newTp2}
                                        onChange={(e) => setNewTp2(Number(e.target.value))}
                                        className="w-full bg-slate-700 border border-blue-500/30 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                                        step="0.05"
                                    />
                                </div>
                            </div>

                            <div className="bg-slate-700/50 rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm text-slate-300">Trailing Stop</label>
                                    <select
                                        value={trailingType}
                                        onChange={(e) => setTrailingType(e.target.value as TrailingType)}
                                        className="bg-slate-600 border border-slate-500 rounded px-2 py-1 text-white text-sm focus:outline-none"
                                    >
                                        <option value="NONE">Disabled</option>
                                        <option value="FIXED">Fixed</option>
                                        <option value="PCT">Percentage</option>
                                    </select>
                                </div>
                                {trailingType !== 'NONE' && (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={trailingValue}
                                            onChange={(e) => setTrailingValue(Number(e.target.value))}
                                            className="flex-1 bg-slate-600 border border-slate-500 rounded px-3 py-1 text-white text-sm focus:outline-none"
                                            step={trailingType === 'PCT' ? 0.1 : 0.5}
                                        />
                                        <span className="text-slate-400 text-sm">
                                            {trailingType === 'PCT' ? '%' : 'pts'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-700 flex gap-3">
                            <button
                                onClick={() => setShowModify(false)}
                                className="flex-1 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                                disabled={loading}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleModify}
                                className="flex-1 py-2 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors"
                                disabled={loading}
                            >
                                {loading ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
