import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { API_BASE } from '../../services/api';
import { LiquiditySourceBadge } from './SignalBadges';
import { RetestStagePanel } from './RetestStagePanel';

interface RetestSignal {
  scripCode: string;
  symbol: string;
  companyName: string;
  exchange: string;
  direction: string;
  triggerPrice: number;
  stopLoss: number;
  retestLevel: number;
  retestSource: string;
  retestStage: string;
  retestLevelScore: number;
  retestDistancePct: number;
  atr30m: number;
  target1?: number;
  target2?: number;
  target3?: number;
  tradeGrade?: string;
  riskReward?: number;
  confluenceRR?: number;
  triggerTime: string;
  triggerTimeEpoch: number;
  // RT Score
  rtScore?: number;
  rtScoreLabel?: string;
  // Narrative
  narrative?: string;
  // Fortress
  fortressScore?: number;
  fortressLevels?: string;
  fortressLevelCount?: number;
  roomRatio?: number;
  zoneCount?: number;
  entryQualityDesc?: string;
  // Volume / Block
  volumeSurge?: number;
  blockTradePct?: number;
  blockTradeFlowLabel?: string;
  // VIX
  indiaVix?: number;
  vixRegime?: string;
  // Multi-level retest
  retestLevelCount?: number;
  retestAllLevels?: string;
  // Option
  optionAvailable?: boolean;
  optionSymbol?: string;
  optionStrike?: number;
  optionType?: string;
  optionLtp?: number;
  optionExpiry?: string;
  cachedAt?: number;
  // Liquidity source
  liquiditySource?: string;
}

interface RetestTabContentProps {
  autoRefresh?: boolean;
}

export function RetestTabContent({ autoRefresh = true }: RetestTabContentProps) {
  const [signals, setSignals] = useState<RetestSignal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/strategy-state/retest/all-latest`);
      if (res.ok) {
        const data = await res.json();
        data.sort((a: RetestSignal, b: RetestSignal) => (b.rtScore || 0) - (a.rtScore || 0) || (b.triggerTimeEpoch || 0) - (a.triggerTimeEpoch || 0));
        setSignals(data);
      }
    } catch (err) {
      console.error('Failed to fetch retest signals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (autoRefresh) {
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
  }, [fetchData, autoRefresh]);

  const fmtNum = (n?: number) => n != null && n !== 0 ? n.toFixed(2) : 'DM';
  const fmtTime = (t?: string) => {
    if (!t) return 'DM';
    try {
      const d = new Date(t);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return t; }
  };

  const exchangeLabel = (e: string) => e === 'N' ? 'NSE' : e === 'M' ? 'MCX' : e === 'C' ? 'CDS' : e;

  const rtScoreColor = (score?: number) => {
    if (!score) return 'text-slate-500';
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-cyan-400';
    if (score >= 40) return 'text-amber-400';
    return 'text-red-400';
  };

  const rtScoreBg = (score?: number) => {
    if (!score) return 'bg-slate-700/30';
    if (score >= 80) return 'bg-emerald-500/15 border-emerald-500/30';
    if (score >= 60) return 'bg-cyan-500/15 border-cyan-500/30';
    if (score >= 40) return 'bg-amber-500/15 border-amber-500/30';
    return 'bg-red-500/15 border-red-500/30';
  };

  if (loading) {
    return <div className="text-center py-8 text-slate-500">Loading retest signals...</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-300">RETEST Signals</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/30">
            {signals.length} signals
          </span>
        </div>
        <button onClick={fetchData} className="p-1.5 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {signals.length === 0 ? (
        <div className="text-center py-12 text-slate-600 text-sm">No retest signals today</div>
      ) : (
        <div className="grid gap-2">
          {signals.map((sig) => {
            const isBull = sig.direction === 'BULLISH';
            return (
              <div key={sig.scripCode + '-' + sig.triggerTimeEpoch}
                className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 hover:border-slate-600/50 transition-colors">

                {/* Row 1: Name + Direction + RT Score + Grade + Exchange + Time */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{sig.companyName || sig.symbol}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      isBull ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                             : 'bg-red-500/15 text-red-400 border border-red-500/30'
                    }`}>{sig.direction}</span>

                    {/* RT Score Badge */}
                    {sig.rtScore != null && (
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${rtScoreBg(sig.rtScore)} ${rtScoreColor(sig.rtScore)}`}>
                        RT {sig.rtScore.toFixed(0)} {sig.rtScoreLabel}
                      </span>
                    )}

                    {sig.tradeGrade && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        sig.tradeGrade === 'A' ? 'bg-emerald-500/15 text-emerald-400' :
                        sig.tradeGrade === 'B' ? 'bg-amber-500/15 text-amber-400' :
                        'bg-slate-700/50 text-slate-400'
                      }`}>{sig.tradeGrade}</span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                      {exchangeLabel(sig.exchange)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">{fmtTime(sig.triggerTime)}</span>
                </div>

                {/* Row 2: Narrative (human-readable insight) */}
                {sig.narrative && (
                  <div className="mb-2 text-[11px] text-slate-300 bg-slate-900/50 rounded px-2 py-1.5 border border-slate-700/30 italic">
                    {sig.narrative}
                  </div>
                )}

                {/* Row 3: Retest Level + Multi-level */}
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/30 font-medium">
                    {sig.retestSource} ({sig.retestStage?.replace('_', ' ')})
                  </span>
                  {sig.retestLevelCount != null && sig.retestLevelCount > 1 && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30">
                      {sig.retestLevelCount} levels retesting
                    </span>
                  )}
                  {sig.retestDistancePct != null && sig.retestDistancePct > 0 && (
                    <span className="text-[10px] text-slate-500">dist: {sig.retestDistancePct.toFixed(1)}%</span>
                  )}
                </div>

                {/* Row 3b: Per-stage outcome panel — green/red/grey cells with staleness */}
                <div className="mb-2 bg-slate-900/40 rounded px-2 py-1.5 border border-slate-700/30">
                  <RetestStagePanel scripCode={sig.scripCode} autoRefresh={autoRefresh} compact />
                </div>

                {/* Row 4: Fortress / Confluence */}
                {(sig.fortressScore != null && sig.fortressScore >= 6) && (
                  <div className="mb-2 text-[10px]">
                    <span className={`px-2 py-0.5 rounded font-medium ${
                      sig.fortressScore >= 10 ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    }`}>
                      {sig.fortressScore >= 10 ? 'FORTRESS' : 'CONFLUENCE'} ({sig.fortressScore.toFixed(0)}pt)
                    </span>
                    {sig.fortressLevels && (
                      <span className="ml-2 text-slate-400">{sig.fortressLevels}</span>
                    )}
                    {sig.zoneCount != null && sig.zoneCount > 0 && (
                      <span className="ml-2 text-slate-500">{sig.zoneCount} zones</span>
                    )}
                    {sig.roomRatio != null && sig.roomRatio > 0 && (
                      <span className={`ml-2 ${sig.roomRatio >= 1.5 ? 'text-emerald-400' : sig.roomRatio >= 1.0 ? 'text-amber-400' : 'text-red-400'}`}>
                        Room: {sig.roomRatio.toFixed(1)}x
                      </span>
                    )}
                  </div>
                )}

                {/* Row 5: Volume / Block Trade / VIX */}
                <div className="mb-2 flex flex-wrap gap-x-3 text-[10px]">
                  {sig.volumeSurge != null && sig.volumeSurge > 0 && (
                    <span className={`${sig.volumeSurge >= 2 ? 'text-emerald-400' : 'text-slate-400'}`}>
                      Vol: {sig.volumeSurge.toFixed(1)}x
                    </span>
                  )}
                  {sig.blockTradeFlowLabel && sig.blockTradeFlowLabel !== 'NONE' && (
                    <span className="text-cyan-400">
                      {sig.blockTradeFlowLabel.replace(/_/g, ' ')} ({sig.blockTradePct?.toFixed(0)}%)
                    </span>
                  )}
                  {sig.indiaVix != null && sig.indiaVix > 0 && (
                    <span className={`${
                      sig.vixRegime === 'HIGH_FEAR' ? 'text-red-400' :
                      sig.vixRegime === 'ELEVATED' ? 'text-amber-400' : 'text-emerald-400'
                    }`}>
                      VIX: {sig.indiaVix.toFixed(1)} ({sig.vixRegime?.replace('_', ' ')})
                    </span>
                  )}
                </div>

                {/* Row 6: Prices */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-slate-500">Entry: <span className="text-white font-medium">{fmtNum(sig.triggerPrice)}</span></span>
                  <span className="text-slate-500">SL: <span className="text-red-400 font-medium">{fmtNum(sig.stopLoss)}</span></span>
                  <span className="text-slate-500">T1: <span className="text-emerald-400 font-medium">{fmtNum(sig.target1)}</span></span>
                  <span className="text-slate-500">T2: <span className="text-emerald-400 font-medium">{fmtNum(sig.target2)}</span></span>
                  {(sig.confluenceRR || sig.riskReward) != null && (sig.confluenceRR || sig.riskReward || 0) > 0 && (
                    <span className="text-slate-500">R:R: <span className="text-white font-medium">{((sig.confluenceRR || sig.riskReward) ?? 0).toFixed(1)}</span></span>
                  )}
                  <span className="text-slate-500">ATR: <span className="text-amber-400 font-medium">{fmtNum(sig.atr30m)}</span></span>
                </div>

                {/* Row 7: All retested levels (when multiple) */}
                {sig.retestAllLevels && sig.retestLevelCount != null && sig.retestLevelCount > 1 && (
                  <div className="mt-1.5 text-[9px] text-slate-500 border-t border-slate-700/30 pt-1">
                    All levels: {sig.retestAllLevels}
                  </div>
                )}

                {/* Row 8: Option info */}
                {sig.optionAvailable && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-slate-500 items-center">
                    <span>Option: <span className="text-cyan-400">{sig.optionSymbol || `${sig.optionStrike} ${sig.optionType}`}</span></span>
                    <LiquiditySourceBadge source={sig.liquiditySource} />
                    {sig.optionLtp != null && sig.optionLtp > 0 && (
                      <span>LTP: <span className="text-white">{sig.optionLtp.toFixed(2)}</span></span>
                    )}
                    {sig.optionExpiry && <span>Exp: <span className="text-slate-400">{sig.optionExpiry}</span></span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
