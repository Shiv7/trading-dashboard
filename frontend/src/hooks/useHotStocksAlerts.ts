import { useEffect, useState } from 'react'
import { hotStocksApi } from '../services/api'
import type { HotStocksAlert } from '../services/api'

const POLL_MS = 30_000
const FRESH_WINDOW_MS = 6 * 60 * 60 * 1000 // 6 hours

/**
 * Pure helper (exported for testing): given an alerts array and "now", return
 * the freshest alert inside the 6-hour window, or undefined.
 */
export function pickFreshAlert(
  alerts: HotStocksAlert[] | undefined | null,
  now: number = Date.now(),
): HotStocksAlert | undefined {
  if (!alerts || alerts.length === 0) return undefined
  let best: HotStocksAlert | undefined
  for (const a of alerts) {
    if (!a || typeof a.at !== 'number') continue
    if (now - a.at >= FRESH_WINDOW_MS) continue
    if (!best || a.at > best.at) best = a
  }
  return best
}

/**
 * Polls GET /api/hot-stocks/alerts every 30s, returns the freshest alert
 * (within the last 6h) or undefined. Never throws — API errors resolve to
 * "no alert".
 *
 * Callers wire this into a top-level component and push the alert onto the
 * FundTopUpModal when type === 'INSUFFICIENT_FUNDS_NEXT_SESSION'.
 */
export function useHotStocksAlerts(): HotStocksAlert | undefined {
  const [alert, setAlert] = useState<HotStocksAlert | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const alerts = await hotStocksApi.alerts()
        if (!alive) return
        setAlert(pickFreshAlert(alerts))
      } catch {
        if (!alive) return
        setAlert(undefined)
      }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return alert
}
