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
        <div className="flex items-center justify-center h-64">
          <div className="text-slate-400">Loading signals...</div>
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
        <div className="text-center text-slate-500 py-12">
          No signals found
        </div>
      )}
    </div>
  )
}

