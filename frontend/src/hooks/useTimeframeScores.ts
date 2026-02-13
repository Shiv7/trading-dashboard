import { useMemo } from 'react'
import { useDashboardStore } from '../store/dashboardStore'
import type { QuantScore } from '../types'

// Standard timeframes in order from smallest to largest
export const TIMEFRAMES = ['5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const
export type Timeframe = typeof TIMEFRAMES[number]

interface UseTimeframeScoresResult {
  // All scores across timeframes
  allScores: QuantScore[]
  // Score for specific timeframe
  getScore: (tf: string) => QuantScore | undefined
  // Latest score by timestamp (for backward compatibility)
  latestScore: QuantScore | undefined
  // Check if we have data for a timeframe
  hasTimeframe: (tf: string) => boolean
  // Count of available timeframes
  availableCount: number
  // Calculate direction consensus
  directionConsensus: {
    dominant: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    percentage: number
    bullishCount: number
    bearishCount: number
    neutralCount: number
  }
}

/**
 * Custom hook to access multi-timeframe QuantScore data for a scripCode
 */
export function useTimeframeScores(scripCode: string | undefined): UseTimeframeScoresResult {
  const quantScores = useDashboardStore((s) => s.quantScores)

  return useMemo(() => {
    if (!scripCode) {
      return {
        allScores: [],
        getScore: () => undefined,
        latestScore: undefined,
        hasTimeframe: () => false,
        availableCount: 0,
        directionConsensus: {
          dominant: 'NEUTRAL',
          percentage: 0,
          bullishCount: 0,
          bearishCount: 0,
          neutralCount: 0
        }
      }
    }

    const tfRecord = quantScores[scripCode]
    const allScores: QuantScore[] = tfRecord ? Object.values(tfRecord) : []

    // Find latest score by timestamp
    let latestScore: QuantScore | undefined
    let latestTime = 0
    allScores.forEach((score: QuantScore) => {
      if (score.timestamp > latestTime) {
        latestTime = score.timestamp
        latestScore = score
      }
    })

    // Calculate direction consensus
    let bullishCount = 0
    let bearishCount = 0
    let neutralCount = 0
    allScores.forEach((score: QuantScore) => {
      if (score.direction === 'BULLISH') bullishCount++
      else if (score.direction === 'BEARISH') bearishCount++
      else neutralCount++
    })

    const total = allScores.length
    let dominant: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let percentage = 0
    if (total > 0) {
      if (bullishCount >= bearishCount && bullishCount > neutralCount) {
        dominant = 'BULLISH'
        percentage = (bullishCount / total) * 100
      } else if (bearishCount > bullishCount && bearishCount > neutralCount) {
        dominant = 'BEARISH'
        percentage = (bearishCount / total) * 100
      } else {
        dominant = 'NEUTRAL'
        percentage = (neutralCount / total) * 100
      }
    }

    return {
      allScores,
      getScore: (tf: string) => tfRecord?.[tf],
      latestScore,
      hasTimeframe: (tf: string) => tf in (tfRecord ?? {}),
      availableCount: allScores.length,
      directionConsensus: {
        dominant,
        percentage,
        bullishCount,
        bearishCount,
        neutralCount
      }
    }
  }, [scripCode, quantScores])
}

/**
 * Get a single QuantScore for display (latest by timestamp)
 * For backward compatibility with existing components
 */
export function useLatestQuantScore(scripCode: string | undefined): QuantScore | undefined {
  const { latestScore } = useTimeframeScores(scripCode)
  return latestScore
}
