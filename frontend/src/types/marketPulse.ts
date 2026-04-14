import type { MarketState } from '../components/MarketPulse/StatePill';

export interface AssetStatus {
  state: MarketState;
  subtitle: string;
  lastUpdateMs: number;
}

// (optional) you can augment MacroSnapshot types here if they exist; otherwise
// consumers can treat these fields as optional on the API response.
