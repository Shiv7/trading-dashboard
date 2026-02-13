import {
  InstrumentStateSnapshot,
  StrategyOpportunity,
  StrategyStateStats
} from '../types/strategy';
import { fetchJson } from './api';

/**
 * Strategy State API service.
 * Provides access to instrument states, opportunities, and strategy transparency data.
 */
export const strategyApi = {
  getAllStates: () => fetchJson<InstrumentStateSnapshot[]>('/strategy-state'),

  getState: async (scripCode: string): Promise<InstrumentStateSnapshot | null> => {
    try {
      return await fetchJson<InstrumentStateSnapshot>(`/strategy-state/${scripCode}`);
    } catch {
      return null;
    }
  },

  getWatching: () => fetchJson<InstrumentStateSnapshot[]>('/strategy-state/watching'),

  getOpportunities: (limit: number = 100, minScore: number = 0) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (minScore > 0) params.append('minScore', minScore.toString());
    return fetchJson<StrategyOpportunity[]>(`/strategy-state/opportunities?${params}`);
  },

  getOpportunitiesByStrategy: (strategyId: string) =>
    fetchJson<StrategyOpportunity[]>(`/strategy-state/opportunities/strategy/${strategyId}`),

  getOpportunity: async (scripCode: string, strategyId: string): Promise<StrategyOpportunity | null> => {
    try {
      return await fetchJson<StrategyOpportunity>(`/strategy-state/opportunities/${scripCode}/${strategyId}`);
    } catch {
      return null;
    }
  },

  getStats: () => fetchJson<StrategyStateStats>('/strategy-state/stats'),
};

export default strategyApi;
