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
  // Instrument type
  instrumentType?: string;
  delta?: number;
  // Trade execution metadata
  exitReason?: string;    // "1% DD", "SL-EQ", "SL-OP", "T1-OP", "T2-EQ", "EOD", etc.
  confidence?: number;
  equityLtp?: number;     // live equity/futures price for dual display
  // Per-target exit history
  exitHistory?: ExitEvent[];
}

export interface ExitEvent {
  level: string;       // "T1", "T2", "T3", "T4"
  lots: number;
  qty: number;
  price: number;
  timestamp: number;   // epoch ms
  source: string;      // "T1-OP", "T2-EQ", etc.
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
  lastUpdated: string;
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

export interface RiskMetrics {
  portfolioExposure: PortfolioExposure;
  concentrationRisk: ConcentrationRisk;
  sectorExposure: Record<string, number>;
  directionExposure: DirectionExposure;
  riskBreakdown: RiskBreakdown;
  valueAtRisk: ValueAtRisk;
  maxLossExposure: number;
  correlationMetrics: CorrelationMetrics;
  riskScore: RiskScore;
  alerts: RiskAlert[];
  lastUpdated: string;
}

export interface PortfolioExposure {
  longExposure: number;
  shortExposure: number;
  netExposure: number;
  grossExposure: number;
  longCount: number;
  shortCount: number;
  netDirection: string;
}

export interface ConcentrationRisk {
  herfindahlIndex: number;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH';
  uniqueStocks: number;
  topHoldings: Record<string, number>;
  singleStockMaxPercent: number;
}

export interface DirectionExposure {
  bullishPercent: number;
  bearishPercent: number;
  neutralPercent: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}

export interface RiskBreakdown {
  totalRiskAmount: number;
  averageRiskPerTrade: number;
  averageRiskReward: number;
  openPositions: number;
}

export interface ValueAtRisk {
  var95: number;
  var99: number;
  expectedShortfall: number;
  sampleSize: number;
}

export interface CorrelationMetrics {
  sourceConcentration: number;
  diversificationScore: number;
  signalsBySource: Record<string, number>;
}

export interface RiskScore {
  score: number;
  level: 'LOW' | 'MODERATE' | 'HIGH';
  concentrationComponent: number;
  exposureComponent: number;
  varComponent: number;
}

export interface RiskAlert {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  recommendation?: string;
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

