import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchJson, postJson, putJson, deleteJson } from '../services/api'

interface WatchlistInstrument {
  scripCode: string
  symbol: string
  companyName: string
  exchange: string
  sortOrder: number
}

interface Watchlist {
  id: string
  name: string
  sortOrder: number
  instruments: WatchlistInstrument[]
  isDefault: boolean
}

interface LivePrice {
  scripCode: string
  ltp: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  volume: number
}

export default function WatchlistPage() {
  const navigate = useNavigate()
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [prices] = useState<Record<string, LivePrice>>({})
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showNewWatchlist, setShowNewWatchlist] = useState(false)
  const [newWatchlistName, setNewWatchlistName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ scripCode: string; symbol: string; companyName: string; exchange: string }>>([])
  const [searching, setSearching] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [flashMap] = useState<Record<string, 'up' | 'down'>>({})

  const activeWatchlist = watchlists.find(w => w.id === activeId)

  useEffect(() => {
    loadWatchlists()
  }, [])

  // Keyboard shortcut Ctrl+/
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setShowAddModal(true)
        setTimeout(() => searchRef.current?.focus(), 100)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const loadWatchlists = async () => {
    try {
      const data = await fetchJson<Watchlist[]>('/watchlists')
      setWatchlists(data)
      if (data.length > 0 && !activeId) {
        setActiveId(data[0].id)
      }
    } catch {
      // If API not ready yet, show empty state
    }
    setLoading(false)
  }

  const handleCreateWatchlist = async () => {
    if (!newWatchlistName.trim()) return
    try {
      await postJson<Watchlist>('/watchlists', { name: newWatchlistName })
      setNewWatchlistName('')
      setShowNewWatchlist(false)
      loadWatchlists()
    } catch { /* ignore */ }
  }

  const handleRenameWatchlist = async (id: string) => {
    if (!editName.trim()) return
    try {
      await putJson<Watchlist>(`/watchlists/${id}`, { name: editName })
      setEditingName(null)
      loadWatchlists()
    } catch { /* ignore */ }
  }

  const handleDeleteWatchlist = async (id: string) => {
    if (!confirm('Delete this watchlist?')) return
    try {
      await deleteJson(`/watchlists/${id}`)
      if (activeId === id) setActiveId(null)
      loadWatchlists()
    } catch { /* ignore */ }
  }

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (query.length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const results = await fetchJson<Array<{ scripCode: string; symbol?: string; companyName?: string; exchange?: string }>>(`/scores/search?q=${encodeURIComponent(query)}&limit=10`)
      setSearchResults(results.map(r => ({
        scripCode: r.scripCode,
        symbol: r.symbol || r.scripCode,
        companyName: r.companyName || '',
        exchange: r.exchange || 'NSE',
      })))
    } catch {
      setSearchResults([])
    }
    setSearching(false)
  }

  const handleAddInstrument = async (instrument: { scripCode: string; symbol: string; companyName: string; exchange: string }) => {
    if (!activeId) return
    try {
      await postJson(`/watchlists/${activeId}/instruments`, instrument)
      setShowAddModal(false)
      setSearchQuery('')
      setSearchResults([])
      loadWatchlists()
    } catch { /* ignore */ }
  }

  const handleRemoveInstrument = async (scripCode: string) => {
    if (!activeId) return
    try {
      await deleteJson(`/watchlists/${activeId}/instruments/${scripCode}`)
      loadWatchlists()
    } catch { /* ignore */ }
  }

  const formatPrice = (n: number) => n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '-'
  const formatChange = (n: number) => (n >= 0 ? '+' : '') + n?.toFixed(2)
  const formatChangePct = (n: number) => (n >= 0 ? '+' : '') + n?.toFixed(2) + '%'

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 bg-slate-800/50 rounded-xl animate-pulse" />
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-800/30 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-display font-bold text-white">Watchlist</h1>
        <button
          onClick={() => { setShowAddModal(true); setTimeout(() => searchRef.current?.focus(), 100) }}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
        >
          <span>+</span> Add Instrument
          <kbd className="px-1.5 py-0.5 bg-slate-600 rounded text-xs text-slate-300">Ctrl+/</kbd>
        </button>
      </div>

      {/* Watchlist Tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2 custom-scrollbar">
        {watchlists.map(w => (
          <div key={w.id} className="relative group flex-shrink-0">
            {editingName === w.id ? (
              <input
                autoFocus
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={() => handleRenameWatchlist(w.id)}
                onKeyDown={e => e.key === 'Enter' && handleRenameWatchlist(w.id)}
                className="px-4 py-2 bg-slate-800 border border-amber-500 rounded-lg text-sm text-white focus:outline-none w-32"
              />
            ) : (
              <button
                onClick={() => setActiveId(w.id)}
                onDoubleClick={() => { setEditingName(w.id); setEditName(w.name) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeId === w.id
                    ? 'bg-amber-500 text-slate-900'
                    : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {w.name}
                {w.isDefault && <span className="ml-1 text-xs opacity-60">*</span>}
              </button>
            )}
            {!w.isDefault && activeId === w.id && (
              <button
                onClick={() => handleDeleteWatchlist(w.id)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                x
              </button>
            )}
          </div>
        ))}
        {showNewWatchlist ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              autoFocus
              value={newWatchlistName}
              onChange={e => setNewWatchlistName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateWatchlist()}
              placeholder="Watchlist name"
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500 w-36"
            />
            <button onClick={handleCreateWatchlist} className="px-3 py-2 bg-amber-500 text-slate-900 rounded-lg text-sm font-medium">Save</button>
            <button onClick={() => setShowNewWatchlist(false)} className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewWatchlist(true)}
            className="px-3 py-2 bg-slate-800/50 border border-dashed border-slate-700 text-slate-500 hover:text-white hover:border-slate-500 rounded-lg text-sm transition-colors flex-shrink-0"
          >
            + New
          </button>
        )}
      </div>

      {/* Instrument Table */}
      {activeWatchlist ? (
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden flex-1">
          {activeWatchlist.instruments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="text-4xl mb-4">📊</div>
              <p className="text-slate-400 text-lg mb-2">No instruments yet</p>
              <p className="text-slate-500 text-sm mb-6">Add instruments to start tracking their prices</p>
              <button
                onClick={() => { setShowAddModal(true); setTimeout(() => searchRef.current?.focus(), 100) }}
                className="px-6 py-3 bg-amber-500 text-slate-900 font-bold rounded-xl hover:bg-amber-400 transition-all"
              >
                + Add Instrument
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Instrument</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">LTP</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Change</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Change %</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">High</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Low</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeWatchlist.instruments.map(inst => {
                  const price = prices[inst.scripCode]
                  const change = price?.change || 0
                  const isUp = change >= 0
                  const flash = flashMap[inst.scripCode]

                  return (
                    <tr
                      key={inst.scripCode}
                      className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-all cursor-pointer group ${
                        flash === 'up' ? 'animate-[flash-positive_600ms_ease]' :
                        flash === 'down' ? 'animate-[flash-negative_600ms_ease]' : ''
                      }`}
                      onClick={() => navigate(`/stock/${inst.scripCode}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-slate-600 opacity-0 group-hover:opacity-100 cursor-grab transition-opacity">&#8801;</span>
                          <div>
                            <p className="text-white font-medium text-sm">{inst.symbol || inst.scripCode}</p>
                            <p className="text-xs text-slate-500">{inst.companyName || inst.exchange}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-white tabular-nums">
                        {price ? formatPrice(price.ltp) : '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {price ? formatChange(price.change) : '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {price ? formatChangePct(price.changePct) : '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-slate-300 tabular-nums">
                        {price ? formatPrice(price.high) : '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-slate-300 tabular-nums">
                        {price ? formatPrice(price.low) : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/stock/${inst.scripCode}`) }}
                            className="px-2.5 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-medium rounded hover:bg-emerald-500/30 transition-colors"
                          >
                            B
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/stock/${inst.scripCode}`) }}
                            className="px-2.5 py-1 bg-red-500/20 text-red-400 text-xs font-medium rounded hover:bg-red-500/30 transition-colors"
                          >
                            S
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveInstrument(inst.scripCode) }}
                            className="px-2.5 py-1 bg-slate-700 text-slate-400 text-xs rounded hover:bg-slate-600 hover:text-white transition-colors"
                          >
                            x
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-slate-800/30 rounded-xl">
          <div className="text-4xl mb-4">📋</div>
          <p className="text-slate-400 text-lg mb-2">No watchlists yet</p>
          <p className="text-slate-500 text-sm mb-6">Create your first watchlist to start monitoring instruments</p>
          <button
            onClick={() => setShowNewWatchlist(true)}
            className="px-6 py-3 bg-amber-500 text-slate-900 font-bold rounded-xl hover:bg-amber-400 transition-all"
          >
            + Create Watchlist
          </button>
        </div>
      )}

      {/* Add Instrument Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Add Instrument</h3>
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search by name or symbol..."
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <div className="max-h-80 overflow-y-auto">
              {searching && (
                <div className="px-6 py-4 text-center text-slate-400 text-sm">Searching...</div>
              )}
              {searchResults.map(r => (
                <button
                  key={r.scripCode}
                  onClick={() => handleAddInstrument(r)}
                  className="w-full px-6 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors text-left"
                >
                  <div>
                    <p className="text-white font-medium text-sm">{r.symbol}</p>
                    <p className="text-xs text-slate-400">{r.companyName} - {r.exchange}</p>
                  </div>
                  <span className="text-amber-400 text-sm font-medium">+ Add</span>
                </button>
              ))}
              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                <div className="px-6 py-8 text-center text-slate-500 text-sm">No instruments found</div>
              )}
            </div>
            <div className="p-4 border-t border-slate-700">
              <button onClick={() => setShowAddModal(false)} className="w-full py-2 text-center text-slate-400 hover:text-white text-sm transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
