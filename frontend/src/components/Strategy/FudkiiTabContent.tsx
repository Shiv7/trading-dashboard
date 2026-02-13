import React, { useEffect, useState } from 'react';
import {
  RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Filter,
  Clock, TrendingUp, TrendingDown, ChevronDown, ChevronRight
} from 'lucide-react';
import { getStrategyConfig } from '../../types/strategy';
import { fetchJson } from '../../services/api';

interface FudkiiSignal {
  scripCode: string;
  symbol: string;
  companyName: string;
  exchange: string;
  triggered: boolean;
  direction: string;
  reason: string;
  triggerPrice: number;
  triggerScore: number;
  triggerTime: string;
  triggerTimeEpoch: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  superTrend: number;
  trend: string;
  trendChanged: boolean;
  pricePosition: string;
  cachedAt?: number;
  // Enriched trade plan from backend (pivot-based or BB-fallback)
  target1?: number | null;
  target2?: number | null;
  target3?: number | null;
  target4?: number | null;
  stopLoss?: number;
  riskReward?: number;
  pivotSource?: boolean;
}

interface Targets {
  t1: number | null;
  t2: number | null;
  t3: number | null;
  t4: number | null;
  sl: number;
  rr: number;
  hasPivots: boolean;
}

type SortField = 'time' | 'rr';
type SortDir = 'asc' | 'desc';
type ExchangeFilter = 'ALL' | 'N' | 'M' | 'C';

interface FudkiiTabContentProps {
  autoRefresh?: boolean;
}

/** Parse triggerTime/cachedAt to epoch ms for reliable sorting */
function getEpoch(sig: FudkiiSignal): number {
  if (sig.triggerTimeEpoch) return sig.triggerTimeEpoch;
  if (sig.triggerTime) {
    const d = new Date(sig.triggerTime);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return sig.cachedAt || 0;
}

/** Round to max 2 decimal places, strip trailing zeros */
function fmt(v: number): string {
  return Number(v.toFixed(2)).toString();
}

function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function isFromToday(sig: FudkiiSignal): boolean {
  if (!sig.triggerTime) return false;
  const d = new Date(sig.triggerTime);
  if (isNaN(d.getTime())) return false;
  const sigDateIST = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return sigDateIST === getTodayIST();
}

function formatTriggerTime(sig: FudkiiSignal): string {
  if (!sig.triggerTime) return '';
  const d = new Date(sig.triggerTime);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
}

/**
 * Extract targets from signal. Backend enriches signals with pivot-based
 * targets (t1-t4, sl, rr, pivotSource). For old signals missing these fields,
 * fall back to BB-projected targets computed here.
 */
function extractTargets(sig: FudkiiSignal): Targets {
  // If backend already computed targets, use them directly
  if (sig.target1 != null && sig.stopLoss != null) {
    return {
      t1: sig.target1 ?? null,
      t2: sig.target2 ?? null,
      t3: sig.target3 ?? null,
      t4: sig.target4 ?? null,
      sl: sig.stopLoss,
      rr: sig.riskReward ?? 0,
      hasPivots: sig.pivotSource === true,
    };
  }

  // Fallback for old signals without enriched fields: BB-projected
  const bw = (sig.bbUpper || 0) - (sig.bbLower || 0);
  const p = sig.triggerPrice || 0;
  const mid = sig.bbMiddle || ((sig.bbUpper || 0) + (sig.bbLower || 0)) / 2;
  const sl = mid > 0 ? mid : p * (sig.direction === 'BULLISH' ? 0.98 : 1.02);
  const isLong = sig.direction === 'BULLISH';

  const t1 = isLong ? p + 0.5 * bw : p - 0.5 * bw;
  const t2 = isLong ? p + bw : p - bw;
  const risk = isLong ? p - sl : sl - p;
  const rr = risk > 0 && bw > 0 ? (isLong ? t1 - p : p - t1) / risk : 0;

  return { t1, t2, t3: null, t4: null, sl, rr, hasPivots: false };
}

function getRRBarColor(rr: number): string {
  if (rr >= 1.5) return 'bg-green-500';
  if (rr >= 1.0) return 'bg-yellow-500';
  return 'bg-red-500/70';
}

function getRRTextColor(rr: number): string {
  if (rr >= 1.5) return 'text-green-400';
  if (rr >= 1.0) return 'text-yellow-400';
  return 'text-red-400';
}

/* ======================== FUDKII SIGNAL CARD ======================== */

const FudkiiSignalCard: React.FC<{ sig: FudkiiSignal; targets: Targets }> = ({ sig, targets }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = sig.direction === 'BULLISH';
  const { t1, t2, t3, t4, sl, rr, hasPivots } = targets;
  const rrBarWidth = Math.min(100, (rr / 3) * 100);

  return (
    <div className="bg-slate-800 rounded-lg border border-yellow-500/30 overflow-hidden">
      {/* Row 1: Symbol + Exchange | Price | Direction | Trigger time */}
      <div className="p-3 pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white text-sm">
              {sig.symbol || sig.companyName || sig.scripCode}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">{sig.exchange}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white">{fmt(sig.triggerPrice)}</span>
            <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
              isLong ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {sig.direction}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock className="w-3 h-3" />
              {formatTriggerTime(sig)}
            </span>
          </div>
        </div>
      </div>

      {/* Row 2: R:R bar (Risk:Reward = 1:X) */}
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 w-7 shrink-0">R:R</span>
          <div className="flex-1 bg-slate-700 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all ${getRRBarColor(rr)}`}
              style={{ width: `${rrBarWidth}%` }}
            />
          </div>
          <span className={`font-mono text-xs font-bold ${getRRTextColor(rr)} w-10 text-right`}>
            1:{rr.toFixed(1)}
          </span>
          {!hasPivots && (
            <span className="px-1 py-0.5 rounded text-[9px] text-red-400 bg-red-500/15 font-medium">Pivot NA</span>
          )}
        </div>
      </div>

      {/* Row 3: Trade plan — T1 → T2 → T3 → T4 | SL */}
      <div className="px-3 pb-2.5">
        <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
          {t1 !== null && (
            <>
              <span className="text-slate-500">T1</span>
              <span className="font-mono text-green-400">{fmt(t1)}</span>
            </>
          )}
          {t2 !== null && (
            <>
              <span className="text-slate-600">&rarr;</span>
              <span className="text-slate-500">T2</span>
              <span className="font-mono text-green-300">{fmt(t2)}</span>
            </>
          )}
          {t3 !== null && (
            <>
              <span className="text-slate-600">&rarr;</span>
              <span className="text-slate-500">T3</span>
              <span className="font-mono text-green-300/80">{fmt(t3)}</span>
            </>
          )}
          {t4 !== null && (
            <>
              <span className="text-slate-600">&rarr;</span>
              <span className="text-slate-500">T4</span>
              <span className="font-mono text-green-300/60">{fmt(t4)}</span>
            </>
          )}
          <span className="text-slate-600 ml-auto">|</span>
          <span className="text-slate-500">SL</span>
          <span className="font-mono text-red-400">{fmt(sl)}</span>
        </div>
      </div>

      {/* Expandable Details */}
      <div className="border-t border-slate-700/50">
        <div
          className="px-3 py-1.5 cursor-pointer hover:bg-slate-700/30 flex items-center gap-2 text-[11px] text-slate-500"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Details
        </div>
        {expanded && (
          <div className="px-3 pb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <div>
              <span className="text-slate-500">Score:</span>
              <span className="ml-1 font-mono text-slate-300">{sig.triggerScore}</span>
            </div>
            <div>
              <span className="text-slate-500">Scrip:</span>
              <span className="ml-1 font-mono text-slate-300">{sig.scripCode}</span>
            </div>
            <div>
              <span className="text-slate-500">ST:</span>
              <span className={`ml-1 font-mono ${sig.trend === 'UP' ? 'text-green-400' : 'text-red-400'}`}>
                {fmt(sig.superTrend)}
              </span>
              {sig.trendChanged && <span className="ml-1 text-orange-400">FLIP</span>}
            </div>
            <div>
              <span className="text-slate-500">BB:</span>
              <span className="ml-1 font-mono text-slate-400">{fmt(sig.bbLower)} – {fmt(sig.bbUpper)}</span>
            </div>
            {!hasPivots && (
              <div className="col-span-2 text-red-400/70 italic">
                Pivot NA — using BB-projected targets
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ======================== FUDKII TAB CONTENT ======================== */

export const FudkiiTabContent: React.FC<FudkiiTabContentProps> = ({ autoRefresh = true }) => {
  const [signals, setSignals] = useState<FudkiiSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const config = getStrategyConfig('FUDKII');

  const fetchFudkii = async () => {
    try {
      const data = await fetchJson<FudkiiSignal[]>('/strategy-state/fudkii/all/list');
      setSignals(data);
    } catch (err) {
      console.error('Error fetching FUDKII signals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFudkii();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchFudkii, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [autoRefresh]);

  let filtered = signals.filter(s => s.triggered && isFromToday(s));
  if (exchangeFilter !== 'ALL') {
    filtered = filtered.filter(s => s.exchange === exchangeFilter);
  }

  const withTargets = filtered.map(sig => ({
    sig,
    targets: extractTargets(sig),
  }));

  const sorted = [...withTargets].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'time': {
        cmp = getEpoch(a.sig) - getEpoch(b.sig);
        if (cmp === 0) cmp = a.targets.rr - b.targets.rr;
        break;
      }
      case 'rr':
        cmp = a.targets.rr - b.targets.rr;
        if (cmp === 0) cmp = getEpoch(a.sig) - getEpoch(b.sig);
        break;
    }
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const todayCount = signals.filter(s => s.triggered && isFromToday(s)).length;
  const bullishCount = signals.filter(s => s.triggered && isFromToday(s) && s.direction === 'BULLISH').length;
  const bearishCount = signals.filter(s => s.triggered && isFromToday(s) && s.direction === 'BEARISH').length;

  const cycleSortField = () => {
    setSortField(f => f === 'time' ? 'rr' : 'time');
  };

  const toggleSortDir = () => {
    setSortDir(d => d === 'desc' ? 'asc' : 'desc');
  };

  const SortIcon = sortDir === 'desc' ? ArrowDown : ArrowUp;
  const sortLabel = sortField === 'time' ? 'Time' : 'R:R';

  return (
    <div className="space-y-6">
      <div className={`bg-slate-800 rounded-lg border ${config.accentBorder} p-4`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-lg font-medium ${config.accentText} flex items-center gap-2`}>
            <span className={`px-2 py-0.5 rounded text-sm font-bold ${config.accentBg} ${config.accentText}`}>
              {config.label}
            </span>
            Strategy Dashboard
            <span className="text-xs text-slate-500 font-normal ml-2">{getTodayLabel()}</span>
          </h2>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-orange-400 font-mono">{todayCount} signals</span>
            <span className="text-green-400 font-mono">{bullishCount} bullish</span>
            <span className="text-red-400 font-mono">{bearishCount} bearish</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={cycleSortField}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 hover:bg-slate-700 transition-colors"
              title="Click to toggle: Time / R:R"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              Sort: {sortLabel}
            </button>
            <button
              onClick={toggleSortDir}
              className="flex items-center px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 hover:bg-slate-700 transition-colors"
              title={sortDir === 'desc' ? 'Highest / Newest first' : 'Lowest / Oldest first'}
            >
              <SortIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded text-xs transition-colors ${
                exchangeFilter !== 'ALL'
                  ? 'bg-orange-500/10 border-orange-500/50 text-orange-400'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              {exchangeFilter === 'ALL' ? 'Exchange' : exchangeFilter}
              {exchangeFilter !== 'ALL' && (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
              )}
            </button>

            {showFilterMenu && (
              <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-20 p-3 min-w-[180px]">
                <div className="text-[10px] text-slate-500 uppercase mb-2">Exchange</div>
                <div className="flex gap-1">
                  {(['ALL', 'N', 'M', 'C'] as ExchangeFilter[]).map(e => (
                    <button
                      key={e}
                      onClick={() => { setExchangeFilter(e); setShowFilterMenu(false); }}
                      className={`px-2 py-1 rounded text-xs ${
                        exchangeFilter === e
                          ? 'bg-orange-500/20 text-orange-400'
                          : 'bg-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {e === 'ALL' ? 'All' : e}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <span className="text-xs text-slate-500">
          {sorted.length} signals
        </span>
      </div>

      {loading && signals.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
          Loading FUDKII signals...
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <div className="text-center py-12 text-slate-500 bg-slate-800 rounded-lg border border-slate-700">
          {signals.length === 0
            ? 'No FUDKII signals received yet. Waiting for SuperTrend flip + BB breakout...'
            : `No signals from ${getTodayLabel()} match the current filter.`}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map(({ sig, targets }) => (
            <FudkiiSignalCard key={sig.scripCode} sig={sig} targets={targets} />
          ))}
        </div>
      )}

      {showFilterMenu && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowFilterMenu(false)}
        />
      )}
    </div>
  );
};

export default FudkiiTabContent;
