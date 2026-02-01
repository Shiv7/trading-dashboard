
// IPU Signal types
export interface IPUSignal {
  scripCode: string;
  companyName: string;
  timeframe: string;
  timestamp: string;

  // Overall Score
  ipuFinalScore: number;
  ipuDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';

  // Core Components
  institutionalProxy: number;
  momentum: number;
  exhaustion: number;
  urgency: number;

  // Volume Metrics
  aggressiveBuyVolume: number;
  aggressiveSellVolume: number;
  totalVolume: number;
  volumeExpansionPct: number;
  aggressiveVolumeRatio: number;

  // Directional Conviction
  directionalConviction: number;
  volumeDeltaPct: number;

  // X-Factor
  dibTriggered: boolean;
  vibTriggered: boolean;
  hasXFactor: boolean;

  // Adjustments
  gapStatus: string;
  gapConvictionMultiplier: number;
  liquidityTier: string;
  liquidityPenalty: number;
  
  // OFI
  ofiPressure: number;
  ofiSignal: string;

  // Metrics
  priceEfficiency: number;
  runBarTriggered: boolean;
  momentumState: string;
  usedPassiveVolume: boolean;
}

// VCP Signal types
export interface VolumeCluster {
  price: number;
  type: 'SUPPLY' | 'DEMAND' | 'POC' | 'VA_HIGH' | 'VA_LOW' | 'UNKNOWN';
  volume: number;
  penetrationScore: number;
  distanceFromPrice: number | null;
  isActive: boolean;
  significance: 'STRONG' | 'MEDIUM' | 'WEAK';
}

export interface VCPSignal {
  scripCode: string;
  companyName: string;
  timeframe: string;
  timestamp: string;

  // Overall Score
  vcpCombinedScore: number;
  vcpSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';

  // Clusters
  clusters: VolumeCluster[];
  pocCluster: VolumeCluster | null;
  vahCluster: VolumeCluster | null;
  valCluster: VolumeCluster | null;

  // Scores
  runwayScore: number;
  structuralBias: number;
  penetrationScore: number;
  alignmentScore: number;

  // Context
  currentPrice: number;
  kyleLambda: number;
  pricePosition: 'ABOVE_POC' | 'BELOW_POC' | 'AT_POC';

  // Metrics
  totalClusters: number;
  avgClusterStrength: number;
  hasStrongSupport: boolean;
  hasStrongResistance: boolean;

  // Profile
  totalVolume: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  pointOfControl: number;
}

// Technical Indicators (Bollinger Bands, VWAP, SuperTrend)
export interface TechnicalIndicators {
  scripCode: string;
  symbol: string;
  companyName: string;
  timeframe: string;
  timestamp: number;
  currentPrice: number;

  // Bollinger Bands
  bollingerBands: {
    upper: number;
    middle: number;     // SMA20
    lower: number;
    width: number;      // Absolute width
    widthPct: number;   // Width as % of middle
    percentB: number;   // 0-1 scale, >1 = above upper, <0 = below lower
    squeeze: boolean;   // Is width < 2%
  };

  // VWAP
  vwap: {
    value: number;
    upperBand: number;
    lowerBand: number;
    stdDev: number;
    signal: 'ABOVE_UPPER' | 'ABOVE_VWAP' | 'BELOW_VWAP' | 'BELOW_LOWER' | 'NEUTRAL';
    deviation: number;  // % deviation from VWAP
  };

  // SuperTrend
  superTrend: {
    value: number;
    direction: 'BULLISH' | 'BEARISH';
    reversal: boolean;
    candlesSinceFlip: number;
    atr: number;
    atrPercent: number;
  };

  // Data Quality
  dataQuality: {
    sufficient: boolean;
    actualCandleCount: number;
    requiredCandleCount: number;
  };
}

// Raw API response format (matches backend TechnicalIndicatorDTO)
export interface TechnicalIndicatorDTO {
  scripCode: string;
  symbol: string;
  companyName: string;
  timeframe: string;
  timestamp: number;
  currentPrice: number;

  // ==================== MOVING AVERAGES ====================
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  vwma20: number | null;  // Volume Weighted MA

  // ==================== RSI ====================
  rsi14: number | null;
  rsiSmoothed: number | null;
  rsiZone: string | null;  // OVERSOLD, NEUTRAL, OVERBOUGHT

  // ==================== MACD ====================
  macdLine: number | null;      // EMA12 - EMA26
  macdSignal: number | null;    // EMA9 of MACD
  macdHistogram: number | null; // MACD - Signal
  macdCrossover: string | null; // BULLISH_CROSS, BEARISH_CROSS, BULLISH, BEARISH, NEUTRAL

  // ==================== BOLLINGER BANDS ====================
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  bbWidthPct: number | null;
  bbPercentB: number | null;
  bbSqueeze: boolean | null;
  bbPosition: string | null;  // ABOVE_UPPER, UPPER_HALF, MIDDLE, LOWER_HALF, BELOW_LOWER

  // ==================== VWAP ====================
  vwap: number | null;
  vwapUpperBand: number | null;
  vwapLowerBand: number | null;
  vwapStdDev: number | null;
  vwapSignal: string | null;  // ABOVE_UPPER, ABOVE_VWAP, BELOW_VWAP, BELOW_LOWER, NEUTRAL
  vwapDeviation: number | null;

  // ==================== ATR ====================
  atr: number | null;
  atrPercent: number | null;
  atrMultiple: number | null;

  // ==================== SUPERTREND ====================
  superTrendValue: number | null;
  superTrendDirection: string | null;  // UP, DOWN (or BULLISH, BEARISH)
  superTrendReversal: boolean | null;
  candlesSinceFlip: number | null;

  // ==================== ADX ====================
  adx14: number | null;
  plusDI: number | null;
  minusDI: number | null;
  trendStrength: string | null;  // STRONG, MODERATE, WEAK, NO_TREND

  // ==================== STOCHASTIC ====================
  stochK: number | null;
  stochD: number | null;
  stochZone: string | null;  // OVERSOLD, NEUTRAL, OVERBOUGHT

  // ==================== PIVOT POINTS ====================
  pivotPoint: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;

  // ==================== VOLUME ====================
  volume: number | null;
  avgVolume20: number | null;
  volumeRatio: number | null;

  // ==================== DERIVED SIGNALS ====================
  goldenCross: boolean | null;
  deathCross: boolean | null;
  priceAboveEma21: boolean | null;
  priceAboveEma50: boolean | null;
  priceAboveSuperTrend: boolean | null;
  macdBullish: boolean | null;
  rsiBullish: boolean | null;

  // ==================== DATA QUALITY ====================
  dataQualitySufficient: boolean | null;
  actualCandleCount: number | null;
  requiredCandleCount: number | null;
}

// ===== UNIFIED CANDLE DTO (Merged Tick + Orderbook + OI) =====
export interface UnifiedCandleDTO {
  // Identity
  symbol: string;
  scripCode: string | null;
  companyName: string | null;
  exchange: string | null;
  exchangeType: string | null;
  instrumentType: string | null;
  timeframe: string;
  timestamp: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  windowEndMillis: number | null;

  // OHLCV
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  value: number | null;
  vwap: number | null;
  typicalPrice: number | null;

  // Trade Classification
  buyVolume: number | null;
  sellVolume: number | null;
  midpointVolume: number | null;
  volumeDelta: number | null;
  buyPressure: number | null;
  sellPressure: number | null;

  // Volume Profile
  vpin: number | null;
  vpinBucketSize: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;

  // Imbalance
  volumeImbalance: number | null;
  dollarImbalance: number | null;
  tickRuns: number | null;
  vibTriggered: boolean | null;
  dibTriggered: boolean | null;

  // Tick Intensity
  tickCount: number | null;
  ticksPerSecond: number | null;
  largeTradeCount: number | null;

  // Orderbook Data
  hasOrderbook: boolean | null;
  ofi: number | null;
  ofiMomentum: number | null;
  kyleLambda: number | null;
  microprice: number | null;
  bidAskSpread: number | null;
  spreadPercent: number | null;
  spreadVolatility: number | null;
  tightSpreadPercent: number | null;
  depthImbalance: number | null;
  weightedDepthImbalance: number | null;
  avgBidDepth: number | null;
  avgAskDepth: number | null;
  bidDepthSlope: number | null;
  askDepthSlope: number | null;
  depthConcentration: number | null;
  spoofingCount: number | null;
  icebergDetected: boolean | null;
  cancelRate: number | null;
  orderbookUpdateCount: number | null;
  lastOrderbookUpdate: string | null;
  orderbookStaleness: number | null;

  // Open Interest Data
  hasOI: boolean | null;
  openInterest: number | null;
  oiChange: number | null;
  oiChangePercent: number | null;
  oiInterpretation: string | null;
  oiInterpretationConfidence: number | null;
  oiSuggestsReversal: boolean | null;
  oiVelocity: number | null;
  oiAcceleration: number | null;
  previousDayOI: number | null;
  dailyOIChange: number | null;
  dailyOIChangePercent: number | null;
  oiStaleness: number | null;

  // Options Data
  strikePrice: number | null;
  optionType: string | null;
  expiry: string | null;
  daysToExpiry: number | null;

  // Data Quality
  quality: string | null;
  processingLatencyMs: number | null;
  tickStaleness: number | null;
}

// ===== VCP STATE DTO =====
export interface VolumeClusterDTO {
  priceLevel: number;
  volume: number;
  type: 'SUPPORT' | 'RESISTANCE' | 'POC' | 'VAH' | 'VAL';
  strength: number;
  touchCount: number;
  distanceFromPrice: number | null;
  percentFromPrice: number | null;
  lastTouched: string | null;
  isActive: boolean;
}

export interface VcpStateDTO {
  // Volume Profile Core
  poc: number | null;
  vah: number | null;
  val: number | null;
  valueAreaVolume: number | null;
  totalProfileVolume: number | null;
  valueAreaPercent: number | null;

  // Clusters
  supportClusters: VolumeClusterDTO[];
  resistanceClusters: VolumeClusterDTO[];

  // Runway Scores
  bullishRunway: number | null;
  bearishRunway: number | null;
  runwayDifference: number | null;

  // Scoring
  bias: number | null;
  structureScore: number | null;
  liquidityScore: number | null;

  // Context
  currentPrice: number | null;
  pricePosition: string | null;
  kyleLambda: number | null;
  calculatedAt: string | null;
}

// ===== IPU STATE DTO =====
export interface IpuSnapshotDTO {
  ipuScore: number | null;
  exhaustionScore: number | null;
  direction: string | null;
  instProxy: number | null;
  momentum: number | null;
  urgency: number | null;
  volumeScore: number | null;
  flowScore: number | null;
  timestamp: string | null;
}

export interface IpuStateDTO {
  // Current State
  currentIpuScore: number | null;
  currentExhaustion: number | null;
  currentDirection: string | null;  // BULLISH, BEARISH, NEUTRAL
  momentumState: string | null;  // ACCELERATING, DECELERATING, STEADY, EXHAUSTED

  // Rolling Averages
  avgIpuScore10: number | null;
  avgIpuScore20: number | null;
  ipuMomentum: number | null;

  // Component Scores
  volumeScore: number | null;
  priceActionScore: number | null;
  institutionalProxy: number | null;
  urgencyScore: number | null;
  flowScore: number | null;

  // X-Factor Triggers
  dibTriggered: boolean | null;
  vibTriggered: boolean | null;
  hasXFactor: boolean | null;

  // Volume Metrics
  aggressiveBuyVolume: number | null;
  aggressiveSellVolume: number | null;
  aggressiveVolumeRatio: number | null;
  volumeExpansionPct: number | null;

  // Directional Conviction
  directionalConviction: number | null;
  volumeDeltaPct: number | null;

  // OFI Metrics
  ofiPressure: number | null;
  ofiSignal: string | null;
  ofiVelocity: number | null;
  ofiAcceleration: number | null;

  // Adjustments
  gapStatus: string | null;
  gapConvictionMultiplier: number | null;
  liquidityTier: string | null;
  liquidityPenalty: number | null;

  // Price Efficiency
  priceEfficiency: number | null;
  runBarTriggered: boolean | null;

  // History
  history: IpuSnapshotDTO[];
  calculatedAt: string | null;
}

// ===== PIVOT STATE DTO =====
export interface SwingLevelDTO {
  price: number;
  barIndex: number | null;
  timestamp: string | null;
  strength: number | null;
  isValid: boolean | null;
  testCount: number | null;
  lastTest: string | null;
}

export interface PriceLevelDTO {
  price: number;
  type: 'SUPPORT' | 'RESISTANCE';
  source: string | null;  // SWING, PIVOT, VOLUME_CLUSTER, ROUND_NUMBER
  strength: number | null;
  touchCount: number | null;
  firstTouch: string | null;
  lastTouched: string | null;
  isActive: boolean | null;
  width: number | null;
}

export interface RetestEventDTO {
  levelType: string;
  levelPrice: number;
  retestTime: string | null;
  retestPrice: number | null;
  bounced: boolean | null;
  broke: boolean | null;
  bouncePercent: number | null;
  outcome: string | null;  // HELD, BROKE, WICKED_THROUGH
}

export interface PivotStateDTO {
  // Swing Points
  swingHighs: SwingLevelDTO[];
  swingLows: SwingLevelDTO[];
  lastSwingHigh: SwingLevelDTO | null;
  lastSwingLow: SwingLevelDTO | null;

  // Dynamic Levels
  supportLevels: PriceLevelDTO[];
  resistanceLevels: PriceLevelDTO[];

  // Daily Pivot Points
  dailyPivot: number | null;
  dailyR1: number | null;
  dailyR2: number | null;
  dailyR3: number | null;
  dailyS1: number | null;
  dailyS2: number | null;
  dailyS3: number | null;

  // Weekly Pivot Points
  weeklyPivot: number | null;
  weeklyR1: number | null;
  weeklyR2: number | null;
  weeklyS1: number | null;
  weeklyS2: number | null;

  // Market Structure
  structure: string | null;  // UPTREND, DOWNTREND, CONSOLIDATION, RANGE
  higherHighs: boolean | null;
  higherLows: boolean | null;
  lowerHighs: boolean | null;
  lowerLows: boolean | null;

  // Structure Breaks
  structureBreakDetected: boolean | null;
  structureBreakType: string | null;  // BULLISH_BOS, BEARISH_BOS
  structureBreakPrice: number | null;
  structureBreakTime: string | null;

  // Current Context
  currentPrice: number | null;
  nearestLevelType: string | null;
  distanceToNearestLevel: number | null;
  distancePercent: number | null;

  // Retest History
  recentRetests: RetestEventDTO[];
  calculatedAt: string | null;
}

// ===== STRATEGY STATE DTO (Combined) =====
export interface StrategyStateDTO {
  // Identity
  symbol: string;
  scripCode: string | null;
  companyName: string | null;
  timeframe: string;

  // Strategy States
  vcpState: VcpStateDTO | null;
  ipuState: IpuStateDTO | null;
  pivotState: PivotStateDTO | null;

  // Metadata
  lastUpdated: string | null;
  version: number | null;

  // Availability Flags
  hasVcpState: boolean | null;
  hasIpuState: boolean | null;
  hasPivotState: boolean | null;

  // Composite Scores
  compositeScore: number | null;
  compositeDirection: string | null;  // BULLISH, BEARISH, NEUTRAL
  compositeSignal: string | null;  // STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL
}

// History point for chart overlays
export interface IndicatorHistoryPoint {
  timestamp: number;
  currentPrice: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  vwap: number;
  vwapUpper: number;
  vwapLower: number;
  superTrend: number;
  superTrendDirection: 'BULLISH' | 'BEARISH';
}

// Helper function to convert API response to normalized format
export function normalizeIndicators(dto: TechnicalIndicatorDTO): TechnicalIndicators {
  return {
    scripCode: dto.scripCode,
    symbol: dto.symbol,
    companyName: dto.companyName,
    timeframe: dto.timeframe,
    timestamp: dto.timestamp,
    currentPrice: dto.currentPrice,

    bollingerBands: {
      upper: dto.bbUpper ?? 0,
      middle: dto.bbMiddle ?? 0,
      lower: dto.bbLower ?? 0,
      width: dto.bbWidth ?? 0,
      widthPct: dto.bbWidthPct ?? 0,
      percentB: dto.bbPercentB ?? 0.5,
      squeeze: dto.bbSqueeze ?? false,
    },

    vwap: {
      value: dto.vwap ?? 0,
      upperBand: dto.vwapUpperBand ?? 0,
      lowerBand: dto.vwapLowerBand ?? 0,
      stdDev: dto.vwapStdDev ?? 0,
      signal: (dto.vwapSignal as TechnicalIndicators['vwap']['signal']) ?? 'NEUTRAL',
      deviation: dto.vwapDeviation ?? 0,
    },

    superTrend: {
      value: dto.superTrendValue ?? 0,
      direction: (dto.superTrendDirection as 'BULLISH' | 'BEARISH') ?? 'BULLISH',
      reversal: dto.superTrendReversal ?? false,
      candlesSinceFlip: dto.candlesSinceFlip ?? 0,
      atr: dto.atr ?? 0,
      atrPercent: dto.atrPercent ?? 0,
    },

    dataQuality: {
      sufficient: dto.dataQualitySufficient ?? false,
      actualCandleCount: dto.actualCandleCount ?? 0,
      requiredCandleCount: dto.requiredCandleCount ?? 20,
    },
  };
}

// Convert API history response to chart-ready format
export function normalizeHistoryPoint(dto: TechnicalIndicatorDTO): IndicatorHistoryPoint {
  return {
    timestamp: dto.timestamp,
    currentPrice: dto.currentPrice,
    bbUpper: dto.bbUpper ?? 0,
    bbMiddle: dto.bbMiddle ?? 0,
    bbLower: dto.bbLower ?? 0,
    vwap: dto.vwap ?? 0,
    vwapUpper: dto.vwapUpperBand ?? 0,
    vwapLower: dto.vwapLowerBand ?? 0,
    superTrend: dto.superTrendValue ?? 0,
    superTrendDirection: (dto.superTrendDirection as 'BULLISH' | 'BEARISH') ?? 'BULLISH',
  };
}
