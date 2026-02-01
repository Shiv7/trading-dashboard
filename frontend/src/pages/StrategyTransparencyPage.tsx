import React, { useEffect, useState } from 'react';
import { RefreshCw, Filter, Activity, Eye, Target, BarChart2 } from 'lucide-react';
import { StrategyCard, OpportunitiesPanel } from '../components/Strategy';
import {
  InstrumentStateSnapshot,
  StrategyOpportunity,
  StrategyStateStats
} from '../types/strategy';

// API base URL
const API_BASE = import.meta.env.VITE_API_URL || 'http://3.111.242.49:8085';

type FilterState = 'ALL' | 'WATCHING' | 'READY' | 'POSITIONED';

export const StrategyTransparencyPage: React.FC = () => {
  const [states, setStates] = useState<InstrumentStateSnapshot[]>([]);
  const [opportunities, setOpportunities] = useState<StrategyOpportunity[]>([]);
  const [stats, setStats] = useState<StrategyStateStats | null>(null);
  const [filter, setFilter] = useState<FilterState>('WATCHING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = async () => {
    try {
      setError(null);

      // Fetch based on filter
      const statesUrl = filter === 'WATCHING'
        ? `${API_BASE}/api/strategy-state/watching`
        : `${API_BASE}/api/strategy-state`;

      const [statesRes, opportunitiesRes, statsRes] = await Promise.all([
        fetch(statesUrl),
        fetch(`${API_BASE}/api/strategy-state/opportunities?limit=20`),
        fetch(`${API_BASE}/api/strategy-state/stats`)
      ]);

      if (!statesRes.ok || !opportunitiesRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const statesData = await statesRes.json();
      const opportunitiesData = await opportunitiesRes.json();
      const statsData = await statsRes.json();

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
    let interval: NodeJS.Timeout | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchData, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [filter, autoRefresh]);

  const handleInstrumentSelect = (scripCode: string) => {
    // Find the instrument and ensure it's expanded
    const element = document.getElementById(`strategy-card-${scripCode}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-6 h-6 text-blue-400" />
              <h1 className="text-xl font-bold">Strategy Transparency</h1>
            </div>

            <div className="flex items-center gap-4">
              {/* Stats */}
              {stats && (
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-yellow-400" />
                    <span className="text-gray-400">Watching:</span>
                    <span className="font-mono text-yellow-400">{stats.watchingInstruments}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-green-400" />
                    <span className="text-gray-400">Opportunities:</span>
                    <span className="font-mono text-green-400">{stats.highScoreOpportunities}</span>
                  </div>
                </div>
              )}

              {/* Filter */}
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as FilterState)}
                  className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm"
                >
                  <option value="WATCHING">Watching</option>
                  <option value="ALL">All</option>
                  <option value="READY">Ready</option>
                  <option value="POSITIONED">Positioned</option>
                </select>
              </div>

              {/* Auto-refresh toggle */}
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
                  autoRefresh ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
                Live
              </button>

              {/* Manual refresh */}
              <button
                onClick={fetchData}
                className="p-2 hover:bg-gray-700 rounded transition-colors"
                disabled={loading}
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-blue-400' : 'text-gray-400'}`} />
              </button>
            </div>
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Instrument States */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-medium text-gray-300 flex items-center gap-2">
                <BarChart2 className="w-5 h-5" />
                {filter === 'WATCHING' ? 'Watching Instruments' : `Instruments (${filter})`}
              </h2>
              <span className="text-sm text-gray-500">
                {states.length} instruments
              </span>
            </div>

            {loading && states.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
                Loading strategy states...
              </div>
            ) : states.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-gray-800 rounded-lg border border-gray-700">
                No instruments in {filter} state
              </div>
            ) : (
              states.map((snapshot) => (
                <div key={snapshot.scripCode} id={`strategy-card-${snapshot.scripCode}`}>
                  <StrategyCard
                    snapshot={snapshot}
                    defaultExpanded={states.length <= 3}
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
                onSelect={handleInstrumentSelect}
                maxItems={10}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StrategyTransparencyPage;
