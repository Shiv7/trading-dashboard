import { useEffect, useState } from 'react'
import SignalCard from '../components/Signals/SignalCard'
import { useDashboardStore } from '../store/dashboardStore'
import { signalsApi } from '../services/api'
import type { Signal } from '../types'

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [filterEmitted, setFilterEmitted] = useState<boolean | undefined>(undefined)

  const wsSignals = useDashboardStore((s) => s.signals)

  useEffect(() => {
    async function loadSignals() {
      setLoading(true)
      try {
        const data = await signalsApi.getSignals(page, 20, undefined, filterEmitted)
        setSignals(data.content)
        setTotalPages(Math.ceil(data.totalElements / 20))
      } catch (error) {
        console.error('Error loading signals:', error)
      } finally {
        setLoading(false)
      }
    }
    loadSignals()
  }, [page, filterEmitted])

  // Show new signals from WebSocket at top
  const newSignals = wsSignals.filter(ws => 
    !signals.find(s => s.signalId === ws.signalId)
  )
  const displaySignals = [...newSignals, ...signals]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-white">⚡ Signals</h1>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 pulse-green" />
          <span className="text-sm text-slate-400">Live</span>
          {newSignals.length > 0 && (
            <span className="badge badge-success">+{newSignals.length} new</span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {[
          { value: undefined, label: 'All Signals' },
          { value: true, label: 'Emitted Only' },
          { value: false, label: 'Rejected Only' },
        ].map(f => (
          <button
            key={String(f.value)}
            onClick={() => { setFilterEmitted(f.value); setPage(0); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterEmitted === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Signals Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card h-32">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-slate-700/50 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-slate-700/50 rounded" />
                  <div className="h-3 w-20 bg-slate-700/50 rounded" />
                </div>
              </div>
              <div className="h-3 w-full bg-slate-700/30 rounded" />
            </div>
          ))}
        </div>
      ) : displaySignals.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displaySignals.map(signal => (
              <SignalCard key={signal.signalId} signal={signal} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn btn-secondary disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-slate-400">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="btn btn-secondary disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16 text-slate-500">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p className="text-sm">No signals found</p>
          <p className="text-xs mt-1 text-slate-600">Signals appear when the system detects trading opportunities</p>
        </div>
      )}
    </div>
  )
}

