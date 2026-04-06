import { useEffect, useState, useMemo, useCallback } from 'react'
import { strategyWalletsApi } from '../services/api'
import type { StrategyWalletTrade } from '../services/api'
import { isAnyMarketOpen } from '../utils/tradingUtils'
import { computeAnalytics, fmtINR } from '../utils/tradeAnalytics'
import OrderHistoryRow from '../components/OrderHistory/OrderHistoryRow'
import type { UnifiedOrder } from '../components/OrderHistory/OrderHistoryRow'
import WalletSelector from '../components/Trading/WalletSelector'
import TradeModal from '../components/Trading/TradeModal'

type FilterMode = 'all' | 'open' | 'closed'
type TimePeriod = 'TODAY' | '1W' | '1M' | 'QTR' | '1Y' | 'ALL'

const PNL_RESET_DATE_IST = '2026-03-19'

function getPnlResetTimestamp(): number {
  const [y, m, d] = PNL_RESET_DATE_IST.split('-').map(Number)
  const istOffset = 5.5 * 60 * 60 * 1000
  return new Date(Date.UTC(y, m - 1, d) - istOffset).getTime()
}

function periodToRange(key: TimePeriod): { from?: number; to?: number } {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  const todayIST = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffset)
  const resetTs = getPnlResetTimestamp()
  const clamp = (ts: number) => Math.max(ts, resetTs)

  switch (key) {
    case 'TODAY': return { from: clamp(todayIST.getTime()) }
    case '1W': return { from: clamp(todayIST.getTime() - 7 * 86400000) }
    case '1M': return { from: clamp(todayIST.getTime() - 30 * 86400000) }
    case 'QTR': {
      const q = istNow.getUTCMonth()
      const qm = q - (q % 3)
      const qs = new Date(Date.UTC(istNow.getUTCFullYear(), qm, 1) - istOffset)
      return { from: clamp(qs.getTime()) }
    }
    case '1Y': return { from: clamp(todayIST.getTime() - 365 * 86400000) }
    case 'ALL':
    default: return { from: resetTs }
  }
}

const PERIOD_LABELS: Record<TimePeriod, string> = {
  TODAY: 'Today', '1W': '1 Week', '1M': '1 Month', QTR: 'Quarter', '1Y': '1 Year', ALL: 'All Time'
}

export default function OrderManagementPage() {
  const [walletType, setWalletType] = useState<'PAPER' | 'REAL'>('PAPER')
  const [apiTrades, setApiTrades] = useState<StrategyWalletTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [tradeModalOpen, setTradeModalOpen] = useState(false)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('TODAY')

  const loadTrades = useCallback(async (period: TimePeriod) => {
    setLoading(true)
    try {
      const range = periodToRange(period)
      const trades = await strategyWalletsApi.getWeeklyTrades({ limit: 5000, ...range }).catch(() => [])
      setApiTrades(trades)
    } catch (error) {
      console.error('Error loading orders:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTrades(timePeriod)
  }, [timePeriod, loadTrades])

  useEffect(() => {
    const interval = setInterval(() => {
      if (isAnyMarketOpen()) {
        const range = periodToRange(timePeriod)
        strategyWalletsApi.getWeeklyTrades({ limit: 5000, ...range }).then(setApiTrades).catch(() => {})
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [timePeriod])

  const orders = useMemo(() => {
    const unified = new Map<string, UnifiedOrder>()

    // Closed trades from strategy-wallets — same source as PnL page
    apiTrades.forEach((t) => {
      const key = t.tradeId
      if (unified.has(key)) return
      const side = t.side || (t.direction === 'BULLISH' ? 'LONG' : t.direction === 'BEARISH' ? 'SHORT' : 'LONG')
      unified.set(key, {
        id: t.tradeId,
        signalId: t.tradeId,
        scripCode: t.scripCode,
        companyName: t.companyName || t.scripCode,
        strategy: t.strategy || 'Unknown',
        side,
        direction: t.direction,
        isOpen: false,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        stopLoss: t.stopLoss ?? t.equitySl ?? undefined,
        target1: t.target1 ?? t.equityT1 ?? undefined,
        target2: t.target2 ?? t.equityT2 ?? undefined,
        target3: t.target3 ?? t.equityT3 ?? undefined,
        target4: t.target4 ?? t.equityT4 ?? undefined,
        pnl: t.pnl,
        pnlPercent: t.pnlPercent,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        exitReason: t.exitReason,
        quantity: t.quantity,
        exchange: t.exchange,
        instrumentType: t.instrumentType ?? undefined,
        instrumentSymbol: t.instrumentSymbol ?? undefined,
        totalCharges: t.totalCharges ?? undefined,
        estimatedEntrySlippage: t.estimatedEntrySlippage ?? undefined,
        estimatedEntrySlippageTotal: t.estimatedEntrySlippageTotal ?? undefined,
        estimatedSlippagePct: t.estimatedSlippagePct ?? undefined,
        slippageTier: t.slippageTier ?? undefined,
        exitSlippagePerUnit: t.exitSlippagePerUnit ?? undefined,
        exitSlippageTotal: t.exitSlippageTotal ?? undefined,
        grossPnl: t.grossPnl ?? undefined,
        chargesBrokerage: t.chargesBrokerage ?? undefined,
        chargesStt: t.chargesStt ?? undefined,
        chargesExchange: t.chargesExchange ?? undefined,
        chargesGst: t.chargesGst ?? undefined,
        chargesSebi: t.chargesSebi ?? undefined,
        chargesStamp: t.chargesStamp ?? undefined,
        rMultiple: t.rMultiple ?? undefined,
        riskReward: t.riskReward ?? undefined,
        durationMinutes: t.durationMinutes ?? undefined,
        executionMode: t.executionMode,
        capitalEmployed: t.capitalEmployed,
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
  }, [apiTrades])

  const displayOrders = useMemo(() => {
    if (filter === 'open') return orders.filter((o) => o.isOpen)
    if (filter === 'closed') return orders.filter((o) => !o.isOpen)
    return orders
  }, [orders, filter])

  // Use same computeAnalytics as PnL page for consistent numbers
  const analytics = useMemo(() => computeAnalytics(apiTrades), [apiTrades])
  const openCount = orders.filter((o) => o.isOpen).length
  const closedCount = orders.filter((o) => !o.isOpen).length
  const totalPnl = analytics?.totalPnl ?? 0
  const totalCharges = apiTrades.filter(t => t.exitTime).reduce((sum, t) => sum + (t.totalCharges ?? 0), 0)

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
            <h1 className="text-2xl font-display font-bold text-white">Order Book</h1>
            <p className="text-sm text-slate-400 mt-1">Full trade history with charges, slippage, and analytics</p>
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

        {/* Time Period Tabs */}
        <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit">
          {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setTimePeriod(p)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                timePeriod === p
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
              {fmtINR(totalPnl)}
            </div>
            <div className="text-xs text-slate-400">Net P&L</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-amber-400 font-mono">{fmtINR(totalCharges)}</div>
            <div className="text-xs text-slate-400">Total Charges</div>
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
          <div className="text-xs text-slate-500 mb-3">Click any row to expand details (SL, targets, slippage, R-multiple, duration)</div>
          {displayOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-3 text-slate-400">#</th>
                    <th className="text-left py-2 px-3 text-slate-400">Security</th>
                    <th className="text-left py-2 px-3 text-slate-400">Strategy</th>
                    <th className="text-left py-2 px-3 text-slate-400">Side</th>
                    <th className="text-right py-2 px-3 text-slate-400">Qty</th>
                    <th className="text-right py-2 px-3 text-slate-400">Entry</th>
                    <th className="text-right py-2 px-3 text-slate-400">Exit</th>
                    <th className="text-right py-2 px-3 text-slate-400">Gross</th>
                    <th className="text-right py-2 px-3 text-slate-400">Charges</th>
                    <th className="text-right py-2 px-3 text-slate-400">Net P&L</th>
                    <th className="text-left py-2 px-3 text-slate-400">Entry Time</th>
                    <th className="text-left py-2 px-3 text-slate-400">Exit</th>
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
              <p>No {filter === 'all' ? '' : filter} orders found</p>
              <p className="text-xs mt-1 text-slate-600">Place a trade to see your order history</p>
            </div>
          )}
        </div>
      </div>

      {/* Trade Modal */}
      <TradeModal
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        scripCode=""
        companyName=""
        currentPrice={0}
        direction="NEUTRAL"
        quantScore={0}
      />
    </>
  )
}
