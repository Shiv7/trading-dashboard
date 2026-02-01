import { useEffect, useState, useCallback, useRef } from 'react'
import { technicalIndicatorsApi } from '../services/api'
import {
  TechnicalIndicators,
  IndicatorHistoryPoint,
  normalizeIndicators,
  normalizeHistoryPoint
} from '../types/indicators'
import { useWebSocket } from './useWebSocket'

interface UseIndicatorsReturn {
  indicators: TechnicalIndicators | null;
  history: IndicatorHistoryPoint[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching and subscribing to technical indicators.
 * Provides Bollinger Bands, VWAP, and SuperTrend data for a given scrip.
 *
 * @param scripCode Scrip code to fetch indicators for
 * @param timeframe Timeframe (default: '5m')
 * @returns Indicators data, history for chart overlays, and loading state
 */
export function useIndicators(scripCode: string | undefined, timeframe: string = '5m'): UseIndicatorsReturn {
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null)
  const [history, setHistory] = useState<IndicatorHistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { connected } = useWebSocket()
  const wsSubscription = useRef<{ unsubscribe: () => void } | null>(null)

  // Fetch initial data
  const fetchData = useCallback(async () => {
    if (!scripCode) {
      setIndicators(null)
      setHistory([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [indicatorData, historyData] = await Promise.all([
        technicalIndicatorsApi.getIndicators(scripCode, timeframe).catch(() => null),
        technicalIndicatorsApi.getIndicatorHistory(scripCode, timeframe, 100).catch(() => [])
      ])

      if (indicatorData) {
        setIndicators(normalizeIndicators(indicatorData))
      }

      if (historyData && historyData.length > 0) {
        setHistory(historyData.map(normalizeHistoryPoint))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch indicators'
      setError(message)
      console.error('[useIndicators] Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }, [scripCode, timeframe])

  // Initial fetch
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // WebSocket subscription for real-time updates
  // Note: This requires the backend to broadcast to /topic/indicators/{scripCode}
  // For now, we'll poll every 5 seconds as a fallback
  useEffect(() => {
    if (!scripCode || !connected) return

    // Poll for updates every 5 seconds
    const pollInterval = setInterval(async () => {
      try {
        const data = await technicalIndicatorsApi.getIndicators(scripCode, timeframe)
        if (data) {
          const normalized = normalizeIndicators(data)
          setIndicators(normalized)

          // Add to history
          setHistory(prev => {
            const historyPoint = normalizeHistoryPoint(data)
            const lastPoint = prev[prev.length - 1]

            // Only add if timestamp is different
            if (!lastPoint || lastPoint.timestamp !== historyPoint.timestamp) {
              const updated = [...prev, historyPoint]
              // Keep last 100 entries
              return updated.slice(-100)
            }
            return prev
          })
        }
      } catch (err) {
        console.debug('[useIndicators] Poll error (non-fatal):', err)
      }
    }, 5000)

    return () => {
      clearInterval(pollInterval)
      if (wsSubscription.current) {
        wsSubscription.current.unsubscribe()
        wsSubscription.current = null
      }
    }
  }, [scripCode, timeframe, connected])

  return {
    indicators,
    history,
    loading,
    error,
    refetch: fetchData
  }
}

/**
 * Hook for batch fetching indicators for multiple scrips (watchlist).
 *
 * @param scripCodes Array of scrip codes
 * @param timeframe Timeframe (default: '5m')
 * @returns Map of scripCode -> indicators, loading state
 */
export function useBatchIndicators(scripCodes: string[], timeframe: string = '5m') {
  const [indicators, setIndicators] = useState<Map<string, TechnicalIndicators>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBatch = useCallback(async () => {
    if (scripCodes.length === 0) {
      setIndicators(new Map())
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await technicalIndicatorsApi.getBatchIndicators(scripCodes, timeframe)
      const normalizedMap = new Map<string, TechnicalIndicators>()

      Object.entries(data).forEach(([code, dto]) => {
        normalizedMap.set(code, normalizeIndicators(dto))
      })

      setIndicators(normalizedMap)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch batch indicators'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [scripCodes.join(','), timeframe])

  useEffect(() => {
    fetchBatch()
  }, [fetchBatch])

  // Poll for updates
  useEffect(() => {
    if (scripCodes.length === 0) return

    const pollInterval = setInterval(fetchBatch, 10000) // Every 10 seconds for batch
    return () => clearInterval(pollInterval)
  }, [fetchBatch, scripCodes.length])

  return {
    indicators,
    loading,
    error,
    refetch: fetchBatch
  }
}
