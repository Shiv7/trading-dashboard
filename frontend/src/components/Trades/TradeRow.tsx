import { useState } from 'react'
import type { Trade } from '../../types'

interface TradeRowProps {
  trade: Trade
}

export default function TradeRow({ trade }: TradeRowProps) {
  const [showCharges, setShowCharges] = useState(false)
  const isLong = trade.side === 'LONG'
  const charges = trade.totalCharges ?? 0

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(value)
  }

  const getStatusBadge = () => {
    switch (trade.status) {
      case 'CLOSED_WIN':
        return <span className="badge badge-success">WIN</span>
      case 'CLOSED_LOSS':
        return <span className="badge badge-danger">LOSS</span>
      case 'CLOSED_TRAILING':
        return <span className="badge badge-warning">TRAIL</span>
      case 'ACTIVE':
        return <span className="badge badge-neutral">ACTIVE</span>
      default:
        return <span className="badge badge-neutral">{trade.status}</span>
    }
  }

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  return (
    <tr className="hover:bg-slate-700/30">
      <td className="py-3 px-4">
        <div className="font-medium text-white">{trade.companyName || trade.scripCode}</div>
        <div className="text-xs text-slate-500">
          {trade.entryTime ? new Date(trade.entryTime).toLocaleDateString() : '-'}
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={`badge ${isLong ? 'badge-success' : 'badge-danger'}`}>
          {trade.side}
        </span>
      </td>
      <td className="py-3 px-4 text-slate-300">
        {(trade.entryPrice ?? 0).toFixed(2)}
      </td>
      <td className="py-3 px-4 text-slate-300">
        {trade.exitPrice?.toFixed(2) || '-'}
      </td>
      <td className="py-3 px-4">
        <div
          className={`${charges > 0 ? 'cursor-pointer' : ''}`}
          onClick={charges > 0 ? () => setShowCharges(v => !v) : undefined}
          title={charges > 0 ? 'Click to see charges' : undefined}
        >
          <span className={trade.pnl >= 0 ? 'num-positive' : 'num-negative'}>
            {formatCurrency(trade.pnl)}
          </span>
          <div className={`text-xs ${trade.pnl >= 0 ? 'num-positive' : 'num-negative'}`}>
            {trade.pnlPercent >= 0 ? '+' : ''}{(trade.pnlPercent ?? 0).toFixed(2)}%
            {charges > 0 && <span className="text-slate-500 ml-1">{showCharges ? '\u25B2' : '\u25BC'}</span>}
          </div>
        </div>
        {showCharges && charges > 0 && (
          <div className="mt-1 text-[10px] bg-slate-800/80 rounded px-2 py-1 border border-slate-600/40 space-y-0.5">
            <div className="flex justify-between gap-3">
              <span className="text-slate-400">Gross</span>
              <span className={(trade.pnl + charges) >= 0 ? 'num-positive' : 'num-negative'}>
                {formatCurrency(trade.pnl + charges)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-400">Charges</span>
              <span className="text-red-400">-{formatCurrency(charges)}</span>
            </div>
            <div className="flex justify-between gap-3 border-t border-slate-600/40 pt-0.5">
              <span className="text-slate-300 font-medium">Net</span>
              <span className={`font-medium ${trade.pnl >= 0 ? 'num-positive' : 'num-negative'}`}>
                {formatCurrency(trade.pnl)}
              </span>
            </div>
          </div>
        )}
      </td>
      <td className="py-3 px-4">
        <span className={`font-medium ${trade.rMultiple >= 0 ? 'num-positive' : 'num-negative'}`}>
          {trade.rMultiple >= 0 ? '+' : ''}{(trade.rMultiple ?? 0).toFixed(2)}R
        </span>
      </td>
      <td className="py-3 px-4 text-slate-400 text-sm">
        {formatDuration(trade.durationMinutes)}
      </td>
      <td className="py-3 px-4">
        {getStatusBadge()}
      </td>
      <td className="py-3 px-4 text-slate-400 text-sm">
        {trade.exitReason || '-'}
      </td>
    </tr>
  )
}

