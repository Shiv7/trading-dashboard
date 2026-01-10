import { useState } from 'react'

interface TimeframeData {
    tf: string
    bias: 'BUY' | 'SELL' | 'NEUTRAL'
    strength: number
    pivotR3?: number
    pivotR2?: number
    pivotR1?: number
    pivotP?: number
    pivotS1?: number
    pivotS2?: number
    pivotS3?: number
    vwap?: number
    ema20?: number
    ema50?: number
    rsi?: number
    macdSignal?: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
}

interface EnhancedMTFPanelProps {
    scripCode: string
    currentPrice: number
    timeframes?: TimeframeData[]
    onTimeframeClick?: (tf: string) => void
    className?: string
}

// Default with mock pivot data
const generateDefaultTimeframes = (price: number): TimeframeData[] => {
    const base = price
    return [
        {
            tf: '1m', bias: 'BUY', strength: 78,
            pivotR3: base * 1.015, pivotR2: base * 1.01, pivotR1: base * 1.005,
            pivotP: base, pivotS1: base * 0.995, pivotS2: base * 0.99, pivotS3: base * 0.985,
            vwap: base * 1.002, ema20: base * 0.998, ema50: base * 0.995, rsi: 62, macdSignal: 'BULLISH'
        },
        {
            tf: '5m', bias: 'BUY', strength: 72,
            pivotR3: base * 1.02, pivotR2: base * 1.015, pivotR1: base * 1.008,
            pivotP: base * 1.001, pivotS1: base * 0.992, pivotS2: base * 0.985, pivotS3: base * 0.978,
            vwap: base * 1.003, ema20: base * 0.997, ema50: base * 0.994, rsi: 58, macdSignal: 'BULLISH'
        },
        {
            tf: '15m', bias: 'NEUTRAL', strength: 50,
            pivotR3: base * 1.025, pivotR2: base * 1.018, pivotR1: base * 1.01,
            pivotP: base * 1.002, pivotS1: base * 0.99, pivotS2: base * 0.982, pivotS3: base * 0.974,
            vwap: base * 1.001, ema20: base * 0.999, ema50: base * 0.996, rsi: 52, macdSignal: 'NEUTRAL'
        },
        {
            tf: '30m', bias: 'SELL', strength: 42,
            pivotR3: base * 1.03, pivotR2: base * 1.022, pivotR1: base * 1.014,
            pivotP: base * 1.005, pivotS1: base * 0.988, pivotS2: base * 0.978, pivotS3: base * 0.968,
            vwap: base * 0.998, ema20: base * 1.002, ema50: base * 1.005, rsi: 45, macdSignal: 'BEARISH'
        },
        {
            tf: '1H', bias: 'SELL', strength: 38,
            pivotR3: base * 1.04, pivotR2: base * 1.028, pivotR1: base * 1.016,
            pivotP: base * 1.008, pivotS1: base * 0.985, pivotS2: base * 0.972, pivotS3: base * 0.96,
            vwap: base * 0.995, ema20: base * 1.008, ema50: base * 1.015, rsi: 42, macdSignal: 'BEARISH'
        },
        {
            tf: '4H', bias: 'SELL', strength: 32,
            pivotR3: base * 1.06, pivotR2: base * 1.04, pivotR1: base * 1.02,
            pivotP: base * 1.01, pivotS1: base * 0.98, pivotS2: base * 0.96, pivotS3: base * 0.94,
            vwap: base * 0.99, ema20: base * 1.015, ema50: base * 1.025, rsi: 38, macdSignal: 'BEARISH'
        },
        {
            tf: '1D', bias: 'SELL', strength: 28,
            pivotR3: base * 1.08, pivotR2: base * 1.06, pivotR1: base * 1.03,
            pivotP: base * 1.015, pivotS1: base * 0.97, pivotS2: base * 0.94, pivotS3: base * 0.91,
            vwap: base * 0.985, ema20: base * 1.02, ema50: base * 1.035, rsi: 35, macdSignal: 'BEARISH'
        },
    ]
}

type TradingHorizon = 'SCALP' | 'INTRADAY' | 'SWING' | 'POSITION'

export default function EnhancedMTFPanel({
    scripCode: _scripCode,
    currentPrice,
    timeframes,
    onTimeframeClick: _onTimeframeClick,
    className = ''
}: EnhancedMTFPanelProps) {
    const [expandedTF, setExpandedTF] = useState<string | null>(null)
    const [selectedHorizon, setSelectedHorizon] = useState<TradingHorizon>('INTRADAY')

    const data = timeframes || generateDefaultTimeframes(currentPrice)

    // Calculate consensus based on horizon
    const getHorizonTimeframes = (horizon: TradingHorizon) => {
        switch (horizon) {
            case 'SCALP': return ['1m', '5m']
            case 'INTRADAY': return ['5m', '15m', '30m']
            case 'SWING': return ['1H', '4H', '1D']
            case 'POSITION': return ['4H', '1D']
        }
    }

    const relevantTFs = getHorizonTimeframes(selectedHorizon)
    const relevantData = data.filter(d => relevantTFs.includes(d.tf))
    const buyCount = relevantData.filter(d => d.bias === 'BUY').length
    const sellCount = relevantData.filter(d => d.bias === 'SELL').length
    const consensus = buyCount > sellCount ? 'BULLISH' : sellCount > buyCount ? 'BEARISH' : 'NEUTRAL'

    const getBiasColor = (bias: 'BUY' | 'SELL' | 'NEUTRAL') => {
        switch (bias) {
            case 'BUY': return 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
            case 'SELL': return 'bg-red-500/20 border-red-500/50 text-red-400'
            default: return 'bg-slate-700/50 border-slate-600/50 text-slate-400'
        }
    }

    const getBarColor = (bias: 'BUY' | 'SELL' | 'NEUTRAL') => {
        switch (bias) {
            case 'BUY': return 'bg-emerald-500'
            case 'SELL': return 'bg-red-500'
            default: return 'bg-slate-500'
        }
    }

    const formatPrice = (p?: number) => p?.toFixed(2) || '—'

    return (
        <div className={`bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden ${className}`}>
            {/* Header */}
            <div className="p-4 border-b border-slate-700/50">
                <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3">
                    Multi-Timeframe Analysis
                </h3>

                {/* Trading Horizon Selector */}
                <div className="flex gap-1 bg-slate-700/30 rounded-lg p-1">
                    {(['SCALP', 'INTRADAY', 'SWING', 'POSITION'] as const).map(horizon => (
                        <button
                            key={horizon}
                            onClick={() => setSelectedHorizon(horizon)}
                            className={`flex-1 py-2 px-2 rounded-md text-xs font-medium transition-all ${selectedHorizon === horizon
                                ? horizon === 'SCALP' ? 'bg-purple-500 text-white' :
                                    horizon === 'INTRADAY' ? 'bg-blue-500 text-white' :
                                        horizon === 'SWING' ? 'bg-amber-500 text-white' :
                                            'bg-emerald-500 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-slate-600/50'
                                }`}
                        >
                            {horizon}
                        </button>
                    ))}
                </div>

                {/* Horizon Info */}
                <div className="mt-3 p-2 rounded-lg bg-slate-700/30 text-xs text-slate-400">
                    {selectedHorizon === 'SCALP' && '⚡ 1-15 min holds | Focus: 1m, 5m | Quick in-out'}
                    {selectedHorizon === 'INTRADAY' && '📊 15 min - 4 hr holds | Focus: 5m, 15m, 30m | Day trades'}
                    {selectedHorizon === 'SWING' && '🌊 1-5 day holds | Focus: 1H, 4H, 1D | Trend following'}
                    {selectedHorizon === 'POSITION' && '📈 Week+ holds | Focus: 4H, 1D | Major moves'}
                </div>
            </div>

            {/* Timeframes */}
            <div className="p-4 space-y-2">
                {data.map((tf) => {
                    const isRelevant = relevantTFs.includes(tf.tf)
                    const isExpanded = expandedTF === tf.tf

                    return (
                        <div key={tf.tf} className={`transition-opacity ${isRelevant ? 'opacity-100' : 'opacity-40'}`}>
                            {/* Timeframe Row */}
                            <div
                                onClick={() => setExpandedTF(isExpanded ? null : tf.tf)}
                                className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-all
                  ${isExpanded ? 'ring-1 ring-blue-500' : ''} ${getBiasColor(tf.bias)}`}
                            >
                                <span className="w-10 text-xs font-bold text-white">{tf.tf}</span>
                                <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all duration-500 ${getBarColor(tf.bias)}`}
                                        style={{ width: `${tf.strength}%` }}
                                    />
                                </div>
                                <span className="w-20 text-xs font-medium text-right">
                                    {tf.bias} <span className="text-slate-400">({tf.strength}%)</span>
                                </span>
                                <span className="text-xs text-slate-400">{isExpanded ? '▼' : '▶'}</span>
                            </div>

                            {/* Expanded Details */}
                            {isExpanded && (
                                <div className="mt-2 p-3 bg-slate-900/50 rounded-lg border border-slate-600/30 animate-fadeIn">
                                    {/* Pivots */}
                                    <div className="mb-3">
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                                            Pivot Levels ({tf.tf})
                                        </div>
                                        <div className="grid grid-cols-7 gap-1 text-center text-xs">
                                            <div className="p-2 bg-red-500/10 rounded">
                                                <div className="text-red-400 font-bold">R3</div>
                                                <div className="text-white">{formatPrice(tf.pivotR3)}</div>
                                            </div>
                                            <div className="p-2 bg-red-500/10 rounded">
                                                <div className="text-red-400 font-bold">R2</div>
                                                <div className="text-white">{formatPrice(tf.pivotR2)}</div>
                                            </div>
                                            <div className="p-2 bg-red-500/10 rounded">
                                                <div className="text-red-400 font-bold">R1</div>
                                                <div className="text-white">{formatPrice(tf.pivotR1)}</div>
                                            </div>
                                            <div className="p-2 bg-blue-500/20 rounded">
                                                <div className="text-blue-400 font-bold">P</div>
                                                <div className="text-white">{formatPrice(tf.pivotP)}</div>
                                            </div>
                                            <div className="p-2 bg-emerald-500/10 rounded">
                                                <div className="text-emerald-400 font-bold">S1</div>
                                                <div className="text-white">{formatPrice(tf.pivotS1)}</div>
                                            </div>
                                            <div className="p-2 bg-emerald-500/10 rounded">
                                                <div className="text-emerald-400 font-bold">S2</div>
                                                <div className="text-white">{formatPrice(tf.pivotS2)}</div>
                                            </div>
                                            <div className="p-2 bg-emerald-500/10 rounded">
                                                <div className="text-emerald-400 font-bold">S3</div>
                                                <div className="text-white">{formatPrice(tf.pivotS3)}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Indicators */}
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div className="space-y-1">
                                            <div className="text-slate-400">VWAP</div>
                                            <div className={`font-bold ${currentPrice > (tf.vwap || 0) ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {formatPrice(tf.vwap)}
                                                <span className="text-slate-500 ml-1">
                                                    ({currentPrice > (tf.vwap || 0) ? 'Above' : 'Below'})
                                                </span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-slate-400">RSI</div>
                                            <div className={`font-bold ${(tf.rsi || 50) > 70 ? 'text-red-400' :
                                                (tf.rsi || 50) < 30 ? 'text-emerald-400' : 'text-slate-300'
                                                }`}>
                                                {tf.rsi || '—'}
                                                <span className="text-slate-500 ml-1">
                                                    ({(tf.rsi || 50) > 70 ? 'Overbought' : (tf.rsi || 50) < 30 ? 'Oversold' : 'Neutral'})
                                                </span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-slate-400">EMA 20</div>
                                            <div className={`font-bold ${currentPrice > (tf.ema20 || 0) ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {formatPrice(tf.ema20)}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-slate-400">MACD</div>
                                            <div className={`font-bold ${tf.macdSignal === 'BULLISH' ? 'text-emerald-400' :
                                                tf.macdSignal === 'BEARISH' ? 'text-red-400' : 'text-slate-400'
                                                }`}>
                                                {tf.macdSignal}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Current vs Pivot */}
                                    <div className="mt-3 p-2 bg-slate-800/50 rounded text-xs">
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-400">Current Price</span>
                                            <span className="text-white font-bold">₹{currentPrice.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                            <span className="text-slate-400">Nearest Level</span>
                                            <span className={`font-bold ${currentPrice > (tf.pivotP || 0) ? 'text-emerald-400' : 'text-red-400'
                                                }`}>
                                                {currentPrice > (tf.pivotP || 0) ? `Above P (${formatPrice(tf.pivotP)})` : `Below P (${formatPrice(tf.pivotP)})`}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Consensus Footer */}
            <div className="p-4 border-t border-slate-700/50 bg-slate-900/30">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs text-slate-400 uppercase tracking-wide">
                            {selectedHorizon} Consensus
                        </div>
                        <div className={`text-lg font-bold ${consensus === 'BULLISH' ? 'text-emerald-400' :
                            consensus === 'BEARISH' ? 'text-red-400' : 'text-slate-400'
                            }`}>
                            {consensus}
                        </div>
                    </div>
                    <div className={`px-4 py-2 rounded-lg text-sm font-bold ${consensus === 'BULLISH'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        consensus === 'BEARISH'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-slate-700 text-slate-400 border border-slate-600'
                        }`}>
                        {consensus === 'BULLISH' ? '🐂 GO LONG' :
                            consensus === 'BEARISH' ? '🐻 GO SHORT' : '⏸️ WAIT'}
                    </div>
                </div>
            </div>
        </div>
    )
}
