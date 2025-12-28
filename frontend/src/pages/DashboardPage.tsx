import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import WalletCard from '../components/Wallet/WalletCard'
import PositionCard from '../components/Wallet/PositionCard'
import SignalCard from '../components/Signals/SignalCard'
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

  useEffect(() => {
    async function loadData() {
      try {
        const [walletData, scoresData, signalsData, statsData] = await Promise.all([
          walletApi.getWallet(),
          scoresApi.getTopScores(5),
          signalsApi.getSignals(0, 5, undefined, true),
          tradesApi.getTradeStats(),
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
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Wallet Overview */}
      <WalletCard wallet={displayWallet} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
              No active positions
            </div>
          )}
        </div>

        {/* Trade Stats */}
        <div className="card">
          <div className="card-header">
            <span>📈 Performance Stats</span>
            <Link to="/trades" className="text-sm text-blue-400 hover:text-blue-300">
              View History →
            </Link>
          </div>
          {tradeStats ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-white">{tradeStats.totalTrades}</div>
                <div className="text-sm text-slate-400">Total Trades</div>
              </div>
              <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                <div className={`text-3xl font-bold ${tradeStats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tradeStats.winRate.toFixed(1)}%
                </div>
                <div className="text-sm text-slate-400">Win Rate</div>
              </div>
              <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                <div className={`text-3xl font-bold ${tradeStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  ₹{(tradeStats.totalPnl / 1000).toFixed(1)}K
                </div>
                <div className="text-sm text-slate-400">Total P&L</div>
              </div>
              <div className="bg-slate-700/30 rounded-lg p-4 text-center">
                <div className={`text-3xl font-bold ${tradeStats.avgRMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tradeStats.avgRMultiple >= 0 ? '+' : ''}{tradeStats.avgRMultiple.toFixed(2)}R
                </div>
                <div className="text-sm text-slate-400">Avg R-Multiple</div>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8">
              No trade data
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Scores */}
        <div className="card">
          <div className="card-header">
            <span>🎯 Top Scores (Live)</span>
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
                  </tr>
                </thead>
                <tbody>
                  {displayScores.map(score => (
                    <tr key={score.scripCode} className="hover:bg-slate-700/30">
                      <td>
                        <Link to={`/stock/${score.scripCode}`} className="text-white hover:text-blue-400">
                          {score.companyName || score.scripCode}
                        </Link>
                      </td>
                      <td className={score.vcpCombinedScore >= 0.7 ? 'text-emerald-400' : 'text-slate-400'}>
                        {(score.vcpCombinedScore * 100).toFixed(0)}%
                      </td>
                      <td className="flex items-center gap-1">
                        <span className={score.ipuFinalScore >= 0.7 ? 'text-emerald-400' : 'text-slate-400'}>
                          {(score.ipuFinalScore * 100).toFixed(0)}%
                        </span>
                        {score.ipuXfactor && <span className="text-yellow-400">⚡</span>}
                      </td>
                      <td className={`font-bold ${score.overallScore >= 7 ? 'text-emerald-400' : score.overallScore >= 5 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {score.overallScore.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8">
              No score data yet
            </div>
          )}
        </div>

        {/* Recent Signals */}
        <div className="card">
          <div className="card-header">
            <span>⚡ Recent Signals</span>
            <Link to="/signals" className="text-sm text-blue-400 hover:text-blue-300">
              View All →
            </Link>
          </div>
          {displaySignals.length > 0 ? (
            <div className="space-y-3">
              {displaySignals.slice(0, 3).map(signal => (
                <SignalCard key={signal.signalId} signal={signal} />
              ))}
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8">
              No signals yet
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

