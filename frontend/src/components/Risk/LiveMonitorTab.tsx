import { useState, useCallback, useEffect } from 'react'
import { riskApi, strategyWalletsApi, walletApi } from '../../services/api'
import { getStrategyColors } from '../../utils/strategyColors'
import type { PortfolioRiskSummary, StrategyRiskProfile, DrawdownPoint } from '../../types'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import ConfirmDialog from './ConfirmDialog'

type DrawdownPeriod = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL'

interface LiveMonitorTabProps {
  portfolio: PortfolioRiskSummary
  onRefresh: () => void
}

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

const fmtPrice = (v: number | null | undefined) => {
  if (v == null || isNaN(v) || v === 0) return '--'
  return v >= 1000 ? v.toFixed(2) : v >= 10 ? v.toFixed(2) : v.toFixed(4)
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

// ─── Computed helpers ──────────────────────────────────────
function computeCapitalAtRisk(portfolio: PortfolioRiskSummary): number {
  if (!portfolio.totalBalance || portfolio.totalBalance === 0) return 0
  return (portfolio.totalUsedMargin / portfolio.totalBalance) * 100
}

function computeExpectancyPerTrade(strategies: StrategyRiskProfile[]): number {
  let totalPnl = 0
  let totalTrades = 0
  for (const s of strategies) {
    totalPnl += s.dayPnl
    totalTrades += s.dayTradeCount
  }
  if (totalTrades === 0) return 0
  return totalPnl / totalTrades
}

function computeStrategyExpectancy(s: StrategyRiskProfile): number | null {
  if (s.totalTradeCount === 0) return null
  // Expectancy = WinRate * AvgWin - LossRate * AvgLoss
  // Approximate from available data: avgRMultiple * winRate/100 - (1 - winRate/100)
  const wr = s.winRate / 100
  return wr * s.avgRMultiple - (1 - wr)
}

function computeSLHitRate(s: StrategyRiskProfile): number | null {
  // SL hit rate approximated as inverse of win rate when data is available
  if (s.totalTradeCount < 5) return null
  return 100 - s.winRate
}

// ─── Exchange grouping from strategy names ─────────────────
interface ExchangeRow {
  exchange: string
  positions: number
  marginUsed: number
  dayPnl: number
  capitalPercent: number
  phase: string
}

function buildExposureMatrix(strategies: StrategyRiskProfile[], totalBalance: number): ExchangeRow[] {
  // Group by exchange heuristic: MCX strategies vs NSE (default)
  const groups: Record<string, { positions: number; margin: number; pnl: number }> = {}

  for (const s of strategies) {
    const key = s.strategy.toUpperCase()
    let exchange = 'NSE'
    if (key.startsWith('MCX')) exchange = 'MCX'
    if (key === 'CDS' || key.includes('CURRENCY')) exchange = 'CDS'

    if (!groups[exchange]) groups[exchange] = { positions: 0, margin: 0, pnl: 0 }
    groups[exchange].positions += s.openPositionCount
    groups[exchange].margin += s.usedMargin
    groups[exchange].pnl += s.dayPnl
  }

  const now = new Date()
  const istHour = (now.getUTCHours() + 5) % 24 + (now.getUTCMinutes() + 30 >= 60 ? 1 : 0)

  return Object.entries(groups).map(([exchange, data]) => {
    let phase = 'Active'
    if (exchange === 'NSE' && istHour >= 16) phase = 'Closed'
    if (exchange === 'MCX' && istHour >= 0 && istHour < 9) phase = 'Closed'

    return {
      exchange,
      positions: data.positions,
      marginUsed: data.margin,
      dayPnl: data.pnl,
      capitalPercent: totalBalance > 0 ? (data.margin / totalBalance) * 100 : 0,
      phase,
    }
  }).sort((a, b) => b.marginUsed - a.marginUsed)
}

// ─── StrategyCard ──────────────────────────────────────────
function StrategyCard({
  s,
  onTripCB,
  onResetCB,
  onForceClose,
  onAddFunds,
  onUnlockCumulative,
  onPositionDrilldown,
}: {
  s: StrategyRiskProfile
  onTripCB: (key: string) => void
  onResetCB: (key: string) => void
  onForceClose: (key: string) => void
  onAddFunds: (key: string) => void
  onUnlockCumulative: (key: string) => void
  onPositionDrilldown: (key: string) => void
}) {
  const colors = getStrategyColors(s.strategy)
  const dayPnlColor = s.dayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
  const expectancy = computeStrategyExpectancy(s)
  const slHitRate = computeSLHitRate(s)

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
      <div className="grid grid-cols-4 gap-1 text-center mb-2 bg-slate-700/30 rounded-lg p-2">
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

      {/* SL Hit Rate & Expectancy */}
      <div className="grid grid-cols-2 gap-1 text-center mb-3 bg-slate-700/30 rounded-lg p-2">
        <div>
          <div className="text-[9px] text-slate-500">SL Hit Rate</div>
          <div className={`text-xs font-medium ${slHitRate != null ? (slHitRate > 60 ? 'text-red-400' : slHitRate > 40 ? 'text-yellow-400' : 'text-emerald-400') : ''}`}>
            {slHitRate != null ? pct(slHitRate) : <span className="text-slate-500 italic text-[10px]">DM</span>}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500">Expectancy</div>
          <div className={`text-xs font-medium ${expectancy != null ? (expectancy >= 0 ? 'text-emerald-400' : 'text-red-400') : ''}`}>
            {expectancy != null ? `${expectancy.toFixed(2)}R` : <span className="text-slate-500 italic text-[10px]">DM</span>}
          </div>
        </div>
      </div>

      {/* Positions & Trades */}
      <div className="flex justify-between text-xs text-slate-400 mb-3">
        <button onClick={() => onPositionDrilldown(s.strategy)} className="hover:text-blue-400 transition-colors cursor-pointer">
          Positions: <span className="text-white underline">{s.openPositionCount}</span>
        </button>
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

      {/* Secondary Controls */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => onAddFunds(s.strategy)}
          className="flex-1 px-2 py-1.5 bg-blue-600/70 hover:bg-blue-600 text-white text-xs rounded font-medium transition-colors"
        >
          Add Funds
        </button>
        <button
          onClick={() => onUnlockCumulative(s.strategy)}
          className="flex-1 px-2 py-1.5 bg-violet-600/70 hover:bg-violet-600 text-white text-xs rounded font-medium transition-colors"
        >
          Unlock Lockdown
        </button>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────
export default function LiveMonitorTab({
  portfolio,
  onRefresh,
}: LiveMonitorTabProps) {
  const strategies = portfolio.strategies || []

  // Drawdown chart state
  const [ddStrategy, setDdStrategy] = useState<string>('ALL')
  const [ddPeriod, setDdPeriod] = useState<DrawdownPeriod>('TODAY')
  const [ddData, setDdData] = useState<DrawdownPoint[]>([])
  const [ddLoading, setDdLoading] = useState(false)

  // Position drilldown state
  const [drilldownStrategy, setDrilldownStrategy] = useState<string | null>(null)
  const [drilldownPositions, setDrilldownPositions] = useState<any[]>([])
  const [drilldownLoading, setDrilldownLoading] = useState(false)

  // Stress test state
  const [stressPercent, setStressPercent] = useState<number>(-3)
  const [stressResults, setStressResults] = useState<{
    strategy: string
    currentPnl: number
    stressedPnl: number
    impact: number
    positions: number
  }[] | null>(null)
  const [stressLoading, setStressLoading] = useState(false)

  // Confirm dialog
  const [confirm, setConfirm] = useState<{
    title: string; message: string; confirmLabel: string; action: () => Promise<void>
  } | null>(null)

  // Action toast
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const showAction = (msg: string) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(null), 4000)
  }

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
    loadDrawdown()
  }, [loadDrawdown])

  // ─── Action Handlers ──────────────────────────────────────
  const handleTripCB = (strategy: string) => {
    setConfirm({
      title: `Trip Circuit Breaker: ${strategy}`,
      message: `This will immediately halt all trading for ${strategy}. New signals will be rejected and no new positions will be opened.`,
      confirmLabel: 'Trip CB',
      action: async () => {
        try {
          await riskApi.tripCircuitBreaker(strategy, 'Manual trip from dashboard')
          showAction(`Circuit breaker tripped for ${strategy}`)
          onRefresh()
        } catch { showAction('Failed to trip circuit breaker') }
      },
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
          onRefresh()
        } catch { showAction('Failed to reset circuit breaker') }
      },
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
          showAction(`Closed ${result.closed} positions for ${strategy}`)
          onRefresh()
        } catch { showAction('Failed to force close positions') }
      },
    })
  }

  const handleKillAll = () => {
    setConfirm({
      title: 'KILL ALL: Emergency Stop',
      message: 'This will trip ALL circuit breakers and force-close ALL open positions across every strategy. This is an emergency action and cannot be undone.',
      confirmLabel: 'KILL ALL',
      action: async () => {
        try {
          for (const s of strategies) {
            if (!s.circuitBreakerTripped) {
              await riskApi.tripCircuitBreaker(s.strategy, 'KILL ALL from dashboard')
            }
            if (s.openPositionCount > 0) {
              await riskApi.forceCloseAll(s.strategy)
            }
          }
          showAction('All strategies halted and positions closed')
          onRefresh()
        } catch { showAction('KILL ALL partially failed — check individual strategies') }
      },
    })
  }

  const handleAddFunds = (strategy: string) => {
    setConfirm({
      title: `Add Funds: ${strategy}`,
      message: `This will add 1,00,000 (1 Lakh) to the ${strategy} wallet balance. Use this when the wallet has insufficient margin to trade.`,
      confirmLabel: 'Add 1L',
      action: async () => {
        try {
          const result = await strategyWalletsApi.addFunds(strategy, 100000)
          showAction(`Added 1L to ${strategy} — new balance: ${result.newBalance}`)
          onRefresh()
        } catch { showAction('Failed to add funds') }
      },
    })
  }

  const handleUnlockCumulative = (strategy: string) => {
    setConfirm({
      title: `Unlock Cumulative Lockdown: ${strategy}`,
      message: `This will clear the cumulative loss lockdown for ${strategy}, allowing it to resume trading even if cumulative losses exceeded the threshold.`,
      confirmLabel: 'Unlock',
      action: async () => {
        try {
          await riskApi.resetCircuitBreaker(strategy)
          showAction(`Cumulative lockdown cleared for ${strategy}`)
          onRefresh()
        } catch { showAction('Failed to unlock cumulative lockdown') }
      },
    })
  }

  // ─── Position Drilldown Handler ──────────────────────────
  const handlePositionDrilldown = async (strategy: string) => {
    setDrilldownStrategy(strategy)
    setDrilldownLoading(true)
    try {
      const wallet = await walletApi.getWallet()
      const positions = (wallet.positions || []).filter(
        (p: any) => p.strategy === strategy && p.status === 'ACTIVE' && p.quantity > 0
      )
      setDrilldownPositions(positions)
    } catch {
      setDrilldownPositions([])
    } finally {
      setDrilldownLoading(false)
    }
  }

  // ─── Stress Test Handler ────────────────────────────────
  const runStressTest = async () => {
    setStressLoading(true)
    try {
      const wallet = await walletApi.getWallet()
      const openPositions = (wallet.positions || []).filter(
        (p: any) => p.status === 'ACTIVE' && p.quantity > 0
      )

      // Group by strategy
      const byStrategy: Record<string, any[]> = {}
      for (const p of openPositions) {
        const strat = p.strategy || 'UNKNOWN'
        if (!byStrategy[strat]) byStrategy[strat] = []
        byStrategy[strat].push(p)
      }

      const results = Object.entries(byStrategy).map(([strategy, positions]) => {
        let currentPnl = 0
        let stressedPnl = 0

        for (const p of positions) {
          const entry = p.avgEntryPrice || 0
          const current = p.currentPrice || entry
          const qty = p.quantity || 0
          const isLong = p.side === 'LONG'

          // Current P&L
          currentPnl += isLong ? (current - entry) * qty : (entry - current) * qty

          // Stressed price: move underlying by stressPercent
          const stressedPrice = current * (1 + stressPercent / 100)
          stressedPnl += isLong ? (stressedPrice - entry) * qty : (entry - stressedPrice) * qty
        }

        return {
          strategy,
          currentPnl: Math.round(currentPnl * 100) / 100,
          stressedPnl: Math.round(stressedPnl * 100) / 100,
          impact: Math.round((stressedPnl - currentPnl) * 100) / 100,
          positions: positions.length,
        }
      })

      setStressResults(results)
    } catch {
      setStressResults([])
    } finally {
      setStressLoading(false)
    }
  }

  const criticalAlerts = (portfolio.alerts || []).filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH')
  const allAlerts = portfolio.alerts || []
  const capitalAtRisk = computeCapitalAtRisk(portfolio)
  const expectancyPerTrade = computeExpectancyPerTrade(strategies)
  const exposureMatrix = buildExposureMatrix(strategies, portfolio.totalBalance)

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

      {/* Position Drilldown Modal */}
      {drilldownStrategy && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-4xl w-full max-h-[80vh] shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">
                {drilldownStrategy} — Open Positions ({drilldownPositions.length})
              </h3>
              <button onClick={() => setDrilldownStrategy(null)} className="text-slate-400 hover:text-white text-xl">&times;</button>
            </div>

            {drilldownLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : drilldownPositions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                No open positions for {drilldownStrategy}
              </div>
            ) : (
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-800">
                    <tr className="text-slate-500 border-b border-slate-700">
                      <th className="text-left py-2 px-2">Instrument</th>
                      <th className="text-center py-2 px-2">Side</th>
                      <th className="text-right py-2 px-2">Qty</th>
                      <th className="text-right py-2 px-2">Entry</th>
                      <th className="text-right py-2 px-2">Current</th>
                      <th className="text-right py-2 px-2">P&L</th>
                      <th className="text-right py-2 px-2">P&L %</th>
                      <th className="text-right py-2 px-2">SL</th>
                      <th className="text-right py-2 px-2">T1</th>
                      <th className="text-right py-2 px-2">T2</th>
                      <th className="text-right py-2 px-2">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownPositions.map((p, i) => {
                      const pnlPct = p.avgEntryPrice > 0 ? ((p.currentPrice - p.avgEntryPrice) / p.avgEntryPrice * 100 * (p.side === 'SHORT' ? -1 : 1)) : 0
                      const openedDate = p.openedAt ? new Date(p.openedAt) : null
                      const durationMin = openedDate ? Math.round((Date.now() - openedDate.getTime()) / 60000) : 0
                      const durationStr = durationMin < 60 ? `${durationMin}m` : `${Math.floor(durationMin/60)}h ${durationMin%60}m`
                      return (
                        <tr key={p.positionId || i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="py-1.5 px-2 text-white font-medium">{p.companyName || p.scripCode}</td>
                          <td className="py-1.5 px-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                              {p.side}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-right text-slate-300">{p.quantity}</td>
                          <td className="py-1.5 px-2 text-right text-slate-300">{fmtPrice(p.avgEntryPrice)}</td>
                          <td className="py-1.5 px-2 text-right text-white font-medium">{fmtPrice(p.currentPrice)}</td>
                          <td className={`py-1.5 px-2 text-right font-medium ${p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {fmtINR(p.unrealizedPnl)}
                          </td>
                          <td className={`py-1.5 px-2 text-right ${pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pnlPct.toFixed(1)}%
                          </td>
                          <td className="py-1.5 px-2 text-right text-red-400">{fmtPrice(p.stopLoss)}</td>
                          <td className="py-1.5 px-2 text-right text-emerald-400">{fmtPrice(p.target1)}</td>
                          <td className="py-1.5 px-2 text-right text-emerald-400">{fmtPrice(p.target2)}</td>
                          <td className="py-1.5 px-2 text-right text-slate-400">{durationStr}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {/* Summary row */}
                <div className="mt-3 p-2 bg-slate-700/30 rounded-lg flex items-center gap-6 text-xs">
                  <span className="text-slate-500">Total P&L:</span>
                  <span className={`font-bold ${drilldownPositions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtINR(drilldownPositions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0))}
                  </span>
                  <span className="text-slate-500">Avg Duration:</span>
                  <span className="text-white">
                    {(() => {
                      const avgMin = drilldownPositions.reduce((s, p) => {
                        const opened = p.openedAt ? new Date(p.openedAt).getTime() : Date.now()
                        return s + (Date.now() - opened) / 60000
                      }, 0) / drilldownPositions.length
                      return avgMin < 60 ? `${Math.round(avgMin)}m` : `${Math.floor(avgMin/60)}h ${Math.round(avgMin%60)}m`
                    })()}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Toast */}
      {actionMsg && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border border-slate-600 text-white px-4 py-3 rounded-lg shadow-xl text-sm animate-fade-in">
          {actionMsg}
        </div>
      )}

      {/* ─── Portfolio Command Bar ───────────────────────────────── */}
      <div className="card bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-700">
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-4 items-end">
          {/* Health Score */}
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

          {/* Total Capital */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Total Capital</div>
            <div className="text-lg font-bold text-white">{fmtINR(portfolio.totalBalance)}</div>
          </div>

          {/* Day P&L */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Day P&L</div>
            <div className={`text-lg font-bold ${portfolio.totalDayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(portfolio.totalDayPnl)}
            </div>
          </div>

          {/* Unrealized */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Unrealized</div>
            <div className={`text-lg font-bold ${portfolio.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(portfolio.totalUnrealizedPnl)}
            </div>
          </div>

          {/* Open Positions */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Open Positions</div>
            <div className="text-lg font-bold text-white">{portfolio.totalOpenPositions}</div>
          </div>

          {/* Margin Used */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Margin Used</div>
            <div className="text-lg font-bold text-white">{fmtINR(portfolio.totalUsedMargin)}</div>
          </div>

          {/* CB Tripped */}
          <div>
            <div className="text-xs text-slate-500 mb-1">CB Tripped</div>
            <div className={`text-lg font-bold ${portfolio.circuitBreakersTripped > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {portfolio.circuitBreakersTripped} / {strategies.length}
            </div>
          </div>

          {/* Capital@Risk% */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Capital@Risk</div>
            <div className={`text-lg font-bold ${capitalAtRisk > 80 ? 'text-red-400' : capitalAtRisk > 50 ? 'text-yellow-400' : 'text-emerald-400'}`}>
              {pct(capitalAtRisk)}
            </div>
          </div>

          {/* Expectancy/Trade */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Expect/Trade</div>
            <div className={`text-lg font-bold ${expectancyPerTrade >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(expectancyPerTrade)}
            </div>
          </div>

          {/* KILL ALL */}
          <div>
            <button
              onClick={handleKillAll}
              className="w-full px-3 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-bold rounded-lg border border-red-500 transition-colors uppercase tracking-wider"
            >
              Kill All
            </button>
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
            .sort((a, b) => a.healthScore - b.healthScore)
            .map(s => (
              <StrategyCard
                key={s.strategy}
                s={s}
                onTripCB={handleTripCB}
                onResetCB={handleResetCB}
                onForceClose={handleForceClose}
                onAddFunds={handleAddFunds}
                onUnlockCumulative={handleUnlockCumulative}
                onPositionDrilldown={handlePositionDrilldown}
              />
            ))}
        </div>
      </div>

      {/* ─── Exposure Matrix ─────────────────────────────────────── */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Exposure Matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-700">
                <th className="text-left py-2 px-3">Exchange</th>
                <th className="text-center py-2 px-3">Positions</th>
                <th className="text-right py-2 px-3">Margin Used</th>
                <th className="text-right py-2 px-3">Day P&L</th>
                <th className="text-right py-2 px-3">% Capital</th>
                <th className="text-center py-2 px-3">Phase</th>
              </tr>
            </thead>
            <tbody>
              {exposureMatrix.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500 text-sm">
                    No exposure data available
                  </td>
                </tr>
              ) : (
                exposureMatrix.map(row => (
                  <tr key={row.exchange} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                    <td className="py-2 px-3">
                      <span className="text-sm font-bold text-white">{row.exchange}</span>
                    </td>
                    <td className="py-2 px-3 text-center text-white">{row.positions}</td>
                    <td className="py-2 px-3 text-right text-white">{fmtINR(row.marginUsed)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${row.dayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtINR(row.dayPnl)}
                    </td>
                    <td className={`py-2 px-3 text-right ${row.capitalPercent > 50 ? 'text-yellow-400' : 'text-slate-300'}`}>
                      {pct(row.capitalPercent)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        row.phase === 'Active'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                      }`}>
                        {row.phase}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {exposureMatrix.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-600 text-xs text-slate-400">
                  <td className="py-2 px-3 font-bold text-slate-300">Total</td>
                  <td className="py-2 px-3 text-center text-slate-300">
                    {exposureMatrix.reduce((sum, r) => sum + r.positions, 0)}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-300">
                    {fmtINR(exposureMatrix.reduce((sum, r) => sum + r.marginUsed, 0))}
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${
                    exposureMatrix.reduce((sum, r) => sum + r.dayPnl, 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {fmtINR(exposureMatrix.reduce((sum, r) => sum + r.dayPnl, 0))}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-300">
                    {pct(exposureMatrix.reduce((sum, r) => sum + r.capitalPercent, 0))}
                  </td>
                  <td className="py-2 px-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ─── Stress Test Calculator ──────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Stress Test</h2>
            <p className="text-xs text-slate-500 mt-0.5">What if the market moves against you?</p>
          </div>
          <div className="flex items-center gap-2">
            {[-5, -3, -2, -1, 1, 2, 3, 5].map(pct => (
              <button
                key={pct}
                onClick={() => setStressPercent(pct)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  stressPercent === pct
                    ? pct < 0 ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {pct > 0 ? '+' : ''}{pct}%
              </button>
            ))}
            <div className="flex items-center gap-1 ml-2">
              <input
                type="number"
                value={stressPercent}
                onChange={e => setStressPercent(Number(e.target.value))}
                className="w-16 bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600 text-center"
                step={0.5}
              />
              <span className="text-xs text-slate-500">%</span>
            </div>
            <button
              onClick={runStressTest}
              disabled={stressLoading}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-50"
            >
              {stressLoading ? 'Running...' : 'Run Stress Test'}
            </button>
          </div>
        </div>

        {stressResults && stressResults.length > 0 && (
          <div>
            <table className="w-full text-sm mb-3">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-700">
                  <th className="text-left py-2 px-2">Strategy</th>
                  <th className="text-right py-2 px-2">Positions</th>
                  <th className="text-right py-2 px-2">Current P&L</th>
                  <th className="text-right py-2 px-2">Stressed P&L ({stressPercent > 0 ? '+' : ''}{stressPercent}%)</th>
                  <th className="text-right py-2 px-2">Impact</th>
                </tr>
              </thead>
              <tbody>
                {stressResults.map(r => (
                  <tr key={r.strategy} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                    <td className="py-2 px-2 text-white font-medium">{r.strategy}</td>
                    <td className="py-2 px-2 text-right text-slate-300">{r.positions}</td>
                    <td className={`py-2 px-2 text-right ${r.currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtINR(r.currentPnl)}
                    </td>
                    <td className={`py-2 px-2 text-right font-medium ${r.stressedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtINR(r.stressedPnl)}
                    </td>
                    <td className={`py-2 px-2 text-right font-bold ${r.impact >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.impact >= 0 ? '+' : ''}{fmtINR(r.impact)}
                    </td>
                  </tr>
                ))}
                {/* Total row */}
                <tr className="border-t-2 border-slate-600 bg-slate-700/20">
                  <td className="py-2 px-2 text-white font-bold">TOTAL</td>
                  <td className="py-2 px-2 text-right text-white font-medium">
                    {stressResults.reduce((s, r) => s + r.positions, 0)}
                  </td>
                  <td className={`py-2 px-2 text-right font-medium ${stressResults.reduce((s, r) => s + r.currentPnl, 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtINR(stressResults.reduce((s, r) => s + r.currentPnl, 0))}
                  </td>
                  <td className={`py-2 px-2 text-right font-bold ${stressResults.reduce((s, r) => s + r.stressedPnl, 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtINR(stressResults.reduce((s, r) => s + r.stressedPnl, 0))}
                  </td>
                  <td className={`py-2 px-2 text-right font-bold text-lg ${stressResults.reduce((s, r) => s + r.impact, 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stressResults.reduce((s, r) => s + r.impact, 0) >= 0 ? '+' : ''}{fmtINR(stressResults.reduce((s, r) => s + r.impact, 0))}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Risk context */}
            {(() => {
              const totalImpact = stressResults.reduce((s, r) => s + r.impact, 0)
              const totalBalance = portfolio.totalBalance || 1
              const impactPct = (totalImpact / totalBalance) * 100
              return (
                <div className={`p-3 rounded-lg border text-xs ${
                  Math.abs(impactPct) > 5 ? 'bg-red-500/10 border-red-500/30 text-red-300' :
                  Math.abs(impactPct) > 2 ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300' :
                  'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                }`}>
                  <span className="font-medium">IMPACT: </span>
                  A {Math.abs(stressPercent)}% market {stressPercent < 0 ? 'drop' : 'rally'} would {totalImpact < 0 ? 'cost' : 'gain'} {fmtINR(Math.abs(totalImpact))} ({Math.abs(impactPct).toFixed(2)}% of total capital).
                  {Math.abs(impactPct) > 5 && ' Consider reducing position sizes or hedging.'}
                  {Math.abs(impactPct) > 10 && ' CRITICAL: This exceeds daily loss limits. Trip circuit breakers if market moves this far.'}
                </div>
              )
            })()}
          </div>
        )}

        {stressResults && stressResults.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-4">
            No open positions to stress test
          </div>
        )}
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
                  <linearGradient id="ddGradientLive" x1="0" y1="0" x2="0" y2="1">
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
                  fill="url(#ddGradientLive)"
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
                  <p className="text-xs text-slate-500 mt-1">{'\u2192'} {alert.recommendation}</p>
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
