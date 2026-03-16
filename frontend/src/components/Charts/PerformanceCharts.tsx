import { useMemo } from 'react'
import {
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Bar,
  Line,
} from 'recharts'
import type { Trade } from '../../types'

interface PerformanceChartsProps {
  trades: Trade[]
  initialCapital?: number
  activeStrategy?: string
}

interface EquityPoint {
  date: string
  timestamp: number
  equity: number
  pnl: number
  cumPnl: number
  drawdown: number
  drawdownPct: number
  drawdownPctOfCapital: number
  rMultiple: number
  cumR: number
  tradeCount: number
  entryTime: string
  exitTimeStr: string
  durationMinutes: number
  companyName: string
  strategy: string
  [key: string]: string | number // dynamic strategy drawdown keys
}

export default function PerformanceCharts({ trades, initialCapital = 100000, activeStrategy }: PerformanceChartsProps) {
  const { equityCurve, stats } = useMemo(() => {
    // Sort trades by exit time (closed trades only)
    const closedTrades = trades
      .filter(t => t.exitTime && t.status !== 'ACTIVE')
      .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime())

    if (closedTrades.length === 0) {
      return { equityCurve: [], stats: null }
    }

    // Group sub-trades by tradeId (parent trade) so a 4-lot trade counts as 1 decision
    const parentMap: Record<string, typeof closedTrades> = {}
    for (const t of closedTrades) {
      const pid = t.tradeId || `_solo_${closedTrades.indexOf(t)}`
      if (!parentMap[pid]) parentMap[pid] = []
      parentMap[pid].push(t)
    }
    const parentTrades = Object.values(parentMap).map(subs => {
      const first = subs.reduce((a, b) => new Date(a.entryTime).getTime() < new Date(b.entryTime).getTime() ? a : b)
      return {
        pnl: subs.reduce((s, t) => s + t.pnl, 0),
        rMultiple: subs.reduce((s, t) => s + t.rMultiple, 0),
        exitTime: subs.reduce((latest, t) => {
          const ts = new Date(t.exitTime!).getTime()
          return ts > latest ? ts : latest
        }, 0),
        lotCount: subs.length,
        entryTime: first.entryTime,
        durationMinutes: first.durationMinutes || 0,
        companyName: first.companyName || String(first.scripCode),
        strategy: first.strategy || '',
      }
    }).sort((a, b) => a.exitTime - b.exitTime)

    let cumPnl = 0
    let cumR = 0
    let maxEquity = initialCapital
    let maxDrawdown = 0
    let maxDrawdownPct = 0
    let winStreak = 0
    let maxWinStreak = 0
    let loseStreak = 0
    let maxLoseStreak = 0

    // Per-strategy cumulative P&L tracking (for ALL view multi-line drawdown)
    const strategyNames = [...new Set(parentTrades.map(t => t.strategy).filter(Boolean))]
    const strategyCumPnl: Record<string, number> = {}
    const strategyPeak: Record<string, number> = {}
    for (const s of strategyNames) { strategyCumPnl[s] = 0; strategyPeak[s] = 0 }

    const equityCurve: EquityPoint[] = parentTrades.map((trade, idx) => {
      cumPnl += trade.pnl
      cumR += trade.rMultiple
      const equity = initialCapital + cumPnl

      // Track max equity for drawdown
      if (equity > maxEquity) {
        maxEquity = equity
      }

      // Calculate drawdown
      const drawdown = maxEquity - equity
      const drawdownPct = (drawdown / maxEquity) * 100

      // Track max drawdown
      if (drawdownPct > maxDrawdownPct) {
        maxDrawdown = drawdown
        maxDrawdownPct = drawdownPct
      }

      // Track streaks
      if (trade.pnl > 0) {
        winStreak++
        loseStreak = 0
        if (winStreak > maxWinStreak) maxWinStreak = winStreak
      } else {
        loseStreak++
        winStreak = 0
        if (loseStreak > maxLoseStreak) maxLoseStreak = loseStreak
      }

      const drawdownPctOfCapital = (drawdown / initialCapital) * 100

      // Per-strategy drawdown
      const strategyDDs: Record<string, number> = {}
      if (trade.strategy && strategyNames.length > 1) {
        strategyCumPnl[trade.strategy] += trade.pnl
        if (strategyCumPnl[trade.strategy] > strategyPeak[trade.strategy]) {
          strategyPeak[trade.strategy] = strategyCumPnl[trade.strategy]
        }
      }
      for (const s of strategyNames) {
        const sDD = strategyPeak[s] - strategyCumPnl[s]
        strategyDDs[`dd_${s}`] = -sDD // negative for display
      }

      return {
        date: new Date(trade.exitTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        timestamp: trade.exitTime,
        equity,
        pnl: trade.pnl,
        cumPnl,
        drawdown: -drawdown, // Negative for display
        drawdownPct: -drawdownPct,
        drawdownPctOfCapital: -drawdownPctOfCapital,
        rMultiple: trade.rMultiple,
        cumR,
        tradeCount: idx + 1,
        entryTime: trade.entryTime,
        exitTimeStr: new Date(trade.exitTime).toISOString(),
        durationMinutes: trade.durationMinutes,
        companyName: trade.companyName,
        strategy: trade.strategy,
        ...strategyDDs,
      }
    })

    const finalEquity = equityCurve[equityCurve.length - 1]?.equity || initialCapital
    const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100
    const avgR = parentTrades.length > 0 ? cumR / parentTrades.length : 0
    const profitFactor = parentTrades.reduce((sum, t) => sum + (t.pnl > 0 ? t.pnl : 0), 0) /
      Math.abs(parentTrades.reduce((sum, t) => sum + (t.pnl < 0 ? t.pnl : 0), 0)) || 0

    // Avg R for winners vs losers
    const winningParents = parentTrades.filter(t => t.pnl > 0)
    const losingParents = parentTrades.filter(t => t.pnl <= 0)
    const avgWinR = winningParents.length > 0 ? winningParents.reduce((s, t) => s + t.rMultiple, 0) / winningParents.length : 0
    const avgLossR = losingParents.length > 0 ? losingParents.reduce((s, t) => s + t.rMultiple, 0) / losingParents.length : 0
    const expectancyR = parentTrades.length > 0 ? cumR / parentTrades.length : 0

    // Find best win streak and worst lose streak
    let winCurrent: typeof parentTrades = [], bestWinStreak: typeof parentTrades = []
    let loseCurrent: typeof parentTrades = [], worstLoseStreak: typeof parentTrades = []
    for (const pt of parentTrades) {
      if (pt.pnl > 0) {
        winCurrent.push(pt)
        loseCurrent = []
        if (winCurrent.length > bestWinStreak.length) bestWinStreak = [...winCurrent]
      } else {
        loseCurrent.push(pt)
        winCurrent = []
        if (loseCurrent.length > worstLoseStreak.length) worstLoseStreak = [...loseCurrent]
      }
    }

    // Build streak details from parent trade list
    interface StreakDetail {
      entryPrice: number; exitPrice: number; entryTime: string; exitTime: string
      durationMinutes: number; pnl: number; rMultiple: number; companyName: string
      instrumentType: string; lotCount: number; exitReason: string; strategy: string
      t1Hit: boolean; t2Hit: boolean; t3Hit: boolean; t4Hit: boolean
      maxTargetHit: string
      thetaCostEstimate: number; thetaCostPct: number; directionalGain: number
    }
    function buildStreakDetails(streak: typeof parentTrades): StreakDetail[] {
      const details: StreakDetail[] = []
      for (const sp of streak) {
        const matchingSubs = closedTrades.filter(t => {
          const pid = t.tradeId || ''
          const parentSubs = parentMap[pid]
          if (!parentSubs) return false
          const parentExitTime = parentSubs.reduce((latest, pt) => {
            const ts = new Date(pt.exitTime!).getTime()
            return ts > latest ? ts : latest
          }, 0)
          return Math.abs(parentExitTime - sp.exitTime) < 1000
        })
        if (matchingSubs.length > 0) {
          const first = matchingSubs.reduce((a, b) => new Date(a.entryTime).getTime() < new Date(b.entryTime).getTime() ? a : b)
          const lastExit = matchingSubs.reduce((a, b) => new Date(a.exitTime!).getTime() > new Date(b.exitTime!).getTime() ? a : b)
          const avgEntry = matchingSubs.reduce((s, t) => s + t.entryPrice, 0) / matchingSubs.length
          const avgExit = matchingSubs.reduce((s, t) => s + (t.exitPrice ?? 0), 0) / matchingSubs.length
          const totalDur = first.durationMinutes || 0
          const t1Hit = matchingSubs.some(t => (t as any).target1Hit)
          const t2Hit = matchingSubs.some(t => (t as any).target2Hit)
          const t3Hit = matchingSubs.some(t => (t as any).target3Hit)
          const t4Hit = matchingSubs.some(t => (t as any).target4Hit)
          const maxTargetHit = t4Hit ? 'T4' : t3Hit ? 'T3' : t2Hit ? 'T2' : t1Hit ? 'T1' : 'SL'
          const exitReason = (lastExit as any).exitReason || first.exitReason || ''
          const thetaRatePerHr = 0.4
          const holdHours = totalDur / 60
          const thetaCostPct = thetaRatePerHr * holdHours
          const thetaCostEstimate = (thetaCostPct / 100) * avgEntry * (first.quantity || 1)
          const observedPremChgPct = avgEntry !== 0 ? ((avgExit - avgEntry) / avgEntry) * 100 : 0
          const directionalGain = observedPremChgPct + thetaCostPct
          details.push({
            entryPrice: avgEntry, exitPrice: avgExit,
            entryTime: first.entryTime, exitTime: lastExit.exitTime!,
            durationMinutes: totalDur, pnl: sp.pnl, rMultiple: sp.rMultiple,
            companyName: first.companyName || String(first.scripCode),
            instrumentType: (first as any).instrumentType || '',
            lotCount: matchingSubs.length, exitReason,
            strategy: first.strategy || sp.strategy || '',
            t1Hit, t2Hit, t3Hit, t4Hit, maxTargetHit,
            thetaCostEstimate, thetaCostPct, directionalGain,
          })
        }
      }
      return details
    }
    const streakTradeDetails = buildStreakDetails(bestWinStreak)
    const worstStreakDetails = buildStreakDetails(worstLoseStreak)

    return {
      equityCurve,
      stats: {
        totalReturn,
        maxDrawdown,
        maxDrawdownPct,
        avgR,
        profitFactor,
        maxWinStreak,
        maxLoseStreak,
        sharpeEstimate: totalReturn / (maxDrawdownPct || 1),
        avgWinR,
        avgLossR,
        expectancyR,
        streakTradeDetails,
        worstStreakDetails,
        strategyNames,
      }
    }
  }, [trades, initialCapital])

  if (equityCurve.length < 2) {
    return (
      <div className="card">
        <div className="card-header">📊 Performance Analytics</div>
        <div className="flex items-center justify-center h-48 text-slate-500">
          <div className="text-center">
            <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            <p>Need at least 2 closed trades for analytics</p>
          </div>
        </div>
      </div>
    )
  }

  // Streak card renderer (shared between win and loss streaks)
  type StreakDetailType = NonNullable<typeof stats>['streakTradeDetails'][number]
  const renderStreakCards = (details: StreakDetailType[], mode: 'win' | 'loss', fmtCur: (v: number) => string) => {
    const borderColor = mode === 'win' ? 'border-emerald-500/15' : 'border-red-500/15'
    const bgColor = mode === 'win' ? 'bg-emerald-500/5' : 'bg-red-500/5'
    const pnlColor = mode === 'win' ? 'text-emerald-400' : 'text-red-400'

    return (
      <div className="space-y-3">
        {details.map((t, i) => {
          const premChg = t.entryPrice !== 0 ? ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 : 0
          const premChgAbs = t.exitPrice - t.entryPrice
          const erosionPerHr = t.durationMinutes > 0 ? premChg / (t.durationMinutes / 60) : 0
          const fmtTime = (ts: string) => { try { return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) } catch { return '—' } }
          const fmtDate = (ts: string) => { try { return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) } catch { return '' } }

          return (
            <div key={i} className={`${bgColor} border ${borderColor} rounded-lg p-3`}>
              {/* Row 1: Name + Targets + Exit + R + PnL */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white truncate max-w-[200px]">{t.companyName}</span>
                  {t.strategy && <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">{t.strategy}</span>}
                  {t.lotCount > 1 && <span className="text-[9px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">{t.lotCount} lots</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  {['T1', 'T2', 'T3', 'T4'].map(tgt => {
                    const hit = tgt === 'T1' ? t.t1Hit : tgt === 'T2' ? t.t2Hit : tgt === 'T3' ? t.t3Hit : t.t4Hit
                    return (
                      <span key={tgt} className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${
                        hit ? 'bg-emerald-500/25 text-emerald-400' : 'bg-slate-700/50 text-slate-600'
                      }`}>{tgt}</span>
                    )
                  })}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                    t.exitReason.startsWith('T') ? 'bg-emerald-500/20 text-emerald-400'
                    : t.exitReason === 'SL-T2-R' ? 'bg-cyan-500/20 text-cyan-400'
                    : t.exitReason.includes('SL') ? 'bg-red-500/20 text-red-400'
                    : t.exitReason === 'EOD' ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-slate-700 text-slate-400'
                  }`}>{t.exitReason || '—'}</span>
                  <span className={`text-[10px] ${pnlColor} font-bold ml-1`}>{t.rMultiple >= 0 ? '+' : ''}{t.rMultiple.toFixed(2)}R</span>
                  <span className={`text-[10px] ${pnlColor} font-mono`}>{fmtCur(t.pnl)}</span>
                </div>
              </div>

              {/* Row 2: Timestamps */}
              <div className="flex items-center gap-3 mb-2 bg-slate-800/40 rounded px-2 py-1">
                <div className="text-[10px]">
                  <span className="text-slate-500">Entry: </span>
                  <span className="text-white font-mono">{fmtDate(t.entryTime)} {fmtTime(t.entryTime)}</span>
                </div>
                <span className="text-slate-600">→</span>
                <div className="text-[10px]">
                  <span className="text-slate-500">Exit: </span>
                  <span className="text-white font-mono">{fmtDate(t.exitTime)} {fmtTime(t.exitTime)}</span>
                </div>
                <span className={`text-[10px] font-bold ml-auto ${t.durationMinutes <= 15 ? 'text-cyan-400' : t.durationMinutes <= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                  {t.durationMinutes < 60 ? `${t.durationMinutes}min` : `${(t.durationMinutes / 60).toFixed(1)}hr`}
                  {t.durationMinutes <= 15 && ' ⚡'}
                </span>
              </div>

              {/* Row 3: Premium + Theta + Directional */}
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="bg-slate-800/30 rounded p-1.5">
                  <div className="text-slate-500 uppercase text-[8px] mb-0.5">{mode === 'win' ? 'Premium Captured' : 'Premium Lost'}</div>
                  <div className="text-white font-mono">₹{t.entryPrice.toFixed(1)} → ₹{t.exitPrice.toFixed(1)}</div>
                  <div className={`${premChg >= 0 ? 'text-emerald-400' : 'text-red-400'} font-bold`}>{premChg >= 0 ? '+' : ''}{premChg.toFixed(1)}% ({premChgAbs >= 0 ? '+' : ''}₹{premChgAbs.toFixed(1)})</div>
                  {t.durationMinutes > 0 && (
                    <div className="text-slate-400 text-[9px] mt-0.5">
                      {Math.abs(erosionPerHr).toFixed(1)}%/hr &middot; ₹{Math.abs(premChgAbs / (t.durationMinutes / 60)).toFixed(1)}/hr
                    </div>
                  )}
                </div>
                <div className="bg-red-500/5 rounded p-1.5">
                  <div className="text-red-400/60 uppercase text-[8px] mb-0.5">Theta Cost (est.)</div>
                  <div className="text-red-400 font-bold">-{t.thetaCostPct.toFixed(2)}%</div>
                  <div className="text-red-400/70 text-[9px]">~0.4%/hr × {t.durationMinutes > 0 ? (t.durationMinutes / 60).toFixed(1) : '0'}hr</div>
                  {t.durationMinutes <= 15 ? (
                    <div className="text-cyan-400 text-[9px] mt-0.5">{mode === 'loss' ? 'SL hit fast — not theta' : 'Minimal — exited fast'}</div>
                  ) : t.durationMinutes <= 60 ? (
                    <div className="text-amber-400 text-[9px] mt-0.5">{mode === 'loss' ? 'Theta added to loss' : 'Moderate — 1hr window'}</div>
                  ) : (
                    <div className="text-red-400 text-[9px] mt-0.5">{mode === 'loss' ? 'Theta compounded the damage' : 'Significant — long hold'}</div>
                  )}
                </div>
                <div className={`${mode === 'win' ? 'bg-emerald-500/5' : 'bg-red-500/5'} rounded p-1.5`}>
                  <div className={`${pnlColor} opacity-60 uppercase text-[8px] mb-0.5`}>Directional Move</div>
                  <div className={`${pnlColor} font-bold`}>{t.directionalGain >= 0 ? '+' : ''}{t.directionalGain.toFixed(1)}%</div>
                  <div className="text-slate-400 text-[9px]">= {premChg >= 0 ? '+' : ''}{premChg.toFixed(1)}% net + {t.thetaCostPct.toFixed(1)}% theta</div>
                  <div className="text-[9px] mt-0.5">
                    {mode === 'loss' ? (
                      t.durationMinutes <= 5 ? (
                        <span className="text-red-400">Instant SL — wrong direction</span>
                      ) : Math.abs(premChg) > t.thetaCostPct * 3 ? (
                        <span className="text-red-400">Directional loss dominated</span>
                      ) : (
                        <span className="text-amber-400">Theta amplified the loss</span>
                      )
                    ) : (
                      t.directionalGain > premChg * 2 ? (
                        <span className="text-emerald-400">Strong move beat theta</span>
                      ) : t.thetaCostPct < 0.1 ? (
                        <span className="text-cyan-400">Speed trade — theta irrelevant</span>
                      ) : (
                        <span className="text-amber-400">Close call — theta ate gains</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const renderStreakSummary = (details: StreakDetailType[], mode: 'win' | 'loss', fmtCur: (v: number) => string) => {
    const avgDur = details.reduce((s, t) => s + t.durationMinutes, 0) / details.length
    const avgPremChg = details.reduce((s, t) => s + (t.entryPrice !== 0 ? ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 : 0), 0) / details.length
    const totalPnl = details.reduce((s, t) => s + t.pnl, 0)
    const avgThetaCost = details.reduce((s, t) => s + t.thetaCostPct, 0) / details.length
    const avgDirectional = details.reduce((s, t) => s + t.directionalGain, 0) / details.length
    const fastTrades = details.filter(t => t.durationMinutes <= 15).length
    const slTrades = details.filter(t => t.exitReason.includes('SL')).length
    const t2Plus = details.filter(t => t.t2Hit).length
    const pnlColor = mode === 'win' ? 'text-emerald-400' : 'text-red-400'

    return (
      <div className="mt-3 bg-slate-800/60 rounded-lg p-3 text-[10px] text-slate-300 space-y-1.5">
        <div className="font-semibold text-slate-200 text-[11px] mb-1">{mode === 'win' ? 'Win' : 'Lose'} Streak Summary</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div>Total P&L: <span className={`${pnlColor} font-bold`}>{fmtCur(totalPnl)}</span></div>
          <div>Avg hold: <span className="text-white font-bold">{avgDur < 60 ? `${avgDur.toFixed(0)}min` : `${(avgDur / 60).toFixed(1)}hr`}</span></div>
          <div>Avg premium {mode === 'win' ? 'gain' : 'loss'}: <span className={`${pnlColor} font-bold`}>{avgPremChg >= 0 ? '+' : ''}{avgPremChg.toFixed(1)}%</span></div>
          <div>Avg theta cost: <span className="text-red-400 font-bold">-{avgThetaCost.toFixed(2)}%</span></div>
          <div>Avg directional: <span className={`${avgDirectional >= 0 ? 'text-cyan-400' : 'text-red-400'} font-bold`}>{avgDirectional >= 0 ? '+' : ''}{avgDirectional.toFixed(1)}%</span></div>
          {mode === 'win' ? (
            <div>T2+ reached: <span className="text-white font-bold">{t2Plus}/{details.length}</span></div>
          ) : (
            <div>SL exits: <span className="text-red-400 font-bold">{slTrades}/{details.length}</span></div>
          )}
        </div>
        <div className="border-t border-slate-700 pt-1.5 mt-1.5 space-y-1">
          {mode === 'win' ? (
            <>
              {fastTrades > 0 && <div className="text-cyan-400">{fastTrades}/{details.length} exited within 15min — theta negligible, pure directional capture</div>}
              {avgDur > 30 && <div className="text-amber-400">Avg hold {avgDur.toFixed(0)}min — directional (+{avgDirectional.toFixed(1)}%) outpaced theta (-{avgThetaCost.toFixed(1)}%) by {(avgDirectional / (avgThetaCost || 0.01)).toFixed(0)}x</div>}
              {t2Plus > 0 && <div className="text-emerald-400">{t2Plus} trade(s) hit T2+ — holding through theta paid off with momentum</div>}
            </>
          ) : (
            <>
              {fastTrades > 0 && <div className="text-red-400">{fastTrades}/{details.length} hit SL within 15min — theta was irrelevant, pure directional miss</div>}
              {slTrades === details.length && <div className="text-red-400">All {details.length} trades hit SL — signals were wrong-directional during this phase</div>}
              {avgDur > 15 && avgThetaCost > 0.1 && <div className="text-amber-400">Avg hold {avgDur.toFixed(0)}min with -{avgThetaCost.toFixed(1)}% theta — premium decayed while waiting for SL</div>}
              {slTrades < details.length && <div className="text-amber-400">{details.length - slTrades} trade(s) exited via EOD/trailing — held losing positions too long</div>}
            </>
          )}
        </div>
      </div>
    )
  }

  const formatCurrency = (value: number) => {
    if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)}L`
    if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(1)}K`
    return `₹${value.toFixed(0)}`
  }

  return (
    <div className="space-y-6">
      {/* Advanced Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
            <div className="text-xs text-emerald-400 mb-1">Total Return</div>
            <div className={`text-2xl font-bold ${stats.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {stats.totalReturn >= 0 ? '+' : ''}{(stats.totalReturn ?? 0).toFixed(1)}%
            </div>
          </div>
          <div className="card bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20">
            <div className="text-xs text-red-400 mb-1">Max Drawdown</div>
            <div className="text-2xl font-bold text-red-400">
              {formatCurrency(stats.maxDrawdown)}
            </div>
            <div className="text-xs text-slate-500">{((stats.maxDrawdown / initialCapital) * 100).toFixed(1)}% of {formatCurrency(initialCapital)}</div>
          </div>
          <div className="card bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <div className="text-xs text-blue-400 mb-1">Profit Factor</div>
            <div className={`text-2xl font-bold ${stats.profitFactor >= 1.5 ? 'text-emerald-400' : stats.profitFactor >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
              {(stats.profitFactor ?? 0).toFixed(2)}
            </div>
          </div>
          <div className="card bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <div className="text-xs text-purple-400 mb-1">Return/DD Ratio</div>
            <div className={`text-2xl font-bold ${stats.sharpeEstimate >= 2 ? 'text-emerald-400' : stats.sharpeEstimate >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
              {(stats.sharpeEstimate ?? 0).toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Best Win Streak + Worst Lose Streak — full analysis, side by side */}
      {stats && (stats.streakTradeDetails.length > 0 || stats.worstStreakDetails.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {stats.streakTradeDetails.length > 0 && (
            <div className="card border-emerald-500/20">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-semibold text-emerald-400">🔥 Best Win Streak ({stats.maxWinStreak})</div>
                <span className="text-[10px] text-emerald-400 font-mono">{formatCurrency(stats.streakTradeDetails.reduce((s, t) => s + t.pnl, 0))}</span>
              </div>
              <div className="text-[10px] text-slate-500 mb-3">Premium captured, theta impact, and target progression</div>
              {renderStreakCards(stats.streakTradeDetails, 'win', formatCurrency)}
              {renderStreakSummary(stats.streakTradeDetails, 'win', formatCurrency)}
            </div>
          )}
          {stats.worstStreakDetails.length > 0 && (
            <div className="card border-red-500/20">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-semibold text-red-400">❄️ Worst Lose Streak ({stats.maxLoseStreak})</div>
                <span className="text-[10px] text-red-400 font-mono">{formatCurrency(stats.worstStreakDetails.reduce((s, t) => s + t.pnl, 0))}</span>
              </div>
              <div className="text-[10px] text-slate-500 mb-3">What went wrong: SL hits, theta drag, and premium collapse</div>
              {renderStreakCards(stats.worstStreakDetails, 'loss', formatCurrency)}
              {renderStreakSummary(stats.worstStreakDetails, 'loss', formatCurrency)}
            </div>
          )}
        </div>
      )}

      {/* Drawdown Chart — dual axis: % of capital + absolute INR + per-strategy lines */}
      <div className="card">
        <div className="card-header">
          <span>📉 {activeStrategy && activeStrategy !== 'ALL' ? activeStrategy : 'Portfolio'} Drawdown</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-red-400">
              Max: {((stats?.maxDrawdown ?? 0) / initialCapital * 100).toFixed(1)}% of {formatCurrency(initialCapital)}
            </span>
            <span className="text-xs text-amber-400">
              {formatCurrency(stats?.maxDrawdown ?? 0)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-slate-400 mb-1 px-1 flex-wrap">
          <span className="flex items-center gap-1"><div className="w-3 h-1 bg-red-500 rounded" /> % of Capital</span>
          <span className="flex items-center gap-1"><div className="w-3 h-1 bg-amber-500 rounded" /> INR Value</span>
          {stats && stats.strategyNames.length > 1 && stats.strategyNames.map((s, i) => {
            const colors = ['#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#eab308', '#6366f1', '#84cc16', '#e11d48', '#0ea5e9']
            return <span key={s} className="flex items-center gap-1"><div className="w-3 h-0.5 rounded" style={{ backgroundColor: colors[i % colors.length], borderTop: '1px dashed', borderColor: colors[i % colors.length] }} /> {s}</span>
          })}
        </div>
        <ResponsiveContainer width="100%" height={stats && stats.strategyNames.length > 1 ? 220 : 180}>
          <ComposedChart data={equityCurve} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <defs>
              <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis
              yAxisId="pct"
              orientation="left"
              tick={{ fill: '#ef4444', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <YAxis
              yAxisId="inr"
              orientation="right"
              tick={{ fill: '#f59e0b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatCurrency(Math.abs(v))}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              formatter={(value: number, name: string) => {
                if (name === 'drawdownPctOfCapital') return [`${Math.abs(value).toFixed(2)}%`, '% of Capital']
                if (name === 'drawdown') return [formatCurrency(Math.abs(value)), 'Drawdown INR']
                if (name.startsWith('dd_')) return [formatCurrency(Math.abs(value as number)), `${name.slice(3)} DD`]
                return [value, name]
              }}
            />
            <ReferenceLine yAxisId="pct" y={0} stroke="#475569" />
            <Area
              yAxisId="pct"
              type="monotone"
              dataKey="drawdownPctOfCapital"
              stroke="#ef4444"
              strokeWidth={1.5}
              fill="url(#drawdownGradient)"
            />
            {/* Per-strategy drawdown lines (ALL view only) */}
            {stats && stats.strategyNames.length > 1 && stats.strategyNames.map((s, i) => {
              const colors = ['#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#eab308', '#6366f1', '#84cc16', '#e11d48', '#0ea5e9']
              return (
                <Line
                  key={s}
                  yAxisId="inr"
                  type="monotone"
                  dataKey={`dd_${s}`}
                  stroke={colors[i % colors.length]}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                />
              )
            })}
            <Line
              yAxisId="inr"
              type="monotone"
              dataKey="drawdown"
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* R-Multiple Distribution */}
      <div className="card">
        <div className="card-header">
          <span>📊 Trade Distribution (R-Multiples)</span>
          <span className="text-xs text-slate-400">
            Cumulative: {equityCurve[equityCurve.length - 1]?.cumR.toFixed(1)}R &middot; Expectancy: {(stats?.expectancyR ?? 0) >= 0 ? '+' : ''}{(stats?.expectancyR ?? 0).toFixed(2)}R/trade
          </span>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-slate-400 mb-1 px-1">
          <span className="flex items-center gap-1"><div className="w-3 h-0.5 border-t border-dashed border-emerald-500" style={{ width: 12 }} /> Avg Win {(stats?.avgWinR ?? 0).toFixed(2)}R</span>
          <span className="flex items-center gap-1"><div className="w-3 h-0.5 border-t border-dashed border-red-500" style={{ width: 12 }} /> Avg Loss {(stats?.avgLossR ?? 0).toFixed(2)}R</span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={equityCurve} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis
              orientation="right"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(1)}R`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]?.payload as EquityPoint
                if (!d) return null
                const fmtTs = (ts: string) => { try { return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) } catch { return '—' } }
                const dur = d.durationMinutes
                return (
                  <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', fontSize: 11 }}>
                    <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>{d.companyName}</div>
                    <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 3 }}>
                      {fmtTs(d.entryTime)} → {fmtTs(d.exitTimeStr)}
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ color: d.rMultiple >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>{d.rMultiple >= 0 ? '+' : ''}{d.rMultiple.toFixed(2)}R</span>
                      <span style={{ color: d.pnl >= 0 ? '#10b981' : '#ef4444' }}>{formatCurrency(d.pnl)}</span>
                      <span style={{ color: dur <= 15 ? '#22d3ee' : dur <= 60 ? '#f59e0b' : '#ef4444' }}>
                        {dur < 60 ? `${dur}min` : `${(dur / 60).toFixed(1)}hr`}
                      </span>
                    </div>
                  </div>
                )
              }}
            />
            <ReferenceLine y={0} stroke="#475569" />
            {stats && stats.avgWinR > 0 && (
              <ReferenceLine y={stats.avgWinR} stroke="#10b981" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: `Avg Win +${stats.avgWinR.toFixed(1)}R`, position: 'left', fill: '#10b981', fontSize: 9 }} />
            )}
            {stats && stats.avgLossR < 0 && (
              <ReferenceLine y={stats.avgLossR} stroke="#ef4444" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: `Avg Loss ${stats.avgLossR.toFixed(1)}R`, position: 'left', fill: '#ef4444', fontSize: 9 }} />
            )}
            <Bar
              dataKey="rMultiple"
              fill="#3b82f6"
              radius={[2, 2, 0, 0]}
              maxBarSize={20}
              shape={((props: { x: number; y: number; width: number; height: number; payload: EquityPoint }) => {
                const { x, y, width, height, payload } = props
                const isPositive = payload.rMultiple >= 0
                return (
                  <rect
                    x={x}
                    y={isPositive ? y : y - Math.abs(height)}
                    width={width}
                    height={Math.abs(height)}
                    fill={isPositive ? '#10b981' : '#ef4444'}
                    rx={2}
                  />
                )
              }) as any}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

    </div>
  )
}
