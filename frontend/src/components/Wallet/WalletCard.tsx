import type { Wallet } from '../../types'

interface WalletCardProps {
  wallet: Wallet | null
}

export default function WalletCard({ wallet }: WalletCardProps) {
  if (!wallet) {
    return (
      <div className="card animate-pulse">
        <div className="h-32 bg-slate-700 rounded" />
      </div>
    )
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  const pnlColor = wallet.totalPnl >= 0 ? 'num-positive' : 'num-negative'
  const dayPnlColor = wallet.dayPnl >= 0 ? 'num-positive' : 'num-negative'

  return (
    <div className="card">
      <div className="card-header">
        <span>💰 Wallet Overview</span>
        <span className="text-xs text-slate-400">
          Updated: {new Date(wallet.lastUpdated).toLocaleTimeString()}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Capital */}
        <div className="bg-slate-700/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Capital</div>
          <div className="text-lg font-semibold text-white">
            {formatCurrency(wallet.currentCapital)}
          </div>
          <div className="text-xs text-slate-500">
            Initial: {formatCurrency(wallet.initialCapital)}
          </div>
        </div>

        {/* Available */}
        <div className="bg-slate-700/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Available</div>
          <div className="text-lg font-semibold text-white">
            {formatCurrency(wallet.availableMargin)}
          </div>
          <div className="text-xs text-slate-500">
            {wallet.openPositionsCount} open positions
          </div>
        </div>

        {/* Day P&L */}
        <div className="bg-slate-700/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Day P&L</div>
          <div className={`text-lg font-semibold ${dayPnlColor}`}>
            {formatCurrency(wallet.dayPnl)}
          </div>
          <div className={`text-xs ${dayPnlColor}`}>
            {formatPercent((wallet.dayPnl / wallet.initialCapital) * 100)}
          </div>
        </div>

        {/* Total P&L */}
        <div className="bg-slate-700/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Total P&L</div>
          <div className={`text-lg font-semibold ${pnlColor}`}>
            {formatCurrency(wallet.totalPnl)}
          </div>
          <div className={`text-xs ${pnlColor}`}>
            {formatPercent((wallet.totalPnl / wallet.initialCapital) * 100)}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 pt-4 border-t border-slate-700/50 grid grid-cols-4 gap-4 text-center">
        <div>
          <div className="text-xl font-bold text-white">{wallet.totalTradesCount}</div>
          <div className="text-xs text-slate-400">Total Trades</div>
        </div>
        <div>
          <div className="text-xl font-bold text-emerald-400">{wallet.winCount}</div>
          <div className="text-xs text-slate-400">Wins</div>
        </div>
        <div>
          <div className="text-xl font-bold text-red-400">{wallet.lossCount}</div>
          <div className="text-xs text-slate-400">Losses</div>
        </div>
        <div>
          <div className={`text-xl font-bold ${wallet.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
            {wallet.winRate.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-400">Win Rate</div>
        </div>
      </div>
    </div>
  )
}

