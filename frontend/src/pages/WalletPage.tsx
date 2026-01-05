import { useEffect, useState } from 'react'
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
  }, [])

  const displayWallet = wsWallet || wallet

  const filteredPositions = displayWallet?.positions?.filter(p => {
    if (filter === 'open') return p.quantity > 0
    if (filter === 'closed') return p.quantity === 0
    return true
  }) || []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading wallet...</div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header with New Trade Button */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display font-bold text-white">💰 Wallet</h1>
          <button
            onClick={() => setTradeModalOpen(true)}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg font-bold hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/30 flex items-center gap-2"
          >
            <span>➕</span>
            New Trade
          </button>
        </div>

        <WalletCard wallet={displayWallet} />

        {/* Positions */}
        <div className="card">
          <div className="card-header">
            <span>📊 Positions</span>
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
            <div className="text-center text-slate-500 py-12">
              No {filter !== 'all' ? filter : ''} positions found
            </div>
          )}
        </div>
      </div>

      {/* Trade Modal */}
      <TradeModal
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        scripCode=""
        currentPrice={0}
      />
    </>
  )
}
