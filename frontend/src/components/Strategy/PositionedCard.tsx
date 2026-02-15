import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, Timer
} from 'lucide-react';
import {
  InstrumentStateSnapshot, ActiveSetupInfo,
  formatDuration, getDirectionColor, getDirectionBgColor,
  getQualityTierColor, getStrategyConfig, calculateRAchieved
} from '../../types/strategy';
import ConditionsTable from './ConditionsTable';
import MtfAnalysisPanel from './MtfAnalysisPanel';

interface PositionedCardProps {
  snapshot: InstrumentStateSnapshot;
  setup: ActiveSetupInfo;
  isSample?: boolean;
}

export const PositionedCard: React.FC<PositionedCardProps> = ({ snapshot, setup, isSample }) => {
  const [expanded, setExpanded] = useState(false);
  const config = getStrategyConfig(setup.strategyId);
  const pos = snapshot.position;
  const isLong = pos ? pos.direction === 'LONG' : setup.direction === 'LONG';
  const isProfitable = pos ? pos.unrealizedPnl >= 0 : false;

  // Position data (fallback to setup data if position missing)
  const entry = pos?.entryPrice ?? setup.keyLevel;
  const sl = pos?.stopLoss ?? 0;
  const target = pos?.takeProfit ?? setup.keyLevel;
  const current = pos?.currentPrice ?? snapshot.currentPrice;
  const pnl = Number(pos?.unrealizedPnl) || 0;
  const pnlPercent = Number(pos?.unrealizedPnlPercent) || 0;
  const holdingMs = pos?.holdingDurationMs ?? snapshot.stateDurationMs;

  // R Achieved
  const rAchieved = pos
    ? calculateRAchieved(pos.direction, entry, current, sl)
    : 0;

  // Price ruler percentages (position of current price between SL and Target)
  const totalRange = Math.abs(target - sl);
  const entryFromSl = Math.abs(entry - sl);
  const currentFromSl = totalRange > 0
    ? (isLong ? (current - sl) / totalRange * 100 : (sl - current) / totalRange * 100)
    : 50;
  const entryPercent = totalRange > 0
    ? (isLong ? (entryFromSl / totalRange) * 100 : ((sl - entry) / totalRange) * 100)
    : 50;

  const glowColor = isProfitable
    ? 'shadow-[0_0_15px_rgba(59,130,246,0.15)]'
    : 'shadow-[0_0_15px_rgba(239,68,68,0.15)]';

  return (
    <div className={`bg-slate-800 rounded-lg overflow-hidden ${
      isSample ? 'border-2 border-dashed border-yellow-500/60' : 'border-2 border-blue-500/40'
    } ${glowColor}`}>
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
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40">
                POSITIONED
              </span>
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-400 rounded-full animate-ping" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-400 rounded-full" />
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
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getDirectionBgColor(pos?.direction ?? setup.direction)} ${getDirectionColor(pos?.direction ?? setup.direction)}`}>
              {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {pos?.direction ?? setup.direction}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm font-semibold text-white">{snapshot.companyName}</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            <Timer className="w-3 h-3" />
            Holding {formatDuration(holdingMs)}
          </span>
        </div>
      </div>

      {/* P&L Section — THE dominant element */}
      <div className="bg-slate-900/60 px-4 py-3">
        {/* Price Grid */}
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
            <div className="text-gray-500 text-[10px] mb-1">Current</div>
            <div className={`font-mono text-base font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
              {current.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-[10px] mb-1">Target</div>
            <div className="font-mono text-base font-bold text-blue-400">{target.toFixed(2)}</div>
          </div>
        </div>

        {/* Price Ruler */}
        <div className="mt-3 mb-2">
          <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
            {/* Progress from SL toward Target */}
            <div
              className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                isProfitable ? 'bg-green-500/60' : 'bg-red-500/60'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, currentFromSl))}%` }}
            />
            {/* Entry marker */}
            <div
              className="absolute top-0 w-0.5 h-full bg-white/60"
              style={{ left: `${Math.max(0, Math.min(100, entryPercent))}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
            <span>SL</span>
            <span>Entry</span>
            <span>Target</span>
          </div>
        </div>

        {/* P&L Row */}
        <div className="grid grid-cols-3 gap-3 mt-2 text-center">
          <div>
            <div className="text-gray-500 text-[10px] mb-1">P&L</div>
            <div className={`font-mono text-sm font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
              {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-[10px] mb-1">P&L %</div>
            <div className={`font-mono text-sm font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
              {isProfitable ? '+' : ''}{pnlPercent.toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-[10px] mb-1">R Achieved</div>
            <div className={`font-mono text-sm font-bold ${rAchieved >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {rAchieved >= 0 ? '+' : ''}{rAchieved.toFixed(2)}R
            </div>
          </div>
        </div>
      </div>

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
          Active Position — {pos?.strategyId ?? setup.strategyId}
        </div>
        {expanded && (
          <div className="px-3 pb-3 space-y-3">
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-gray-500">Signal:</span>
                <span className="ml-1 text-gray-300">{pos?.signalId ?? '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Entry Time:</span>
                <span className="ml-1 text-gray-300">
                  {pos?.entryTime ? new Date(pos.entryTime).toLocaleTimeString() : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Holding:</span>
                <span className="ml-1 text-gray-300">{formatDuration(holdingMs)}</span>
              </div>
            </div>
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

export default PositionedCard;
