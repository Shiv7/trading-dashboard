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
  samples?: InstrumentStateSnapshot[];
  showSamples?: boolean;
}

export const StrategyTabContent: React.FC<StrategyTabContentProps> = ({
  strategyId,
  states,
  samples,
  showSamples,
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

  // Sample snapshots grouped by state
  const sampleWatching = showSamples && samples ? samples.filter(s => s.state === 'WATCHING') : [];
  const sampleReady = showSamples && samples ? samples.filter(s => s.state === 'READY') : [];
  const samplePositioned = showSamples && samples ? samples.filter(s => s.state === 'POSITIONED') : [];

  const findSetup = (snapshot: InstrumentStateSnapshot) =>
    snapshot.activeSetups?.find(s => matchesStrategy(s.strategyId, strategyId)) ?? snapshot.activeSetups?.[0];

  const totalCount = watching.length + ready.length + positioned.length;

  return (
    <div className="space-y-6">
      {/* Strategy Header */}
      <div className={`bg-slate-800 rounded-lg border ${config.accentBorder} p-4`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-lg font-medium ${config.accentText} flex items-center gap-2`}>
            <span className={`px-2 py-0.5 rounded text-sm font-bold ${config.accentBg} ${config.accentText}`}>
              {config.label}
            </span>
            Strategy Dashboard
          </h2>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-yellow-400 font-mono">{watching.length} watching</span>
            <span className="text-green-400 font-mono">{ready.length} ready</span>
            <span className="text-blue-400 font-mono">{positioned.length} positioned</span>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {totalCount === 0 && !showSamples && (
        <div className="text-center py-12 text-slate-500 bg-slate-800 rounded-lg border border-slate-700">
          No active {config.label} setups
        </div>
      )}

      {/* POSITIONED Section */}
      {(positioned.length > 0 || samplePositioned.length > 0) && (
        <StateSection
          title="POSITIONED"
          count={positioned.length}
          color="text-blue-400"
          icon={<BarChart2 className="w-4 h-4 text-blue-400" />}
        >
          {samplePositioned.map(s => {
            const setup = findSetup(s);
            return setup ? <PositionedCard key={s.scripCode} snapshot={s} setup={setup} isSample /> : null;
          })}
          {positioned.map(s => {
            const setup = findSetup(s);
            return setup ? <PositionedCard key={s.scripCode} snapshot={s} setup={setup} /> : null;
          })}
        </StateSection>
      )}

      {/* READY Section */}
      {(ready.length > 0 || sampleReady.length > 0) && (
        <StateSection
          title="READY"
          count={ready.length}
          color="text-green-400"
          icon={<CheckCircle2 className="w-4 h-4 text-green-400" />}
        >
          {sampleReady.map(s => {
            const setup = findSetup(s);
            return setup ? <ReadyCard key={s.scripCode} snapshot={s} setup={setup} isSample /> : null;
          })}
          {ready.map(s => {
            const setup = findSetup(s);
            return setup ? <ReadyCard key={s.scripCode} snapshot={s} setup={setup} /> : null;
          })}
        </StateSection>
      )}

      {/* WATCHING Section */}
      {(watching.length > 0 || sampleWatching.length > 0) && (
        <StateSection
          title="WATCHING"
          count={watching.length}
          color="text-yellow-400"
          icon={<Eye className="w-4 h-4 text-yellow-400" />}
        >
          {sampleWatching.map(s => {
            const setup = findSetup(s);
            return setup ? <WatchingCard key={s.scripCode} snapshot={s} setup={setup} isSample /> : null;
          })}
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
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {children}
    </div>
  </div>
);

export default StrategyTabContent;
