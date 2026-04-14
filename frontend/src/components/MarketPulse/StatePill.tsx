import type { FC } from 'react';

export type MarketState = 'LIVE' | 'STALE_SESSION' | 'CLOSED_AFTERHRS' | 'CLOSED_HOLIDAY' | 'ERROR';

interface Props {
  state: MarketState | undefined | null;
  className?: string;
}

const COLORS: Record<MarketState, string> = {
  LIVE:            'bg-emerald-400 animate-pulse',
  STALE_SESSION:   'bg-amber-400',
  CLOSED_AFTERHRS: 'bg-slate-500',
  CLOSED_HOLIDAY:  'bg-slate-500',
  ERROR:           'bg-red-500',
};

export const StatePill: FC<Props> = ({ state, className = '' }) => {
  const color = COLORS[state ?? 'CLOSED_AFTERHRS'];
  return <span className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full ${color} ${className}`} />;
};
