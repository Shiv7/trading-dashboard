import { useState, useEffect, useRef } from 'react'
import { X, AlertTriangle, Clock, Plus, CheckCircle } from 'lucide-react'
import { strategyWalletsApi } from '../../services/api'
import type { WalletEvent } from '../../services/api'

const STRATEGY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  FUDKII:           { bg: 'bg-amber-500/10',  text: 'text-amber-400',  border: 'border-amber-500/40' },
  FUKAA:            { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/40' },
  FUDKOI:           { bg: 'bg-teal-500/10',   text: 'text-teal-400',   border: 'border-teal-500/40' },
  PIVOT_CONFLUENCE: { bg: 'bg-blue-500/10',   text: 'text-blue-400',   border: 'border-blue-500/40' },
  MICROALPHA:       { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/40' },
  MERE:             { bg: 'bg-rose-500/10',   text: 'text-rose-400',   border: 'border-rose-500/40' },
  QUANT:            { bg: 'bg-cyan-500/10',   text: 'text-cyan-400',   border: 'border-cyan-500/40' },
}

const PRESET_AMOUNTS = [
  { label: '50K', value: 50000 },
  { label: '1L', value: 100000 },
  { label: '2L', value: 200000 },
]

function formatINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

interface FundTopUpModalProps {
  strategyKey: string
  walletEvent: WalletEvent | null
  onClose: () => void
  onFunded: () => void
}

export default function FundTopUpModal({ strategyKey, walletEvent, onClose, onFunded }: FundTopUpModalProps) {
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<{ newBalance: number; retriedSignals: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const colors = STRATEGY_COLORS[strategyKey] || STRATEGY_COLORS['FUDKII']

  // Countdown timer for MARGIN_INSUFFICIENT events
  useEffect(() => {
    if (!walletEvent?.expiresAt) return
    const update = () => {
      const remaining = Math.max(0, walletEvent.expiresAt! - Date.now())
      setTimeLeft(remaining)
      if (remaining <= 0) onClose()
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [walletEvent?.expiresAt, onClose])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleAddFunds = async () => {
    const numAmount = parseFloat(amount)
    if (!numAmount || numAmount <= 0) {
      setError('Enter a valid amount')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await strategyWalletsApi.addFunds(strategyKey, numAmount)
      if (result.success) {
        setSuccess(result)
        setTimeout(() => onFunded(), 1500)
      } else {
        setError('Failed to add funds')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add funds')
    } finally {
      setLoading(false)
    }
  }

  const formatCountdown = (ms: number) => {
    const totalSec = Math.ceil(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return `${min}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center`}>
              <Plus className={`w-4 h-4 ${colors.text}`} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Add Funds</h2>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} border ${colors.border}`}>
                {strategyKey}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Signal details (when triggered by MARGIN_INSUFFICIENT) */}
        {walletEvent && walletEvent.eventType === 'MARGIN_INSUFFICIENT' && (
          <div className="px-5 py-3 bg-amber-500/5 border-b border-amber-500/20">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-amber-400">Margin Insufficient</span>
              {timeLeft !== null && (
                <div className="flex items-center gap-1 ml-auto">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span className={`text-xs font-mono font-bold ${timeLeft < 30000 ? 'text-red-400' : 'text-amber-400'}`}>
                    {formatCountdown(timeLeft)}
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {walletEvent.instrumentSymbol && (
                <div>
                  <span className="text-slate-500">Symbol</span>
                  <div className="text-white font-medium">{walletEvent.instrumentSymbol}</div>
                </div>
              )}
              {walletEvent.scripCode && (
                <div>
                  <span className="text-slate-500">Scrip</span>
                  <div className="text-white font-medium">{walletEvent.scripCode}</div>
                </div>
              )}
              {walletEvent.side && (
                <div>
                  <span className="text-slate-500">Side</span>
                  <div className={`font-medium ${walletEvent.side === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                    {walletEvent.side}
                  </div>
                </div>
              )}
              {walletEvent.qty != null && (
                <div>
                  <span className="text-slate-500">Qty</span>
                  <div className="text-white font-medium">{walletEvent.qty}</div>
                </div>
              )}
              {walletEvent.requiredMargin != null && (
                <div className="col-span-2">
                  <span className="text-slate-500">Required Margin</span>
                  <div className="text-amber-400 font-bold">{formatINR(walletEvent.requiredMargin)}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Success state */}
        {success ? (
          <div className="px-5 py-8 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm font-bold text-white mb-1">Funds Added</p>
            <p className="text-xs text-slate-400 mb-2">New balance: {formatINR(success.newBalance)}</p>
            {success.retriedSignals > 0 && (
              <p className="text-xs text-emerald-400">{success.retriedSignals} queued signal(s) retried</p>
            )}
          </div>
        ) : (
          <>
            {/* Amount input */}
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Amount</label>
                <input
                  ref={inputRef}
                  type="number"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(null) }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddFunds()}
                  placeholder="Enter amount..."
                  className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Preset buttons */}
              <div className="flex gap-2">
                {PRESET_AMOUNTS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => { setAmount(String(value)); setError(null) }}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      amount === String(value)
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                        : 'bg-slate-700/50 text-slate-400 border border-transparent hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {error && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-5 py-4 border-t border-slate-700 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 bg-slate-700/50 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddFunds}
                disabled={loading || !amount}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Adding...' : 'Add Funds'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
