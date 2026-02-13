import { useState, useEffect, useCallback } from 'react'
import { ordersApi } from '../../services/api'
import { useDashboardStore } from '../../store/dashboardStore'
import type { CreateOrderRequest, OrderSide, OrderType, TrailingType } from '../../types'
import WalletSelector from './WalletSelector'

interface TradeModalProps {
    isOpen: boolean
    onClose: () => void
    scripCode: string
    companyName?: string
    currentPrice?: number
    direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    quantScore?: number
}

// FIX BUG #3: Order validation types
interface ValidationError {
    field: string
    message: string
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
    const [walletType, setWalletType] = useState<'PAPER' | 'REAL'>('PAPER')
    const [trailingType, setTrailingType] = useState<TrailingType>('NONE')
    const [trailingValue, setTrailingValue] = useState(1)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // FIX BUG #5: Add confirmation step
    const [showConfirmation, setShowConfirmation] = useState(false)
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])

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

    // FIX BUG #3: Validate SL/TP before submission - prevent inverted orders
    const validateOrder = useCallback((): ValidationError[] => {
        const errors: ValidationError[] = []
        const entry = orderType === 'LIMIT' ? limitPrice : currentPrice

        if (!scripCode.trim()) {
            errors.push({ field: 'scripCode', message: 'Scrip code is required' })
        }

        if (qty < 1) {
            errors.push({ field: 'qty', message: 'Quantity must be at least 1' })
        }

        if (entry <= 0) {
            errors.push({ field: 'entry', message: 'Entry price must be positive' })
        }

        // FIX BUG #3: Validate SL/TP positions based on side
        if (sl > 0 && entry > 0) {
            if (side === 'BUY') {
                // For BUY orders: SL must be BELOW entry
                if (sl >= entry) {
                    errors.push({
                        field: 'sl',
                        message: `BUY order: Stop Loss (${sl.toFixed(2)}) must be BELOW entry (${entry.toFixed(2)})`
                    })
                }
            } else {
                // For SELL orders: SL must be ABOVE entry
                if (sl <= entry) {
                    errors.push({
                        field: 'sl',
                        message: `SELL order: Stop Loss (${sl.toFixed(2)}) must be ABOVE entry (${entry.toFixed(2)})`
                    })
                }
            }
        }

        if (tp1 > 0 && entry > 0) {
            if (side === 'BUY') {
                // For BUY orders: TP must be ABOVE entry
                if (tp1 <= entry) {
                    errors.push({
                        field: 'tp1',
                        message: `BUY order: Target 1 (${tp1.toFixed(2)}) must be ABOVE entry (${entry.toFixed(2)})`
                    })
                }
            } else {
                // For SELL orders: TP must be BELOW entry
                if (tp1 >= entry) {
                    errors.push({
                        field: 'tp1',
                        message: `SELL order: Target 1 (${tp1.toFixed(2)}) must be BELOW entry (${entry.toFixed(2)})`
                    })
                }
            }
        }

        // Validate TP2 if set
        if (tp2 > 0 && tp1 > 0) {
            if (side === 'BUY' && tp2 <= tp1) {
                errors.push({ field: 'tp2', message: 'BUY order: Target 2 must be above Target 1' })
            }
            if (side === 'SELL' && tp2 >= tp1) {
                errors.push({ field: 'tp2', message: 'SELL order: Target 2 must be below Target 1' })
            }
        }

        return errors
    }, [scripCode, qty, orderType, limitPrice, currentPrice, side, sl, tp1, tp2])

    // FIX BUG #14: Round price to 2 decimals
    const roundPrice = (price: number): number => {
        return Math.round(price * 100) / 100
    }

    const handleSubmit = async () => {
        // FIX BUG #3: Validate before submission
        const errors = validateOrder()
        if (errors.length > 0) {
            setValidationErrors(errors)
            setError(errors[0].message)
            return
        }
        setValidationErrors([])

        // FIX BUG #5: Show confirmation step first
        if (!showConfirmation) {
            setShowConfirmation(true)
            return
        }

        setSubmitting(true)
        setError(null)

        // FIX BUG #14: Round all prices to 2 decimals
        const order: CreateOrderRequest = {
            scripCode: scripCode.trim().toUpperCase(),
            side,
            type: orderType,
            qty,
            limitPrice: orderType === 'LIMIT' ? roundPrice(limitPrice) : undefined,
            currentPrice: currentPrice > 0 ? roundPrice(currentPrice) : undefined,
            sl: sl > 0 ? roundPrice(sl) : undefined,
            tp1: tp1 > 0 ? roundPrice(tp1) : undefined,
            tp2: tp2 > 0 ? roundPrice(tp2) : undefined,
            tp1ClosePercent: Math.min(100, Math.max(0, tp1ClosePercent)), // Clamp to 0-100
            trailingType: trailingType !== 'NONE' ? trailingType : undefined,
            trailingValue: trailingType !== 'NONE' ? trailingValue : undefined,
        }

        try {
            // FIX BUG #5: Verify order was created successfully
            const response = await ordersApi.createOrder(order)

            // Check if response indicates success
            if (response && !('error' in response)) {
                // Order placed successfully
                setError(null)
                setShowConfirmation(false)
                useDashboardStore.getState().addToast(
                    `${side} ${qty} ${scripCode} @ ${orderType === 'LIMIT' ? `₹${limitPrice.toFixed(2)}` : 'MARKET'} placed`,
                    'success'
                )
                onClose()
            } else {
                // Response indicates failure
                const errorMsg = 'error' in response ? String(response.error) : 'Order creation failed - no confirmation received'
                throw new Error(errorMsg)
            }
        } catch (err) {
            // FIX BUG #10: Show detailed error from backend
            const errorMessage = err instanceof Error ? err.message : 'Failed to create order'
            setError(errorMessage)
            setShowConfirmation(false) // Reset confirmation on error
            useDashboardStore.getState().addToast(`Order failed: ${errorMessage}`, 'error')
        } finally {
            setSubmitting(false)
        }
    }

    // Reset confirmation when modal closes or order details change
    useEffect(() => {
        setShowConfirmation(false)
        setValidationErrors([])
    }, [isOpen, side, qty, sl, tp1, tp2, orderType, limitPrice])

    // Calculate risk/reward
    const entryPrice = orderType === 'LIMIT' ? limitPrice : currentPrice
    const slDistance = Math.abs(entryPrice - sl)
    const tp1Distance = Math.abs(tp1 - entryPrice)

    // FIX BUG #4: Prevent division by zero - check slDistance > 0
    const riskReward = sl > 0 && tp1 > 0 && slDistance > 0.01 // Small epsilon to avoid near-zero
        ? (tp1Distance / slDistance)
        : 0
    const riskAmount = slDistance * qty
    const potentialProfit = tp1Distance * qty

    // FIX BUG #4: Safe percentage calculations
    const slPercent = entryPrice > 0 ? ((sl - entryPrice) / entryPrice * 100) : 0
    const tp1Percent = entryPrice > 0 ? ((tp1 - entryPrice) / entryPrice * 100) : 0
    const tp2Percent = entryPrice > 0 ? ((tp2 - entryPrice) / entryPrice * 100) : 0

    // FIX: Check if SL/TP are valid for current side
    const isSlValid = sl <= 0 || (side === 'BUY' ? sl < entryPrice : sl > entryPrice)
    const isTp1Valid = tp1 <= 0 || (side === 'BUY' ? tp1 > entryPrice : tp1 < entryPrice)

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
            <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-slate-700 animate-scaleIn">
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
                    {/* Wallet Type Selector */}
                    <div>
                        <label className="text-sm text-slate-400 mb-2 block">Trading Mode</label>
                        <WalletSelector value={walletType} onChange={setWalletType} compact />
                        {walletType === 'REAL' && (
                            <div className="mt-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 px-3 py-1.5 rounded text-xs">
                                You are placing a REAL trade. This will use your live broker account.
                            </div>
                        )}
                    </div>

                    {/* FIX BUG #5: Confirmation step */}
                    {showConfirmation && (
                        <div className="bg-amber-500/20 border border-amber-500/50 text-amber-400 px-3 py-2 rounded-lg text-sm">
                            <div className="font-bold mb-1">⚠️ Confirm Order</div>
                            <div>
                                [{walletType}] {side} {qty} shares of {scripCode} at {orderType === 'LIMIT' ? `₹${limitPrice.toFixed(2)}` : 'MARKET'}
                            </div>
                            <div className="mt-1 text-xs">
                                SL: ₹{sl > 0 ? sl.toFixed(2) : 'None'} | TP1: ₹{tp1 > 0 ? tp1.toFixed(2) : 'None'}
                            </div>
                            <div className="mt-2 text-xs text-amber-300">
                                Click "Confirm {side}" again to place order
                            </div>
                        </div>
                    )}

                    {/* Error display */}
                    {error && (
                        <div className="bg-red-500/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-lg text-sm">
                            <div className="font-bold">❌ {error}</div>
                            {validationErrors.length > 1 && (
                                <ul className="mt-1 text-xs list-disc list-inside">
                                    {validationErrors.slice(1).map((e, i) => (
                                        <li key={i}>{e.message}</li>
                                    ))}
                                </ul>
                            )}
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

                    {/* SL / TP Grid - FIX BUG #3: Show validation errors visually */}
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="text-sm text-red-400 mb-1 block">Stop Loss</label>
                            <input
                                type="number"
                                value={sl}
                                onChange={(e) => setSl(roundPrice(Number(e.target.value)))}
                                className={`w-full bg-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none
                                    ${!isSlValid && sl > 0
                                        ? 'border-2 border-yellow-500 focus:border-yellow-500'
                                        : 'border border-red-500/30 focus:border-red-500'
                                    }`}
                                step="0.05"
                            />
                            <div className={`text-xs mt-1 ${!isSlValid && sl > 0 ? 'text-yellow-400 font-bold' : 'text-red-400'}`}>
                                {!isSlValid && sl > 0 ? '⚠️ INVALID' : `${slPercent >= 0 ? '+' : ''}${slPercent.toFixed(1)}%`}
                            </div>
                        </div>
                        <div>
                            <label className="text-sm text-emerald-400 mb-1 block">Target 1</label>
                            <input
                                type="number"
                                value={tp1}
                                onChange={(e) => setTp1(roundPrice(Number(e.target.value)))}
                                className={`w-full bg-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none
                                    ${!isTp1Valid && tp1 > 0
                                        ? 'border-2 border-yellow-500 focus:border-yellow-500'
                                        : 'border border-emerald-500/30 focus:border-emerald-500'
                                    }`}
                                step="0.05"
                            />
                            <div className={`text-xs mt-1 ${!isTp1Valid && tp1 > 0 ? 'text-yellow-400 font-bold' : 'text-emerald-400'}`}>
                                {!isTp1Valid && tp1 > 0 ? '⚠️ INVALID' : `${tp1Percent >= 0 ? '+' : ''}${tp1Percent.toFixed(1)}%`}
                            </div>
                        </div>
                        <div>
                            <label className="text-sm text-blue-400 mb-1 block">Target 2</label>
                            <input
                                type="number"
                                value={tp2}
                                onChange={(e) => setTp2(roundPrice(Number(e.target.value)))}
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
                    {/* FIX BUG #3: Show warning if order is invalid */}
                    {(!isSlValid || !isTp1Valid) && (sl > 0 || tp1 > 0) && (
                        <div className="bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 px-2 py-1 rounded mb-2 text-xs">
                            ⚠️ {side === 'BUY' ? 'BUY' : 'SELL'} order: SL must be {side === 'BUY' ? 'below' : 'above'} entry, TP must be {side === 'BUY' ? 'above' : 'below'} entry
                        </div>
                    )}
                    <div className="flex justify-between text-sm mb-3">
                        <div>
                            <span className="text-slate-400">Risk: </span>
                            <span className="text-red-400 font-medium">₹{isFinite(riskAmount) ? riskAmount.toFixed(2) : '0.00'}</span>
                        </div>
                        <div>
                            <span className="text-slate-400">R:R = </span>
                            {/* FIX BUG #4: Handle NaN/Infinity in display */}
                            <span className={`font-bold ${
                                !isFinite(riskReward) || riskReward === 0 ? 'text-slate-400' :
                                riskReward >= 2 ? 'text-emerald-400' :
                                riskReward >= 1 ? 'text-yellow-400' : 'text-red-400'
                            }`}>
                                {isFinite(riskReward) && riskReward > 0 ? `1:${riskReward.toFixed(1)}` : 'N/A'}
                            </span>
                        </div>
                        <div>
                            <span className="text-slate-400">Reward: </span>
                            <span className="text-emerald-400 font-medium">₹{isFinite(potentialProfit) ? potentialProfit.toFixed(2) : '0.00'}</span>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => {
                                setShowConfirmation(false)
                                setError(null)
                                onClose()
                            }}
                            className="flex-1 py-3 rounded-lg font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || qty < 1 || !scripCode.trim() || (!isSlValid && sl > 0) || (!isTp1Valid && tp1 > 0)}
                            className={`flex-1 py-3 rounded-lg font-bold transition-all ${
                                showConfirmation
                                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-lg shadow-amber-500/30 animate-pulse'
                                    : side === 'BUY'
                                        ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg shadow-emerald-500/30'
                                        : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg shadow-red-500/30'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {submitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Placing...
                                </span>
                            ) : showConfirmation ? (
                                `🔒 CONFIRM ${side}`
                            ) : (
                                `${side === 'BUY' ? '🚀' : '📉'} ${side}`
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
