import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useDashboardStore } from '../store/dashboardStore'
import { walletApi, scoresApi, signalsApi, tradesApi } from '../services/api'
import type { Wallet, FamilyScore, Signal, TradeStats } from '../types'
import { TradingModeToggle, WalletHeader } from '../components/Company'
import PositionCard from '../components/Wallet/PositionCard'
import RegimePanel from '../components/Dashboard/RegimePanel'
import PendingSignalsPanel from '../components/Signals/PendingSignalsPanel'
import RiskStatusPanel from '../components/Risk/RiskStatusPanel'
import TrendStatePanel from '../components/Dashboard/TrendStatePanel'
import WalletCard from '../components/Wallet/WalletCard'

export default function DashboardPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [allScores, setAllScores] = useState<FamilyScore[]>([])
  const [recentSignals, setRecentSignals] = useState<Signal[]>([])
  const [tradeStats, setTradeStats] = useState<TradeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [opportunityFilter, setOpportunityFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH'>('ALL')

  const wsWallet = useDashboardStore((s) => s.wallet)
  const wsSignals = useDashboardStore((s) => s.signals)
  const wsScores = useDashboardStore((s) => s.scores)
  const regime = useDashboardStore((s) => s.regime)
  const activeIgnitions = useDashboardStore((s) => s.activeIgnitions)
  const acl = useDashboardStore((s) => s.acl)

  useEffect(() => {
    async function loadData() {
      try {
        const [walletData, scoresData, signalsData, statsData] = await Promise.all([
          walletApi.getWallet().catch(() => null),
          scoresApi.getTopScores(50).catch(() => []),
          signalsApi.getSignals(0, 20, undefined, true).catch(() => ({ content: [] })),
          tradesApi.getTradeStats().catch(() => null),
        ])
        setWallet(walletData)
        setAllScores(scoresData)
        setRecentSignals(signalsData.content)
        setTradeStats(statsData)
      } catch (error) {
        console.error('Error loading dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // Merge WebSocket data
  const displayWallet = wsWallet || wallet
  const displayScores = useMemo(() => {
    const scores = wsScores.size > 0 ? Array.from(wsScores.values()) : allScores
    return scores
      .filter(s => opportunityFilter === 'ALL' || s.direction === opportunityFilter)
      .sort((a, b) => b.overallScore - a.overallScore)
  }, [wsScores, allScores, opportunityFilter])

  const displaySignals = wsSignals.length > 0 ? wsSignals : recentSignals

  // Active positions
  const activePositions = displayWallet?.positions?.filter(p => p.quantity > 0) || []

  // Stats
  const bullishCount = displayScores.filter(s => s.direction === 'BULLISH').length
  const bearishCount = displayScores.filter(s => s.direction === 'BEARISH').length
  const highConviction = displayScores.filter(s => s.overallScore >= 7).length

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Header skeleton */}
        <div className="h-16 bg-slate-800/50 rounded-xl" />
        <div className="grid grid-cols-12 gap-6">
          {/* Left column */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            <div className="bg-slate-800/50 rounded-xl p-4 space-y-3">
              <div className="h-6 w-48 bg-slate-700/50 rounded" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-20 bg-slate-700/30 rounded-xl" />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="h-48 bg-slate-800/50 rounded-xl" />
              <div className="h-48 bg-slate-800/50 rounded-xl" />
            </div>
          </div>
          {/* Right column */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            <div className="h-48 bg-slate-800/50 rounded-xl" />
            <div className="h-32 bg-slate-800/50 rounded-xl" />
            <div className="h-32 bg-slate-800/50 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Command Center Header */}
      <header className="px-4 md:px-6 py-3 md:py-4 bg-slate-900/80
                         border-b border-slate-700/50 backdrop-blur-sm sticky top-0 z-40 -mx-4 md:-mx-6 -mt-4 md:-mt-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-6">
            <h1 className="text-lg md:text-xl font-bold text-white">Command Center</h1>
            <div className="flex items-center gap-1.5 px-2 md:px-3 py-1 md:py-1.5 rounded-full text-xs bg-emerald-500/10 text-emerald-400">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <TradingModeToggle />
            <WalletHeader wallet={displayWallet} />
          </div>
        </div>

        {/* Quick Stats — visible on all sizes */}
        <div className="flex items-center gap-3 md:gap-4 mt-2 text-xs">
          <span className="text-slate-400">
            <span className="text-emerald-400 font-bold">↑{bullishCount}</span> Bull
          </span>
          <span className="text-slate-400">
            <span className="text-red-400 font-bold">↓{bearishCount}</span> Bear
          </span>
          <span className="text-slate-400">
            <span className="text-amber-400 font-bold">★{highConviction}</span> High Conv
          </span>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Opportunity Scanner + Positions (col-8) */}
        <div className="col-span-12 lg:col-span-8 space-y-6">

          {/* Opportunity Scanner */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-white">🎯 Top Opportunities</h2>
                <span className="text-xs text-slate-400">{displayScores.length} instruments</span>
              </div>

              {/* Filter Buttons */}
              <div className="flex items-center gap-1 bg-slate-700/50 rounded-lg p-1">
                {(['ALL', 'BULLISH', 'BEARISH'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setOpportunityFilter(filter)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${opportunityFilter === filter
                        ? filter === 'BULLISH' ? 'bg-emerald-500 text-white' :
                          filter === 'BEARISH' ? 'bg-red-500 text-white' :
                            'bg-slate-600 text-white'
                        : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    {filter === 'ALL' ? 'All' : filter === 'BULLISH' ? '↑ Long' : '↓ Short'}
                  </button>
                ))}
              </div>
            </div>

            {/* Opportunities Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] md:max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {displayScores.slice(0, 20).map((score, index) => (
                <OpportunityCard key={`${score.scripCode}-${index}`} score={score} />
              ))}
              {displayScores.length === 0 && (
                <div className="col-span-2 text-center py-12 text-slate-500">
                  No opportunities match current filter
                </div>
              )}
            </div>
          </div>

          {/* Two Column: Positions + Performance */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Active Positions */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                  Active Positions
                </h3>
                <Link to="/wallet" className="text-xs text-blue-400 hover:text-blue-300">
                  View All →
                </Link>
              </div>

              {activePositions.length > 0 ? (
                <div className="space-y-3">
                  {activePositions.slice(0, 4).map(pos => (
                    <PositionCard key={pos.positionId} position={pos} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <div className="text-3xl mb-2 opacity-50">📊</div>
                  <p className="text-sm">No active positions</p>
                  <p className="text-xs mt-1">Find opportunities above</p>
                </div>
              )}
            </div>

            {/* Performance Stats */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                  Performance
                </h3>
                <Link to="/trades" className="text-xs text-blue-400 hover:text-blue-300">
                  History →
                </Link>
              </div>

              {tradeStats ? (
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label="Total Trades"
                    value={tradeStats.totalTrades.toString()}
                  />
                  <StatCard
                    label="Win Rate"
                    value={`${(tradeStats.winRate ?? 0).toFixed(0)}%`}
                    positive={(tradeStats.winRate ?? 0) >= 50}
                  />
                  <StatCard
                    label="Total P&L"
                    value={formatCurrency(tradeStats.totalPnl)}
                    positive={tradeStats.totalPnl >= 0}
                  />
                  <StatCard
                    label="Avg R"
                    value={`${(tradeStats.avgRMultiple ?? 0) >= 0 ? '+' : ''}${(tradeStats.avgRMultiple ?? 0).toFixed(2)}R`}
                    positive={(tradeStats.avgRMultiple ?? 0) >= 0}
                  />
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <p className="text-sm">No trade data yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Recent Signals */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                  Recent Signals
                </h3>
                <span className="text-xs text-slate-400">
                  {displaySignals.length} today
                </span>
              </div>
              <Link to="/signals" className="text-xs text-blue-400 hover:text-blue-300">
                View All →
              </Link>
            </div>

            {displaySignals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {displaySignals.slice(0, 6).map(signal => (
                  <SignalMiniCard key={signal.signalId} signal={signal} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <div className="text-3xl mb-2 opacity-50">⚡</div>
                <p className="text-sm">No signals yet today</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Market Context (col-4) */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* FUDKII Ignitions & Trend State */}
          <TrendStatePanel acl={acl || undefined} activeIgnitions={activeIgnitions} />

          {/* Full Wallet Overview with Paper Trade Stats */}
          <WalletCard wallet={displayWallet} />

          {/* Risk Status - Circuit Breaker & Limits */}
          <RiskStatusPanel />

          {/* Pending Signals - Action Required */}
          <PendingSignalsPanel onSignalConfirmed={() => walletApi.refreshWallet()} />

          {/* Regime Panel */}
          <RegimePanel regime={regime} />
        </div>
      </div>
    </div>
  )
}

// Helper Components

function OpportunityCard({ score }: { score: FamilyScore }) {
  const isBullish = score.direction === 'BULLISH'

  return (
    <Link
      to={`/stock/${score.scripCode}`}
      className={`p-3 rounded-xl border transition-all hover:scale-[1.02] ${isBullish
          ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40'
          : 'bg-red-500/5 border-red-500/20 hover:border-red-500/40'
        }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${isBullish ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
            }`}>
            {isBullish ? '↑' : '↓'}
          </div>
          <div>
            <div className="font-medium text-white text-sm truncate max-w-[160px]">
              {score.companyName || score.scripCode}
            </div>
            <div className="text-xs text-slate-400">{score.scripCode}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${(score.overallScore ?? 0) >= 7 ? 'text-emerald-400' :
              (score.overallScore ?? 0) >= 5 ? 'text-amber-400' : 'text-slate-400'
            }`}>
            {(score.overallScore ?? 0).toFixed(1)}
          </div>
          <div className="text-xs text-slate-400">Score</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">VCP: <span className="text-white">{((score.vcpCombinedScore ?? 0) * 100).toFixed(0)}%</span></span>
          <span className="text-slate-400">IPU: <span className="text-white">{((score.ipuFinalScore ?? 0) * 100).toFixed(0)}%</span></span>
          {score.ipuXfactor && <span className="text-yellow-400">⚡</span>}
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${score.securityAligned
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-slate-500/20 text-slate-400'
          }`}>
          {score.securityAligned ? 'ALIGNED' : 'DIVERGENT'}
        </span>
      </div>
    </Link>
  )
}

function SignalMiniCard({ signal }: { signal: Signal }) {
  const isBullish = signal.direction === 'BULLISH'

  return (
    <Link
      to={`/stock/${signal.scripCode}`}
      className="p-3 bg-slate-700/30 rounded-lg hover:bg-slate-700/50 transition-all"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-white text-sm truncate max-w-[140px]">
          {signal.companyName || signal.scripCode}
        </span>
        <span className={`text-lg ${isBullish ? 'text-emerald-400' : 'text-red-400'}`}>
          {isBullish ? '↑' : '↓'}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Conf: {((signal.confidence ?? 0) * 100).toFixed(0)}%</span>
        <span className={signal.allGatesPassed ? 'text-emerald-400' : 'text-red-400'}>
          {signal.allGatesPassed ? '✓ Pass' : '✗ Fail'}
        </span>
      </div>
    </Link>
  )
}

function StatCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="bg-slate-700/30 rounded-lg p-3 text-center">
      <div className={`text-xl font-bold ${positive === undefined ? 'text-white' :
          positive ? 'text-emerald-400' : 'text-red-400'
        }`}>
        {value}
      </div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  )
}

function formatCurrency(amount: number): string {
  amount = Number(amount) || 0
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`
  return `${sign}₹${abs.toFixed(0)}`
}
