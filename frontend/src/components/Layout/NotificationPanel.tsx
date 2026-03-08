import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboardStore } from '../../store/dashboardStore'
import type { Notification } from '../../types'
import { formatTimeAgo } from '../../utils/formatTime'

export default function NotificationPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const { notifications, clearNotifications, notificationsMuted, toggleNotificationsMuted } = useDashboardStore()
  const navigate = useNavigate()

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const getNotificationIcon = (type: string) => {
    if (type.includes('IPU')) return '🏛️'
    if (type.includes('VCP')) return '📊'
    if (type.includes('SIGNAL')) return '⚡'
    if (type.includes('TRADE')) return '💰'
    if (type.includes('REGIME')) return '🌍'
    return '🔔'
  }

  const getNotificationColor = (type: string) => {
    if (type.includes('XFACTOR') || type.includes('PENETRATION')) return 'border-l-yellow-400'
    if (type.includes('BULLISH') || type.includes('WIN')) return 'border-l-emerald-400'
    if (type.includes('BEARISH') || type.includes('LOSS')) return 'border-l-red-400'
    return 'border-l-blue-400'
  }

  // Extract scripCode from notification if available
  const getScripCode = (notification: Notification): string | null => {
    if ('scripCode' in notification && typeof (notification as Record<string, unknown>).scripCode === 'string') {
      return (notification as Record<string, unknown>).scripCode as string
    }
    // Try to extract from message — look for uppercase word patterns like stock symbols
    const match = notification.message.match(/\b([A-Z]{3,}(?:BANK|FIN|TECH|PHARMA)?)\b/)
    return match ? match[1] : null
  }

  const handleNotificationClick = (notification: Notification) => {
    const scripCode = getScripCode(notification)
    if (scripCode) {
      navigate(`/stock/${scripCode}`)
      setIsOpen(false)
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell icon — click toggles mute on/off */}
      <button
        onClick={() => toggleNotificationsMuted()}
        className={`relative p-2 transition-colors rounded-lg hover:bg-slate-700/50 ${
          notificationsMuted ? 'text-red-400/60' : 'text-slate-400 hover:text-white'
        }`}
        title={notificationsMuted ? 'Click to unmute notifications' : 'Click to mute notifications'}
      >
        {notificationsMuted ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        )}
        {!notificationsMuted && notifications.length > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen) }}
            className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 rounded-full text-[10px] flex items-center justify-center text-white font-bold animate-pulse cursor-pointer"
          >
            {notifications.length > 9 ? '9+' : notifications.length}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50 animate-slideDown">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-700/50 border-b border-slate-700">
            <h3 className="font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); toggleNotificationsMuted() }}
                className={`flex items-center gap-1 text-xs transition-colors ${
                  notificationsMuted ? 'text-red-400 hover:text-red-300' : 'text-slate-400 hover:text-white'
                }`}
                title={notificationsMuted ? 'Unmute popups' : 'Mute popups'}
              >
                {notificationsMuted ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                )}
                {notificationsMuted ? 'Unmute' : 'Mute'}
              </button>
              {notifications.length > 0 && (
                <button
                  onClick={() => clearNotifications()}
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            {notifications.length > 0 ? (
              <div className="divide-y divide-slate-700/50">
                {notifications.slice(0, 20).map((notification, idx) => (
                  <NotificationItem
                    key={`${notification.timestamp}-${idx}`}
                    notification={notification}
                    icon={getNotificationIcon(notification.type)}
                    colorClass={getNotificationColor(notification.type)}
                    timeAgo={formatTimeAgo(notification.timestamp)}
                    onClick={() => handleNotificationClick(notification)}
                    clickable={!!getScripCode(notification)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-sm">No notifications yet</p>
                <p className="text-xs mt-1">You'll see alerts here when signals fire</p>
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 20 && (
            <div className="px-4 py-2 bg-slate-700/30 text-center">
              <span className="text-xs text-slate-400">
                Showing 20 of {notifications.length} notifications
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface NotificationItemProps {
  notification: Notification
  icon: string
  colorClass: string
  timeAgo: string
  onClick: () => void
  clickable: boolean
}

function NotificationItem({ notification, icon, colorClass, timeAgo, onClick, clickable }: NotificationItemProps) {
  return (
    <div
      className={`px-4 py-3 hover:bg-slate-700/30 transition-colors border-l-2 ${colorClass} ${clickable ? 'cursor-pointer' : ''}`}
      onClick={clickable ? onClick : undefined}
    >
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-200 leading-snug">{notification.message}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-slate-500">{timeAgo}</span>
            <span className="text-xs text-slate-600">•</span>
            <span className="text-xs text-slate-500 uppercase tracking-wider">
              {notification.type.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
