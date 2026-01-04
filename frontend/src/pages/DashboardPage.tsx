import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import WalletCard from '../components/Wallet/WalletCard'
import PositionCard from '../components/Wallet/PositionCard'
import SignalCard from '../components/Signals/SignalCard'
import RegimePanel from '../components/Dashboard/RegimePanel'
import MarketPulse from '../components/Dashboard/MarketPulse'
import MasterArchPanel from '../components/Dashboard/MasterArchPanel'
import TrendStatePanel from '../components/Dashboard/TrendStatePanel'
import { useDashboardStore } from '../store/dashboardStore'
import { walletApi, scoresApi, signalsApi, tradesApi } from '../services/api'
import type { Wallet, FamilyScore, Signal, TradeStats } from '../types'

export default function DashboardPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [topScores, setTopScores] = useState<FamilyScore[]>([])
  const [recentSignals, setRecentSignals] = useState<Signal[]>([])
  const [tradeStats, setTradeStats] = useState<TradeStats | null>(null)
  const [loading, setLoading] = useState(true)

  const wsWallet = useDashboardStore((s) => s.wallet)
  const wsSignals = useDashboardStore((s) => s.signals)
  const wsScores = useDashboardStore((s) => s.scores)
  const regime = useDashboardStore((s) => s.regime)
  const masterArchSignals = useDashboardStore((s) => s.masterArchSignals)
  const acl = useDashboardStore((s) => s.acl)
  const activeIgnitions = useDashboardStore((s) => s.activeIgnitions)

  useEffect(() => {
    async function loadData() {
      try {
        const [walletData, scoresData, signalsData, statsData] = await Promise.all([
          walletApi.getWallet().catch(() => null),
          scoresApi.getTopScores(5).catch(() => []),
          signalsApi.getSignals(0, 5, undefined, true).catch(() => ({ content: [] })),
          tradesApi.getTradeStats().catch(() => null),
        ])
        setWallet(walletData)
        setTopScores(scoresData)
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

  // Use WebSocket data if available
  const displayWallet = wsWallet || wallet
  const displayScores = wsScores.size > 0 ? Array.from(wsScores.values()).slice(0, 5) : topScores
  const displaySignals = wsSignals.length > 0 ? wsSignals.slice(0, 5) : recentSignals

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Loading Skeletons */}
        <div className="animate-pulse">
          <div className="h-32 bg-slate-800/50 rounded-xl mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="h-48 bg-slate-800/50 rounded-xl" />
              <div className="h-64 bg-slate-800/50 rounded-xl" />
            </div>
            <div className="space-y-6">
              <div className="h-64 bg-slate-800/50 rounded-xl" />
              <div className="h-48 bg-slate-800/50 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Wallet Overview */}
      <WalletCard wallet={displayWallet} />

      {/* Main Grid - 3 columns on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          {/* Positions & Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Active Positions */}
            <div className="card">
              <div className="card-header">
                <span>📊 Active Positions</span>
                <Link to="/wallet" className="text-sm text-blue-400 hover:text-blue-300">
                  View All →
                </Link>
              </div>
              {displayWallet?.positions?.filter(p => p.quantity > 0).length ? (
                <div className="space-y-3">
                  {displayWallet.positions
                    .filter(p => p.quantity > 0)
                    .slice(0, 3)
                    .map(pos => (
                      <PositionCard key={pos.positionId} position={pos} />
                    ))}
                </div>
              ) : (
                <div className="text-center text-slate-500 py-8">
                  <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p className="text-sm">No active positions</p>
                </div>
              )}
            </div>

            {/* Trade Stats */}
            <div className="card">
              <div className="card-header">
                <span>📈 Performance</span>
                <Link to="/trades" className="text-sm text-blue-400 hover:text-blue-300">
                  History →
                </Link>
              </div>
              {tradeStats ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-white">{tradeStats.totalTrades}</div>
                    <div className="text-xs text-slate-400">Total</div>
                  </div>
                  <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className={`text-2xl font-bold ${tradeStats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tradeStats.winRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-slate-400">Win Rate</div>
                  </div>
                  <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className={`text-2xl font-bold ${tradeStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      ₹{Math.abs(tradeStats.totalPnl) >= 100000
                        ? (tradeStats.totalPnl / 100000).toFixed(1) + 'L'
                        : (tradeStats.totalPnl / 1000).toFixed(1) + 'K'}
                    </div>
                    <div className="text-xs text-slate-400">Total P&L</div>
                  </div>
                  <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                    <div className={`text-2xl font-bold ${tradeStats.avgRMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tradeStats.avgRMultiple >= 0 ? '+' : ''}{tradeStats.avgRMultiple.toFixed(2)}R
                    </div>
                    <div className="text-xs text-slate-400">Avg R</div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 py-8">
                  <p className="text-sm">No trade data yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Top Scores */}
          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <span>🎯 Top Opportunities</span>
                <div className="flex items-center gap-1 text-xs">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-slate-400">Live</span>
                </div>
              </div>
              <Link to="/scores" className="text-sm text-blue-400 hover:text-blue-300">
                View All →
              </Link>
            </div>
            {displayScores.length > 0 ? (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Stock</th>
                      <th>VCP</th>
                      <th>IPU</th>
                      <th>Score</th>
                      <th>Direction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayScores.map(score => (
                      <tr key={score.scripCode} className="hover:bg-slate-700/30 transition-colors">
                        <td>
                          <Link to={`/stock/${score.scripCode}`} className="text-white hover:text-blue-400 transition-colors font-medium">
                            {score.companyName || score.scripCode}
                          </Link>
                        </td>
                        <td>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            score.vcpCombinedScore >= 0.7
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : score.vcpCombinedScore >= 0.5
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-slate-500/20 text-slate-400'
                          }`}>
                            {(score.vcpCombinedScore * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              score.ipuFinalScore >= 0.7
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : score.ipuFinalScore >= 0.5
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-slate-500/20 text-slate-400'
                            }`}>
                              {(score.ipuFinalScore * 100).toFixed(0)}%
                            </span>
                            {score.ipuXfactor && (
                              <span className="text-yellow-400 text-xs animate-pulse" title="X-Factor Active">⚡</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={`text-lg font-bold ${
                            score.overallScore >= 7
                              ? 'text-emerald-400'
                              : score.overallScore >= 5
                                ? 'text-amber-400'
                                : 'text-slate-400'
                          }`}>
                            {score.overallScore.toFixed(1)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${
                            score.direction === 'BULLISH'
                              ? 'badge-success'
                              : score.direction === 'BEARISH'
                                ? 'badge-danger'
                                : 'badge-neutral'
                          }`}>
                            {score.direction}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center text-slate-500 py-8">
                <p className="text-sm">No score data yet</p>
              </div>
            )}
          </div>

          {/* Recent Signals */}
          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <span>⚡ Recent Signals</span>
                {displaySignals.length > 0 && (
                  <span className="text-xs text-slate-400">
                    ({displaySignals.length} today)
                  </span>
                )}
              </div>
              <Link to="/signals" className="text-sm text-blue-400 hover:text-blue-300">
                View All →
              </Link>
            </div>
            {displaySignals.length > 0 ? (
              <div className="space-y-3">
                {displaySignals.slice(0, 4).map(signal => (
                  <SignalCard key={signal.signalId} signal={signal} />
                ))}
              </div>
            ) : (
              <div className="text-center text-slate-500 py-8">
                <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="text-sm">No signals yet</p>
                <p className="text-xs mt-1 text-slate-600">Signals will appear when opportunities are detected</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - 1/3 width */}
        <div className="space-y-6">
          {/* Master Architecture Panel - Priority signals */}
          <MasterArchPanel signals={masterArchSignals} />

          {/* Trend State & Ignitions */}
          <TrendStatePanel
            acl={acl || undefined}
            activeIgnitions={activeIgnitions}
            indexName={regime?.indexName || 'NIFTY50'}
          />

          {/* Regime Panel */}
          <RegimePanel regime={regime} />

          {/* Market Pulse */}
          <MarketPulse limit={5} />
        </div>
      </div>
    </div>
  )
}

