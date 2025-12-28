import type { Wallet, Position, FamilyScore, Signal, Trade, TradeStats } from '../types'

const API_BASE = '/api'

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

