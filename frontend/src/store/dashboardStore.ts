import { create } from 'zustand'
import type { Wallet, FamilyScore, Signal, Trade, Regime, Notification } from '../types'

interface DashboardState {
  // Wallet
  wallet: Wallet | null
  updateWallet: (wallet: Wallet) => void
  
  // Scores (keyed by scripCode)
  scores: Map<string, FamilyScore>
  updateScore: (score: FamilyScore) => void
  
  // Recent signals
  signals: Signal[]
  addSignal: (signal: Signal) => void
  clearSignals: () => void
  
  // Recent trades
  trades: Trade[]
  updateTrade: (trade: Trade) => void
  
  // Current regime
  regime: Regime | null
  updateRegime: (regime: Regime) => void
  
  // Notifications
  notifications: Notification[]
  addNotification: (notification: Notification) => void
  clearNotifications: () => void
  
  // UI state
  selectedStock: string | null
  setSelectedStock: (scripCode: string | null) => void
}

export const useDashboardStore = create<DashboardState>((set) => ({
  // Wallet
  wallet: null,
  updateWallet: (wallet) => set({ wallet }),
  
  // Scores
  scores: new Map(),
  updateScore: (score) => set((state) => {
    const newScores = new Map(state.scores)
    newScores.set(score.scripCode, score)
    return { scores: newScores }
  }),
  
  // Signals (keep last 100)
  signals: [],
  addSignal: (signal) => set((state) => ({
    signals: [signal, ...state.signals].slice(0, 100)
  })),
  clearSignals: () => set({ signals: [] }),
  
  // Trades
  trades: [],
  updateTrade: (trade) => set((state) => {
    const existingIndex = state.trades.findIndex(t => t.tradeId === trade.tradeId)
    if (existingIndex >= 0) {
      const newTrades = [...state.trades]
      newTrades[existingIndex] = trade
      return { trades: newTrades }
    }
    return { trades: [trade, ...state.trades].slice(0, 100) }
  }),
  
  // Regime
  regime: null,
  updateRegime: (regime) => set({ regime }),
  
  // Notifications (keep last 50)
  notifications: [],
  addNotification: (notification) => set((state) => ({
    notifications: [notification, ...state.notifications].slice(0, 50)
  })),
  clearNotifications: () => set({ notifications: [] }),
  
  // UI state
  selectedStock: null,
  setSelectedStock: (scripCode) => set({ selectedStock: scripCode }),
}))

