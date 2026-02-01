import React, { useEffect, useState } from 'react';
import {
  RefreshCw, Filter, Activity, Eye, Target, BarChart2,
  Zap, TrendingUp, TrendingDown, ChevronRight, AlertCircle,
  Circle, ArrowRight, CheckCircle2, XCircle, Clock
} from 'lucide-react';
import { StrategyCard, OpportunitiesPanel } from '../components/Strategy';
import {
  InstrumentStateSnapshot,
  StrategyOpportunity,
  StrategyStateStats
} from '../types/strategy';

// API base URL
const API_BASE = import.meta.env.VITE_API_URL || 'http://3.111.242.49:8085';

type FilterState = 'ALL' | 'WATCHING' | 'READY' | 'POSITIONED';
type TabType = 'overview' | 'fudkii' | 'pivot' | 'flow';

interface FudkiiSignal {
  scripCode: string;
  companyName?: string;
  direction: string;
  ignitionFlag: boolean;
  fudkiiStrength: number;
  simultaneityScore: number;
  priceBreaking: boolean;
  volumeSurging: boolean;
  momentumPositive: boolean;
  atrExpanding: boolean;
  flowConfirming: boolean;
  timestamp: string;
}

interface PivotSignal {
  scripCode: string;
  triggered: boolean;
  direction: string;
  score: number;
  htfDirection: string;
  htfStrength: number;
  ltfConfirmed: boolean;
  ltfAlignmentScore: number;
  pivotNearbyLevels: number;
  cprPosition: string;
  smcInOrderBlock: boolean;
  smcNearFVG: boolean;
  riskReward: number;
  entryPrice: number;
  stopLoss: number;
  target: number;
  timestamp: string;
}

interface FlowDiagramData {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    description: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label: string;
    dashed?: boolean;
  }>;
  stateCounts: Record<string, number>;
}

export const StrategyTransparencyPage: React.FC = () => {
  const [states, setStates] = useState<InstrumentStateSnapshot[]>([]);
  const [opportunities, setOpportunities] = useState<StrategyOpportunity[]>([]);
  const [stats, setStats] = useState<StrategyStateStats | null>(null);
  const [filter, setFilter] = useState<FilterState>('WATCHING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Strategy-specific signals
  const [fudkiiSignals, setFudkiiSignals] = useState<FudkiiSignal[]>([]);
  const [pivotSignals, setPivotSignals] = useState<PivotSignal[]>([]);
  const [flowDiagram, setFlowDiagram] = useState<FlowDiagramData | null>(null);

  const fetchData = async () => {
    try {
      setError(null);

      // Fetch based on filter
      const statesUrl = filter === 'WATCHING'
        ? `${API_BASE}/api/strategy-state/watching`
        : `${API_BASE}/api/strategy-state`;

      const [statesRes, opportunitiesRes, statsRes, fudkiiRes, pivotRes, flowRes] = await Promise.all([
        fetch(statesUrl),
        fetch(`${API_BASE}/api/strategy-state/opportunities?limit=20`),
        fetch(`${API_BASE}/api/strategy-state/stats`),
        fetch(`${API_BASE}/api/strategy-state/fudkii/active/list`),
        fetch(`${API_BASE}/api/strategy-state/pivot/active/list`),
        fetch(`${API_BASE}/api/strategy-state/flow-diagram`)
      ]);

      if (!statesRes.ok || !opportunitiesRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const statesData = await statesRes.json();
      const opportunitiesData = await opportunitiesRes.json();
      const statsData = await statsRes.json();
      const fudkiiData = fudkiiRes.ok ? await fudkiiRes.json() : [];
      const pivotData = pivotRes.ok ? await pivotRes.json() : [];
      const flowData = flowRes.ok ? await flowRes.json() : null;

      // Apply additional filter if needed
      let filteredStates = statesData;
      if (filter !== 'ALL' && filter !== 'WATCHING') {
        filteredStates = statesData.filter((s: InstrumentStateSnapshot) => s.state === filter);
      }

      setStates(filteredStates);
      setOpportunities(opportunitiesData);
      setStats(statsData);
      setFudkiiSignals(fudkiiData);
      setPivotSignals(pivotData);
      setFlowDiagram(flowData);
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
                    <Zap className="w-4 h-4 text-orange-400" />
                    <span className="text-gray-400">FUDKII:</span>
                    <span className="font-mono text-orange-400">{fudkiiSignals.length}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-purple-400" />
                    <span className="text-gray-400">Pivot:</span>
                    <span className="font-mono text-purple-400">{pivotSignals.length}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-yellow-400" />
                    <span className="text-gray-400">Watching:</span>
                    <span className="font-mono text-yellow-400">{stats.watchingInstruments}</span>
                  </div>
                </div>
              )}

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

          {/* Tabs */}
          <div className="flex gap-1 mt-4">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart2 },
              { id: 'fudkii', label: 'FUDKII Signals', icon: Zap, count: fudkiiSignals.length },
              { id: 'pivot', label: 'Pivot Confluence', icon: Target, count: pivotSignals.length },
              { id: 'flow', label: 'State Flow', icon: Activity }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 px-4 py-2 rounded-t text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gray-900 text-white border-t border-l border-r border-gray-700'
                    : 'bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    activeTab === tab.id ? 'bg-blue-500' : 'bg-gray-600'
                  }`}>
                    {tab.count}
                  </span>
                )}
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
          <FudkiiTab signals={fudkiiSignals} />
        )}

        {activeTab === 'pivot' && (
          <PivotTab signals={pivotSignals} />
        )}

        {activeTab === 'flow' && (
          <FlowDiagramTab data={flowDiagram} />
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
}> = ({ states, opportunities, filter, setFilter, loading, onInstrumentSelect }) => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    {/* Left Column - Instrument States */}
    <div className="lg:col-span-2 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-medium text-gray-300 flex items-center gap-2">
          <BarChart2 className="w-5 h-5" />
          {filter === 'WATCHING' ? 'Watching Instruments' : `Instruments (${filter})`}
        </h2>
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
            <StrategyCard snapshot={snapshot} defaultExpanded={states.length <= 3} />
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

// FUDKII Tab Component
const FudkiiTab: React.FC<{ signals: FudkiiSignal[] }> = ({ signals }) => (
  <div className="space-y-6">
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h2 className="text-lg font-medium text-orange-400 flex items-center gap-2 mb-4">
        <Zap className="w-5 h-5" />
        FUDKII Strategy (SuperTrend + Bollinger Bands on 30m)
      </h2>
      <p className="text-gray-400 text-sm mb-4">
        Detects momentum ignition when SuperTrend flips direction AND price breaks outside Bollinger Bands.
        5 conditions must align: Price Breaking, Volume Surging, Momentum Positive, ATR Expanding, Flow Confirming.
      </p>
    </div>

    {signals.length === 0 ? (
      <div className="text-center py-12 text-gray-500 bg-gray-800 rounded-lg border border-gray-700">
        <AlertCircle className="w-8 h-8 mx-auto mb-4 text-gray-600" />
        No active FUDKII ignitions detected
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {signals.map((signal) => (
          <FudkiiSignalCard key={signal.scripCode} signal={signal} />
        ))}
      </div>
    )}
  </div>
);

// FUDKII Signal Card
const FudkiiSignalCard: React.FC<{ signal: FudkiiSignal }> = ({ signal }) => {
  const isBullish = signal.direction === 'BULLISH_IGNITION';
  const conditions = [
    { name: 'Price Breaking', passed: signal.priceBreaking },
    { name: 'Volume Surging', passed: signal.volumeSurging },
    { name: 'Momentum Positive', passed: signal.momentumPositive },
    { name: 'ATR Expanding', passed: signal.atrExpanding },
    { name: 'Flow Confirming', passed: signal.flowConfirming },
  ];

  return (
    <div className={`bg-gray-800 rounded-lg border ${
      isBullish ? 'border-green-500/50' : 'border-red-500/50'
    } p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isBullish ? (
            <TrendingUp className="w-5 h-5 text-green-400" />
          ) : (
            <TrendingDown className="w-5 h-5 text-red-400" />
          )}
          <span className="font-semibold text-white">{signal.companyName || signal.scripCode}</span>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          isBullish ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {isBullish ? 'BULLISH' : 'BEARISH'}
        </span>
      </div>

      {/* Strength Meter */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>FUDKII Strength</span>
          <span className="font-mono">{(signal.fudkiiStrength * 100).toFixed(0)}%</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${isBullish ? 'bg-green-500' : 'bg-red-500'}`}
            style={{ width: `${signal.fudkiiStrength * 100}%` }}
          />
        </div>
      </div>

      {/* Conditions */}
      <div className="space-y-1">
        <div className="text-xs text-gray-400 mb-2">
          Conditions Met: {signal.simultaneityScore}/5
        </div>
        {conditions.map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {c.passed ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-gray-600" />
            )}
            <span className={c.passed ? 'text-gray-300' : 'text-gray-600'}>
              {c.name}
            </span>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-500 mt-3">
        {signal.timestamp}
      </div>
    </div>
  );
};

// Pivot Tab Component
const PivotTab: React.FC<{ signals: PivotSignal[] }> = ({ signals }) => (
  <div className="space-y-6">
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h2 className="text-lg font-medium text-purple-400 flex items-center gap-2 mb-4">
        <Target className="w-5 h-5" />
        Pivot Confluence Strategy (HTF/LTF + SMC + Pivot Levels)
      </h2>
      <p className="text-gray-400 text-sm mb-4">
        Pure price action strategy: Higher Timeframe bias (Daily/4H), Lower Timeframe confirmation (15m/5m),
        Pivot level confluence, Smart Money Concept zones (Order Blocks, FVG), and Risk:Reward validation.
      </p>
    </div>

    {signals.length === 0 ? (
      <div className="text-center py-12 text-gray-500 bg-gray-800 rounded-lg border border-gray-700">
        <AlertCircle className="w-8 h-8 mx-auto mb-4 text-gray-600" />
        No active Pivot Confluence triggers detected
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {signals.map((signal) => (
          <PivotSignalCard key={signal.scripCode} signal={signal} />
        ))}
      </div>
    )}
  </div>
);

// Pivot Signal Card
const PivotSignalCard: React.FC<{ signal: PivotSignal }> = ({ signal }) => {
  const isBullish = signal.direction === 'BULLISH';

  return (
    <div className={`bg-gray-800 rounded-lg border ${
      isBullish ? 'border-green-500/50' : 'border-red-500/50'
    } p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isBullish ? (
            <TrendingUp className="w-5 h-5 text-green-400" />
          ) : (
            <TrendingDown className="w-5 h-5 text-red-400" />
          )}
          <span className="font-semibold text-white">{signal.scripCode}</span>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          isBullish ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {signal.direction}
        </span>
      </div>

      {/* Score */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Confluence Score</span>
          <span className="font-mono">{signal.score.toFixed(0)}</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${signal.score >= 70 ? 'bg-green-500' : signal.score >= 50 ? 'bg-yellow-500' : 'bg-orange-500'}`}
            style={{ width: `${Math.min(signal.score, 100)}%` }}
          />
        </div>
      </div>

      {/* MTF Analysis */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-xs text-gray-500">HTF Bias</div>
          <div className={`text-sm font-medium ${
            signal.htfDirection === 'BULLISH' ? 'text-green-400' :
            signal.htfDirection === 'BEARISH' ? 'text-red-400' : 'text-gray-400'
          }`}>
            {signal.htfDirection} ({(signal.htfStrength * 100).toFixed(0)}%)
          </div>
        </div>
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-xs text-gray-500">LTF Confirmed</div>
          <div className={`text-sm font-medium ${signal.ltfConfirmed ? 'text-green-400' : 'text-red-400'}`}>
            {signal.ltfConfirmed ? 'Yes' : 'No'} ({signal.ltfAlignmentScore.toFixed(0)}%)
          </div>
        </div>
      </div>

      {/* Pivot & SMC */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-xs text-gray-500">Pivot Levels</div>
          <div className="text-sm font-mono text-purple-400">{signal.pivotNearbyLevels}</div>
        </div>
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-xs text-gray-500">Order Block</div>
          <div className={`text-sm ${signal.smcInOrderBlock ? 'text-green-400' : 'text-gray-500'}`}>
            {signal.smcInOrderBlock ? 'In Zone' : '-'}
          </div>
        </div>
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-xs text-gray-500">FVG</div>
          <div className={`text-sm ${signal.smcNearFVG ? 'text-green-400' : 'text-gray-500'}`}>
            {signal.smcNearFVG ? 'Near' : '-'}
          </div>
        </div>
      </div>

      {/* Entry Levels */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-gray-500">Entry</span>
          <div className="font-mono text-white">{signal.entryPrice.toFixed(2)}</div>
        </div>
        <div>
          <span className="text-gray-500">Stop</span>
          <div className="font-mono text-red-400">{signal.stopLoss.toFixed(2)}</div>
        </div>
        <div>
          <span className="text-gray-500">Target</span>
          <div className="font-mono text-green-400">{signal.target.toFixed(2)}</div>
        </div>
        <div>
          <span className="text-gray-500">R:R</span>
          <div className={`font-mono ${signal.riskReward >= 2 ? 'text-green-400' : 'text-yellow-400'}`}>
            {signal.riskReward.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
};

// Flow Diagram Tab Component
const FlowDiagramTab: React.FC<{ data: FlowDiagramData | null }> = ({ data }) => {
  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500 bg-gray-800 rounded-lg border border-gray-700">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
        Loading flow diagram...
      </div>
    );
  }

  const nodeStyles: Record<string, { bg: string; border: string; icon: React.ReactNode }> = {
    start: { bg: 'bg-gray-700', border: 'border-gray-600', icon: <Circle className="w-4 h-4" /> },
    progress: { bg: 'bg-yellow-500/20', border: 'border-yellow-500/50', icon: <Clock className="w-4 h-4 text-yellow-400" /> },
    decision: { bg: 'bg-blue-500/20', border: 'border-blue-500/50', icon: <ChevronRight className="w-4 h-4 text-blue-400" /> },
    validation: { bg: 'bg-purple-500/20', border: 'border-purple-500/50', icon: <AlertCircle className="w-4 h-4 text-purple-400" /> },
    success: { bg: 'bg-green-500/20', border: 'border-green-500/50', icon: <CheckCircle2 className="w-4 h-4 text-green-400" /> },
    active: { bg: 'bg-orange-500/20', border: 'border-orange-500/50', icon: <Activity className="w-4 h-4 text-orange-400" /> },
    end: { bg: 'bg-gray-600', border: 'border-gray-500', icon: <XCircle className="w-4 h-4" /> },
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h2 className="text-lg font-medium text-blue-400 flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5" />
          Strategy State Flow Diagram
        </h2>
        <p className="text-gray-400 text-sm">
          Visual representation of signal lifecycle: from IDLE through WATCHING, strategy triggers (FUDKII/Pivot),
          gate validation, to ACTIVE signal and position management.
        </p>
      </div>

      {/* State Counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(data.stateCounts).map(([state, count]) => (
          <div key={state} className="bg-gray-800 rounded-lg border border-gray-700 p-4 text-center">
            <div className="text-2xl font-bold text-white mb-1">{count}</div>
            <div className="text-xs text-gray-400">{state.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      {/* Flow Diagram */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="flex flex-wrap justify-center gap-4">
          {data.nodes.map((node, index) => {
            const style = nodeStyles[node.type] || nodeStyles.start;
            return (
              <React.Fragment key={node.id}>
                <div className={`${style.bg} ${style.border} border rounded-lg p-4 min-w-[160px] text-center`}>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {style.icon}
                    <span className="font-medium text-white">{node.label}</span>
                  </div>
                  <p className="text-xs text-gray-400">{node.description}</p>
                </div>
                {index < data.nodes.length - 1 && (
                  <div className="flex items-center">
                    <ArrowRight className="w-5 h-5 text-gray-600" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-8 border-t border-gray-700 pt-4">
          <h4 className="text-sm font-medium text-gray-400 mb-3">Strategy Triggers</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-orange-400" />
                <span className="font-medium text-orange-400">FUDKII Strategy</span>
              </div>
              <p className="text-xs text-gray-400">
                Triggers when SuperTrend flips direction AND price breaks outside Bollinger Bands on 30m timeframe.
                Evaluates at xx:15 and xx:45 boundaries.
              </p>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-purple-400" />
                <span className="font-medium text-purple-400">Pivot Confluence Strategy</span>
              </div>
              <p className="text-xs text-gray-400">
                Triggers when HTF bias aligns with LTF confirmation, price is at pivot confluence,
                SMC zones support direction, and R:R is favorable.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StrategyTransparencyPage;
