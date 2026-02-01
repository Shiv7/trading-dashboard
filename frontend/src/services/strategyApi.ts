import {
  InstrumentStateSnapshot,
  StrategyOpportunity,
  StrategyStateStats
} from '../types/strategy';

const API_BASE = import.meta.env.VITE_API_URL || 'http://3.111.242.49:8085';

/**
 * Strategy State API service.
 * Provides access to instrument states, opportunities, and strategy transparency data.
 */
export const strategyApi = {
  /**
   * Get all tracked instrument states.
   */
  getAllStates: async (): Promise<InstrumentStateSnapshot[]> => {
    const response = await fetch(`${API_BASE}/api/strategy-state`);
    if (!response.ok) {
      throw new Error('Failed to fetch strategy states');
    }
    return response.json();
  },

  /**
   * Get state for a specific instrument.
   */
  getState: async (scripCode: string): Promise<InstrumentStateSnapshot | null> => {
    const response = await fetch(`${API_BASE}/api/strategy-state/${scripCode}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error('Failed to fetch strategy state');
    }
    return response.json();
  },

  /**
   * Get all WATCHING instruments.
   */
  getWatching: async (): Promise<InstrumentStateSnapshot[]> => {
    const response = await fetch(`${API_BASE}/api/strategy-state/watching`);
    if (!response.ok) {
      throw new Error('Failed to fetch watching instruments');
    }
    return response.json();
  },

  /**
   * Get near-signal opportunities.
   */
  getOpportunities: async (
    limit: number = 100,
    minScore: number = 0
  ): Promise<StrategyOpportunity[]> => {
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    if (minScore > 0) {
      params.append('minScore', minScore.toString());
    }
    const response = await fetch(`${API_BASE}/api/strategy-state/opportunities?${params}`);
    if (!response.ok) {
      throw new Error('Failed to fetch opportunities');
    }
    return response.json();
  },

  /**
   * Get opportunities for a specific strategy.
   */
  getOpportunitiesByStrategy: async (strategyId: string): Promise<StrategyOpportunity[]> => {
    const response = await fetch(`${API_BASE}/api/strategy-state/opportunities/strategy/${strategyId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch strategy opportunities');
    }
    return response.json();
  },

  /**
   * Get opportunity for a specific instrument and strategy.
   */
  getOpportunity: async (
    scripCode: string,
    strategyId: string
  ): Promise<StrategyOpportunity | null> => {
    const response = await fetch(`${API_BASE}/api/strategy-state/opportunities/${scripCode}/${strategyId}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error('Failed to fetch opportunity');
    }
    return response.json();
  },

  /**
   * Get summary statistics.
   */
  getStats: async (): Promise<StrategyStateStats> => {
    const response = await fetch(`${API_BASE}/api/strategy-state/stats`);
    if (!response.ok) {
      throw new Error('Failed to fetch strategy stats');
    }
    return response.json();
  }
};

export default strategyApi;
