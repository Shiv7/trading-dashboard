import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, Clock
} from 'lucide-react';
import {
  InstrumentStateSnapshot, ActiveSetupInfo,
  formatDuration, getDirectionColor, getDirectionBgColor,
  getQualityTierColor, getStrategyConfig, calculateRR
} from '../../types/strategy';
import ConditionsTable from './ConditionsTable';
import MtfAnalysisPanel from './MtfAnalysisPanel';

interface ReadyCardProps {
  snapshot: InstrumentStateSnapshot;
  setup: ActiveSetupInfo;
  isSample?: boolean;
}

export const ReadyCard: React.FC<ReadyCardProps> = ({ snapshot, setup, isSample }) => {
  const [expanded, setExpanded] = useState(false);
  const config = getStrategyConfig(setup.strategyId);
  const isLong = setup.direction === 'LONG';

  // Derive SL and Target
  const entry = setup.keyLevel;
  let sl: number;
  let target: number;

  if (isLong) {
    // FUDKII: SL at SuperTrend, others: entry - 1.5*ATR
    sl = setup.strategyId === 'FUDKII' && snapshot.superTrendBullish
      ? Math.min(entry - snapshot.atr, entry * 0.99)
      : entry - 1.5 * snapshot.atr;
    target = entry + 2 * (entry - sl);
  } else {
    sl = setup.strategyId === 'FUDKII' && !snapshot.superTrendBullish
      ? Math.max(entry + snapshot.atr, entry * 1.01)
      : entry + 1.5 * snapshot.atr;
    target = entry - 2 * (sl - entry);
  }

  // Use mtfAnalysis swing levels for PIVOT if available
  if ((setup.strategyId === 'PIVOT_CONFLUENCE' || setup.strategyId === 'PIVOT') && setup.mtfAnalysis) {
    const mtf = setup.mtfAnalysis;
    if (isLong) {
      sl = mtf.swingLow;
      target = mtf.swingHigh;
    } else {
      sl = mtf.swingHigh;
      target = mtf.swingLow;
    }
  }

  const rr = calculateRR(setup.direction, entry, sl, target);
  const distToEntry = ((entry - snapshot.currentPrice) / snapshot.currentPrice * 100);

  // Build strategy context from conditions
  const contextParts: string[] = [];
  setup.conditions?.forEach(c => {
    if (c.displayValue && c.conditionName !== 'Direction') {
      contextParts.push(`${c.conditionName}: ${c.displayValue}`);
    }
  });
  const contextLine = contextParts.join(' · ');

  return (
    <div className={`bg-slate-800 rounded-lg overflow-hidden ${
      isSample ? 'border-2 border-dashed border-yellow-500/60' : 'border-2 border-green-500/40'
    } shadow-[0_0_15px_rgba(34,197,94,0.1)]`}>
      {isSample && (
        <div className="bg-yellow-500/10 px-3 py-1 text-[10px] text-yellow-400 font-medium text-center">
          SAMPLE CARD
        </div>
      )}

      {/* Header */}
      <div className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/40">
                READY
              </span>
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-ping" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full" />
            </div>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${config.accentBg} ${config.accentText}`}>
              {config.label}
            </span>
            {setup.qualityTier && (
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${getQualityTierColor(setup.qualityTier)}`}>
                {setup.qualityTier === 'A_PLUS' ? 'A+' : setup.qualityTier}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getDirectionBgColor(setup.direction)} ${getDirectionColor(setup.direction)}`}>
              {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {setup.direction}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm font-semibold text-white">{snapshot.companyName}</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            <Clock className="w-3 h-3" />
            Ready for {formatDuration(snapshot.stateDurationMs)}
          </span>
        </div>
      </div>

      {/* Price Grid — THE dominant element */}
      <div className="bg-slate-900/60 px-4 py-3">
        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <div className="text-gray-500 text-[10px] mb-1">Entry</div>
            <div className="font-mono text-base font-bold text-white">{entry.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-500 text-[10px] mb-1">SL</div>
            <div className="font-mono text-base font-bold text-red-400">{sl.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-500 text-[10px] mb-1">Target</div>
            <div className="font-mono text-base font-bold text-green-400">{target.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-500 text-[10px] mb-1">R:R</div>
            <div className={`font-mono text-base font-bold ${rr >= 2 ? 'text-green-400' : rr >= 1.5 ? 'text-yellow-400' : 'text-orange-400'}`}>
              {rr.toFixed(1)}:1
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs">
          <span className="text-gray-500">
            Current: <span className="font-mono text-gray-300">{snapshot.currentPrice.toFixed(2)}</span>
          </span>
          <span className="text-gray-500">
            Distance to entry: <span className={`font-mono ${distToEntry > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
              {Math.abs(distToEntry).toFixed(2)}%
            </span>
          </span>
        </div>
      </div>

      {/* Strategy Context */}
      {contextLine && (
        <div className="px-3 py-1.5 text-[11px] text-gray-500 font-mono border-t border-gray-800">
          {contextLine}
        </div>
      )}

      {/* Condition mini-bars */}
      {setup.conditions && setup.conditions.length > 0 && (
        <div className="px-3 py-2 flex gap-1 border-t border-gray-800">
          {setup.conditions.map((c, i) => (
            <div key={i} className="flex-1" title={`${c.conditionName}: ${c.displayValue}`}>
              <div className={`h-1.5 rounded-full ${c.passed ? 'bg-green-500' : 'bg-gray-600'}`} />
              <div className="text-[9px] text-gray-600 truncate mt-0.5">{c.conditionName}</div>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Setup */}
      <div className="border-t border-gray-800">
        <div
          className="px-3 py-2 cursor-pointer hover:bg-gray-800/50 flex items-center gap-2 text-xs text-gray-400"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Active Setup — all conditions passed
        </div>
        {expanded && (
          <div className="px-3 pb-3 space-y-3">
            {setup.detailedConditions && setup.detailedConditions.length > 0 && (
              <ConditionsTable conditions={setup.detailedConditions} />
            )}
            {setup.mtfAnalysis && <MtfAnalysisPanel analysis={setup.mtfAnalysis} />}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReadyCard;
