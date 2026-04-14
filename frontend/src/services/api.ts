import type {
  Wallet, Position, FamilyScore, Signal, Trade, TradeStats, IPUSignal, VCPSignal,
  QuantScore, QuantScoreStats, CreateOrderRequest, ModifyPositionRequest, VirtualOrder, VirtualPosition,
  PerformanceMetrics, PatternSignal, PatternSummary, PatternStats,
  PortfolioRiskSummary, StrategyRiskProfile, DrawdownPoint, RiskAlert,
  AlertHistory, AlertStats, AlertSummary,
  StrategyTradeRequest, StrategyTradeResponse,
  TradeIntelligenceReport, StrategyTuningReport, SimulationResult, ConfigChange
} from '../types'
import type {
  TechnicalIndicatorDTO,
  UnifiedCandleDTO,
  VcpStateDTO,
  IpuStateDTO,
  PivotStateDTO,
  StrategyStateDTO
} from '../types/indicators'
import type { HotStocksListResponse, StockMetrics } from '../types/hotstocks'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8085/api'
const STREAMING_API_BASE = API_BASE
const AUTH_TOKEN_KEY = 'kotsin_auth_token'

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

// --- Token refresh & auth retry logic ---
let _isRefreshing = false
let _refreshPromise: Promise<boolean> | null = null

async function tryRefreshToken(): Promise<boolean> {
  if (_isRefreshing && _refreshPromise) return _refreshPromise
  _isRefreshing = true
  _refreshPromise = (async () => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY)
      if (!token) return false
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      if (!response.ok) return false
      const data = await response.json()
      if (data.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.token)
        if (data.user) localStorage.setItem('kotsin_user', JSON.stringify(data.user))
        return true
      }
      return false
    } catch {
      return false
    } finally {
      _isRefreshing = false
      _refreshPromise = null
    }
  })()
  return _refreshPromise
}

function forceLogout(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem('kotsin_user')
  window.location.href = '/login'
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const makeOpts = (): RequestInit => ({
    ...options,
    headers: { ...getAuthHeaders(), ...(options.headers as Record<string, string> || {}) },
  })
  let response = await fetch(url, makeOpts())
  if (response.status === 401) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      response = await fetch(url, makeOpts())
      if (response.status === 401) {
        forceLogout()
        throw new Error('Session expired')
      }
    } else {
      forceLogout()
      throw new Error('Session expired')
    }
  }
  return response
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchWithAuth(`${API_BASE}${url}`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

async function postJsonNoAuth<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

// Wallet API
export const walletApi = {
  getWallet: () => fetchJson<Wallet>('/wallet'),
  getPositions: () => fetchJson<Position[]>('/wallet/positions'),
  getOpenPositions: () => fetchJson<Position[]>('/wallet/positions/open'),
  refreshWallet: () => fetch(`${API_BASE}/wallet/refresh`, { method: 'POST' }).then(r => r.json()),
}

// Signals API
export const signalsApi = {
  getSignals: (page = 0, size = 20, scripCode?: string, emittedOnly?: boolean) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (scripCode) params.set('scripCode', scripCode)
    if (emittedOnly !== undefined) params.set('emittedOnly', String(emittedOnly))
    return fetchJson<{ content: Signal[]; totalElements: number }>(`/signals?${params}`)
  },
  getSignalById: (signalId: string) => fetchJson<Signal>(`/signals/${signalId}`),
  getSignalsForStock: (scripCode: string, limit = 50) =>
    fetchJson<Signal[]>(`/signals/stock/${scripCode}?limit=${limit}`),
  getBestSignal: (scripCode: string) =>
    fetchJson<Record<string, unknown>>(`/signals/best/${scripCode}`),
}

// Scores API
export const scoresApi = {
  getAllScores: () => fetchJson<FamilyScore[]>('/scores'),
  getTopScores: (limit = 10) => fetchJson<FamilyScore[]>(`/scores/top?limit=${limit}`),
  getScore: (scripCode: string) => fetchJson<FamilyScore>(`/scores/${scripCode}`),
  getScoreHistory: (scripCode: string, limit = 50) =>
    fetchJson<FamilyScore[]>(`/scores/${scripCode}/history?limit=${limit}`),
  explainScore: (scripCode: string) =>
    fetchJson<Record<string, unknown>>(`/scores/${scripCode}/explain`),
  searchStocks: (query: string, limit = 10) =>
    fetchJson<FamilyScore[]>(`/scores/search?q=${encodeURIComponent(query)}&limit=${limit}`),
}

// Trades API
export const tradesApi = {
  getTrades: (limit = 50, status?: string) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (status) params.set('status', status)
    return fetchJson<Trade[]>(`/trades?${params}`)
  },
  getTradeStats: () => fetchJson<TradeStats>('/trades/stats'),
  getTradeById: (tradeId: string) => fetchJson<Trade>(`/trades/${tradeId}`),
}

// Live Trades API — /api/live returns { activePositions, todayExits } virtual positions snapshot
export interface LiveTradesData {
  activePositions: Record<string, unknown>[]
  todayExits: Record<string, unknown>[]
}
export const liveTradesApi = {
  getLiveData: () => fetchJson<LiveTradesData>('/live'),
}

// QuantScores API (Institutional-Grade Scoring)
export const quantScoresApi = {
  getAllScores: (limit = 100) => fetchJson<QuantScore[]>(`/quant-scores?limit=${limit}`),
  getAllScoresAllTimeframes: (limit = 500) => fetchJson<QuantScore[]>(`/quant-scores/all-timeframes?limit=${limit}`),
  getActionableScores: (limit = 20) => fetchJson<QuantScore[]>(`/quant-scores/actionable?limit=${limit}`),
  getScoresByDirection: (direction: string) => fetchJson<QuantScore[]>(`/quant-scores/direction/${direction}`),
  getScore: (scripCode: string) => fetchJson<QuantScore>(`/quant-scores/${scripCode}`),
  // FIX: Get all timeframe scores for a scripCode (for MTF display)
  getScoreAllTimeframes: (scripCode: string) => fetchJson<Record<string, QuantScore>>(`/quant-scores/${scripCode}/timeframes`),
  getStats: () => fetchJson<QuantScoreStats>('/quant-scores/stats'),
  getTimeframeStats: () => fetchJson<Record<string, number>>('/quant-scores/stats/timeframes'),
  getBreakdownSummary: () => fetchJson<Record<string, number>>('/quant-scores/breakdown-summary'),
}

// Indicators API
export const indicatorsApi = {
  getIPUSignal: (scripCode: string) => fetchJson<IPUSignal>(`/indicators/${scripCode}/ipu`),
  getVCPSignal: (scripCode: string) => fetchJson<VCPSignal>(`/indicators/${scripCode}/vcp`),
  getSnapshot: (scripCode: string) => fetchJson<{ ipu: IPUSignal; vcp: VCPSignal }>(`/indicators/${scripCode}/snapshot`),
  getAllIPU: () => fetchJson<Record<string, IPUSignal>>('/indicators/ipu/all'),
  getAllVCP: () => fetchJson<Record<string, VCPSignal>>('/indicators/vcp/all'),
  getTopIPU: (limit = 10, direction = 'BULLISH') =>
    fetchJson<{ signals: IPUSignal[] }>(`/indicators/top/ipu?limit=${limit}&direction=${direction}`),
  getTopVCP: (limit = 10, direction = 'BULLISH') =>
    fetchJson<{ signals: VCPSignal[] }>(`/indicators/top/vcp?limit=${limit}&direction=${direction}`),
  getAlerts: (type?: string) =>
    fetchJson<{ alerts: IPUSignal[] }>(`/indicators/alerts${type ? `?type=${type}` : ''}`),
}

// Helper for POST requests
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetchWithAuth(`${API_BASE}${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || error.error || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

// Helper for PUT requests
async function putJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetchWithAuth(`${API_BASE}${url}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || error.error || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

// Helper for DELETE requests
async function deleteJson<T>(url: string): Promise<T> {
  const response = await fetchWithAuth(`${API_BASE}${url}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || error.error || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

// Helper for PATCH requests
async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetchWithAuth(`${API_BASE}${url}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || error.error || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

// Orders API - Trading (Virtual or Live based on mode)
export const ordersApi = {
  createOrder: (order: CreateOrderRequest) =>
    postJson<VirtualOrder & { tradingMode?: string; isLive?: boolean }>('/orders', order),

  closePosition: (scripCode: string) =>
    postJson<{ tradingMode?: string }>(`/orders/close/${scripCode}`, {}),

  modifyPosition: (scripCode: string, req: ModifyPositionRequest) =>
    patchJson<VirtualPosition & { tradingMode?: string }>(`/orders/positions/${scripCode}`, req),

  healthCheck: () =>
    fetchJson<{ status: string; executionService?: unknown }>('/orders/health'),
}

// Trading Mode API
export interface TradingModeStatus {
  mode: 'VIRTUAL' | 'LIVE'
  isVirtual: boolean
  isLive: boolean
  liveTradingEnabled: boolean
}

export const tradingModeApi = {
  getMode: () => fetchJson<TradingModeStatus>('/trading-mode'),

  setMode: (mode: 'VIRTUAL' | 'LIVE') =>
    postJson<{ mode: string; changed: boolean; message: string }>(`/trading-mode/${mode}`, {}),

  enableLive: (confirm = false) =>
    postJson<{ liveTradingEnabled: boolean; mode: string; warning?: string; error?: string }>(
      `/trading-mode/enable-live?confirm=${confirm}`,
      {}
    ),

  disableLive: () =>
    postJson<{ liveTradingEnabled: boolean; mode: string }>('/trading-mode/disable-live', {}),
}

// Market Pulse API
export type MarketPulseState = 'LIVE' | 'STALE_SESSION' | 'CLOSED_AFTERHRS' | 'CLOSED_HOLIDAY' | 'ERROR'

export interface AssetStatus {
  state: MarketPulseState
  subtitle: string
  lastUpdateMs: number
}

export interface MacroSnapshot {
  giftNiftyPrice: number
  giftNiftyChange: number
  giftNiftyChangePct: number
  giftNiftyOvernightChangePct: number
  giftNiftyOpen: number
  giftNiftyHigh: number
  giftNiftyLow: number
  giftNiftyPrevClose: number
  sgxNiftyLastTrade: number
  sgxNiftyLastTradeTimestamp: number
  indiaVix: number
  vixRegime: string
  dowPrice: number
  sp500Price: number
  nasdaqPrice: number
  dowChangePct: number
  sp500ChangePct: number
  nasdaqChangePct: number
  dxyPrice: number
  dxyChangePct: number
  usVixPrice: number
  usVixChangePct: number
  crudeOilPrice: number
  crudeOilChangePct: number
  brentOilPrice: number
  brentOilChangePct: number
  goldPrice: number
  goldChangePct: number
  silverPrice: number
  silverChangePct: number
  usdInrPrice: number
  usdInrChangePct: number
  advanceDecline: {
    advances: number
    declines: number
    unchanged: number
    ratio: number
    ratioLabel: string
    foAdvances: number
    foDeclines: number
    foUnchanged: number
    foRatio: number
    foRatioLabel: string
  }
  timestamp: number
  // Phase 1c — per-asset state classification
  giftNiftyStatus?: AssetStatus
  indiaVixStatus?: AssetStatus
  dowStatus?: AssetStatus
  sp500Status?: AssetStatus
  nasdaqStatus?: AssetStatus
  dxyStatus?: AssetStatus
  usVixStatus?: AssetStatus
  crudeStatus?: AssetStatus
  brentStatus?: AssetStatus
  goldStatus?: AssetStatus
  silverStatus?: AssetStatus
  usdInrStatus?: AssetStatus
  niftyStatus?: AssetStatus
  advanceDeclineStatus?: AssetStatus
}

export interface BlockDeal {
  date: string; symbol: string; name: string; clientName: string
  buySell: string; quantity: number; price: number; valueCr: number
  remarks: string | null; _date: string; _lastFetchEpoch?: number
}
export interface BulkDeal {
  date: string; symbol: string; securityName: string; clientName: string
  buySell: string; quantity: number; price: number; valueCr: number; _date: string; _lastFetchEpoch?: number
}
export interface FiiDiiDay {
  _date: string
  FII?: { category: string; date: string; buyValue: number; sellValue: number; netValue: number }
  DII?: { category: string; date: string; buyValue: number; sellValue: number; netValue: number }
}
export interface CorporateEvent {
  symbol: string; company: string; purpose: string; description: string; date: string
}
export interface ConvictionData {
  symbol: string; conviction: number; color: string; events: string[]; inference: string
}

export interface DeliveryData {
  date?: string
  sectors?: Record<string, { deliveryPct: number; totalTurnoverLacs: number; stockCount: number }>
  topDelivery?: { symbol: string; deliveryPct: number; turnoverLacs: number }[]
  timestamp?: number
}

// ── Trading Command Center Insights (pre-computed) ──
export interface CommandCenterInsights {
  marketState?: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    confidence: number
    dayType: string
    summary: string
    assScore: number
    assRegime: string
    niftyPrice: number
    niftyChangePct: number
    // Phase 4: explicit Indian indices
    sgxNiftyPrice: number
    sgxNiftyChangePct: number
    nifty50Price: number
    nifty50ChangePct: number
    indiaVix: number
    crudePrice: number
    crudeChangePct: number
    goldPrice: number
    goldChangePct: number
    silverPrice: number
    silverChangePct: number
    dxyPrice: number
    dxyChangePct: number
    usdInrPrice: number
    usdInrChangePct: number
    fiiNetToday: number
    diiNetToday: number
    usVix: number
    usVixChangePct: number
    // US indices (sgxnifty.org scraper)
    sp500Price: number
    sp500ChangePct: number
    dowPrice: number
    dowChangePct: number
    nasdaqPrice: number
    nasdaqChangePct: number
    // Brent crude (in addition to WTI)
    brentPrice: number
    brentChangePct: number
    // Europe (yfinance Phase 2)
    ftsePrice: number
    ftseChangePct: number
    daxPrice: number
    daxChangePct: number
    cacPrice: number
    cacChangePct: number
    // Middle East (yfinance Phase 2)
    tasiPrice: number       // Saudi Tadawul (^TASI.SR)
    tasiChangePct: number
    uaePrice: number        // iShares MSCI UAE ETF (UAE) — composite proxy
    uaeChangePct: number
    giftNiftyPrice: number
    giftNiftyChangePct: number
    advances: number
    declines: number
    adRatioLabel: string
    foAdvances: number
    foDeclines: number
    foRatioLabel: string
    timestamp: number
    // Phase 4: per-card cross-indice inferences (key = card id, value = takeaway)
    cardInferences?: Record<string, string>
    // Phase 4: holistic one-line summary across all markets
    globalRead?: string
    // Phase 5+6: macro
    us10yYield: number
    us10yChangePct: number
    vixDivergence: number
    brentWtiSpread: number
    nextFomcDate?: string
    daysUntilFomc?: number
    nextCpiDate?: string
    daysUntilCpi?: number
    calendarHint?: string
  }
  // Phase 5+6: Institutional Activity (Tab 4)
  institutionalActivity?: {
    bySecurity: Array<{
      symbol: string
      sector: string
      netCr: number
      fiiNetCr: number
      diiNetCr: number
      propNetCr: number
      otherNetCr: number
      dealCount: number
      topDealCr: number
      deliveryPct: number
      sectorDeliveryPct: number
      topBuyer?: string
      topSeller?: string
      divergenceState: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' | string
      divergenceConfidence: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE' | string
      divergenceReasons: string[]
      inference: string
    }>
    byClient: Array<{
      name: string
      type: 'FII' | 'DII' | 'PROP_BROKER' | 'OTHER' | string
      buyCr: number
      sellCr: number
      netCr: number
      dealCount: number
      topBuySymbols: string[]
      topSellSymbols: string[]
      inference: string
    }>
    totalDealsCount: number
    totalDealValueCr: number
    accumulationCount: number
    distributionCount: number
    headlineSummary: string
    dataDate?: string
  }
  strategyAlignments?: Array<{
    strategy: string; status: string; statusIcon: string; description: string
    macroContext: string; riskLevel: string; activePositions: number
    dayPnl: number; totalPnl: number; drawdownPct: number
  }>
  positionGuidance?: Array<{
    scripCode: string; symbol: string; strategy: string; side: string
    entryPrice: number; currentPrice: number; pnl: number; pnlPct: number
    action: string; reason: string; sectorStatus: string; t1Hit: boolean
    greekTrailActive: boolean; currentSl: number; suggestedSl: number
  }>
  alerts?: Array<{
    severity: string; icon: string; title: string; message: string
    action: string; timestamp: number
  }>
  commoditySignals?: {
    commodities: Array<{ name: string; price: number; changePct: number; direction: string }>
    inferences: string[]
  }
  sectorIndices?: Array<{ name: string; fullName: string; changePct: number; inference: string }>
  asianMarkets?: {
    nikkeiPrice: number; nikkeiChangePct: number
    hangSengPrice: number; hangSengChangePct: number
    shanghaiPrice: number; shanghaiChangePct: number
    kospiPrice: number; kospiChangePct: number
    assScore: number; regime: string; inference: string
  }
  fiiDiiIntelligence?: {
    fiiNetToday: number; diiNetToday: number; fiiNetWeek: number; diiNetWeek: number
    fiiSellingStreak: number; diiBuyingStreak: number; narrative: string
    dailyBreakdown: Array<Record<string, any>>
  }
  dealIntelligence?: {
    blockDealCount: number; bulkDealCount: number; totalDealVolumeCr: number
    watchlist: Array<{
      symbol: string; bias: string; score: number; conviction: string
      fnoEligible: boolean; netCr: number; reasons: string[]; sector: string
    }>
    sectorFlows: Array<{
      sector: string; netCr: number; fiiBuyCr: number; fiiSellCr: number
      diiBuyCr: number; diiSellCr: number; otherBuyCr: number; otherSellCr: number
      dealCount: number; deliveryPct: number; signal: string
      // Phase 7 enrichment
      topStocks?: Array<{
        symbol: string; netCr: number; side: string; dealCount: number
        // Phase 8d: churn detection
        grossCr?: number
        churnRatio?: number
        flowQuality?: 'HIGH' | 'MEDIUM' | 'LOW' | 'CHURN' | string
        dominantClient?: string
        // Phase 8c: FII vs DII per-stock alignment
        fiiNetCr?: number
        diiNetCr?: number
        fiiDiiAlignment?: 'FII_DII_BUY' | 'FII_DII_SELL' | 'FII_SELL_DII_BUY' | 'FII_BUY_DII_SELL' | 'FII_ONLY_BUY' | 'FII_ONLY_SELL' | 'DII_ONLY_BUY' | 'DII_ONLY_SELL' | 'NO_INST' | string
        // Phase 8a: 5-day daily flow rhythm
        dailyCrTimeseries?: number[]
        dailyDates?: string[]
        pattern?: 'SYSTEMATIC' | 'BLOCK_EXIT' | 'PERSISTENT_BUYING' | 'PERSISTENT_SELLING' | 'CHOPPY' | 'SINGLE_DAY' | 'MIXED_2D' | string
      }>
      topClients?: string[]
      regime?: 'ACCUMULATION' | 'DISTRIBUTION' | 'DISTRIBUTION_INTO_STRENGTH' | 'SPECULATIVE_BUYING' | 'MIXED' | 'NEUTRAL' | 'CHURN' | string
      inference?: string
      // Phase 7b: multi-day persistence
      daysFlowing?: number
      streakDirection?: 'BUY' | 'SELL' | 'MIXED' | string
      traderAction?: string
      // Phase 7c: 5-day cumulative context
      weekTotalCr?: number
      dataDate?: string
      // Phase 8d: structured client flows + sector-wide churn ratio
      topClientFlows?: Array<{
        name: string
        type: 'FII' | 'DII' | 'PROP_BROKER' | 'OTHER' | string
        buyCr: number
        sellCr: number
        netCr: number
        churnRatio: number
      }>
      sectorChurnRatio?: number
    }>
    topClients: Array<{
      name: string; type: string; buyCr: number; sellCr: number; netCr: number
      buySymbols: string[]; sellSymbols: string[]; dealCount: number
    }>
    topStocks: Array<{
      symbol: string; sector: string; netCr: number; blockBuyCr: number; blockSellCr: number
      bulkBuyCr: number; bulkSellCr: number; dateCount: number; clients: string[]
      corporateEvent: string; blockPct: number
    }>
    eventsWithDeals: Array<Record<string, any>>
    dealInsights: string[]
  }
  deliveryAnalysis?: {
    date: string
    sectors: Array<{ sector: string; deliveryPct: number; turnoverLacs: number; signal: string }>
    inference: string
  }
  strategyScorecard?: Array<{
    strategy: string; balance: number; peakBalance: number; drawdown: number
    drawdownPct: number; dayPnl: number; dayTrades: number; dayWins: number
    dayLosses: number; winRate: number; totalTrades: number; status: string
  }>
  computedAt: number
  marketStatus: string
  nextBoundary: string
}

export const marketPulseApi = {
  getSnapshot: () => fetchJson<MacroSnapshot>('/market-pulse'),
  getBlockDeals: () => fetchJson<BlockDeal[]>('/market-pulse/block-deals'),
  getBulkDeals: () => fetchJson<BulkDeal[]>('/market-pulse/bulk-deals'),
  getFiiDii: () => fetchJson<FiiDiiDay[]>('/market-pulse/fii-dii'),
  getCorporateEvents: () => fetchJson<CorporateEvent[]>('/market-pulse/corporate-events'),
  getConviction: (symbol: string) => fetchJson<ConvictionData>(`/market-pulse/conviction/${symbol}`),
  getDeliveryData: () => fetchJson<DeliveryData>('/market-pulse/delivery-data'),
  getInsights: () => fetchJson<CommandCenterInsights>('/market-pulse/insights'),
}

// Performance Analytics API
export const performanceApi = {
  getMetrics: () => fetchJson<PerformanceMetrics>('/performance'),

  getSummary: () => fetchJson<{
    totalTrades: number
    wins: number
    losses: number
    winRate: number
    totalPnl: number
    avgRMultiple: number
    profitFactor: number
    maxDrawdown: number
    currentStreak: number
  }>('/performance/summary'),

  getDrawdown: () => fetchJson<PerformanceMetrics['drawdown']>('/performance/drawdown'),

  getDailyPerformance: (days = 30) =>
    fetchJson<PerformanceMetrics['dailyPerformance']>(`/performance/daily?days=${days}`),

  getWeeklyPerformance: (weeks = 12) =>
    fetchJson<PerformanceMetrics['weeklyPerformance']>(`/performance/weekly?weeks=${weeks}`),

  getMonthlyPerformance: (months = 12) =>
    fetchJson<PerformanceMetrics['monthlyPerformance']>(`/performance/monthly?months=${months}`),

  getWinRateTrend: () => fetchJson<PerformanceMetrics['winRateTrend']>('/performance/winrate-trend'),

  getBySource: () => fetchJson<PerformanceMetrics['bySource']>('/performance/by-source'),

  getByExitReason: () => fetchJson<PerformanceMetrics['byExitReason']>('/performance/by-exit-reason'),

  getByCategory: () => fetchJson<PerformanceMetrics['byCategory']>('/performance/by-category'),

  getStreaks: () => fetchJson<PerformanceMetrics['streaks']>('/performance/streaks'),

  getTimeAnalysis: () => fetchJson<PerformanceMetrics['timeAnalysis']>('/performance/time-analysis'),
}

// Pattern Signals API
export const patternsApi = {
  getActivePatterns: () => fetchJson<PatternSignal[]>('/patterns'),

  getSummary: () => fetchJson<PatternSummary>('/patterns/summary'),

  getPatternsByStock: (scripCode: string) =>
    fetchJson<PatternSignal[]>(`/patterns/stock/${scripCode}`),

  getPattern: (patternId: string) => fetchJson<PatternSignal>(`/patterns/${patternId}`),

  getHistory: (limit = 50) => fetchJson<PatternSignal[]>(`/patterns/history?limit=${limit}`),

  getStats: () => fetchJson<Record<string, PatternStats>>('/patterns/stats'),

  updateOutcome: (patternId: string, isWin: boolean, pnl: number) =>
    postJson<string>(`/patterns/${patternId}/outcome?isWin=${isWin}&pnl=${pnl}`, {}),
}

// Risk Analytics API
export const riskApi = {
  // Existing endpoints
  getPortfolioRisk: () => fetchJson<PortfolioRiskSummary>('/risk'),
  getStrategyRisk: (key: string) => fetchJson<StrategyRiskProfile>(`/risk/strategy/${key}`),
  getDrawdownHistory: (strategy: string, period: string) =>
    fetchJson<DrawdownPoint[]>(`/risk/drawdown/${strategy}?period=${period}`),
  getAlerts: () => fetchJson<RiskAlert[]>('/risk/alerts'),
  tripCircuitBreaker: (strategy: string, reason: string) =>
    postJson<{ success: boolean; tripped: string[]; failed: string[]; reason: string }>(
      `/risk/circuit-breaker/trip?strategy=${strategy}&reason=${encodeURIComponent(reason)}`, {}),
  resetCircuitBreaker: (strategy: string) =>
    postJson<{ success: boolean; reset: string[]; failed: string[] }>(
      `/risk/circuit-breaker/reset?strategy=${strategy}`, {}),
  forceCloseAll: (strategy: string) =>
    postJson<{ success: boolean; strategy: string; closed: number; closedDetails: unknown[]; errors: unknown[] }>(
      `/risk/force-close?strategy=${strategy}`, {}),

  // Trade Intelligence (Tab 2)
  getTradeIntelligence: (params: { from?: number; to?: number; strategy?: string; exchange?: string }) => {
    const qs = new URLSearchParams()
    if (params.from) qs.set('from', String(params.from))
    if (params.to) qs.set('to', String(params.to))
    if (params.strategy) qs.set('strategy', params.strategy)
    if (params.exchange) qs.set('exchange', params.exchange)
    return fetchJson<TradeIntelligenceReport>(`/risk/trade-intelligence?${qs}`)
  },

  // Strategy Tuning (Tab 3)
  getStrategyTuning: (strategy: string, from?: number, to?: number) => {
    const qs = new URLSearchParams({ strategy })
    if (from) qs.set('from', String(from))
    if (to) qs.set('to', String(to))
    return fetchJson<StrategyTuningReport>(`/risk/strategy-tuning?${qs}`)
  },

  simulateConfig: (req: { strategy: string; changes: Record<string, string>; from?: number; to?: number }) =>
    postJson<SimulationResult>('/risk/strategy-tuning/simulate', req),

  // Config Management
  getCurrentConfig: (service: string) =>
    fetchJson<Record<string, string>>(`/risk/config/current?service=${service}`),

  applyConfig: (req: { service: string; changes: Record<string, string>; reason: string }) =>
    postJson<{ success: boolean; changeId: string; pendingRestart: boolean; message: string }>(
      '/risk/config/apply', req),

  getConfigHistory: (limit = 50) =>
    fetchJson<ConfigChange[]>(`/risk/config/history?limit=${limit}`),

  rollbackConfig: (changeId: string) =>
    postJson<{ success: boolean; message: string }>(`/risk/config/rollback/${changeId}`, {}),
}

// Initial State API - for loading cached data on page refresh
export const initialStateApi = {
  getInitialState: () => fetchJson<{
    scores: FamilyScore[]
    quantScores: QuantScore[]
    narratives: Record<string, unknown>
    intelligence: Record<string, unknown>
    signals: Signal[]
    aclStates: Record<string, unknown>
    activeIgnitions: unknown[]
    timestamp: number
    dataAvailable: boolean
  }>('/state/initial'),

  getMinimalState: () => fetchJson<{
    scores: FamilyScore[]
    quantScores: QuantScore[]
    timestamp: number
  }>('/state/initial/minimal'),
}

// Alerts API
export const alertsApi = {
  getAlerts: (limit = 50, type?: string, severity?: string, unreadOnly?: boolean) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (type) params.set('type', type)
    if (severity) params.set('severity', severity)
    if (unreadOnly !== undefined) params.set('unreadOnly', String(unreadOnly))
    return fetchJson<AlertHistory[]>(`/alerts?${params}`)
  },

  getSummary: () => fetchJson<AlertSummary>('/alerts/summary'),

  getStats: () => fetchJson<AlertStats>('/alerts/stats'),

  getAlertsForStock: (scripCode: string, limit = 20) =>
    fetchJson<AlertHistory[]>(`/alerts/stock/${scripCode}?limit=${limit}`),

  getAlert: (alertId: string) => fetchJson<AlertHistory>(`/alerts/${alertId}`),

  markAsRead: (alertId: string) =>
    postJson<{ success: boolean }>(`/alerts/${alertId}/read`, {}),

  markAllAsRead: () =>
    postJson<{ markedCount: number }>('/alerts/read-all', {}),

  deleteAlert: (alertId: string) =>
    fetch(`${API_BASE}/alerts/${alertId}`, { method: 'DELETE' }).then(r => r.json()),

  createAlert: (alert: { type: string; severity: string; title: string; message: string; scripCode?: string }) =>
    postJson<AlertHistory>('/alerts', alert),
}

// Technical Indicators API (Bollinger Bands, VWAP, SuperTrend)
// Uses streamingcandle service on port 8081
async function fetchStreamingJson<T>(url: string): Promise<T> {
  const response = await fetch(`${STREAMING_API_BASE}${url}`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

async function postStreamingJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(`${STREAMING_API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export const technicalIndicatorsApi = {
  getIndicators: (scripCode: string, timeframe: string = '5m') =>
    fetchStreamingJson<TechnicalIndicatorDTO>(`/technical-indicators/${scripCode}?timeframe=${timeframe}`),

  getIndicatorHistory: (scripCode: string, timeframe: string = '5m', limit: number = 100) =>
    fetchStreamingJson<TechnicalIndicatorDTO[]>(`/technical-indicators/${scripCode}/history?timeframe=${timeframe}&limit=${limit}`),

  getBatchIndicators: (scripCodes: string[], timeframe: string = '5m') =>
    postStreamingJson<Record<string, TechnicalIndicatorDTO>>(`/technical-indicators/batch?timeframe=${timeframe}`, scripCodes),

  getAvailableScrips: (timeframe: string = '5m') =>
    fetchStreamingJson<string[]>(`/technical-indicators/available?timeframe=${timeframe}`),

  getCacheStats: () =>
    fetchStreamingJson<{ indicatorCacheSize: number; historyCacheSize: number; byTimeframe: Record<string, number> }>('/technical-indicators/stats'),

  // ===== NEW SPECIALIZED ENDPOINTS (StreamingCandle v2.0) =====

  getMovingAverages: (scripCode: string, timeframe: string = '5m') =>
    fetchStreamingJson<Record<string, unknown>>(`/technical-indicators/${scripCode}/moving-averages?timeframe=${timeframe}`),

  getMomentumIndicators: (scripCode: string, timeframe: string = '5m') =>
    fetchStreamingJson<Record<string, unknown>>(`/technical-indicators/${scripCode}/momentum?timeframe=${timeframe}`),

  getTrendIndicators: (scripCode: string, timeframe: string = '5m') =>
    fetchStreamingJson<Record<string, unknown>>(`/technical-indicators/${scripCode}/trend?timeframe=${timeframe}`),

  getPivotPoints: (scripCode: string, timeframe: string = '5m') =>
    fetchStreamingJson<Record<string, unknown>>(`/technical-indicators/${scripCode}/pivots?timeframe=${timeframe}`),

  getCompositeSignal: (scripCode: string, timeframe: string = '5m') =>
    fetchStreamingJson<{ scripCode: string; timeframe: string; signal: string }>(`/technical-indicators/${scripCode}/signal?timeframe=${timeframe}`),

  // Screening endpoints
  getBullishSetups: (timeframe: string = '5m') =>
    fetchStreamingJson<string[]>(`/technical-indicators/screen/bullish?timeframe=${timeframe}`),

  getBearishSetups: (timeframe: string = '5m') =>
    fetchStreamingJson<string[]>(`/technical-indicators/screen/bearish?timeframe=${timeframe}`),

  getTrendingSymbols: (timeframe: string = '5m', minAdx: number = 25) =>
    fetchStreamingJson<string[]>(`/technical-indicators/screen/trending?timeframe=${timeframe}&minAdx=${minAdx}`),

  getHighVolumeSymbols: (timeframe: string = '5m', minRatio: number = 1.5) =>
    fetchStreamingJson<string[]>(`/technical-indicators/screen/high-volume?timeframe=${timeframe}&minRatio=${minRatio}`),
}

// ===== UNIFIED CANDLES API (Merged Tick + Orderbook + OI) =====
export const unifiedCandlesApi = {
  getLatestCandle: (symbol: string, timeframe: string = '5m') =>
    fetchStreamingJson<UnifiedCandleDTO>(`/candles/${symbol}?timeframe=${timeframe}`),

  getCandleHistory: (symbol: string, timeframe: string = '5m', limit: number = 100) =>
    fetchStreamingJson<UnifiedCandleDTO[]>(`/candles/${symbol}/history?timeframe=${timeframe}&limit=${limit}`),

  getBatchCandles: (symbols: string[], timeframe: string = '5m') =>
    postStreamingJson<Record<string, UnifiedCandleDTO>>(`/candles/batch?timeframe=${timeframe}`, symbols),

  getAvailableSymbols: (timeframe: string = '5m') =>
    fetchStreamingJson<string[]>(`/candles/available?timeframe=${timeframe}`),

  hasData: (symbol: string, timeframe: string = '5m') =>
    fetchStreamingJson<{ symbol: string; timeframe: string; exists: boolean }>(`/candles/${symbol}/exists?timeframe=${timeframe}`),

  getStats: () =>
    fetchStreamingJson<Record<string, unknown>>('/candles/stats'),
}

// ===== TRADING SIGNALS API (Signal Confirmation) =====
export interface TradingSignal {
  signalId: string
  symbol: string
  scripCode: string
  exchange: string
  companyName: string
  timeframe: string
  state: string
  event: string
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  currentPrice: number
  entryPrice: number
  stopLoss: number
  target1: number
  target2: number
  compositeScore: number
  confidence: number
  reason: string
  confirmationStatus: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'EXECUTED' | 'EXPIRED'
  receivedAt: string
  confirmedAt?: string
  executionOrderId?: string
}

export const tradingSignalsApi = {
  getPendingSignals: () => fetchJson<TradingSignal[]>('/signals/trading/pending'),

  getSignal: (signalId: string) => fetchJson<TradingSignal>(`/signals/trading/${signalId}`),

  confirmSignal: (signalId: string, confirmedBy?: string) =>
    postJson<{ success: boolean; message: string; signal: TradingSignal; orderId?: string }>(
      `/signals/trading/${signalId}/confirm`,
      { confirmedBy: confirmedBy || 'user' }
    ),

  rejectSignal: (signalId: string, reason?: string) =>
    postJson<{ success: boolean; message: string; signal: TradingSignal }>(
      `/signals/trading/${signalId}/reject`,
      { rejectedBy: 'user', reason: reason || 'User rejected' }
    ),

  getSignalHistory: (limit = 50) =>
    fetchJson<TradingSignal[]>(`/signals/trading/history?limit=${limit}`),

  confirmAllQuality: (minScore = 70, minRR = 1.5) =>
    postJson<{ confirmed: number; failed: number }>(
      `/signals/trading/confirm-all?minScore=${minScore}&minRR=${minRR}`,
      {}
    ),

  rejectAll: (reason?: string) =>
    postJson<{ rejected: number }>(
      '/signals/trading/reject-all',
      { reason: reason || 'Bulk rejection' }
    ),
}

// ===== STRATEGY ANALYSIS API (VCP, IPU, Pivot from Redis) =====
export const strategyAnalysisApi = {
  // Individual symbol endpoints
  getFullState: (symbol: string, timeframe: string = '5m') =>
    fetchStreamingJson<StrategyStateDTO>(`/strategy-analysis/${symbol}?timeframe=${timeframe}`),

  getVcpState: (symbol: string, timeframe: string = '5m') =>
    fetchStreamingJson<VcpStateDTO>(`/strategy-analysis/${symbol}/vcp?timeframe=${timeframe}`),

  getIpuState: (symbol: string, timeframe: string = '5m') =>
    fetchStreamingJson<IpuStateDTO>(`/strategy-analysis/${symbol}/ipu?timeframe=${timeframe}`),

  getPivotState: (symbol: string, timeframe: string = '5m') =>
    fetchStreamingJson<PivotStateDTO>(`/strategy-analysis/${symbol}/pivot?timeframe=${timeframe}`),

  // Screening endpoints
  getActionableSetups: (timeframe: string = '5m', limit: number = 20) =>
    fetchStreamingJson<StrategyStateDTO[]>(`/strategy-analysis/actionable?timeframe=${timeframe}&limit=${limit}`),

  getHighIpuSymbols: (timeframe: string = '5m', minScore: number = 0.7) =>
    fetchStreamingJson<string[]>(`/strategy-analysis/high-ipu?timeframe=${timeframe}&minScore=${minScore}`),

  getActiveVcpSymbols: (timeframe: string = '5m') =>
    fetchStreamingJson<string[]>(`/strategy-analysis/active-vcp?timeframe=${timeframe}`),

  getBullishVcpSymbols: (timeframe: string = '5m') =>
    fetchStreamingJson<string[]>(`/strategy-analysis/bullish-vcp?timeframe=${timeframe}`),

  getUptrendSymbols: (timeframe: string = '5m') =>
    fetchStreamingJson<string[]>(`/strategy-analysis/uptrend?timeframe=${timeframe}`),

  // Metadata
  getAvailableSymbols: (timeframe: string = '5m') =>
    fetchStreamingJson<string[]>(`/strategy-analysis/available?timeframe=${timeframe}`),

  getStateCounts: (timeframe: string = '5m') =>
    fetchStreamingJson<Record<string, number>>(`/strategy-analysis/counts?timeframe=${timeframe}`),
}

// ===== RISK STATUS API (Circuit Breaker, Risk Monitoring) =====
export interface RiskStatus {
  healthy: boolean
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'HALTED'
  message: string
  circuitBreakerTripped: boolean
  circuitBreakerReason?: string
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

export const riskStatusApi = {
  getStatus: () => fetchJson<RiskStatus>('/risk/status'),
}

// ===== AUTH API =====
export interface AuthResponse {
  token: string
  user: UserProfile
}

export interface UserProfile {
  id: string
  username: string
  email: string
  displayName: string
  role: 'ADMIN' | 'TRADER' | 'VIEWER'
  enabled: boolean
  createdAt: string
  lastLoginAt: string
  allowedPages?: string[]
  preferences?: {
    timezone: string
    defaultLotSize: number
    riskTolerance: string
    preferredInstruments: string[]
    notificationSettings: {
      telegram: boolean
      email: boolean
      inApp: boolean
      telegramChatId?: string
      emailAddress?: string
    }
  }
}

export const authApi = {
  login: (credentials: { username: string; password: string }) =>
    postJsonNoAuth<AuthResponse>('/auth/login', credentials),

  register: (data: { username: string; email: string; password: string; displayName: string }) =>
    postJsonNoAuth<AuthResponse>('/auth/register', data),

  me: () => fetchJson<UserProfile>('/auth/me'),

  refresh: async (): Promise<AuthResponse> => {
    // Uses raw fetch — NOT fetchWithAuth — to avoid infinite retry loop
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({}),
    })
    if (!response.ok) {
      throw new Error(`Refresh failed: ${response.status}`)
    }
    return response.json()
  },

  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    postJson<{ message: string }>('/auth/password/change', data),
}

// ===== PROFILE API =====
export const profileApi = {
  getProfile: () => fetchJson<UserProfile>('/profile'),
  updateProfile: (data: Partial<UserProfile>) => putJson<UserProfile>('/profile', data),
  updatePreferences: (prefs: UserProfile['preferences']) => putJson<UserProfile>('/profile/preferences', prefs),
  updateNotifications: (settings: UserProfile['preferences']) => putJson<UserProfile>('/profile/notifications', settings),
}

// ===== ADMIN API =====
export const adminApi = {
  getUsers: (page = 0, size = 20) => fetchJson<{ content: UserProfile[]; totalElements: number }>(`/admin/users?page=${page}&size=${size}`),
  updateUserRole: (userId: string, role: string) => putJson<UserProfile>(`/admin/users/${userId}/role`, { role }),
  toggleUserEnabled: (userId: string, enabled: boolean) => putJson<UserProfile>(`/admin/users/${userId}/enable`, { enabled }),
  deleteUser: (userId: string) => deleteJson<{ message: string }>(`/admin/users/${userId}`),
  getSidebarPages: () => fetchJson<Array<{ key: string; label: string }>>('/admin/sidebar-pages'),
  getUserPermissions: (userId: string) => fetchJson<{ allowedPages: string[] }>(`/admin/users/${userId}/permissions`),
  updateUserPermissions: (userId: string, allowedPages: string[]) => putJson<UserProfile>(`/admin/users/${userId}/permissions`, { allowedPages }),
  createUser: (payload: { username: string; email: string; password: string; displayName?: string; role?: string; allowedPages?: string[] }) =>
    postJson<UserProfile>('/admin/users', payload),
}

// ===== PnL API =====
export const pnlApi = {
  getSummary: (walletType = 'PAPER') =>
    fetchJson<Record<string, unknown>>(`/pnl/summary?walletType=${walletType}`),
  getWallets: () => fetchJson<unknown[]>('/pnl/wallets'),
  getDailyPnl: (walletType = 'PAPER', days = 30) =>
    fetchJson<unknown[]>(`/pnl/daily?walletType=${walletType}&days=${days}`),
  getEquityCurve: (walletType = 'PAPER') =>
    fetchJson<unknown[]>(`/pnl/equity-curve?walletType=${walletType}`),
  getCalendar: (walletType = 'PAPER', year?: number) =>
    fetchJson<Record<string, number>>(`/pnl/calendar?walletType=${walletType}${year ? `&year=${year}` : ''}`),
  getByInstrument: (walletType = 'PAPER') =>
    fetchJson<unknown[]>(`/pnl/by-instrument?walletType=${walletType}`),
  getByStrategy: (walletType = 'PAPER') =>
    fetchJson<unknown[]>(`/pnl/by-strategy?walletType=${walletType}`),
  getMetrics: (walletType = 'PAPER') =>
    fetchJson<Record<string, unknown>>(`/pnl/metrics?walletType=${walletType}`),
  getTradeJournal: (walletType = 'PAPER', page = 0, size = 20) =>
    fetchJson<{ content: unknown[] }>(`/pnl/trade-journal?walletType=${walletType}&page=${page}&size=${size}`),
  updateTradeNotes: (tradeId: string, notes: string, tags?: string[]) =>
    putJson<unknown>(`/pnl/trade-journal/${tradeId}/notes`, { notes, tags }),
}

// ===== WATCHLIST API =====
export const watchlistApi = {
  getWatchlists: () => fetchJson<unknown[]>('/watchlists'),
  createWatchlist: (name: string) => postJson<unknown>('/watchlists', { name }),
  renameWatchlist: (id: string, name: string) => putJson<unknown>(`/watchlists/${id}`, { name }),
  deleteWatchlist: (id: string) => deleteJson<unknown>(`/watchlists/${id}`),
  addInstrument: (id: string, instrument: { scripCode: string; symbol: string; companyName: string; exchange: string }) =>
    postJson<unknown>(`/watchlists/${id}/instruments`, instrument),
  removeInstrument: (id: string, scripCode: string) =>
    deleteJson<unknown>(`/watchlists/${id}/instruments/${scripCode}`),
  reorderInstruments: (id: string, scripCodes: string[]) =>
    putJson<unknown>(`/watchlists/${id}/instruments/reorder`, { scripCodes }),
}

// ===== INSTRUMENT ANALYSIS API =====
export const analysisApi = {
  getOverview: (scripCode: string) => fetchJson<Record<string, unknown>>(`/analysis/${scripCode}/overview`),
  getSignals: (scripCode: string) => fetchJson<unknown[]>(`/analysis/${scripCode}/signals`),
  getPivotLevels: (scripCode: string) => fetchJson<Record<string, unknown>>(`/analysis/${scripCode}/pivots`),
  getRegime: (scripCode: string) => fetchJson<Record<string, unknown>>(`/analysis/${scripCode}/regime`),
  getPrediction: (scripCode: string) => fetchJson<Record<string, unknown>>(`/analysis/${scripCode}/prediction`),
}

// ===== STRATEGY WALLETS API =====
export interface StrategyWalletSummary {
  strategy: string
  displayName: string
  initialCapital: number
  currentCapital: number
  totalPnl: number
  totalPnlPercent: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  availableMargin?: number
  usedMargin?: number
  mcxUsedMargin?: number
  dayPnl?: number
  circuitBreakerTripped?: boolean
  circuitBreakerReason?: string
  cumulativeLockdown?: boolean
  cumulativeLockdownReason?: string
  cumulativeLockdownAt?: string
  unrealizedPnl?: number
  peakBalance?: number
  maxDrawdown?: number
  maxDrawdownPercent?: number
  profitFactor?: number
  avgWin?: number
  avgLoss?: number
}

export interface WalletTransaction {
  transactionId: string
  walletId: string
  type: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  scripCode?: string
  symbol?: string
  description?: string
  timestamp: string
}

export interface WalletEvent {
  eventType: 'MARGIN_INSUFFICIENT' | 'FUND_ADDED' | 'SIGNAL_EXPIRED'
  walletId: string
  strategyKey?: string
  scripCode?: string
  instrumentSymbol?: string
  side?: string
  qty?: number
  requiredMargin?: number
  expiresAt?: number
  amount?: number
  retriedSignals?: number
}

export interface StrategyWalletTrade {
  tradeId: string
  scripCode: string
  companyName: string
  side: string
  direction: string
  entryPrice: number
  exitPrice: number
  exitReason: string
  target1Hit: boolean
  target2Hit: boolean
  target3Hit: boolean
  target4Hit: boolean
  stopHit: boolean
  quantity: number
  capitalEmployed: number
  pnl: number
  pnlPercent: number
  entryTime: string
  exitTime: string
  strategy: string
  variant?: string | null
  executionMode?: 'AUTO' | 'MANUAL'
  exchange: string
  // Price levels
  stopLoss?: number | null
  target1?: number | null
  target2?: number | null
  target3?: number | null
  target4?: number | null
  // Dual-leg levels (equity/FUT)
  equitySl?: number | null
  equityT1?: number | null
  equityT2?: number | null
  equityT3?: number | null
  equityT4?: number | null
  // Dual-leg levels (option)
  optionSl?: number | null
  optionT1?: number | null
  optionT2?: number | null
  optionT3?: number | null
  optionT4?: number | null
  // Instrument metadata
  instrumentType?: string | null
  instrumentSymbol?: string | null
  // Analytics
  rMultiple?: number | null
  confidence?: number | null
  durationMinutes?: number | null
  // Transaction charges (Zerodha round-trip)
  totalCharges?: number | null
  // Slippage — entry
  estimatedEntrySlippage?: number | null
  estimatedEntrySlippageTotal?: number | null
  estimatedSlippagePct?: number | null
  slippageTier?: string | null
  // Slippage — exit
  exitSlippagePerUnit?: number | null
  exitSlippageTotal?: number | null
  // Gross P&L + charge breakdown
  grossPnl?: number | null
  chargesBrokerage?: number | null
  chargesStt?: number | null
  chargesExchange?: number | null
  chargesGst?: number | null
  chargesSebi?: number | null
  chargesStamp?: number | null
  // Signal-level metrics (for correlation analytics)
  atr?: number | null
  volumeSurge?: number | null
  oiChangePercent?: number | null
  blockDealPercent?: number | null
  riskReward?: number | null
}

export const strategyWalletsApi = {
  getSummaries: () =>
    fetchJson<StrategyWalletSummary[]>('/strategy-wallets/summary'),

  getCapital: (strategy: string) =>
    fetchJson<{ strategy: string; currentCapital: number; initialCapital: number; totalPnl: number;
      availableMargin: number; usedMargin: number; openPositionCount: number; positionsByExchange: Record<string, number> }>(
      `/strategy-wallets/capital/${encodeURIComponent(strategy)}`
    ),

  getWeeklyTrades: (params?: {
    strategy?: string
    direction?: string
    exchange?: string
    sortBy?: string
    limit?: number
    from?: number
    to?: number
  }) => {
    const p = new URLSearchParams()
    if (params?.strategy) p.set('strategy', params.strategy)
    if (params?.direction) p.set('direction', params.direction)
    if (params?.exchange) p.set('exchange', params.exchange)
    if (params?.sortBy) p.set('sortBy', params.sortBy)
    if (params?.limit) p.set('limit', String(params.limit))
    if (params?.from) p.set('from', String(params.from))
    if (params?.to) p.set('to', String(params.to))
    const qs = p.toString()
    return fetchJson<StrategyWalletTrade[]>(`/strategy-wallets/trades${qs ? '?' + qs : ''}`)
  },

  addFunds: (strategy: string, amount: number) =>
    postJson<{ success: boolean; newBalance: number; retriedSignals: number }>(
      `/strategy-wallets/capital/${encodeURIComponent(strategy)}/add-funds`, { amount }),

  resetCircuitBreaker: (strategy: string) =>
    postJson<{ success: boolean; message: string }>(
      `/strategy-wallets/${encodeURIComponent(strategy)}/reset-circuit-breaker`, {}),

  unlockCumulativeLockdown: (strategy: string) =>
    postJson<{ success: boolean; message: string }>(
      `/strategy-wallets/${encodeURIComponent(strategy)}/unlock-cumulative`, {}),

  getTransactions: (strategy: string, limit = 50) =>
    fetchJson<WalletTransaction[]>(
      `/strategy-wallets/capital/${encodeURIComponent(strategy)}/transactions?limit=${limit}`),
}

// ===== STRATEGY TRADES API (Virtual option/futures trade execution) =====
export const strategyTradesApi = {
  create: (req: StrategyTradeRequest) =>
    postJson<StrategyTradeResponse>('/strategy-trades', req),

  getActive: () =>
    fetchJson<Record<string, unknown>[]>('/strategy-trades/active'),

  close: (scripCode: string) =>
    postJson<StrategyTradeResponse>(`/strategy-trades/${scripCode}/close`, {}),
}

// ===== PIVOT AUTO-TRADE CONTROL API =====
export const pivotAutoTradeApi = {
  getStatus: () =>
    fetchJson<{ autoTradeEnabled: boolean; paused: boolean }>('/strategy-state/pivot/auto-trade/status'),

  toggle: (enabled?: boolean) =>
    postJson<{ autoTradeEnabled: boolean; paused: boolean }>(
      '/strategy-state/pivot/auto-trade/toggle',
      enabled !== undefined ? { enabled } : {}
    ),
}

// ===== MARKET DATA API (LTP lookup for stale price checks) =====
export const marketDataApi = {
  getLtp: (scripCode: string) => fetchJson<{ scripCode: string; ltp: number | null }>(`/market-data/ltp/${scripCode}`),
}

// ===== GREEKS API (compute revised SL/targets for CTA) =====
export interface GreeksResult {
  delta: number; gamma: number; theta: number; vega: number; iv: number; dte: number;
  moneynessType: string; thetaImpaired: boolean;
  optionSL: number; optionT1: number; optionT2: number; optionT3: number; optionT4: number;
  optionRR: number; slMethod: string; gammaBoost: number; lotAllocation: string;
  optionLtp: number; spot: number;
}
export const greeksApi = {
  compute: (params: {
    spot: number; strike: number; optionLtp: number; optionType: string; expiry: string;
    equityEntry: number; equitySl: number; equityT1: number;
    equityT2?: number; equityT3?: number; equityT4?: number;
  }) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) q.set(k, String(v)) })
    return fetchJson<GreeksResult>(`/greeks/compute?${q}`)
  },
}

// ===== GREEK TRAILING API (monitoring + control) =====
export interface GreekTrailState {
  positionKey: string
  scripCode: string
  companyName: string
  optionType: string
  strike: number
  exchange: string
  strategy: string
  status: string // TRAILING, EXITED, etc.
  // Delta
  currentDelta: number
  deltaAtT1: number
  peakDelta: number
  deltaAccelRatio: number
  // Premium
  currentPremium: number
  highWatermark: number
  trailStopPrice: number
  currentTrailPct: number
  // Greeks
  currentGamma: number
  currentIV: number
  thetaBurnRate: number
  // Time
  dte: number
  t1HitTime: number // epoch ms
  exitTime?: number
  exitReason?: string
  // P&L
  entryPremium: number
  exitPremium?: number
  estimatedPnl?: number
  lotSize?: number
}

export const greekTrailingApi = {
  getActive: () => fetchJson<GreekTrailState[]>('/greek-trailing/active'),
  forceExit: (positionKey: string) =>
    postJson<{ success: boolean; message: string }>(
      `/greek-trailing/force-exit/${encodeURIComponent(positionKey)}`, {}),
  disable: () =>
    postJson<{ success: boolean; message: string; trailsKilled: number }>(
      '/greek-trailing/disable', {}),
}

// ── Hot Stocks ────────────────────────────────────────────────
export const hotStocksApi = {
  async list(): Promise<HotStocksListResponse> {
    const res = await fetch(`${API_BASE}/hot-stocks`)
    if (!res.ok) throw new Error(`hot-stocks list failed: ${res.status}`)
    return res.json()
  },

  async single(symbol: string): Promise<StockMetrics> {
    const res = await fetch(`${API_BASE}/hot-stocks/${encodeURIComponent(symbol)}`)
    if (!res.ok) throw new Error(`hot-stocks single failed: ${res.status}`)
    return res.json()
  },

  async wallet(): Promise<Record<string, unknown>> {
    const res = await fetch(`${API_BASE}/hot-stocks/wallet`)
    if (!res.ok) throw new Error(`hot-stocks wallet failed: ${res.status}`)
    return res.json()
  },
}

// Export helpers for use in other service files
export { fetchJson, postJson, putJson, deleteJson, patchJson, API_BASE }

