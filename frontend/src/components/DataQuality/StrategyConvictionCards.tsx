/**
 * StrategyConvictionCards — Per-strategy cards showing score, DQ%, data inputs,
 * fallback indicators, fire status. One card for each of FUDKII/FUKAA/FUDKOI/MERE/MicroAlpha.
 */

import type { OverallDQ, StrategyDQ } from './dataQualityUtils'
import { DMValue } from './ProvenanceTag'

interface StrategyConvictionCardsProps {
  dq: OverallDQ
  className?: string
}

function getDirectionBadge(dir: string) {
  if (dir === 'BULLISH') return { text: 'BULL', color: 'bg-emerald-500/10 text-emerald-400' }
  if (dir === 'BEARISH') return { text: 'BEAR', color: 'bg-red-500/10 text-red-400' }
  return { text: 'NEUT', color: 'bg-slate-700 text-slate-400' }
}

function getDQBarColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500'
  if (pct >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

function FieldRow({ entry }: { entry: { field: string; value: string | number | null; status: string; reason?: string } }) {
  const statusColors: Record<string, string> = {
    LIVE: 'text-emerald-400',
    FALLBACK: 'text-amber-400',
    DM: 'text-red-400',
    SWAP: 'text-blue-400',
    BOOT: 'text-slate-400',
    REDIS: 'text-slate-400',
  }
  const color = statusColors[entry.status] || 'text-slate-500'

  return (
    <div className="flex items-center justify-between text-[10px] leading-tight">
      <span className="text-slate-500 truncate mr-1">{entry.field}</span>
      <span className={`font-mono flex-shrink-0 ${color}`}>
        {entry.status === 'DM' ? (
          <DMValue />
        ) : (
          <>
            {entry.value !== null ? String(entry.value).slice(0, 12) : '\u2713'}
            {entry.status === 'FALLBACK' && entry.reason && (
              <span className="text-amber-400/60 ml-0.5">FB:{entry.reason}</span>
            )}
          </>
        )}
      </span>
    </div>
  )
}

function StrategyCard({ strategy }: { strategy: StrategyDQ }) {
  const dir = getDirectionBadge(strategy.direction)

  // Show only non-LIVE fields (FALLBACK + DM) plus a few key LIVE ones
  const problemFields = strategy.fields.filter(f => f.status !== 'LIVE')
  const keyLiveFields = strategy.fields.filter(f => f.status === 'LIVE').slice(0, 3)
  const displayFields = [...keyLiveFields, ...problemFields].slice(0, 8)

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 min-w-[200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-white">{strategy.label}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${dir.color}`}>{dir.text}</span>
      </div>

      {/* Headline metric */}
      <div className="mb-2">
        <div className="text-[10px] text-slate-500">{strategy.headlineMetric}</div>
        <div className="text-lg font-bold text-white font-mono leading-tight">
          {strategy.headlineValue === 'DM' ? <DMValue /> : strategy.headlineValue}
        </div>
      </div>

      {/* DQ bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[9px] mb-0.5">
          <span className="text-slate-500">DQ</span>
          <span className={`font-mono font-bold ${
            strategy.percentage >= 80 ? 'text-emerald-400' :
            strategy.percentage >= 60 ? 'text-amber-400' : 'text-red-400'
          }`}>{strategy.percentage.toFixed(0)}%</span>
        </div>
        <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
          <div className={`h-full ${getDQBarColor(strategy.percentage)}`} style={{ width: `${strategy.percentage}%` }} />
        </div>
      </div>

      {/* Key fields */}
      <div className="space-y-0.5 mb-2">
        {displayFields.map((f, i) => (
          <FieldRow key={`${f.field}-${i}`} entry={f} />
        ))}
      </div>

      {/* Fire status */}
      <div className={`text-[10px] px-2 py-1 rounded text-center font-medium ${
        strategy.fireStatus.startsWith('FIRED') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
        strategy.canFire ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
        'bg-red-500/10 text-red-400/70 border border-red-500/20'
      }`}>
        {strategy.fireStatus}
      </div>
    </div>
  )
}

export function StrategyConvictionCards({ dq, className = '' }: StrategyConvictionCardsProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">Strategy Conviction</h3>
        <span className="text-[10px] text-slate-500">
          {dq.strategies.filter(s => s.canFire).length}/{dq.strategies.length} can fire
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {dq.strategies.map(s => (
          <StrategyCard key={s.strategy} strategy={s} />
        ))}
      </div>
    </div>
  )
}

export default StrategyConvictionCards
