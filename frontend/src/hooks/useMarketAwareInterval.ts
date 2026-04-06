import { useEffect, useRef } from 'react'
import { isExchangeOpen, isAnyMarketOpen } from '../utils/tradingUtils'

/**
 * setInterval that only fires during market hours for the given exchange.
 * Stops entirely outside trading hours / holidays / weekends.
 *
 * @param callback   - Function to call on each tick
 * @param intervalMs - Polling interval in ms (e.g. 30000)
 * @param exchange   - Exchange code: 'N'|'NSE', 'M'|'MCX', 'C'|'CDS', or 'ANY' for any-market-open
 * @param enabled    - Optional external enable flag (e.g. autoRefresh toggle). Default true.
 *
 * Re-checks market status every 60s when market is closed, so polling resumes
 * within ~1 minute of market open.
 */
export function useMarketAwareInterval(
  callback: () => void,
  intervalMs: number,
  exchange: string = 'ANY',
  enabled: boolean = true,
) {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    if (!enabled) return

    let activeInterval: ReturnType<typeof setInterval> | null = null
    let marketCheckInterval: ReturnType<typeof setInterval> | null = null

    const isOpen = () =>
      exchange === 'ANY' ? isAnyMarketOpen() : isExchangeOpen(exchange)

    const startPolling = () => {
      if (activeInterval) return
      activeInterval = setInterval(() => {
        if (!isOpen()) {
          // Market closed mid-session — stop polling, start checking
          stopPolling()
          startMarketCheck()
          return
        }
        savedCallback.current()
      }, intervalMs)
    }

    const stopPolling = () => {
      if (activeInterval) {
        clearInterval(activeInterval)
        activeInterval = null
      }
    }

    const startMarketCheck = () => {
      if (marketCheckInterval) return
      marketCheckInterval = setInterval(() => {
        if (isOpen()) {
          stopMarketCheck()
          savedCallback.current() // Immediate first fetch on market open
          startPolling()
        }
      }, 60_000) // Check every 60s
    }

    const stopMarketCheck = () => {
      if (marketCheckInterval) {
        clearInterval(marketCheckInterval)
        marketCheckInterval = null
      }
    }

    // Initial check
    if (isOpen()) {
      savedCallback.current() // Immediate first call
      startPolling()
    } else {
      startMarketCheck()
    }

    return () => {
      stopPolling()
      stopMarketCheck()
    }
  }, [intervalMs, exchange, enabled])
}
