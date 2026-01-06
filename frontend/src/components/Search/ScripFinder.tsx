import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { scoresApi } from '../../services/api'
import type { FamilyScore } from '../../types'
import TradeModal from '../Trading/TradeModal'

interface ScripFinderProps {
  onSelect?: (score: FamilyScore) => void
  placeholder?: string
  showTradeButton?: boolean
}

export default function ScripFinder({
  onSelect,
  placeholder = "Search stocks...",
  showTradeButton = true,
}: ScripFinderProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FamilyScore[]>([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [tradeModalOpen, setTradeModalOpen] = useState(false)
  const [selectedStock, setSelectedStock] = useState<FamilyScore | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await scoresApi.searchStocks(query, 8)
        setResults(data)
        setIsOpen(true)
        setSelectedIndex(-1)
      } catch (err) {
        console.error('Search error:', err)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = useCallback((score: FamilyScore) => {
    setQuery('')
    setIsOpen(false)
    setSelectedIndex(-1)
    if (onSelect) {
      onSelect(score)
    } else {
      navigate(`/stock/${score.scripCode}`)
    }
  }, [onSelect, navigate])

  const handleTrade = useCallback((score: FamilyScore, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedStock(score)
    setTradeModalOpen(true)
    setIsOpen(false)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        if (selectedIndex >= 0) {
          handleSelect(results[selectedIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        setSelectedIndex(-1)
        break
    }
  }, [isOpen, results, selectedIndex, handleSelect])

  const getDirectionColor = (direction: string) => {
    switch (direction) {
      case 'BULLISH': return 'text-emerald-400'
      case 'BEARISH': return 'text-red-400'
      default: return 'text-slate-400'
    }
  }

  return (
    <>
      <div ref={containerRef} className="relative w-full max-w-md">
        {/* Search Input */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => query.length >= 2 && setIsOpen(true)}
            placeholder={placeholder}
            className="w-full bg-slate-700/50 border border-slate-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-all"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            {loading ? (
              <svg className="w-5 h-5 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
          {query && (
            <button
              onClick={() => { setQuery(''); setIsOpen(false) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Results Dropdown */}
        {isOpen && results.length > 0 && (
          <div className="absolute z-50 w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
            {results.map((score, index) => (
              <div
                key={score.scripCode}
                onClick={() => handleSelect(score)}
                className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                  index === selectedIndex
                    ? 'bg-blue-500/20 border-l-2 border-l-blue-500'
                    : 'hover:bg-slate-700/50 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white truncate">
                      {score.companyName || score.scripCode}
                    </span>
                    <span className={`text-xs font-medium ${getDirectionColor(score.direction)}`}>
                      {score.direction === 'BULLISH' ? '↑' : score.direction === 'BEARISH' ? '↓' : '−'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                    <span>Score: <span className="text-white">{score.overallScore.toFixed(1)}</span></span>
                    <span>VCP: <span className="text-white">{(score.vcpCombinedScore * 100).toFixed(0)}%</span></span>
                    <span>IPU: <span className="text-white">{(score.ipuFinalScore * 100).toFixed(0)}%</span></span>
                  </div>
                </div>

                {/* Quick Trade Button */}
                {showTradeButton && (
                  <button
                    onClick={(e) => handleTrade(score, e)}
                    className={`ml-3 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      score.direction === 'BULLISH'
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : score.direction === 'BEARISH'
                          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                          : 'bg-slate-600 text-slate-400 hover:bg-slate-500'
                    }`}
                  >
                    Trade
                  </button>
                )}
              </div>
            ))}

            {/* View All Link */}
            <div
              onClick={() => { navigate('/scores'); setIsOpen(false) }}
              className="px-4 py-2 bg-slate-700/30 text-center text-sm text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              View all scores →
            </div>
          </div>
        )}

        {/* No Results */}
        {isOpen && query.length >= 2 && results.length === 0 && !loading && (
          <div className="absolute z-50 w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-4 text-center text-slate-400 text-sm">
            No stocks found for "{query}"
          </div>
        )}
      </div>

      {/* Trade Modal */}
      {selectedStock && (
        <TradeModal
          isOpen={tradeModalOpen}
          onClose={() => setTradeModalOpen(false)}
          scripCode={selectedStock.scripCode}
          companyName={selectedStock.companyName}
          currentPrice={selectedStock.close}
          direction={selectedStock.direction as 'BULLISH' | 'BEARISH' | 'NEUTRAL'}
          quantScore={selectedStock.overallScore * 10}
        />
      )}
    </>
  )
}
