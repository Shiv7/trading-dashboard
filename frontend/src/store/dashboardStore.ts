import { create } from 'zustand'
import type { Wallet, FamilyScore, Signal, Trade, Regime, Notification, MasterArchSignal, ACLData, FUDKIIData, QuantScore } from '../types'

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

  // Master Architecture signals
  masterArchSignals: MasterArchSignal[]
  updateMasterArch: (signal: MasterArchSignal) => void

  // ACL (Anti-Cycle Limiter) data - keyed by indexName/scripCode
  acl: ACLData | null
  updateACL: (acl: ACLData) => void

  // FUDKII active ignitions
  activeIgnitions: FUDKIIData[]
  updateFUDKII: (data: FUDKIIData) => void

  // QuantScores (keyed by scripCode)
  quantScores: Map<string, QuantScore>
  updateQuantScore: (score: QuantScore) => void
  bulkUpdateQuantScores: (scores: QuantScore[]) => void

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

  // Master Architecture signals (keep last 20)
  masterArchSignals: [],
  updateMasterArch: (signal) => set((state) => {
    const existingIndex = state.masterArchSignals.findIndex(s => s.scripCode === signal.scripCode)
    if (existingIndex >= 0) {
      const newSignals = [...state.masterArchSignals]
      newSignals[existingIndex] = signal
      return { masterArchSignals: newSignals }
    }
    return { masterArchSignals: [signal, ...state.masterArchSignals].slice(0, 20) }
  }),

  // ACL data (latest for index)
  acl: null,
  updateACL: (acl) => set({ acl }),

  // FUDKII active ignitions
  activeIgnitions: [],
  updateFUDKII: (data) => set((state) => {
    if (data.ignitionFlag) {
      // Add or update active ignition
      const existingIndex = state.activeIgnitions.findIndex(i => i.scripCode === data.scripCode)
      if (existingIndex >= 0) {
        const newIgnitions = [...state.activeIgnitions]
        newIgnitions[existingIndex] = data
        return { activeIgnitions: newIgnitions }
      }
      return { activeIgnitions: [data, ...state.activeIgnitions].slice(0, 10) }
    } else {
      // Remove from active ignitions
      return { activeIgnitions: state.activeIgnitions.filter(i => i.scripCode !== data.scripCode) }
    }
  }),

  // QuantScores
  quantScores: new Map(),
  updateQuantScore: (score) => set((state) => {
    const newScores = new Map(state.quantScores)
    newScores.set(score.scripCode, score)
    return { quantScores: newScores }
  }),
  bulkUpdateQuantScores: (scores) => set((state) => {
    const newScores = new Map(state.quantScores)
    scores.forEach(score => newScores.set(score.scripCode, score))
    return { quantScores: newScores }
  }),

  // UI state
  selectedStock: null,
  setSelectedStock: (scripCode) => set({ selectedStock: scripCode }),
}))

