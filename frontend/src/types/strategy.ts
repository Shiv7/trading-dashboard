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
  direction: 'LONG' | 'SHORT';
  opportunityScore: number;
  conditions: ConditionCheck[];
  nextConditionNeeded: string;
  estimatedTimeframe: string;
  currentPrice: number;
  keyLevel: number;
  timestamp: number;
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
