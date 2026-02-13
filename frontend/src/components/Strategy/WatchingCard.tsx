import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, Clock, AlertTriangle,
  TrendingUp, TrendingDown
} from 'lucide-react';
import {
  InstrumentStateSnapshot, ActiveSetupInfo,
  formatDuration, getDirectionColor, getDirectionBgColor,
  getQualityTierColor, getStrategyConfig
} from '../../types/strategy';
import ConditionsTable from './ConditionsTable';
import MtfAnalysisPanel from './MtfAnalysisPanel';

interface WatchingCardProps {
  snapshot: InstrumentStateSnapshot;
  setup: ActiveSetupInfo;
  isSample?: boolean;
}

export const WatchingCard: React.FC<WatchingCardProps> = ({ snapshot, setup, isSample }) => {
  const [expanded, setExpanded] = useState(false);
  const config = getStrategyConfig(setup.strategyId);
  const isLong = setup.direction === 'LONG';

  return (
    <div className={`bg-slate-800 rounded-lg border ${isSample ? 'border-dashed border-yellow-500/60' : 'border-yellow-500/30'} overflow-hidden`}>
      {isSample && (
        <div className="bg-yellow-500/10 px-3 py-1 text-[10px] text-yellow-400 font-medium text-center">
          SAMPLE CARD
        </div>
      )}

      {/* Header */}
      <div className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${config.accentBg} ${config.accentText}`}>
              {config.label}
            </span>
            <span className="font-semibold text-white text-sm">{snapshot.companyName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-gray-300">{snapshot.currentPrice.toFixed(2)}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-400">WATCHING</span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <Clock className="w-3 h-3" />
              {formatDuration(snapshot.stateDurationMs)}
            </span>
          </div>
        </div>

        {/* Direction + Entry + Quality */}
        <div className="flex items-center gap-3 mt-1.5">
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${getDirectionBgColor(setup.direction)} ${getDirectionColor(setup.direction)}`}>
            {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {setup.direction}
          </span>
          <span className="text-xs text-gray-500">Entry @</span>
          <span className="font-mono text-xs text-white">{setup.keyLevel.toFixed(2)}</span>
          {setup.qualityTier && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] ml-auto ${getQualityTierColor(setup.qualityTier)}`}>
              {setup.qualityTier}
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] text-gray-500">Progress</span>
          <div className="flex-1 bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                setup.progressPercent >= 80 ? 'bg-green-500' :
                setup.progressPercent >= 50 ? 'bg-yellow-500' : 'bg-gray-500'
              }`}
              style={{ width: `${setup.progressPercent}%` }}
            />
          </div>
          <span className="text-xs font-mono text-gray-400">{setup.progressPercent}%</span>
        </div>
        {setup.blockingCondition && (
          <div className="flex items-center gap-1.5 text-[11px] text-orange-400">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span>{setup.blockingCondition}</span>
          </div>
        )}
      </div>

      {/* Market Data (3-col) */}
      <div className="grid grid-cols-3 gap-2 px-3 pb-2">
        <div className="bg-gray-900/50 rounded px-2 py-1">
          <div className="text-gray-600 text-[10px]">OFI Z</div>
          <div className={`font-mono text-xs ${snapshot.ofiZscore > 0 ? 'text-green-400' : snapshot.ofiZscore < 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {snapshot.ofiZscore.toFixed(2)}
          </div>
        </div>
        <div className="bg-gray-900/50 rounded px-2 py-1">
          <div className="text-gray-600 text-[10px]">ATR</div>
          <div className="font-mono text-xs text-gray-300">{snapshot.atr.toFixed(2)}</div>
        </div>
        <div className="bg-gray-900/50 rounded px-2 py-1">
          <div className="text-gray-600 text-[10px]">BB %B</div>
          <div className={`font-mono text-xs ${snapshot.bbPercentB > 1 ? 'text-green-400' : snapshot.bbPercentB < 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {snapshot.bbPercentB.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Condition mini-bars */}
      {setup.conditions && setup.conditions.length > 0 && (
        <div className="px-3 pb-2 flex gap-1">
          {setup.conditions.map((c, i) => (
            <div key={i} className="flex-1" title={`${c.conditionName}: ${c.displayValue}`}>
              <div className={`h-1.5 rounded-full ${c.passed ? 'bg-green-500' : 'bg-gray-600'}`} />
              <div className="text-[9px] text-gray-600 truncate mt-0.5">{c.conditionName}</div>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Active Setup */}
      <div className="border-t border-gray-800">
        <div
          className="px-3 py-2 cursor-pointer hover:bg-gray-800/50 flex items-center gap-2 text-xs text-gray-400"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Active Setup
        </div>
        {expanded && (
          <div className="px-3 pb-3 space-y-3">
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-gray-500">Watching:</span>
                <span className="ml-1 text-gray-300">{formatDuration(setup.watchingDurationMs)}</span>
              </div>
              <div>
                <span className="text-gray-500">Ready:</span>
                <span className={`ml-1 ${setup.readyForEntry ? 'text-green-400' : 'text-gray-500'}`}>
                  {setup.readyForEntry ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
            {setup.detailedConditions && setup.detailedConditions.length > 0 && (
              <ConditionsTable conditions={setup.detailedConditions} />
            )}
            {setup.mtfAnalysis && <MtfAnalysisPanel analysis={setup.mtfAnalysis} />}
            {setup.notReadyReason && (
              <div className="text-xs text-orange-400 bg-orange-500/10 rounded p-2">
                {setup.notReadyReason}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WatchingCard;
