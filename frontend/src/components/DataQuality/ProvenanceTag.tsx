/**
 * ProvenanceTag - Inline tag showing data provenance (LIVE / FALLBACK / DM / SWAP / BOOT)
 * Used throughout the redesigned StockDetailPage to show data quality at field level.
 */

export type ProvenanceStatus = 'LIVE' | 'FALLBACK' | 'DM' | 'SWAP' | 'BOOT' | 'REDIS'

export interface ProvenanceInfo {
  status: ProvenanceStatus
  reason?: string  // e.g. "BB_LOWER", "ATR_1PCT", "DELTA_0.5", "futures lookup"
  age?: string     // e.g. "2s", "5m" for cached values
}

interface ProvenanceTagProps {
  provenance: ProvenanceInfo
  compact?: boolean  // Show just the dot, not the label
  className?: string
}

const statusConfig: Record<ProvenanceStatus, { color: string; bg: string; label: string }> = {
  LIVE:     { color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: '' },
  FALLBACK: { color: 'text-amber-400',   bg: 'bg-amber-500/10',   label: 'FB' },
  DM:       { color: 'text-red-400',     bg: 'bg-red-500/10',     label: 'DM' },
  SWAP:     { color: 'text-blue-400',    bg: 'bg-blue-500/10',    label: 'SWAP' },
  BOOT:     { color: 'text-slate-400',   bg: 'bg-slate-500/10',   label: 'BOOT' },
  REDIS:    { color: 'text-slate-400',   bg: 'bg-slate-500/10',   label: 'CACHE' },
}

export function ProvenanceTag({ provenance, compact = false, className = '' }: ProvenanceTagProps) {
  const config = statusConfig[provenance.status]

  // LIVE data doesn't need a tag — silence means "all good"
  if (provenance.status === 'LIVE' && !compact) return null

  const title = provenance.reason
    ? `${provenance.status}: ${provenance.reason}${provenance.age ? ` (${provenance.age} old)` : ''}`
    : provenance.status

  if (compact) {
    return (
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${config.color.replace('text-', 'bg-')} ${className}`}
        title={title}
      />
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-mono leading-tight ${config.bg} ${config.color} ${className}`}
      title={title}
    >
      {config.label}{provenance.reason ? `:${provenance.reason}` : ''}
    </span>
  )
}

/**
 * DM placeholder — shown instead of a value when data is missing.
 * Replaces the old pattern of showing "0", "N/A", or empty strings.
 */
export function DMValue({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`text-slate-500 italic text-[10px] ${className}`} title={label || 'Data Missing'}>
      DM
    </span>
  )
}

/**
 * Provenance-wrapped value — shows a value with its provenance tag inline.
 */
interface ProvenancedValueProps {
  value: string | number | undefined | null
  provenance: ProvenanceInfo
  format?: (v: number) => string
  className?: string
  valueClassName?: string
}

export function ProvenancedValue({ value, provenance, format, className = '', valueClassName = '' }: ProvenancedValueProps) {
  if (provenance.status === 'DM' || value === undefined || value === null) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <DMValue />
      </span>
    )
  }

  const displayValue = typeof value === 'number' && format ? format(value) : String(value)

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className={valueClassName}>{displayValue}</span>
      <ProvenanceTag provenance={provenance} />
    </span>
  )
}
