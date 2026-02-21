import React from 'react';
import { Eye, CheckCircle2, BarChart2 } from 'lucide-react';
import {
  InstrumentStateSnapshot, matchesStrategy, getStrategyConfig
} from '../../types/strategy';
import { WatchingCard } from './WatchingCard';
import { ReadyCard } from './ReadyCard';
import { PositionedCard } from './PositionedCard';

interface StrategyTabContentProps {
  strategyId: string;
  states: InstrumentStateSnapshot[];
}

export const StrategyTabContent: React.FC<StrategyTabContentProps> = ({
  strategyId,
  states,
}) => {
  const config = getStrategyConfig(strategyId);

  // Filter states to this strategy
  const strategyStates = states.filter(s =>
    s.activeSetups?.some(setup => matchesStrategy(setup.strategyId, strategyId))
  );

  // Group by state
  const watching = strategyStates.filter(s => s.state === 'WATCHING');
  const ready = strategyStates.filter(s => s.state === 'READY');
  const positioned = strategyStates.filter(s => s.state === 'POSITIONED');

  const findSetup = (snapshot: InstrumentStateSnapshot) =>
    snapshot.activeSetups?.find(s => matchesStrategy(s.strategyId, strategyId)) ?? snapshot.activeSetups?.[0];

  const totalCount = watching.length + ready.length + positioned.length;

  return (
    <div className="space-y-6">
      {/* Strategy Header */}
      <div className={`bg-slate-800 rounded-lg border ${config.accentBorder} p-3 sm:p-4`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className={`text-sm sm:text-lg font-medium ${config.accentText} flex items-center gap-1.5 sm:gap-2`}>
            <span className={`px-1.5 sm:px-2 py-0.5 rounded text-xs sm:text-sm font-bold ${config.accentBg} ${config.accentText}`}>
              {config.label}
            </span>
            <span className="hidden sm:inline">Strategy Dashboard</span>
            <span className="sm:hidden">Dashboard</span>
          </h2>
          <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-sm">
            <span className="text-yellow-400 font-mono">{watching.length} <span className="hidden sm:inline">watching</span><span className="sm:hidden">W</span></span>
            <span className="text-green-400 font-mono">{ready.length} <span className="hidden sm:inline">ready</span><span className="sm:hidden">R</span></span>
            <span className="text-blue-400 font-mono">{positioned.length} <span className="hidden sm:inline">positioned</span><span className="sm:hidden">P</span></span>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="text-center py-12 text-slate-500 bg-slate-800 rounded-lg border border-slate-700">
          No active {config.label} setups
        </div>
      )}

      {/* POSITIONED Section */}
      {positioned.length > 0 && (
        <StateSection
          title="POSITIONED"
          count={positioned.length}
          color="text-blue-400"
          icon={<BarChart2 className="w-4 h-4 text-blue-400" />}
        >
          {positioned.map(s => {
            const setup = findSetup(s);
            return setup ? <PositionedCard key={s.scripCode} snapshot={s} setup={setup} /> : null;
          })}
        </StateSection>
      )}

      {/* READY Section */}
      {ready.length > 0 && (
        <StateSection
          title="READY"
          count={ready.length}
          color="text-green-400"
          icon={<CheckCircle2 className="w-4 h-4 text-green-400" />}
        >
          {ready.map(s => {
            const setup = findSetup(s);
            return setup ? <ReadyCard key={s.scripCode} snapshot={s} setup={setup} /> : null;
          })}
        </StateSection>
      )}

      {/* WATCHING Section */}
      {watching.length > 0 && (
        <StateSection
          title="WATCHING"
          count={watching.length}
          color="text-yellow-400"
          icon={<Eye className="w-4 h-4 text-yellow-400" />}
        >
          {watching.map(s => {
            const setup = findSetup(s);
            return setup ? <WatchingCard key={s.scripCode} snapshot={s} setup={setup} /> : null;
          })}
        </StateSection>
      )}
    </div>
  );
};

// Section wrapper with header
const StateSection: React.FC<{
  title: string;
  count: number;
  color: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, count, color, icon, children }) => (
  <div>
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h3 className={`text-sm font-medium ${color}`}>
        {title}
      </h3>
      <span className="text-xs text-gray-500 font-mono">({count})</span>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
      {children}
    </div>
  </div>
);

export default StrategyTabContent;
