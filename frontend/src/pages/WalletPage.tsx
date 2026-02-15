import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, BarChart2, BookOpen, Briefcase } from 'lucide-react'
import WalletCard from '../components/Wallet/WalletCard'
import PositionCard from '../components/Wallet/PositionCard'
import WalletPnLTab from '../components/Wallet/WalletPnLTab'
import WalletJournalTab from '../components/Wallet/WalletJournalTab'
import { useDashboardStore } from '../store/dashboardStore'
import { walletApi } from '../services/api'
import type { Wallet } from '../types'
import TradeModal from '../components/Trading/TradeModal'

type WalletTab = 'positions' | 'pnl' | 'journal'
type WalletType = 'PAPER' | 'REAL'

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [tradeModalOpen, setTradeModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<WalletTab>('positions')
  const [walletType, setWalletType] = useState<WalletType>('PAPER')
  const [autoRefresh, setAutoRefresh] = useState(true)

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
    let interval: ReturnType<typeof setInterval> | null = null
    if (autoRefresh) {
      interval = setInterval(loadWallet, 5000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [autoRefresh])

  const displayWallet = wsWallet || wallet

  const filteredPositions = displayWallet?.positions?.filter(p => {
    if (filter === 'open') return p.quantity > 0
    if (filter === 'closed') return p.quantity === 0
    return true
  }) || []

  const openCount = displayWallet?.positions?.filter(p => p.quantity > 0).length ?? 0

  const tabs: { id: WalletTab; label: string; icon: typeof BarChart2 }[] = [
    { id: 'positions', label: 'Positions', icon: Briefcase },
    { id: 'pnl', label: 'P&L Analytics', icon: BarChart2 },
    { id: 'journal', label: 'Trade Journal', icon: BookOpen },
  ]

  return (
    <>
      <div className="min-h-screen">
        {/* Sticky Header */}
        <div className="bg-slate-800/95 backdrop-blur border-b border-slate-700 sticky top-0 z-10">
          <div className="px-4 py-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              {/* Left: Title + open count */}
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Briefcase className="w-4 h-4 text-amber-400" />
                </div>
                <h1 className="text-xl font-bold text-white">Wallet</h1>
                {openCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
                    {openCount} open
                  </span>
                )}
              </div>

              {/* Right: Controls */}
              <div className="flex items-center gap-3">
                {/* PAPER/REAL Toggle */}
                <div className="flex bg-slate-900/50 rounded-lg p-1">
                  {(['PAPER', 'REAL'] as WalletType[]).map(wt => (
                    <button
                      key={wt}
                      onClick={() => setWalletType(wt)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        walletType === wt
                          ? wt === 'PAPER' ? 'bg-blue-500 text-white' : 'bg-amber-500 text-slate-900'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {wt === 'PAPER' ? 'Paper' : 'Real'}
                    </button>
                  ))}
                </div>

                {/* Auto-refresh toggle */}
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium ${
                    autoRefresh ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                  Live
                </button>

                {/* Manual refresh */}
                <button
                  onClick={loadWallet}
                  className="p-2 hover:bg-slate-700 rounded transition-colors"
                  disabled={loading}
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : 'text-slate-400'}`} />
                </button>

                {/* New Trade */}
                <button
                  onClick={() => setTradeModalOpen(true)}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg text-sm font-bold hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/30 flex items-center gap-2"
                >
                  <span>+</span>
                  New Trade
                </button>
              </div>
            </div>

            {/* Tab Bar */}
            <div className="flex gap-1 mt-4">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-t text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-slate-900 text-white border-t border-l border-r border-slate-700'
                      : 'bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  <tab.icon className={`w-4 h-4 ${activeTab === tab.id ? 'text-amber-400' : ''}`} />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="px-4 py-6">
          {/* Positions Tab */}
          {activeTab === 'positions' && (
            <div className="space-y-6">
              <WalletCard wallet={displayWallet} />

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

                {loading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-40 bg-slate-700/30 rounded-xl" />
                    ))}
                  </div>
                ) : filteredPositions.length > 0 ? (
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
          )}

          {/* P&L Analytics Tab */}
          {activeTab === 'pnl' && (
            <WalletPnLTab walletType={walletType} />
          )}

          {/* Trade Journal Tab */}
          {activeTab === 'journal' && (
            <WalletJournalTab walletType={walletType} />
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
