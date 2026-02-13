import React from 'react';
import { TrendingUp, TrendingDown, Target, Clock } from 'lucide-react';
import {
  StrategyOpportunity,
  ConditionCheck
} from '../../types/strategy';

// ---- SAMPLE CARDS (flip SHOW_SAMPLE to false after UI review) ----
const SHOW_SAMPLE = false;

// FUDKII sample: ST bearish + BB squeeze → imagine bullish breakout
const SAMPLE_FUDKII: StrategyOpportunity = {
  scripCode: '535755',
  companyName: 'CRUDEOIL25FEBFUT',
  strategyId: 'FUDKII',
  direction: 'BULLISH',
  opportunityScore: 70,
  conditions: [
    { conditionName: 'ST Flip', passed: false, currentValue: 0.45, requiredValue: 0, comparison: '', progressPercent: 55, displayValue: '0.45% away' },
    { conditionName: 'BB Breakout', passed: false, currentValue: 0.43, requiredValue: 1.5, comparison: '', progressPercent: 71, displayValue: '0.43% to band' },
    { conditionName: 'BB Squeeze', passed: true, currentValue: 0.8, requiredValue: 1.2, comparison: '', progressPercent: 100, displayValue: 'Squeeze active' },
    { conditionName: 'Volume', passed: true, currentValue: 0.4, requiredValue: 1.0, comparison: '', progressPercent: 100, displayValue: 'Dried 0.4x' },
  ],
  nextConditionNeeded: 'BB squeeze + dried volume (0.4x avg) — pressure building',
  estimatedTimeframe: 'Next 30m candle',
  currentPrice: 5842.00,
  entryLevel: 5867.00,
  keyLevel: 5981.00,
  target2: 6038.00,
  superTrendLevel: 5810.00,
  expectedRR: 2.00,
  timestamp: Date.now(),
  strategyContext: 'ST below (2 bars) · Squeeze · Risk ₹57',
};

// PIVOT sample: HTF bullish, LTF approaching, near Daily R1 + Weekly P
const SAMPLE_PIVOT: StrategyOpportunity = {
  scripCode: '500325',
  companyName: 'RELIANCE',
  strategyId: 'PIVOT',
  direction: 'BULLISH',
  opportunityScore: 72,
  conditions: [
    { conditionName: 'HTF Bias', passed: true, currentValue: 85, requiredValue: 30, comparison: '', progressPercent: 100, displayValue: 'BULLISH (85%)' },
    { conditionName: 'LTF Confirm', passed: true, currentValue: 62, requiredValue: 50, comparison: '', progressPercent: 100, displayValue: 'Aligned 62%' },
    { conditionName: 'Pivot Levels', passed: false, currentValue: 1, requiredValue: 2, comparison: '', progressPercent: 50, displayValue: '1 level nearby' },
    { conditionName: 'R:R', passed: false, currentValue: 1.2, requiredValue: 1.5, comparison: '', progressPercent: 80, displayValue: '1.20:1' },
  ],
  nextConditionNeeded: 'Pivot confluence building — 1 of 2 levels nearby',
  estimatedTimeframe: 'Awaiting price at pivot levels',
  currentPrice: 1285.50,
  entryLevel: 1285.50,
  keyLevel: 1302.00,
  superTrendLevel: 1271.80,
  expectedRR: 1.20,
  timestamp: Date.now(),
  strategyContext: 'HTF: BULLISH 85% · Daily_R1 · R:R 1.2:1',
};

// MICROALPHA sample: Conviction building, trend-following mode
const SAMPLE_MICROALPHA: StrategyOpportunity = {
  scripCode: '500180',
  companyName: 'HDFCBANK',
  strategyId: 'MICROALPHA',
  direction: 'BEARISH',
  opportunityScore: 58,
  conditions: [
    { conditionName: 'Conviction', passed: false, currentValue: 33, requiredValue: 40, comparison: '', progressPercent: 82, displayValue: '33 / 40' },
    { conditionName: 'Mode Entry', passed: false, currentValue: 0, requiredValue: 1, comparison: '', progressPercent: 0, displayValue: 'TREND_FOLLOWING Fail' },
    { conditionName: 'Momentum', passed: false, currentValue: 0, requiredValue: 1, comparison: '', progressPercent: 0, displayValue: 'Stalled' },
    { conditionName: 'Direction', passed: true, currentValue: 1, requiredValue: 1, comparison: '', progressPercent: 100, displayValue: 'BEARISH' },
  ],
  nextConditionNeeded: 'Conviction at 33 — need 40 to trigger (mode: TREND_FOLLOWING)',
  estimatedTimeframe: 'Next 1m candle',
  currentPrice: 1642.30,
  entryLevel: 1642.30,
  keyLevel: 1618.50,
  superTrendLevel: 1664.20,
  expectedRR: 1.09,
  timestamp: Date.now(),
  strategyContext: 'Mode: TREND FOLLOWING · Conv: 33/40 · BEARISH',
  tradingMode: 'TREND_FOLLOWING',
};

const SAMPLE_OPPORTUNITIES = [SAMPLE_FUDKII, SAMPLE_PIVOT, SAMPLE_MICROALPHA];

// ---- END SAMPLES ----

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
  const allOpps = SHOW_SAMPLE
    ? [...SAMPLE_OPPORTUNITIES, ...opportunities]
    : opportunities;

  if (!allOpps || allOpps.length === 0) {
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

  const displayedOpportunities = allOpps.slice(0, maxItems);
  const sampleCount = SHOW_SAMPLE ? SAMPLE_OPPORTUNITIES.length : 0;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-200 flex items-center gap-2">
          <Target className="w-5 h-5" />
          Upcoming Opportunities
        </h3>
        <span className="text-sm text-gray-500">
          {allOpps.length} total
        </span>
      </div>

      <div className="space-y-2">
        {displayedOpportunities.map((opp, idx) => (
          <OpportunityRow
            key={`${opp.scripCode}-${opp.strategyId}-${idx}`}
            opportunity={opp}
            rank={idx + 1}
            isSample={SHOW_SAMPLE && idx < sampleCount}
            onClick={() => onSelect?.(opp.scripCode)}
          />
        ))}
      </div>

      {allOpps.length > maxItems && (
        <div className="mt-4 text-center text-sm text-gray-500">
          +{allOpps.length - maxItems} more opportunities
        </div>
      )}
    </div>
  );
};

interface OpportunityRowProps {
  opportunity: StrategyOpportunity;
  rank: number;
  isSample?: boolean;
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
  isSample,
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
      className={`rounded-lg p-3 hover:bg-gray-700/50 transition-colors cursor-pointer ${
        isSample ? 'bg-gray-900/50 border border-dashed border-yellow-600/40' : 'bg-gray-900/50'
      }`}
      onClick={onClick}
    >
      {/* Sample badge */}
      {isSample && (
        <div className="text-[10px] text-yellow-500 font-mono mb-1">SAMPLE CARD — for UI review</div>
      )}

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
