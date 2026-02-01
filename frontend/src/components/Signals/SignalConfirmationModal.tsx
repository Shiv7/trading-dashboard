import { useState } from 'react'
import type { TradingSignal } from '../../services/api'

interface SignalConfirmationModalProps {
  signal: TradingSignal
  onConfirm: () => Promise<void>
  onReject: (reason?: string) => Promise<void>
  onClose: () => void
}

export default function SignalConfirmationModal({
  signal,
  onConfirm,
  onReject,
  onClose,
}: SignalConfirmationModalProps) {
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectReason, setShowRejectReason] = useState(false)

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      await onConfirm()
    } finally {
      setConfirming(false)
    }
  }

  const handleReject = async () => {
    if (!showRejectReason) {
      setShowRejectReason(true)
      return
    }
    setRejecting(true)
    try {
      await onReject(rejectReason || 'User rejected')
    } finally {
      setRejecting(false)
    }
  }

  // Calculate metrics
  const risk = signal.entryPrice && signal.stopLoss
    ? Math.abs(signal.entryPrice - signal.stopLoss)
    : 0
  const reward = signal.entryPrice && signal.target1
    ? Math.abs(signal.target1 - signal.entryPrice)
    : 0
  const riskReward = risk > 0 ? reward / risk : 0

  const riskPercent = signal.entryPrice && risk > 0
    ? (risk / signal.entryPrice) * 100
    : 0
  const rewardPercent = signal.entryPrice && reward > 0
    ? (reward / signal.entryPrice) * 100
    : 0

  const isBullish = signal.direction === 'BULLISH'

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-slate-700">
        {/* Header */}
        <div className={`p-4 border-b border-slate-700 ${
          isBullish ? 'bg-emerald-500/10' : 'bg-red-500/10'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span className={isBullish ? 'text-emerald-400' : 'text-red-400'}>
                  {isBullish ? '\u2191' : '\u2193'}
                </span>
                {signal.companyName || signal.scripCode}
              </h2>
              <div className="text-sm text-slate-400 mt-1">
                Signal: {signal.direction} | Score: {signal.compositeScore?.toFixed(1)}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors text-2xl"
            >
              x
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Price Levels */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-700/50 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-400 mb-1">Entry Price</div>
              <div className="text-lg font-bold text-white">
                {signal.entryPrice?.toFixed(2) || '-'}
              </div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-3 text-center border border-red-500/30">
              <div className="text-xs text-red-400 mb-1">Stop Loss</div>
              <div className="text-lg font-bold text-red-400">
                {signal.stopLoss?.toFixed(2) || '-'}
              </div>
              <div className="text-xs text-red-400/70">
                -{riskPercent.toFixed(2)}%
              </div>
            </div>
            <div className="bg-emerald-500/10 rounded-lg p-3 text-center border border-emerald-500/30">
              <div className="text-xs text-emerald-400 mb-1">Target 1</div>
              <div className="text-lg font-bold text-emerald-400">
                {signal.target1?.toFixed(2) || '-'}
              </div>
              <div className="text-xs text-emerald-400/70">
                +{rewardPercent.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Risk/Reward Visualization */}
          <div className="bg-slate-700/30 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-slate-400">Risk/Reward</span>
              <span className={`text-lg font-bold ${
                riskReward >= 2 ? 'text-emerald-400' :
                riskReward >= 1 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                1:{riskReward.toFixed(2)}
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden flex">
              <div
                className="bg-red-500"
                style={{ width: `${100 / (1 + riskReward)}%` }}
              />
              <div
                className="bg-emerald-500"
                style={{ width: `${(riskReward * 100) / (1 + riskReward)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-red-400">Risk: {risk.toFixed(2)}</span>
              <span className="text-emerald-400">Reward: {reward.toFixed(2)}</span>
            </div>
          </div>

          {/* Signal Details */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-400">Timeframe: </span>
              <span className="text-white">{signal.timeframe || '5m'}</span>
            </div>
            <div>
              <span className="text-slate-400">Confidence: </span>
              <span className="text-white">{signal.confidence?.toFixed(1) || '-'}%</span>
            </div>
            <div>
              <span className="text-slate-400">State: </span>
              <span className="text-white">{signal.state || '-'}</span>
            </div>
            <div>
              <span className="text-slate-400">Event: </span>
              <span className="text-white">{signal.event || '-'}</span>
            </div>
          </div>

          {/* Reason */}
          {signal.reason && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <div className="text-xs text-blue-400 mb-1">Signal Reason</div>
              <div className="text-sm text-white">{signal.reason}</div>
            </div>
          )}

          {/* Reject Reason Input */}
          {showRejectReason && (
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Rejection Reason (optional)</label>
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why are you rejecting this signal?"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
          )}

          {/* Quality Indicators */}
          <div className="flex flex-wrap gap-2">
            {signal.compositeScore >= 70 && (
              <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">
                High Score
              </span>
            )}
            {riskReward >= 2 && (
              <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">
                Good R:R
              </span>
            )}
            {signal.confidence && signal.confidence >= 70 && (
              <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full">
                High Confidence
              </span>
            )}
            {riskPercent > 3 && (
              <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">
                Wide Stop ({riskPercent.toFixed(1)}%)
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 flex gap-3">
          <button
            onClick={handleReject}
            disabled={confirming || rejecting}
            className="flex-1 py-3 rounded-lg font-medium bg-slate-700 text-slate-300 hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50"
          >
            {rejecting ? 'Rejecting...' : showRejectReason ? 'Confirm Reject' : 'Reject'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming || rejecting}
            className={`flex-1 py-3 rounded-lg font-bold transition-all disabled:opacity-50 ${
              isBullish
                ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-lg shadow-emerald-500/30'
                : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg shadow-red-500/30'
            }`}
          >
            {confirming ? 'Executing...' : `Execute ${isBullish ? 'BUY' : 'SELL'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
