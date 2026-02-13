import { useEffect, useState, useMemo } from 'react'
import { useDashboardStore } from '../store/dashboardStore'
import { tradesApi, walletApi } from '../services/api'
import OrderHistoryRow from '../components/OrderHistory/OrderHistoryRow'
import type { UnifiedOrder } from '../components/OrderHistory/OrderHistoryRow'
import type { Trade, Position } from '../types'

type FilterMode = 'all' | 'open' | 'closed'
type SortField = 'serial' | 'companyName' | 'strategy' | 'side' | 'entryPrice' | 'exitPrice' | 'pnl' | 'entryTime' | 'exitTime'
type SortDir = 'asc' | 'desc'

export default function OrderHistoryPage() {
  const [apiTrades, setApiTrades] = useState<Trade[]>([])
  const [apiPositions, setApiPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [sortField, setSortField] = useState<SortField>('entryTime')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Live WebSocket data
  const wsTrades = useDashboardStore((s) => s.trades)
  const wsPositions = useDashboardStore((s) => s.wallet?.positions)

  // Initial fetch
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
        console.error('Error loading order history:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Periodic position refresh for resilience (10s)
  useEffect(() => {
    const interval = setInterval(() => {
      walletApi.getPositions().then(setApiPositions).catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  // Build unified order list
  const orders = useMemo(() => {
    // Merge API trades with WS trades (WS takes priority)
    const tradeMap = new Map<string, Trade>()
    apiTrades.forEach((t) => tradeMap.set(t.signalId || t.tradeId, t))
    wsTrades.forEach((t) => tradeMap.set(t.signalId || t.tradeId, t))

    // Merge API positions with WS positions (WS takes priority)
    const positionMap = new Map<string, Position>()
    apiPositions.forEach((p) => positionMap.set(p.signalId || p.positionId, p))
    if (wsPositions) {
      wsPositions.forEach((p) => positionMap.set(p.signalId || p.positionId, p))
    }

    const unified = new Map<string, UnifiedOrder>()

    // Convert positions to unified orders
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

    // Convert trades to unified orders (skip if position already exists for same signalId)
    tradeMap.forEach((trade, key) => {
      if (unified.has(key)) return // Position data takes priority
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

    // Sort by entry time descending
    const sorted = Array.from(unified.values()).sort((a, b) => {
      const ta = a.entryTime ? new Date(a.entryTime).getTime() : 0
      const tb = b.entryTime ? new Date(b.entryTime).getTime() : 0
      return tb - ta
    })

    // Assign serial numbers
    sorted.forEach((o, i) => { o.serial = i + 1 })

    return sorted
  }, [apiTrades, apiPositions, wsTrades, wsPositions])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'pnl' || field === 'entryTime' ? 'desc' : 'asc')
    }
  }

  // Filtered + sorted view
  const displayOrders = useMemo(() => {
    let filtered = orders
    if (filter === 'open') filtered = orders.filter((o) => o.isOpen)
    if (filter === 'closed') filtered = orders.filter((o) => !o.isOpen)

    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'serial': cmp = a.serial - b.serial; break
        case 'companyName': cmp = a.companyName.localeCompare(b.companyName); break
        case 'strategy': cmp = a.strategy.localeCompare(b.strategy); break
        case 'side': cmp = a.side.localeCompare(b.side); break
        case 'entryPrice': cmp = a.entryPrice - b.entryPrice; break
        case 'exitPrice': cmp = (a.exitPrice ?? 0) - (b.exitPrice ?? 0); break
        case 'pnl': cmp = a.pnl - b.pnl; break
        case 'entryTime': {
          const ta = a.entryTime ? new Date(a.entryTime).getTime() : 0
          const tb = b.entryTime ? new Date(b.entryTime).getTime() : 0
          cmp = ta - tb
          break
        }
        case 'exitTime': {
          const ea = a.exitTime ? new Date(a.exitTime).getTime() : 0
          const eb = b.exitTime ? new Date(b.exitTime).getTime() : 0
          cmp = ea - eb
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [orders, filter, sortField, sortDir])

  const openCount = orders.filter((o) => o.isOpen).length
  const closedCount = orders.filter((o) => !o.isOpen).length

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-display font-bold text-white">Order History</h1>
          {openCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-sm text-slate-400">{openCount} open</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <div className="text-2xl font-bold text-white">{orders.length}</div>
          <div className="text-xs text-slate-400">Total Orders</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-blue-400">{openCount}</div>
          <div className="text-xs text-slate-400">Open</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-slate-300">{closedCount}</div>
          <div className="text-xs text-slate-400">Closed</div>
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
                  <SortTh field="serial" label="#" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh field="companyName" label="Security" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh field="strategy" label="Strategy" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh field="side" label="Type" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  <th>Target</th>
                  <th>Trailing SL</th>
                  <SortTh field="entryPrice" label="Entry Price" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh field="exitPrice" label="Exit Price" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh field="pnl" label="P&L" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh field="entryTime" label="Entry Time" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh field="exitTime" label="Exit Time" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
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
            <p>No orders found</p>
            <p className="text-xs mt-1 text-slate-600">Orders will appear when trades are executed</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SortTh({ field, label, sortField, sortDir, onSort }: {
  field: SortField
  label: string
  sortField: SortField
  sortDir: SortDir
  onSort: (f: SortField) => void
}) {
  const active = sortField === field
  return (
    <th
      onClick={() => onSort(field)}
      className="cursor-pointer select-none hover:text-white transition-colors"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[10px] ${active ? 'text-amber-400' : 'text-slate-600'}`}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}
