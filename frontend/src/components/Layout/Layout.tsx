import { ReactNode, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useDashboardStore } from '../../store/dashboardStore'
import { useAuth } from '../../context/AuthContext'
import NotificationPanel from './NotificationPanel'
import ScripFinder from '../Search/ScripFinder'
import ToastContainer from '../Alerts/ToastContainer'
import TradingModeToggle from '../Trading/TradingModeToggle'
import { alertService } from '../../services/alertService'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { connected, reconnect } = useWebSocket()
  const { regime } = useDashboardStore()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(alertService.isEnabled())

  const toggleSound = () => {
    const newState = !soundEnabled
    setSoundEnabled(newState)
    alertService.setEnabled(newState)
    if (newState) {
      alertService.playTest() // Play a test sound when enabling
    }
  }

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/quant-scores', label: 'QuantScores', icon: '🎯' },
    { to: '/wallet', label: 'Wallet', icon: '💰' },
    { to: '/trades', label: 'Trades', icon: '📈' },
    { to: '/scores', label: 'Family Scores', icon: '🔢' },
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

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-800/80 backdrop-blur-md border-b border-slate-700/50 sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <NavLink to="/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img
                src="/logo.jpeg"
                alt="Kotsin Logo"
                className="w-10 h-10 rounded-xl shadow-lg shadow-amber-500/20"
              />
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
                        ? 'bg-amber-500/20 text-amber-400 shadow-lg shadow-amber-500/10'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                    }`
                  }
                >
                  <span>{item.icon}</span>
                  <span className="hidden lg:inline">{item.label}</span>
                </NavLink>
              ))}
            </nav>

            {/* Search */}
            <div className="hidden md:block">
              <ScripFinder placeholder="Search stocks (Ctrl+K)" />
            </div>

            {/* Status indicators */}
            <div className="flex items-center gap-3">
              {/* Trading Mode Toggle */}
              <TradingModeToggle />

              {/* Regime indicator */}
              <div className={`hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${getRegimeStyle()}`}>
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
                <span className="text-xs font-medium hidden sm:inline">
                  {connected ? 'LIVE' : 'OFFLINE'}
                </span>
              </button>

              {/* Sound Toggle */}
              <button
                onClick={toggleSound}
                className={`p-2 rounded-lg transition-all ${
                  soundEnabled
                    ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                }`}
                title={soundEnabled ? 'Sound alerts ON' : 'Sound alerts OFF'}
              >
                {soundEnabled ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                )}
              </button>

              {/* Notifications */}
              <NotificationPanel />

              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-all"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                    <span className="text-slate-900 font-bold text-sm">
                      {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </span>
                  </div>
                  <span className="text-sm text-slate-300 hidden md:inline max-w-[100px] truncate">
                    {user?.name || 'User'}
                  </span>
                  <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUserMenu(false)}
                    />
                    <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                      {/* User Info */}
                      <div className="px-4 py-3 border-b border-slate-700">
                        <p className="text-sm font-medium text-white">{user?.name}</p>
                        <p className="text-xs text-slate-400">{user?.email}</p>
                        {user?.role === 'admin' && (
                          <span className="inline-flex mt-1 px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded">
                            Admin
                          </span>
                        )}
                      </div>

                      {/* Menu Items */}
                      <div className="py-2">
                        <NavLink
                          to="/dashboard"
                          onClick={() => setShowUserMenu(false)}
                          className="flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
                        >
                          <span>📊</span>
                          Dashboard
                        </NavLink>
                        <NavLink
                          to="/wallet"
                          onClick={() => setShowUserMenu(false)}
                          className="flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
                        >
                          <span>💰</span>
                          My Wallet
                        </NavLink>
                      </div>

                      {/* Logout */}
                      <div className="border-t border-slate-700 py-2">
                        <button
                          onClick={handleLogout}
                          className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          Sign Out
                        </button>
                      </div>
                    </div>
                  </>
                )}
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
        <div className="container mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.jpeg" alt="Kotsin" className="w-6 h-6 rounded-lg" />
            <span className="text-xs text-slate-500">Kotsin Trading Platform</span>
          </div>
          <div className="text-xs text-slate-500">
            Institutional-Grade Quantitative Analytics
          </div>
        </div>
      </footer>

      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  )
}
