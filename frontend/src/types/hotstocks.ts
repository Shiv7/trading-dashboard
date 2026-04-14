export type LiquidityTier = 'HIGH' | 'MED' | 'LOW';

export type ActionCueType =
  | 'BUY_DIP' | 'WAIT_PULLBACK' | 'BUY_RANGE_LOW'
  | 'HOLD_OFF_EVENT' | 'AVOID' | 'OBSERVE';

export interface CorporateEvent {
  symbol: string;
  eventType: 'EARNINGS' | 'DIVIDEND' | 'SPLIT' | 'BONUS' | 'AGM';
  eventDate: string;
  detail: string;
}

export interface StrategyWatch {
  strategyName: string;
  state: string;
  triggerLevel: number | null;
  notes: string;
}

export interface StockMetrics {
  scripCode: string;
  symbol: string;
  sector: string;
  fnoEligible: boolean;
  lastUpdatedIst: string;

  ltpYesterday: number;
  change1dPct: number;
  change5dPct: number;
  change20dPct: number;

  vsSectorIndexPct: number;
  vsSectorLabel: 'LEADING' | 'INLINE' | 'LAGGING';
  vsNifty50Pct: number;
  vsNiftyLabel: 'LEADING' | 'INLINE' | 'LAGGING';

  bulkDealCount: number;
  blockDealCount: number;
  dealDays: number;
  smartBuyCr: number;
  smartSellCr: number;
  smartBuyClients: string[];
  smartSellClients: string[];
  dominantFlow: string;

  deliveryPctLatest: number;
  deliveryPctAvg5d: number;
  deliveryTrend: 'RISING' | 'FALLING' | 'STABLE';
  deliveryInterpretation: string;
  deliveryTrendLabel: string;
  deliveryInstitutional: boolean;

  above50dmaPct: number | null;
  above200dmaPct: number | null;
  trendState: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'INSUFFICIENT';
  rsi14: number | null;
  weekly52PositionPct: number | null;

  priceRegime: 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE_BOUND';
  priceRegimeConfidence: number;

  volumeRatio5d20d: number;
  volumeRegime: 'ELEVATED' | 'NORMAL' | 'QUIET';
  avgTurnover20dCr: number;
  liquidityTier: LiquidityTier;

  swingLow20d: number;
  swingHigh20d: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  suggestedSlPrice: number;

  oiChangePct5d: number | null;
  oiInterpretation: string | null;
  volumeRegimeLabel: string | null;

  upcomingEvents: CorporateEvent[];
  daysToNearestEvent: number | null;
  nearestEventType: string | null;
  eventWithin3Days: boolean;
  hasSplitAnnouncement: boolean;
  hasBonusAnnouncement: boolean;
  hasDividendExDate: boolean;
  nextCorporateActionLabel: string | null;

  strategiesWatching: StrategyWatch[];

  thesisText: string;
  actionCueType: ActionCueType;
  actionCueText: string;

  confidenceScore: number | null;
  scoringRegime: string | null;
  scoringModel: string | null;
}

export interface HotStocksListResponse {
  fno: StockMetrics[];
  nonFno: StockMetrics[];
  generatedAt: number;
}
