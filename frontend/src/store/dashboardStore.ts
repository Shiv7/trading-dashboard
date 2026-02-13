import { create } from 'zustand'
import type { Wallet, FamilyScore, Signal, Trade, Regime, Notification, MasterArchSignal, ACLData, FUDKIIData, QuantScore, PatternSignal } from '../types'

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
  // FIX BUG #20: Changed from Map<Map> to Record<Record> for JSON serialization
  quantScores: Record<string, Record<string, QuantScore>>
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

  // Pattern Signals (for real-time updates)
  patternSignals: PatternSignal[]
  updatePatternSignal: (pattern: PatternSignal) => void
  bulkUpdatePatternSignals: (patterns: PatternSignal[]) => void
  removePatternSignal: (patternId: string) => void

  // Data freshness
  lastDataReceived: number
  touchLastData: () => void

  // Manual toast messages (for trade actions, errors, etc.)
  toastMessages: { id: string; message: string; type: 'success' | 'error' | 'info'; visible: boolean }[]
  addToast: (message: string, type: 'success' | 'error' | 'info') => void
  dismissToast: (id: string) => void

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

  // FIX BUG #18: Master Architecture signals - now keyed by signalId AND scripCode
  // Keep multiple signals per scripCode (e.g., BUY at 10:00, SELL at 10:05)
  masterArchSignals: [],
  updateMasterArch: (signal) => set((state) => {
    // Check if this exact signal already exists
    const existingIndex = state.masterArchSignals.findIndex(s =>
      s.scripCode === signal.scripCode && s.timestamp === signal.timestamp
    )

    if (existingIndex >= 0) {
      // Update existing signal
      const newSignals = [...state.masterArchSignals]
      newSignals[existingIndex] = signal
      return { masterArchSignals: newSignals }
    }

    // Add new signal, keeping last 50 (increased from 20)
    return { masterArchSignals: [signal, ...state.masterArchSignals].slice(0, 50) }
  }),

  // ACL data (latest for index)
  acl: null,
  updateACL: (acl) => set({ acl }),

  // FUDKII active signals (SuperTrend + BB triggers)
  activeIgnitions: [],
  updateFUDKII: (data) => set((state) => {
    // Use 'triggered' field for new ST+BB format
    const isTriggered = data.triggered ?? false
    if (isTriggered) {
      // Add or update active signal
      const existingIndex = state.activeIgnitions.findIndex(i => i.scripCode === data.scripCode)
      if (existingIndex >= 0) {
        const newIgnitions = [...state.activeIgnitions]
        newIgnitions[existingIndex] = data
        return { activeIgnitions: newIgnitions }
      }
      return { activeIgnitions: [data, ...state.activeIgnitions].slice(0, 10) }
    } else {
      // Remove from active signals
      return { activeIgnitions: state.activeIgnitions.filter(i => i.scripCode !== data.scripCode) }
    }
  }),

  // QuantScores - Multi-Timeframe support (scripCode -> timeframe -> score)
  // FIX BUG #20 & #21: Changed from Map to Record for JSON serialization and atomic updates
  quantScores: {},
  updateQuantScore: (score) => set((state) => {
    if (!score || !score.scripCode) {
      console.warn('Invalid quant score update - missing scripCode')
      return state
    }
    const timeframe = score.timeframe || '5m'
    const scripCode = score.scripCode

    // Atomic immutable update
    return {
      quantScores: {
        ...state.quantScores,
        [scripCode]: {
          ...(state.quantScores[scripCode] || {}),
          [timeframe]: score
        }
      }
    }
  }),
  bulkUpdateQuantScores: (scores) => set((state) => {
    if (!scores || !Array.isArray(scores)) return state

    // Build new state in single pass for atomicity (FIX BUG #21)
    const newScores = { ...state.quantScores }
    for (const score of scores) {
      if (!score || !score.scripCode) continue
      const timeframe = score.timeframe || '5m'
      const scripCode = score.scripCode
      newScores[scripCode] = {
        ...(newScores[scripCode] || {}),
        [timeframe]: score
      }
    }
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

  // Pattern Signals (for real-time WebSocket updates)
  patternSignals: [],
  updatePatternSignal: (pattern) => set((state) => {
    if (!pattern || !pattern.patternId) {
      console.warn('Invalid pattern signal update - missing patternId')
      return state
    }
    const existingIndex = state.patternSignals.findIndex(p => p.patternId === pattern.patternId)
    if (existingIndex >= 0) {
      // Update existing pattern
      const newPatterns = [...state.patternSignals]
      newPatterns[existingIndex] = pattern
      return { patternSignals: newPatterns }
    }
    // Add new pattern (keep last 200)
    return { patternSignals: [pattern, ...state.patternSignals].slice(0, 200) }
  }),
  bulkUpdatePatternSignals: (patterns) => set((state) => {
    if (!patterns || !Array.isArray(patterns)) return state
    const patternMap = new Map(state.patternSignals.map(p => [p.patternId, p]))
    for (const pattern of patterns) {
      if (pattern && pattern.patternId) {
        patternMap.set(pattern.patternId, pattern)
      }
    }
    return { patternSignals: Array.from(patternMap.values()).slice(0, 200) }
  }),
  removePatternSignal: (patternId) => set((state) => ({
    patternSignals: state.patternSignals.filter(p => p.patternId !== patternId)
  })),

  // Data freshness
  lastDataReceived: Date.now(),
  touchLastData: () => set({ lastDataReceived: Date.now() }),

  // Manual toast messages
  toastMessages: [],
  addToast: (message, type) => set((state) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    // Auto-remove after 4 seconds
    setTimeout(() => {
      useDashboardStore.setState((s) => ({
        toastMessages: s.toastMessages.map((t) =>
          t.id === id ? { ...t, visible: false } : t
        ),
      }))
      setTimeout(() => {
        useDashboardStore.setState((s) => ({
          toastMessages: s.toastMessages.filter((t) => t.id !== id),
        }))
      }, 300)
    }, 4000)
    return { toastMessages: [...state.toastMessages, { id, message, type, visible: true }] }
  }),
  dismissToast: (id) => set((state) => ({
    toastMessages: state.toastMessages.map((t) =>
      t.id === id ? { ...t, visible: false } : t
    ),
  })),

  // UI state
  selectedStock: null,
  setSelectedStock: (scripCode) => set({ selectedStock: scripCode }),
}))

/** Standalone accessor — avoids circular reference inside store definition */
export function getQuantScore(scripCode: string, timeframe = '5m'): QuantScore | undefined {
  const state = useDashboardStore.getState()
  return state.quantScores[scripCode]?.[timeframe]
}

