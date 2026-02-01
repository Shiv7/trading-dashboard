import React from 'react'
import type { TechnicalIndicators } from '../../types/indicators'

const TIMEFRAME_OPTIONS = ['1m', '5m', '15m', '30m'] as const

interface Props {
  indicators: TechnicalIndicators | null;
  currentPrice: number;
  loading?: boolean;
  timeframe?: string;  // e.g., '5m', '15m', '1h'
  onTimeframeChange?: (timeframe: string) => void;
}

/**
 * Panel displaying technical indicators: SuperTrend, Bollinger Bands, and VWAP.
 * Shows real-time values with visual gauges and status indicators.
 */
export const TechnicalIndicatorsPanel: React.FC<Props> = ({
  indicators,
  currentPrice,
  loading = false,
  timeframe = '5m',
  onTimeframeChange
}) => {
  const TimeframeSelector = () => (
    <div className="flex gap-1">
      {TIMEFRAME_OPTIONS.map((tf) => (
        <button
          key={tf}
          onClick={() => onTimeframeChange?.(tf)}
          className={`px-2 py-0.5 text-xs rounded transition-colors ${
            timeframe === tf
              ? 'bg-cyan-500/30 text-cyan-400 font-medium'
              : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600/50 hover:text-slate-300'
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  )
  if (loading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-32 mb-4" />
        <div className="space-y-4">
          <div className="h-20 bg-slate-700/50 rounded" />
          <div className="h-24 bg-slate-700/50 rounded" />
          <div className="h-20 bg-slate-700/50 rounded" />
        </div>
      </div>
    )
  }

  if (!indicators) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wide">
            Technical Indicators
          </h3>
          <TimeframeSelector />
        </div>
        <div className="text-center py-8 text-slate-400 text-sm">
          No indicator data available
        </div>
      </div>
    )
  }

  const { bollingerBands: bb, vwap, superTrend } = indicators

  // Helper to safely format numbers
  const fmt = (val: unknown, decimals = 2): string => {
    if (val === null || val === undefined) return 'N/A'
    const num = Number(val)
    return isNaN(num) ? 'N/A' : num.toFixed(decimals)
  }

  // Check if we have valid nested data
  const hasBB = bb && typeof bb.upper === 'number'
  const hasVwap = vwap && typeof vwap.value === 'number'
  const hasSuperTrend = superTrend && typeof superTrend.value === 'number'

  // Calculate %B position for gauge (clamp between 0 and 100)
  const percentBPosition = hasBB ? Math.min(Math.max((bb.percentB || 0) * 100, 0), 100) : 50

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">
          Technical Indicators
        </h3>
        <div className="flex items-center gap-2">
          {indicators.dataQuality && !indicators.dataQuality.sufficient && (
            <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded">
              Limited Data
            </span>
          )}
          <TimeframeSelector />
        </div>
      </div>

      {/* SuperTrend Section */}
      <div className="border-l-4 border-amber-500 pl-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-slate-400 text-sm">SuperTrend</span>
          {hasSuperTrend ? (
            <span className={`font-bold text-sm ${
              superTrend.direction === 'BULLISH'
                ? 'text-emerald-400'
                : 'text-red-400'
            }`}>
              {superTrend.direction}
              {superTrend.reversal && (
                <span className="ml-1 text-yellow-400" title="Just flipped!">
                  &#x21BB;
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-500 text-sm">No data</span>
          )}
        </div>
        {hasSuperTrend ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500 block">Level</span>
                <span className="text-white font-medium">{fmt(superTrend.value)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">ATR(14)</span>
                <span className="text-white font-medium">{fmt(superTrend.atr)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">ATR %</span>
                <span className="text-white font-medium">{fmt(superTrend.atrPercent)}%</span>
              </div>
              <div>
                <span className="text-slate-500 block">Candles</span>
                <span className="text-white font-medium">{superTrend.candlesSinceFlip ?? 'N/A'}</span>
              </div>
            </div>
            {/* SuperTrend vs Price indicator */}
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-slate-500">Price vs ST:</span>
              {currentPrice > superTrend.value ? (
                <span className="text-emerald-400">
                  +{fmt((currentPrice - superTrend.value) / superTrend.value * 100)}% above
                </span>
              ) : (
                <span className="text-red-400">
                  {fmt((currentPrice - superTrend.value) / superTrend.value * 100)}% below
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-500 py-2">No SuperTrend data for this timeframe</div>
        )}
      </div>

      {/* Bollinger Bands Section */}
      <div className="border-l-4 border-purple-500 pl-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-slate-400 text-sm">Bollinger Bands (20,2)</span>
          {hasBB && bb.squeeze && (
            <span className="text-xs px-2 py-0.5 bg-yellow-400/20 text-yellow-400 rounded animate-pulse">
              SQUEEZE
            </span>
          )}
        </div>
        {hasBB ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-xs mt-2">
              <div className="text-center">
                <span className="text-red-400 block text-[10px]">Upper</span>
                <span className="text-red-400 font-medium">{fmt(bb.upper)}</span>
              </div>
              <div className="text-center">
                <span className="text-slate-400 block text-[10px]">Middle</span>
                <span className="text-white font-medium">{fmt(bb.middle)}</span>
              </div>
              <div className="text-center">
                <span className="text-emerald-400 block text-[10px]">Lower</span>
                <span className="text-emerald-400 font-medium">{fmt(bb.lower)}</span>
              </div>
            </div>
            {/* %B Gauge */}
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">%B</span>
                <span className={`font-medium ${
                  (bb.percentB || 0) > 1 ? 'text-red-400' :
                  (bb.percentB || 0) < 0 ? 'text-emerald-400' : 'text-white'
                }`}>
                  {fmt((bb.percentB || 0) * 100, 1)}%
                </span>
              </div>
              <div className="h-2.5 bg-slate-700 rounded-full relative overflow-hidden">
                {/* Background gradient */}
                <div
                  className="absolute h-full w-full"
                  style={{
                    background: 'linear-gradient(to right, #10b981, #64748b, #ef4444)'
                  }}
                />
                {/* Position marker */}
                <div
                  className="absolute h-full w-1 bg-white rounded shadow-lg"
                  style={{
                    left: `${percentBPosition}%`,
                    transform: 'translateX(-50%)',
                    boxShadow: '0 0 4px rgba(255,255,255,0.5)'
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                <span>Oversold</span>
                <span>Overbought</span>
              </div>
            </div>
            {/* BB Width */}
            <div className="flex justify-between text-xs mt-2">
              <span className="text-slate-500">Width</span>
              <span className="text-white">{fmt((bb.widthPct || 0) * 100)}%</span>
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-500 py-2">No Bollinger Bands data for this timeframe</div>
        )}
      </div>

      {/* VWAP Section */}
      <div className="border-l-4 border-cyan-500 pl-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-slate-400 text-sm">VWAP</span>
          {hasVwap ? (
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
              vwap.signal === 'ABOVE_UPPER' ? 'bg-red-500/20 text-red-400' :
              vwap.signal === 'ABOVE_VWAP' ? 'bg-emerald-500/20 text-emerald-400' :
              vwap.signal === 'BELOW_VWAP' ? 'bg-amber-500/20 text-amber-400' :
              vwap.signal === 'BELOW_LOWER' ? 'bg-red-500/20 text-red-400' :
              'bg-slate-700 text-slate-400'
            }`}>
              {(vwap.signal || 'UNKNOWN').replace(/_/g, ' ')}
            </span>
          ) : (
            <span className="text-slate-500 text-sm">No data</span>
          )}
        </div>
        {hasVwap ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-xs mt-2">
              <div className="text-center">
                <span className="text-red-400 block text-[10px]">+1&sigma;</span>
                <span className="text-red-400 font-medium">{fmt(vwap.upperBand)}</span>
              </div>
              <div className="text-center">
                <span className="text-cyan-400 block text-[10px]">VWAP</span>
                <span className="text-cyan-400 font-semibold">{fmt(vwap.value)}</span>
              </div>
              <div className="text-center">
                <span className="text-emerald-400 block text-[10px]">-1&sigma;</span>
                <span className="text-emerald-400 font-medium">{fmt(vwap.lowerBand)}</span>
              </div>
            </div>
            {/* VWAP Deviation */}
            <div className="flex justify-between text-xs mt-2">
              <span className="text-slate-500">Distance from VWAP</span>
              <span className={(vwap.deviation || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {(vwap.deviation || 0) >= 0 ? '+' : ''}{fmt(vwap.deviation)}%
              </span>
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-500 py-2">No VWAP data for this timeframe</div>
        )}
      </div>

      {/* Data Quality Warning */}
      {indicators.dataQuality && !indicators.dataQuality.sufficient && (
        <div className="text-xs text-amber-400 bg-amber-500/10 p-2 rounded">
          Indicators based on {indicators.dataQuality.actualCandleCount} of {indicators.dataQuality.requiredCandleCount} required candles. Values may be less reliable.
        </div>
      )}
    </div>
  )
}

export default TechnicalIndicatorsPanel
