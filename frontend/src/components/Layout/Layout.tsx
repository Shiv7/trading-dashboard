import { ReactNode, useState, useEffect } from 'react'
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
  const [showSearch, setShowSearch] = useState(false)

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(true)
      }
      if (e.key === 'Escape') {
        setShowSearch(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const toggleSound = () => {
    const newState = !soundEnabled
    setSoundEnabled(newState)
    alertService.setEnabled(newState)
    if (newState) {
      alertService.playTest()
    }
  }

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    )},
    { to: '/quant-scores', label: 'Quant', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )},
    { to: '/signals', label: 'Signals', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    )},
    { to: '/patterns', label: 'Patterns', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
      </svg>
    )},
    { to: '/wallet', label: 'Wallet', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    )},
    { to: '/trades', label: 'Trades', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    )},
    { to: '/performance', label: 'Performance', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )},
    { to: '/risk', label: 'Risk', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )},
    { to: '/scores', label: 'Scores', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    )},
  ]

  const getRegimeColor = () => {
    if (!regime) return 'text-slate-400'
    if (regime.label.includes('STRONG_BULLISH')) return 'text-emerald-400'
    if (regime.label.includes('BULLISH')) return 'text-emerald-400'
    if (regime.label.includes('STRONG_BEARISH')) return 'text-red-400'
    if (regime.label.includes('BEARISH')) return 'text-red-400'
    return 'text-amber-400'
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-900">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="px-4 lg:px-6">
          <div className="flex items-center h-14">
            {/* Left: Logo + Nav */}
            <div className="flex items-center gap-1">
              {/* Logo */}
              <NavLink to="/dashboard" className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">
                <img
                  src="/logo.jpeg"
                  alt="Kotsin"
                  className="w-8 h-8 rounded-lg"
                />
                <span className="text-lg font-bold text-white hidden sm:block">KOTSIN</span>
              </NavLink>

              {/* Divider */}
              <div className="w-px h-6 bg-slate-700 mx-2 hidden md:block" />

              {/* Navigation */}
              <nav className="hidden md:flex items-center">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`
                    }
                    title={item.label}
                  >
                    {item.icon}
                    <span className="hidden lg:inline">{item.label}</span>
                  </NavLink>
                ))}
              </nav>
            </div>

            {/* Center: Search */}
            <div className="flex-1 flex justify-center px-4">
              <div className="w-full max-w-md">
                {showSearch ? (
                  <div className="relative">
                    <ScripFinder
                      placeholder="Search stocks..."
                      autoFocus
                      onClose={() => setShowSearch(false)}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSearch(true)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 text-sm hover:border-slate-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="hidden sm:inline">Search stocks...</span>
                    <kbd className="hidden sm:inline-flex ml-auto px-1.5 py-0.5 text-xs bg-slate-700 rounded">
                      Ctrl K
                    </kbd>
                  </button>
                )}
              </div>
            </div>

            {/* Right: Status + User */}
            <div className="flex items-center gap-2">
              {/* Trading Mode - Compact */}
              <TradingModeToggle />

              {/* Status Indicators - Grouped */}
              <div className="hidden lg:flex items-center gap-1 px-2 py-1 bg-slate-800/50 rounded-lg">
                {/* Connection */}
                <button
                  onClick={() => !connected && reconnect()}
                  className={`p-1.5 rounded transition-colors ${
                    connected ? 'text-emerald-400' : 'text-red-400 hover:bg-slate-700'
                  }`}
                  title={connected ? 'Connected' : 'Disconnected - Click to reconnect'}
                >
                  <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                </button>

                {/* Regime */}
                <div className={`px-2 py-1 text-xs font-medium ${getRegimeColor()}`} title="Market Regime">
                  {regime?.label?.replace(/_/g, ' ').slice(0, 12) || '...'}
                </div>
              </div>

              {/* Sound Toggle */}
              <button
                onClick={toggleSound}
                className={`p-2 rounded-lg transition-colors ${
                  soundEnabled
                    ? 'text-emerald-400 hover:bg-slate-800'
                    : 'text-slate-500 hover:bg-slate-800'
                }`}
                title={soundEnabled ? 'Sound ON' : 'Sound OFF'}
              >
                {soundEnabled ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                  className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                    <span className="text-slate-900 font-bold text-sm">
                      {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </span>
                  </div>
                </button>

                {/* Dropdown */}
                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUserMenu(false)}
                    />
                    <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                      {/* User Info */}
                      <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/50">
                        <p className="text-sm font-medium text-white">{user?.name}</p>
                        <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                        {user?.role === 'admin' && (
                          <span className="inline-flex mt-1.5 px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded">
                            Admin
                          </span>
                        )}
                      </div>

                      {/* Quick Stats */}
                      <div className="px-4 py-2 border-b border-slate-700 bg-slate-900/30">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">Connection</span>
                          <span className={connected ? 'text-emerald-400' : 'text-red-400'}>
                            {connected ? 'Live' : 'Offline'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs mt-1">
                          <span className="text-slate-400">Market</span>
                          <span className={getRegimeColor()}>
                            {regime?.label?.replace(/_/g, ' ') || 'Loading'}
                          </span>
                        </div>
                      </div>

                      {/* Menu Items */}
                      <div className="py-1">
                        <NavLink
                          to="/wallet"
                          onClick={() => setShowUserMenu(false)}
                          className="flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                          My Wallet
                        </NavLink>
                        <NavLink
                          to="/trades"
                          onClick={() => setShowUserMenu(false)}
                          className="flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                          </svg>
                          Trade History
                        </NavLink>
                      </div>

                      {/* Logout */}
                      <div className="border-t border-slate-700 py-1">
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

        {/* Mobile Nav */}
        <div className="md:hidden border-t border-slate-800 px-2 py-1 overflow-x-auto">
          <nav className="flex items-center gap-1 min-w-max">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`
                }
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 lg:px-6 py-4">
        {children}
      </main>

      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  )
}
