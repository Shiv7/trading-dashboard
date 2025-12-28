import { useEffect, useState } from 'react'
import TradeRow from '../components/Trades/TradeRow'
import { tradesApi } from '../services/api'
import type { Trade, TradeStats } from '../types'

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [stats, setStats] = useState<TradeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')

  useEffect(() => {
    async function loadTrades() {
      try {
        const [tradesData, statsData] = await Promise.all([
          tradesApi.getTrades(100, filter || undefined),
          tradesApi.getTradeStats(),
        ])
        setTrades(tradesData)
        setStats(statsData)
      } catch (error) {
        console.error('Error loading trades:', error)
      } finally {
        setLoading(false)
      }
    }
    loadTrades()
  }, [filter])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading trades...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-display font-bold text-white">📈 Trade History</h1>

      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="card text-center">
            <div className="text-2xl font-bold text-white">{stats.totalTrades}</div>
            <div className="text-xs text-slate-400">Total</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-emerald-400">{stats.wins}</div>
            <div className="text-xs text-slate-400">Wins</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-red-400">{stats.losses}</div>
            <div className="text-xs text-slate-400">Losses</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${stats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
              {stats.winRate.toFixed(1)}%
            </div>
            <div className="text-xs text-slate-400">Win Rate</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ₹{(stats.totalPnl / 1000).toFixed(1)}K
            </div>
            <div className="text-xs text-slate-400">Total P&L</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${stats.avgRMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {stats.avgRMultiple >= 0 ? '+' : ''}{stats.avgRMultiple.toFixed(2)}R
            </div>
            <div className="text-xs text-slate-400">Avg R</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {[
          { value: '', label: 'All' },
          { value: 'CLOSED_WIN', label: 'Wins' },
          { value: 'CLOSED_LOSS', label: 'Losses' },
          { value: 'ACTIVE', label: 'Active' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Trades Table */}
      <div className="card">
        {trades.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>P&L</th>
                  <th>R-Multiple</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(trade => (
                  <TradeRow key={trade.tradeId} trade={trade} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-slate-500 py-12">
            No trades found
          </div>
        )}
      </div>
    </div>
  )
}

