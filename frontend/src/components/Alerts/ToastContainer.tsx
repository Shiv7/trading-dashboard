import { useEffect, useState, useCallback, useRef } from 'react'
import { useDashboardStore } from '../../store/dashboardStore'
import { alertService } from '../../services/alertService'
import { useNavigate } from 'react-router-dom'
import type { Notification } from '../../types'

interface Toast {
  id: string
  notification: Notification
  visible: boolean
}

const MAX_VISIBLE = 4

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const notifications = useDashboardStore((s) => s.notifications)
  const lastCountRef = useRef(0)
  const navigate = useNavigate()
  const autoTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // Watch for new notifications
  useEffect(() => {
    if (notifications.length > lastCountRef.current) {
      const newNotifications = notifications.slice(0, notifications.length - lastCountRef.current)

      newNotifications.forEach((notification) => {
        const id = `${notification.timestamp}-${Math.random()}`
        setToasts((prev) => [...prev, { id, notification, visible: true }])

        // Play sound based on notification type
        if (notification.type.includes('BULLISH') || notification.type.includes('LONG')) {
          alertService.playSignalAlert('bullish')
        } else if (notification.type.includes('BEARISH') || notification.type.includes('SHORT')) {
          alertService.playSignalAlert('bearish')
        } else if (notification.type.includes('XFACTOR')) {
          alertService.playXFactor()
        } else if (notification.type.includes('SL_HIT')) {
          alertService.playTradeAlert('sl_hit')
        } else if (notification.type.includes('TP_HIT') || notification.type.includes('WIN')) {
          alertService.playTradeAlert('tp_hit')
        } else {
          alertService.playSignalAlert('neutral')
        }

        // Auto-remove after 5 seconds
        const t1 = setTimeout(() => {
          setToasts((prev) =>
            prev.map((t) => (t.id === id ? { ...t, visible: false } : t))
          )
          const t2 = setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id))
          }, 300)
          autoTimersRef.current.add(t2)
        }, 5000)
        autoTimersRef.current.add(t1)
      })
    }
    lastCountRef.current = notifications.length
  }, [notifications])

  // Dismiss ALL toasts at once — clicking X on any toast clears the entire stack
  const dismissAll = useCallback(() => {
    // Cancel all pending auto-dismiss timers
    autoTimersRef.current.forEach(clearTimeout)
    autoTimersRef.current.clear()
    // Animate out
    setToasts((prev) => prev.map((t) => ({ ...t, visible: false })))
    setTimeout(() => setToasts([]), 300)
  }, [])

  const handleClick = useCallback((notification: Notification) => {
    const scripMatch = notification.message.match(/N:[CD]:\d+/)
    if (scripMatch) {
      navigate(`/stock/${scripMatch[0]}`)
    }
  }, [navigate])

  // Manual toasts from store (for trade actions, errors, etc.)
  const manualToasts = useDashboardStore((s) => s.toastMessages)
  const dismissManualToast = useDashboardStore((s) => s.dismissToast)

  // Dismiss ALL manual toasts
  const dismissAllManual = useCallback(() => {
    manualToasts.forEach((t) => dismissManualToast(t.id))
  }, [manualToasts, dismissManualToast])

  if (toasts.length === 0 && manualToasts.length === 0) return null

  const visibleToasts = toasts.slice(-MAX_VISIBLE)
  const hiddenCount = Math.max(0, toasts.length - MAX_VISIBLE)
  const totalCount = toasts.length + manualToasts.length

  const getToastStyle = (type: string) => {
    if (type.includes('BULLISH') || type.includes('LONG') || type.includes('WIN') || type.includes('TP_HIT')) {
      return 'bg-gradient-to-r from-emerald-500/90 to-green-600/90 border-emerald-400'
    }
    if (type.includes('BEARISH') || type.includes('SHORT') || type.includes('SL_HIT') || type.includes('LOSS')) {
      return 'bg-gradient-to-r from-red-500/90 to-rose-600/90 border-red-400'
    }
    if (type.includes('XFACTOR') || type.includes('CRITICAL')) {
      return 'bg-gradient-to-r from-yellow-500/90 to-amber-600/90 border-yellow-400'
    }
    return 'bg-gradient-to-r from-blue-500/90 to-indigo-600/90 border-blue-400'
  }

  const getToastIcon = (type: string) => {
    if (type.includes('SIGNAL')) return '⚡'
    if (type.includes('TRADE') || type.includes('ENTRY')) return '📈'
    if (type.includes('XFACTOR')) return '🔥'
    if (type.includes('TP_HIT') || type.includes('WIN')) return '🎯'
    if (type.includes('SL_HIT') || type.includes('LOSS')) return '⚠️'
    if (type.includes('IPU')) return '🏛️'
    if (type.includes('VCP')) return '📊'
    return '🔔'
  }

  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2 max-w-md">
      {/* Dismiss All bar — shown when 2+ total toasts */}
      {totalCount >= 2 && (
        <button
          onClick={() => { dismissAll(); dismissAllManual() }}
          className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full
                     bg-slate-800/80 backdrop-blur-sm border border-slate-600/50
                     text-xs text-slate-300 hover:text-white hover:bg-slate-700/90
                     transition-colors shadow-lg"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Dismiss all ({totalCount})
        </button>
      )}

      {/* Overflow indicator */}
      {hiddenCount > 0 && (
        <div className="text-xs text-slate-400 text-right pr-1">
          +{hiddenCount} more
        </div>
      )}

      {/* WebSocket notification toasts (capped at MAX_VISIBLE) */}
      {visibleToasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => handleClick(toast.notification)}
          className={`
            transform transition-all duration-300 ease-out cursor-pointer
            ${toast.visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
            ${getToastStyle(toast.notification.type)}
            backdrop-blur-sm border-l-4 rounded-lg shadow-2xl p-3
          `}
        >
          <div className="flex items-start gap-2">
            <span className="text-lg flex-shrink-0">{getToastIcon(toast.notification.type)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white leading-snug">
                {toast.notification.message}
              </p>
              <span className="text-[10px] text-white/60 uppercase tracking-wider">
                {toast.notification.type.replace(/_/g, ' ')}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                dismissAll()
              }}
              className="text-white/70 hover:text-white transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}

      {/* Manual toast messages (trade actions, errors, etc.) */}
      {manualToasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            transform transition-all duration-300 ease-out
            ${toast.visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
            ${toast.type === 'success' ? 'bg-gradient-to-r from-emerald-500/90 to-green-600/90 border-emerald-400'
              : toast.type === 'error' ? 'bg-gradient-to-r from-red-500/90 to-rose-600/90 border-red-400'
              : 'bg-gradient-to-r from-blue-500/90 to-indigo-600/90 border-blue-400'}
            backdrop-blur-sm border-l-4 rounded-lg shadow-2xl p-3
          `}
        >
          <div className="flex items-start gap-2">
            <span className="text-lg flex-shrink-0">
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}
            </span>
            <p className="text-xs font-medium text-white leading-snug flex-1">{toast.message}</p>
            <button
              onClick={() => dismissAllManual()}
              className="text-white/70 hover:text-white transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
