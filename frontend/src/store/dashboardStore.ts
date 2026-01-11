import { create } from 'zustand'
import type { Wallet, FamilyScore, Signal, Trade, Regime, Notification, MasterArchSignal, ACLData, FUDKIIData, QuantScore } from '../types'

// Market Intelligence types
export interface MarketNarrative {
  familyId: string
  headline: string
  oneLiner: string
  posture: string
  controlSide: string
  events: unknown[]
  timestamp?: number
}

export interface MarketIntelligence {
  familyId: string
  headline: string
  oneLiner: string
  posture: string
  controlSide: string
  isActionableMoment: boolean
  hasReadySetups: boolean
  hasHighConfidencePredictions: boolean
  overallConfidence: number
  recommendation?: {
    action: string
    direction: string
    confidence: number
    rationale: string
  }
  generatedAt?: string
}

export interface ActiveSetup {
  setupId: string
  familyId: string
  setupType: string
  direction: string
  confidence: number
  entryPrice?: number
  stopLoss?: number
  target?: number
  status: string
}

export interface OpportunityForecast {
  familyId: string
  predictions: {
    type: string
    probability: number
    targetPrice?: number
    timeframe: string
    rationale: string
  }[]
  generatedAt?: string
}

interface DashboardState {
  // Trading Mode
  tradingMode: 'DEMO' | 'LIVE'
  setTradingMode: (mode: 'DEMO' | 'LIVE') => void

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

  // QuantScores (keyed by scripCode -> timeframe -> score for MTF support)
  quantScores: Map<string, Map<string, QuantScore>>
  updateQuantScore: (score: QuantScore) => void
  bulkUpdateQuantScores: (scores: QuantScore[]) => void

  // Market Intelligence (keyed by familyId)
  narratives: Map<string, MarketNarrative>
  updateNarrative: (narrative: MarketNarrative) => void
  intelligence: Map<string, MarketIntelligence>
  updateIntelligence: (intel: MarketIntelligence) => void
  activeSetups: Map<string, ActiveSetup[]>
  updateActiveSetups: (familyId: string, setups: ActiveSetup[]) => void
  forecasts: Map<string, OpportunityForecast>
  updateForecast: (forecast: OpportunityForecast) => void

  // UI state
  selectedStock: string | null
  setSelectedStock: (scripCode: string | null) => void
}

export const useDashboardStore = create<DashboardState>((set) => ({
  // Trading Mode
  tradingMode: 'DEMO',
  setTradingMode: (mode) => set({ tradingMode: mode }),

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

  // QuantScores - Multi-Timeframe support (scripCode -> timeframe -> score)
  quantScores: new Map(),
  updateQuantScore: (score) => set((state) => {
    const newScores = new Map(state.quantScores)
    const timeframe = score.timeframe || '1m'
    const scripCode = score.scripCode || score.familyId

    // Get or create the timeframe map for this scripCode
    const tfScores = new Map(newScores.get(scripCode) || new Map())
    tfScores.set(timeframe, score)
    newScores.set(scripCode, tfScores)

    return { quantScores: newScores }
  }),
  bulkUpdateQuantScores: (scores) => set((state) => {
    const newScores = new Map(state.quantScores)
    scores.forEach(score => {
      const timeframe = score.timeframe || '1m'
      const scripCode = score.scripCode || score.familyId
      const tfScores = new Map(newScores.get(scripCode) || new Map())
      tfScores.set(timeframe, score)
      newScores.set(scripCode, tfScores)
    })
    return { quantScores: newScores }
  }),

  // Market Intelligence
  narratives: new Map(),
  updateNarrative: (narrative) => set((state) => {
    const newNarratives = new Map(state.narratives)
    newNarratives.set(narrative.familyId, narrative)
    return { narratives: newNarratives }
  }),
  intelligence: new Map(),
  updateIntelligence: (intel) => set((state) => {
    const newIntelligence = new Map(state.intelligence)
    newIntelligence.set(intel.familyId, intel)
    return { intelligence: newIntelligence }
  }),
  activeSetups: new Map(),
  updateActiveSetups: (familyId, setups) => set((state) => {
    const newSetups = new Map(state.activeSetups)
    newSetups.set(familyId, setups)
    return { activeSetups: newSetups }
  }),
  forecasts: new Map(),
  updateForecast: (forecast) => set((state) => {
    const newForecasts = new Map(state.forecasts)
    newForecasts.set(forecast.familyId, forecast)
    return { forecasts: newForecasts }
  }),

  // UI state
  selectedStock: null,
  setSelectedStock: (scripCode) => set({ selectedStock: scripCode }),
}))

