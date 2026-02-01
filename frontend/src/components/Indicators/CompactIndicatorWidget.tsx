import React from 'react'
import type { TechnicalIndicators } from '../../types/indicators'

interface Props {
  indicators: TechnicalIndicators;
  compact?: boolean;  // Ultra-compact for table rows
}

/**
 * Compact widget showing technical indicator summary.
 * Can be used in watchlist tables or dashboard cards.
 */
export const CompactIndicatorWidget: React.FC<Props> = ({
  indicators,
  compact = false
}) => {
  const { bollingerBands: bb, vwap, superTrend } = indicators

  // Ultra-compact mode for watchlist table rows
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        {/* SuperTrend */}
        <span className={`px-1.5 py-0.5 rounded font-medium ${
          superTrend.direction === 'BULLISH'
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-red-500/20 text-red-400'
        }`} title={`SuperTrend: ${superTrend.value.toFixed(2)}`}>
          ST {superTrend.direction === 'BULLISH' ? '↑' : '↓'}
          {superTrend.reversal && <span className="text-yellow-400 ml-0.5">!</span>}
        </span>

        {/* Bollinger %B */}
        <span className={`px-1.5 py-0.5 rounded ${
          bb.squeeze ? 'bg-yellow-500/20 text-yellow-400' :
          bb.percentB > 0.8 ? 'bg-red-500/20 text-red-400' :
          bb.percentB < 0.2 ? 'bg-emerald-500/20 text-emerald-400' :
          'bg-slate-700 text-slate-300'
        }`} title={`BB %B: ${(bb.percentB * 100).toFixed(1)}%`}>
          BB {(bb.percentB * 100).toFixed(0)}%
          {bb.squeeze && <span className="text-yellow-400 ml-0.5">*</span>}
        </span>

        {/* VWAP */}
        <span className={`px-1.5 py-0.5 rounded ${
          vwap.signal === 'ABOVE_VWAP' || vwap.signal === 'ABOVE_UPPER' ? 'bg-emerald-500/20 text-emerald-400' :
          'bg-red-500/20 text-red-400'
        }`} title={`VWAP: ${vwap.value.toFixed(2)} (${vwap.signal})`}>
          VW {vwap.deviation >= 0 ? '+' : ''}{vwap.deviation.toFixed(1)}%
        </span>
      </div>
    )
  }

  // Standard compact widget (for cards)
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      {/* SuperTrend */}
      <div className={`p-2 rounded-lg ${
        superTrend.direction === 'BULLISH'
          ? 'bg-emerald-500/10 border border-emerald-500/30'
          : 'bg-red-500/10 border border-red-500/30'
      }`}>
        <div className="text-slate-400 text-[10px] mb-0.5">SuperTrend</div>
        <div className={`font-semibold ${
          superTrend.direction === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {superTrend.direction}
          {superTrend.reversal && (
            <span className="ml-1 text-yellow-400" title="Just reversed!">&#9889;</span>
          )}
        </div>
        <div className="text-slate-500 text-[10px] mt-0.5">
          {superTrend.value.toFixed(2)}
        </div>
      </div>

      {/* Bollinger Bands */}
      <div className={`p-2 rounded-lg ${
        bb.squeeze
          ? 'bg-yellow-500/10 border border-yellow-500/30'
          : bb.percentB > 0.8
            ? 'bg-red-500/10 border border-red-500/30'
            : bb.percentB < 0.2
              ? 'bg-emerald-500/10 border border-emerald-500/30'
              : 'bg-purple-500/10 border border-purple-500/30'
      }`}>
        <div className="text-slate-400 text-[10px] mb-0.5">BB %B</div>
        <div className={`font-semibold ${
          bb.percentB > 0.8 ? 'text-red-400' :
          bb.percentB < 0.2 ? 'text-emerald-400' :
          'text-purple-400'
        }`}>
          {(bb.percentB * 100).toFixed(1)}%
          {bb.squeeze && (
            <span className="ml-1 text-yellow-400" title="Squeeze detected!">&#128293;</span>
          )}
        </div>
        <div className="text-slate-500 text-[10px] mt-0.5">
          {bb.squeeze ? 'Squeeze' : bb.percentB > 0.8 ? 'Overbought' : bb.percentB < 0.2 ? 'Oversold' : 'Normal'}
        </div>
      </div>

      {/* VWAP */}
      <div className={`p-2 rounded-lg ${
        vwap.signal === 'ABOVE_UPPER'
          ? 'bg-red-500/10 border border-red-500/30'
          : vwap.signal === 'ABOVE_VWAP'
            ? 'bg-emerald-500/10 border border-emerald-500/30'
            : vwap.signal === 'BELOW_VWAP'
              ? 'bg-amber-500/10 border border-amber-500/30'
              : 'bg-red-500/10 border border-red-500/30'
      }`}>
        <div className="text-slate-400 text-[10px] mb-0.5">VWAP</div>
        <div className={`font-semibold ${
          vwap.signal === 'ABOVE_VWAP' || vwap.signal === 'ABOVE_UPPER'
            ? 'text-emerald-400'
            : 'text-red-400'
        }`}>
          {vwap.deviation >= 0 ? '+' : ''}{vwap.deviation.toFixed(2)}%
        </div>
        <div className="text-slate-500 text-[10px] mt-0.5">
          {vwap.signal.replace(/_/g, ' ')}
        </div>
      </div>
    </div>
  )
}

export default CompactIndicatorWidget
