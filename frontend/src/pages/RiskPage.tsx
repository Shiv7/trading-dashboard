import { useEffect, useState, useCallback } from 'react'
import { riskApi } from '../services/api'
import { getStrategyColors } from '../utils/strategyColors'
import type { PortfolioRiskSummary, StrategyRiskProfile, DrawdownPoint } from '../types'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

type DrawdownPeriod = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL'

// ─── Helpers ───────────────────────────────────────────────
const fmtINR = (v: number | null | undefined) => {
  if (v == null || isNaN(v)) return '₹0'
  const abs = Math.abs(v)
  if (abs >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`
  if (abs >= 100000) return `₹${(v / 100000).toFixed(2)}L`
  if (abs >= 1000) return `₹${(v / 1000).toFixed(1)}K`
  return `₹${v.toFixed(0)}`
}

const pct = (v: number | null | undefined, decimals = 1) => {
  if (v == null || isNaN(v)) return '0%'
  return `${v.toFixed(decimals)}%`
}

const healthColor = (score: number) => {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-yellow-400'
  if (score >= 40) return 'text-orange-400'
  return 'text-red-400'
}

const healthBg = (score: number) => {
  if (score >= 80) return 'bg-emerald-500'
  if (score >= 60) return 'bg-yellow-500'
  if (score >= 40) return 'bg-orange-500'
  return 'bg-red-500'
}

const severityColor = (s: string) => {
  switch (s) {
    case 'CRITICAL': return 'bg-red-500/20 text-red-400 border-red-500/40'
    case 'HIGH': return 'bg-orange-500/20 text-orange-400 border-orange-500/40'
    case 'MEDIUM': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
    default: return 'bg-blue-500/20 text-blue-400 border-blue-500/40'
  }
}

// ─── RiskBar ───────────────────────────────────────────────
function RiskBar({ label, value, max, unit = '%' }: { label: string; value: number; max?: number; unit?: string }) {
  const pctVal = max ? Math.min((value / max) * 100, 100) : Math.min(value, 100)
  const barColor = pctVal >= 90 ? 'bg-red-500' : pctVal >= 70 ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className={pctVal >= 90 ? 'text-red-400' : pctVal >= 70 ? 'text-yellow-400' : 'text-slate-300'}>
          {value.toFixed(1)}{unit}{max ? ` / ${max.toFixed(0)}${unit}` : ''}
        </span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pctVal}%` }} />
      </div>
    </div>
  )
}

// ─── StrategyCard ──────────────────────────────────────────
function StrategyCard({
  s,
  onTripCB,
  onResetCB,
  onForceClose,
}: {
  s: StrategyRiskProfile
  onTripCB: (key: string) => void
  onResetCB: (key: string) => void
  onForceClose: (key: string) => void
}) {
  const colors = getStrategyColors(s.strategy)
  const dayPnlColor = s.dayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'

  return (
    <div className={`card border ${colors.border} ${s.circuitBreakerTripped ? 'ring-2 ring-red-500/50' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-bold border ${colors.badgeBg} ${colors.badgeText} ${colors.badgeBorder}`}>
            {s.displayName || s.strategy}
          </span>
          <span className={`text-2xl font-bold ${healthColor(s.healthScore)}`}>{s.healthScore}</span>
          <span className="text-xs text-slate-500">/100</span>
        </div>
        {s.circuitBreakerTripped && (
          <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-bold rounded animate-pulse border border-red-500/40">
            CB TRIPPED
          </span>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div>
          <div className="text-[10px] text-slate-500">Balance</div>
          <div className="text-sm font-medium text-white">{fmtINR(s.currentBalance)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Day P&L</div>
          <div className={`text-sm font-medium ${dayPnlColor}`}>{fmtINR(s.dayPnl)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Unrealized</div>
          <div className={`text-sm font-medium ${s.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtINR(s.unrealizedPnl)}
          </div>
        </div>
      </div>

      {/* Risk Bars */}
      <div className="space-y-2 mb-3">
        <RiskBar label="Daily Loss" value={s.dailyLossPercent} />
        <RiskBar label="Drawdown" value={s.drawdownPercent} />
        <RiskBar label="Margin Used" value={s.marginUtilPercent} />
      </div>

      {/* Trade Quality */}
      <div className="grid grid-cols-4 gap-1 text-center mb-3 bg-slate-700/30 rounded-lg p-2">
        <div>
          <div className="text-[9px] text-slate-500">WinRate</div>
          <div className={`text-xs font-medium ${s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
            {pct(s.winRate)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500">Last10</div>
          <div className={`text-xs font-medium ${s.last10WinRate >= 50 ? 'text-emerald-400' : s.winRateDeclining ? 'text-red-400' : 'text-yellow-400'}`}>
            {pct(s.last10WinRate)}{s.winRateDeclining ? ' ↓' : ''}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500">ConsecL</div>
          <div className={`text-xs font-medium ${s.consecutiveLosses >= 3 ? 'text-red-400' : 'text-white'}`}>
            {s.consecutiveLosses}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500">AvgR</div>
          <div className={`text-xs font-medium ${s.avgRMultiple >= 1 ? 'text-emerald-400' : 'text-yellow-400'}`}>
            {s.avgRMultiple.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Positions & Trades */}
      <div className="flex justify-between text-xs text-slate-400 mb-3">
        <span>Positions: <span className="text-white">{s.openPositionCount}</span></span>
        <span>Day Trades: <span className="text-white">{s.dayTradeCount}</span></span>
        <span>Total: <span className="text-white">{s.totalTradeCount}</span></span>
      </div>

      {/* CB Reason */}
      {s.circuitBreakerTripped && s.circuitBreakerReason && (
        <div className="bg-red-700/20 border border-red-700/40 rounded p-2 text-xs text-red-300 mb-3">
          {s.circuitBreakerReason}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 pt-2 border-t border-slate-700/50">
        {s.circuitBreakerTripped ? (
          <button
            onClick={() => onResetCB(s.strategy)}
            className="flex-1 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-medium transition-colors"
          >
            Reset CB
          </button>
        ) : (
          <button
            onClick={() => onTripCB(s.strategy)}
            className="flex-1 px-2 py-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs rounded font-medium transition-colors"
          >
            Trip CB
          </button>
        )}
        <button
          onClick={() => onForceClose(s.strategy)}
          disabled={s.openPositionCount === 0}
          className="flex-1 px-2 py-1.5 bg-orange-600/80 hover:bg-orange-600 text-white text-xs rounded font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Force Close ({s.openPositionCount})
        </button>
      </div>
    </div>
  )
}

// ─── Confirm Dialog ────────────────────────────────────────
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-400 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────
export default function RiskPage() {
  const [portfolio, setPortfolio] = useState<PortfolioRiskSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // Drawdown chart state
  const [ddStrategy, setDdStrategy] = useState<string>('ALL')
  const [ddPeriod, setDdPeriod] = useState<DrawdownPeriod>('TODAY')
  const [ddData, setDdData] = useState<DrawdownPoint[]>([])
  const [ddLoading, setDdLoading] = useState(false)

  // Confirm dialog
  const [confirm, setConfirm] = useState<{
    title: string; message: string; confirmLabel: string; action: () => Promise<void>
  } | null>(null)

  const loadPortfolio = useCallback(async () => {
    try {
      const data = await riskApi.getPortfolioRisk()
      setPortfolio(data)
      setError(null)
    } catch {
      setError('Failed to load risk data')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDrawdown = useCallback(async () => {
    setDdLoading(true)
    try {
      const data = await riskApi.getDrawdownHistory(ddStrategy, ddPeriod)
      setDdData(data)
    } catch {
      setDdData([])
    } finally {
      setDdLoading(false)
    }
  }, [ddStrategy, ddPeriod])

  useEffect(() => {
    loadPortfolio()
    const interval = setInterval(loadPortfolio, 10000)
    return () => clearInterval(interval)
  }, [loadPortfolio])

  useEffect(() => {
    loadDrawdown()
  }, [loadDrawdown])

  const showAction = (msg: string) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(null), 4000)
  }

  const handleTripCB = (strategy: string) => {
    setConfirm({
      title: `Trip Circuit Breaker: ${strategy}`,
      message: `This will immediately halt all trading for ${strategy}. New signals will be rejected and no new positions will be opened.`,
      confirmLabel: 'Trip CB',
      action: async () => {
        try {
          await riskApi.tripCircuitBreaker(strategy, 'Manual trip from dashboard')
          showAction(`Circuit breaker tripped for ${strategy}`)
          await loadPortfolio()
        } catch { showAction('Failed to trip circuit breaker') }
      }
    })
  }

  const handleResetCB = (strategy: string) => {
    setConfirm({
      title: `Reset Circuit Breaker: ${strategy}`,
      message: `This will resume trading for ${strategy}. Make sure the underlying issue has been resolved.`,
      confirmLabel: 'Reset CB',
      action: async () => {
        try {
          await riskApi.resetCircuitBreaker(strategy)
          showAction(`Circuit breaker reset for ${strategy}`)
          await loadPortfolio()
        } catch { showAction('Failed to reset circuit breaker') }
      }
    })
  }

  const handleForceClose = (strategy: string) => {
    setConfirm({
      title: `Force Close All: ${strategy}`,
      message: `This will immediately close ALL open positions for ${strategy} at market price. This action cannot be undone.`,
      confirmLabel: 'Force Close All',
      action: async () => {
        try {
          const result = await riskApi.forceCloseAll(strategy)
          showAction(`Closed ${result.closedCount} positions for ${strategy}`)
          await loadPortfolio()
        } catch { showAction('Failed to force close positions') }
      }
    })
  }

  // ─── Loading State ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-48 bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!portfolio) {
    return (
      <div className="text-center text-slate-500 py-12">
        <p>Unable to load risk data</p>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>
    )
  }

  const strategies = portfolio.strategies || []
  const criticalAlerts = (portfolio.alerts || []).filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH')
  const allAlerts = portfolio.alerts || []

  return (
    <div className="space-y-6">
      {/* Confirm Dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={async () => {
            await confirm.action()
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Action Toast */}
      {actionMsg && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border border-slate-600 text-white px-4 py-3 rounded-lg shadow-xl text-sm animate-fade-in">
          {actionMsg}
        </div>
      )}

      {/* ─── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-white">Risk Command Center</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-500">Live · 10s</span>
          </div>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      {/* ─── Portfolio Health Banner ───────────────────────────── */}
      <div className="card bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-700">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="col-span-2 md:col-span-1">
            <div className="text-xs text-slate-500 mb-1">Health Score</div>
            <div className={`text-4xl font-bold ${healthColor(portfolio.overallHealthScore)}`}>
              {portfolio.overallHealthScore}
            </div>
            <div className={`text-xs font-medium mt-1 px-2 py-0.5 rounded inline-block ${
              portfolio.overallHealthStatus === 'HEALTHY' ? 'bg-emerald-500/20 text-emerald-400' :
              portfolio.overallHealthStatus === 'DEGRADING' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-red-500/20 text-red-400'
            }`}>
              {portfolio.overallHealthStatus}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Total Capital</div>
            <div className="text-lg font-bold text-white">{fmtINR(portfolio.totalBalance)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Day P&L</div>
            <div className={`text-lg font-bold ${portfolio.totalDayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(portfolio.totalDayPnl)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Unrealized</div>
            <div className={`text-lg font-bold ${portfolio.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(portfolio.totalUnrealizedPnl)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Open Positions</div>
            <div className="text-lg font-bold text-white">{portfolio.totalOpenPositions}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Margin Used</div>
            <div className="text-lg font-bold text-white">{fmtINR(portfolio.totalUsedMargin)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">CB Tripped</div>
            <div className={`text-lg font-bold ${portfolio.circuitBreakersTripped > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {portfolio.circuitBreakersTripped} / {strategies.length}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Critical Alerts ───────────────────────────────────── */}
      {criticalAlerts.length > 0 && (
        <div className="space-y-2">
          {criticalAlerts.map((alert, i) => (
            <div key={i} className={`flex items-center justify-between p-3 rounded-lg border ${severityColor(alert.severity)}`}>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${severityColor(alert.severity)}`}>
                  {alert.severity}
                </span>
                <span className="text-sm font-medium">{alert.strategy}</span>
                <span className="text-sm text-slate-300">{alert.message}</span>
              </div>
              <div className="flex gap-2">
                {alert.type === 'CIRCUIT_BREAKER' && (
                  <button
                    onClick={() => handleResetCB(alert.strategy)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-medium transition-colors"
                  >
                    Reset CB
                  </button>
                )}
                {alert.type === 'CONSECUTIVE_LOSSES' && (
                  <button
                    onClick={() => handleTripCB(alert.strategy)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded font-medium transition-colors"
                  >
                    Halt Strategy
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Strategy Risk Cards ───────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Per-Strategy Risk</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {strategies
            .sort((a, b) => a.healthScore - b.healthScore) // worst first
            .map(s => (
              <StrategyCard
                key={s.strategy}
                s={s}
                onTripCB={handleTripCB}
                onResetCB={handleResetCB}
                onForceClose={handleForceClose}
              />
            ))}
        </div>
      </div>

      {/* ─── Drawdown Chart ────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Drawdown Curve</h2>
          <div className="flex gap-2">
            {/* Strategy Selector */}
            <select
              value={ddStrategy}
              onChange={e => setDdStrategy(e.target.value)}
              className="bg-slate-700 text-white text-xs rounded-lg px-3 py-1.5 border border-slate-600 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Strategies</option>
              {strategies.map(s => (
                <option key={s.strategy} value={s.strategy}>{s.displayName || s.strategy}</option>
              ))}
            </select>
            {/* Period Buttons */}
            <div className="flex bg-slate-700 rounded-lg overflow-hidden">
              {(['TODAY', 'WEEK', 'MONTH', 'ALL'] as DrawdownPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setDdPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    ddPeriod === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p === 'TODAY' ? '1D' : p === 'WEEK' ? '1W' : p === 'MONTH' ? '1M' : 'All'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="h-64">
          {ddLoading ? (
            <div className="h-full bg-slate-700/30 rounded animate-pulse" />
          ) : ddData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">
              No drawdown data available for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ddData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="timestamp"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickFormatter={(v: string) => {
                    const d = new Date(v)
                    return ddPeriod === 'TODAY'
                      ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                      : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                  }}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                  domain={['dataMin', 0]}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(value: number) => [`${value.toFixed(2)}%`, 'Drawdown']}
                  labelFormatter={(label: string) => new Date(label).toLocaleString('en-IN')}
                />
                <Area
                  type="monotone"
                  dataKey="drawdownPercent"
                  stroke="#ef4444"
                  fill="url(#ddGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── Strategy Health Comparison ────────────────────────── */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Strategy Health Comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-700">
                <th className="text-left py-2 px-2">Strategy</th>
                <th className="text-center py-2 px-2">Health</th>
                <th className="text-right py-2 px-2">Balance</th>
                <th className="text-right py-2 px-2">Day P&L</th>
                <th className="text-right py-2 px-2">DD%</th>
                <th className="text-right py-2 px-2">DailyLoss%</th>
                <th className="text-right py-2 px-2">WinRate</th>
                <th className="text-right py-2 px-2">Last10</th>
                <th className="text-right py-2 px-2">PF</th>
                <th className="text-right py-2 px-2">Trades</th>
                <th className="text-center py-2 px-2">CB</th>
              </tr>
            </thead>
            <tbody>
              {strategies
                .sort((a, b) => a.healthScore - b.healthScore)
                .map(s => {
                  const c = getStrategyColors(s.strategy)
                  return (
                    <tr key={s.strategy} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="py-2 px-2">
                        <span className={`text-xs font-bold ${c.text}`}>{s.displayName || s.strategy}</span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${healthBg(s.healthScore)}`} />
                          <span className={`font-bold ${healthColor(s.healthScore)}`}>{s.healthScore}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right text-white">{fmtINR(s.currentBalance)}</td>
                      <td className={`py-2 px-2 text-right font-medium ${s.dayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtINR(s.dayPnl)}
                      </td>
                      <td className={`py-2 px-2 text-right ${s.drawdownPercent > 5 ? 'text-red-400' : 'text-slate-300'}`}>
                        {pct(s.drawdownPercent)}
                      </td>
                      <td className={`py-2 px-2 text-right ${s.dailyLossPercent > 70 ? 'text-red-400' : s.dailyLossPercent > 50 ? 'text-yellow-400' : 'text-slate-300'}`}>
                        {pct(s.dailyLossPercent)}
                      </td>
                      <td className={`py-2 px-2 text-right ${s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pct(s.winRate)}
                      </td>
                      <td className={`py-2 px-2 text-right ${s.winRateDeclining ? 'text-red-400' : 'text-slate-300'}`}>
                        {pct(s.last10WinRate)}{s.winRateDeclining ? ' ↓' : ''}
                      </td>
                      <td className={`py-2 px-2 text-right ${s.profitFactor >= 1.5 ? 'text-emerald-400' : s.profitFactor >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {s.profitFactor.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-300">{s.totalTradeCount}</td>
                      <td className="py-2 px-2 text-center">
                        {s.circuitBreakerTripped ? (
                          <span className="text-red-400 text-xs font-bold">TRIPPED</span>
                        ) : (
                          <span className="text-emerald-400 text-xs">OK</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── All Alerts ────────────────────────────────────────── */}
      {allAlerts.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-3">
            All Risk Alerts
            <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">{allAlerts.length}</span>
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {allAlerts.map((alert, i) => (
              <div key={i} className={`p-3 rounded-lg border ${severityColor(alert.severity)}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${severityColor(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <span className="text-xs font-bold text-white">{alert.strategy}</span>
                  <span className="text-xs text-slate-500">{alert.type}</span>
                </div>
                <p className="text-sm text-slate-300">{alert.message}</p>
                {alert.recommendation && (
                  <p className="text-xs text-slate-500 mt-1">→ {alert.recommendation}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Footer ────────────────────────────────────────────── */}
      <div className="text-center text-xs text-slate-600">
        Last updated: {portfolio.lastUpdated ? new Date(portfolio.lastUpdated).toLocaleTimeString('en-IN') : 'Unknown'}
      </div>
    </div>
  )
}
