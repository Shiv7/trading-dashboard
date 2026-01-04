import { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useDashboardStore } from '../../store/dashboardStore'
import NotificationPanel from './NotificationPanel'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { connected, reconnect } = useWebSocket()
  const { regime } = useDashboardStore()

  const navItems = [
    { to: '/', label: 'Dashboard', icon: '📊' },
    { to: '/wallet', label: 'Wallet', icon: '💰' },
    { to: '/trades', label: 'Trades', icon: '📈' },
    { to: '/scores', label: 'Scores', icon: '🎯' },
    { to: '/signals', label: 'Signals', icon: '⚡' },
  ]

  const getRegimeStyle = () => {
    if (!regime) return 'text-slate-400 bg-slate-700/50'
    if (regime.label.includes('STRONG_BULLISH')) return 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/30'
    if (regime.label.includes('BULLISH')) return 'text-emerald-400 bg-emerald-500/10'
    if (regime.label.includes('STRONG_BEARISH')) return 'text-red-400 bg-red-500/10 border border-red-500/30'
    if (regime.label.includes('BEARISH')) return 'text-red-400 bg-red-500/10'
    return 'text-amber-400 bg-amber-500/10'
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-800/80 backdrop-blur-md border-b border-slate-700/50 sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <NavLink to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">K</span>
              </div>
              <h1 className="text-xl font-display font-bold text-white hidden sm:block">
                KOTSIN
              </h1>
            </NavLink>

            {/* Navigation */}
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                    }`
                  }
                >
                  <span>{item.icon}</span>
                  <span className="hidden md:inline">{item.label}</span>
                </NavLink>
              ))}
            </nav>

            {/* Status indicators */}
            <div className="flex items-center gap-3">
              {/* Regime indicator */}
              <div className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${getRegimeStyle()}`}>
                <span className="text-xs opacity-75">
                  {regime?.indexName || 'NIFTY'}:
                </span>
                <span className="text-sm font-medium">
                  {regime?.label?.replace(/_/g, ' ') || 'Loading...'}
                </span>
              </div>

              {/* WebSocket status */}
              <button
                onClick={() => !connected && reconnect()}
                className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-all ${
                  connected
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer'
                }`}
                title={connected ? 'Connected to live data' : 'Click to reconnect'}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                  }`}
                />
                <span className="text-xs font-medium">
                  {connected ? 'LIVE' : 'OFFLINE'}
                </span>
              </button>

              {/* Notifications */}
              <NotificationPanel />
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

