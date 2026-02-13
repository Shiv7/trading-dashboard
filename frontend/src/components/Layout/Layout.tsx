import { ReactNode, useState, useEffect, useMemo } from 'react'
import { NavLink, useNavigate, useLocation, Link } from 'react-router-dom'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useInitialState } from '../../hooks/useInitialState'
import { useDashboardStore } from '../../store/dashboardStore'
import { useAuth } from '../../context/AuthContext'
import NotificationPanel from './NotificationPanel'
import ScripFinder from '../Search/ScripFinder'
import ToastContainer from '../Alerts/ToastContainer'
import TradingModeToggle from '../Trading/TradingModeToggle'
import { alertService } from '../../services/alertService'
import MobileTabBar from './MobileTabBar'

interface LayoutProps {
  children: ReactNode
}

// Sidebar nav items
const sidebarItems = [
  { to: '/dashboard', label: 'Dashboard', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /> },
  { to: '/watchlist', label: 'Watchlist', icon: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></> },
  { to: '/orders', label: 'Orders', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /> },
  { to: '/wallet', label: 'Positions', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /> },
  { to: '/pnl', label: 'PnL Analytics', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /> },
  { to: '/signals', label: 'Signals', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /> },
  { to: '/quant-scores', label: 'Quant Scores', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /> },
  { to: '/risk', label: 'Risk', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /> },
  { to: '/strategy', label: 'Strategy', icon: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></> },
  { to: '/trades', label: 'Trades', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /> },
  { to: '/performance', label: 'Performance', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /> },
  { to: '/patterns', label: 'Patterns', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /> },
  { to: '/scores', label: 'Scores', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /> },
]

export default function Layout({ children }: LayoutProps) {
  const { connected, reconnecting, error: wsError, reconnect } = useWebSocket()
  useInitialState()
  const { regime, lastDataReceived } = useDashboardStore()
  const { user, logout } = useAuth()
  const [now, setNow] = useState(Date.now())
  const navigate = useNavigate()
  const location = useLocation()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(alertService.isEnabled())
  const [showSearch, setShowSearch] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(true)
      }
      if (e.key === 'Escape') {
        setShowSearch(false)
        setShowUserMenu(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Tick every 15s to update "last updated" display
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  const lastUpdatedLabel = useMemo(() => {
    const diffSec = Math.floor((now - lastDataReceived) / 1000)
    if (diffSec < 10) return 'just now'
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    return `${Math.floor(diffMin / 60)}h ago`
  }, [now, lastDataReceived])

  const isStale = !connected && (now - lastDataReceived > 60000)

  const toggleSound = () => {
    const newState = !soundEnabled
    setSoundEnabled(newState)
    alertService.setEnabled(newState)
    if (newState) alertService.playTest()
  }

  const getRegimeColor = () => {
    if (!regime) return 'text-slate-400'
    if (regime.label.includes('BULLISH')) return 'text-emerald-400'
    if (regime.label.includes('BEARISH')) return 'text-red-400'
    return 'text-amber-400'
  }

  const getRegimeLabel = () => {
    if (!regime) return '...'
    return regime.label?.replace(/_/g, ' ').slice(0, 12) || '...'
  }

  const isActive = (path: string) =>
    location.pathname === path || (path !== '/dashboard' && location.pathname.startsWith(path))

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Sidebar - desktop only */}
      <aside className={`fixed left-0 top-0 h-full bg-slate-900/95 backdrop-blur-xl border-r border-slate-800/80 z-40 transition-all duration-300 hidden lg:flex flex-col ${
        sidebarCollapsed ? 'w-16' : 'w-56'
      }`}>
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-slate-800/80">
          <NavLink to="/dashboard" className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-sm font-black text-slate-900 flex-shrink-0">
              K
            </div>
            {!sidebarCollapsed && (
              <span className="text-sm font-bold text-white tracking-wide truncate">KOTSIN</span>
            )}
          </NavLink>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {sidebarItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-all relative ${
                isActive(item.to)
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              {isActive(item.to) && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-amber-400 rounded-r" />
              )}
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">{item.icon}</svg>
              {!sidebarCollapsed && (
                <span className="text-sm font-medium truncate">{item.label}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="border-t border-slate-800/80 py-3 px-2 space-y-0.5">
          <NavLink
            to="/profile"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
              isActive('/profile') ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
            title={sidebarCollapsed ? 'Settings' : undefined}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {!sidebarCollapsed && <span className="text-sm font-medium">Settings</span>}
          </NavLink>

          {user?.role === 'ADMIN' && (
            <NavLink
              to="/admin"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                isActive('/admin') ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
              title={sidebarCollapsed ? 'Admin' : undefined}
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              {!sidebarCollapsed && <span className="text-sm font-medium">Admin</span>}
            </NavLink>
          )}

          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800/50 transition-all"
          >
            <svg className={`w-5 h-5 flex-shrink-0 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            {!sidebarCollapsed && <span className="text-sm">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-56'}`}>
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-14 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/50">
          <div className="h-full flex items-center justify-between px-4 lg:px-6">
            {/* Left: Mobile logo + Search */}
            <div className="flex items-center gap-3">
              <Link to="/dashboard" className="lg:hidden">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-xs font-black text-slate-900">K</div>
              </Link>

              <div className="w-full max-w-md">
                {showSearch ? (
                  <div className="relative">
                    <ScripFinder placeholder="Search stocks..." autoFocus onClose={() => setShowSearch(false)} />
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSearch(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-slate-400 hover:border-slate-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="hidden sm:inline">Search stocks...</span>
                    <kbd className="hidden sm:inline-flex ml-auto px-1.5 py-0.5 text-[10px] bg-slate-700/50 rounded text-slate-500 font-mono">Ctrl+K</kbd>
                  </button>
                )}
              </div>
            </div>

            {/* Right: Status indicators */}
            <div className="flex items-center gap-2">
              <TradingModeToggle />

              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-slate-800/50 rounded-lg">
                <button
                  onClick={() => !connected && reconnect()}
                  className={`p-1 rounded transition-colors ${connected ? 'text-emerald-400' : 'text-red-400 hover:bg-slate-700'}`}
                  title={connected ? 'Connected' : 'Disconnected - click to retry'}
                >
                  <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                </button>
                <div className={`px-1 text-xs font-medium ${getRegimeColor()}`}>{getRegimeLabel()}</div>
                <span className="text-[10px] text-slate-500 ml-1" title="Last data received">{lastUpdatedLabel}</span>
              </div>

              <button
                onClick={toggleSound}
                className={`p-2 rounded-lg transition-colors hidden sm:block ${soundEnabled ? 'text-emerald-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-800'}`}
                title={soundEnabled ? 'Sound ON' : 'Sound OFF'}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={soundEnabled
                    ? "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    : "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                  } />
                </svg>
              </button>

              <NotificationPanel />

              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-xs font-bold text-slate-900">
                    {user?.displayName?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <span className="hidden md:inline text-sm text-slate-300">{user?.displayName || user?.username}</span>
                </button>

                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 mt-2 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-700/50">
                        <p className="text-sm font-medium text-white">{user?.displayName || user?.username}</p>
                        <p className="text-xs text-slate-400">{user?.role}</p>
                      </div>
                      <div className="py-1">
                        <NavLink to="/profile" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50">Profile & Settings</NavLink>
                        <NavLink to="/wallet" onClick={() => setShowUserMenu(false)} className="block px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50">My Wallet</NavLink>
                      </div>
                      <div className="border-t border-slate-700/50 py-1">
                        <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700/50">Sign Out</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Reconnecting Banner */}
        {!connected && (reconnecting || wsError) && (
          <div className={`px-4 py-2 text-center text-sm ${wsError ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
            {wsError ? (
              <span>{wsError} — <button onClick={reconnect} className="underline font-medium hover:text-white">Retry</button></span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Reconnecting to live data...
              </span>
            )}
          </div>
        )}

        {/* Stale Data Banner */}
        {isStale && (
          <div className="px-4 py-2 text-center text-sm bg-amber-500/10 text-amber-400 border-b border-amber-500/20">
            <span>Data may be stale (last update: {lastUpdatedLabel}) — </span>
            <button onClick={reconnect} className="underline font-medium hover:text-white">Reconnect</button>
          </div>
        )}

        {/* Main content */}
        <main className="px-4 lg:px-6 py-6 pb-24 lg:pb-6 page-enter">
          <div className="max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile tab bar */}
      <MobileTabBar />

      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  )
}
