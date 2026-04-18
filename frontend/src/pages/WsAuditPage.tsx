import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Activity, CheckCircle2, XCircle } from 'lucide-react';
import { API_BASE } from '../services/api';

/**
 * WsAuditPage — aggregated view of websocket-feed orphan events.
 *
 * Powered by /api/ws-audit/{stats,active,history} which proxy trade-exec's /api/ws-orphans/*.
 * Gives the operator a bird's-eye view that the per-card feedState badge cannot:
 *  - How many positions are orphaned right now?
 *  - Are multiple positions orphaning simultaneously (exchange-wide issue vs per-position)?
 *  - Today's force-exit rate + safety-rail holds (cascade-guard, large-swing-guard)?
 *  - Post-mortem timeline for each resolved event.
 */

interface Stats {
  activeNow: number;
  totalLast24h: number;
  resolvedByFreshTick: number;
  forceExited: number;
  cascadeHeld: number;
  largeSwingHeld: number;
}

interface OrphanEvent {
  id: string;
  tradeId?: string;
  scripCode?: string;
  symbol?: string;
  strategy?: string;
  direction?: string;
  exchange?: string;
  optionType?: string;
  optionStrike?: number;
  greekEnriched?: boolean;
  entryPrice?: number;
  lastFreshLtp?: number;
  lastFreshLtpAt?: string;
  lastKnownPnl?: number;
  lastKnownPnlPct?: number;
  orphanStartedAt?: string;
  mode?: 'PROXY' | 'BLIND';
  modeTimeoutMs?: number;
  proxySlChecks?: number;
  proxyTargetChecks?: number;
  lastEstimatedLtp?: number;
  resubAttempts?: number;
  resubCleanCycles?: number;
  resubHttpFailures?: number;
  circuitBreakerTripped?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  exitPrice?: number;
  exitPriceSource?: string;
  finalPnl?: number;
  finalPnlPct?: number;
  firstSeenAt?: string;
}

function fmtTime(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return iso; }
}

function durationLabel(startIso?: string, endIso?: string) {
  if (!startIso) return '—';
  try {
    const start = new Date(startIso).getTime();
    const end = endIso ? new Date(endIso).getTime() : Date.now();
    const s = Math.floor((end - start) / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  } catch { return '—'; }
}

function resolvedByBadge(reason?: string): { color: string; label: string } {
  if (!reason) return { color: 'bg-slate-700/40 text-slate-400 border-slate-600/40', label: 'PENDING' };
  if (reason === 'FRESH_TICK') return { color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', label: 'RESOLVED' };
  if (reason.startsWith('SL_')) return { color: 'bg-red-500/20 text-red-300 border-red-500/40', label: reason };
  if (reason.startsWith('T')) return { color: 'bg-amber-500/20 text-amber-300 border-amber-500/40', label: reason };
  if (reason.startsWith('FORCE_EXIT')) return { color: 'bg-red-600/25 text-red-200 border-red-600/50', label: reason };
  if (reason === 'CASCADE_GUARD_HELD') return { color: 'bg-orange-500/25 text-orange-200 border-orange-500/50', label: 'CASCADE_HELD' };
  if (reason === 'LARGE_SWING_HELD') return { color: 'bg-orange-500/25 text-orange-200 border-orange-500/50', label: 'SWING_HELD' };
  if (reason === 'DUAL_FEED_DEAD') return { color: 'bg-red-700/25 text-red-200 border-red-700/50', label: 'DUAL_DEAD' };
  return { color: 'bg-slate-700/40 text-slate-400 border-slate-600/40', label: reason };
}

function StatPill({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number; tone: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass = {
    neutral: 'bg-slate-800/60 text-slate-300 border-slate-700/50',
    good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/15 text-red-300 border-red-500/30',
  }[tone];
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${toneClass}`}>
      {icon}
      <div>
        <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
        <div className="text-lg font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

export default function WsAuditPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [active, setActive] = useState<OrphanEvent[]>([]);
  const [history, setHistory] = useState<OrphanEvent[]>([]);
  const [sinceMinutes, setSinceMinutes] = useState<number>(1440);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      const [sRes, aRes, hRes] = await Promise.all([
        fetch(`${API_BASE}/ws-audit/stats`),
        fetch(`${API_BASE}/ws-audit/active`),
        fetch(`${API_BASE}/ws-audit/history?limit=200&sinceMinutes=${sinceMinutes}`),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (aRes.ok) setActive(await aRes.json());
      if (hRes.ok) setHistory(await hRes.json());
      setError(null);
    } catch (e: any) {
      setError(e.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 5000);  // aggressive refresh — orphans evolve fast
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinceMinutes]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Websocket Orphan Audit</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">History:</label>
          <select
            value={sinceMinutes}
            onChange={e => setSinceMinutes(Number(e.target.value))}
            className="text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1"
          >
            <option value={60}>1h</option>
            <option value={360}>6h</option>
            <option value={1440}>24h</option>
            <option value={4320}>3d</option>
            <option value={10080}>7d</option>
          </select>
          <button onClick={fetchAll} className="p-1.5 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* STATS ROW */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          <StatPill icon={<Activity className="w-4 h-4" />} label="Active now"
                    value={stats.activeNow}
                    tone={stats.activeNow > 0 ? 'warn' : 'good'} />
          <StatPill icon={<Activity className="w-4 h-4" />} label="24h total"
                    value={stats.totalLast24h} tone="neutral" />
          <StatPill icon={<CheckCircle2 className="w-4 h-4" />} label="Fresh-tick resolved"
                    value={stats.resolvedByFreshTick} tone="good" />
          <StatPill icon={<XCircle className="w-4 h-4" />} label="Force-exited"
                    value={stats.forceExited}
                    tone={stats.forceExited > 3 ? 'bad' : stats.forceExited > 0 ? 'warn' : 'neutral'} />
          <StatPill icon={<AlertTriangle className="w-4 h-4" />} label="Cascade held"
                    value={stats.cascadeHeld}
                    tone={stats.cascadeHeld > 0 ? 'bad' : 'neutral'} />
          <StatPill icon={<AlertTriangle className="w-4 h-4" />} label="Swing held"
                    value={stats.largeSwingHeld}
                    tone={stats.largeSwingHeld > 0 ? 'bad' : 'neutral'} />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          Error: {error}
        </div>
      )}

      {/* ACTIVE ORPHANS */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">
          Active orphans
          {active.length > 0 && <span className="ml-2 text-amber-400">({active.length})</span>}
        </h2>
        {loading && active.length === 0 ? (
          <div className="text-xs text-slate-500 italic">loading…</div>
        ) : active.length === 0 ? (
          <div className="text-xs text-slate-600 italic">no active orphans — all positions have fresh feeds</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700/50 text-slate-500">
                  <th className="text-left py-1.5 px-2">Symbol</th>
                  <th className="text-left py-1.5 px-2">Strategy</th>
                  <th className="text-left py-1.5 px-2">Mode</th>
                  <th className="text-right py-1.5 px-2">Duration</th>
                  <th className="text-right py-1.5 px-2">Resubs</th>
                  <th className="text-right py-1.5 px-2">Entry</th>
                  <th className="text-right py-1.5 px-2">Last LTP</th>
                  <th className="text-right py-1.5 px-2">Est LTP</th>
                </tr>
              </thead>
              <tbody>
                {active.map(e => (
                  <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                    <td className="py-1.5 px-2 text-slate-200 font-medium">{e.symbol ?? e.scripCode ?? '—'}</td>
                    <td className="py-1.5 px-2 text-slate-400">{e.strategy ?? '—'}</td>
                    <td className="py-1.5 px-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        e.mode === 'PROXY' ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                        : 'bg-red-500/25 text-red-200 border-red-500/50'
                      }`}>{e.mode}</span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-amber-400 tabular-nums">
                      {durationLabel(e.orphanStartedAt)}
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-400 tabular-nums">
                      {e.resubAttempts ?? 0}
                      {e.circuitBreakerTripped && <span className="ml-1 text-red-400" title="circuit breaker tripped">🔌</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">{e.entryPrice?.toFixed(2) ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right text-slate-400 tabular-nums">{e.lastFreshLtp?.toFixed(2) ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">
                      {e.lastEstimatedLtp != null ? e.lastEstimatedLtp.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* HISTORY */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">
          History ({history.length})
        </h2>
        {history.length === 0 ? (
          <div className="text-xs text-slate-600 italic">no events in the selected window</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700/50 text-slate-500">
                  <th className="text-left py-1.5 px-2">Started</th>
                  <th className="text-left py-1.5 px-2">Symbol</th>
                  <th className="text-left py-1.5 px-2">Strategy</th>
                  <th className="text-left py-1.5 px-2">Mode</th>
                  <th className="text-right py-1.5 px-2">Duration</th>
                  <th className="text-left py-1.5 px-2">Resolution</th>
                  <th className="text-right py-1.5 px-2">Resubs</th>
                  <th className="text-right py-1.5 px-2">Exit Px</th>
                  <th className="text-left py-1.5 px-2">Source</th>
                  <th className="text-right py-1.5 px-2">PnL</th>
                </tr>
              </thead>
              <tbody>
                {history.map(e => {
                  const badge = resolvedByBadge(e.resolvedBy);
                  return (
                    <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                      <td className="py-1.5 px-2 text-slate-500 tabular-nums">{fmtTime(e.orphanStartedAt)}</td>
                      <td className="py-1.5 px-2 text-slate-200 font-medium">{e.symbol ?? e.scripCode ?? '—'}</td>
                      <td className="py-1.5 px-2 text-slate-400">{e.strategy ?? '—'}</td>
                      <td className="py-1.5 px-2 text-slate-400">{e.mode ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right text-slate-400 tabular-nums">
                        {durationLabel(e.orphanStartedAt, e.resolvedAt)}
                      </td>
                      <td className="py-1.5 px-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-500 tabular-nums">{e.resubAttempts ?? 0}</td>
                      <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">
                        {e.exitPrice != null ? e.exitPrice.toFixed(2) : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-slate-500 text-[10px]">{e.exitPriceSource ?? '—'}</td>
                      <td className={`py-1.5 px-2 text-right tabular-nums ${
                        e.finalPnl == null ? 'text-slate-500' : e.finalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {e.finalPnl == null ? '—' : `${e.finalPnl >= 0 ? '+' : ''}${e.finalPnl.toFixed(0)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
