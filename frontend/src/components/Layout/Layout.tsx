import { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useDashboardStore } from '../../store/dashboardStore'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { connected } = useWebSocket()
  const { regime, notifications } = useDashboardStore()

  const navItems = [
    { to: '/', label: 'Dashboard', icon: '📊' },
    { to: '/wallet', label: 'Wallet', icon: '💰' },
    { to: '/trades', label: 'Trades', icon: '📈' },
    { to: '/scores', label: 'Scores', icon: '🎯' },
    { to: '/signals', label: 'Signals', icon: '⚡' },
  ]

  const regimeColor = regime?.label?.includes('BULLISH') 
    ? 'text-emerald-400' 
    : regime?.label?.includes('BEARISH') 
      ? 'text-red-400' 
      : 'text-slate-400'

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-800/80 backdrop-blur-md border-b border-slate-700/50 sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <span className="text-2xl">📉</span>
              <h1 className="text-xl font-display font-bold text-white">
                KOTSIN TRADING
              </h1>
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700'
                    }`
                  }
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>

            {/* Status indicators */}
            <div className="flex items-center gap-4">
              {/* Regime indicator */}
              {regime && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 rounded-lg">
                  <span className="text-xs text-slate-400">
                    {regime.indexName}:
                  </span>
                  <span className={`text-sm font-medium ${regimeColor}`}>
                    {regime.label}
                  </span>
                </div>
              )}

              {/* WebSocket status */}
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    connected ? 'bg-emerald-400 pulse-green' : 'bg-red-400'
                  }`}
                />
                <span className="text-xs text-slate-400">
                  {connected ? 'LIVE' : 'OFFLINE'}
                </span>
              </div>

              {/* Notifications bell */}
              <div className="relative">
                <button className="p-2 text-slate-400 hover:text-white transition-colors">
                  <span className="text-lg">🔔</span>
                  {notifications.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center text-white">
                      {notifications.length > 9 ? '9+' : notifications.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-slate-800/50 border-t border-slate-700/50 py-3">
        <div className="container mx-auto px-4 text-center text-xs text-slate-500">
          Kotsin Trading Dashboard • Real-time Market Analysis • Paper Trading Mode
        </div>
      </footer>
    </div>
  )
}

