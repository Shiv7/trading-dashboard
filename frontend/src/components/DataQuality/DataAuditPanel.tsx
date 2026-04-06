/**
 * DataAuditPanel — Bottom-of-page fold showing every data input per strategy
 * with LIVE/FALLBACK/DM status. Full transparency on data provenance.
 */

import type { OverallDQ, StrategyDQ, FieldAuditEntry } from './dataQualityUtils'
import { DataQualityBadge } from './DataQualityBadge'

interface DataAuditPanelProps {
  dq: OverallDQ
  className?: string
}

const statusStyles: Record<string, { dot: string; text: string; label: string }> = {
  LIVE:     { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'LIVE' },
  FALLBACK: { dot: 'bg-amber-500',   text: 'text-amber-400',   label: 'FALLBACK' },
  DM:       { dot: 'bg-red-500',     text: 'text-red-400',     label: 'DM' },
  SWAP:     { dot: 'bg-blue-500',    text: 'text-blue-400',    label: 'SWAP' },
  BOOT:     { dot: 'bg-slate-500',   text: 'text-slate-400',   label: 'BOOT' },
  REDIS:    { dot: 'bg-slate-500',   text: 'text-slate-400',   label: 'CACHE' },
}

function AuditRow({ entry }: { entry: FieldAuditEntry }) {
  const style = statusStyles[entry.status] || statusStyles.DM
  return (
    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
      <td className="py-1 px-2 text-[10px] text-slate-400">{entry.field}</td>
      <td className="py-1 px-2 text-[10px] font-mono text-white">
        {entry.value !== null ? String(entry.value).slice(0, 20) : <span className="text-slate-600">\u2014</span>}
      </td>
      <td className="py-1 px-2 text-[10px] text-slate-500">{entry.source}</td>
      <td className="py-1 px-2">
        <span className={`inline-flex items-center gap-1 text-[9px] font-medium ${style.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {style.label}
          {entry.reason && <span className="opacity-60">:{entry.reason}</span>}
        </span>
      </td>
    </tr>
  )
}

function StrategyAuditSection({ strategy }: { strategy: StrategyDQ }) {
  const dmFields = strategy.fields.filter(f => f.status === 'DM')
  const fbFields = strategy.fields.filter(f => f.status === 'FALLBACK' || f.status === 'BOOT' || f.status === 'SWAP' || f.status === 'REDIS')
  const liveFields = strategy.fields.filter(f => f.status === 'LIVE')

  return (
    <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white">{strategy.label} Requirements</span>
          <span className="text-[9px] text-slate-500">{strategy.fields.length} fields</span>
        </div>
        <div className="flex items-center gap-3 text-[9px]">
          <span className="text-emerald-400">{liveFields.length} live</span>
          <span className="text-amber-400">{fbFields.length} fallback</span>
          <span className="text-red-400">{dmFields.length} missing</span>
        </div>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="py-1 px-2 text-left text-[9px] text-slate-600 uppercase tracking-wide font-medium">Field</th>
            <th className="py-1 px-2 text-left text-[9px] text-slate-600 uppercase tracking-wide font-medium">Value</th>
            <th className="py-1 px-2 text-left text-[9px] text-slate-600 uppercase tracking-wide font-medium">Source</th>
            <th className="py-1 px-2 text-left text-[9px] text-slate-600 uppercase tracking-wide font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {/* Show DM fields first (most important), then FALLBACK, then LIVE */}
          {dmFields.map((f, i) => <AuditRow key={`dm-${i}`} entry={f} />)}
          {fbFields.map((f, i) => <AuditRow key={`fb-${i}`} entry={f} />)}
          {liveFields.map((f, i) => <AuditRow key={`live-${i}`} entry={f} />)}
        </tbody>
      </table>
      {/* Warnings */}
      {dmFields.length > 0 && (
        <div className="px-3 py-1.5 bg-red-500/5 border-t border-red-500/10">
          <span className="text-[9px] text-red-400">
            {dmFields.length} missing field{dmFields.length > 1 ? 's' : ''}: {dmFields.map(f => f.field).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}

export function DataAuditPanel({ dq, className = '' }: DataAuditPanelProps) {
  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wide">Data Audit</h3>
          <span className="text-[10px] text-slate-500">
            {dq.allFields.length} total fields tracked
          </span>
        </div>
        <DataQualityBadge
          percentage={dq.percentage}
          liveCount={dq.liveCount}
          fallbackCount={dq.fallbackCount}
          missingCount={dq.missingCount}
          compact
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[9px]">
        {Object.entries(statusStyles).map(([status, style]) => (
          <span key={status} className={`inline-flex items-center gap-1 ${style.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {style.label}
          </span>
        ))}
      </div>

      {/* Per-strategy sections */}
      <div className="space-y-3">
        {dq.strategies.map(s => (
          <StrategyAuditSection key={s.strategy} strategy={s} />
        ))}
      </div>
    </div>
  )
}

export default DataAuditPanel
