import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { riskApi } from '../services/api'
import { isAnyMarketOpen } from '../utils/tradingUtils'
import type { PortfolioRiskSummary } from '../types'
import LiveMonitorTab from '../components/Risk/LiveMonitorTab'
import TradeIntelligenceTab from '../components/Risk/TradeIntelligenceTab'
import StrategyTuningTab from '../components/Risk/StrategyTuningTab'

type TabId = 'monitor' | 'intelligence' | 'tuning'
type DatePreset = 'TODAY' | '1W' | '1M' | '3M' | 'YTD' | 'ALL' | 'CUSTOM'

const tabs: { id: TabId; label: string }[] = [
  { id: 'monitor', label: 'Live Monitor' },
  { id: 'intelligence', label: 'Trade Intelligence' },
  { id: 'tuning', label: 'Strategy Tuning' },
]

const presets: { id: DatePreset; label: string }[] = [
  { id: 'TODAY', label: 'Today' },
  { id: '1W', label: '1W' },
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: 'YTD', label: 'YTD' },
  { id: 'ALL', label: 'All' },
]

// ─── Main Component ────────────────────────────────────────
export default function RiskPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Tab state — read from URL, default to 'monitor'
  const tabParam = searchParams.get('tab') as TabId | null
  const [activeTab, setActiveTab] = useState<TabId>(
    tabParam && ['monitor', 'intelligence', 'tuning'].includes(tabParam) ? tabParam : 'monitor'
  )

  // Date range state
  const [datePreset, setDatePreset] = useState<DatePreset>('1W')
  const [dateRange, setDateRange] = useState<{ from: number | null; to: number | null }>({ from: null, to: null })
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)

  // Filters
  const [strategyFilter, setStrategyFilter] = useState('ALL')
  const [exchangeFilter, setExchangeFilter] = useState('ALL')

  // Portfolio data (for Tab 1)
  const [portfolio, setPortfolio] = useState<PortfolioRiskSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Confirm dialog and toast are handled by each tab internally

  // ─── Date Range Computation ──────────────────────────────
  const computeDateRange = useCallback((preset: DatePreset): { from: number | null; to: number | null } => {
    const now = Date.now()
    switch (preset) {
      case 'TODAY': {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        return { from: today.getTime(), to: now }
      }
      case '1W': return { from: now - 7 * 86400000, to: now }
      case '1M': return { from: now - 30 * 86400000, to: now }
      case '3M': return { from: now - 90 * 86400000, to: now }
      case 'YTD': {
        const jan1 = new Date(new Date().getFullYear(), 0, 1)
        return { from: jan1.getTime(), to: now }
      }
      case 'ALL': return { from: null, to: null }
      case 'CUSTOM': return dateRange // keep current
      default: return { from: null, to: null }
    }
  }, [dateRange])

  // Initialize date range on mount
  useEffect(() => {
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')
    if (fromParam && toParam) {
      setDatePreset('CUSTOM')
      setDateRange({ from: Number(fromParam), to: Number(toParam) })
      const fromDate = new Date(Number(fromParam))
      const toDate = new Date(Number(toParam))
      setCustomFrom(fromDate.toISOString().split('T')[0])
      setCustomTo(toDate.toISOString().split('T')[0])
    } else {
      setDateRange(computeDateRange('1W'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── URL Sync ────────────────────────────────────────────
  const updateUrl = useCallback((tab: TabId, range: { from: number | null; to: number | null }) => {
    const params = new URLSearchParams()
    params.set('tab', tab)
    if (range.from) params.set('from', String(range.from))
    if (range.to) params.set('to', String(range.to))
    setSearchParams(params, { replace: true })
  }, [setSearchParams])

  // ─── Handlers ────────────────────────────────────────────
  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab)
    updateUrl(tab, dateRange)
  }

  const handlePresetClick = (preset: DatePreset) => {
    setDatePreset(preset)
    setShowDatePicker(false)
    const range = computeDateRange(preset)
    setDateRange(range)
    updateUrl(activeTab, range)
  }

  const handleCustomDateApply = () => {
    if (!customFrom || !customTo) return
    const from = new Date(customFrom).getTime()
    const to = new Date(customTo).getTime() + 86400000 - 1 // end of day
    const range = { from, to }
    setDatePreset('CUSTOM')
    setDateRange(range)
    setShowDatePicker(false)
    updateUrl(activeTab, range)
  }

  // ─── Portfolio Loading ───────────────────────────────────
  const loadPortfolio = useCallback(async () => {
    try {
      const data = await riskApi.getPortfolioRisk()
      setPortfolio(data)
      setError(null)
    } catch {
      setError('Failed to load risk data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPortfolio()
    const interval = setInterval(() => { if (isAnyMarketOpen()) loadPortfolio() }, 10000)
    return () => clearInterval(interval)
  }, [loadPortfolio])

  // ─── Action Helpers ──────────────────────────────────────
  // CB/ForceClose handlers are self-contained in LiveMonitorTab

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header + Live indicator */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold text-white">Risk Command Center</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-500">Live &middot; 10s</span>
          </div>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      {/* Date Range Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
          {presets.map(p => (
            <button
              key={p.id}
              onClick={() => handlePresetClick(p.id)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                datePreset === p.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Calendar picker toggle */}
        <div className="relative">
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className={`px-3 py-1.5 bg-slate-800 border rounded-lg text-xs transition-colors ${
              datePreset === 'CUSTOM'
                ? 'border-blue-500 text-blue-400'
                : 'border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {datePreset === 'CUSTOM' ? `${customFrom} \u2013 ${customTo}` : 'Custom Range'}
          </button>
          {showDatePicker && (
            <div className="absolute top-full mt-1 right-0 bg-slate-800 border border-slate-700 rounded-lg p-3 z-50 shadow-xl">
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600"
                />
                <span className="text-slate-500 text-xs">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600"
                />
                <button
                  onClick={handleCustomDateApply}
                  className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Strategy & Exchange filters (Tab 2 & 3 only) */}
        {activeTab !== 'monitor' && (
          <>
            <select
              value={strategyFilter}
              onChange={e => setStrategyFilter(e.target.value)}
              className="bg-slate-800 text-white text-xs rounded-lg px-3 py-1.5 border border-slate-700"
            >
              <option value="ALL">All Strategies</option>
              {(portfolio?.strategies || []).map(s => (
                <option key={s.strategy} value={s.strategy}>{s.displayName || s.strategy}</option>
              ))}
            </select>
            <select
              value={exchangeFilter}
              onChange={e => setExchangeFilter(e.target.value)}
              className="bg-slate-800 text-white text-xs rounded-lg px-3 py-1.5 border border-slate-700"
            >
              <option value="ALL">All Exchanges</option>
              <option value="N">NSE</option>
              <option value="M">MCX</option>
              <option value="C">CDS</option>
            </select>
          </>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-slate-700">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'monitor' && portfolio && (
        <LiveMonitorTab
          portfolio={portfolio}
          onRefresh={loadPortfolio}
        />
      )}
      {activeTab === 'intelligence' && (
        <TradeIntelligenceTab
          dateRange={dateRange}
          strategyFilter={strategyFilter}
          exchangeFilter={exchangeFilter}
        />
      )}
      {activeTab === 'tuning' && (
        <StrategyTuningTab
          dateRange={dateRange}
          strategyFilter={strategyFilter}
          strategies={(portfolio?.strategies || []).map(s => s.strategy)}
        />
      )}

      {/* Loading state for Tab 1 */}
      {activeTab === 'monitor' && loading && (
        <div className="space-y-6">
          <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card animate-pulse"><div className="h-48 bg-slate-700 rounded" /></div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-slate-600">
        Last updated: {portfolio?.lastUpdated ? new Date(portfolio.lastUpdated).toLocaleTimeString('en-IN') : 'Unknown'}
      </div>
    </div>
  )
}
