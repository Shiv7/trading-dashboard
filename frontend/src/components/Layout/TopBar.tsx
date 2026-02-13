import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useDashboardStore } from '../../store/dashboardStore'

export default function TopBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showUserMenu, setShowUserMenu] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const regime = useDashboardStore((s) => s.regime)

  // Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(true)
        setTimeout(() => searchRef.current?.focus(), 100)
      }
      if (e.key === 'Escape') {
        setShowSearch(false)
        setShowUserMenu(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate(`/stock/${searchQuery.trim().toUpperCase()}`)
      setSearchQuery('')
      setShowSearch(false)
    }
  }

  const getRegimeColor = () => {
    if (!regime) return 'text-slate-500'
    const r = typeof regime === 'string' ? regime : (regime as { regime?: string })?.regime || ''
    if (r.includes('BULL') || r.includes('UP')) return 'text-emerald-400'
    if (r.includes('BEAR') || r.includes('DOWN')) return 'text-red-400'
    return 'text-amber-400'
  }

  const getRegimeLabel = () => {
    if (!regime) return 'Unknown'
    const r = typeof regime === 'string' ? regime : (regime as { regime?: string })?.regime || ''
    if (r.includes('BULL') || r.includes('UP')) return 'Bullish'
    if (r.includes('BEAR') || r.includes('DOWN')) return 'Bearish'
    return 'Neutral'
  }

  return (
    <header className="sticky top-0 z-30 h-14 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/50">
      <div className="h-full flex items-center justify-between px-4 lg:px-6">
        {/* Left: Mobile logo + Search */}
        <div className="flex items-center gap-3">
          {/* Mobile logo */}
          <Link to="/dashboard" className="lg:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-xs font-black text-slate-900">
              K
            </div>
          </Link>

          {/* Search bar */}
          <div className="relative">
            <button
              onClick={() => {
                setShowSearch(!showSearch)
                setTimeout(() => searchRef.current?.focus(), 100)
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm text-slate-400 hover:border-slate-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="hidden sm:inline">Search instruments...</span>
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 bg-slate-700/50 rounded text-[10px] text-slate-500 font-mono">
                Ctrl+K
              </kbd>
            </button>

            {showSearch && (
              <form onSubmit={handleSearch} className="absolute top-full left-0 mt-2 w-72 sm:w-96">
                <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Enter scrip code (e.g., RELIANCE, TCS)..."
                    className="w-full px-4 py-3 bg-transparent text-white placeholder-slate-500 focus:outline-none text-sm"
                    autoFocus
                  />
                  <div className="px-4 py-2 border-t border-slate-700/50 flex items-center gap-2 text-[10px] text-slate-500">
                    <kbd className="px-1 bg-slate-700 rounded">Enter</kbd> to search
                    <kbd className="px-1 bg-slate-700 rounded">Esc</kbd> to close
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Right: Status indicators + User */}
        <div className="flex items-center gap-3">
          {/* Connection status placeholder */}
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
          </div>

          {/* Market regime */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-slate-800/50 rounded-lg">
            <span className={`text-xs font-bold ${getRegimeColor()}`}>{getRegimeLabel()}</span>
          </div>

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-xs font-bold text-slate-900">
                {user?.displayName?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <span className="hidden md:inline text-sm text-slate-300">{user?.displayName || user?.username}</span>
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-700/50">
                  <p className="text-sm font-medium text-white">{user?.displayName}</p>
                  <p className="text-xs text-slate-400">{user?.role}</p>
                </div>
                <div className="py-1">
                  <Link
                    to="/profile"
                    onClick={() => setShowUserMenu(false)}
                    className="block px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 transition-colors"
                  >
                    Profile & Settings
                  </Link>
                  {user?.role === 'ADMIN' && (
                    <Link
                      to="/admin"
                      onClick={() => setShowUserMenu(false)}
                      className="block px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 transition-colors"
                    >
                      Admin Panel
                    </Link>
                  )}
                </div>
                <div className="border-t border-slate-700/50 py-1">
                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      logout()
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700/50 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
