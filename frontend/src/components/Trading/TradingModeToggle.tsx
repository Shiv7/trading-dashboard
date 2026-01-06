import { useState, useEffect } from 'react'
import { tradingModeApi, TradingModeStatus } from '../../services/api'

export default function TradingModeToggle() {
  const [status, setStatus] = useState<TradingModeStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch initial status
  useEffect(() => {
    tradingModeApi.getMode()
      .then(setStatus)
      .catch(err => console.error('Failed to fetch trading mode:', err))
  }, [])

  const handleToggleMode = async () => {
    if (!status) return

    // If switching to LIVE, need to enable first
    if (status.isVirtual && !status.liveTradingEnabled) {
      setShowConfirmModal(true)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const newMode = status.isVirtual ? 'LIVE' : 'VIRTUAL'
      await tradingModeApi.setMode(newMode)
      const updated = await tradingModeApi.getMode()
      setStatus(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch mode')
    } finally {
      setLoading(false)
    }
  }

  const handleEnableLive = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await tradingModeApi.enableLive(true)
      if (result.liveTradingEnabled) {
        // Now switch to LIVE mode
        await tradingModeApi.setMode('LIVE')
        const updated = await tradingModeApi.getMode()
        setStatus(updated)
        setShowConfirmModal(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable live trading')
    } finally {
      setLoading(false)
    }
  }

  const handleDisableLive = async () => {
    setLoading(true)
    try {
      await tradingModeApi.disableLive()
      const updated = await tradingModeApi.getMode()
      setStatus(updated)
    } catch (err) {
      console.error('Failed to disable live:', err)
    } finally {
      setLoading(false)
    }
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 rounded-lg animate-pulse">
        <div className="w-3 h-3 rounded-full bg-slate-600" />
        <span className="text-xs text-slate-400">Loading...</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Mode Indicator */}
        <button
          onClick={handleToggleMode}
          disabled={loading}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all font-medium text-xs
            ${status.isLive
              ? 'bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/50 text-red-400 hover:border-red-400'
              : 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-500/50 text-blue-400 hover:border-blue-400'
            }
            ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
          `}
          title={status.isLive ? 'Click to switch to VIRTUAL mode' : 'Click to switch to LIVE mode'}
        >
          <div className={`w-2.5 h-2.5 rounded-full ${status.isLive ? 'bg-red-500 animate-pulse' : 'bg-blue-500'}`} />
          <span className="uppercase tracking-wider">
            {status.isLive ? 'LIVE' : 'VIRTUAL'}
          </span>
          {status.isLive && (
            <span className="text-[10px] bg-red-500/30 px-1.5 py-0.5 rounded">REAL $</span>
          )}
        </button>

        {/* Quick disable for LIVE mode */}
        {status.isLive && (
          <button
            onClick={handleDisableLive}
            className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
            title="Disable live trading"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </button>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="fixed bottom-20 right-4 bg-red-500/90 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-2xl">⚠️</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Enable Live Trading?</h3>
                <p className="text-sm text-slate-400">This will use REAL money</p>
              </div>
            </div>

            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
              <ul className="space-y-2 text-sm text-red-300">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5">•</span>
                  <span>All orders will be sent to 5Paisa broker</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5">•</span>
                  <span>Real money will be used for trades</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5">•</span>
                  <span>Losses are permanent and irreversible</span>
                </li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleEnableLive}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                disabled={loading}
              >
                {loading ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <>
                    <span>Enable LIVE</span>
                    <span className="text-xs opacity-75">(Real $)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
