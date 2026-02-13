import { useEffect, useState, useMemo } from 'react'
import { useDashboardStore } from '../store/dashboardStore'
import { tradesApi, walletApi } from '../services/api'
import OrderHistoryRow from '../components/OrderHistory/OrderHistoryRow'
import type { UnifiedOrder } from '../components/OrderHistory/OrderHistoryRow'
import type { Trade, Position } from '../types'
import WalletSelector from '../components/Trading/WalletSelector'
import TradeModal from '../components/Trading/TradeModal'

type FilterMode = 'all' | 'open' | 'closed'

export default function OrderManagementPage() {
  const [walletType, setWalletType] = useState<'PAPER' | 'REAL'>('PAPER')
  const [apiTrades, setApiTrades] = useState<Trade[]>([])
  const [apiPositions, setApiPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [tradeModalOpen, setTradeModalOpen] = useState(false)

  const wsTrades = useDashboardStore((s) => s.trades)
  const wsPositions = useDashboardStore((s) => s.wallet?.positions)

  useEffect(() => {
    async function load() {
      try {
        const [trades, positions] = await Promise.all([
          tradesApi.getTrades(500).catch(() => []),
          walletApi.getPositions().catch(() => []),
        ])
        setApiTrades(trades)
        setApiPositions(positions)
      } catch (error) {
        console.error('Error loading orders:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      walletApi.getPositions().then(setApiPositions).catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  const orders = useMemo(() => {
    const tradeMap = new Map<string, Trade>()
    apiTrades.forEach((t) => tradeMap.set(t.signalId || t.tradeId, t))
    wsTrades.forEach((t) => tradeMap.set(t.signalId || t.tradeId, t))

    const positionMap = new Map<string, Position>()
    apiPositions.forEach((p) => positionMap.set(p.signalId || p.positionId, p))
    if (wsPositions) {
      wsPositions.forEach((p) => positionMap.set(p.signalId || p.positionId, p))
    }

    const unified = new Map<string, UnifiedOrder>()

    positionMap.forEach((pos, key) => {
      if (pos.quantity <= 0) return
      unified.set(key, {
        id: pos.positionId,
        signalId: pos.signalId || pos.positionId,
        scripCode: pos.scripCode,
        companyName: pos.companyName || pos.scripCode,
        strategy: pos.strategy || 'Unknown',
        side: pos.side,
        isOpen: true,
        entryPrice: pos.avgEntryPrice,
        target1: pos.target1,
        trailingStop: pos.trailingStop ?? undefined,
        pnl: pos.unrealizedPnl,
        pnlPercent: pos.unrealizedPnlPercent,
        entryTime: pos.openedAt,
        serial: 0,
      })
    })

    tradeMap.forEach((trade, key) => {
      if (unified.has(key)) return
      const isOpen = trade.status === 'ACTIVE'
      unified.set(key, {
        id: trade.tradeId,
        signalId: trade.signalId || trade.tradeId,
        scripCode: trade.scripCode,
        companyName: trade.companyName || trade.scripCode,
        strategy: trade.strategy || 'Unknown',
        side: trade.side,
        isOpen,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice ?? undefined,
        target1: trade.target1,
        trailingStop: trade.trailingStop ?? undefined,
        pnl: trade.pnl,
        pnlPercent: trade.pnlPercent,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime ?? undefined,
        serial: 0,
      })
    })

    const sorted = Array.from(unified.values()).sort((a, b) => {
      const ta = a.entryTime ? new Date(a.entryTime).getTime() : 0
      const tb = b.entryTime ? new Date(b.entryTime).getTime() : 0
      return tb - ta
    })

    sorted.forEach((o, i) => { o.serial = i + 1 })
    return sorted
  }, [apiTrades, apiPositions, wsTrades, wsPositions])

  const displayOrders = useMemo(() => {
    if (filter === 'open') return orders.filter((o) => o.isOpen)
    if (filter === 'closed') return orders.filter((o) => !o.isOpen)
    return orders
  }, [orders, filter])

  const openCount = orders.filter((o) => o.isOpen).length
  const closedCount = orders.filter((o) => !o.isOpen).length
  const totalPnl = orders.reduce((sum, o) => sum + (o.pnl || 0), 0)

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-12 bg-slate-700/30 rounded" />
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
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Order Management</h1>
            <p className="text-sm text-slate-400 mt-1">Track and manage all your trades</p>
          </div>
          <div className="flex items-center gap-3">
            <WalletSelector value={walletType} onChange={setWalletType} compact />
            <button
              onClick={() => setTradeModalOpen(true)}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg font-bold hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/30 flex items-center gap-2"
            >
              <span>+</span>
              New Trade
            </button>
          </div>
        </div>

        {/* Wallet indicator bar */}
        <div className={`rounded-lg p-3 border ${
          walletType === 'PAPER'
            ? 'bg-blue-500/5 border-blue-500/20'
            : 'bg-amber-500/5 border-amber-500/20'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${walletType === 'PAPER' ? 'bg-blue-400' : 'bg-amber-400'}`} />
              <span className={`text-sm font-medium ${walletType === 'PAPER' ? 'text-blue-400' : 'text-amber-400'}`}>
                {walletType === 'PAPER' ? 'Paper Trading Mode' : 'Real Trading Mode'}
              </span>
            </div>
            <span className="text-xs text-slate-500">
              {walletType === 'PAPER' ? 'Virtual funds - no real money at risk' : 'Connected to live broker'}
            </span>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <div className="text-2xl font-bold text-white font-mono">{orders.length}</div>
            <div className="text-xs text-slate-400">Total Orders</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-blue-400 font-mono">{openCount}</div>
            <div className="text-xs text-slate-400">Open</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-slate-300 font-mono">{closedCount}</div>
            <div className="text-xs text-slate-400">Closed</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
            </div>
            <div className="text-xs text-slate-400">Total P&L</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {([
            { value: 'all' as FilterMode, label: `All (${orders.length})` },
            { value: 'open' as FilterMode, label: `Open (${openCount})` },
            { value: 'closed' as FilterMode, label: `Closed (${closedCount})` },
          ]).map((f) => (
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

        {/* Table */}
        <div className="card">
          {displayOrders.length > 0 ? (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Security</th>
                    <th>Strategy</th>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Trailing SL</th>
                    <th>Entry Price</th>
                    <th>Exit Price</th>
                    <th>P&L</th>
                    <th>Entry Time</th>
                    <th>Exit Time</th>
                  </tr>
                </thead>
                <tbody>
                  {displayOrders.map((order) => (
                    <OrderHistoryRow key={order.id} order={order} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-slate-500 py-12">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p>No {walletType.toLowerCase()} orders found</p>
              <p className="text-xs mt-1 text-slate-600">Place a trade to see your order history</p>
            </div>
          )}
        </div>
      </div>

      <TradeModal
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        scripCode=""
        currentPrice={0}
      />
    </>
  )
}
