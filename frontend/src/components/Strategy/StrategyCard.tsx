import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  AlertTriangle,
  Activity,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import {
  InstrumentStateSnapshot,
  ActiveSetupInfo,
  formatDuration,
  getStateColor,
  getDirectionColor,
  getDirectionBgColor,
  getQualityTierColor
} from '../../types/strategy';
import ConditionsTable from './ConditionsTable';
import MtfAnalysisPanel from './MtfAnalysisPanel';

interface StrategyCardProps {
  snapshot: InstrumentStateSnapshot;
  defaultExpanded?: boolean;
}

export const StrategyCard: React.FC<StrategyCardProps> = ({
  snapshot,
  defaultExpanded = false
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [expandedSetups, setExpandedSetups] = useState<Set<string>>(new Set());

  const toggleSetup = (strategyId: string) => {
    const newSet = new Set(expandedSetups);
    if (newSet.has(strategyId)) {
      newSet.delete(strategyId);
    } else {
      newSet.add(strategyId);
    }
    setExpandedSetups(newSet);
  };

  const priceChange = ((snapshot.currentPrice - snapshot.currentPrice) / snapshot.currentPrice) * 100;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div
        className="p-4 cursor-pointer hover:bg-gray-750 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-white">
                  {snapshot.companyName || snapshot.scripCode}
                </span>
                <span className="text-sm text-gray-500">
                  ({snapshot.scripCode})
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-lg font-mono text-white">
                  {snapshot.currentPrice.toFixed(2)}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStateColor(snapshot.state)}`}>
                  {snapshot.state}
                </span>
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(snapshot.stateDurationMs)}
                </span>
              </div>
            </div>
          </div>

          {/* Quick indicators */}
          <div className="flex items-center gap-4">
            {snapshot.superTrendBullish ? (
              <TrendingUp className="w-5 h-5 text-green-400" title="SuperTrend Bullish" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-400" title="SuperTrend Bearish" />
            )}
            {snapshot.bbSqueezing && (
              <Activity className="w-5 h-5 text-yellow-400" title="BB Squeezing" />
            )}
            {snapshot.activeSetups && snapshot.activeSetups.length > 0 && (
              <span className="text-sm text-gray-400">
                {snapshot.activeSetups.length} setup(s)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-gray-700 p-4 space-y-4">
          {/* Market Data */}
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-900/50 rounded p-2">
              <div className="text-gray-500 text-xs">OFI Z-Score</div>
              <div className={`font-mono ${snapshot.ofiZscore > 0 ? 'text-green-400' : snapshot.ofiZscore < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                {typeof snapshot.ofiZscore === 'number' && !isNaN(snapshot.ofiZscore) ? snapshot.ofiZscore.toFixed(2) : 'N/A'}
              </div>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <div className="text-gray-500 text-xs">ATR</div>
              <div className="font-mono text-gray-300">
                {typeof snapshot.atr === 'number' && !isNaN(snapshot.atr) ? snapshot.atr.toFixed(2) : 'N/A'}
              </div>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <div className="text-gray-500 text-xs">BB %B</div>
              <div className={`font-mono ${Number(snapshot.bbPercentB) > 1 ? 'text-green-400' : Number(snapshot.bbPercentB) < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                {typeof snapshot.bbPercentB === 'number' && !isNaN(snapshot.bbPercentB) ? snapshot.bbPercentB.toFixed(2) : 'N/A'}
              </div>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <div className="text-gray-500 text-xs">Signals Today</div>
              <div className="font-mono text-gray-300">
                {snapshot.signalsToday ?? 0}/{snapshot.maxSignalsPerDay ?? 3}
              </div>
            </div>
          </div>

          {/* Active Setups */}
          {snapshot.activeSetups && snapshot.activeSetups.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-400">Active Setups</h4>
              {snapshot.activeSetups.map((setup, idx) => (
                <SetupSection
                  key={`${setup.strategyId}-${idx}`}
                  setup={setup}
                  expanded={expandedSetups.has(setup.strategyId)}
                  onToggle={() => toggleSetup(setup.strategyId)}
                />
              ))}
            </div>
          )}

          {/* No setups message */}
          {(!snapshot.activeSetups || snapshot.activeSetups.length === 0) && (
            <div className="text-center text-gray-500 py-4">
              No active setups being watched
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface SetupSectionProps {
  setup: ActiveSetupInfo;
  expanded: boolean;
  onToggle: () => void;
}

const SetupSection: React.FC<SetupSectionProps> = ({ setup, expanded, onToggle }) => {
  return (
    <div className="bg-gray-900/50 rounded-lg overflow-hidden">
      {/* Setup Header */}
      <div
        className="p-3 cursor-pointer hover:bg-gray-800/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
            <span className="font-medium text-gray-200">{setup.strategyId}</span>
            {setup.direction && (
              <span className={`px-2 py-0.5 rounded text-xs ${getDirectionBgColor(setup.direction)} ${getDirectionColor(setup.direction)}`}>
                {setup.direction}
              </span>
            )}
            {setup.qualityTier && (
              <span className={`px-2 py-0.5 rounded text-xs ${getQualityTierColor(setup.qualityTier)}`}>
                {setup.qualityTier}
              </span>
            )}
          </div>

          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="w-24 bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  setup.progressPercent >= 80 ? 'bg-green-500' :
                  setup.progressPercent >= 50 ? 'bg-yellow-500' : 'bg-gray-500'
                }`}
                style={{ width: `${setup.progressPercent}%` }}
              />
            </div>
            <span className="text-sm font-mono text-gray-400 w-12">
              {setup.progressPercent}%
            </span>
          </div>
        </div>

        {/* Blocking condition */}
        {setup.blockingCondition && (
          <div className="flex items-center gap-2 mt-2 text-xs text-orange-400">
            <AlertTriangle className="w-3 h-3" />
            <span>Blocking: {setup.blockingCondition}</span>
          </div>
        )}
      </div>

      {/* Expanded Setup Details */}
      {expanded && (
        <div className="border-t border-gray-800 p-3 space-y-4">
          {/* Setup info */}
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-gray-500">Key Level:</span>
              <span className="ml-2 font-mono text-gray-300">{setup.keyLevel.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-gray-500">Watching:</span>
              <span className="ml-2 text-gray-300">{formatDuration(setup.watchingDurationMs)}</span>
            </div>
            <div>
              <span className="text-gray-500">Ready:</span>
              <span className={`ml-2 ${setup.readyForEntry ? 'text-green-400' : 'text-gray-500'}`}>
                {setup.readyForEntry ? 'Yes' : 'No'}
              </span>
            </div>
          </div>

          {/* Detailed Conditions */}
          {setup.detailedConditions && setup.detailedConditions.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 mb-2">Conditions</h5>
              <ConditionsTable conditions={setup.detailedConditions} />
            </div>
          )}

          {/* MTF Analysis */}
          {setup.mtfAnalysis && (
            <MtfAnalysisPanel analysis={setup.mtfAnalysis} />
          )}

          {/* Not Ready Reason */}
          {setup.notReadyReason && (
            <div className="text-xs text-orange-400 bg-orange-500/10 rounded p-2">
              {setup.notReadyReason}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StrategyCard;
