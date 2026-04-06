/**
 * VerdictBar — The single most important UI element on the stock page.
 * Shows: Overall Score, Direction, Gates (inline), Best Strategy, Data Quality.
 * Designed to answer "Should I trade this?" in 3 seconds.
 */

import type { FamilyScore } from '../../types'
import type { OverallDQ, StrategyDQ } from './dataQualityUtils'
import { DataQualityBadge } from './DataQualityBadge'

const STRATEGY_SHORT: Record<string, string> = {
  FUDKII: 'KII',
  FUKAA: 'KAA',
  FUDKOI: 'KOI',
  MERE: 'MERE',
  MicroAlpha: 'MA',
  Pivot: 'PVT',
  Quant: 'QNT',
  'MCX-BB-15': 'BB15',
  'MCX-BB-30': 'BB30',
  'NSE-BB-30': 'NSE30',
}

interface VerdictBarProps {
  score: FamilyScore
  dq: OverallDQ
  className?: string
}

function getScoreColor(score: number): string {
  if (score >= 7) return 'text-emerald-400'
  if (score >= 5) return 'text-amber-400'
  return 'text-slate-400'
}

function getScoreBg(score: number): string {
  if (score >= 7) return 'from-emerald-500/5 to-emerald-500/0 border-emerald-500/20'
  if (score >= 5) return 'from-amber-500/5 to-amber-500/0 border-amber-500/20'
  return 'from-slate-500/5 to-slate-500/0 border-slate-500/20'
}

function getDirectionColor(dir: string): string {
  if (dir === 'BULLISH') return 'text-emerald-400'
  if (dir === 'BEARISH') return 'text-red-400'
  return 'text-slate-400'
}

function getBestStrategy(strategies: StrategyDQ[]): StrategyDQ | null {
  // Best = highest DQ% among strategies that can fire
  const fireable = strategies.filter(s => s.canFire)
  if (fireable.length === 0) return strategies.reduce((best, s) => s.percentage > best.percentage ? s : best, strategies[0])
  return fireable.reduce((best, s) => s.percentage > best.percentage ? s : best, fireable[0])
}

export function VerdictBar({ score, dq, className = '' }: VerdictBarProps) {
  const gates = [
    { name: 'Hard', passed: score.hardGatePassed, reason: score.hardGateReason },
    { name: 'MTF', passed: score.mtfGatePassed, reason: score.mtfGateReason },
    { name: 'Quality', passed: score.qualityGatePassed, reason: score.qualityGateReason },
    { name: 'Stats', passed: score.statsGatePassed, reason: score.statsGateReason },
  ]

  const failedGate = gates.find(g => !g.passed)
  const bestStrategy = getBestStrategy(dq.strategies)
  const overallScore = score.overallScore ?? 0

  return (
    <div className={`bg-gradient-to-r ${getScoreBg(overallScore)} border rounded-xl p-4 ${className}`}>
      <div className="flex items-center gap-6">
        {/* Score Block */}
        <div className="flex-shrink-0 text-center px-4 py-2 rounded-lg bg-slate-800/50">
          <div className={`text-3xl font-black font-mono leading-none ${getScoreColor(overallScore)}`}>
            {overallScore.toFixed(1)}
          </div>
          <div className={`text-xs font-bold mt-1 ${getDirectionColor(score.direction)}`}>
            {score.direction || 'NEUTRAL'}
          </div>
        </div>

        {/* Score Progress Bar */}
        <div className="flex-shrink-0 w-24">
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                overallScore >= 7 ? 'bg-emerald-500' : overallScore >= 5 ? 'bg-amber-500' : 'bg-slate-500'
              }`}
              style={{ width: `${Math.min(overallScore * 10, 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 text-center">
            {score.signalEmitted ? <span className="text-emerald-400">Signal Emitted</span> : 'No signal'}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-12 bg-slate-700/50" />

        {/* Gates */}
        <div className="flex-shrink-0">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Gates</div>
          <div className="flex items-center gap-1.5">
            {gates.map(gate => (
              <span
                key={gate.name}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  gate.passed
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}
                title={gate.reason || (gate.passed ? 'Passed' : 'Failed')}
              >
                {gate.passed ? '\u2713' : '\u2717'}{gate.name}
              </span>
            ))}
          </div>
          {failedGate && (
            <div className="text-[9px] text-red-400/70 mt-0.5 truncate max-w-[240px]" title={failedGate.reason}>
              {failedGate.reason}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-12 bg-slate-700/50" />

        {/* Best Strategy */}
        {bestStrategy && (
          <div className="flex-shrink-0">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Best Strategy</div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">{bestStrategy.strategy}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                bestStrategy.canFire ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'
              }`}>
                {bestStrategy.fireStatus}
              </span>
            </div>
            {/* Strategy dots */}
            <div className="flex items-center gap-1 mt-1">
              {dq.strategies.map(s => (
                <span
                  key={s.strategy}
                  className={`text-[9px] ${s.canFire ? 'text-emerald-400' : s.percentage > 50 ? 'text-amber-400' : 'text-slate-600'}`}
                  title={`${s.strategy}: DQ ${s.percentage.toFixed(0)}% — ${s.fireStatus}`}
                >
                  {s.canFire ? '\u25CF' : s.percentage > 50 ? '\u25CF' : '\u25CB'}
                  <span className="text-[8px]">{STRATEGY_SHORT[s.strategy] || s.strategy.slice(0, 4)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-grow" />

        {/* Data Quality */}
        <DataQualityBadge
          percentage={dq.percentage}
          liveCount={dq.liveCount}
          fallbackCount={dq.fallbackCount}
          missingCount={dq.missingCount}
          className="flex-shrink-0"
        />
      </div>
    </div>
  )
}

export default VerdictBar
