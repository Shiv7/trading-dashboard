import { useState, useEffect, useCallback } from 'react'
import { tradingSignalsApi, type TradingSignal } from '../../services/api'
import SignalConfirmationModal from './SignalConfirmationModal'

interface PendingSignalsPanelProps {
  onSignalConfirmed?: () => void
}

export default function PendingSignalsPanel({ onSignalConfirmed }: PendingSignalsPanelProps) {
  const [signals, setSignals] = useState<TradingSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSignal, setSelectedSignal] = useState<TradingSignal | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const loadSignals = useCallback(async () => {
    try {
      const data = await tradingSignalsApi.getPendingSignals()
      setSignals(data)
      setError(null)
    } catch (err) {
      setError('Failed to load signals')
      console.error('Error loading pending signals:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSignals()
    // Refresh every 5 seconds
    const interval = setInterval(loadSignals, 5000)
    return () => clearInterval(interval)
  }, [loadSignals])

  const handleConfirm = async (signalId: string) => {
    setConfirming(signalId)
    try {
      const result = await tradingSignalsApi.confirmSignal(signalId)
      if (result.success) {
        setSignals(prev => prev.filter(s => s.signalId !== signalId))
        onSignalConfirmed?.()
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError('Failed to confirm signal')
    } finally {
      setConfirming(null)
    }
  }

  const handleReject = async (signalId: string, reason?: string) => {
    setConfirming(signalId)
    try {
      const result = await tradingSignalsApi.rejectSignal(signalId, reason)
      if (result.success) {
        setSignals(prev => prev.filter(s => s.signalId !== signalId))
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError('Failed to reject signal')
    } finally {
      setConfirming(null)
    }
  }

  const handleConfirmAll = async () => {
    try {
      const result = await tradingSignalsApi.confirmAllQuality(70, 1.5)
      loadSignals()
      if (result.confirmed > 0) {
        onSignalConfirmed?.()
      }
    } catch (err) {
      setError('Failed to confirm signals')
    }
  }

  const handleRejectAll = async () => {
    try {
      await tradingSignalsApi.rejectAll('Bulk rejection')
      loadSignals()
    } catch (err) {
      setError('Failed to reject signals')
    }
  }

  const formatRR = (signal: TradingSignal): string => {
    if (!signal.entryPrice || !signal.stopLoss || !signal.target1) return 'N/A'
    const risk = Math.abs(signal.entryPrice - signal.stopLoss)
    const reward = Math.abs(signal.target1 - signal.entryPrice)
    return risk > 0 ? `1:${(reward / risk).toFixed(1)}` : 'N/A'
  }

  const getTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr)
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    return `${Math.floor(seconds / 3600)}h ago`
  }

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-32 bg-slate-700 rounded" />
      </div>
    )
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <span className="text-lg">Pending Signals</span>
            {signals.length > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                {signals.length}
              </span>
            )}
          </div>
          {signals.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={handleConfirmAll}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg font-medium transition-colors"
              >
                Confirm All Quality
              </button>
              <button
                onClick={handleRejectAll}
                className="px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white text-xs rounded-lg font-medium transition-colors"
              >
                Reject All
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-500/20 text-red-400 px-3 py-2 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {signals.length === 0 ? (
          <div className="text-center text-slate-500 py-8">
            No pending signals awaiting confirmation
          </div>
        ) : (
          <div className="space-y-3">
            {signals.map(signal => (
              <div
                key={signal.signalId}
                className={`p-4 rounded-lg border ${
                  signal.direction === 'BULLISH'
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-lg font-bold ${
                          signal.direction === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {signal.direction === 'BULLISH' ? '\u2191' : '\u2193'} {signal.companyName || signal.scripCode}
                      </span>
                      <span className="text-slate-400 text-sm">{signal.scripCode}</span>
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-slate-400">Entry</div>
                        <div className="text-white font-medium">
                          {signal.entryPrice?.toFixed(2) || '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">Stop Loss</div>
                        <div className="text-red-400 font-medium">
                          {signal.stopLoss?.toFixed(2) || '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">Target</div>
                        <div className="text-emerald-400 font-medium">
                          {signal.target1?.toFixed(2) || '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">R:R</div>
                        <div
                          className={`font-bold ${
                            parseFloat(formatRR(signal).split(':')[1] || '0') >= 2
                              ? 'text-emerald-400'
                              : 'text-yellow-400'
                          }`}
                        >
                          {formatRR(signal)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-4 text-xs">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          signal.compositeScore >= 70
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : signal.compositeScore >= 50
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        Score: {signal.compositeScore?.toFixed(1)}
                      </span>
                      <span className="text-slate-500">
                        {signal.receivedAt ? getTimeAgo(signal.receivedAt) : '-'}
                      </span>
                      {signal.reason && (
                        <span className="text-slate-400 truncate max-w-[200px]" title={signal.reason}>
                          {signal.reason}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 ml-4">
                    <button
                      onClick={() => setSelectedSignal(signal)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      Review
                    </button>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleConfirm(signal.signalId)}
                        disabled={confirming === signal.signalId}
                        className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-50"
                      >
                        {confirming === signal.signalId ? '...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => handleReject(signal.signalId)}
                        disabled={confirming === signal.signalId}
                        className="flex-1 px-3 py-1.5 bg-slate-600 hover:bg-slate-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedSignal && (
        <SignalConfirmationModal
          signal={selectedSignal}
          onConfirm={async () => {
            await handleConfirm(selectedSignal.signalId)
            setSelectedSignal(null)
          }}
          onReject={async (reason) => {
            await handleReject(selectedSignal.signalId, reason)
            setSelectedSignal(null)
          }}
          onClose={() => setSelectedSignal(null)}
        />
      )}
    </>
  )
}
