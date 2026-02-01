import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { patternsApi } from '../services/api'
import type { PatternSignal, PatternSummary, PatternStats } from '../types'
import { useDashboardStore } from '../store/dashboardStore'
import { useWebSocket } from '../hooks/useWebSocket'

// All candlestick and structural pattern types with icons and descriptions
const PATTERN_TYPES = {
  // Candlestick Patterns - Bullish
  HAMMER: { icon: '🔨', color: 'emerald', desc: 'Bullish reversal, long lower shadow' },
  INVERTED_HAMMER: { icon: '🔧', color: 'emerald', desc: 'Bullish reversal after downtrend' },
  BULLISH_ENGULFING: { icon: '🟢', color: 'emerald', desc: 'Bullish reversal, engulfs prior candle' },
  BULLISH_HARAMI: { icon: '🤰', color: 'emerald', desc: 'Bullish reversal, inside bar' },
  PIERCING_LINE: { icon: '⬆️', color: 'emerald', desc: 'Bullish reversal, pierces midpoint' },
  MORNING_STAR: { icon: '🌅', color: 'emerald', desc: 'Strong bullish reversal, 3 candles' },
  THREE_WHITE_SOLDIERS: { icon: '🎖️', color: 'emerald', desc: 'Strong bullish continuation' },
  TWEEZER_BOTTOM: { icon: '🔻', color: 'emerald', desc: 'Double bottom reversal' },

  // Candlestick Patterns - Bearish
  SHOOTING_STAR: { icon: '💫', color: 'red', desc: 'Bearish reversal, long upper shadow' },
  HANGING_MAN: { icon: '🎭', color: 'red', desc: 'Bearish reversal after uptrend' },
  BEARISH_ENGULFING: { icon: '🔴', color: 'red', desc: 'Bearish reversal, engulfs prior candle' },
  BEARISH_HARAMI: { icon: '🎎', color: 'red', desc: 'Bearish reversal, inside bar' },
  DARK_CLOUD_COVER: { icon: '☁️', color: 'red', desc: 'Bearish reversal, covers prior gain' },
  EVENING_STAR: { icon: '🌆', color: 'red', desc: 'Strong bearish reversal, 3 candles' },
  THREE_BLACK_CROWS: { icon: '🐦‍⬛', color: 'red', desc: 'Strong bearish continuation' },
  TWEEZER_TOP: { icon: '🔺', color: 'red', desc: 'Double top reversal' },

  // Neutral / Indecision
  DOJI: { icon: '➕', color: 'amber', desc: 'Indecision, small body' },
  SPINNING_TOP: { icon: '🎡', color: 'amber', desc: 'Indecision, small body with shadows' },
  MARUBOZU: { icon: '📊', color: 'blue', desc: 'Strong momentum, no shadows' },

  // Structural Patterns
  BREAKOUT: { icon: '🚀', color: 'emerald', desc: 'Price breaking resistance' },
  BREAKDOWN: { icon: '📉', color: 'red', desc: 'Price breaking support' },
  REVERSAL: { icon: '🔄', color: 'purple', desc: 'Trend direction change' },
  TREND_CONTINUATION: { icon: '➡️', color: 'blue', desc: 'Trend continuing' },
  MOMENTUM: { icon: '⚡', color: 'cyan', desc: 'Strong directional move' },
  MEAN_REVERSION: { icon: '🎯', color: 'orange', desc: 'Returning to average' },
  DOUBLE_BOTTOM: { icon: '〰️', color: 'emerald', desc: 'W pattern reversal' },
  DOUBLE_TOP: { icon: '🏔️', color: 'red', desc: 'M pattern reversal' },
  HEAD_SHOULDERS: { icon: '👤', color: 'purple', desc: 'H&S pattern' },

  // Default fallback
  UNKNOWN: { icon: '❓', color: 'slate', desc: 'Unknown pattern type' },
} as const

type PatternType = keyof typeof PATTERN_TYPES

// Timeframes
const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D'] as const

export default function PatternsPage() {
  const [apiPatterns, setApiPatterns] = useState<PatternSignal[]>([])
  const [summary, setSummary] = useState<PatternSummary | null>(null)
  const [stats, setStats] = useState<Record<string, PatternStats> | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'active' | 'history' | 'stats'>('active')

  // Filters
  const [patternTypeFilter, setPatternTypeFilter] = useState<string>('ALL')
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH' | 'NEUTRAL'>('ALL')
  const [timeframeFilter, setTimeframeFilter] = useState<string>('ALL')
  const [confidenceFilter, setConfidenceFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPattern, setSelectedPattern] = useState<PatternSignal | null>(null)

  // WebSocket for real-time updates
  const { connected } = useWebSocket()
  const { patternSignals: wsPatterns, bulkUpdatePatternSignals } = useDashboardStore()

  // Merge API patterns with real-time WebSocket updates
  const patterns = useMemo(() => {
    const patternMap = new Map<string, PatternSignal>()
    // First add all API patterns
    apiPatterns.forEach(p => {
      if (p && p.patternId) patternMap.set(p.patternId, p)
    })
    // Then override with any real-time WebSocket updates
    wsPatterns.forEach(p => {
      if (p && p.patternId) patternMap.set(p.patternId, p)
    })
    return Array.from(patternMap.values())
  }, [apiPatterns, wsPatterns])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000) // Fallback polling
    return () => clearInterval(interval)
  }, [])

  const loadData = async () => {
    try {
      const [activePatterns, summaryData, statsData] = await Promise.all([
        view === 'history' ? patternsApi.getHistory(100) : patternsApi.getActivePatterns(),
        patternsApi.getSummary(),
        patternsApi.getStats(),
      ])
      setApiPatterns(activePatterns)
      setSummary(summaryData)
      setStats(statsData)
      // Also populate the store
      bulkUpdatePatternSignals(activePatterns)
    } catch (error) {
      console.error('Error loading patterns:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewChange = async (newView: typeof view) => {
    setView(newView)
    setLoading(true)
    try {
      if (newView === 'history') {
        const history = await patternsApi.getHistory(100)
        setApiPatterns(history)
      } else if (newView === 'active') {
        const active = await patternsApi.getActivePatterns()
        setApiPatterns(active)
      }
    } catch (error) {
      console.error('Error loading patterns:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    setLoading(true)
    loadData()
  }

  // Get pattern info with fallback
  const getPatternInfo = (type: string) => {
    const normalized = type?.toUpperCase().replace(/[- ]/g, '_') || 'UNKNOWN'
    return PATTERN_TYPES[normalized as PatternType] || PATTERN_TYPES.UNKNOWN
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-blue-500/20 text-blue-400 border-blue-500/50'
      case 'COMPLETED_WIN': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
      case 'COMPLETED_LOSS': return 'bg-red-500/20 text-red-400 border-red-500/50'
      case 'EXPIRED': return 'bg-slate-500/20 text-slate-400 border-slate-500/50'
      case 'INVALIDATED': return 'bg-amber-500/20 text-amber-400 border-amber-500/50'
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/50'
    }
  }

  // Safe number formatting
  const fmt = (n: number | undefined | null, decimals = 2): string => {
    if (n === undefined || n === null || isNaN(n)) return '-'
    return n.toFixed(decimals)
  }

  // Filter and sort patterns
  const filteredPatterns = useMemo(() => {
    let result = patterns

    // Pattern type filter
    if (patternTypeFilter !== 'ALL') {
      result = result.filter(p => p.patternType?.toUpperCase() === patternTypeFilter)
    }

    // Direction filter
    if (directionFilter !== 'ALL') {
      result = result.filter(p => p.direction === directionFilter)
    }

    // Timeframe filter
    if (timeframeFilter !== 'ALL') {
      result = result.filter(p => p.timeframe === timeframeFilter)
    }

    // Confidence filter
    if (confidenceFilter !== 'ALL') {
      result = result.filter(p => {
        const conf = p.confidence || 0
        if (confidenceFilter === 'HIGH') return conf >= 0.7
        if (confidenceFilter === 'MEDIUM') return conf >= 0.4 && conf < 0.7
        if (confidenceFilter === 'LOW') return conf < 0.4
        return true
      })
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(p =>
        p.scripCode?.toLowerCase().includes(query) ||
        p.companyName?.toLowerCase().includes(query) ||
        p.patternType?.toLowerCase().includes(query)
      )
    }

    // Sort by triggered time (most recent first)
    result = [...result].sort((a, b) => {
      const timeA = new Date(a.triggeredAt).getTime() || 0
      const timeB = new Date(b.triggeredAt).getTime() || 0
      return timeB - timeA
    })

    return result
  }, [patterns, patternTypeFilter, directionFilter, timeframeFilter, confidenceFilter, searchQuery])

  // Get unique pattern types from current patterns for filter dropdown
  const availablePatternTypes = useMemo(() => {
    const types = new Set(patterns.map(p => p.patternType?.toUpperCase()).filter(Boolean))
    return Array.from(types).sort()
  }, [patterns])

  // Get unique timeframes from current patterns
  const availableTimeframes = useMemo(() => {
    const tfs = new Set(patterns.map(p => p.timeframe).filter(Boolean))
    return Array.from(tfs).sort()
  }, [patterns])

  if (loading && patterns.length === 0) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-16 bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">Pattern Signals</h1>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${
            connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {connected ? 'Live' : 'Offline'}
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="flex gap-2">
          {(['active', 'history', 'stats'] as const).map(v => (
            <button
              key={v}
              onClick={() => handleViewChange(v)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="card text-center py-3">
            <div className="text-2xl font-bold text-blue-400">{summary.totalActive}</div>
            <div className="text-xs text-slate-400">Active</div>
          </div>
          <div className="card text-center py-3">
            <div className="text-2xl font-bold text-slate-400">{summary.totalCompleted}</div>
            <div className="text-xs text-slate-400">Completed</div>
          </div>
          <div className="card text-center py-3">
            <div className="text-2xl font-bold text-emerald-400">{summary.wins}</div>
            <div className="text-xs text-slate-400">Wins</div>
          </div>
          <div className="card text-center py-3">
            <div className="text-2xl font-bold text-red-400">{summary.losses}</div>
            <div className="text-xs text-slate-400">Losses</div>
          </div>
          <div className="card text-center py-3">
            <div className={`text-2xl font-bold ${(summary.winRate || 0) >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
              {((summary.winRate || 0) * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-400">Win Rate</div>
          </div>
          <div className="card text-center py-3">
            <div className={`text-2xl font-bold ${(summary.totalPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {(summary.totalPnl || 0) >= 0 ? '+' : ''}{((summary.totalPnl || 0) / 1000).toFixed(1)}K
            </div>
            <div className="text-xs text-slate-400">Total P&L</div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      {view !== 'stats' && (
        <div className="flex flex-wrap items-center gap-2 bg-slate-800/30 rounded-lg p-2">
          {/* Search */}
          <input
            type="text"
            placeholder="Search stock..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-40"
          />

          <div className="w-px h-6 bg-slate-600" />

          {/* Pattern Type Filter */}
          <select
            value={patternTypeFilter}
            onChange={(e) => setPatternTypeFilter(e.target.value)}
            className="px-2 py-1.5 bg-slate-700/50 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Patterns</option>
            {availablePatternTypes.map(type => (
              <option key={type} value={type}>
                {getPatternInfo(type).icon} {type.replace(/_/g, ' ')}
              </option>
            ))}
          </select>

          {/* Timeframe Filter */}
          <select
            value={timeframeFilter}
            onChange={(e) => setTimeframeFilter(e.target.value)}
            className="px-2 py-1.5 bg-slate-700/50 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All TFs</option>
            {availableTimeframes.length > 0 ? (
              availableTimeframes.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))
            ) : (
              TIMEFRAMES.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))
            )}
          </select>

          {/* Direction Filter */}
          <div className="flex items-center gap-0.5">
            {[
              { key: 'ALL', label: 'All', icon: '○' },
              { key: 'BULLISH', label: 'Bull', icon: '↑', color: 'emerald' },
              { key: 'BEARISH', label: 'Bear', icon: '↓', color: 'red' },
              { key: 'NEUTRAL', label: 'Ntrl', icon: '−', color: 'slate' }
            ].map((d) => (
              <button
                key={d.key}
                onClick={() => setDirectionFilter(d.key as typeof directionFilter)}
                className={`px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                  directionFilter === d.key
                    ? d.color ? `bg-${d.color}-500/20 text-${d.color}-400` : 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:text-white'
                }`}
              >
                {d.icon}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-600" />

          {/* Confidence Filter */}
          <div className="flex items-center gap-0.5">
            {[
              { key: 'ALL', label: 'All Conf' },
              { key: 'HIGH', label: 'High', color: 'emerald' },
              { key: 'MEDIUM', label: 'Med', color: 'amber' },
              { key: 'LOW', label: 'Low', color: 'red' }
            ].map((c) => (
              <button
                key={c.key}
                onClick={() => setConfidenceFilter(c.key as typeof confidenceFilter)}
                className={`px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                  confidenceFilter === c.key
                    ? c.color ? `bg-${c.color}-500/20 text-${c.color}-400` : 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:text-white'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Result count */}
          <div className="ml-auto text-xs text-slate-400">
            {filteredPatterns.length} patterns
          </div>
        </div>
      )}

      {/* Active Patterns by Type (Quick Stats) */}
      {view === 'active' && summary?.activeByType && Object.keys(summary.activeByType).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.activeByType).map(([type, count]) => {
            const info = getPatternInfo(type)
            return (
              <button
                key={type}
                onClick={() => setPatternTypeFilter(patternTypeFilter === type.toUpperCase() ? 'ALL' : type.toUpperCase())}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  patternTypeFilter === type.toUpperCase()
                    ? 'bg-blue-500/30 text-blue-400 border border-blue-500/50'
                    : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
                }`}
              >
                {info.icon} {type.replace(/_/g, ' ')}: {count}
              </button>
            )
          })}
        </div>
      )}

      {/* Stats View */}
      {view === 'stats' && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(stats).map(([type, stat]) => {
            const info = getPatternInfo(type)
            return (
              <div key={type} className="card">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{info.icon}</span>
                  <div>
                    <h3 className="font-semibold text-white">{type.replace(/_/g, ' ')}</h3>
                    <p className="text-xs text-slate-500">{info.desc}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-slate-400">Total:</span>
                    <span className="ml-2 text-white font-medium">{stat.totalOccurrences}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Win Rate:</span>
                    <span className={`ml-2 font-medium ${(stat.winRate || 0) >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {((stat.winRate || 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Wins:</span>
                    <span className="ml-2 text-emerald-400 font-medium">{stat.wins}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Losses:</span>
                    <span className="ml-2 text-red-400 font-medium">{stat.losses}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400">Total P&L:</span>
                    <span className={`ml-2 font-bold ${(stat.totalPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(stat.totalPnl || 0) >= 0 ? '+' : ''}{fmt(stat.totalPnl, 0)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Main Content: Pattern List + Detail Panel */}
      {view !== 'stats' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Pattern Cards */}
          <div className="xl:col-span-2 space-y-2 max-h-[calc(100vh-380px)] overflow-y-auto pr-2">
            {filteredPatterns.length > 0 ? (
              filteredPatterns.map(pattern => {
                const info = getPatternInfo(pattern.patternType)
                return (
                  <div
                    key={pattern.patternId}
                    onClick={() => setSelectedPattern(pattern)}
                    className={`bg-slate-800/30 border rounded-lg px-3 py-2.5 cursor-pointer transition-all hover:bg-slate-800/60 ${
                      selectedPattern?.patternId === pattern.patternId
                        ? 'border-amber-500/50 bg-slate-800/60'
                        : 'border-slate-700/30'
                    }`}
                  >
                    {/* Header Row */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{info.icon}</span>
                        <div>
                          <Link
                            to={`/stock/${pattern.scripCode}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-white hover:text-amber-400 transition-colors"
                          >
                            {pattern.companyName || pattern.scripCode}
                          </Link>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="font-mono">{pattern.scripCode}</span>
                            <span>|</span>
                            <span className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">
                              {pattern.timeframe || 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className={`badge border text-xs ${getStatusColor(pattern.status)}`}>
                        {pattern.status?.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {/* Pattern Type & Direction */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium bg-${info.color}-500/20 text-${info.color}-400`}>
                        {pattern.patternType?.replace(/_/g, ' ')}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        pattern.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
                        pattern.direction === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
                        'bg-slate-500/20 text-slate-400'
                      }`}>
                        {pattern.direction === 'BULLISH' ? '↑' : pattern.direction === 'BEARISH' ? '↓' : '−'} {pattern.direction}
                      </span>
                      <span className="text-xs text-slate-400">
                        Conf: <span className={`font-medium ${
                          (pattern.confidence || 0) >= 0.7 ? 'text-emerald-400' :
                          (pattern.confidence || 0) >= 0.4 ? 'text-amber-400' : 'text-red-400'
                        }`}>{((pattern.confidence || 0) * 100).toFixed(0)}%</span>
                      </span>
                    </div>

                    {/* Price Levels */}
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="bg-slate-700/30 rounded p-1.5 text-center">
                        <div className="text-slate-400">Entry</div>
                        <div className="text-white font-medium">{fmt(pattern.entryPrice)}</div>
                      </div>
                      <div className="bg-red-500/10 rounded p-1.5 text-center">
                        <div className="text-red-400">SL</div>
                        <div className="text-white font-medium">{fmt(pattern.stopLoss)}</div>
                      </div>
                      <div className="bg-emerald-500/10 rounded p-1.5 text-center">
                        <div className="text-emerald-400">T1</div>
                        <div className="text-white font-medium">{fmt(pattern.target1)}</div>
                      </div>
                      <div className="bg-blue-500/10 rounded p-1.5 text-center">
                        <div className="text-blue-400">R:R</div>
                        <div className="text-white font-medium">{fmt(pattern.riskRewardRatio)}</div>
                      </div>
                    </div>

                    {/* Outcome for completed */}
                    {pattern.status?.includes('COMPLETED') && pattern.actualPnl !== undefined && (
                      <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between text-sm">
                        <span className={`font-medium ${(pattern.actualPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(pattern.actualPnl || 0) >= 0 ? '+' : ''}{fmt(pattern.actualPnl, 0)}
                        </span>
                        {pattern.rMultiple !== undefined && (
                          <span className={`font-medium ${(pattern.rMultiple || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(pattern.rMultiple || 0) >= 0 ? '+' : ''}{fmt(pattern.rMultiple)}R
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            ) : (
              <div className="text-center py-12 text-slate-500">
                <p>No patterns match filters</p>
                <p className="text-xs mt-1 text-slate-600">
                  {view === 'active' ? 'Waiting for new pattern signals...' : 'No historical patterns available'}
                </p>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="xl:sticky xl:top-4 xl:h-fit">
            {selectedPattern ? (
              <PatternDetailPanel pattern={selectedPattern} />
            ) : (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center">
                <div className="text-5xl mb-4">📊</div>
                <div className="text-slate-400 mb-2">Select a pattern</div>
                <div className="text-xs text-slate-500">Click any row to view details</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Detail Panel Component
function PatternDetailPanel({ pattern }: { pattern: PatternSignal }) {
  const info = PATTERN_TYPES[pattern.patternType?.toUpperCase().replace(/[- ]/g, '_') as keyof typeof PATTERN_TYPES] || PATTERN_TYPES.UNKNOWN

  const fmt = (n: number | undefined | null, d = 2) => {
    if (n === undefined || n === null || isNaN(n)) return '-'
    return n.toFixed(d)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-blue-500/20 text-blue-400'
      case 'COMPLETED_WIN': return 'bg-emerald-500/20 text-emerald-400'
      case 'COMPLETED_LOSS': return 'bg-red-500/20 text-red-400'
      case 'EXPIRED': return 'bg-slate-500/20 text-slate-400'
      case 'INVALIDATED': return 'bg-amber-500/20 text-amber-400'
      default: return 'bg-slate-500/20 text-slate-400'
    }
  }

  return (
    <div className="space-y-3 max-h-[calc(100vh-380px)] overflow-y-auto pr-1">
      {/* Header */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{info.icon}</span>
            <div>
              <Link to={`/stock/${pattern.scripCode}`} className="text-lg font-bold text-white hover:text-amber-400">
                {pattern.companyName || pattern.scripCode}
              </Link>
              <div className="text-xs text-slate-400">{pattern.scripCode}</div>
            </div>
          </div>
          <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(pattern.status)}`}>
            {pattern.status?.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
          <span className={`px-2 py-1 rounded bg-${info.color}-500/20 text-${info.color}-400`}>
            {pattern.patternType?.replace(/_/g, ' ')}
          </span>
          <span className={`px-2 py-1 rounded ${
            pattern.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
            pattern.direction === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
            'bg-slate-500/20 text-slate-400'
          }`}>
            {pattern.direction}
          </span>
          {pattern.timeframe && (
            <span className="px-2 py-1 rounded bg-slate-700 text-slate-300">
              TF: {pattern.timeframe}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-400 mb-3">{info.desc}</p>

        <Link
          to={`/stock/${pattern.scripCode}`}
          className="block w-full py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-center rounded-lg font-medium hover:from-blue-600 hover:to-indigo-700 transition-all"
        >
          View Stock Analysis
        </Link>
      </div>

      {/* Confidence & Quality */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white mb-3">Confidence & Quality</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-700/30 rounded-lg p-3 text-center">
            <div className="text-slate-400 text-xs mb-1">Confidence</div>
            <div className={`text-2xl font-bold ${
              (pattern.confidence || 0) >= 0.7 ? 'text-emerald-400' :
              (pattern.confidence || 0) >= 0.4 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {((pattern.confidence || 0) * 100).toFixed(0)}%
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  (pattern.confidence || 0) >= 0.7 ? 'bg-emerald-500' :
                  (pattern.confidence || 0) >= 0.4 ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${(pattern.confidence || 0) * 100}%` }}
              />
            </div>
          </div>
          <div className="bg-slate-700/30 rounded-lg p-3 text-center">
            <div className="text-slate-400 text-xs mb-1">Quality Score</div>
            <div className="text-2xl font-bold text-white">{pattern.qualityScore || 0}</div>
          </div>
        </div>
      </div>

      {/* Price Levels */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white mb-3">Price Levels</h3>
        <div className="space-y-2">
          <div className="flex justify-between items-center p-2 bg-slate-700/30 rounded">
            <span className="text-slate-400 text-sm">Entry Price</span>
            <span className="text-white font-bold">{fmt(pattern.entryPrice)}</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-red-500/10 rounded">
            <span className="text-red-400 text-sm">Stop Loss</span>
            <span className="text-white font-bold">{fmt(pattern.stopLoss)}</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-emerald-500/10 rounded">
            <span className="text-emerald-400 text-sm">Target 1</span>
            <span className="text-white font-bold">{fmt(pattern.target1)}</span>
          </div>
          {pattern.target2 && pattern.target2 > 0 && (
            <div className="flex justify-between items-center p-2 bg-emerald-500/5 rounded">
              <span className="text-emerald-400/70 text-sm">Target 2</span>
              <span className="text-white font-bold">{fmt(pattern.target2)}</span>
            </div>
          )}
          <div className="flex justify-between items-center p-2 bg-blue-500/10 rounded">
            <span className="text-blue-400 text-sm">Risk:Reward</span>
            <span className="text-white font-bold">1:{fmt(pattern.riskRewardRatio)}</span>
          </div>
          {pattern.invalidationPrice && pattern.invalidationPrice > 0 && (
            <div className="flex justify-between items-center p-2 bg-amber-500/10 rounded">
              <span className="text-amber-400 text-sm">Invalidation</span>
              <span className="text-white font-bold">{fmt(pattern.invalidationPrice)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Pattern Description */}
      {pattern.patternDescription && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2">Description</h3>
          <p className="text-sm text-slate-300">{pattern.patternDescription}</p>
        </div>
      )}

      {/* Trigger Condition */}
      {pattern.triggerCondition && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2">Trigger Condition</h3>
          <p className="text-sm text-slate-300">{pattern.triggerCondition}</p>
        </div>
      )}

      {/* Context Info */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white mb-3">Context</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {pattern.gexRegime && (
            <div className="bg-slate-700/30 rounded p-2">
              <div className="text-slate-400">GEX Regime</div>
              <div className="text-white font-medium">{pattern.gexRegime}</div>
            </div>
          )}
          {pattern.session && (
            <div className="bg-slate-700/30 rounded p-2">
              <div className="text-slate-400">Session</div>
              <div className="text-white font-medium">{pattern.session}</div>
            </div>
          )}
          {pattern.daysToExpiry !== undefined && pattern.daysToExpiry !== null && (
            <div className="bg-slate-700/30 rounded p-2">
              <div className="text-slate-400">Days to Expiry</div>
              <div className="text-white font-medium">{pattern.daysToExpiry}</div>
            </div>
          )}
          {pattern.timeframe && (
            <div className="bg-slate-700/30 rounded p-2">
              <div className="text-slate-400">Timeframe</div>
              <div className="text-white font-medium">{pattern.timeframe}</div>
            </div>
          )}
        </div>
      </div>

      {/* Timestamps */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white mb-3">Timeline</h3>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-400">Triggered</span>
            <span className="text-white">{pattern.triggeredAt ? new Date(pattern.triggeredAt).toLocaleString() : '-'}</span>
          </div>
          {pattern.expiresAt && (
            <div className="flex justify-between">
              <span className="text-slate-400">Expires</span>
              <span className="text-white">{new Date(pattern.expiresAt).toLocaleString()}</span>
            </div>
          )}
          {pattern.completedAt && (
            <div className="flex justify-between">
              <span className="text-slate-400">Completed</span>
              <span className="text-white">{new Date(pattern.completedAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Outcome (for completed patterns) */}
      {pattern.status?.includes('COMPLETED') && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-3">Outcome</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-lg p-3 text-center ${(pattern.actualPnl || 0) >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
              <div className="text-slate-400 text-xs mb-1">P&L</div>
              <div className={`text-xl font-bold ${(pattern.actualPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(pattern.actualPnl || 0) >= 0 ? '+' : ''}{fmt(pattern.actualPnl, 0)}
              </div>
            </div>
            {pattern.rMultiple !== undefined && (
              <div className={`rounded-lg p-3 text-center ${(pattern.rMultiple || 0) >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <div className="text-slate-400 text-xs mb-1">R-Multiple</div>
                <div className={`text-xl font-bold ${(pattern.rMultiple || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(pattern.rMultiple || 0) >= 0 ? '+' : ''}{fmt(pattern.rMultiple)}R
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
