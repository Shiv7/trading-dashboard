/**
 * Strategy transparency types for the dashboard.
 * These types match the backend DTOs from the strategy-state API.
 */

export interface StrategyCondition {
  name: string;
  category: 'REQUIRED' | 'OPTIMAL' | 'BONUS' | 'INFO';
  passed: boolean;
  currentValue: string;
  requiredValue: string;
  explanation: string;
  progressPercent: number;
  source?: string;  // HTF, LTF, FLOW, ZONE, TECHNICAL
  timeframe?: string;
  notes?: string;
}

export interface MtfAnalysis {
  // Hierarchical Analysis
  htfTimeframe: string;
  ltfTimeframe: string;
  htfBias: 'BULLISH' | 'BEARISH' | 'UNKNOWN';
  ltfBias: 'BULLISH' | 'BEARISH' | 'UNKNOWN';
  biasAligned: boolean;
  htfStructure: string;
  ltfStructure: string;

  // Swing Range
  swingHigh: number;
  swingLow: number;
  equilibrium: number;
  zonePosition: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM' | 'ABOVE_RANGE' | 'BELOW_RANGE' | 'UNKNOWN';
  rangePositionPercent: number;
  swingSizePercent: number;
  isUpswing: boolean;

  // Flow Alignment
  flowStatus: 'PASS' | 'BLOCKED' | 'NO_DATA';
  flowInterpretation: string;
  flowReason: string;
  flowConfidence?: number;

  // Entry Sequence
  completedSteps: number;
  totalSteps: number;
  completedStepNames: string[];
  missingStepNames: string[];
  coreRequirementsMet: boolean;
  fullSequenceMet: boolean;

  // Quality
  qualityTier: string;
  qualityTierDisplay: string;
  qualitySummary: string;
  qualityReasons: string[];
  qualityScore: number;

  // SMC Details
  atHtfDemand: boolean;
  atHtfSupply: boolean;
  ltfSweepDetected: boolean;
  ltfSweepSide?: string;
  ltfChochDetected: boolean;
  ltfChochDirection?: string;
  ltfBosDetected: boolean;
  ltfBosDirection?: string;
}

export interface ConditionCheck {
  conditionName: string;
  passed: boolean;
  currentValue: number;
  requiredValue: number;
  comparison: string;
  progressPercent: number;
  displayValue: string;
}

export interface ActiveSetupInfo {
  strategyId: string;
  setupDescription: string;
  direction: 'LONG' | 'SHORT';
  keyLevel: number;
  watchingStartTime: number;
  watchingDurationMs: number;
  conditions: ConditionCheck[];
  progressPercent: number;
  blockingCondition?: string;

  // Extended transparency fields
  detailedConditions?: StrategyCondition[];
  mtfAnalysis?: MtfAnalysis;
  qualityTier?: string;
  readyForEntry: boolean;
  notReadyReason?: string;
}

export interface PositionInfo {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  entryTime: number;
  holdingDurationMs: number;
  strategyId: string;
  signalId: string;
}

export interface InstrumentStateSnapshot {
  scripCode: string;
  companyName: string;
  state: 'IDLE' | 'WATCHING' | 'READY' | 'POSITIONED' | 'COOLDOWN';
  stateTimestamp: number;
  stateEntryTime: number;
  stateDurationMs: number;

  // Market Data
  currentPrice: number;
  ofiZscore: number;
  atr: number;
  vpin: number;
  superTrendBullish: boolean;
  superTrendFlip: boolean;
  bbPercentB: number;
  bbSqueezing: boolean;

  // Active Setups
  activeSetups: ActiveSetupInfo[];

  // Position Info
  position?: PositionInfo;

  // Cooldown
  cooldownRemainingMs: number;

  // Stats
  signalsToday: number;
  maxSignalsPerDay: number;
}

export interface StrategyOpportunity {
  scripCode: string;
  companyName: string;
  strategyId: string;
  direction: string;
  opportunityScore: number;
  conditions: ConditionCheck[];
  nextConditionNeeded: string;
  estimatedTimeframe: string;
  currentPrice: number;
  entryLevel?: number;
  keyLevel: number;
  target2?: number;
  superTrendLevel?: number;
  expectedRR?: number;
  timestamp: number;
  strategyContext?: string;  // Strategy-specific context (e.g., "HTF: BULLISH 85% · Daily R1 + Weekly P")
  tradingMode?: string;     // MicroAlpha trading mode
}

export interface StrategyStateStats {
  totalInstruments: number;
  watchingInstruments: number;
  totalOpportunities: number;
  highScoreOpportunities: number;
}

// Helper functions
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function getStateColor(state: string): string {
  switch (state) {
    case 'WATCHING':
      return 'text-yellow-400';
    case 'READY':
      return 'text-green-400';
    case 'POSITIONED':
      return 'text-blue-400';
    case 'COOLDOWN':
      return 'text-orange-400';
    default:
      return 'text-gray-400';
  }
}

export function getDirectionColor(direction: string): string {
  return direction === 'LONG' ? 'text-green-400' : 'text-red-400';
}

export function getDirectionBgColor(direction: string): string {
  return direction === 'LONG' ? 'bg-green-500/20' : 'bg-red-500/20';
}

export function getCategoryColor(category: string): string {
  switch (category) {
    case 'REQUIRED':
      return 'text-red-400';
    case 'OPTIMAL':
      return 'text-yellow-400';
    case 'BONUS':
      return 'text-blue-400';
    default:
      return 'text-gray-400';
  }
}

export function getQualityTierColor(tier: string): string {
  switch (tier) {
    case 'A+':
    case 'A_PLUS':
      return 'text-green-400 bg-green-500/20';
    case 'A':
      return 'text-green-300 bg-green-500/10';
    case 'B':
      return 'text-yellow-400 bg-yellow-500/20';
    case 'C':
      return 'text-orange-400 bg-orange-500/20';
    default:
      return 'text-red-400 bg-red-500/20';
  }
}

export function getBiasColor(bias: string): string {
  switch (bias) {
    case 'BULLISH':
      return 'text-green-400';
    case 'BEARISH':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

export function getZoneColor(zone: string): string {
  switch (zone) {
    case 'PREMIUM':
    case 'ABOVE_RANGE':
      return 'text-red-400';
    case 'DISCOUNT':
    case 'BELOW_RANGE':
      return 'text-green-400';
    case 'EQUILIBRIUM':
      return 'text-yellow-400';
    default:
      return 'text-gray-400';
  }
}

export function getFlowStatusColor(status: string): string {
  switch (status) {
    case 'PASS':
      return 'text-green-400';
    case 'BLOCKED':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

// Strategy display configuration
export const STRATEGY_CONFIGS: Record<string, {
  label: string;
  accentBg: string;
  accentText: string;
  accentBorder: string;
}> = {
  FUDKII:           { label: 'FUDKII',    accentBg: 'bg-orange-500/10', accentText: 'text-orange-400', accentBorder: 'border-orange-500/50' },
  FUKAA:            { label: 'FUKAA',      accentBg: 'bg-amber-500/10',  accentText: 'text-amber-400',  accentBorder: 'border-amber-500/50' },
  PIVOT_CONFLUENCE: { label: 'PIVOT',      accentBg: 'bg-purple-500/10', accentText: 'text-purple-400', accentBorder: 'border-purple-500/50' },
  PIVOT:            { label: 'PIVOT',      accentBg: 'bg-purple-500/10', accentText: 'text-purple-400', accentBorder: 'border-purple-500/50' },
  MICROALPHA:       { label: 'MICROALPHA', accentBg: 'bg-cyan-500/10',   accentText: 'text-cyan-400',   accentBorder: 'border-cyan-500/50' },
};

export function getStrategyConfig(strategyId: string) {
  return STRATEGY_CONFIGS[strategyId] || { label: strategyId, accentBg: 'bg-gray-500/10', accentText: 'text-gray-400', accentBorder: 'border-gray-500/50' };
}

export function calculateRR(direction: string, entry: number, sl: number, target: number): number {
  if (direction === 'LONG' || direction === 'BULLISH') {
    const risk = entry - sl;
    const reward = target - entry;
    return risk > 0 ? reward / risk : 0;
  } else {
    const risk = sl - entry;
    const reward = entry - target;
    return risk > 0 ? reward / risk : 0;
  }
}

export function calculateRAchieved(direction: string, entry: number, current: number, sl: number): number {
  if (direction === 'LONG' || direction === 'BULLISH') {
    const risk = entry - sl;
    const pnl = current - entry;
    return risk > 0 ? pnl / risk : 0;
  } else {
    const risk = sl - entry;
    const pnl = entry - current;
    return risk > 0 ? pnl / risk : 0;
  }
}

export function matchesStrategy(strategyId: string, tabStrategy: string): boolean {
  if (tabStrategy === 'PIVOT') return strategyId === 'PIVOT' || strategyId === 'PIVOT_CONFLUENCE';
  return strategyId === tabStrategy;
}
