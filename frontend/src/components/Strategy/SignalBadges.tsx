import React from 'react';

/* ═══════════════════════════════════════════════════════════════
   LIQUIDITY SOURCE BADGE
   Shows PROXY (amber) or ON_DEMAND (blue) when option liquidity
   was sourced via fallback instead of direct subscription.
   ═══════════════════════════════════════════════════════════════ */
export const LiquiditySourceBadge: React.FC<{ source?: string }> = ({ source }) => {
  if (!source || source === 'DIRECT' || source === 'DISABLED') return null;

  if (source === 'PROXY') {
    return (
      <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase tracking-wide">
        PROXY
      </span>
    );
  }
  if (source === 'ON_DEMAND') {
    return (
      <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wide">
        ON_DEMAND
      </span>
    );
  }
  return null;
};

/* ═══════════════════════════════════════════════════════════════
   RETEST BADGE
   Shows direction-aligned (green) or opposing (red) retest state.
   Includes boost value when non-zero.
   ═══════════════════════════════════════════════════════════════ */
export const RetestBadge: React.FC<{
  active?: boolean;
  aligned?: boolean;
  boost?: number;
  source?: string;
  level?: number;
  stage?: string;
}> = ({ active, aligned, boost, source, level, stage }) => {
  if (!active) return null;

  const color = aligned
    ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
    : 'bg-orange-500/15 text-orange-400 border-orange-500/30';

  return (
    <div className="mt-2">
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${color}`}>
        {aligned ? '\u2713 PIVOT RETESTED' : '\u2717 RETEST OPPOSING'}
        {source ? ` ${source}` : ''}
        {typeof level === 'number' ? ` @ ${level.toFixed(1)}` : ''}
        {stage && <span className="text-[9px] opacity-70">({stage})</span>}
        {boost !== undefined && boost !== 0 && (
          <span className={boost > 0 ? 'text-emerald-400' : 'text-red-400'}>
            {boost > 0 ? '+' : ''}{boost}
          </span>
        )}
      </span>
    </div>
  );
};
