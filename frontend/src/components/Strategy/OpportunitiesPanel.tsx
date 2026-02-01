import React from 'react';
import { TrendingUp, TrendingDown, ArrowRight, Clock, Target } from 'lucide-react';
import {
  StrategyOpportunity,
  getDirectionColor,
  getDirectionBgColor
} from '../../types/strategy';

interface OpportunitiesPanelProps {
  opportunities: StrategyOpportunity[];
  onSelect?: (scripCode: string) => void;
  maxItems?: number;
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
            key={`${opp.scripCode}-${opp.strategyId}`}
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

const OpportunityRow: React.FC<OpportunityRowProps> = ({
  opportunity: opp,
  rank,
  onClick
}) => {
  const scoreColor = opp.opportunityScore >= 80 ? 'text-green-400' :
                     opp.opportunityScore >= 60 ? 'text-yellow-400' :
                     opp.opportunityScore >= 40 ? 'text-orange-400' : 'text-gray-400';

  return (
    <div
      className="bg-gray-900/50 rounded-lg p-3 hover:bg-gray-700/50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Rank */}
          <span className="text-gray-500 text-sm font-mono w-6">
            #{rank}
          </span>

          {/* Direction Icon */}
          {opp.direction === 'LONG' ? (
            <TrendingUp className="w-5 h-5 text-green-400" />
          ) : (
            <TrendingDown className="w-5 h-5 text-red-400" />
          )}

          {/* Instrument Info */}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-200">
                {opp.companyName || opp.scripCode}
              </span>
              <span className="text-xs text-gray-500">
                ({opp.scripCode})
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-500">{opp.strategyId}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${getDirectionBgColor(opp.direction)} ${getDirectionColor(opp.direction)}`}>
                {opp.direction}
              </span>
            </div>
          </div>
        </div>

        {/* Score */}
        <div className="text-right">
          <div className={`text-lg font-bold ${scoreColor}`}>
            {opp.opportunityScore.toFixed(0)}%
          </div>
          <div className="text-xs text-gray-500">ready</div>
        </div>
      </div>

      {/* Missing condition */}
      {opp.nextConditionNeeded && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-gray-500">Missing:</span>
          <span className="text-orange-400">{opp.nextConditionNeeded}</span>
        </div>
      )}

      {/* Key level */}
      <div className="mt-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Current:</span>
          <span className="font-mono text-gray-300">{opp.currentPrice.toFixed(2)}</span>
        </div>
        <ArrowRight className="w-3 h-3 text-gray-600" />
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Key Level:</span>
          <span className="font-mono text-blue-400">{opp.keyLevel.toFixed(2)}</span>
        </div>
      </div>

      {/* Conditions progress */}
      {opp.conditions && opp.conditions.length > 0 && (
        <div className="mt-2 flex gap-1">
          {opp.conditions.map((c, i) => (
            <div
              key={i}
              className={`flex-1 h-1 rounded ${
                c.passed ? 'bg-green-500' : 'bg-gray-700'
              }`}
              title={`${c.conditionName}: ${c.passed ? 'PASS' : 'FAIL'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default OpportunitiesPanel;
