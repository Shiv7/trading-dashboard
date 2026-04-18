import { useState, useEffect } from 'react';
import { API_BASE } from '../../services/api';

/**
 * RetestStagePanel — 4-cell badge showing a scrip's RETEST progression.
 *
 * Stages: D1 (break) | 30M | 15M | 5M
 * Colours:
 *   GREEN  = stage retested in favour of D1 break direction (ALIGNED)
 *   RED    = stage retested AGAINST direction (OPPOSED) — setup failed
 *   AMBER  = timed out without a decision (TIMED_OUT)
 *   GREY   = stage not yet reached (PENDING)
 *
 * Staleness is derived from per-stage timestamps; "fresh" means within the last 60 min.
 * Backend: GET /api/strategy-state/retest/stages/{scripCode} (proxy to streamingcandle).
 */

type Outcome = 'ALIGNED' | 'OPPOSED' | 'PENDING' | 'TIMED_OUT';

interface StageState {
  stage: string;
  level?: number;
  levelSource?: string;
  direction?: 'BULLISH' | 'BEARISH';
  breakDate?: string;
  outcomeD1: Outcome;
  outcome30m: Outcome;
  outcome15m: Outcome;
  outcome5m: Outcome;
  outcome30mAt?: number | null;
  outcome15mAt?: number | null;
  outcome5mAt?: number | null;
  confirmedAt30m?: number | null;
  confirmedAt15m?: number | null;
  fiveminWindowStart?: number | null;
  fiveminCandlesSeen?: number;
  opposedGraceCandlesLeft?: number;
  overallOutcome?: string;
}

interface Response {
  scripCode: string;
  stateCount: number;
  states: StageState[];
}

interface Props {
  scripCode: string;
  autoRefresh?: boolean;
  compact?: boolean;
}

const CELL_LABELS: Array<{ key: 'outcomeD1' | 'outcome30m' | 'outcome15m' | 'outcome5m'; label: string; atKey?: keyof StageState }> = [
  { key: 'outcomeD1', label: 'D1' },
  { key: 'outcome30m', label: '30M', atKey: 'outcome30mAt' },
  { key: 'outcome15m', label: '15M', atKey: 'outcome15mAt' },
  { key: 'outcome5m', label: '5M', atKey: 'outcome5mAt' },
];

function outcomeColour(outcome: Outcome): string {
  switch (outcome) {
    case 'ALIGNED':   return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'OPPOSED':   return 'bg-red-500/20 text-red-300 border-red-500/40';
    case 'TIMED_OUT': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'PENDING':
    default:          return 'bg-slate-700/40 text-slate-500 border-slate-600/40';
  }
}

function ageLabel(at?: number | null): string {
  if (!at) return '';
  const diffMin = Math.floor((Date.now() - at) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const hr = Math.floor(diffMin / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function fmtDate(d?: string): string {
  if (!d) return 'DM';
  try {
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch {
    return d;
  }
}

export function RetestStagePanel({ scripCode, autoRefresh = true, compact = false }: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const res = await fetch(`${API_BASE}/strategy-state/retest/stages/${scripCode}`);
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const body: Response = await res.json();
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchOnce();
    if (autoRefresh) {
      const timer = setInterval(fetchOnce, 30000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }
    return () => { cancelled = true; };
  }, [scripCode, autoRefresh]);

  if (loading) {
    return (
      <div className="flex gap-1 text-[10px] text-slate-500">
        <span className="italic">loading stages…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex gap-1 text-[10px]">
        <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 italic">ERR {error}</span>
      </div>
    );
  }
  if (!data || data.stateCount === 0) {
    return (
      <div className="flex gap-1 text-[10px] text-slate-500">
        <span className="italic">no active retest</span>
      </div>
    );
  }

  // Render one row per state (there can be multiple broken levels per scrip).
  return (
    <div className={`flex flex-col gap-1 ${compact ? 'text-[10px]' : 'text-xs'}`}>
      {data.states.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          {/* Level + direction header */}
          <div className="min-w-[110px] text-slate-400">
            <span className={s.direction === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'}>
              {s.direction === 'BULLISH' ? '↑' : s.direction === 'BEARISH' ? '↓' : '•'}
            </span>{' '}
            <span className="text-slate-300">{s.level?.toFixed(2) ?? 'DM'}</span>{' '}
            <span className="text-slate-500">{s.levelSource ?? ''}</span>
          </div>
          {/* 4 cells */}
          {CELL_LABELS.map(({ key, label, atKey }) => {
            const outcome = s[key] as Outcome;
            const at = atKey ? (s[atKey] as number | null | undefined) : undefined;
            return (
              <div
                key={label}
                className={`px-1.5 py-0.5 rounded border ${outcomeColour(outcome)} flex items-center gap-1 min-w-[58px] justify-center`}
                title={`${label}: ${outcome}${at ? ' · ' + ageLabel(at) + ' ago' : ''}`}
              >
                <span className="font-semibold">{label}</span>
                {at ? <span className="opacity-70">{ageLabel(at)}</span> : null}
              </div>
            );
          })}
          {/* Break date on the far right */}
          <div className="text-slate-500 text-[10px] ml-1">
            broken {fmtDate(s.breakDate)}
          </div>
        </div>
      ))}
    </div>
  );
}
