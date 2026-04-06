/**
 * DataQualityBadge — Compact DQ% indicator with color-coded fill bar.
 * Used in header (overall DQ) and per-strategy cards.
 */

interface DataQualityBadgeProps {
  percentage: number         // 0-100
  liveCount: number
  fallbackCount: number
  missingCount: number
  compact?: boolean          // Just the % and bar, no breakdown
  className?: string
}

function getDQColor(pct: number): { text: string; bar: string; bg: string } {
  if (pct >= 80) return { text: 'text-emerald-400', bar: 'bg-emerald-500', bg: 'bg-emerald-500/10' }
  if (pct >= 60) return { text: 'text-amber-400', bar: 'bg-amber-500', bg: 'bg-amber-500/10' }
  return { text: 'text-red-400', bar: 'bg-red-500', bg: 'bg-red-500/10' }
}

export function DataQualityBadge({ percentage, liveCount, fallbackCount, missingCount, compact = false, className = '' }: DataQualityBadgeProps) {
  const colors = getDQColor(percentage)
  const total = liveCount + fallbackCount + missingCount

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`} title={`DQ: ${percentage.toFixed(0)}% — ${liveCount} live, ${fallbackCount} fallback, ${missingCount} missing`}>
        <span className={`text-[10px] font-mono font-bold ${colors.text}`}>DQ:{percentage.toFixed(0)}%</span>
        <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className={`h-full ${colors.bar} transition-all`} style={{ width: `${percentage}%` }} />
        </div>
      </div>
    )
  }

  return (
    <div className={`${colors.bg} border border-slate-700/50 rounded-lg p-2 ${className}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-400 uppercase tracking-wide">Data Quality</span>
        <span className={`text-sm font-bold font-mono ${colors.text}`}>{percentage.toFixed(0)}%</span>
      </div>
      <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden mb-1.5">
        {total > 0 && (
          <div className="h-full flex">
            <div className="bg-emerald-500 h-full" style={{ width: `${(liveCount / total) * 100}%` }} />
            <div className="bg-amber-500 h-full" style={{ width: `${(fallbackCount / total) * 100}%` }} />
            <div className="bg-red-500/40 h-full" style={{ width: `${(missingCount / total) * 100}%` }} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-[9px]">
        <span className="text-emerald-400">{liveCount} live</span>
        <span className="text-amber-400">{fallbackCount} fallback</span>
        <span className="text-red-400">{missingCount} missing</span>
      </div>
    </div>
  )
}

export default DataQualityBadge
