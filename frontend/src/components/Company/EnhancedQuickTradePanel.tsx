import { useState, useEffect, useCallback } from 'react'
import type { FamilyScore } from '../../types'
import { signalsApi } from '../../services/api'
import { isAnyMarketOpen, isExchangeOpen } from '../../utils/tradingUtils'
import { DMValue } from '../DataQuality/ProvenanceTag'

interface EnhancedQuickTradePanelProps {
    score: FamilyScore | null
    onExecute: (order: TradeOrder) => Promise<void>
    onWatchlist?: () => void
    className?: string
    exchange?: string
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

/* ── Best signal from backend ── */
interface BestSignal {
    found: boolean
    strategy: string
    direction: string
    // Instrument
    instrumentType: string       // OPTION | FUTURES | EQUITY
    instrumentSymbol: string     // "RELIANCE CE2850" or "RELIANCE"
    optionType?: string          // CE | PE
    optionStrike?: number
    optionLtp?: number
    optionExpiry?: string
    optionScripCode?: string
    optionLotSize?: number
    // Equity reference
    scripCode: string
    symbol: string
    exchange: string
    entryPrice: number
    triggerPrice: number
    // Levels
    sl: number
    t1: number
    t2: number
    t3: number
    t4: number
    // Sizing
    lots: number
    lotSize: number
    multiplier: number
    // Quality
    confidence: number
    riskReward: number
    kiiScore?: number
    // Timing
    triggerTime: string
    signalAge: string
}

function getStr(m: Record<string, unknown>, key: string, fallback = ''): string {
    const v = m[key]
    return v !== undefined && v !== null ? String(v) : fallback
}
function getNum(m: Record<string, unknown>, key: string, fallback = 0): number {
    const v = m[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? fallback : n }
    return fallback
}

function parseBestSignal(raw: Record<string, unknown>): BestSignal | null {
    if (!raw.found) return null

    const strategy = getStr(raw, '_strategy')
    const hasOption = getNum(raw, 'optionLtp') > 0 || getStr(raw, 'optionScripCode') !== ''
    const hasFutures = getStr(raw, 'futuresScripCode') !== '' || getStr(raw, 'instrumentType') === 'FUTURES'

    let instrumentType = 'EQUITY'
    let instrumentSymbol = getStr(raw, 'symbol') || getStr(raw, 'companyName') || getStr(raw, 'scripCode')
    let displayLtp = getNum(raw, 'triggerPrice') || getNum(raw, 'entryPrice') || getNum(raw, 'entry')

    if (hasOption) {
        instrumentType = 'OPTION'
        const strike = getNum(raw, 'optionStrike')
        const optType = getStr(raw, 'optionType', 'CE')
        instrumentSymbol = `${getStr(raw, 'symbol') || getStr(raw, 'companyName')} ${optType}${strike}`
        displayLtp = getNum(raw, 'optionLtp')
    } else if (hasFutures) {
        instrumentType = 'FUTURES'
        instrumentSymbol = getStr(raw, 'futuresSymbol') || instrumentSymbol + ' FUT'
        displayLtp = getNum(raw, 'futuresLtp') || displayLtp
    }

    const direction = getStr(raw, 'direction', 'BULLISH')
    const isLong = direction === 'BULLISH' || direction === 'LONG'

    // Parse trigger time
    let triggerTime = ''
    let signalAge = ''
    const ts = getNum(raw, 'triggerTimeEpoch') || getNum(raw, 'timestamp') || getNum(raw, 'triggerTime')
    if (ts > 0) {
        const d = new Date(ts > 1e12 ? ts : ts * 1000)
        triggerTime = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        const ageMs = Date.now() - d.getTime()
        const ageMins = Math.floor(ageMs / 60000)
        signalAge = ageMins < 60 ? `${ageMins}m ago` : `${Math.floor(ageMins / 60)}h ${ageMins % 60}m ago`
    }

    return {
        found: true,
        strategy,
        direction: isLong ? 'LONG' : 'SHORT',
        instrumentType,
        instrumentSymbol,
        optionType: getStr(raw, 'optionType') || undefined,
        optionStrike: getNum(raw, 'optionStrike') || undefined,
        optionLtp: getNum(raw, 'optionLtp') || undefined,
        optionExpiry: getStr(raw, 'optionExpiry') || undefined,
        optionScripCode: getStr(raw, 'optionScripCode') || undefined,
        optionLotSize: getNum(raw, 'optionLotSize') || getNum(raw, 'lotSize') || undefined,
        scripCode: getStr(raw, 'scripCode'),
        symbol: getStr(raw, 'symbol') || getStr(raw, 'companyName'),
        exchange: getStr(raw, 'exchange', 'NSE'),
        entryPrice: displayLtp,
        triggerPrice: getNum(raw, 'triggerPrice') || getNum(raw, 'entryPrice') || getNum(raw, 'entry'),
        sl: getNum(raw, 'sl') || getNum(raw, 'stopLoss'),
        t1: getNum(raw, 't1') || getNum(raw, 'target1'),
        t2: getNum(raw, 't2') || getNum(raw, 'target2'),
        t3: getNum(raw, 't3') || getNum(raw, 'target3'),
        t4: getNum(raw, 't4') || getNum(raw, 'target4'),
        lots: getNum(raw, 'lots', 1),
        lotSize: getNum(raw, 'optionLotSize') || getNum(raw, 'lotSize', 1),
        multiplier: getNum(raw, 'optionMultiplier') || getNum(raw, 'multiplier', 1),
        confidence: getNum(raw, 'confidence'),
        riskReward: getNum(raw, 'riskReward') || getNum(raw, 'riskRewardRatio'),
        kiiScore: getNum(raw, 'kiiScore') || getNum(raw, 'compositeScore') || undefined,
        triggerTime,
        signalAge,
    }
}

const fmt = (v: number, dp = 2) => v > 0 ? v.toFixed(dp) : '—'

export default function EnhancedQuickTradePanel({
    score,
    onExecute,
    onWatchlist,
    className = '',
    exchange
}: EnhancedQuickTradePanelProps) {
    const [bestSignal, setBestSignal] = useState<BestSignal | null>(null)
    const [loading, setLoading] = useState(true)
    const [executing, setExecuting] = useState(false)
    const [showManualOverride, setShowManualOverride] = useState(false)

    // Manual override state
    const [manualDirection, setManualDirection] = useState<'LONG' | 'SHORT'>('LONG')
    const [manualEntry, setManualEntry] = useState(0)
    const [manualSL, setManualSL] = useState(0)
    const [manualTarget, setManualTarget] = useState(0)
    const [manualQty, setManualQty] = useState(1)

    const scripCode = score?.scripCode

    const fetchBestSignal = useCallback(async () => {
        if (!scripCode) return
        setLoading(true)
        try {
            const raw = await signalsApi.getBestSignal(scripCode)
            const parsed = parseBestSignal(raw)
            setBestSignal(parsed)
        } catch {
            setBestSignal(null)
        } finally {
            setLoading(false)
        }
    }, [scripCode])

    useEffect(() => { fetchBestSignal() }, [fetchBestSignal])

    // Refresh every 10s
    useEffect(() => {
        if (!scripCode) return
        const interval = setInterval(() => { if (exchange ? isExchangeOpen(exchange) : isAnyMarketOpen()) fetchBestSignal() }, 10000)
        return () => clearInterval(interval)
    }, [scripCode, fetchBestSignal])

    const handleExecute = async () => {
        if (!score || !bestSignal) return
        setExecuting(true)
        try {
            await onExecute({
                scripCode: bestSignal.optionScripCode || score.scripCode,
                direction: bestSignal.direction as 'LONG' | 'SHORT',
                entryPrice: bestSignal.entryPrice,
                stopLoss: bestSignal.sl,
                target: bestSignal.t1,
                quantity: bestSignal.lots * bestSignal.lotSize,
                horizon: 'INTRADAY',
            })
        } catch (err) {
            console.error('Trade execution failed:', err)
        } finally {
            setExecuting(false)
        }
    }

    const handleManualExecute = async () => {
        if (!score) return
        setExecuting(true)
        try {
            await onExecute({
                scripCode: score.scripCode,
                direction: manualDirection,
                entryPrice: manualEntry,
                stopLoss: manualSL,
                target: manualTarget,
                quantity: manualQty,
                horizon: 'INTRADAY',
            })
            setShowManualOverride(false)
        } catch (err) {
            console.error('Manual trade failed:', err)
        } finally {
            setExecuting(false)
        }
    }

    const isLong = bestSignal?.direction === 'LONG'
    const dirColor = isLong ? 'emerald' : 'red'

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden ${className}`}>
            {/* Header */}
            <div className="px-3 py-2 border-b border-slate-700/50 flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wide">Trade</h3>
                {bestSignal && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold bg-${dirColor}-500/10 text-${dirColor}-400`}>
                        {bestSignal.strategy}
                    </span>
                )}
            </div>

            <div className="p-3">
                {loading ? (
                    <div className="py-6 text-center">
                        <div className="text-xs text-slate-500 animate-pulse">Finding best signal...</div>
                    </div>
                ) : bestSignal ? (
                    /* ── SMART CTA: Active signal found ── */
                    <div className="space-y-3">
                        {/* Instrument + Direction */}
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-white">{bestSignal.instrumentSymbol}</div>
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                                    <span>{bestSignal.exchange}</span>
                                    <span className="text-slate-700">&bull;</span>
                                    <span>{bestSignal.instrumentType}</span>
                                    {bestSignal.triggerTime && (
                                        <>
                                            <span className="text-slate-700">&bull;</span>
                                            <span>{bestSignal.triggerTime}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className={`text-right`}>
                                <div className={`text-lg font-bold font-mono text-${dirColor}-400`}>
                                    {isLong ? '\u2191' : '\u2193'} {bestSignal.direction}
                                </div>
                                {bestSignal.signalAge && (
                                    <div className="text-[9px] text-slate-500">{bestSignal.signalAge}</div>
                                )}
                            </div>
                        </div>

                        {/* Entry price */}
                        <div className="bg-slate-700/30 rounded-lg p-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-500 uppercase">Entry</span>
                                <span className="text-sm font-bold font-mono text-white">
                                    \u20B9{fmt(bestSignal.entryPrice)}
                                </span>
                            </div>
                            {bestSignal.instrumentType === 'OPTION' && bestSignal.triggerPrice > 0 && (
                                <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[9px] text-slate-600">Equity ref</span>
                                    <span className="text-[10px] font-mono text-slate-400">
                                        \u20B9{fmt(bestSignal.triggerPrice)}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Levels grid */}
                        <div className="grid grid-cols-5 gap-1 text-center">
                            <div className="bg-red-500/5 rounded p-1.5">
                                <div className="text-[9px] text-red-400">SL</div>
                                <div className="text-[10px] font-mono font-bold text-red-400">
                                    {bestSignal.sl > 0 ? fmt(bestSignal.sl) : <DMValue />}
                                </div>
                            </div>
                            {[
                                { label: 'T1', value: bestSignal.t1 },
                                { label: 'T2', value: bestSignal.t2 },
                                { label: 'T3', value: bestSignal.t3 },
                                { label: 'T4', value: bestSignal.t4 },
                            ].map(t => (
                                <div key={t.label} className="bg-emerald-500/5 rounded p-1.5">
                                    <div className="text-[9px] text-emerald-400">{t.label}</div>
                                    <div className="text-[10px] font-mono font-bold text-emerald-400">
                                        {t.value > 0 ? fmt(t.value) : <DMValue />}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Stats row */}
                        <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">
                                R:R <span className="text-white font-bold">{bestSignal.riskReward > 0 ? bestSignal.riskReward.toFixed(1) : <DMValue />}</span>
                            </span>
                            <span className="text-slate-500">
                                Lots <span className="text-white font-bold">{bestSignal.lots}</span>
                                {bestSignal.lotSize > 1 && <span className="text-slate-600"> \u00D7 {bestSignal.lotSize}</span>}
                            </span>
                            {bestSignal.confidence > 0 && (
                                <span className="text-slate-500">
                                    Conf <span className="text-white font-bold">{(bestSignal.confidence * 100).toFixed(0)}%</span>
                                </span>
                            )}
                        </div>

                        {/* CTA Button */}
                        <button
                            onClick={handleExecute}
                            disabled={executing}
                            className={`w-full py-3 rounded-xl font-bold text-sm transition-all shadow-lg text-white
                                bg-gradient-to-r ${isLong
                                    ? 'from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 shadow-emerald-500/20'
                                    : 'from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 shadow-red-500/20'
                                } disabled:opacity-50 active:scale-[0.98]`}
                        >
                            {executing ? 'Executing...' : (
                                <>
                                    {isLong ? 'BUY' : 'SELL'} {bestSignal.instrumentSymbol} @ \u20B9{fmt(bestSignal.entryPrice)} \u00D7 {bestSignal.lots} lot{bestSignal.lots > 1 ? 's' : ''}
                                </>
                            )}
                        </button>

                        {/* Manual Override link */}
                        <button
                            onClick={() => {
                                setManualEntry(score?.close || bestSignal.triggerPrice || 0)
                                const price = score?.close || bestSignal.triggerPrice || 0
                                setManualSL(Number((price * (isLong ? 0.992 : 1.008)).toFixed(2)))
                                setManualTarget(Number((price * (isLong ? 1.015 : 0.985)).toFixed(2)))
                                setManualDirection(bestSignal.direction as 'LONG' | 'SHORT')
                                setManualQty(1)
                                setShowManualOverride(true)
                            }}
                            className="w-full py-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            Manual override...
                        </button>
                    </div>
                ) : (
                    /* ── NO SIGNAL: Show minimal state ── */
                    <div className="space-y-3">
                        <div className="py-4 text-center">
                            <div className="text-slate-500 text-xs mb-1">No active signal</div>
                            <div className="text-[10px] text-slate-600">
                                Waiting for strategy triggers on {score?.companyName || scripCode}
                            </div>
                        </div>

                        {/* Manual trade button */}
                        <button
                            onClick={() => {
                                const price = score?.close || 0
                                setManualEntry(price)
                                setManualSL(Number((price * 0.992).toFixed(2)))
                                setManualTarget(Number((price * 1.015).toFixed(2)))
                                setManualDirection('LONG')
                                setManualQty(1)
                                setShowManualOverride(true)
                            }}
                            className="w-full py-2.5 rounded-xl text-sm font-medium text-slate-400
                                border border-slate-600 hover:border-slate-500 hover:text-white transition-all"
                        >
                            Place Manual Trade
                        </button>

                        {onWatchlist && (
                            <button
                                onClick={onWatchlist}
                                className="w-full py-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                + Add to Watchlist
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── MANUAL OVERRIDE POPUP ── */}
            {showManualOverride && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
                    onClick={() => setShowManualOverride(false)}
                >
                    <div
                        className="bg-slate-800 border border-slate-700 rounded-2xl p-5 w-[360px] shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4">
                            Manual Trade — {score?.companyName || scripCode}
                        </h3>

                        {/* Direction */}
                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <button
                                onClick={() => setManualDirection('LONG')}
                                className={`py-3 rounded-xl font-bold transition-all ${manualDirection === 'LONG'
                                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                                    : 'bg-slate-700 text-slate-400 hover:bg-emerald-500/20'
                                }`}
                            >
                                LONG \u2191
                            </button>
                            <button
                                onClick={() => setManualDirection('SHORT')}
                                className={`py-3 rounded-xl font-bold transition-all ${manualDirection === 'SHORT'
                                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                    : 'bg-slate-700 text-slate-400 hover:bg-red-500/20'
                                }`}
                            >
                                SHORT \u2193
                            </button>
                        </div>

                        {/* Price Inputs */}
                        <div className="space-y-2 mb-4">
                            <PriceInput label="Entry" value={manualEntry} onChange={setManualEntry} />
                            <PriceInput label="Stop Loss" value={manualSL} onChange={setManualSL} color="red" />
                            <PriceInput label="Target" value={manualTarget} onChange={setManualTarget} color="green" />
                        </div>

                        {/* Quantity */}
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-sm text-slate-400">Quantity</span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setManualQty(Math.max(1, manualQty - 1))}
                                    className="w-8 h-8 rounded-lg bg-slate-700 text-white hover:bg-slate-600 font-bold">-</button>
                                <span className="w-10 text-center font-bold text-white">{manualQty}</span>
                                <button onClick={() => setManualQty(manualQty + 1)}
                                    className="w-8 h-8 rounded-lg bg-slate-700 text-white hover:bg-slate-600 font-bold">+</button>
                            </div>
                        </div>

                        {/* R:R display */}
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-4">
                            <span>Risk: <span className="text-red-400 font-bold">\u20B9{Math.abs(manualEntry - manualSL).toFixed(0)}</span></span>
                            <span>Reward: <span className="text-emerald-400 font-bold">\u20B9{Math.abs(manualTarget - manualEntry).toFixed(0)}</span></span>
                            <span>R:R: <span className="text-white font-bold">
                                {Math.abs(manualEntry - manualSL) > 0
                                    ? (Math.abs(manualTarget - manualEntry) / Math.abs(manualEntry - manualSL)).toFixed(1)
                                    : '\u2014'}
                            </span></span>
                        </div>

                        {/* Buttons */}
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowManualOverride(false)}
                                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 border border-slate-600 hover:border-slate-500"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleManualExecute}
                                disabled={executing || manualEntry <= 0}
                                className={`flex-1 py-2.5 rounded-xl font-bold text-sm text-white transition-all
                                    ${manualDirection === 'LONG'
                                        ? 'bg-emerald-500 hover:bg-emerald-600'
                                        : 'bg-red-500 hover:bg-red-600'
                                    } disabled:opacity-50`}
                            >
                                {executing ? 'Executing...' : `${manualDirection === 'LONG' ? 'BUY' : 'SELL'} @ \u20B9${manualEntry.toFixed(2)}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
