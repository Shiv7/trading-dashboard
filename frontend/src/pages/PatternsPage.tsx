import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { patternsApi } from '../services/api'
import type { PatternSignal, PatternSummary, PatternStats } from '../types'

export default function PatternsPage() {
  const [patterns, setPatterns] = useState<PatternSignal[]>([])
  const [summary, setSummary] = useState<PatternSummary | null>(null)
  const [stats, setStats] = useState<Record<string, PatternStats> | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'active' | 'history' | 'stats'>('active')

  useEffect(() => {
    async function loadData() {
      try {
        const [activePatterns, summaryData, statsData] = await Promise.all([
          patternsApi.getActivePatterns(),
          patternsApi.getSummary(),
          patternsApi.getStats(),
        ])
        setPatterns(activePatterns)
        setSummary(summaryData)
        setStats(statsData)
      } catch (error) {
        console.error('Error loading patterns:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const history = await patternsApi.getHistory(100)
      setPatterns(history)
    } catch (error) {
      console.error('Error loading history:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadActive = async () => {
    setLoading(true)
    try {
      const active = await patternsApi.getActivePatterns()
      setPatterns(active)
    } catch (error) {
      console.error('Error loading active patterns:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewChange = (newView: typeof view) => {
    setView(newView)
    if (newView === 'history') {
      loadHistory()
    } else if (newView === 'active') {
      loadActive()
    }
  }

  const getPatternIcon = (type: string) => {
    const icons: Record<string, string> = {
      'BREAKOUT': '',
      'BREAKDOWN': '',
      'REVERSAL': '',
      'TREND_CONTINUATION': '',
      'MOMENTUM': '',
      'MEAN_REVERSION': '',
      'DOUBLE_BOTTOM': '',
      'DOUBLE_TOP': '',
      'HEAD_SHOULDERS': '',
    }
    return icons[type] || ''
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50'
      case 'COMPLETED_WIN':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
      case 'COMPLETED_LOSS':
        return 'bg-red-500/20 text-red-400 border-red-500/50'
      case 'EXPIRED':
        return 'bg-slate-500/20 text-slate-400 border-slate-500/50'
      case 'INVALIDATED':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/50'
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/50'
    }
  }

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-white">Pattern Signals</h1>
        <div className="flex gap-2">
          {(['active', 'history', 'stats'] as const).map(v => (
            <button
              key={v}
              onClick={() => handleViewChange(v)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === v
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="card text-center">
            <div className="text-2xl font-bold text-blue-400">{summary.totalActive}</div>
            <div className="text-sm text-slate-400">Active</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-slate-400">{summary.totalCompleted}</div>
            <div className="text-sm text-slate-400">Completed</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-emerald-400">{summary.wins}</div>
            <div className="text-sm text-slate-400">Wins</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-red-400">{summary.losses}</div>
            <div className="text-sm text-slate-400">Losses</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${summary.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
              {(summary.winRate * 100).toFixed(0)}%
            </div>
            <div className="text-sm text-slate-400">Win Rate</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ₹{(summary.totalPnl / 1000).toFixed(1)}K
            </div>
            <div className="text-sm text-slate-400">Total P&L</div>
          </div>
        </div>
      )}

      {/* Active Patterns by Type */}
      {view === 'active' && summary?.activeByType && Object.keys(summary.activeByType).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.activeByType).map(([type, count]) => (
            <span key={type} className="px-3 py-1 bg-slate-700/50 rounded-full text-sm text-slate-300">
              {getPatternIcon(type)} {type}: {count}
            </span>
          ))}
        </div>
      )}

      {/* Stats View */}
      {view === 'stats' && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(stats).map(([type, stat]) => (
            <div key={type} className="card">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">{getPatternIcon(type)}</span>
                <h3 className="font-semibold text-white">{type}</h3>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-400">Total:</span>
                  <span className="ml-2 text-white">{stat.totalOccurrences}</span>
                </div>
                <div>
                  <span className="text-slate-400">Win Rate:</span>
                  <span className={`ml-2 ${stat.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(stat.winRate * 100).toFixed(0)}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Wins:</span>
                  <span className="ml-2 text-emerald-400">{stat.wins}</span>
                </div>
                <div>
                  <span className="text-slate-400">Losses:</span>
                  <span className="ml-2 text-red-400">{stat.losses}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400">Total P&L:</span>
                  <span className={`ml-2 font-bold ${stat.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stat.totalPnl >= 0 ? '+' : ''}₹{stat.totalPnl.toFixed(0)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pattern Cards */}
      {view !== 'stats' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {patterns.length > 0 ? (
            patterns.map(pattern => (
              <Link
                key={pattern.patternId}
                to={`/stock/${pattern.scripCode}`}
                className="card hover:border-slate-600 transition-all hover:-translate-y-0.5"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{getPatternIcon(pattern.patternType)}</span>
                      <span className="font-semibold text-white">{pattern.companyName || pattern.scripCode}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {pattern.patternType} | {pattern.timeframe || 'N/A'}
                    </div>
                  </div>
                  <span className={`badge border ${getStatusColor(pattern.status)}`}>
                    {pattern.status}
                  </span>
                </div>

                {/* Direction & Confidence */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    pattern.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
                    pattern.direction === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
                    'bg-slate-500/20 text-slate-400'
                  }`}>
                    {pattern.direction}
                  </span>
                  <span className="text-xs text-slate-400">
                    Conf: <span className="text-white">{(pattern.confidence * 100).toFixed(0)}%</span>
                  </span>
                  {pattern.qualityScore > 0 && (
                    <span className="text-xs text-slate-400">
                      Q: <span className="text-white">{pattern.qualityScore}</span>
                    </span>
                  )}
                </div>

                {/* Levels */}
                <div className="grid grid-cols-4 gap-2 text-xs mb-3">
                  <div className="bg-slate-700/30 rounded p-2">
                    <div className="text-slate-400">Entry</div>
                    <div className="text-white font-medium">₹{pattern.entryPrice.toFixed(2)}</div>
                  </div>
                  <div className="bg-red-500/10 rounded p-2">
                    <div className="text-red-400">SL</div>
                    <div className="text-white font-medium">₹{pattern.stopLoss.toFixed(2)}</div>
                  </div>
                  <div className="bg-emerald-500/10 rounded p-2">
                    <div className="text-emerald-400">T1</div>
                    <div className="text-white font-medium">₹{pattern.target1.toFixed(2)}</div>
                  </div>
                  <div className="bg-blue-500/10 rounded p-2">
                    <div className="text-blue-400">R:R</div>
                    <div className="text-white font-medium">{pattern.riskRewardRatio.toFixed(2)}</div>
                  </div>
                </div>

                {/* Description */}
                {pattern.patternDescription && (
                  <p className="text-xs text-slate-400 mb-2 line-clamp-2">
                    {pattern.patternDescription}
                  </p>
                )}

                {/* Outcome (for completed) */}
                {pattern.status.includes('COMPLETED') && pattern.actualPnl !== undefined && (
                  <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between text-sm">
                    <span className={pattern.actualPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {pattern.actualPnl >= 0 ? '+' : ''}₹{pattern.actualPnl.toFixed(0)}
                    </span>
                    {pattern.rMultiple !== undefined && (
                      <span className={pattern.rMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {pattern.rMultiple >= 0 ? '+' : ''}{pattern.rMultiple.toFixed(2)}R
                      </span>
                    )}
                  </div>
                )}

                {/* Timestamps */}
                <div className="text-xs text-slate-500 mt-2">
                  Triggered: {new Date(pattern.triggeredAt).toLocaleString()}
                  {pattern.expiresAt && (
                    <span className="ml-2">| Expires: {new Date(pattern.expiresAt).toLocaleString()}</span>
                  )}
                </div>
              </Link>
            ))
          ) : (
            <div className="col-span-full text-center text-slate-500 py-12">
              <p>No patterns found</p>
              <p className="text-xs mt-1 text-slate-600">
                {view === 'active' ? 'Waiting for new pattern signals...' : 'No historical patterns available'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
