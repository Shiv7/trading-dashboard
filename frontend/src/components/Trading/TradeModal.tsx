import { useState, useEffect } from 'react'
import { ordersApi } from '../../services/api'
import type { CreateOrderRequest, OrderSide, OrderType, TrailingType } from '../../types'

interface TradeModalProps {
    isOpen: boolean
    onClose: () => void
    scripCode: string
    companyName?: string
    currentPrice?: number
    direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    quantScore?: number
}

export default function TradeModal({
    isOpen,
    onClose,
    scripCode: initialScripCode,
    companyName,
    currentPrice = 0,
    direction = 'NEUTRAL',
    quantScore,
}: TradeModalProps) {
    // FIX: Allow scripCode to be entered manually if not provided
    const [scripCode, setScripCode] = useState(initialScripCode || '')
    const [side, setSide] = useState<OrderSide>('BUY')
    const [orderType, setOrderType] = useState<OrderType>('MARKET')
    const [qty, setQty] = useState(1)
    const [limitPrice, setLimitPrice] = useState(currentPrice)
    const [sl, setSl] = useState(0)
    const [tp1, setTp1] = useState(0)
    const [tp2, setTp2] = useState(0)
    const [tp1ClosePercent, setTp1ClosePercent] = useState(50)
    const [trailingType, setTrailingType] = useState<TrailingType>('NONE')
    const [trailingValue, setTrailingValue] = useState(1)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Reset scripCode when modal opens with a new initialScripCode
    useEffect(() => {
        if (isOpen && initialScripCode) {
            setScripCode(initialScripCode)
        }
    }, [isOpen, initialScripCode])

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen && currentPrice > 0) {
            const defaultSide = direction === 'BEARISH' ? 'SELL' : 'BUY'
            setSide(defaultSide)
            setLimitPrice(currentPrice)
            // Default SL at 2% and TP at 4%
            const slOffset = currentPrice * 0.02
            const tp1Offset = currentPrice * 0.04
            const tp2Offset = currentPrice * 0.08
            if (defaultSide === 'BUY') {
                setSl(Number((currentPrice - slOffset).toFixed(2)))
                setTp1(Number((currentPrice + tp1Offset).toFixed(2)))
                setTp2(Number((currentPrice + tp2Offset).toFixed(2)))
            } else {
                setSl(Number((currentPrice + slOffset).toFixed(2)))
                setTp1(Number((currentPrice - tp1Offset).toFixed(2)))
                setTp2(Number((currentPrice - tp2Offset).toFixed(2)))
            }
            setError(null)
        }
    }, [isOpen, currentPrice, direction])

    const handleSubmit = async () => {
        setSubmitting(true)
        setError(null)

        const order: CreateOrderRequest = {
            scripCode,
            side,
            type: orderType,
            qty,
            limitPrice: orderType === 'LIMIT' ? limitPrice : undefined,
            sl: sl > 0 ? sl : undefined,
            tp1: tp1 > 0 ? tp1 : undefined,
            tp2: tp2 > 0 ? tp2 : undefined,
            tp1ClosePercent,
            trailingType: trailingType !== 'NONE' ? trailingType : undefined,
            trailingValue: trailingType !== 'NONE' ? trailingValue : undefined,
        }

        try {
            await ordersApi.createOrder(order)
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create order')
        } finally {
            setSubmitting(false)
        }
    }

    // Calculate risk/reward
    const entryPrice = orderType === 'LIMIT' ? limitPrice : currentPrice
    const slDistance = Math.abs(entryPrice - sl)
    const tp1Distance = Math.abs(tp1 - entryPrice)
    const riskReward = sl > 0 && tp1 > 0 ? (tp1Distance / slDistance) : 0
    const riskAmount = slDistance * qty
    const potentialProfit = tp1Distance * qty

    // SL/TP percentage from entry
    const slPercent = entryPrice > 0 ? ((sl - entryPrice) / entryPrice * 100) : 0
    const tp1Percent = entryPrice > 0 ? ((tp1 - entryPrice) / entryPrice * 100) : 0
    const tp2Percent = entryPrice > 0 ? ((tp2 - entryPrice) / entryPrice * 100) : 0

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-slate-700">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            📈 Trade: {companyName || scripCode}
                        </h2>
                        <div className="flex items-center gap-3 mt-1 text-sm">
                            <span className="text-slate-400">
                                LTP: <span className="text-white font-medium">₹{currentPrice.toFixed(2)}</span>
                            </span>
                            {quantScore && (
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${quantScore >= 70 ? 'bg-emerald-500/20 text-emerald-400' :
                                        quantScore >= 50 ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-red-500/20 text-red-400'
                                    }`}>
                                    Score: {quantScore.toFixed(1)}
                                </span>
                            )}
                            <span className={`text-xs ${direction === 'BULLISH' ? 'text-green-400' :
                                    direction === 'BEARISH' ? 'text-red-400' : 'text-slate-400'
                                }`}>
                                {direction}
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors text-2xl"
                    >
                        ×
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4">
                    {/* Error display */}
                    {error && (
                        <div className="bg-red-500/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    {/* ScripCode Input - show when no scripCode provided */}
                    {!initialScripCode && (
                        <div>
                            <label className="text-sm text-slate-400 mb-1 block">Scrip Code *</label>
                            <input
                                type="text"
                                value={scripCode}
                                onChange={(e) => setScripCode(e.target.value.toUpperCase())}
                                placeholder="Enter scrip code (e.g., RELIANCE)"
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                    )}

                    {/* Buy/Sell Toggle */}
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => setSide('BUY')}
                            className={`py-3 rounded-lg font-bold text-lg transition-all ${side === 'BUY'
                                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                }`}
                        >
                            🚀 BUY
                        </button>
                        <button
                            onClick={() => setSide('SELL')}
                            className={`py-3 rounded-lg font-bold text-lg transition-all ${side === 'SELL'
                                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                }`}
                        >
                            📉 SELL
                        </button>
                    </div>

                    {/* Order Type */}
                    <div>
                        <label className="text-sm text-slate-400 mb-1 block">Order Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(['MARKET', 'LIMIT'] as OrderType[]).map(type => (
                                <button
                                    key={type}
                                    onClick={() => setOrderType(type)}
                                    className={`py-2 rounded-lg font-medium transition-colors ${orderType === type
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Limit Price (only for LIMIT orders) */}
                    {orderType === 'LIMIT' && (
                        <div>
                            <label className="text-sm text-slate-400 mb-1 block">Limit Price</label>
                            <input
                                type="number"
                                value={limitPrice}
                                onChange={(e) => setLimitPrice(Number(e.target.value))}
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                                step="0.05"
                            />
                        </div>
                    )}

                    {/* Quantity */}
                    <div>
                        <label className="text-sm text-slate-400 mb-1 block">Quantity</label>
                        <input
                            type="number"
                            value={qty}
                            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                            min={1}
                        />
                        <div className="text-xs text-slate-500 mt-1">
                            ≈ ₹{(entryPrice * qty).toLocaleString('en-IN')} value
                        </div>
                    </div>

                    {/* SL / TP Grid */}
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="text-sm text-red-400 mb-1 block">Stop Loss</label>
                            <input
                                type="number"
                                value={sl}
                                onChange={(e) => setSl(Number(e.target.value))}
                                className="w-full bg-slate-700 border border-red-500/30 rounded-lg px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                                step="0.05"
                            />
                            <div className="text-xs text-red-400 mt-1">
                                {slPercent >= 0 ? '+' : ''}{slPercent.toFixed(1)}%
                            </div>
                        </div>
                        <div>
                            <label className="text-sm text-emerald-400 mb-1 block">Target 1</label>
                            <input
                                type="number"
                                value={tp1}
                                onChange={(e) => setTp1(Number(e.target.value))}
                                className="w-full bg-slate-700 border border-emerald-500/30 rounded-lg px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                                step="0.05"
                            />
                            <div className="text-xs text-emerald-400 mt-1">
                                {tp1Percent >= 0 ? '+' : ''}{tp1Percent.toFixed(1)}%
                            </div>
                        </div>
                        <div>
                            <label className="text-sm text-blue-400 mb-1 block">Target 2</label>
                            <input
                                type="number"
                                value={tp2}
                                onChange={(e) => setTp2(Number(e.target.value))}
                                className="w-full bg-slate-700 border border-blue-500/30 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                                step="0.05"
                            />
                            <div className="text-xs text-blue-400 mt-1">
                                {tp2Percent >= 0 ? '+' : ''}{tp2Percent.toFixed(1)}%
                            </div>
                        </div>
                    </div>

                    {/* TP1 Close Percent */}
                    <div>
                        <label className="text-sm text-slate-400 mb-1 block">
                            Close at TP1: {tp1ClosePercent}%
                        </label>
                        <input
                            type="range"
                            value={tp1ClosePercent}
                            onChange={(e) => setTp1ClosePercent(Number(e.target.value))}
                            className="w-full accent-blue-500"
                            min={25}
                            max={100}
                            step={25}
                        />
                        <div className="flex justify-between text-xs text-slate-500">
                            <span>25%</span>
                            <span>50%</span>
                            <span>75%</span>
                            <span>100%</span>
                        </div>
                    </div>

                    {/* Trailing Stop */}
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

                {/* Risk/Reward Footer */}
                <div className="border-t border-slate-700 px-4 py-3 bg-slate-800/50">
                    <div className="flex justify-between text-sm mb-3">
                        <div>
                            <span className="text-slate-400">Risk: </span>
                            <span className="text-red-400 font-medium">₹{riskAmount.toFixed(2)}</span>
                        </div>
                        <div>
                            <span className="text-slate-400">R:R = </span>
                            <span className={`font-bold ${riskReward >= 2 ? 'text-emerald-400' : riskReward >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                                1:{riskReward.toFixed(1)}
                            </span>
                        </div>
                        <div>
                            <span className="text-slate-400">Reward: </span>
                            <span className="text-emerald-400 font-medium">₹{potentialProfit.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-lg font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || qty < 1 || !scripCode.trim()}
                            className={`flex-1 py-3 rounded-lg font-bold transition-all ${side === 'BUY'
                                    ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg shadow-emerald-500/30'
                                    : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg shadow-red-500/30'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {submitting ? 'Placing...' : `Confirm ${side}`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
