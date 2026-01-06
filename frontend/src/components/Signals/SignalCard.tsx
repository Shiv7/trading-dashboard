import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Signal } from '../../types'
import TradeModal from '../Trading/TradeModal'

interface SignalCardProps {
  signal: Signal
  showQuickTrade?: boolean
}

// Signal source badge colors
const sourceColors: Record<string, string> = {
  MASTER_ARCH: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  MTIS: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  VCP: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50',
  IPU: 'bg-amber-500/20 text-amber-400 border-amber-500/50',
  FUDKII: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
  BB_SUPERTREND: 'bg-pink-500/20 text-pink-400 border-pink-500/50',
  CURATED: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50',
}

export default function SignalCard({ signal, showQuickTrade = true }: SignalCardProps) {
  const [tradeModalOpen, setTradeModalOpen] = useState(false)
  const isBullish = signal.direction === 'BULLISH'
  const isMasterArch = signal.isMasterArch || signal.signalSource === 'MASTER_ARCH'

  const formatCurrency = (value: number) => {
    if (!value) return '-'
    return value.toFixed(2)
  }

  const getSourceColor = (source: string | undefined) => {
    return sourceColors[source || ''] || 'bg-slate-500/20 text-slate-400 border-slate-500/50'
  }

  const handleQuickTrade = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setTradeModalOpen(true)
  }

  return (
    <>
    <Link
      to={`/stock/${signal.scripCode}`}
      className={`card border-l-4 ${isBullish ? 'border-l-emerald-500' : 'border-l-red-500'} hover:border-slate-600 hover:shadow-lg transition-all duration-200 cursor-pointer block ${isMasterArch ? 'ring-1 ring-purple-500/30 hover:ring-purple-500/50' : ''} hover:-translate-y-0.5`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg">{isBullish ? '📈' : '📉'}</span>
            <span className="font-semibold text-white">
              {signal.companyName || signal.scripCode}
            </span>
            {/* Signal Source Badge */}
            <span className={`text-xs px-2 py-0.5 rounded-full border ${getSourceColor(signal.signalSource)}`}>
              {signal.signalSourceLabel || signal.signalSource || 'MTIS'}
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

      {/* Master Architecture Indicators */}
      {isMasterArch && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-purple-500/10 rounded-lg border border-purple-500/20">
          {signal.tradeDecision && (
            <span className={`badge ${
              signal.tradeDecision === 'ENTER_NOW' ? 'badge-success' : 
              signal.tradeDecision === 'WATCHLIST' ? 'badge-warning' : 'badge-danger'
            }`}>
              {signal.tradeDecision}
            </span>
          )}
          {signal.finalOpportunityScore !== undefined && (
            <span className="text-xs text-white">
              Score: <span className={signal.finalOpportunityScore > 0 ? 'text-emerald-400' : 'text-red-400'}>
                {(signal.finalOpportunityScore * 100).toFixed(0)}%
              </span>
            </span>
          )}
          {signal.directionConfidence !== undefined && (
            <span className="text-xs text-white">
              Conf: <span className="text-purple-400">{(signal.directionConfidence * 100).toFixed(0)}%</span>
            </span>
          )}
          {signal.recommendedLots !== undefined && signal.recommendedLots > 0 && (
            <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
              {signal.recommendedLots} lot{signal.recommendedLots > 1 ? 's' : ''}
            </span>
          )}
          {signal.hedgeRecommended && (
            <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded">
              🛡️ Hedge
            </span>
          )}
        </div>
      )}

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

      {/* Quick Trade Button */}
      {showQuickTrade && signal.allGatesPassed && !signal.tradeStatus && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <button
            onClick={handleQuickTrade}
            className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              isBullish
                ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg shadow-emerald-500/20'
                : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg shadow-red-500/20'
            }`}
          >
            <span>{isBullish ? '🚀' : '📉'}</span>
            Quick {isBullish ? 'BUY' : 'SELL'} @ ₹{formatCurrency(signal.entryPrice)}
          </button>
        </div>
      )}
    </Link>

    {/* Trade Modal */}
    <TradeModal
      isOpen={tradeModalOpen}
      onClose={() => setTradeModalOpen(false)}
      scripCode={signal.scripCode}
      companyName={signal.companyName}
      currentPrice={signal.entryPrice}
      direction={signal.direction === 'UNKNOWN' ? 'NEUTRAL' : signal.direction}
      quantScore={signal.confidence * 100}
    />
    </>
  )
}


