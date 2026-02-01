import { useState, useEffect, useCallback } from 'react'
import { riskStatusApi, type RiskStatus } from '../../services/api'

export default function RiskStatusPanel() {
  const [status, setStatus] = useState<RiskStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const data = await riskStatusApi.getStatus()
      setStatus(data)
      setError(null)
    } catch (err) {
      setError('Failed to load risk status')
      console.error('Error loading risk status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    const interval = setInterval(loadStatus, 10000) // Check every 10 seconds
    return () => clearInterval(interval)
  }, [loadStatus])

  const handleResetCircuitBreaker = async () => {
    setResetting(true)
    try {
      await riskStatusApi.resetCircuitBreaker()
      await loadStatus()
    } catch (err) {
      setError('Failed to reset circuit breaker')
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-24 bg-slate-700 rounded" />
      </div>
    )
  }

  // Handle missing or incomplete status data
  const safeStatus = {
    healthy: status?.healthy ?? true,
    status: status?.status ?? 'UNKNOWN',
    message: status?.message ?? 'Risk status unavailable',
    circuitBreakerTripped: status?.circuitBreakerTripped ?? false,
    circuitBreakerReason: status?.circuitBreakerReason ?? '',
    dailyLossPercent: status?.dailyLossPercent ?? 0,
    dailyLossAmount: status?.dailyLossAmount ?? 0,
    dailyLossLimit: status?.dailyLossLimit ?? 0,
    drawdownPercent: status?.drawdownPercent ?? 0,
    drawdownAmount: status?.drawdownAmount ?? 0,
    drawdownLimit: status?.drawdownLimit ?? 0,
    openPositions: status?.openPositions ?? 0,
    maxOpenPositions: status?.maxOpenPositions ?? 10,
    availableMargin: status?.availableMargin ?? 0,
    currentBalance: status?.currentBalance ?? 0,
  }

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'HEALTHY': return 'bg-emerald-500'
      case 'WARNING': return 'bg-yellow-500'
      case 'CRITICAL': return 'bg-red-500'
      case 'HALTED': return 'bg-red-700'
      default: return 'bg-slate-500'
    }
  }

  const getStatusBg = (s: string) => {
    switch (s) {
      case 'HEALTHY': return 'bg-emerald-500/10 border-emerald-500/30'
      case 'WARNING': return 'bg-yellow-500/10 border-yellow-500/30'
      case 'CRITICAL': return 'bg-red-500/10 border-red-500/30'
      case 'HALTED': return 'bg-red-700/20 border-red-700/50'
      default: return 'bg-slate-500/10 border-slate-500/30'
    }
  }

  const formatNumber = (val: number | undefined | null, decimals = 1): string => {
    if (val === undefined || val === null || isNaN(val)) return '0'
    return val.toFixed(decimals)
  }

  const formatCurrency = (val: number | undefined | null): string => {
    if (val === undefined || val === null || isNaN(val)) return '₹0'
    return val.toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    })
  }

  return (
    <div className={`card border ${getStatusBg(safeStatus.status)}`}>
      <div className="card-header">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${getStatusColor(safeStatus.status)} ${
            safeStatus.status === 'HALTED' ? 'animate-pulse' : ''
          }`} />
          <span className="text-lg">Risk Status</span>
          <span className={`text-sm font-medium px-2 py-0.5 rounded ${
            safeStatus.status === 'HEALTHY' ? 'bg-emerald-500/20 text-emerald-400' :
            safeStatus.status === 'WARNING' ? 'bg-yellow-500/20 text-yellow-400' :
            safeStatus.status === 'UNKNOWN' ? 'bg-slate-500/20 text-slate-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {safeStatus.status}
          </span>
        </div>
        {safeStatus.circuitBreakerTripped && (
          <button
            onClick={handleResetCircuitBreaker}
            disabled={resetting}
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {resetting ? 'Resetting...' : 'Reset Circuit Breaker'}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/20 text-red-400 px-3 py-2 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {safeStatus.circuitBreakerTripped && (
        <div className="bg-red-700/20 border border-red-700/50 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-red-400 font-medium">
            <span className="text-lg">!!</span>
            <span>Trading Halted</span>
          </div>
          <div className="text-sm text-red-300 mt-1">
            {safeStatus.circuitBreakerReason || 'Circuit breaker activated'}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Daily Loss */}
        <div className="bg-slate-700/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Daily Loss</div>
          <div className="flex items-end justify-between">
            <div className={`text-lg font-bold ${
              safeStatus.dailyLossPercent >= 90 ? 'text-red-400' :
              safeStatus.dailyLossPercent >= 70 ? 'text-yellow-400' :
              'text-white'
            }`}>
              {formatNumber(safeStatus.dailyLossPercent)}%
            </div>
            <div className="text-xs text-slate-500">
              {formatNumber(safeStatus.dailyLossAmount, 0)} / {formatNumber(safeStatus.dailyLossLimit, 0)}
            </div>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                safeStatus.dailyLossPercent >= 90 ? 'bg-red-500' :
                safeStatus.dailyLossPercent >= 70 ? 'bg-yellow-500' :
                'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(safeStatus.dailyLossPercent || 0, 100)}%` }}
            />
          </div>
        </div>

        {/* Drawdown */}
        <div className="bg-slate-700/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Drawdown</div>
          <div className="flex items-end justify-between">
            <div className={`text-lg font-bold ${
              safeStatus.drawdownPercent >= 90 ? 'text-red-400' :
              safeStatus.drawdownPercent >= 70 ? 'text-yellow-400' :
              'text-white'
            }`}>
              {formatNumber(safeStatus.drawdownPercent)}%
            </div>
            <div className="text-xs text-slate-500">
              {formatNumber(safeStatus.drawdownAmount, 0)} / {formatNumber(safeStatus.drawdownLimit, 0)}
            </div>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                safeStatus.drawdownPercent >= 90 ? 'bg-red-500' :
                safeStatus.drawdownPercent >= 70 ? 'bg-yellow-500' :
                'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(safeStatus.drawdownPercent || 0, 100)}%` }}
            />
          </div>
        </div>

        {/* Open Positions */}
        <div className="bg-slate-700/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Open Positions</div>
          <div className="flex items-end justify-between">
            <div className="text-lg font-bold text-white">
              {safeStatus.openPositions} / {safeStatus.maxOpenPositions}
            </div>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                safeStatus.openPositions >= safeStatus.maxOpenPositions ? 'bg-red-500' :
                safeStatus.openPositions >= safeStatus.maxOpenPositions * 0.8 ? 'bg-yellow-500' :
                'bg-blue-500'
              }`}
              style={{ width: `${safeStatus.maxOpenPositions > 0 ? (safeStatus.openPositions / safeStatus.maxOpenPositions) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Available Margin */}
        <div className="bg-slate-700/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Available Margin</div>
          <div className="flex items-end justify-between">
            <div className="text-lg font-bold text-white">
              {formatCurrency(safeStatus.availableMargin)}
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Balance: {formatCurrency(safeStatus.currentBalance)}
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-500 text-center">
        {safeStatus.message}
      </div>
    </div>
  )
}
