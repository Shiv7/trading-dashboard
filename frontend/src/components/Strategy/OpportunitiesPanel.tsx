import React from 'react';
import { TrendingUp, TrendingDown, Target, Clock } from 'lucide-react';
import {
  StrategyOpportunity,
  ConditionCheck
} from '../../types/strategy';

interface OpportunitiesPanelProps {
  opportunities: StrategyOpportunity[];
  onSelect?: (scripCode: string) => void;
  maxItems?: number;
}

// Normalize direction: backend sends BULLISH/BEARISH
const isBullish = (dir: string) => dir === 'LONG' || dir === 'BULLISH';
const dirLabel = (dir: string) => isBullish(dir) ? 'BULLISH' : 'BEARISH';
const dirColor = (dir: string) => isBullish(dir) ? 'text-green-400' : 'text-red-400';
const dirBg = (dir: string) => isBullish(dir) ? 'bg-green-500/20' : 'bg-red-500/20';

// Strategy accent colors
const strategyColor = (id: string) => {
  switch (id) {
    case 'FUDKII': return 'text-orange-400';
    case 'PIVOT': return 'text-purple-400';
    case 'MICROALPHA': return 'text-cyan-400';
    default: return 'text-gray-400';
  }
};
const strategyBg = (id: string) => {
  switch (id) {
    case 'FUDKII': return 'bg-orange-500/10';
    case 'PIVOT': return 'bg-purple-500/10';
    case 'MICROALPHA': return 'bg-cyan-500/10';
    default: return 'bg-gray-500/10';
  }
};

// Strategy-adaptive target labels
function getTargetLabels(strategyId: string): { t1: string; t2: string } {
  switch (strategyId) {
    case 'FUDKII': return { t1: 'T1 (2R)', t2: 'T2 (3R)' };
    case 'PIVOT': return { t1: 'Target', t2: '' };
    case 'MICROALPHA': return { t1: 'Target', t2: '' };
    default: return { t1: 'Target', t2: 'T2' };
  }
}

// Trading mode display
function formatTradingMode(mode?: string): string {
  if (!mode) return '';
  return mode.replace(/_/g, ' ');
}

export const OpportunitiesPanel: React.FC<OpportunitiesPanelProps> = ({
  opportunities,
  onSelect,
  maxItems = 10
}) => {
  if (!opportunities || opportunities.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-lg font-medium text-gray-200 mb-4 flex items-center gap-2">
          <Target className="w-5 h-5" />
          Upcoming Opportunities
        </h3>
        <div className="text-gray-500 text-center py-8">
          No near-signal opportunities detected
        </div>
      </div>
    );
  }

  const displayedOpportunities = opportunities.slice(0, maxItems);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-200 flex items-center gap-2">
          <Target className="w-5 h-5" />
          Upcoming Opportunities
        </h3>
        <span className="text-sm text-gray-500">
          {opportunities.length} total
        </span>
      </div>

      <div className="space-y-2">
        {displayedOpportunities.map((opp, idx) => (
          <OpportunityRow
            key={`${opp.scripCode}-${opp.strategyId}-${idx}`}
            opportunity={opp}
            rank={idx + 1}
            onClick={() => onSelect?.(opp.scripCode)}
          />
        ))}
      </div>

      {opportunities.length > maxItems && (
        <div className="mt-4 text-center text-sm text-gray-500">
          +{opportunities.length - maxItems} more opportunities
        </div>
      )}
    </div>
  );
};

interface OpportunityRowProps {
  opportunity: StrategyOpportunity;
  rank: number;
  onClick?: () => void;
}

// Resolve volume condition label: gray "Volume" / green "Dried Volume" / green "Volume Surge"
function getVolumeLabel(c: ConditionCheck): string {
  if (!c.passed) return 'Volume';
  const dv = c.displayValue || '';
  if (dv.startsWith('Dried')) return 'Dried Volume';
  if (dv.startsWith('Surge')) return 'Volume Surge';
  return 'Volume';
}

const OpportunityRow: React.FC<OpportunityRowProps> = ({
  opportunity: opp,
  rank,
  onClick
}) => {
  const scoreColor = opp.opportunityScore >= 80 ? 'text-green-400' :
                     opp.opportunityScore >= 60 ? 'text-yellow-400' :
                     opp.opportunityScore >= 40 ? 'text-orange-400' : 'text-gray-400';

  const rr = opp.expectedRR ?? 0;
  const rrColor = rr >= 2 ? 'text-green-400' : rr >= 1 ? 'text-yellow-400' : 'text-orange-400';

  const timeStr = opp.timestamp
    ? new Date(opp.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '';

  const hasEntry = opp.entryLevel != null && opp.entryLevel > 0;
  const hasSL = opp.superTrendLevel != null && opp.superTrendLevel > 0;
  const hasT1 = opp.keyLevel > 0;
  // Only show T2 for FUDKII (other strategies don't use R-multiple T2)
  const hasT2 = opp.strategyId === 'FUDKII' && opp.target2 != null && opp.target2 > 0;

  const labels = getTargetLabels(opp.strategyId);

  return (
    <div
      className="rounded-lg p-3 hover:bg-gray-700/50 transition-colors cursor-pointer bg-gray-900/50"
      onClick={onClick}
    >
      {/* Row 1: Instrument + Strategy badge + Score */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-gray-500 text-sm font-mono w-6">#{rank}</span>
          {isBullish(opp.direction) ? (
            <TrendingUp className="w-5 h-5 text-green-400" />
          ) : (
            <TrendingDown className="w-5 h-5 text-red-400" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-200">
                {opp.companyName || opp.scripCode}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs px-1.5 py-0.5 rounded ${strategyBg(opp.strategyId)} ${strategyColor(opp.strategyId)}`}>
                {opp.strategyId}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${dirBg(opp.direction)} ${dirColor(opp.direction)}`}>
                {dirLabel(opp.direction)}
              </span>
              {/* Trading mode badge for MicroAlpha */}
              {opp.tradingMode && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-400">
                  {formatTradingMode(opp.tradingMode)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${scoreColor}`}>
            {opp.opportunityScore.toFixed(0)}%
          </div>
          <div className="text-xs text-gray-500">score</div>
        </div>
      </div>

      {/* Row 2: Strategy context line */}
      {opp.strategyContext && (
        <div className="mt-1.5 text-[10px] text-gray-500 font-mono truncate">
          {opp.strategyContext}
        </div>
      )}

      {/* Row 3: Next condition needed */}
      {opp.nextConditionNeeded && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-gray-500">Next:</span>
          <span className="text-orange-400">{opp.nextConditionNeeded}</span>
        </div>
      )}

      {/* Row 4: Price levels grid */}
      <div className="mt-2 grid grid-cols-6 gap-x-1.5 text-xs">
        <div>
          <div className="text-gray-600 text-[10px]">LTP</div>
          <div className="font-mono text-gray-300">{opp.currentPrice.toFixed(2)}</div>
        </div>
        {hasEntry && (
          <div>
            <div className="text-gray-600 text-[10px]">Entry @</div>
            <div className="font-mono text-white/80">{opp.entryLevel!.toFixed(2)}</div>
          </div>
        )}
        {hasSL && (
          <div>
            <div className="text-gray-600 text-[10px]">SL</div>
            <div className="font-mono text-red-400/80">{opp.superTrendLevel!.toFixed(2)}</div>
          </div>
        )}
        {hasT1 && (
          <div>
            <div className="text-gray-600 text-[10px]">{labels.t1}</div>
            <div className="font-mono text-green-400">{opp.keyLevel.toFixed(2)}</div>
          </div>
        )}
        {hasT2 && (
          <div>
            <div className="text-gray-600 text-[10px]">{labels.t2}</div>
            <div className="font-mono text-green-500/70">{opp.target2!.toFixed(2)}</div>
          </div>
        )}
        {rr > 0 && (
          <div>
            <div className="text-gray-600 text-[10px]">RR</div>
            <div className={`font-mono font-semibold ${rrColor}`}>{rr.toFixed(1)}</div>
          </div>
        )}
      </div>

      {/* Row 5: Timestamp */}
      {timeStr && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-gray-600">
          <Clock className="w-3 h-3" />
          <span>{timeStr}</span>
          {opp.estimatedTimeframe && (
            <>
              <span className="text-gray-700">·</span>
              <span>{opp.estimatedTimeframe}</span>
            </>
          )}
        </div>
      )}

      {/* Row 6: Conditions progress with labels */}
      {opp.conditions && opp.conditions.length > 0 && (
        <div className="mt-2.5 flex gap-1.5">
          {opp.conditions.map((c, i) => {
            const label = c.conditionName === 'Volume' ? getVolumeLabel(c) : c.conditionName;
            return (
              <div key={i} className="flex-1">
                <div
                  className={`h-1.5 rounded ${
                    c.passed ? 'bg-green-500' : 'bg-gray-700'
                  }`}
                  title={`${label}: ${c.passed ? 'PASS' : 'FAIL'} — ${c.displayValue}`}
                />
                <div className={`text-[10px] mt-0.5 text-center truncate ${
                  c.passed ? 'text-green-500' : 'text-gray-600'
                }`}>
                  {label}
                </div>
                <div className={`text-[9px] text-center truncate ${
                  c.passed ? 'text-green-600/70' : 'text-gray-700'
                }`}>
                  {c.displayValue}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OpportunitiesPanel;
