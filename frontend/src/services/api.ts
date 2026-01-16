import type {
  Wallet, Position, FamilyScore, Signal, Trade, TradeStats, IPUSignal, VCPSignal,
  QuantScore, QuantScoreStats, CreateOrderRequest, ModifyPositionRequest, VirtualOrder, VirtualPosition,
  PerformanceMetrics, PatternSignal, PatternSummary, PatternStats,
  RiskMetrics, RiskScore, RiskAlert,
  AlertHistory, AlertStats, AlertSummary
} from '../types'

// Hardcoded production API URL
const API_BASE = 'http://3.110.228.120:8085/api'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
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
  getActionableScores: (limit = 20) => fetchJson<QuantScore[]>(`/quant-scores/actionable?limit=${limit}`),
  getScoresByDirection: (direction: string) => fetchJson<QuantScore[]>(`/quant-scores/direction/${direction}`),
  getScore: (scripCode: string) => fetchJson<QuantScore>(`/quant-scores/${scripCode}`),
  getStats: () => fetchJson<QuantScoreStats>('/quant-scores/stats'),
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
  const response = await fetch(`${API_BASE}${url}`, {
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

// Helper for PATCH requests
async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `HTTP error! status: ${response.status}`)
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


