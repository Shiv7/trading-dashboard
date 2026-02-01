import React from 'react'

export interface IndicatorToggles {
  bollingerBands: boolean;
  vwap: boolean;
  superTrend: boolean;
}

interface Props {
  toggles: IndicatorToggles;
  onToggle: (indicator: keyof IndicatorToggles) => void;
  disabled?: boolean;
}

/**
 * Toggle controls for chart indicator overlays.
 * Allows users to show/hide Bollinger Bands, VWAP, and SuperTrend on price charts.
 */
export const IndicatorControls: React.FC<Props> = ({
  toggles,
  onToggle,
  disabled = false
}) => {
  const indicators = [
    {
      key: 'superTrend' as const,
      label: 'SuperTrend',
      shortLabel: 'ST',
      color: 'amber',
      bgActive: 'bg-amber-500/20',
      textActive: 'text-amber-400',
      borderActive: 'border-amber-500/50',
    },
    {
      key: 'bollingerBands' as const,
      label: 'Bollinger Bands',
      shortLabel: 'BB',
      color: 'purple',
      bgActive: 'bg-purple-500/20',
      textActive: 'text-purple-400',
      borderActive: 'border-purple-500/50',
    },
    {
      key: 'vwap' as const,
      label: 'VWAP',
      shortLabel: 'VWAP',
      color: 'cyan',
      bgActive: 'bg-cyan-500/20',
      textActive: 'text-cyan-400',
      borderActive: 'border-cyan-500/50',
    },
  ]

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 mr-1">Overlays:</span>
      {indicators.map(({ key, label, shortLabel, bgActive, textActive, borderActive }) => (
        <button
          key={key}
          onClick={() => !disabled && onToggle(key)}
          disabled={disabled}
          title={label}
          className={`
            px-2 py-1 rounded text-xs font-medium
            flex items-center gap-1.5 transition-all duration-200
            border
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105'}
            ${toggles[key]
              ? `${bgActive} ${textActive} ${borderActive}`
              : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600'
            }
          `}
        >
          <span className={`
            w-2 h-2 rounded-full transition-opacity
            ${key === 'superTrend' ? 'bg-amber-500' :
              key === 'bollingerBands' ? 'bg-purple-500' : 'bg-cyan-500'}
            ${toggles[key] ? 'opacity-100' : 'opacity-30'}
          `} />
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{shortLabel}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Compact version for mobile/tight spaces
 */
export const IndicatorControlsCompact: React.FC<Props> = ({
  toggles,
  onToggle,
  disabled = false
}) => {
  return (
    <div className="flex items-center gap-1">
      {(['superTrend', 'bollingerBands', 'vwap'] as const).map((key) => {
        const colors = {
          superTrend: { active: 'bg-amber-500', inactive: 'bg-slate-600' },
          bollingerBands: { active: 'bg-purple-500', inactive: 'bg-slate-600' },
          vwap: { active: 'bg-cyan-500', inactive: 'bg-slate-600' },
        }
        const labels = {
          superTrend: 'ST',
          bollingerBands: 'BB',
          vwap: 'VW',
        }

        return (
          <button
            key={key}
            onClick={() => !disabled && onToggle(key)}
            disabled={disabled}
            title={key === 'superTrend' ? 'SuperTrend' : key === 'bollingerBands' ? 'Bollinger Bands' : 'VWAP'}
            className={`
              w-7 h-7 rounded-full text-[10px] font-bold
              flex items-center justify-center
              transition-all duration-200
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              ${toggles[key]
                ? `${colors[key].active} text-white shadow-lg`
                : `${colors[key].inactive} text-slate-400 hover:bg-slate-500`
              }
            `}
          >
            {labels[key]}
          </button>
        )
      })}
    </div>
  )
}

export default IndicatorControls
