import { useEffect, useState } from 'react'
import { marketPulseApi } from '../services/api'
import type { ConvictionData } from '../services/api'

interface ConvictionBadgeProps {
  symbol: string
  compact?: boolean
}

const colorMap: Record<string, string> = {
  green: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  amber: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  slate: 'bg-slate-600/20 text-slate-400 border-slate-500/30',
}

// Simple in-memory cache to avoid re-fetching on every render
const cache = new Map<string, { data: ConvictionData | null; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export default function ConvictionBadge({ symbol, compact = false }: ConvictionBadgeProps) {
  const [data, setData] = useState<ConvictionData | null>(null)

  useEffect(() => {
    if (!symbol) return

    const cached = cache.get(symbol)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setData(cached.data)
      return
    }

    marketPulseApi.getConviction(symbol)
      .then(d => {
        if (d && d.conviction > 0) {
          cache.set(symbol, { data: d, ts: Date.now() })
          setData(d)
        } else {
          cache.set(symbol, { data: null, ts: Date.now() })
        }
      })
      .catch(() => {
        cache.set(symbol, { data: null, ts: Date.now() })
      })
  }, [symbol])

  if (!data || data.conviction === 0) return null

  const cls = colorMap[data.color] || colorMap.slate

  if (compact) {
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded border ${cls}`} title={data.inference}>
        {data.conviction}%
      </span>
    )
  }

  return (
    <div className={`mt-2 px-3 py-2 rounded-lg border ${cls}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold">Institutional Context: {data.conviction}%</span>
      </div>
      <p className="text-xs opacity-80">{data.inference}</p>
      {data.events.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {data.events.slice(0, 3).map((e, i) => (
            <div key={i} className="text-[10px] opacity-60">{e}</div>
          ))}
        </div>
      )}
    </div>
  )
}
