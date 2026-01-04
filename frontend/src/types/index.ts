// Wallet types
export interface Wallet {
  walletId: string;
  initialCapital: number;
  currentCapital: number;
  availableMargin: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  dayPnl: number;
  openPositionsCount: number;
  totalTradesCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  lastUpdated: string;
  positions: Position[];
}

export interface Position {
  positionId: string;
  signalId: string;
  scripCode: string;
  companyName: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  tp1Hit: boolean;
  status: string;
  trailingType?: string;
  trailingStop?: number;
  openedAt: string;
  lastUpdated: string;
}

// Family Score types
export interface FamilyScore {
  scripCode: string;
  companyName: string;
  timeframe: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;

  // VCP
  vcpCombinedScore: number;
  vcpRunway: number;
  vcpStructuralBias: number;
  vcpSupportScore: number;
  vcpResistanceScore: number;

  // IPU
  ipuFinalScore: number;
  ipuInstProxy: number;
  ipuMomentum: number;
  ipuExhaustion: number;
  ipuUrgency: number;
  ipuDirectionalConviction: number;
  ipuXfactor: boolean;
  ipuMomentumState: string;

  // Regime
  indexRegimeLabel: string;
  indexRegimeStrength: number;
  securityRegimeLabel: string;
  securityAligned: boolean;

  // OI
  oiSignal: string;
  pcr?: number;
  spotFuturePremium?: number;
  futuresBuildup: string;

  // Gates
  hardGatePassed: boolean;
  hardGateReason: string;
  mtfGatePassed: boolean;
  mtfGateReason: string;
  qualityGatePassed: boolean;
  qualityGateReason: string;
  statsGatePassed: boolean;
  statsGateReason: string;

  // Overall
  overallScore: number;
  direction: string;
  signalEmitted: boolean;

  moduleDetails?: Record<string, unknown>;
}

// Signal types
export interface Signal {
  signalId: string;
  scripCode: string;
  companyName: string;
  timestamp: string;

  // Signal Source (NEW)
  signalSource?: 'MASTER_ARCH' | 'MTIS' | 'VCP' | 'IPU' | 'FUDKII' | 'BB_SUPERTREND' | 'CURATED' | string;
  signalSourceLabel?: string;
  isMasterArch?: boolean;

  signalType: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  confidence: number;
  rationale: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3?: number;
  riskRewardRatio: number;
  vcpScore: number;
  ipuScore: number;
  xfactorFlag: boolean;
  regimeLabel: string;

  // Master Architecture specific (NEW)
  finalOpportunityScore?: number;
  directionConfidence?: number;
  tradeDecision?: 'ENTER_NOW' | 'WATCHLIST' | 'MONITOR' | 'REJECT' | string;
  recommendedLots?: number;
  hedgeRecommended?: boolean;

  allGatesPassed: boolean;
  gateFailReason?: string;
  positionSizeMultiplier: number;
  tradeStatus?: string;
  actualPnl?: number;
  rMultiple?: number;
  exitReason?: string;
}

// Trade types
export interface Trade {
  tradeId: string;
  signalId: string;
  scripCode: string;
  companyName: string;
  side: 'LONG' | 'SHORT';
  status: 'ACTIVE' | 'CLOSED_WIN' | 'CLOSED_LOSS' | 'CLOSED_TRAILING';
  entryPrice: number;
  entryTime: string;
  quantity: number;
  exitPrice?: number;
  exitTime?: string;
  exitReason?: string;
  stopLoss: number;
  target1: number;
  target2?: number;
  trailingStop?: number;
  pnl: number;
  pnlPercent: number;
  rMultiple: number;
  durationMinutes: number;
}

// Regime types
export interface Regime {
  indexName: string;
  scripCode: string;
  timestamp: string;
  label: string;
  regimeStrength: number;
  regimeCoherence: number;
  flowAgreement: number;
  volatilityState: string;
  tf1DLabel: string;
  tf1DStrength: number;
  tf2HLabel: string;
  tf2HStrength: number;
  tf30mLabel: string;
  tf30mStrength: number;
}

// Trade Stats
export interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgRMultiple: number;
}

// WebSocket message types
export interface WsMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
}

// Notification
export interface Notification {
  type: string;
  message: string;
  timestamp: number;
}

// Master Architecture (FF1) Signal
export interface MasterArchSignal {
  scripCode: string;
  companyName: string;
  timestamp: string;
  decision: 'ENTER_NOW' | 'WATCHLIST' | 'MONITOR' | 'REJECT';
  finalScore: number;
  directionConfidence: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  recommendedLots: number;
  hedgeRecommended: boolean;
  hedgeType?: string;
  indexContextScore: number;
  securityContextScore: number;
  signalStrengthScore: number;
  decisionReason: string;
  actionable: boolean;
}

// ACL (Anti-Cycle Limiter) Data
export interface ACLData {
  scripCode?: string;
  indexName?: string;
  timestamp: string;
  aclState: 'EARLY_TREND' | 'MID_TREND' | 'LATE_TREND' | 'EXHAUSTION' | 'TRANSITION' | 'UNKNOWN';
  exhaustionNear: boolean;
  trendDirection: number;
  aclMultiplier: number;
  agreementScore: number;
  trendAge30m: number;
  trendAge2H: number;
  trendAge4H: number;
  trendAge1D: number;
  flow30m?: number;
  flow2H?: number;
  flow4H?: number;
  flow1D?: number;
}

// FUDKII (First-Up/Down-Kill Ignition Indicator) Data
export interface FUDKIIData {
  scripCode: string;
  companyName: string;
  timestamp: string;
  ignitionFlag: boolean;
  direction: 'BULLISH_IGNITION' | 'BEARISH_IGNITION' | 'NO_IGNITION';
  fudkiiStrength: number;
  simultaneityScore: number;
  priceBreaking: boolean;
  volumeSurging: boolean;
  momentumPositive: boolean;
  atrExpanding: boolean;
  flowConfirming: boolean;
}


export * from './indicators';
