import { useEffect, useState, useCallback, useRef } from 'react'
import { useDashboardStore, MarketNarrative, MarketIntelligence } from '../store/dashboardStore'
import { initialStateApi } from '../services/api'

/**
 * Hook to fetch and populate initial state from backend cache on mount.
 *
 * This solves the problem of data disappearing on page refresh:
 * - Backend maintains cache of all Kafka data
 * - This hook fetches the cache and populates the store on mount
 * - WebSocket then provides real-time updates
 */
export function useInitialState() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  const loadedRef = useRef(false)

  const {
    updateScore,
    updateQuantScore,
    bulkUpdateQuantScores,
    addSignal,
    updateNarrative,
    updateIntelligence,
  } = useDashboardStore()

  const loadInitialState = useCallback(async () => {
    // Prevent double loading
    if (loadedRef.current) {
      return
    }
    loadedRef.current = true

    setLoading(true)
    setError(null)

    try {
      console.log('[InitialState] Fetching initial state from backend...')
      const state = await initialStateApi.getInitialState()

      console.log('[InitialState] Received:', {
        scores: state.scores?.length || 0,
        quantScores: state.quantScores?.length || 0,
        narratives: Object.keys(state.narratives || {}).length,
        intelligence: Object.keys(state.intelligence || {}).length,
        signals: state.signals?.length || 0,
      })

      // Populate scores
      if (state.scores && state.scores.length > 0) {
        state.scores.forEach(score => {
          if (score.scripCode) {
            updateScore(score)
          }
        })
        console.log(`[InitialState] Loaded ${state.scores.length} family scores`)
      }

      // Populate quant scores
      if (state.quantScores && state.quantScores.length > 0) {
        bulkUpdateQuantScores(state.quantScores)
        console.log(`[InitialState] Loaded ${state.quantScores.length} quant scores`)
      }

      // Populate narratives
      if (state.narratives) {
        Object.entries(state.narratives).forEach(([familyId, narrative]) => {
          updateNarrative({
            familyId,
            ...(narrative as Omit<MarketNarrative, 'familyId'>)
          })
        })
        console.log(`[InitialState] Loaded ${Object.keys(state.narratives).length} narratives`)
      }

      // Populate intelligence
      if (state.intelligence) {
        Object.entries(state.intelligence).forEach(([familyId, intel]) => {
          updateIntelligence({
            familyId,
            ...(intel as Omit<MarketIntelligence, 'familyId'>)
          })
        })
        console.log(`[InitialState] Loaded ${Object.keys(state.intelligence).length} intelligence entries`)
      }

      // Populate recent signals
      if (state.signals && state.signals.length > 0) {
        // Add signals in reverse order so most recent appears first
        state.signals.reverse().forEach(signal => {
          addSignal(signal)
        })
        console.log(`[InitialState] Loaded ${state.signals.length} recent signals`)
      }

      setDataLoaded(state.dataAvailable)
      console.log('[InitialState] Initial state loaded successfully')

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load initial state'
      console.error('[InitialState] Error:', errorMessage)
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadInitialState()
  }, [loadInitialState])

  const refresh = useCallback(() => {
    loadedRef.current = false
    loadInitialState()
  }, [loadInitialState])

  return {
    loading,
    error,
    dataLoaded,
    refresh,
  }
}

export default useInitialState
