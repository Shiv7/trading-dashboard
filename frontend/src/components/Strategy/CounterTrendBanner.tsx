/**
 * CounterTrendBanner — shared red banner for FUDKII / FUKAA / FUDKOI signal cards.
 *
 * Renders when backend stamps f14ShouldFlip=true (or score>=50 fallback).
 * Shows F14 score, reasons, flipped trade plan (equity + option), and
 * fetches counter-trend OTM contract details from /api/counter-trend/otm.
 */
import { useEffect, useState } from 'react';

interface CounterTrendSignal {
  symbol?: string;
  direction?: 'BULLISH' | 'BEARISH' | string;
  f14Score?: number;
  f14ShouldFlip?: boolean;
  f14Reasons?: string;
  f14CounterDirection?: string;
  f14WickRatio?: number;
  f14ClosedOpposite?: boolean;
  f14RangeAtr?: number;
  f14BodyPct?: number;
  f14GapPctOvernight?: number;
  flippedGrade?: string;
  flippedRR?: number;
  flippedSL?: number;
  flippedT1?: number;
  flippedT2?: number;
  flippedT3?: number;
  flippedT4?: number;
  flippedOptionSL?: number;
  flippedOptionT1?: number;
  flippedOptionT2?: number;
  flippedOptionT3?: number;
  flippedOptionT4?: number;
  flippedFortressScore?: number;
}

interface CounterOtm {
  available?: boolean;
  reason?: string;
  contractName?: string;
  scripCode?: string;
  strike?: number;
  counterType?: string;
  expiry?: string;
  spotPrice?: number;
  ltp?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  impliedVol?: number;
  spreadPct?: number;
  bidAskSpread?: number;
  topOfBookDepth?: number;
  avgVolPerMin?: number;
  currentVolPerMin?: number;
  volumeSurgeRatio?: number;
  liquidityScore?: number;
  daysToExpiry?: number;
}

export const CounterTrendBanner = ({ sig }: { sig: CounterTrendSignal }) => {
  const [counterOtm, setCounterOtm] = useState<CounterOtm | null>(null);

  const score = sig.f14Score ?? 0;
  const triggered = sig.f14ShouldFlip === true || score >= 50;
  const reasons = sig.f14Reasons ? String(sig.f14Reasons).split('|').filter(Boolean) : [];

  useEffect(() => {
    if (!triggered || !sig.symbol || counterOtm) return;
    fetch(`/api/counter-trend/otm/${encodeURIComponent(sig.symbol)}/${sig.direction}`)
      .then(r => r.json())
      .then(d => setCounterOtm(d))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggered, sig.symbol, sig.direction]);

  if (!triggered) return null;

  const flipDir = sig.direction === 'BEARISH' ? 'BULLISH' : 'BEARISH';
  const hasFlippedPlan = sig.flippedGrade != null || sig.flippedSL != null;

  return (
    <div className="mt-3 rounded-xl border-2 border-red-500/60 bg-red-500/15 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-red-400 text-lg">⚠</span>
          <span className="text-red-300 font-bold text-xs uppercase tracking-wide">
            Counter-Trend Setup
          </span>
          <span className="px-1.5 py-0.5 rounded bg-red-500/30 text-red-200 text-[9px] font-bold">SHADOW</span>
          <span className="px-1.5 py-0.5 rounded bg-red-600/40 text-red-100 text-[10px] font-bold font-mono">
            F14={score}
          </span>
        </div>
        <span className="text-red-300 text-[10px]">
          <strong>{sig.direction}</strong> → <strong>{flipDir}</strong>
        </span>
      </div>

      {reasons.length > 0 && (
        <div className="text-[10px] text-red-200 space-y-0.5">
          {reasons.map((r, i) => (
            <div key={i}>• {r}</div>
          ))}
        </div>
      )}

      {hasFlippedPlan && (
        <div className="rounded-lg bg-red-950/40 border border-red-500/30 p-2 mt-1">
          <div className="text-[10px] text-red-300 font-bold mb-1">Flipped Trade Plan (recomputed):</div>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-red-100">
            <div><span className="text-red-400">Grade </span><span className="font-mono font-bold">{sig.flippedGrade ?? '—'}</span></div>
            <div><span className="text-red-400">RR </span><span className="font-mono">{(sig.flippedRR ?? 0).toFixed(2)}</span></div>
            <div><span className="text-red-400">Fort </span><span className="font-mono">{(sig.flippedFortressScore ?? 0).toFixed(1)}</span></div>
          </div>
          <div className="grid grid-cols-5 gap-1 text-[10px] text-red-100 mt-1 border-t border-red-500/20 pt-1">
            <div><span className="text-red-400">SL </span><span className="font-mono">{(sig.flippedSL ?? 0).toFixed(2)}</span></div>
            <div><span className="text-red-400">T1 </span><span className="font-mono">{(sig.flippedT1 ?? 0).toFixed(2)}</span></div>
            <div><span className="text-red-400">T2 </span><span className="font-mono">{(sig.flippedT2 ?? 0).toFixed(2)}</span></div>
            <div><span className="text-red-400">T3 </span><span className="font-mono">{(sig.flippedT3 ?? 0).toFixed(2)}</span></div>
            <div><span className="text-red-400">T4 </span><span className="font-mono">{(sig.flippedT4 ?? 0).toFixed(2)}</span></div>
          </div>
          {sig.flippedOptionSL != null && (
            <div className="grid grid-cols-5 gap-1 text-[10px] text-red-100/80 mt-1">
              <div><span className="text-red-400">OptSL </span><span className="font-mono">{(sig.flippedOptionSL ?? 0).toFixed(2)}</span></div>
              <div><span className="text-red-400">OptT1 </span><span className="font-mono">{(sig.flippedOptionT1 ?? 0).toFixed(2)}</span></div>
              <div><span className="text-red-400">OptT2 </span><span className="font-mono">{(sig.flippedOptionT2 ?? 0).toFixed(2)}</span></div>
              <div><span className="text-red-400">OptT3 </span><span className="font-mono">{(sig.flippedOptionT3 ?? 0).toFixed(2)}</span></div>
              <div><span className="text-red-400">OptT4 </span><span className="font-mono">{(sig.flippedOptionT4 ?? 0).toFixed(2)}</span></div>
            </div>
          )}
        </div>
      )}

      {counterOtm?.available ? (
        <div className="rounded-lg bg-red-950/40 border border-red-500/30 p-2 space-y-1">
          <div className="text-[10px] text-red-300 font-bold mb-1">Counter-Trend OTM Recommendation:</div>
          <div className="flex items-center justify-between text-[11px]">
            <div className="font-mono font-semibold text-red-100">{counterOtm.contractName}</div>
            <div className="text-red-100">
              <span className="text-red-400 text-[10px]">Entry: </span>
              <span className="font-mono font-bold text-yellow-300">₹{(counterOtm.ltp ?? 0).toFixed(2)}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px] text-red-100">
            <div><span className="text-red-400">δ</span> <span className="font-mono">{(counterOtm.delta ?? 0).toFixed(3)}</span></div>
            <div><span className="text-red-400">γ</span> <span className="font-mono">{(counterOtm.gamma ?? 0).toFixed(4)}</span></div>
            <div><span className="text-red-400">θ</span> <span className="font-mono">{(counterOtm.theta ?? 0).toFixed(2)}</span></div>
            <div><span className="text-red-400">IV</span> <span className="font-mono">{(counterOtm.impliedVol ?? 0).toFixed(1)}%</span></div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-red-100">
            <div>
              <span className="text-red-400">Spread </span>
              <span className={`font-mono ${(counterOtm.spreadPct ?? -1) > 5 ? 'text-amber-400' : 'text-red-100'}`}>
                {(counterOtm.spreadPct ?? -1) > 0 ? `${(counterOtm.spreadPct ?? 0).toFixed(2)}%` : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-red-400">Vol </span>
              <span className="font-mono">{Math.round(counterOtm.avgVolPerMin ?? 0).toLocaleString()}/min</span>
            </div>
            <div>
              <span className="text-red-400">Surge </span>
              <span className={`font-mono ${(counterOtm.volumeSurgeRatio ?? 0) > 1.5 ? 'text-emerald-300' : 'text-red-100'}`}>
                {(counterOtm.volumeSurgeRatio ?? 0).toFixed(2)}x
              </span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px] text-red-100 border-t border-red-500/20 pt-1">
            <div><span className="text-red-400">Spot </span><span className="font-mono">{(counterOtm.spotPrice ?? 0).toFixed(2)}</span></div>
            <div><span className="text-red-400">Strike </span><span className="font-mono">{counterOtm.strike} {counterOtm.counterType}</span></div>
            <div><span className="text-red-400">Depth </span><span className="font-mono">{(counterOtm.topOfBookDepth ?? -1) > 0 ? `₹${((counterOtm.topOfBookDepth ?? 0)/1e5).toFixed(1)}L` : 'N/A'}</span></div>
            <div><span className="text-red-400">DTE </span><span className="font-mono">{counterOtm.daysToExpiry}d</span></div>
          </div>
          <div className="text-[9px] text-red-400 pt-1">
            ScripCode {counterOtm.scripCode} · Expiry {counterOtm.expiry} · Liquidity {Math.round(counterOtm.liquidityScore ?? 0).toLocaleString()}
          </div>
        </div>
      ) : counterOtm ? (
        <div className="text-[10px] text-red-300 italic">
          Counter OTM lookup: {counterOtm.reason || 'unavailable'}
        </div>
      ) : (
        <div className="text-[10px] text-red-400 italic">Loading counter-trend OTM...</div>
      )}

      <div className="text-[9px] text-red-400/70 italic mt-1 border-t border-red-500/20 pt-1">
        ⓘ Shadow mode — does NOT auto-trade. Review for manual decision.
      </div>
    </div>
  );
};

export default CounterTrendBanner;
