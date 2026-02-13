import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import WalletCard from '../components/Wallet/WalletCard'
import PositionCard from '../components/Wallet/PositionCard'
import { useDashboardStore } from '../store/dashboardStore'
import { walletApi } from '../services/api'
import type { Wallet } from '../types'
import TradeModal from '../components/Trading/TradeModal'

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [tradeModalOpen, setTradeModalOpen] = useState(false)

  const wsWallet = useDashboardStore((s) => s.wallet)

  const loadWallet = async () => {
    try {
      const data = await walletApi.getWallet()
      setWallet(data)
    } catch (error) {
      console.error('Error loading wallet:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWallet()
    // Auto-refresh every 5 seconds for live P&L updates
    const interval = setInterval(loadWallet, 5000)
    return () => clearInterval(interval)
  }, [])

  const displayWallet = wsWallet || wallet

  const filteredPositions = displayWallet?.positions?.filter(p => {
    if (filter === 'open') return p.quantity > 0
    if (filter === 'closed') return p.quantity === 0
    return true
  }) || []

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-8 w-32 bg-slate-800/50 rounded" />
          <div className="h-10 w-28 bg-slate-800/50 rounded-lg" />
        </div>
        <div className="card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-slate-700/30 rounded-lg" />
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700/50 grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-700/30 rounded" />
            ))}
          </div>
        </div>
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-40 bg-slate-700/30 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header with New Trade Button */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display font-bold text-white">Wallet</h1>
          <button
            onClick={() => setTradeModalOpen(true)}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg font-bold hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/30 flex items-center gap-2"
          >
            <span>+</span>
            New Trade
          </button>
        </div>

        <WalletCard wallet={displayWallet} />

        {/* Positions */}
        <div className="card">
          <div className="card-header">
            <span>Positions</span>
            <div className="flex gap-2">
              {(['all', 'open', 'closed'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${filter === f
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {filteredPositions.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPositions.map(pos => (
                <PositionCard
                  key={pos.positionId}
                  position={pos}
                  onUpdate={loadWallet}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              <p className="text-sm">No {filter !== 'all' ? filter : ''} positions found</p>
              {filter === 'all' && (
                <Link to="/signals" className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block">
                  Browse signals to find opportunities
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Trade Modal — scripCode is entered manually when opened from wallet */}
      <TradeModal
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        scripCode=""
        currentPrice={0}
      />
    </>
  )
}
