import type {
  Wallet, Position, FamilyScore, Signal, Trade, TradeStats, IPUSignal, VCPSignal,
  QuantScore, QuantScoreStats, CreateOrderRequest, ModifyPositionRequest, VirtualOrder, VirtualPosition,
  PerformanceMetrics, PatternSignal, PatternSummary, PatternStats,
  RiskMetrics, RiskScore, RiskAlert,
  AlertHistory, AlertStats, AlertSummary
} from '../types'
import type {
  TechnicalIndicatorDTO,
  UnifiedCandleDTO,
  VcpStateDTO,
  IpuStateDTO,
  PivotStateDTO,
  StrategyStateDTO
} from '../types/indicators'

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
  getMetrics: () => fetchJson<RiskMetrics>('/risk'),

  getExposure: () => fetchJson<RiskMetrics['portfolioExposure']>('/risk/exposure'),

  getConcentration: () => fetchJson<RiskMetrics['concentrationRisk']>('/risk/concentration'),

  getDirection: () => fetchJson<RiskMetrics['directionExposure']>('/risk/direction'),

  getVaR: () => fetchJson<RiskMetrics['valueAtRisk']>('/risk/var'),

  getRiskScore: () => fetchJson<RiskScore>('/risk/score'),

  getAlerts: () => fetchJson<RiskAlert[]>('/risk/alerts'),

  getSummary: () => fetchJson<{
    riskScore: number
    riskLevel: string
    openPositions: number
    maxLossExposure: number
    netDirection: string
    alertCount: number
    var95: number
  }>('/risk/summary'),
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

  tripCircuitBreaker: (reason?: string) =>
    postJson<{ success: boolean; message: string }>(
      `/risk/circuit-breaker/trip?reason=${encodeURIComponent(reason || 'Manual intervention')}`,
      {}
    ),

  resetCircuitBreaker: () =>
    postJson<{ success: boolean; message: string }>(
      '/risk/circuit-breaker/reset',
      {}
    ),
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

// Export helpers for use in other service files
export { fetchJson, postJson, putJson, deleteJson, patchJson, API_BASE }

