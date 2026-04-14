import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Filter, Activity, Eye, BarChart2,
  Zap, CheckCircle2, Volume2, TrendingUp, ExternalLink
} from 'lucide-react';
import { isAnyMarketOpen } from '../utils/tradingUtils';
import { StrategyCard, OpportunitiesPanel, FudkiiTabContent, FukaaTabContent, FudkoiTabContent, PivotTabContent, MicroAlphaTabContent, MereTabContent, McxBb30TabContent, McxBb15TabContent, NseBb30TabContent, RetestTabContent } from '../components/Strategy';
import {
  InstrumentStateSnapshot,
  StrategyOpportunity,
  StrategyStateStats
} from '../types/strategy';
import { fetchJson } from '../services/api';

type FilterState = 'ALL' | 'WATCHING' | 'READY' | 'POSITIONED';
type TabType = 'overview' | 'fudkii' | 'fukaa' | 'fudkoi' | 'retest' | 'pivot' | 'microalpha' | 'mere' | 'hotstocks' | 'mcxbb15' | 'mcxbb30' | 'nsebb30';

export const StrategyTransparencyPage: React.FC = () => {
  const [states, setStates] = useState<InstrumentStateSnapshot[]>([]);
  const [opportunities, setOpportunities] = useState<StrategyOpportunity[]>([]);
  const [, setStats] = useState<StrategyStateStats | null>(null);
  const [filter, setFilter] = useState<FilterState>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('fudkii');

  const fetchData = async () => {
    try {
      setError(null);

      const statesPath = filter === 'WATCHING'
        ? '/strategy-state/watching'
        : '/strategy-state';

      const [statesData, opportunitiesData, statsData] = await Promise.all([
        fetchJson<InstrumentStateSnapshot[]>(statesPath),
        fetchJson<StrategyOpportunity[]>('/strategy-state/opportunities?limit=20'),
        fetchJson<StrategyStateStats>('/strategy-state/stats'),
      ]);

      // Apply additional filter if needed
      let filteredStates = statesData;
      if (filter !== 'ALL' && filter !== 'WATCHING') {
        filteredStates = statesData.filter((s: InstrumentStateSnapshot) => s.state === filter);
      }

      setStates(filteredStates);
      setOpportunities(opportunitiesData);
      setStats(statsData);
    } catch (err) {
      console.error('Error fetching strategy state:', err);
      setError('Failed to load strategy data. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Auto-refresh every 5 seconds
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(() => { if (isAnyMarketOpen()) fetchData(); }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [filter, autoRefresh]);

  const handleInstrumentSelect = (scripCode: string) => {
    const element = document.getElementById(`strategy-card-${scripCode}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Derive state counts from states array
  const watchingCount = states.filter(s => s.state === 'WATCHING').length;
  const readyCount = states.filter(s => s.state === 'READY').length;
  const positionedCount = states.filter(s => s.state === 'POSITIONED').length;

  return (
    <div className="bg-slate-900 text-slate-100 mobile-page-bottom">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400 shrink-0" />
              <h1 className="text-base sm:text-xl font-bold truncate">Kotsin Strategies</h1>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              {/* State Counts — compact on mobile */}
              <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm">
                <div className="flex items-center gap-1 sm:gap-2">
                  <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-400" />
                  <span className="hidden sm:inline text-slate-400">Watching:</span>
                  <span className="font-mono text-yellow-400">{watchingCount}</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400" />
                  <span className="hidden sm:inline text-slate-400">Ready:</span>
                  <span className="font-mono text-green-400">{readyCount}</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <BarChart2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
                  <span className="hidden sm:inline text-slate-400">Positioned:</span>
                  <span className="font-mono text-blue-400">{positionedCount}</span>
                </div>
              </div>

              {/* Auto-refresh toggle */}
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded text-[10px] sm:text-sm ${
                  autoRefresh ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                }`}
              >
                <div className={`w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className="hidden sm:inline">Live</span>
              </button>

              {/* Manual refresh */}
              <button
                onClick={fetchData}
                className="p-1.5 sm:p-2 hover:bg-slate-700 rounded transition-colors"
                disabled={loading}
              >
                <RefreshCw className={`w-4 sm:w-5 h-4 sm:h-5 ${loading ? 'animate-spin text-blue-400' : 'text-slate-400'}`} />
              </button>
            </div>
          </div>

          {/* Tabs — scrollable on mobile */}
          <div className="flex gap-0.5 sm:gap-1 mt-3 sm:mt-4 overflow-x-auto">
            {[
              { id: 'fudkii' as TabType, label: 'FUDKII', shortLabel: 'FUDKII', icon: Zap, accent: 'text-orange-400' },
              { id: 'fukaa' as TabType, label: 'FUKAA', shortLabel: 'FUKAA', icon: Volume2, accent: 'text-amber-400' },
              { id: 'fudkoi' as TabType, label: 'FUDKOI', shortLabel: 'FUDKOI', icon: BarChart2, accent: 'text-teal-400' },
              { id: 'retest' as TabType, label: 'RETEST', shortLabel: 'RETEST', icon: RefreshCw, accent: 'text-violet-400' },
              { id: 'mere' as TabType, label: 'MERE', shortLabel: 'MERE', icon: TrendingUp, accent: 'text-emerald-400' },
              { id: 'microalpha' as TabType, label: 'MICROALPHA', shortLabel: 'MA', icon: Activity, accent: 'text-cyan-400' },
              { id: 'hotstocks' as TabType, label: 'HOTSTOCKS', shortLabel: 'HS', icon: TrendingUp, accent: 'text-pink-400' },
              // PIVOT suspended 2026-04-02
              // { id: 'pivot' as TabType, label: 'PIVOT', shortLabel: 'PIVOT', icon: Target, accent: 'text-purple-400' },
              { id: 'mcxbb15' as TabType, label: 'MCX-BB-15', shortLabel: 'BB-15', icon: TrendingUp, accent: 'text-lime-400' },
              { id: 'mcxbb30' as TabType, label: 'MCX-BB-30', shortLabel: 'BB-30', icon: TrendingUp, accent: 'text-emerald-400' },
              { id: 'nsebb30' as TabType, label: 'NSE-BB-30', shortLabel: 'NSE-BB', icon: TrendingUp, accent: 'text-sky-400' },
              { id: 'overview' as TabType, label: 'Overview', shortLabel: 'Overview', icon: BarChart2 },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-t text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white border-t border-l border-r border-slate-700'
                    : 'bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                <tab.icon className={`w-3.5 sm:w-4 h-3.5 sm:h-4 ${activeTab === tab.id && tab.accent ? tab.accent : ''}`} />
                <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-1.5 sm:px-4 py-3 sm:py-6">
        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6 text-red-400">
            {error}
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <OverviewTab
            states={states}
            opportunities={opportunities}
            filter={filter}
            setFilter={setFilter}
            loading={loading}
            onInstrumentSelect={handleInstrumentSelect}
          />
        )}

        {activeTab === 'fudkii' && (
          <FudkiiTabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'fukaa' && (
          <FukaaTabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'fudkoi' && (
          <FudkoiTabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'retest' && (
          <RetestTabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'pivot' && (
          <PivotTabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'microalpha' && (
          <MicroAlphaTabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'mere' && (
          <MereTabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'hotstocks' && (
          <HotStocksTabContent />
        )}

        {activeTab === 'mcxbb15' && (
          <McxBb15TabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'mcxbb30' && (
          <McxBb30TabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'nsebb30' && (
          <NseBb30TabContent autoRefresh={autoRefresh} />
        )}
      </div>
    </div>
  );
};

// Overview Tab Component
const OverviewTab: React.FC<{
  states: InstrumentStateSnapshot[];
  opportunities: StrategyOpportunity[];
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  loading: boolean;
  onInstrumentSelect: (scripCode: string) => void;
}> = ({ states, opportunities, filter, setFilter, loading, onInstrumentSelect }) => {
  const displayedStates = states;

  return (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
    {/* Left Column - Instrument States */}
    <div className="lg:col-span-2 space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h2 className="text-sm sm:text-lg font-medium text-slate-300 flex items-center gap-1.5 sm:gap-2 min-w-0">
          <BarChart2 className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
          <span className="truncate">{filter === 'WATCHING' ? 'Watching' : `Instruments (${filter})`}</span>
        </h2>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterState)}
            className="bg-slate-700 border border-slate-600 rounded px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm"
          >
            <option value="ALL">All</option>
            <option value="WATCHING">Watching</option>
            <option value="READY">Ready</option>
            <option value="POSITIONED">Positioned</option>
          </select>
        </div>
      </div>

      {loading && displayedStates.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
          Loading strategy states...
        </div>
      ) : displayedStates.length === 0 ? (
        <div className="text-center py-12 text-slate-500 bg-slate-800 rounded-lg border border-slate-700">
          No instruments in {filter} state
        </div>
      ) : (
        displayedStates.map((snapshot) => (
          <div key={snapshot.scripCode} id={`strategy-card-${snapshot.scripCode}`}>
            <StrategyCard
              snapshot={snapshot}
              defaultExpanded={displayedStates.length <= 3}
            />
          </div>
        ))
      )}
    </div>

    {/* Right Column - Opportunities */}
    <div className="lg:col-span-1">
      <div className="sticky top-24">
        <OpportunitiesPanel
          opportunities={opportunities}
          onSelect={onInstrumentSelect}
          maxItems={10}
        />
      </div>
    </div>
  </div>
  );
};

// HotStocks Tab — two sections:
//   1. Tomorrow's Candidates — top v2-scored picks from /hot-stocks
//   2. Open Positions — current HOTSTOCKS positions from /wallet/positions
const HotStocksTabContent: React.FC = () => {
  const [positions, setPositions] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [posData, candData]: any = await Promise.all([
          fetchJson('/wallet/positions'),
          fetchJson('/hot-stocks'),
        ]);
        if (!alive) return;
        const posArr = Array.isArray(posData) ? posData : (posData?.positions || []);
        setPositions(posArr.filter((p: any) => {
          const s = (p.strategy || p.signalSource || p.signalId || '').toString().toUpperCase();
          return s === 'HOTSTOCKS' || s.includes('HOTSTOCK');
        }));
        const candArr = (candData?.fno || []).concat(candData?.nonFno || []);
        setCandidates(candArr);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Failed to load HotStocks data');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-pink-500/10 border border-pink-500/30 rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-pink-400 font-semibold text-sm">HOTSTOCKS Strategy</div>
          <div className="text-xs text-slate-400 mt-1">
            Daily-refreshed F&amp;O leaderboard. Enrichment runs at 5:45 AM IST every weekday.
          </div>
        </div>
        <Link
          to="/hot-stocks"
          className="flex items-center gap-1.5 text-pink-400 hover:text-pink-300 text-xs font-medium px-3 py-2 bg-pink-500/10 hover:bg-pink-500/20 rounded-lg transition-colors"
        >
          Full Page <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Tomorrow's Candidates — v2-scored top picks */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <div className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <span>Tomorrow's Candidates ({candidates.length})</span>
          <span className="text-[10px] text-slate-500 font-normal">v2 signed score • fresh from last enrichment</span>
        </div>
        {loading ? (
          <div className="text-slate-400 text-xs">Loading…</div>
        ) : candidates.length === 0 ? (
          <div className="text-slate-500 italic text-xs">No candidates enriched yet — run 5:45 AM cron or <code>POST /api/hot-stocks/admin/run-enrichment</code></div>
        ) : (
          <div className="space-y-2">
            {candidates.map((c: any) => {
              const v2 = c.v2Score;
              const tier = c.v2Tier || (c.fnoEligible ? 'FNO' : 'NON_FNO');
              const net = c.v2NetInstitutionalCr ?? 0;
              const oi = c.v2OiChange5dPct;
              const c5 = c.change5dPct ?? 0;
              const w52 = c.weekly52PositionPct ?? 0;
              const clamps = c.v2Clamps || [];
              return (
                <div key={c.scripCode || c.symbol}
                  className="flex items-center justify-between bg-slate-900/40 rounded-lg px-3 py-2 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-semibold text-white truncate">{c.symbol}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      tier === 'FNO' ? 'bg-pink-500/20 text-pink-400' : 'bg-indigo-500/20 text-indigo-400'
                    }`}>{tier}</span>
                    {v2 != null && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        v2 >= 50 ? 'bg-emerald-500/20 text-emerald-300' :
                        v2 >= 30 ? 'bg-emerald-500/10 text-emerald-400' :
                        v2 <= -20 ? 'bg-red-500/20 text-red-400' : 'bg-slate-700/50 text-slate-400'
                      }`}>{v2 >= 0 ? '+' : ''}{v2}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-400 shrink-0">
                    <span>P5d: <span className={c5 >= 0 ? 'text-emerald-400' : 'text-red-400'}>{c5 >= 0 ? '+' : ''}{c5.toFixed(1)}%</span></span>
                    {oi != null && <span>OI: <span className={oi >= 0 ? 'text-emerald-400' : 'text-red-400'}>{oi >= 0 ? '+' : ''}{oi.toFixed(1)}%</span></span>}
                    <span>52w: {w52.toFixed(0)}%</span>
                    {net !== 0 && <span>Net: <span className={net >= 0 ? 'text-emerald-400' : 'text-red-400'}>{net >= 0 ? '+' : ''}{net.toFixed(0)}Cr</span></span>}
                    {clamps.length > 0 && <span className="text-amber-400">⚠ {clamps.join(',')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <div className="text-sm font-semibold text-slate-200 mb-3">
          Positions ({positions.length})
          {positions.length > 0 && (
            <span className="text-xs text-slate-400 font-normal ml-2">
              {positions.filter(p => p.status === 'ACTIVE').length} active · {positions.filter(p => p.status !== 'ACTIVE').length} closed
            </span>
          )}
        </div>
        {loading ? (
          <div className="text-slate-400 text-xs">Loading…</div>
        ) : error ? (
          <div className="text-red-400 text-xs">ERR {error}</div>
        ) : positions.length === 0 ? (
          <div className="text-slate-500 italic text-xs">No open HOTSTOCKS positions</div>
        ) : (
          <div className="space-y-2">
            {positions.map((p: any) => {
              const sym = p.companyName || p.underlyingSymbol || p.symbol || p.scripCode;
              const entry = Number(p.avgEntryPrice ?? p.avgEntry ?? 0);
              const cur = Number(p.currentPrice ?? 0);
              const pnl = Number(p.unrealizedPnl ?? 0);
              const pnlPct = Number(p.unrealizedPnlPercent ?? 0);
              const qty = Number(p.quantity ?? p.qtyOpen ?? p.qty ?? 0);
              const pnlPositive = pnl >= 0;
              return (
                <div
                  key={p.positionId || p.scripCode || sym}
                  className="flex items-center justify-between bg-slate-900/40 rounded-lg px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-white">{sym}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      p.status === 'ACTIVE'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-slate-500/20 text-slate-400'
                    }`}>{p.status || 'UNKNOWN'}</span>
                    <span className="text-slate-400">{qty}× @ {entry.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-300">{cur > 0 ? cur.toFixed(2) : '—'}</span>
                    <span className={pnlPositive ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {pnlPositive ? '+' : ''}{pnl.toFixed(0)} ({pnlPositive ? '+' : ''}{pnlPct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategyTransparencyPage;
