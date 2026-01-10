import { useState } from 'react'
import type { FamilyScore } from '../../types'

interface EnhancedQuickTradePanelProps {
    score: FamilyScore | null
    onExecute: (order: TradeOrder) => Promise<void>
    onWatchlist?: () => void
    className?: string
}

export interface TradeOrder {
    scripCode: string
    direction: 'LONG' | 'SHORT'
    entryPrice: number
    stopLoss: number
    target: number
    quantity: number
    horizon: 'SCALP' | 'INTRADAY' | 'SWING' | 'POSITION'
}

type TradingHorizon = 'SCALP' | 'INTRADAY' | 'SWING' | 'POSITION'

const HORIZON_CONFIG = {
    SCALP: {
        color: 'purple',
        slMultiplier: 0.003,  // 0.3%
        tpMultiplier: 0.005,  // 0.5%
        riskPercent: 0.25,
        description: '1-15 min hold'
    },
    INTRADAY: {
        color: 'blue',
        slMultiplier: 0.008,  // 0.8%
        tpMultiplier: 0.015,  // 1.5%
        riskPercent: 0.5,
        description: '15 min - 4 hr hold'
    },
    SWING: {
        color: 'amber',
        slMultiplier: 0.02,   // 2%
        tpMultiplier: 0.04,   // 4%
        riskPercent: 1.0,
        description: '1-5 day hold'
    },
    POSITION: {
        color: 'emerald',
        slMultiplier: 0.05,   // 5%
        tpMultiplier: 0.10,   // 10%
        riskPercent: 2.0,
        description: 'Week+ hold'
    },
}

export default function EnhancedQuickTradePanel({
    score,
    onExecute,
    onWatchlist,
    className = ''
}: EnhancedQuickTradePanelProps) {
    const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG')
    const [horizon, setHorizon] = useState<TradingHorizon>('INTRADAY')
    const [entry, setEntry] = useState(score?.close || 0)
    const [stopLoss, setStopLoss] = useState(0)
    const [target, setTarget] = useState(0)
    const [quantity, setQuantity] = useState(1)
    const [loading, setLoading] = useState(false)

    // Auto-recalculate SL/TP when horizon or direction changes
    const recalculateLevels = (newDirection: 'LONG' | 'SHORT', newHorizon: TradingHorizon) => {
        if (!score) return

        const price = score.close
        const config = HORIZON_CONFIG[newHorizon]

        if (newDirection === 'LONG') {
            setStopLoss(Number((price * (1 - config.slMultiplier)).toFixed(2)))
            setTarget(Number((price * (1 + config.tpMultiplier)).toFixed(2)))
        } else {
            setStopLoss(Number((price * (1 + config.slMultiplier)).toFixed(2)))
            setTarget(Number((price * (1 - config.tpMultiplier)).toFixed(2)))
        }
        setEntry(price)
    }

    // Initialize on score change
    useState(() => {
        if (score) {
            recalculateLevels(direction, horizon)
        }
    })

    const handleDirectionChange = (newDirection: 'LONG' | 'SHORT') => {
        setDirection(newDirection)
        recalculateLevels(newDirection, horizon)
    }

    const handleHorizonChange = (newHorizon: TradingHorizon) => {
        setHorizon(newHorizon)
        recalculateLevels(direction, newHorizon)
    }

    const risk = Math.abs(entry - stopLoss) * quantity
    const reward = Math.abs(target - entry) * quantity
    const riskReward = risk > 0 ? (reward / risk).toFixed(2) : '—'
    const config = HORIZON_CONFIG[horizon]

    const handleExecute = async () => {
        if (!score) return

        setLoading(true)
        try {
            await onExecute({
                scripCode: score.scripCode,
                direction,
                entryPrice: entry,
                stopLoss,
                target,
                quantity,
                horizon,
            })
        } catch (error) {
            console.error('Trade execution failed:', error)
        } finally {
            setLoading(false)
        }
    }

    const getHorizonButtonClass = (h: TradingHorizon) => {
        const isSelected = horizon === h
        const colors = {
            SCALP: isSelected ? 'bg-purple-500 text-white' : 'text-purple-400 hover:bg-purple-500/20',
            INTRADAY: isSelected ? 'bg-blue-500 text-white' : 'text-blue-400 hover:bg-blue-500/20',
            SWING: isSelected ? 'bg-amber-500 text-white' : 'text-amber-400 hover:bg-amber-500/20',
            POSITION: isSelected ? 'bg-emerald-500 text-white' : 'text-emerald-400 hover:bg-emerald-500/20',
        }
        return colors[h]
    }

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden ${className}`}>
            {/* Header */}
            <div className="p-4 border-b border-slate-700/50">
                <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                    Quick Trade
                </h3>
            </div>

            <div className="p-4 space-y-4">
                {/* Trading Horizon */}
                <div>
                    <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Trading Horizon</div>
                    <div className="grid grid-cols-4 gap-1">
                        {(['SCALP', 'INTRADAY', 'SWING', 'POSITION'] as const).map(h => (
                            <button
                                key={h}
                                onClick={() => handleHorizonChange(h)}
                                className={`py-2 rounded-lg text-[10px] font-bold transition-all ${getHorizonButtonClass(h)}`}
                            >
                                {h}
                            </button>
                        ))}
                    </div>
                    <div className="mt-2 text-xs text-slate-500 text-center">
                        {config.description} • {(config.riskPercent).toFixed(2)}% risk per trade
                    </div>
                </div>

                {/* Direction */}
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => handleDirectionChange('LONG')}
                        className={`py-4 rounded-xl font-bold text-lg transition-all ${direction === 'LONG'
                                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                                : 'bg-slate-700 text-slate-400 hover:bg-emerald-500/20 hover:text-emerald-400'
                            }`}
                    >
                        LONG ↑
                    </button>
                    <button
                        onClick={() => handleDirectionChange('SHORT')}
                        className={`py-4 rounded-xl font-bold text-lg transition-all ${direction === 'SHORT'
                                ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                : 'bg-slate-700 text-slate-400 hover:bg-red-500/20 hover:text-red-400'
                            }`}
                    >
                        SHORT ↓
                    </button>
                </div>

                {/* Price Inputs */}
                <div className="space-y-2">
                    <PriceInput label="Entry" value={entry} onChange={setEntry} />
                    <PriceInput label="Stop Loss" value={stopLoss} onChange={setStopLoss} color="red" />
                    <PriceInput label="Target" value={target} onChange={setTarget} color="green" />
                </div>

                {/* Position Size */}
                <div className="bg-slate-700/30 rounded-xl p-3">
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-sm text-slate-400">Position Size</span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                className="w-10 h-10 rounded-lg bg-slate-700 text-white hover:bg-slate-600 
                           transition-colors font-bold text-lg"
                            >
                                -
                            </button>
                            <span className="w-14 text-center font-bold text-white text-lg">{quantity}</span>
                            <button
                                onClick={() => setQuantity(quantity + 1)}
                                className="w-10 h-10 rounded-lg bg-slate-700 text-white hover:bg-slate-600 
                           transition-colors font-bold text-lg"
                            >
                                +
                            </button>
                        </div>
                    </div>

                    {/* Risk/Reward Stats */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-800/50 p-2 rounded-lg text-center">
                            <div className="text-xs text-slate-400">Risk</div>
                            <div className="text-red-400 font-bold">₹{risk.toFixed(0)}</div>
                        </div>
                        <div className="bg-slate-800/50 p-2 rounded-lg text-center">
                            <div className="text-xs text-slate-400">Reward</div>
                            <div className="text-emerald-400 font-bold">₹{reward.toFixed(0)}</div>
                        </div>
                        <div className="bg-slate-800/50 p-2 rounded-lg text-center">
                            <div className="text-xs text-slate-400">R:R</div>
                            <div className="text-white font-bold">{riskReward}</div>
                        </div>
                        <div className="bg-slate-800/50 p-2 rounded-lg text-center">
                            <div className="text-xs text-slate-400">% Move to TP</div>
                            <div className="text-emerald-400 font-bold">
                                {entry > 0 ? ((Math.abs(target - entry) / entry) * 100).toFixed(2) : 0}%
                            </div>
                        </div>
                    </div>
                </div>

                {/* Execute */}
                <button
                    onClick={handleExecute}
                    disabled={loading || !score}
                    className={`w-full py-4 rounded-xl font-bold text-lg transition-all shadow-lg
            ${direction === 'LONG'
                            ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 shadow-emerald-500/30'
                            : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 shadow-red-500/30'
                        } text-white disabled:opacity-50`}
                >
                    {loading ? 'Executing...' : `EXECUTE ${direction}`}
                </button>

                {/* Watchlist */}
                {onWatchlist && (
                    <button
                        onClick={onWatchlist}
                        className="w-full py-2 rounded-lg text-sm text-slate-400 
              border border-slate-600 hover:border-slate-500 hover:text-white transition-all"
                    >
                        + Add to Watchlist
                    </button>
                )}
            </div>
        </div>
    )
}

function PriceInput({
    label,
    value,
    onChange,
    color
}: {
    label: string
    value: number
    onChange: (v: number) => void
    color?: 'red' | 'green'
}) {
    const colorClass = color === 'red' ? 'text-red-400 border-red-500/30 focus:border-red-500' :
        color === 'green' ? 'text-emerald-400 border-emerald-500/30 focus:border-emerald-500' :
            'text-white border-slate-600 focus:border-blue-500'

    return (
        <div className="flex justify-between items-center">
            <label className="text-sm text-slate-400">{label}</label>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className={`w-28 px-3 py-2 bg-slate-700 border rounded-lg 
                   text-right text-sm focus:outline-none ${colorClass}`}
            />
        </div>
    )
}
