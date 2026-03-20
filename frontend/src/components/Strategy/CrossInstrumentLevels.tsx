import React from 'react';
import { computeLotSplit } from '../../utils/tradingUtils';

/* ═══════════════════════════════════════════════════════════════
   SHARED CROSS-INSTRUMENT LEVELS GRID + R:R BAR
   Replicates the FUDKII card's exact levels display pattern
   across all strategy cards.
   ═══════════════════════════════════════════════════════════════ */

export interface LevelsPlan {
  sl: number | null;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  t4: number | null;
  rr: number;
  hasPivots: boolean;
}

export interface LevelsSignal {
  optionSL?: number;
  optionT1?: number;
  optionT2?: number;
  optionT3?: number;
  optionT4?: number;
  optionRR?: number;
  futuresSL?: number;
  futuresT1?: number;
  futuresT2?: number;
  futuresT3?: number;
  futuresT4?: number;
  lotAllocation?: string;
  optionLotAllocation?: string;
}

interface CrossInstrumentLevelsProps {
  plan: LevelsPlan;
  signal: LevelsSignal;
  instrumentMode: 'OPTION' | 'FUTURES' | 'NONE';
  sizing: { lots: number };
}

const fmtEq = (v: number | null | undefined) =>
  v != null && v > 0 ? Number(v.toFixed(0)).toLocaleString('en-IN') : 'DM';
const fmtOpt = (v: number) => v > 0 ? '\u20B9' + v.toFixed(2) : 'DM';
const fmtFut = (v: number) => v > 0 ? '\u20B9' + Number(v.toFixed(2)).toLocaleString('en-IN') : 'DM';

const CrossInstrumentLevels: React.FC<CrossInstrumentLevelsProps> = ({
  plan, signal, instrumentMode, sizing,
}) => {
  // Cross-instrumental levels detection
  const hasOptionLevels = (signal.optionSL ?? 0) > 0 && (signal.optionT1 ?? 0) > 0;
  const hasFuturesLevels = (signal.futuresSL ?? 0) > 0 && (signal.futuresT1 ?? 0) > 0;
  const optSL = signal.optionSL ?? 0;
  const optT1 = signal.optionT1 ?? 0;
  const optT2 = signal.optionT2 ?? 0;
  const optT3 = signal.optionT3 ?? 0;
  const optT4 = signal.optionT4 ?? 0;
  const optRR = signal.optionRR ?? plan.rr;

  // Lot allocation
  const lotAlloc = computeLotSplit(signal.optionLotAllocation ?? signal.lotAllocation, sizing.lots);
  const isAllOutT1 = lotAlloc[0] === sizing.lots;

  // Exit label helper
  const exitLabel = (idx: number, lots: number) => {
    if (lots <= 0) return '\u2014';
    if (idx === 0 && isAllOutT1) return `\u2713 ${lots} lot${lots > 1 ? 's' : ''} (100%) \u2190 ALL OUT`;
    if (idx === 0) return `\u2717 All ${sizing.lots} lot${sizing.lots > 1 ? 's' : ''}`;
    if (isAllOutT1 && idx > 0) return '\u2014';
    const pct = sizing.lots > 0 ? Math.round(lots / sizing.lots * 100) : 0;
    if (idx <= 2) return `\u2713 ${lots} lot${lots > 1 ? 's' : ''} (${pct}%)`;
    if (idx === 3) return `Trail (${pct}%)`;
    return `Runner (${pct}%)`;
  };

  // Level data: [label, eqValue, optValue, exitText]
  const levels: [string, number | null, number, string][] = [
    ['SL', plan.sl, instrumentMode === 'OPTION' ? optSL : 0, exitLabel(0, sizing.lots)],
    ['T1', plan.t1, instrumentMode === 'OPTION' ? optT1 : 0, exitLabel(1, lotAlloc[0])],
    ['T2', plan.t2, instrumentMode === 'OPTION' ? optT2 : 0, exitLabel(2, lotAlloc[1])],
    ['T3', plan.t3, instrumentMode === 'OPTION' ? optT3 : 0, exitLabel(3, lotAlloc[2])],
    ['T4', plan.t4, instrumentMode === 'OPTION' ? optT4 : 0, exitLabel(4, lotAlloc[3])],
  ];

  const hasDeriv = hasOptionLevels || hasFuturesLevels;

  return (
    <>
      {/* ── LEVELS GRID ── */}
      <div className="space-y-1">
        {levels.map(([label, eqVal, optVal, exitText], i) => {
          const isSL = i === 0;
          const labelColor = isSL ? 'text-red-400' : 'text-emerald-400';
          const eqColor = isSL ? 'text-red-400' : 'text-green-400';
          const optColor = isSL ? 'text-red-400/80' : 'text-green-400/80';
          const dimmed = isAllOutT1 && i >= 2;
          return (
            <div
              key={label}
              className={`grid ${hasDeriv ? 'grid-cols-[32px_1fr_1fr_1fr]' : 'grid-cols-[32px_1fr_1fr]'} gap-1 items-center ${dimmed ? 'opacity-40' : ''}`}
            >
              <span className={`text-[11px] font-semibold ${labelColor}`}>{label}</span>
              <span className={`font-mono text-[12px] ${eqColor}`}>{fmtEq(eqVal)}</span>
              {hasDeriv && (
                <span className={`font-mono text-[12px] ${optColor}`}>
                  {instrumentMode === 'OPTION' && hasOptionLevels
                    ? fmtOpt(optVal)
                    : hasFuturesLevels
                      ? fmtFut(
                          i === 0 ? (signal.futuresSL ?? 0) :
                          i === 1 ? (signal.futuresT1 ?? 0) :
                          i === 2 ? (signal.futuresT2 ?? 0) :
                          i === 3 ? (signal.futuresT3 ?? 0) :
                          (signal.futuresT4 ?? 0)
                        )
                      : 'DM'}
                </span>
              )}
              <span className="text-[10px] text-slate-500 truncate">{exitText}</span>
            </div>
          );
        })}
      </div>

      {/* ── R:R BAR ── */}
      <div className="mt-3">
        <div className="flex h-[6px] rounded-full overflow-hidden">
          <div className="bg-red-500/80 rounded-l-full" style={{ width: `${100 / (1 + Math.max(optRR, 0))}%` }} />
          <div className="bg-green-500/80 rounded-r-full" style={{ width: `${100 - 100 / (1 + Math.max(optRR, 0))}%` }} />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-slate-500">Risk</span>
          <span className="font-mono text-xs">
            {hasOptionLevels && (
              <span className={`font-bold ${optRR >= 2 ? 'text-green-400' : optRR >= 1.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                R:R {optRR.toFixed(1)} opt
              </span>
            )}
            {hasOptionLevels && plan.rr > 0 && <span className="text-slate-600 mx-1">/</span>}
            {plan.rr > 0 && (
              <span className="text-slate-400">{plan.rr.toFixed(1)} eq</span>
            )}
          </span>
          <span className="flex items-center gap-1 text-[10px]">
            {plan.hasPivots ? (
              <span className="text-blue-400 font-medium">[Pivot]</span>
            ) : (
              <span className="text-slate-500">[ST]</span>
            )}
            <span className="text-slate-500">Reward</span>
          </span>
        </div>
      </div>
    </>
  );
};

export default CrossInstrumentLevels;
