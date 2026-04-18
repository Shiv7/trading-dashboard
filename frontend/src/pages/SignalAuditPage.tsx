import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { API_BASE } from '../services/api';

/**
 * SignalAuditPage — timeline view of every signal's 6-stage journey through trade-exec.
 *
 * Reads /api/signal-audit/recent which proxies trade-exec's /api/audit/recent. Each row shows
 * a signal with its stage cells (GEN | ENR | RCV | BAT | EXE | EXT), colour-coded by outcome:
 *   GREEN  = completed successfully
 *   RED    = rejected / opposed
 *   AMBER  = pending (no decision yet)
 *   GREY   = not reached
 */

interface AuditRow {
  signalId: string;
  scripCode?: string;
  symbol?: string;
  strategy?: string;
  direction?: string;
  exchange?: string;
  generatedAt?: string;
  entryPrice?: number;
  sl?: number;
  t1?: number;
  t2?: number;
  t3?: number;
  t4?: number;
  tradeGrade?: string;
  confluenceRR?: number;
  enriched?: boolean;
  optionScripCode?: string;
  receivedAt?: string;
  receiveLagMs?: number;
  batchedAt?: string;
  batchOutcome?: string;
  batchReason?: string;
  executedAt?: string;
  executionOutcome?: string;
  tradeId?: string;
  filledPrice?: number;
  filledQty?: number;
  rejectReason?: string;
  exitedAt?: string;
  exitReason?: string;
  exitPrice?: number;
  realizedPnl?: number;
  realizedPnlPct?: number;
  holdDurationMs?: number;
  firstSeenAt?: string;
  lastUpdatedAt?: string;
}

function cellClass(status: 'ok' | 'fail' | 'pending' | 'none'): string {
  switch (status) {
    case 'ok':      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'fail':    return 'bg-red-500/20 text-red-300 border-red-500/40';
    case 'pending': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    default:        return 'bg-slate-700/40 text-slate-500 border-slate-600/40';
  }
}

function fmtTime(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return iso; }
}

function fmtPnl(pnl?: number, pct?: number) {
  if (pnl == null) return '—';
  const sign = pnl >= 0 ? '+' : '';
  const cls = pnl >= 0 ? 'text-emerald-400' : 'text-red-400';
  const pctStr = pct != null ? ` (${sign}${pct.toFixed(2)}%)` : '';
  return <span className={cls}>{sign}{pnl.toFixed(0)}{pctStr}</span>;
}

function batchStatus(outcome?: string): 'ok' | 'fail' | 'pending' | 'none' {
  if (!outcome) return 'none';
  if (outcome === 'SELECTED') return 'ok';
  return 'fail';
}
function execStatus(outcome?: string): 'ok' | 'fail' | 'pending' | 'none' {
  if (!outcome) return 'none';
  if (outcome === 'FILLED' || outcome === 'OPTION_FILLED'
      || outcome === 'VOME_PLACED' || outcome === 'OPTION_VOME_PLACED'
      || outcome === 'FILLED_LEGACY') return 'ok';
  if (outcome === 'REJECTED' || outcome === 'ERROR' || outcome === 'EXPIRED') return 'fail';
  return 'pending';
}
function exitStatus(reason?: string, pnl?: number): 'ok' | 'fail' | 'none' {
  if (!reason) return 'none';
  if (pnl != null) return pnl >= 0 ? 'ok' : 'fail';
  return 'ok';
}

export default function SignalAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [strategyFilter, setStrategyFilter] = useState<string>('ALL');
  const [sinceMinutes, setSinceMinutes] = useState<number>(1440);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/signal-audit/recent?limit=200&sinceMinutes=${sinceMinutes}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data);
      } else {
        console.warn('signal-audit fetch failed', res.status);
      }
    } catch (e) {
      console.error('signal-audit fetch error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinceMinutes]);

  const filtered = strategyFilter === 'ALL'
    ? rows
    : rows.filter(r => (r.strategy || '').toUpperCase() === strategyFilter);

  const strategies = Array.from(new Set(rows.map(r => r.strategy).filter(Boolean))) as string[];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold text-white">Signal Pipeline Audit</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Strategy:</label>
          <select
            value={strategyFilter}
            onChange={e => setStrategyFilter(e.target.value)}
            className="text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1"
          >
            <option value="ALL">All</option>
            {strategies.sort().map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="text-xs text-slate-500 ml-2">Window:</label>
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
          <button onClick={fetchData} className="p-1.5 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-slate-500">{filtered.length} signals</span>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-slate-600 text-sm">no signals in the selected window</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700/50 text-slate-500">
                <th className="text-left py-1.5 px-2">Symbol</th>
                <th className="text-left py-1.5 px-2">Strategy</th>
                <th className="text-left py-1.5 px-2">Dir</th>
                <th className="text-right py-1.5 px-2">Entry / Exit</th>
                <th className="text-center py-1.5 px-2">Stages</th>
                <th className="text-left py-1.5 px-2">Batch</th>
                <th className="text-left py-1.5 px-2">Exec</th>
                <th className="text-left py-1.5 px-2">Exit</th>
                <th className="text-right py-1.5 px-2">PnL</th>
                <th className="text-right py-1.5 px-2">Lag</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.signalId} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="py-1.5 px-2 text-slate-200 font-medium">{r.symbol ?? r.scripCode ?? '—'}</td>
                  <td className="py-1.5 px-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">{r.strategy}</span>
                  </td>
                  <td className="py-1.5 px-2">
                    <span className={r.direction === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'}>
                      {r.direction === 'BULLISH' ? '↑' : r.direction === 'BEARISH' ? '↓' : '·'}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right text-slate-300 tabular-nums">
                    {r.entryPrice?.toFixed(2) ?? '—'}{r.exitPrice ? ' → ' + r.exitPrice.toFixed(2) : ''}
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="flex gap-0.5 justify-center">
                      <span className={`px-1 py-0.5 rounded border text-[9px] ${cellClass(r.generatedAt ? 'ok' : 'none')}`} title={'generated ' + fmtTime(r.generatedAt)}>GEN</span>
                      <span className={`px-1 py-0.5 rounded border text-[9px] ${cellClass(r.enriched ? 'ok' : 'none')}`} title={r.optionScripCode ? 'option ' + r.optionScripCode : 'not enriched'}>ENR</span>
                      <span className={`px-1 py-0.5 rounded border text-[9px] ${cellClass(r.receivedAt ? 'ok' : 'none')}`} title={'received ' + fmtTime(r.receivedAt)}>RCV</span>
                      <span className={`px-1 py-0.5 rounded border text-[9px] ${cellClass(batchStatus(r.batchOutcome))}`} title={(r.batchOutcome ?? '—') + (r.batchReason ? ': ' + r.batchReason : '')}>BAT</span>
                      <span className={`px-1 py-0.5 rounded border text-[9px] ${cellClass(execStatus(r.executionOutcome))}`} title={(r.executionOutcome ?? '—') + (r.rejectReason ? ': ' + r.rejectReason : '')}>EXE</span>
                      <span className={`px-1 py-0.5 rounded border text-[9px] ${cellClass(exitStatus(r.exitReason, r.realizedPnl))}`} title={'exit ' + (r.exitReason ?? '—')}>EXT</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-slate-400">{r.batchOutcome ?? '—'}</td>
                  <td className="py-1.5 px-2 text-slate-400">{r.executionOutcome ?? '—'}</td>
                  <td className="py-1.5 px-2 text-slate-400">{r.exitReason ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtPnl(r.realizedPnl, r.realizedPnlPct)}</td>
                  <td className="py-1.5 px-2 text-right text-slate-500 tabular-nums">{r.receiveLagMs != null ? `${r.receiveLagMs}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
