import { Link } from 'react-router-dom'
import type { Position } from '../../types'
import PositionActions from '../Trading/PositionActions'
import { formatTimeAgo } from '../../utils/formatTime'

interface PositionCardProps {
  position: Position
  onUpdate?: () => void
}

export default function PositionCard({ position, onUpdate }: PositionCardProps) {
  const isLong = position.side === 'LONG'
  const pnlColor = position.unrealizedPnl >= 0 ? 'num-positive' : 'num-negative'
  const isOpen = position.quantity > 0

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(value)
  }

  return (
    <div className="card hover:border-blue-500/50 transition-colors">
      <Link
        to={`/stock/${position.scripCode}`}
        className="block"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">
                {position.companyName || position.scripCode}
              </span>
              <span className={`badge ${isLong ? 'badge-success' : 'badge-danger'}`}>
                {position.side}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {position.quantity} shares @ {formatCurrency(position.avgEntryPrice)}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-lg font-semibold ${pnlColor}`}>
              {formatCurrency(position.unrealizedPnl)}
            </div>
            <div className={`text-xs ${pnlColor}`}>
              {position.unrealizedPnlPercent >= 0 ? '+' : ''}{position.unrealizedPnlPercent.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Levels */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-slate-700/30 rounded p-2">
            <div className="text-slate-400">Entry</div>
            <div className="text-white font-medium">{position.avgEntryPrice.toFixed(2)}</div>
          </div>
          <div className="bg-red-500/10 rounded p-2">
            <div className="text-red-400">SL</div>
            <div className="text-white font-medium">
              {position.trailingStop ? position.trailingStop.toFixed(2) : position.stopLoss.toFixed(2)}
            </div>
          </div>
          <div className="bg-emerald-500/10 rounded p-2">
            <div className="text-emerald-400">Target</div>
            <div className="text-white font-medium">{position.target1.toFixed(2)}</div>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700/50">
          {position.tp1Hit && (
            <span className="badge badge-success">T1 Hit</span>
          )}
          {position.trailingType && position.trailingType !== 'NONE' && (
            <span className="badge badge-warning">Trailing Active</span>
          )}
          <span className="text-xs text-slate-500 ml-auto">
            {formatTimeAgo(position.openedAt)}
          </span>
        </div>
      </Link>

      {/* Position Actions - Only show for open positions */}
      {isOpen && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <PositionActions
            scripCode={position.scripCode}
            currentSl={position.stopLoss}
            currentTp1={position.target1}
            currentTp2={position.target2}
            currentPrice={position.currentPrice}
            trailingActive={position.trailingType !== 'NONE' && position.trailingType !== undefined}
            onUpdate={onUpdate}
          />
        </div>
      )}
    </div>
  )
}
