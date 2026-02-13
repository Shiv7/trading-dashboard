/**
 * Shared time formatting utilities for consistent timestamp display.
 */

/**
 * Formats a timestamp as a relative "time ago" string.
 * Use for live/real-time data (wallet updated, position opened, notifications).
 */
export function formatTimeAgo(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input)
  const now = Date.now()
  const diff = now - date.getTime()

  if (diff < 0) return 'just now'
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

/**
 * Formats a timestamp as an absolute time string (e.g., "2:35 PM").
 * Use for historical data (trade entry/exit times, signal timestamps).
 */
export function formatAbsoluteTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Formats a timestamp as a full date + time (e.g., "5 Feb 2:35 PM").
 * Use for historical data that may span multiple days.
 */
export function formatDateTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input)
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' }) +
    ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
