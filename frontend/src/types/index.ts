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
  strategy?: string;
  executionMode?: 'AUTO' | 'MANUAL';
  // Dual equity/option levels for strategy trades
  equitySl?: number;
  equityT1?: number;
  equityT2?: number;
  equityT3?: number;
  equityT4?: number;
  optionSl?: number;
  optionT1?: number;
  optionT2?: number;
  optionT3?: number;
  optionT4?: number;
  target3?: number;
  target4?: number;
  // Target hit tracking
  t1Hit?: boolean;
  t2Hit?: boolean;
  t3Hit?: boolean;
  t4Hit?: boolean;
  slHit?: boolean;
  // Instrument type & exchange
  instrumentType?: string;
  exchange?: string;  // N=NSE, M=MCX, C=Currency, B=BSE
  delta?: number;
  deltaFallbackReason?: string;  // null = real BS delta, non-null = why fallback to 0.5
  // Trade execution metadata
  tradeLabel?: string;    // e.g. "FUT FALLBACK due to Illiquid Opt"
  exitReason?: string;    // "1% DD", "SL-EQ", "SL-OP", "T1-OP", "T2-EQ", "EOD", etc.
  confidence?: number;
  // F5 — orphan remediation feed state
  feedState?: 'HEALTHY' | 'DEGRADED' | 'ORPHAN_PROXY' | 'ORPHAN_BLIND' | 'EXITING';
  feedStateAt?: number;   // epoch ms when current feedState was entered
  equityLtp?: number;     // live equity/futures price for dual display
  // Transaction charges (Zerodha round-trip)
  totalCharges?: number;
  chargesBrokerage?: number;
  chargesStt?: number;
  chargesExchange?: number;
  chargesGst?: number;
  chargesSebi?: number;
  chargesStamp?: number;
  // Per-target exit history
  exitHistory?: ExitEvent[];
  // Slippage estimation
  estimatedEntrySlippageTotal?: number;
  estimatedSlippagePct?: number;
  // Recalibration metadata (from RecalibrationService)
  recalDelta?: number;
  recalGamma?: number;
  recalCount?: number;
  lastRecalReason?: string;
  lastRecalTime?: string;
  recalTimePhase?: string;
  currentSl?: number;
  // Greek trailing state
  greekTrailingActive?: boolean;
  hardFloorSl?: number;
  greekTrail?: {
    status?: string;
    peakDelta?: number;
    highWatermark?: number;
    currentDelta?: number;
    currentGamma?: number;
    currentTheta?: number;
    trailStopPrice?: number;
    currentTrailPct?: number;
    thetaBurnRate?: number;
    deltaAccelRatio?: number;
    dte?: number;
    exitReason?: string;
  };
}

export interface ExitEvent {
  level: string;       // "T1", "T2", "T3", "T4"
  lots: number;
  qty: number;
  price: number;
  timestamp: number;   // epoch ms
  source: string;      // "T1-OP", "T2-EQ", etc.
  pnl?: number;        // net realized PnL for this exit tranche
}

// Family Score types
export interface FamilyScore {
  scripCode: string;
  companyName: string;
  timeframe: string;
  timestamp: string;
  humanReadableTime?: string;
  triggerTimeframe?: string;

  // MTIS Score (the main score)
  mtis: number;               // -100 to +100
  mtisLabel: string;          // "STRONG_BULLISH", "BEARISH", etc.
  mtisTrend: string;          // "RISING", "FALLING", "STABLE"
  previousMtis?: number;
  mtisChange?: number;
  rawMtis?: number;

  // Modifiers
  sessionModifier?: number;
  cprModifier?: number;
  expiryModifier?: number;

  // Price data
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
  // Raw OI data for transparency
  totalCallOI?: number;
  totalPutOI?: number;
  totalCallOIChange?: number;
  totalPutOIChange?: number;
  callOiBuildingUp?: boolean;
  putOiUnwinding?: boolean;

  // Gates
  hardGatePassed: boolean;
  hardGateReason: string;
  mtfGatePassed: boolean;
  mtfGateReason: string;
  qualityGatePassed: boolean;
  qualityGateReason: string;
  statsGatePassed: boolean;
  statsGateReason: string;

  // Overall / Legacy
  overallScore: number;
  direction: string;
  signalEmitted: boolean;

  // Flags
  hasDivergence?: boolean;
  hasExhaustion?: boolean;
  actionable?: boolean;
  fudkiiIgnition?: boolean;
  cprWidth?: string;
  expiryDay?: boolean;
  sessionPhase?: string;

  // Warnings
  warnings?: FamilyScoreWarning[];

  // Contributors
  contributors?: FamilyScoreContributor[];
  summary?: string;

  // Breakdown
  breakdown?: FamilyScoreBreakdown;

  moduleDetails?: Record<string, unknown>;
}

export interface FamilyScoreWarning {
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
}

export interface FamilyScoreContributor {
  category: string;
  points: number;
  reason: string;
  dataSource?: string;
  rawValue?: string;
}

export interface FamilyScoreBreakdown {
  priceScore: number;
  foAlignmentScore: number;
  ipuScore: number;
  fudkiiBonus: number;
  microstructureScore: number;
  orderbookScore: number;
  mtfRegimeScore: number;
  patternBonus: number;
  levelRetestBonus: number;
  relativeStrengthBonus: number;
  mtisMomentumBonus: number;
  tfScores?: Record<string, TFScoreDetail>;
}

export interface TFScoreDetail {
  timeframe: string;
  score: number;
  weight: number;
  weightedScore: number;
  lastUpdated: number;
  stale: boolean;
}

// Signal types
export interface Signal {
  signalId: string;
  scripCode: string;
  companyName: string;
  timestamp: string;

  // Signal Source - SMTIS v2.0 and legacy
  signalSource?: 'PATTERN' | 'SETUP' | 'FORECAST' | 'INTELLIGENCE' | 'QUANT' | 'MASTER_ARCH' | 'MTIS' | 'VCP' | 'IPU' | 'FUDKII' | 'BB_SUPERTREND' | 'CURATED' | string;
  signalSourceLabel?: string;
  isMasterArch?: boolean;

  // SMTIS v2.0 enrichment fields
  category?: 'BREAKOUT' | 'BREAKDOWN' | 'REVERSAL' | 'TREND_CONTINUATION' | 'MOMENTUM' | 'MEAN_REVERSION' | string;
  horizon?: 'SCALP' | 'INTRADAY' | 'SWING' | 'POSITIONAL' | string;
  qualityScore?: number;
  patternId?: string;
  setupId?: string;
  narrative?: string;
  expiresAt?: string;
  predictions?: string[];
  invalidationWatch?: string[];
  gexRegime?: string;
  session?: string;
  daysToExpiry?: number;
  atConfluenceZone?: boolean;

  signalType: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'LONG' | 'SHORT' | 'UNKNOWN';
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

  // Master Architecture specific (legacy)
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
  strategy?: string;
  executionMode?: 'AUTO' | 'MANUAL';
  totalCharges?: number;
  // Signal enrichment metrics
  atr?: number;
  volumeSurge?: number;
  oiChangePercent?: number;
  blockDealPercent?: number;
  riskReward?: number;
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

// FUDKII Signal - SuperTrend flip + Bollinger Band breakout
// BULLISH: SuperTrend flips UP AND close > BB_UPPER
// BEARISH: SuperTrend flips DOWN AND close < BB_LOWER
export interface FUDKIIData {
  scripCode: string;
  symbol?: string;
  companyName?: string;
  exchange?: string;
  triggerTime: string;

  // Trigger state
  triggered: boolean;
  direction: 'BULLISH' | 'BEARISH' | 'NONE';
  reason: string;
  triggerPrice: number;
  triggerScore: number;

  // Bollinger Bands (20, 2)
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;

  // SuperTrend (10, 3)
  superTrend: number;
  trend: 'UP' | 'DOWN' | 'NONE';
  trendChanged: boolean;
  pricePosition: 'ABOVE_UPPER' | 'BETWEEN' | 'BELOW_LOWER';
}


// QuantScore types (Institutional-Grade Scoring System)
export interface QuantScore {
  symbol: string;
  scripCode: string;
  companyName?: string;
  timestamp: number;
  timeframe: string;
  humanReadableTime: string;

  // Main Score
  quantScore: number;           // 0-100
  quantLabel: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  confidence: number;           // 0-1
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  directionalStrength: number;  // -1 to +1

  // Score Breakdown
  breakdown?: QuantScoreBreakdown;

  // Summaries
  greeksSummary?: GreeksSummary;
  ivSummary?: IVSummary;
  microstructureSummary?: MicrostructureSummary;
  optionsFlowSummary?: OptionsFlowSummary;
  priceActionSummary?: PriceActionSummary;
  volumeProfileSummary?: VolumeProfileSummary;

  // Warnings and status
  warnings?: QuantWarning[];
  actionable: boolean;
  actionableReason?: string;
  dataQuality?: DataQuality;
}

export interface QuantScoreBreakdown {
  greeksScore: number;
  ivSurfaceScore: number;
  microstructureScore: number;
  optionsFlowScore: number;
  priceActionScore: number;
  volumeProfileScore: number;
  crossInstrumentScore: number;
  confluenceScore: number;

  greeksPct: number;
  ivSurfacePct: number;
  microstructurePct: number;
  optionsFlowPct: number;
  priceActionPct: number;
  volumeProfilePct: number;
  crossInstrumentPct: number;
  confluencePct: number;

  rawScore: number;
  regimeModifier: number;
  confidenceModifier: number;
}

export interface GreeksSummary {
  totalDelta: number;
  totalGamma: number;
  totalVega: number;
  totalTheta: number;
  gammaSqueezeRisk: boolean;
  gammaSqueezeDistance: number;
  maxGammaStrike: number;
  deltaBias: string;
  vegaStructure: string;
  riskScore: number;
}

export interface IVSummary {
  atmIV: number;
  ivRank: number;
  ivSignal: string;
  ivCrushRisk: boolean;
  ivVelocity: number;
  smileShape: string;
  termStructure: string;
  skew25Delta: number;
  nearTermIV?: number;
  farTermIV?: number;
}

export interface MicrostructureSummary {
  avgOFI: number;
  avgVPIN: number;
  avgDepthImbalance: number;
  avgKyleLambda: number;
  avgSpread: number;
  aggressiveBuyRatio: number;
  aggressiveSellRatio: number;
  flowDirection: string;
  flowStrength: number;
}

export interface OptionsFlowSummary {
  pcr: number;
  pcrChange: number;
  pcrSignal: string;
  oiBuildupType: string;
  futuresBuildup: string;
  spotFuturePremium: number;
  // Raw OI data for transparency
  totalCallOI?: number;
  totalPutOI?: number;
  totalCallOIChange?: number;
  totalPutOIChange?: number;
}

export interface PriceActionSummary {
  sequenceType: string;
  momentumSlope: number;
  wyckoffPhase: string;
  wyckoffStrength: number;
  pcrDivergence: boolean;
  oiDivergence: boolean;
}

export interface VolumeProfileSummary {
  poc: number;
  vah: number;
  val: number;
  pocMigration: number;
  pocTrend: string;
  valueAreaExpanding: boolean;
}

export interface QuantWarning {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  recommendation?: string;
}

export interface DataQuality {
  hasGreeks: boolean;
  hasIVSurface: boolean;
  hasMicrostructure: boolean;
  hasOptionsFlow: boolean;
  hasPriceAction: boolean;
  hasVolumeProfile: boolean;
  hasCrossInstrument: boolean;
  // Applicability: true when category SHOULD have data for this instrument
  greeksApplicable?: boolean;
  ivSurfaceApplicable?: boolean;
  crossInstrumentApplicable?: boolean;
  completenessScore: number;
  qualityLevel: 'FULL' | 'PARTIAL' | 'MINIMAL';
}

export interface QuantScoreStats {
  totalSymbols: number;
  bullishCount: number;
  bearishCount: number;
  actionableCount: number;
  averageScore: number;
  maxScore: number;
}

export * from './indicators';
export * from './orders';

// ==================== Performance Analytics Types ====================

export interface PerformanceMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgRMultiple: number;
  profitFactor: number;
  expectancy: number;
  drawdown: DrawdownAnalysis;
  streaks: StreakAnalysis;
  dailyPerformance: DailyPerformance[];
  weeklyPerformance: WeeklyPerformance[];
  monthlyPerformance: MonthlyPerformance[];
  winRateTrend: WinRateTrend[];
  bySource: Record<string, SourcePerformance>;
  byExitReason: Record<string, OutcomeStats>;
  byCategory: Record<string, OutcomeStats>;
  timeAnalysis: TimeAnalysis;
  strategyDetails: StrategyDetail[];
  bestByExchange: Record<string, StrategyDetail>;
  lastUpdated: string;
}

export interface StrategyDetail {
  strategy: string;
  exchange: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  profitPercent: number;
  roi: number;
  maxDrawdownPercent: number;
  maxCapitalEmployed: number;
}

export interface DrawdownAnalysis {
  maxDrawdown: number;
  maxDrawdownPercent: number;
  currentDrawdown: number;
  currentDrawdownPercent: number;
  drawdownStart: string | null;
  drawdownEnd: string | null;
  recoveryPeriod: number;
}

export interface StreakAnalysis {
  currentStreak: number;
  currentStreakType: 'WIN' | 'LOSS' | 'NONE';
  maxWinStreak: number;
  maxLossStreak: number;
  avgWinStreak: number;
  avgLossStreak: number;
}

export interface DailyPerformance {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
}

export interface WeeklyPerformance {
  weekStart: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
}

export interface MonthlyPerformance {
  month: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
}

export interface WinRateTrend {
  period: string;
  winRate: number;
  trades: number;
}

export interface SourcePerformance {
  source: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgRMultiple: number;
  maxDrawdownPercent: number;
  maxCapitalEmployed: number;
  avgHoldingTime: number;
  minHoldingTime: number;
  maxHoldingTime: number;
}

export interface OutcomeStats {
  count: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

export interface TimeAnalysis {
  bestTradingHour: number;
  worstTradingHour: number;
  bestTradingDay: string;
  worstTradingDay: string;
  avgHoldingTime: number;
  byHour: Record<number, OutcomeStats>;
  byDayOfWeek: Record<string, OutcomeStats>;
}

// ==================== Pattern Signal Types ====================

export interface PatternSignal {
  patternId: string;
  signalId?: string;
  scripCode: string;
  symbol?: string;
  exchange?: string;
  companyName: string;
  patternType: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  status: 'ACTIVE' | 'COMPLETED_WIN' | 'COMPLETED_LOSS' | 'EXPIRED' | 'INVALIDATED';
  confidence: number;
  qualityScore: number;
  entryPrice: number;
  stopLoss?: number | null;
  target1?: number | null;
  target2?: number | null;
  target3?: number | null;
  target4?: number | null;
  riskRewardRatio?: number | null;
  invalidationPrice?: number;
  timeframe?: string;
  patternDescription?: string;
  triggerCondition?: string;
  gexRegime?: string;
  session?: string;
  daysToExpiry?: number;
  triggeredAt: string;
  expiresAt?: string;
  completedAt?: string;
  actualPnl?: number;
  rMultiple?: number;
  // Volume gate (Flaw 2)
  volumeConfirmed?: boolean;
  volumeRatio?: number;
  // Regime enrichment (Flaw 3)
  marketRegime?: string;
  tradingMode?: string;
  // SL source (Flaw 4)
  slSource?: string;
  atr30m?: number;
  pivotSource?: boolean;
  // Spread estimation (Flaw 6)
  estimatedSpreadPct?: number;
  spreadImpactPct?: number;
  // Option/futures enrichment (from OptionDataEnricher)
  optionAvailable?: boolean;
  optionFailureReason?: string;
  optionScripCode?: string;
  optionSymbol?: string;
  optionStrike?: number;
  optionType?: 'CE' | 'PE';
  optionExpiry?: string;
  optionLtp?: number;
  optionLotSize?: number;
  optionMultiplier?: number;
  futuresAvailable?: boolean;
  futuresScripCode?: string;
  futuresSymbol?: string;
  futuresLtp?: number;
  futuresLotSize?: number;
  futuresMultiplier?: number;
  futuresExpiry?: string;
}

export interface PatternSummary {
  totalActive: number;
  totalCompleted: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  activeByType: Record<string, number>;
}

export interface PatternStats {
  patternType: string;
  totalOccurrences: number;
  wins: number;
  losses: number;
  totalPnl: number;
  winRate: number;
  avgPnl: number;
}

// ==================== Risk Analytics Types ====================

// ==================== Risk Types (per-strategy, real wallet data) ====================

export interface StrategyRiskProfile {
  strategy: string
  displayName: string
  currentBalance: number
  initialCapital: number
  usedMargin: number
  availableMargin: number
  dayPnl: number
  unrealizedPnl: number
  peakBalance: number
  maxDrawdown: number
  maxDailyLoss: number
  circuitBreakerTripped: boolean
  circuitBreakerReason: string | null
  winRate: number
  profitFactor: number
  totalTradeCount: number
  dayTradeCount: number
  openPositionCount: number
  healthScore: number
  healthStatus: 'HEALTHY' | 'DEGRADING' | 'CRITICAL'
  drawdownPercent: number
  dailyLossPercent: number
  marginUtilPercent: number
  last10WinRate: number
  winRateDeclining: boolean
  consecutiveLosses: number
  avgRMultiple: number
  last10AvgPnl: number
}

export interface PortfolioRiskSummary {
  strategies: StrategyRiskProfile[]
  totalBalance: number
  totalUnrealizedPnl: number
  totalDayPnl: number
  totalUsedMargin: number
  totalAvailableMargin: number
  overallHealthScore: number
  overallHealthStatus: string
  totalOpenPositions: number
  circuitBreakersTripped: number
  alerts: RiskAlert[]
  lastUpdated: string
}

export interface DrawdownPoint {
  timestamp: string
  balance: number
  peakBalance: number
  drawdownPercent: number
  pnl: number
}

export interface RiskAlert {
  strategy: string
  type: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  message: string
  recommendation: string
}

// Legacy types kept for RiskStatusPanel compatibility
export interface RiskStatus {
  healthy: boolean
  status: string
  message: string
  circuitBreakerTripped: boolean
  circuitBreakerReason: string | null
  dailyLossPercent: number
  dailyLossAmount: number
  dailyLossLimit: number
  drawdownPercent: number
  drawdownAmount: number
  drawdownLimit: number
  openPositions: number
  maxOpenPositions: number
  currentBalance: number
  availableMargin: number
}

// ==================== Trade Intelligence Types ====================

export interface TradeIntelligenceReport {
  periodSummary: PeriodSummary
  exitDistribution: Record<string, ExitDistribution>
  targetFunnel: TargetFunnel
  rMultipleDistribution: RMultipleBucket[]
  meanR: number
  medianR: number
  percentAbove1R: number
  timeOfDayHeatmap: HourStats[]
  durationByOutcome: DurationStats[]
  topInstruments: InstrumentPerf[]
  bottomInstruments: InstrumentPerf[]
  lossClusterAnalysis: LossCluster[]
  periodComparison: PeriodComparison | null
  strategyCorrelation: CorrelationMatrix | null
  // Deep analytics
  directionalAnalysis: DirectionalAnalysis | null
  dayOfWeekPerformance: DayOfWeekStats[]
  strategyExchangeMatrix: StrategyExchangeCell[]
  confidenceAnalysis: ConfidenceVsOutcome[]
  partialExitAnalysis: PartialExitAnalysis | null
  streakAnalysis: DeepStreakAnalysis | null
  holdingPeriodAnalysis: TradeDecayPoint[]
  riskRewardAnalysis: RiskRewardAnalysis | null
  lastUpdated: string
}

export interface PeriodSummary {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  avgPnlPerTrade: number
  bestDay: string
  bestDayPnl: number
  worstDay: string
  worstDayPnl: number
  profitableDays: number
  totalTradingDays: number
  slRate: number
  avgRMultiple: number
  profitFactor: number
}

export interface ExitDistribution {
  strategy: string
  totalTrades: number
  slCount: number
  t1Count: number
  t2Count: number
  t3Count: number
  t4Count: number
  eodCount: number
  otherCount: number
  slPercent: number
  t1Percent: number
  t2Percent: number
  t3Percent: number
  t4Percent: number
  eodPercent: number
  otherPercent: number
  avgSlLoss: number
  avgSlDurationMin: number
  slWithin5Min: number
  slWithin5MinPercent: number
}

export interface TargetFunnel {
  totalTrades: number
  survivedSl: number
  t1HitRate: number
  t2HitRate: number
  t3HitRate: number
  t4HitRate: number
  t1ToT2Conversion: number
  t2ToT3Conversion: number
  t3ToT4Conversion: number
  avgTimeToT1Min: number
  avgTimeToT2Min: number
  avgTimeToT3Min: number
  avgTimeToT4Min: number
}

export interface RMultipleBucket {
  range: string
  count: number
  percent: number
  avgPnl: number
}

export interface HourStats {
  hour: number
  trades: number
  winRate: number
  avgPnl: number
  slPercent: number
  assessment: string
}

export interface DurationStats {
  exitType: string
  avgDurationMin: number
  medianDurationMin: number
  count: number
}

export interface InstrumentPerf {
  scripCode: string
  companyName: string
  trades: number
  winRate: number
  totalPnl: number
  avgPnl: number
  slPercent: number
  avgRMultiple: number
}

export interface LossCluster {
  name: string
  description: string
  tradeCount: number
  percentOfLosses: number
  avgPnl: number
  avgConfidence: number
  recommendation: string
}

export interface PeriodComparison {
  current: PeriodMetrics
  previous: PeriodMetrics
  insight: string
}

export interface PeriodMetrics {
  label: string
  tradeCount: number
  winRate: number
  avgPnl: number
  totalPnl: number
  slPercent: number
  avgRMultiple: number
  profitFactor: number
  avgHoldWin: number
  avgHoldLoss: number
  profitableDays: number
  totalTradingDays: number
}

export interface CorrelationMatrix {
  strategies: string[]
  correlations: Record<string, Record<string, number>>
  effectiveDiversification: number
  insight: string
}

// ==================== Deep Trade Analytics Types ====================

export interface DirectionalAnalysis {
  longStats: DirectionStats
  shortStats: DirectionStats
  byStrategy: StrategyDirectionStats[]
  insight: string
}

export interface DirectionStats {
  direction: string
  trades: number
  winRate: number
  avgPnl: number
  totalPnl: number
  avgRMultiple: number
  slPercent: number
  profitFactor: number
}

export interface StrategyDirectionStats {
  strategy: string
  longStats: DirectionStats
  shortStats: DirectionStats
  edge: string // "LONG", "SHORT", "NEUTRAL"
}

export interface DayOfWeekStats {
  day: string
  dayNumber: number
  trades: number
  winRate: number
  avgPnl: number
  totalPnl: number
  slPercent: number
  assessment: string
}

export interface StrategyExchangeCell {
  strategy: string
  exchange: string
  trades: number
  winRate: number
  avgPnl: number
  totalPnl: number
  slPercent: number
  avgRMultiple: number
  profitFactor: number
}

export interface ConfidenceVsOutcome {
  bucket: string
  trades: number
  winRate: number
  avgPnl: number
  avgRMultiple: number
  totalPnl: number
  profitable: boolean
}

export interface PartialExitAnalysis {
  tradesWithT1: number
  t1ThenStopped: number
  t1ThenT2: number
  t1ThenT2ThenStopped: number
  t1ThenT2ThenT3: number
  reachedAllTargets: number
  avgPnlAfterT1Partial: number
  trailingEffectiveness: number
  insight: string
}

export interface DeepStreakAnalysis {
  maxWinStreak: number
  maxLossStreak: number
  currentStreak: number
  avgPnlAfterWin: number
  avgPnlAfterLoss: number
  winRateAfterWin: number
  winRateAfterLoss: number
  insight: string
}

export interface TradeDecayPoint {
  bucket: string
  trades: number
  winRate: number
  avgPnl: number
  avgRMultiple: number
  assessment: string
}

export interface RiskRewardAnalysis {
  avgPlannedRR: number
  avgActualRR: number
  rrCapturePercent: number
  avgWinnerR: number
  avgLoserR: number
  tradesAbove2R: number
  tradesAbove3R: number
  percentAbove2R: number
  insight: string
}

// ==================== Strategy Tuning Types ====================

export interface StrategyTuningReport {
  strategy: string
  tradeCount: number
  period: string
  slAnalysis: SLAnalysis
  targetAnalysis: TargetAnalysis
  positionSizing: PositionSizingAnalysis
  confidenceGate: ConfidenceGateAnalysis
  lastUpdated: string
}

export interface SLAnalysis {
  currentAtrMultiplier: number
  avgSlDistance: number
  avgAtrAtEntry: number
  slAtrRatio: number
  slHitRate: number
  avgSlLoss: number
  slWithin5Min: number
  slWithin5MinPercent: number
  exchangeBreakdown: ExchangeSLStats[]
  recommendations: TuningRecommendation[]
}

export interface ExchangeSLStats {
  exchange: string
  slRate: number
  avgSlLoss: number
  tradeCount: number
  recommendation: string
}

export interface TuningRecommendation {
  id: string
  title: string
  description: string
  configKey: string
  configFile: string
  currentValue: string
  recommendedValue: string
  estimatedImpact: string
  exchange: string
}

export interface TargetAnalysis {
  targetLevels: TargetLevelStats[]
  currentMultipliers: number[]
  currentAllocation: number[]
  recommendations: TuningRecommendation[]
}

export interface TargetLevelStats {
  level: string
  hitRate: number
  avgPnlWhenHit: number
  avgDurationMin: number
  contribution: number
}

export interface PositionSizingAnalysis {
  currentRiskPercent: number
  avgCapitalEmployed: number
  avgRiskPerTrade: number
  riskPercentOfCapital: number
  walletEfficiency: WalletEfficiency[]
  kellyFraction: number
  halfKellyPercent: number
  recommendations: TuningRecommendation[]
}

export interface WalletEfficiency {
  strategy: string
  currentBalance: number
  usedMargin: number
  idleCapital: number
  idlePercent: number
  recommendedRiskPercent: number
  reason: string
}

export interface ConfidenceGateAnalysis {
  currentGate: number
  buckets: ConfidenceBucket[]
  optimalGate: number
  recommendations: TuningRecommendation[]
}

export interface ConfidenceBucket {
  range: string
  tradeCount: number
  winRate: number
  avgPnl: number
  avgRMultiple: number
  profitable: boolean
}

export interface SimulationResult {
  totalTrades: number
  affectedTrades: number
  currentTotalPnl: number
  simulatedTotalPnl: number
  netImpact: number
  currentWinRate: number
  simulatedWinRate: number
  description: string
  details: SimulationDetail[]
}

export interface SimulationDetail {
  configKey: string
  currentValue: string
  proposedValue: string
  impact: string
}

export interface ConfigChange {
  changeId: string
  service: string
  changes: ConfigDiff[]
  reason: string
  appliedAt: string
  rolledBack: boolean
}

export interface ConfigDiff {
  key: string
  oldValue: string
  newValue: string
}

// ==================== Alert History Types ====================

export interface AlertHistory {
  id: string;
  type: 'SIGNAL' | 'PATTERN' | 'RISK' | 'SYSTEM' | 'TRADE' | 'PRICE' | string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  message: string;
  scripCode?: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AlertStats {
  totalAlerts: number;
  unreadCount: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  recentCount: number;
}

export interface AlertSummary {
  unreadCount: number;
  criticalCount: number;
  highCount: number;
  recentAlerts: AlertHistory[];
}

