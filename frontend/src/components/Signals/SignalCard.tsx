import { Link } from 'react-router-dom'
import type { Signal } from '../../types'

interface SignalCardProps {
  signal: Signal
}

export default function SignalCard({ signal }: SignalCardProps) {
  const isBullish = signal.direction === 'BULLISH'
  
  const formatCurrency = (value: number) => {
    if (!value) return '-'
    return value.toFixed(2)
  }

  return (
    <Link 
      to={`/stock/${signal.scripCode}`}
      className={`card border-l-4 ${isBullish ? 'border-l-emerald-500' : 'border-l-red-500'} hover:border-blue-500/50 transition-colors cursor-pointer block`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">{isBullish ? '📈' : '📉'}</span>
            <span className="font-semibold text-white">
              {signal.companyName || signal.scripCode}
            </span>
            <span className={`badge ${signal.allGatesPassed ? 'badge-success' : 'badge-danger'}`}>
              {signal.allGatesPassed ? 'PASSED' : 'REJECTED'}
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {signal.signalType} • {new Date(signal.timestamp).toLocaleTimeString()}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${isBullish ? 'text-emerald-400' : 'text-red-400'}`}>
            {signal.direction}
          </div>
          {signal.xfactorFlag && (
            <span className="text-yellow-400 text-xs">⚡ X-Factor</span>
          )}
        </div>
      </div>

      {/* Levels */}
      <div className="grid grid-cols-4 gap-2 text-xs mb-3">
        <div className="bg-slate-700/30 rounded p-2">
          <div className="text-slate-400">Entry</div>
          <div className="text-white font-medium">{formatCurrency(signal.entryPrice)}</div>
        </div>
        <div className="bg-red-500/10 rounded p-2">
          <div className="text-red-400">SL</div>
          <div className="text-white font-medium">{formatCurrency(signal.stopLoss)}</div>
        </div>
        <div className="bg-emerald-500/10 rounded p-2">
          <div className="text-emerald-400">T1</div>
          <div className="text-white font-medium">{formatCurrency(signal.target1)}</div>
        </div>
        <div className="bg-blue-500/10 rounded p-2">
          <div className="text-blue-400">R:R</div>
          <div className="text-white font-medium">{signal.riskRewardRatio?.toFixed(2) || '-'}</div>
        </div>
      </div>

      {/* Scores */}
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span>VCP: <span className="text-slate-200">{(signal.vcpScore * 100).toFixed(0)}%</span></span>
        <span>IPU: <span className="text-slate-200">{(signal.ipuScore * 100).toFixed(0)}%</span></span>
        <span>Regime: <span className="text-slate-200">{signal.regimeLabel}</span></span>
        {signal.positionSizeMultiplier > 1 && (
          <span className="text-emerald-400">Size: {signal.positionSizeMultiplier.toFixed(1)}x</span>
        )}
      </div>

      {/* Gate fail reason */}
      {signal.gateFailReason && (
        <div className="mt-2 text-xs text-red-400">
          ⚠️ {signal.gateFailReason}
        </div>
      )}

      {/* Trade outcome */}
      {signal.tradeStatus && (
        <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between text-xs">
          <span className={`badge ${signal.tradeStatus.includes('WIN') ? 'badge-success' : 'badge-danger'}`}>
            {signal.tradeStatus}
          </span>
          {signal.rMultiple !== undefined && (
            <span className={signal.rMultiple >= 0 ? 'num-positive' : 'num-negative'}>
              {signal.rMultiple >= 0 ? '+' : ''}{signal.rMultiple.toFixed(2)}R
            </span>
          )}
        </div>
      )}
    </Link>
  )
}

