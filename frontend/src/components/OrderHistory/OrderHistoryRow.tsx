interface UnifiedOrder {
  id: string
  signalId: string
  scripCode: string
  companyName: string
  strategy: string
  side: 'LONG' | 'SHORT'
  isOpen: boolean
  entryPrice: number
  exitPrice?: number
  target1: number
  trailingStop?: number
  pnl: number
  pnlPercent: number
  entryTime: string
  exitTime?: string
  serial: number
}

interface OrderHistoryRowProps {
  order: UnifiedOrder
}

export type { UnifiedOrder }

export default function OrderHistoryRow({ order }: OrderHistoryRowProps) {
  const isLong = order.side === 'LONG'

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(value)
  }

  const formatTime = (time?: string) => {
    if (!time) return '-'
    try {
      const d = new Date(time)
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return '-'
    }
  }

  return (
    <tr className="hover:bg-slate-700/30">
      {/* Serial */}
      <td className="py-3 px-4 text-slate-500 text-sm">{order.serial}</td>

      {/* Security */}
      <td className="py-3 px-4">
        <div className="font-medium text-white">{order.companyName || order.scripCode}</div>
        <div className="text-xs text-slate-500">{order.scripCode}</div>
      </td>

      {/* Strategy */}
      <td className="py-3 px-4">
        <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
          {order.strategy}
        </span>
      </td>

      {/* Side */}
      <td className="py-3 px-4">
        <span className={`badge ${isLong ? 'badge-success' : 'badge-danger'}`}>
          {order.side}
        </span>
      </td>

      {/* Target */}
      <td className="py-3 px-4 text-slate-300 text-sm">
        {order.target1 > 0 ? order.target1.toFixed(2) : '-'}
      </td>

      {/* Trailing SL */}
      <td className="py-3 px-4 text-slate-300 text-sm">
        {order.trailingStop != null && order.trailingStop > 0 ? order.trailingStop.toFixed(2) : '-'}
      </td>

      {/* Entry Price */}
      <td className="py-3 px-4 text-slate-300">{order.entryPrice.toFixed(2)}</td>

      {/* Exit Price */}
      <td className="py-3 px-4 text-slate-300">
        {order.isOpen ? '-' : (order.exitPrice?.toFixed(2) ?? '-')}
      </td>

      {/* P&L */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-1.5">
          {order.isOpen && (
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" title="Live P&L" />
          )}
          <div>
            <span className={order.pnl >= 0 ? 'num-positive' : 'num-negative'}>
              {formatCurrency(order.pnl)}
            </span>
            <div className={`text-xs ${order.pnl >= 0 ? 'num-positive' : 'num-negative'}`}>
              {order.pnlPercent >= 0 ? '+' : ''}{order.pnlPercent.toFixed(2)}%
            </div>
          </div>
        </div>
      </td>

      {/* Entry Time */}
      <td className="py-3 px-4 text-slate-400 text-sm">{formatTime(order.entryTime)}</td>

      {/* Exit Time */}
      <td className="py-3 px-4 text-slate-400 text-sm">
        {order.isOpen ? (
          <span className="badge badge-neutral">OPEN</span>
        ) : (
          formatTime(order.exitTime)
        )}
      </td>
    </tr>
  )
}
