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
      const state = await initialStateApi.getInitialState()

      // Populate scores
      if (state.scores && state.scores.length > 0) {
        state.scores.forEach(score => {
          if (score.scripCode) {
            updateScore(score)
          }
        })
      }

      // Populate quant scores
      if (state.quantScores && state.quantScores.length > 0) {
        bulkUpdateQuantScores(state.quantScores)
      }

      // Populate narratives
      if (state.narratives) {
        Object.entries(state.narratives).forEach(([familyId, narrative]) => {
          updateNarrative({
            familyId,
            ...(narrative as Omit<MarketNarrative, 'familyId'>)
          })
        })
      }

      // Populate intelligence
      if (state.intelligence) {
        Object.entries(state.intelligence).forEach(([familyId, intel]) => {
          updateIntelligence({
            familyId,
            ...(intel as Omit<MarketIntelligence, 'familyId'>)
          })
        })
      }

      // Populate recent signals
      if (state.signals && state.signals.length > 0) {
        // Add signals in reverse order so most recent appears first
        state.signals.reverse().forEach(signal => {
          addSignal(signal)
        })
      }

      setDataLoaded(state.dataAvailable)

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
