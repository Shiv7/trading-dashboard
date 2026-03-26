import { useState, useEffect, useCallback } from 'react'
import { riskApi, strategyWalletsApi } from '../../services/api'
import type {
  StrategyTuningReport, TuningRecommendation, SimulationResult, ConfigChange
} from '../../types'
import ConfirmDialog from './ConfirmDialog'

// ─── Props ──────────────────────────────────────────────────
interface StrategyTuningTabProps {
  dateRange: { from: number | null; to: number | null }
  strategyFilter: string
  strategies: string[]
}

// ─── Helpers ────────────────────────────────────────────────
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

// ─── Pending Config Change ──────────────────────────────────
interface PendingChange {
  id: string
  configKey: string
  configFile: string
  currentValue: string
  proposedValue: string
  exchange: string
  title: string
  selected: boolean
}

// ─── Main Component ─────────────────────────────────────────
export default function StrategyTuningTab({ dateRange, strategyFilter, strategies }: StrategyTuningTabProps) {
  const [report, setReport] = useState<StrategyTuningReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // Strategy selector (local override if parent filter is 'ALL')
  const [selectedStrategy, setSelectedStrategy] = useState<string>(
    strategyFilter && strategyFilter !== 'ALL' ? strategyFilter : (strategies[0] || 'FUKAA')
  )

  // Pending config changes + simulation
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([])
  const [simResult, setSimResult] = useState<SimulationResult | null>(null)
  const [simulating, setSimulating] = useState(false)

  // Config history
  const [configHistory, setConfigHistory] = useState<ConfigChange[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // CB / Wallet controls
  const [addFundsAmounts, setAddFundsAmounts] = useState<Record<string, string>>({})
  const [cbActionLoading, setCbActionLoading] = useState<Record<string, boolean>>({})

  // Confirm dialog
  const [confirm, setConfirm] = useState<{
    title: string; message: string; confirmLabel: string; action: () => Promise<void>
  } | null>(null)

  // ─── Data Fetching ──────────────────────────────────────────
  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await riskApi.getStrategyTuning(
        selectedStrategy,
        dateRange.from ?? undefined,
        dateRange.to ?? undefined,
      )
      setReport(data)
    } catch {
      setError('Failed to load strategy tuning data')
    } finally {
      setLoading(false)
    }
  }, [selectedStrategy, dateRange.from, dateRange.to])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const data = await riskApi.getConfigHistory(50)
      setConfigHistory(data)
    } catch {
      // silent
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    loadReport()
    loadHistory()
  }, [loadReport, loadHistory])

  // Sync parent filter
  useEffect(() => {
    if (strategyFilter && strategyFilter !== 'ALL') {
      setSelectedStrategy(strategyFilter)
    }
  }, [strategyFilter])

  const showAction = (msg: string) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(null), 4000)
  }

  // ─── Pending Changes Management ─────────────────────────────
  const addPendingChange = (rec: TuningRecommendation) => {
    if (pendingChanges.some(p => p.id === rec.id)) return
    setPendingChanges(prev => [...prev, {
      id: rec.id,
      configKey: rec.configKey,
      configFile: rec.configFile,
      currentValue: rec.currentValue,
      proposedValue: rec.recommendedValue,
      exchange: rec.exchange,
      title: rec.title,
      selected: true,
    }])
    setSimResult(null)
  }

  const removePendingChange = (id: string) => {
    setPendingChanges(prev => prev.filter(p => p.id !== id))
    setSimResult(null)
  }

  const togglePendingSelected = (id: string) => {
    setPendingChanges(prev => prev.map(p =>
      p.id === id ? { ...p, selected: !p.selected } : p
    ))
    setSimResult(null)
  }

  const discardAll = () => {
    setPendingChanges([])
    setSimResult(null)
  }

  // ─── Simulation ─────────────────────────────────────────────
  const handleSimulate = async () => {
    const selected = pendingChanges.filter(p => p.selected)
    if (selected.length === 0) return
    setSimulating(true)
    try {
      const changes: Record<string, string> = {}
      selected.forEach(c => { changes[c.configKey] = c.proposedValue })
      const result = await riskApi.simulateConfig({
        strategy: selectedStrategy,
        changes,
        from: dateRange.from ?? undefined,
        to: dateRange.to ?? undefined,
      })
      setSimResult(result)
    } catch {
      showAction('Simulation failed')
    } finally {
      setSimulating(false)
    }
  }

  // ─── Apply Config ───────────────────────────────────────────
  const handleApplySelected = () => {
    const selected = pendingChanges.filter(p => p.selected)
    if (selected.length === 0) return
    const changesList = selected.map(c => `${c.configKey}: ${c.currentValue} -> ${c.proposedValue}`).join('\n')
    setConfirm({
      title: 'Apply Config Changes',
      message: `Apply ${selected.length} config change(s) to ${selectedStrategy}?\n\n${changesList}`,
      confirmLabel: 'Apply',
      action: async () => {
        try {
          const changes: Record<string, string> = {}
          selected.forEach(c => { changes[c.configKey] = c.proposedValue })
          const result = await riskApi.applyConfig({
            service: selected[0].configFile,
            changes,
            reason: `Tuning recommendation for ${selectedStrategy}`,
          })
          if (result.success) {
            showAction(`Config applied. ${result.pendingRestart ? 'Service restart required.' : ''}`)
            setPendingChanges(prev => prev.filter(p => !p.selected))
            setSimResult(null)
            loadHistory()
            loadReport()
          } else {
            showAction(result.message || 'Failed to apply config')
          }
        } catch {
          showAction('Failed to apply config changes')
        }
      },
    })
  }

  // ─── Rollback ───────────────────────────────────────────────
  const handleRollback = (changeId: string) => {
    setConfirm({
      title: 'Rollback Config Change',
      message: `This will revert the config change ${changeId}. Are you sure?`,
      confirmLabel: 'Rollback',
      action: async () => {
        try {
          const result = await riskApi.rollbackConfig(changeId)
          if (result.success) {
            showAction('Config rolled back successfully')
            loadHistory()
            loadReport()
          } else {
            showAction(result.message || 'Rollback failed')
          }
        } catch {
          showAction('Failed to rollback config')
        }
      },
    })
  }

  // ─── CB / Wallet Actions ────────────────────────────────────
  const handleTripCB = (strategy: string) => {
    setConfirm({
      title: `Trip Circuit Breaker: ${strategy}`,
      message: `This will immediately halt all trading for ${strategy}. New signals will be rejected.`,
      confirmLabel: 'Trip CB',
      action: async () => {
        setCbActionLoading(prev => ({ ...prev, [strategy]: true }))
        try {
          await riskApi.tripCircuitBreaker(strategy, 'Manual trip from tuning tab')
          showAction(`Circuit breaker tripped for ${strategy}`)
        } catch {
          showAction('Failed to trip circuit breaker')
        } finally {
          setCbActionLoading(prev => ({ ...prev, [strategy]: false }))
        }
      },
    })
  }

  const handleResetCB = (strategy: string) => {
    setConfirm({
      title: `Reset Circuit Breaker: ${strategy}`,
      message: `This will resume trading for ${strategy}. Make sure the issue is resolved.`,
      confirmLabel: 'Reset CB',
      action: async () => {
        setCbActionLoading(prev => ({ ...prev, [strategy]: true }))
        try {
          await strategyWalletsApi.resetCircuitBreaker(strategy)
          showAction(`Circuit breaker reset for ${strategy}`)
        } catch {
          showAction('Failed to reset circuit breaker')
        } finally {
          setCbActionLoading(prev => ({ ...prev, [strategy]: false }))
        }
      },
    })
  }

  const handleUnlockCumulative = (strategy: string) => {
    setConfirm({
      title: `Unlock Cumulative Lockdown: ${strategy}`,
      message: `This will unlock the cumulative loss lockdown for ${strategy}. Trading will resume.`,
      confirmLabel: 'Unlock',
      action: async () => {
        setCbActionLoading(prev => ({ ...prev, [strategy]: true }))
        try {
          await strategyWalletsApi.unlockCumulativeLockdown(strategy)
          showAction(`Cumulative lockdown unlocked for ${strategy}`)
        } catch {
          showAction('Failed to unlock cumulative lockdown')
        } finally {
          setCbActionLoading(prev => ({ ...prev, [strategy]: false }))
        }
      },
    })
  }

  const handleAddFunds = (strategy: string) => {
    const amount = parseFloat(addFundsAmounts[strategy] || '0')
    if (isNaN(amount) || amount <= 0) {
      showAction('Enter a valid positive amount')
      return
    }
    setConfirm({
      title: `Add Funds: ${strategy}`,
      message: `Add ${fmtINR(amount)} to ${strategy} wallet?`,
      confirmLabel: 'Add Funds',
      action: async () => {
        try {
          const result = await strategyWalletsApi.addFunds(strategy, amount)
          if (result.success) {
            showAction(`Funds added. New balance: ${fmtINR(result.newBalance)}`)
            setAddFundsAmounts(prev => ({ ...prev, [strategy]: '' }))
          } else {
            showAction('Failed to add funds')
          }
        } catch {
          showAction('Failed to add funds')
        }
      },
    })
  }

  // ─── Loading State ──────────────────────────────────────────
  if (loading && !report) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-40 bg-slate-700 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!report && error) {
    return (
      <div className="text-center text-slate-500 py-12">
        <p>Unable to load strategy tuning data</p>
        <p className="text-red-400 text-sm mt-2">{error}</p>
        <button onClick={loadReport} className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors">
          Retry
        </button>
      </div>
    )
  }

  const sl = report?.slAnalysis
  const tgt = report?.targetAnalysis
  const sizing = report?.positionSizing
  const conf = report?.confidenceGate
  const tradeCount = report?.tradeCount ?? 0

  return (
    <div className="space-y-6">
      {/* Confirm Dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={async () => { await confirm.action(); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Action Toast */}
      {actionMsg && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border border-slate-600 text-white px-4 py-3 rounded-lg shadow-xl text-sm animate-fade-in">
          {actionMsg}
        </div>
      )}

      {/* ─── 1. Header with Data Confidence ─────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedStrategy}
            onChange={e => setSelectedStrategy(e.target.value)}
            className="bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:border-blue-500"
          >
            {strategies.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <span className="text-sm text-slate-400">
            Recommendations based on <span className="text-white font-medium">{tradeCount}</span> trades
            {report?.period && <span className="text-slate-500"> ({report.period})</span>}
          </span>

          {tradeCount < 50 ? (
            <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs font-medium rounded border border-yellow-500/40">
              Low sample size -- recommendations may not be reliable
            </span>
          ) : (
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-medium rounded border border-emerald-500/40">
              Sufficient data
            </span>
          )}
        </div>

        <button
          onClick={() => { loadReport(); loadHistory() }}
          disabled={loading}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg border border-slate-600 transition-colors disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* ─── 2. Stop Loss Analysis ──────────────────────────────── */}
      {sl && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Stop Loss Analysis</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Current Config */}
            <div className="bg-slate-700/30 rounded-lg p-4">
              <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Current Config</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">ATR Multiplier</span>
                  <span className="text-white font-medium">{sl.currentAtrMultiplier.toFixed(1)}x</span>
                </div>
              </div>
            </div>

            {/* Observed Performance */}
            <div className="bg-slate-700/30 rounded-lg p-4">
              <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Observed Performance</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg SL Distance</span>
                  <span className="text-white">{pct(sl.avgSlDistance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg ATR at Entry</span>
                  {sl.avgAtrAtEntry > 0 ? (
                    <span className="text-white">{pct(sl.avgAtrAtEntry)}</span>
                  ) : (
                    <span className="text-slate-500 italic text-[10px]">DM (pipeline added, accumulating)</span>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">SL/ATR Ratio</span>
                  {sl.slAtrRatio >= 0 ? (
                    <span className={sl.slAtrRatio < 0.7 ? 'text-yellow-400' : 'text-white'}>
                      {sl.slAtrRatio.toFixed(2)}x{sl.slAtrRatio < 0.7 ? ' — TIGHT' : ''}
                    </span>
                  ) : (
                    <span className="text-slate-500 italic text-[10px]">DM (needs ATR data)</span>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">SL Hit Rate</span>
                  <span className={sl.slHitRate > 50 ? 'text-red-400' : 'text-white'}>{pct(sl.slHitRate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg SL Loss</span>
                  <span className="text-red-400">{fmtINR(sl.avgSlLoss)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">SL hits &lt;5min</span>
                  <span className={sl.slWithin5MinPercent > 50 ? 'text-red-400' : 'text-yellow-400'}>
                    {sl.slWithin5Min} ({pct(sl.slWithin5MinPercent)})
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Exchange Breakdown Table */}
          {sl.exchangeBreakdown.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-slate-300 mb-2">Per-Exchange SL Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-700">
                      <th className="text-left py-2 px-2">Exchange</th>
                      <th className="text-right py-2 px-2">SL Rate</th>
                      <th className="text-right py-2 px-2">Avg SL Loss</th>
                      <th className="text-right py-2 px-2">Trades</th>
                      <th className="text-left py-2 px-2">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sl.exchangeBreakdown.map(ex => (
                      <tr key={ex.exchange} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                        <td className="py-2 px-2 text-white font-medium">{ex.exchange}</td>
                        <td className={`py-2 px-2 text-right ${ex.slRate > 50 ? 'text-red-400' : 'text-slate-300'}`}>{pct(ex.slRate)}</td>
                        <td className="py-2 px-2 text-right text-red-400">{fmtINR(ex.avgSlLoss)}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{ex.tradeCount}</td>
                        <td className="py-2 px-2 text-xs text-slate-400">{ex.recommendation || <span className="text-slate-500 italic text-[10px]">DM</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {sl.recommendations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-3">Recommended Actions</h3>
              <div className="space-y-3">
                {sl.recommendations.map(rec => (
                  <RecommendationCard key={rec.id} rec={rec} onApply={addPendingChange} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 3. Target Analysis ─────────────────────────────────── */}
      {tgt && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Target Analysis</h2>

          {/* Target Level Stats */}
          {tgt.targetLevels.length > 0 && (
            <div className="mb-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-700">
                      <th className="text-left py-2 px-2">Level</th>
                      <th className="text-right py-2 px-2">Hit Rate</th>
                      <th className="text-right py-2 px-2">Avg P&L When Hit</th>
                      <th className="text-right py-2 px-2">Avg Duration</th>
                      <th className="text-right py-2 px-2">Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tgt.targetLevels.map(lv => (
                      <tr key={lv.level} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                        <td className="py-2 px-2 text-white font-medium">{lv.level}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{pct(lv.hitRate)}</td>
                        <td className={`py-2 px-2 text-right ${lv.avgPnlWhenHit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtINR(lv.avgPnlWhenHit)}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-300">{lv.avgDurationMin.toFixed(0)}m</td>
                        <td className="py-2 px-2 text-right text-slate-300">{pct(lv.contribution)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Current Config */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-700/30 rounded-lg p-4">
              <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Target Multipliers</h3>
              <div className="flex gap-3">
                {tgt.currentMultipliers.map((m, i) => (
                  <div key={i} className="text-center">
                    <div className="text-[10px] text-slate-500">T{i + 1}</div>
                    <div className="text-sm font-medium text-white">{m.toFixed(1)}x</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-4">
              <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Exit Allocation</h3>
              <div className="flex gap-3">
                {tgt.currentAllocation.map((a, i) => (
                  <div key={i} className="text-center">
                    <div className="text-[10px] text-slate-500">T{i + 1}</div>
                    <div className="text-sm font-medium text-white">{pct(a)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recommendations */}
          {tgt.recommendations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-3">Recommended Actions</h3>
              <div className="space-y-3">
                {tgt.recommendations.map(rec => (
                  <RecommendationCard key={rec.id} rec={rec} onApply={addPendingChange} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 4. Position Sizing Recommendations ─────────────────── */}
      {sizing && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Position Sizing Recommendations</h2>

          {/* Current Sizing */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-700/30 rounded-lg p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Risk %/trade</div>
              <div className="text-lg font-bold text-white">{pct(sizing.currentRiskPercent)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Avg Capital Employed</div>
              <div className="text-lg font-bold text-white">{fmtINR(sizing.avgCapitalEmployed)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Avg Risk/Trade</div>
              <div className="text-lg font-bold text-white">{fmtINR(sizing.avgRiskPerTrade)}</div>
            </div>
          </div>

          {/* Capital Efficiency Table */}
          {sizing.walletEfficiency.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-slate-300 mb-2">Capital Efficiency</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-700">
                      <th className="text-left py-2 px-2">Strategy</th>
                      <th className="text-right py-2 px-2">Balance</th>
                      <th className="text-right py-2 px-2">Used</th>
                      <th className="text-right py-2 px-2">Idle</th>
                      <th className="text-right py-2 px-2">Idle%</th>
                      <th className="text-right py-2 px-2">Rec. Risk%</th>
                      <th className="text-left py-2 px-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sizing.walletEfficiency.map(w => (
                      <tr key={w.strategy} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                        <td className="py-2 px-2 text-white font-medium">{w.strategy}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{fmtINR(w.currentBalance)}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{fmtINR(w.usedMargin)}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{fmtINR(w.idleCapital)}</td>
                        <td className={`py-2 px-2 text-right ${w.idlePercent > 80 ? 'text-yellow-400' : 'text-slate-300'}`}>
                          {pct(w.idlePercent)}
                        </td>
                        <td className="py-2 px-2 text-right text-blue-400">{pct(w.recommendedRiskPercent)}</td>
                        <td className="py-2 px-2 text-xs text-slate-400">{w.reason || <span className="text-slate-500 italic text-[10px]">DM</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Kelly Criterion */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-700/30 rounded-lg p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Kelly Fraction</div>
              <div className="text-lg font-bold text-white">{pct(sizing.kellyFraction, 2)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">Half-Kelly (Recommended)</div>
              <div className="text-lg font-bold text-blue-400">{pct(sizing.halfKellyPercent, 2)}</div>
            </div>
          </div>

          {/* Recommendations */}
          {sizing.recommendations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-3">Recommended Actions</h3>
              <div className="space-y-3">
                {sizing.recommendations.map(rec => (
                  <RecommendationCard key={rec.id} rec={rec} onApply={addPendingChange} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 5. Confidence Gate Analysis ────────────────────────── */}
      {conf && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Confidence Gate Analysis</h2>

          <div className="flex items-center gap-4 mb-4">
            <div className="bg-slate-700/30 rounded-lg px-4 py-2">
              <span className="text-xs text-slate-500">Current Gate: </span>
              <span className="text-white font-bold">{conf.currentGate}</span>
            </div>
            <div className="bg-blue-500/10 rounded-lg px-4 py-2 border border-blue-500/30">
              <span className="text-xs text-blue-400">Optimal Gate: </span>
              <span className="text-blue-300 font-bold">{conf.optimalGate}</span>
            </div>
          </div>

          {/* Confidence Buckets */}
          {conf.buckets.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-slate-300 mb-2">Confidence Buckets</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-700">
                      <th className="text-left py-2 px-2">Range</th>
                      <th className="text-right py-2 px-2">Trades</th>
                      <th className="text-right py-2 px-2">Win Rate</th>
                      <th className="text-right py-2 px-2">Avg P&L</th>
                      <th className="text-right py-2 px-2">Avg R</th>
                      <th className="text-center py-2 px-2">Profitable?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conf.buckets.map(b => (
                      <tr
                        key={b.range}
                        className={`border-b border-slate-700/50 ${
                          b.profitable
                            ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
                            : 'bg-red-500/5 hover:bg-red-500/10'
                        }`}
                      >
                        <td className="py-2 px-2 text-white font-medium">{b.range}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{b.tradeCount}</td>
                        <td className={`py-2 px-2 text-right ${b.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pct(b.winRate)}
                        </td>
                        <td className={`py-2 px-2 text-right ${b.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtINR(b.avgPnl)}
                        </td>
                        <td className={`py-2 px-2 text-right ${b.avgRMultiple >= 1 ? 'text-emerald-400' : b.avgRMultiple >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {b.avgRMultiple.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {b.profitable ? (
                            <span className="text-emerald-400 text-xs font-bold">YES</span>
                          ) : (
                            <span className="text-red-400 text-xs font-bold">NO</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Visual bar chart representation */}
              <div className="mt-4 space-y-1">
                {conf.buckets.map(b => {
                  const maxTrades = Math.max(...conf.buckets.map(x => x.tradeCount), 1)
                  const widthPct = (b.tradeCount / maxTrades) * 100
                  return (
                    <div key={b.range} className="flex items-center gap-2 text-xs">
                      <span className="w-16 text-slate-400 text-right">{b.range}</span>
                      <div className="flex-1 h-4 bg-slate-700/50 rounded overflow-hidden">
                        <div
                          className={`h-full rounded transition-all ${b.profitable ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <span className="w-8 text-slate-500">{b.tradeCount}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {conf.recommendations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-3">Recommended Actions</h3>
              <div className="space-y-3">
                {conf.recommendations.map(rec => (
                  <RecommendationCard key={rec.id} rec={rec} onApply={addPendingChange} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 6. Config Change Simulation Panel ──────────────────── */}
      {pendingChanges.length > 0 && (
        <div className="card border-2 border-blue-500/30">
          <h2 className="text-lg font-semibold text-white mb-4">
            Pending Config Changes
            <span className="ml-2 px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">
              {pendingChanges.length}
            </span>
          </h2>

          {/* Pending Changes List */}
          <div className="space-y-2 mb-4">
            {pendingChanges.map(pc => (
              <div key={pc.id} className="flex items-center gap-3 bg-slate-700/30 rounded-lg p-3">
                <input
                  type="checkbox"
                  checked={pc.selected}
                  onChange={() => togglePendingSelected(pc.id)}
                  className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium truncate">{pc.title}</div>
                  <div className="text-xs text-slate-400">
                    <span className="text-slate-500">{pc.configKey}:</span>{' '}
                    <span className="text-red-400">{pc.currentValue}</span>
                    <span className="text-slate-500"> -&gt; </span>
                    <span className="text-emerald-400">{pc.proposedValue}</span>
                    {pc.exchange && <span className="ml-2 text-slate-500">({pc.exchange})</span>}
                  </div>
                </div>
                <button
                  onClick={() => removePendingChange(pc.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors text-sm px-2"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mb-4">
            <button
              onClick={handleSimulate}
              disabled={simulating || pendingChanges.filter(p => p.selected).length === 0}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {simulating ? 'Simulating...' : 'Simulate'}
            </button>
            <button
              onClick={handleApplySelected}
              disabled={pendingChanges.filter(p => p.selected).length === 0}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply Selected ({pendingChanges.filter(p => p.selected).length})
            </button>
            <button
              onClick={discardAll}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
            >
              Discard All
            </button>
          </div>

          {/* Simulation Results */}
          {simResult && (
            <div className="bg-slate-700/30 rounded-lg p-4 border border-slate-600">
              <h3 className="text-sm font-medium text-white mb-3">Simulation Results</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-[10px] text-slate-500">Total Trades</div>
                  <div className="text-sm text-white">{simResult.totalTrades}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Affected Trades</div>
                  <div className="text-sm text-white">{simResult.affectedTrades}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Current P&L</div>
                  <div className={`text-sm font-medium ${simResult.currentTotalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtINR(simResult.currentTotalPnl)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Simulated P&L</div>
                  <div className={`text-sm font-medium ${simResult.simulatedTotalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtINR(simResult.simulatedTotalPnl)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 mb-3">
                <div className={`text-lg font-bold ${simResult.netImpact >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  Net Impact: {simResult.netImpact >= 0 ? '+' : ''}{fmtINR(simResult.netImpact)}
                </div>
                <div className="text-sm text-slate-400">
                  Win Rate: {pct(simResult.currentWinRate)} -&gt; {pct(simResult.simulatedWinRate)}
                </div>
              </div>

              {simResult.description && (
                <p className="text-xs text-slate-400 mb-3">{simResult.description}</p>
              )}

              {simResult.details.length > 0 && (
                <div className="space-y-1">
                  {simResult.details.map((d, i) => (
                    <div key={i} className="text-xs text-slate-400">
                      <span className="text-slate-500">{d.configKey}:</span>{' '}
                      {d.currentValue} -&gt; {d.proposedValue}{' '}
                      <span className="text-slate-500">({d.impact})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── 7. Config Change History ───────────────────────────── */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Config Change History</h2>

        {historyLoading ? (
          <div className="h-24 bg-slate-700/30 rounded animate-pulse" />
        ) : configHistory.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-6">No config changes recorded</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-700">
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Config Key</th>
                  <th className="text-left py-2 px-2">Old -&gt; New</th>
                  <th className="text-left py-2 px-2">Reason</th>
                  <th className="text-center py-2 px-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {configHistory.map(ch => (
                  ch.changes.map((diff, di) => (
                    <tr key={`${ch.changeId}-${di}`} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="py-2 px-2 text-slate-400 text-xs whitespace-nowrap">
                        {new Date(ch.appliedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2 px-2 text-white font-mono text-xs">{diff.key}</td>
                      <td className="py-2 px-2 text-xs">
                        <span className="text-red-400">{diff.oldValue}</span>
                        <span className="text-slate-500"> -&gt; </span>
                        <span className="text-emerald-400">{diff.newValue}</span>
                      </td>
                      <td className="py-2 px-2 text-xs text-slate-400">{ch.reason || <span className="text-slate-500 italic text-[10px]">DM</span>}</td>
                      <td className="py-2 px-2 text-center">
                        {ch.rolledBack ? (
                          <span className="text-xs text-slate-500 italic">Rolled back</span>
                        ) : (
                          di === 0 && (
                            <button
                              onClick={() => handleRollback(ch.changeId)}
                              className="px-2 py-1 bg-orange-600/80 hover:bg-orange-600 text-white text-xs rounded transition-colors"
                            >
                              Rollback
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── 8. Circuit Breaker & Wallet Controls ───────────────── */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Circuit Breaker & Wallet Controls</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {strategies.map(strat => (
            <div key={strat} className="bg-slate-700/30 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-white">{strat}</span>
                {cbActionLoading[strat] && (
                  <span className="text-xs text-slate-500 animate-pulse">Processing...</span>
                )}
              </div>

              {/* CB Buttons */}
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => handleResetCB(strat)}
                  disabled={cbActionLoading[strat]}
                  className="flex-1 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-50"
                >
                  Reset CB
                </button>
                <button
                  onClick={() => handleTripCB(strat)}
                  disabled={cbActionLoading[strat]}
                  className="flex-1 px-2 py-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs rounded font-medium transition-colors disabled:opacity-50"
                >
                  Trip CB
                </button>
              </div>

              {/* Unlock Cumulative */}
              <button
                onClick={() => handleUnlockCumulative(strat)}
                disabled={cbActionLoading[strat]}
                className="w-full px-2 py-1.5 bg-orange-600/80 hover:bg-orange-600 text-white text-xs rounded font-medium transition-colors disabled:opacity-50 mb-3"
              >
                Unlock Cumulative Lockdown
              </button>

              {/* Add Funds */}
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Amount"
                  value={addFundsAmounts[strat] || ''}
                  onChange={e => setAddFundsAmounts(prev => ({ ...prev, [strat]: e.target.value }))}
                  className="flex-1 bg-slate-800 border border-slate-600 text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => handleAddFunds(strat)}
                  disabled={cbActionLoading[strat]}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-50"
                >
                  Add Funds
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Recommendation Card Sub-Component ────────────────────────
function RecommendationCard({
  rec,
  onApply,
}: {
  rec: TuningRecommendation
  onApply: (rec: TuningRecommendation) => void
}) {
  return (
    <div className="bg-slate-700/20 border border-slate-700/50 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white mb-1">
            {rec.title}: <span className="text-red-400">{rec.currentValue}</span>
            <span className="text-slate-500"> -&gt; </span>
            <span className="text-emerald-400">{rec.recommendedValue}</span>
          </div>
          {rec.description && (
            <p className="text-xs text-slate-400 mb-1">{rec.description}</p>
          )}
          <p className="text-xs text-blue-400">{rec.estimatedImpact}</p>
        </div>
        <button
          onClick={() => onApply(rec)}
          className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white text-xs rounded font-medium transition-colors whitespace-nowrap"
        >
          Apply to {rec.exchange || 'ALL'}
        </button>
      </div>
    </div>
  )
}
