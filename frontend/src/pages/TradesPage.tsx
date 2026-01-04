import { useEffect, useState } from 'react'
import TradeRow from '../components/Trades/TradeRow'
import { useDashboardStore } from '../store/dashboardStore'
import { tradesApi } from '../services/api'
import type { Trade, TradeStats } from '../types'

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [stats, setStats] = useState<TradeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')

  // Get WebSocket trades
  const wsTrades = useDashboardStore((s) => s.trades)

  useEffect(() => {
    async function loadTrades() {
      try {
        const [tradesData, statsData] = await Promise.all([
          tradesApi.getTrades(100, filter || undefined).catch(() => []),
          tradesApi.getTradeStats().catch(() => null),
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

  // Merge WebSocket trades with loaded trades
  const mergedTrades = [...wsTrades]
  trades.forEach(trade => {
    if (!mergedTrades.find(t => t.tradeId === trade.tradeId)) {
      mergedTrades.push(trade)
    }
  })

  // Apply filter and sort by time
  const displayTrades = mergedTrades
    .filter(t => !filter || t.status === filter)
    .sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())

  // Count new trades from WebSocket
  const newTradesCount = wsTrades.filter(wt =>
    !trades.find(t => t.tradeId === wt.tradeId)
  ).length

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card text-center animate-pulse">
              <div className="h-8 w-16 bg-slate-700 rounded mx-auto mb-2" />
              <div className="h-4 w-12 bg-slate-800 rounded mx-auto" />
            </div>
          ))}
        </div>
        <div className="card animate-pulse">
          <div className="h-64 bg-slate-700/30 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-display font-bold text-white">📈 Trade History</h1>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-slate-400">Live</span>
          </div>
          {newTradesCount > 0 && (
            <span className="badge badge-success animate-pulse">
              +{newTradesCount} new
            </span>
          )}
        </div>
      </div>

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
        {displayTrades.length > 0 ? (
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
                {displayTrades.map(trade => (
                  <TradeRow key={trade.tradeId} trade={trade} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-slate-500 py-12">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p>No trades found</p>
            <p className="text-xs mt-1 text-slate-600">Trades will appear when positions are opened</p>
          </div>
        )}
      </div>
    </div>
  )
}

