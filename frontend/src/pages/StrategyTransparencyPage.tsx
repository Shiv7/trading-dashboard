import React, { useEffect, useState } from 'react';
import {
  RefreshCw, Filter, Activity, Eye, Target, BarChart2,
  Zap, CheckCircle2, Volume2
} from 'lucide-react';
import { StrategyCard, OpportunitiesPanel, StrategyTabContent, FudkiiTabContent, FukaaTabContent, PivotTabContent } from '../components/Strategy';
import {
  InstrumentStateSnapshot,
  StrategyOpportunity,
  StrategyStateStats
} from '../types/strategy';
import { fetchJson } from '../services/api';

type FilterState = 'ALL' | 'WATCHING' | 'READY' | 'POSITIONED';
type TabType = 'overview' | 'fudkii' | 'fukaa' | 'pivot' | 'microalpha';

export const StrategyTransparencyPage: React.FC = () => {
  const [states, setStates] = useState<InstrumentStateSnapshot[]>([]);
  const [opportunities, setOpportunities] = useState<StrategyOpportunity[]>([]);
  const [, setStats] = useState<StrategyStateStats | null>(null);
  const [filter, setFilter] = useState<FilterState>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

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
      interval = setInterval(fetchData, 5000);
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
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-6 h-6 text-blue-400" />
              <h1 className="text-xl font-bold">Strategy Transparency</h1>
            </div>

            <div className="flex items-center gap-4">
              {/* State Counts */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-yellow-400" />
                  <span className="text-slate-400">Watching:</span>
                  <span className="font-mono text-yellow-400">{watchingCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <span className="text-slate-400">Ready:</span>
                  <span className="font-mono text-green-400">{readyCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-blue-400" />
                  <span className="text-slate-400">Positioned:</span>
                  <span className="font-mono text-blue-400">{positionedCount}</span>
                </div>
              </div>

              {/* Auto-refresh toggle */}
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
                  autoRefresh ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                Live
              </button>

              {/* Manual refresh */}
              <button
                onClick={fetchData}
                className="p-2 hover:bg-slate-700 rounded transition-colors"
                disabled={loading}
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-blue-400' : 'text-slate-400'}`} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4">
            {[
              { id: 'overview' as TabType, label: 'Overview', icon: BarChart2 },
              { id: 'fudkii' as TabType, label: 'FUDKII', icon: Zap, accent: 'text-orange-400' },
              { id: 'fukaa' as TabType, label: 'FUKAA', icon: Volume2, accent: 'text-amber-400' },
              { id: 'pivot' as TabType, label: 'PIVOT', icon: Target, accent: 'text-purple-400' },
              { id: 'microalpha' as TabType, label: 'MICROALPHA', icon: Activity, accent: 'text-cyan-400' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-t text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white border-t border-l border-r border-slate-700'
                    : 'bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                <tab.icon className={`w-4 h-4 ${activeTab === tab.id && tab.accent ? tab.accent : ''}`} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
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

        {activeTab === 'pivot' && (
          <PivotTabContent autoRefresh={autoRefresh} />
        )}

        {activeTab === 'microalpha' && (
          <StrategyTabContent
            strategyId="MICROALPHA"
            states={states}
          />
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
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    {/* Left Column - Instrument States */}
    <div className="lg:col-span-2 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-medium text-slate-300 flex items-center gap-2">
          <BarChart2 className="w-5 h-5" />
          {filter === 'WATCHING' ? 'Watching Instruments' : `Instruments (${filter})`}
        </h2>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterState)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm"
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
        displayedStates.map((snapshot, idx) => (
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

export default StrategyTransparencyPage;
