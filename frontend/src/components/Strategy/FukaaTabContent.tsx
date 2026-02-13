import React, { useEffect, useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Volume2 } from 'lucide-react';
import { getStrategyConfig } from '../../types/strategy';
import { fetchJson } from '../../services/api';

interface FukaaTrigger {
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
  fukaaOutcome: string;
  passedCandle: string;
  rank: number;
  volumeTMinus1: number;
  volumeT: number;
  volumeTPlus1: number;
  avgVolume: number;
  surgeTMinus1: number;
  surgeT: number;
  surgeTPlus1: number;
  fukaaEmittedAt: string;
  cachedAt: number;
}

interface FukaaTabContentProps {
  autoRefresh?: boolean;
}

export const FukaaTabContent: React.FC<FukaaTabContentProps> = ({ autoRefresh = true }) => {
  const [triggers, setTriggers] = useState<FukaaTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const config = getStrategyConfig('FUKAA');

  const fetchFukaa = async () => {
    try {
      const data = await fetchJson<FukaaTrigger[]>('/strategy-state/fukaa/active/list');
      setTriggers(data);
    } catch (err) {
      console.error('Error fetching FUKAA triggers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFukaa();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      interval = setInterval(fetchFukaa, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [autoRefresh]);

  const bullish = triggers.filter(t => t.direction === 'BULLISH');
  const bearish = triggers.filter(t => t.direction === 'BEARISH');

  return (
    <div className="space-y-6">
      {/* Strategy Header */}
      <div className={`bg-slate-800 rounded-lg border ${config.accentBorder} p-4`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-lg font-medium ${config.accentText} flex items-center gap-2`}>
            <span className={`px-2 py-0.5 rounded text-sm font-bold ${config.accentBg} ${config.accentText}`}>
              {config.label}
            </span>
            Volume-Confirmed Triggers
          </h2>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-amber-400 font-mono">{triggers.length} active</span>
            <span className="text-green-400 font-mono">{bullish.length} bullish</span>
            <span className="text-red-400 font-mono">{bearish.length} bearish</span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          FUKAA = FUDKII + Volume Surge Filter. Shows FUDKII signals confirmed by volume surge (&gt;2x avg).
        </p>
      </div>

      {/* Loading */}
      {loading && triggers.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
          Loading FUKAA triggers...
        </div>
      )}

      {/* Empty state */}
      {!loading && triggers.length === 0 && (
        <div className="text-center py-12 text-slate-500 bg-slate-800 rounded-lg border border-slate-700">
          No active FUKAA triggers. Waiting for volume-confirmed signals...
        </div>
      )}

      {/* Trigger Cards */}
      {triggers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {triggers.map(trigger => (
            <FukaaCard key={trigger.scripCode} trigger={trigger} />
          ))}
        </div>
      )}
    </div>
  );
};

const FukaaCard: React.FC<{ trigger: FukaaTrigger }> = ({ trigger }) => {
  const isBullish = trigger.direction === 'BULLISH';
  const dirColor = isBullish ? 'text-green-400' : 'text-red-400';
  const dirBg = isBullish ? 'bg-green-500/10' : 'bg-red-500/10';
  const dirBorder = isBullish ? 'border-green-500/30' : 'border-red-500/30';
  const DirIcon = isBullish ? TrendingUp : TrendingDown;

  const displayName = trigger.symbol || trigger.companyName || trigger.scripCode;

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + 'M';
    if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K';
    return vol.toString();
  };

  const formatSurge = (surge: number) => {
    if (surge <= 0) return '-';
    return surge.toFixed(1) + 'x';
  };

  const surgeColor = (surge: number) => {
    if (surge >= 2) return 'text-green-400';
    if (surge >= 1.5) return 'text-yellow-400';
    return 'text-slate-400';
  };

  return (
    <div className={`bg-slate-800 rounded-lg border ${dirBorder} p-4 hover:bg-slate-750 transition-colors`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DirIcon className={`w-4 h-4 ${dirColor}`} />
          <span className="font-medium text-white text-sm">{displayName}</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${dirBg} ${dirColor}`}>
          {trigger.direction}
        </span>
      </div>

      {/* Price + Score */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-xs text-slate-500">Trigger Price</span>
          <div className="text-lg font-mono text-white">{trigger.triggerPrice.toFixed(2)}</div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500">Score</span>
          <div className="text-lg font-mono text-amber-400">{trigger.triggerScore.toFixed(1)}</div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500">Rank</span>
          <div className="text-lg font-mono text-slate-300">{trigger.rank.toFixed(2)}</div>
        </div>
      </div>

      {/* FUKAA Outcome */}
      <div className="bg-slate-900/50 rounded p-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Outcome</span>
          <span className="text-amber-400 font-medium">{trigger.fukaaOutcome}</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-slate-500">Passed Candle</span>
          <span className="text-slate-300">{trigger.passedCandle}</span>
        </div>
      </div>

      {/* Volume Surge */}
      <div className="bg-slate-900/50 rounded p-2 mb-3">
        <div className="flex items-center gap-1 text-xs text-slate-500 mb-1.5">
          <Volume2 className="w-3 h-3" />
          Volume Surge (vs {formatVolume(trigger.avgVolume)} avg)
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center">
            <div className="text-slate-500">T-1</div>
            <div className="font-mono text-slate-300">{formatVolume(trigger.volumeTMinus1)}</div>
            <div className={`font-mono ${surgeColor(trigger.surgeTMinus1)}`}>
              {formatSurge(trigger.surgeTMinus1)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-slate-500">T</div>
            <div className="font-mono text-slate-300">{formatVolume(trigger.volumeT)}</div>
            <div className={`font-mono ${surgeColor(trigger.surgeT)}`}>
              {formatSurge(trigger.surgeT)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-slate-500">T+1</div>
            <div className="font-mono text-slate-300">{formatVolume(trigger.volumeTPlus1)}</div>
            <div className={`font-mono ${surgeColor(trigger.surgeTPlus1)}`}>
              {formatSurge(trigger.surgeTPlus1)}
            </div>
          </div>
        </div>
      </div>

      {/* BB + SuperTrend */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-900/50 rounded p-2">
          <div className="text-slate-500 mb-1">Bollinger</div>
          <div className="flex justify-between">
            <span className="text-red-400">{trigger.bbLower.toFixed(1)}</span>
            <span className="text-slate-400">{trigger.bbMiddle.toFixed(1)}</span>
            <span className="text-green-400">{trigger.bbUpper.toFixed(1)}</span>
          </div>
        </div>
        <div className="bg-slate-900/50 rounded p-2">
          <div className="text-slate-500 mb-1">SuperTrend</div>
          <div className="flex justify-between items-center">
            <span className="font-mono text-slate-300">{trigger.superTrend.toFixed(1)}</span>
            <span className={`px-1 rounded text-[10px] ${
              trigger.trend === 'BULLISH' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {trigger.trend}
            </span>
          </div>
        </div>
      </div>

      {/* Trigger Time */}
      <div className="mt-2 text-[10px] text-slate-600 text-right">
        {trigger.triggerTime}
      </div>
    </div>
  );
};

export default FukaaTabContent;
