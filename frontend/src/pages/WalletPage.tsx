import { useEffect, useState, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, BarChart2, BookOpen, Briefcase, SlidersHorizontal, X, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import WalletCard from '../components/Wallet/WalletCard'
import PositionCard from '../components/Wallet/PositionCard'
import WalletPnLTab from '../components/Wallet/WalletPnLTab'
import WalletJournalTab from '../components/Wallet/WalletJournalTab'
import { useDashboardStore } from '../store/dashboardStore'
import { walletApi } from '../services/api'
import type { Wallet, Position } from '../types'
import TradeModal from '../components/Trading/TradeModal'

type WalletTab = 'positions' | 'pnl' | 'journal'
type WalletType = 'PAPER' | 'REAL'
type DirectionFilter = 'BULLISH' | 'BEARISH' | 'ERROR' | null
type TypeFilter = 'EQ' | 'FUT' | 'OPT' | null
type CategoryFilter = 'NSE' | 'MCX' | 'CURRENCY' | null
type PnLFilter = 'PROFIT' | 'LOSS' | 'NODIFF' | null
type SortOption = 'RECENT' | 'PNL_HIGH' | 'PNL_LOW' | null

/** Convert a Date to IST YYYY-MM-DD */
const toISTDate = (d: Date): string => {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().slice(0, 10)
}

/** Get IST today string */
const getToday = () => toISTDate(new Date())

/** Format YYYY-MM-DD to display string */
const formatDateLabel = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = getToday()
  if (dateStr === today) return 'Today'
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === toISTDate(yesterday)) return 'Yesterday'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Check if a position belongs to a given IST date */
const positionMatchesDate = (p: Position, dateStr: string): boolean => {
  // Open position opened on this date
  if (p.openedAt) {
    const openDate = toISTDate(new Date(p.openedAt))
    if (openDate === dateStr) return true
  }
  // Closed position that was last updated (exited) on this date
  if (p.quantity <= 0 && p.lastUpdated) {
    const exitDate = toISTDate(new Date(p.lastUpdated))
    if (exitDate === dateStr) return true
  }
  // Open position still active (show on today)
  if (p.quantity > 0 && dateStr === getToday()) return true
  return false
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [tradeModalOpen, setTradeModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<WalletTab>('positions')
  const [walletType, setWalletType] = useState<WalletType>('PAPER')
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Date filter
  const [selectedDate, setSelectedDate] = useState(getToday)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const datePickerRef = useRef<HTMLDivElement>(null)

  // Advanced filters
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(null)
  const [pnlFilter, setPnLFilter] = useState<PnLFilter>(null)
  const [sortOption, setSortOption] = useState<SortOption>(null)
  const filterRef = useRef<HTMLDivElement>(null)

  const activeFilterCount = [directionFilter, typeFilter, categoryFilter, pnlFilter, sortOption].filter(Boolean).length

  const clearAllFilters = () => {
    setDirectionFilter(null)
    setTypeFilter(null)
    setCategoryFilter(null)
    setPnLFilter(null)
    setSortOption(null)
  }

  const wsWallet = useDashboardStore((s) => s.wallet)

  const loadWallet = async () => {
    try {
      const data = await walletApi.getWallet()
      setWallet(data)
    } catch (error) {
      console.error('Error loading wallet:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWallet()
    let interval: ReturnType<typeof setInterval> | null = null
    if (autoRefresh) {
      interval = setInterval(loadWallet, 30000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [autoRefresh])

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false)
      }
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDatePicker(false)
      }
    }
    if (showFilterDropdown || showDatePicker) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFilterDropdown, showDatePicker])

  const displayWallet = wsWallet || wallet

  const getPnl = (p: Position) => p.quantity > 0 ? p.unrealizedPnl : p.realizedPnl

  // Date-filtered positions
  const dateFilteredPositions = useMemo(() => {
    if (!displayWallet?.positions) return []
    return displayWallet.positions.filter(p => positionMatchesDate(p, selectedDate))
  }, [displayWallet?.positions, selectedDate])

  // Apply additional filters on top of date filter
  const filteredPositions = useMemo(() => {
    return dateFilteredPositions.filter(p => {
      if (filter === 'open' && p.quantity <= 0) return false
      if (filter === 'closed' && p.quantity > 0) return false
      if (directionFilter === 'BULLISH' && p.side !== 'LONG') return false
      if (directionFilter === 'BEARISH' && p.side !== 'SHORT') return false
      if (directionFilter === 'ERROR' && (p.side === 'LONG' || p.side === 'SHORT')) return false
      if (typeFilter === 'EQ' && p.instrumentType && p.instrumentType !== 'EQUITY') return false
      if (typeFilter === 'FUT' && p.instrumentType !== 'FUTURES') return false
      if (typeFilter === 'OPT' && p.instrumentType !== 'OPTIONS') return false
      if (categoryFilter === 'NSE' && p.exchange !== 'N') return false
      if (categoryFilter === 'MCX' && p.exchange !== 'M') return false
      if (categoryFilter === 'CURRENCY' && p.exchange !== 'C') return false
      const pnl = getPnl(p)
      if (pnlFilter === 'PROFIT' && pnl <= 0) return false
      if (pnlFilter === 'LOSS' && pnl >= 0) return false
      if (pnlFilter === 'NODIFF' && pnl !== 0) return false
      return true
    }).sort((a, b) => {
      if (sortOption === 'RECENT') return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
      if (sortOption === 'PNL_HIGH') return getPnl(b) - getPnl(a)
      if (sortOption === 'PNL_LOW') return getPnl(a) - getPnl(b)
      return 0
    })
  }, [dateFilteredPositions, filter, directionFilter, typeFilter, categoryFilter, pnlFilter, sortOption])

  // Compute date-specific wallet overview from filtered positions
  const dateWalletOverview = useMemo(() => {
    if (!displayWallet) return null
    const positions = dateFilteredPositions
    const openPositions = positions.filter(p => p.quantity > 0)
    const closedPositions = positions.filter(p => p.quantity <= 0)

    const unrealizedPnl = openPositions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0)
    const realizedPnl = closedPositions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0)
    const dayPnl = realizedPnl + unrealizedPnl
    const totalTrades = positions.length
    const wins = closedPositions.filter(p => p.realizedPnl > 0).length
    const losses = closedPositions.filter(p => p.realizedPnl < 0).length
    const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0

    return {
      ...displayWallet,
      dayPnl,
      totalPnl: dayPnl,
      unrealizedPnl,
      realizedPnl,
      openPositionsCount: openPositions.length,
      totalTradesCount: totalTrades,
      winCount: wins,
      lossCount: losses,
      winRate,
    } as Wallet
  }, [displayWallet, dateFilteredPositions])

  const openCount = dateFilteredPositions.filter(p => p.quantity > 0).length

  // Date navigation helpers
  const goToPrevDay = () => {
    const [y, m, d] = selectedDate.split('-').map(Number)
    const prev = new Date(y, m - 1, d)
    prev.setDate(prev.getDate() - 1)
    setSelectedDate(toISTDate(prev))
  }
  const goToNextDay = () => {
    const [y, m, d] = selectedDate.split('-').map(Number)
    const next = new Date(y, m - 1, d)
    next.setDate(next.getDate() + 1)
    const today = getToday()
    const nextStr = toISTDate(next)
    if (nextStr <= today) setSelectedDate(nextStr)
  }
  const isToday = selectedDate === getToday()

  const tabs: { id: WalletTab; label: string; icon: typeof BarChart2 }[] = [
    { id: 'positions', label: 'Positions', icon: Briefcase },
    { id: 'pnl', label: 'P&L Analytics', icon: BarChart2 },
    { id: 'journal', label: 'Trade Journal', icon: BookOpen },
  ]

  return (
    <>
      <div className="min-h-screen mobile-page-bottom">
        {/* Sticky Header */}
        <div className="bg-slate-800/95 backdrop-blur border-b border-slate-700 sticky top-0 z-10">
          <div className="px-3 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 max-w-[1600px] mx-auto">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              {/* Left: Title + open count + date picker */}
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-7 h-7 sm:w-8 sm:h-8 lg:w-9 lg:h-9 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                  <Briefcase className="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5 text-amber-400" />
                </div>
                <h1 className="text-base sm:text-xl lg:text-2xl font-bold text-white truncate">Positions</h1>
                {openCount > 0 && (
                  <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-500/20 text-blue-400 shrink-0">
                    {openCount} open
                  </span>
                )}

                {/* Date Picker */}
                <div className="relative" ref={datePickerRef}>
                  <div className="flex items-center gap-0.5 sm:gap-1">
                    <button
                      onClick={goToPrevDay}
                      className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      title="Previous day"
                    >
                      <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                    <button
                      onClick={() => setShowDatePicker(!showDatePicker)}
                      className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs lg:text-sm font-medium transition-all border ${
                        isToday
                          ? 'bg-amber-500/15 text-amber-400 border-amber-500/40'
                          : 'bg-indigo-500/15 text-indigo-400 border-indigo-500/40'
                      }`}
                    >
                      <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span>{formatDateLabel(selectedDate)}</span>
                    </button>
                    <button
                      onClick={goToNextDay}
                      disabled={isToday}
                      className={`p-1 rounded transition-colors ${isToday ? 'text-slate-600 cursor-not-allowed' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`}
                      title="Next day"
                    >
                      <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                  </div>

                  {/* Date picker dropdown */}
                  {showDatePicker && (
                    <div className="absolute left-0 top-full mt-2 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden w-56">
                      <div className="p-3">
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Date</div>
                        <input
                          type="date"
                          value={selectedDate}
                          max={getToday()}
                          onChange={(e) => {
                            if (e.target.value) {
                              setSelectedDate(e.target.value)
                              setShowDatePicker(false)
                            }
                          }}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/50 [color-scheme:dark]"
                        />
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            onClick={() => { setSelectedDate(getToday()); setShowDatePicker(false) }}
                            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${isToday ? 'bg-amber-500/25 text-amber-400 border border-amber-500/50' : 'bg-slate-700/50 text-slate-400 hover:text-white border border-transparent'}`}
                          >
                            Today
                          </button>
                          {(() => {
                            const y = new Date(); y.setDate(y.getDate() - 1)
                            const yd = toISTDate(y)
                            return (
                              <button
                                onClick={() => { setSelectedDate(yd); setShowDatePicker(false) }}
                                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${selectedDate === yd ? 'bg-indigo-500/25 text-indigo-400 border border-indigo-500/50' : 'bg-slate-700/50 text-slate-400 hover:text-white border border-transparent'}`}
                              >
                                Yesterday
                              </button>
                            )
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Controls */}
              <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                {/* PAPER/REAL Toggle */}
                <div className="flex bg-slate-900/50 rounded-lg p-0.5 sm:p-1">
                  {(['PAPER', 'REAL'] as WalletType[]).map(wt => (
                    <button
                      key={wt}
                      onClick={() => setWalletType(wt)}
                      className={`px-2 sm:px-3 lg:px-4 py-1 sm:py-1.5 rounded-md text-[10px] sm:text-xs lg:text-sm font-medium transition-all ${
                        walletType === wt
                          ? wt === 'PAPER' ? 'bg-blue-500 text-white' : 'bg-amber-500 text-slate-900'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {wt === 'PAPER' ? 'Paper' : 'Real'}
                    </button>
                  ))}
                </div>

                {/* Auto-refresh toggle */}
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs font-medium ${
                    autoRefresh ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  <div className={`w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
                  <span className="hidden sm:inline">Live</span>
                </button>

                {/* Manual refresh */}
                <button
                  onClick={loadWallet}
                  className="p-1.5 sm:p-2 hover:bg-slate-700 rounded transition-colors"
                  disabled={loading}
                >
                  <RefreshCw className={`w-3.5 sm:w-4 h-3.5 sm:h-4 ${loading ? 'animate-spin text-blue-400' : 'text-slate-400'}`} />
                </button>

                {/* New Trade */}
                <button
                  onClick={() => setTradeModalOpen(true)}
                  className="px-2.5 sm:px-4 lg:px-5 py-1.5 sm:py-2 lg:py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg text-xs sm:text-sm lg:text-base font-bold hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/30 flex items-center gap-1 sm:gap-2"
                >
                  <span>+</span>
                  <span className="hidden sm:inline">New Trade</span>
                </button>
              </div>
            </div>

            {/* Tab Bar */}
            <div className="flex gap-0.5 sm:gap-1 lg:gap-2 mt-3 sm:mt-4 overflow-x-auto">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 lg:px-5 py-1.5 sm:py-2 lg:py-2.5 rounded-t text-xs sm:text-sm lg:text-base font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === tab.id
                      ? 'bg-slate-900 text-white border-t border-l border-r border-slate-700'
                      : 'bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  <tab.icon className={`w-3.5 sm:w-4 lg:w-5 h-3.5 sm:h-4 lg:h-5 ${activeTab === tab.id ? 'text-amber-400' : ''}`} />
                  <span className="sm:hidden">{tab.id === 'positions' ? 'Positions' : tab.id === 'pnl' ? 'P&L' : 'Journal'}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="px-1.5 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 max-w-[1600px] mx-auto">
          {/* Positions Tab */}
          {activeTab === 'positions' && (
            <div className="space-y-6">
              <WalletCard wallet={dateWalletOverview} dateLabel={formatDateLabel(selectedDate)} />

              <div className="card">
                <div className="card-header">
                  <span className="text-base lg:text-lg">
                    Positions
                    <span className="text-slate-500 text-sm lg:text-base font-normal ml-2">
                      {formatDateLabel(selectedDate)} ({dateFilteredPositions.length})
                    </span>
                  </span>
                  <div className="flex items-center gap-2 lg:gap-3">
                    {(['all', 'open', 'closed'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 lg:px-4 py-1 lg:py-1.5 rounded-lg text-sm lg:text-base font-medium transition-colors ${filter === f
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-400 hover:text-white'
                          }`}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}

                    {/* Advanced Filter Toggle */}
                    <div className="relative" ref={filterRef}>
                      <button
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                        className={`relative p-1.5 sm:p-2 rounded-lg transition-colors ${
                          showFilterDropdown || activeFilterCount > 0
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                            : 'bg-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        <SlidersHorizontal className="w-4 h-4" />
                        {activeFilterCount > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center">
                            {activeFilterCount}
                          </span>
                        )}
                      </button>

                      {/* Filter Dropdown */}
                      {showFilterDropdown && (
                        <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 lg:w-96 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
                          {/* Header */}
                          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-slate-800/95">
                            <span className="text-sm font-semibold text-white">Filters & Sort</span>
                            <div className="flex items-center gap-2">
                              {activeFilterCount > 0 && (
                                <button onClick={clearAllFilters} className="text-[10px] text-red-400 hover:text-red-300 font-medium">
                                  Clear all
                                </button>
                              )}
                              <button onClick={() => setShowFilterDropdown(false)} className="p-0.5 hover:bg-slate-700 rounded">
                                <X className="w-3.5 h-3.5 text-slate-400" />
                              </button>
                            </div>
                          </div>

                          <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
                            {/* Direction */}
                            <div>
                              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Direction</div>
                              <div className="flex flex-wrap gap-1.5">
                                {([
                                  { key: 'BULLISH' as DirectionFilter, label: 'Bullish', active: 'bg-green-500/25 text-green-400 border border-green-500/50' },
                                  { key: 'BEARISH' as DirectionFilter, label: 'Bearish', active: 'bg-red-500/25 text-red-400 border border-red-500/50' },
                                  { key: 'ERROR' as DirectionFilter, label: 'Error', active: 'bg-slate-500/25 text-slate-300 border border-slate-500/50' },
                                ]).map(({ key, label, active }) => (
                                  <button
                                    key={key}
                                    onClick={() => setDirectionFilter(directionFilter === key ? null : key)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                      directionFilter === key
                                        ? active
                                        : 'bg-slate-700/50 text-slate-400 hover:text-white border border-transparent'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Type */}
                            <div>
                              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Type</div>
                              <div className="flex flex-wrap gap-1.5">
                                {([
                                  { key: 'EQ' as TypeFilter, label: 'Equity' },
                                  { key: 'FUT' as TypeFilter, label: 'FUT' },
                                  { key: 'OPT' as TypeFilter, label: 'OPT' },
                                ]).map(({ key, label }) => (
                                  <button
                                    key={key}
                                    onClick={() => setTypeFilter(typeFilter === key ? null : key)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                      typeFilter === key
                                        ? 'bg-cyan-500/25 text-cyan-400 border border-cyan-500/50'
                                        : 'bg-slate-700/50 text-slate-400 hover:text-white border border-transparent'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Category */}
                            <div>
                              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Category</div>
                              <div className="flex flex-wrap gap-1.5">
                                {([
                                  { key: 'NSE' as CategoryFilter, label: 'NSE' },
                                  { key: 'MCX' as CategoryFilter, label: 'MCX' },
                                  { key: 'CURRENCY' as CategoryFilter, label: 'Currency' },
                                ]).map(({ key, label }) => (
                                  <button
                                    key={key}
                                    onClick={() => setCategoryFilter(categoryFilter === key ? null : key)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                      categoryFilter === key
                                        ? 'bg-amber-500/25 text-amber-400 border border-amber-500/50'
                                        : 'bg-slate-700/50 text-slate-400 hover:text-white border border-transparent'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* PnL */}
                            <div>
                              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">P&L</div>
                              <div className="flex flex-wrap gap-1.5">
                                {([
                                  { key: 'PROFIT' as PnLFilter, label: 'Profit', active: 'bg-green-500/25 text-green-400 border border-green-500/50' },
                                  { key: 'LOSS' as PnLFilter, label: 'Loss', active: 'bg-red-500/25 text-red-400 border border-red-500/50' },
                                  { key: 'NODIFF' as PnLFilter, label: 'No Diff / Error', active: 'bg-slate-500/25 text-slate-300 border border-slate-500/50' },
                                ]).map(({ key, label, active }) => (
                                  <button
                                    key={key}
                                    onClick={() => setPnLFilter(pnlFilter === key ? null : key)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                      pnlFilter === key
                                        ? active
                                        : 'bg-slate-700/50 text-slate-400 hover:text-white border border-transparent'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Sort By */}
                            <div className="border-t border-slate-700 pt-3">
                              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Sort By</div>
                              <div className="flex flex-wrap gap-1.5">
                                {([
                                  { key: 'RECENT' as SortOption, label: 'Most Recent' },
                                  { key: 'PNL_HIGH' as SortOption, label: 'PnL High \u2192 Low' },
                                  { key: 'PNL_LOW' as SortOption, label: 'PnL Low \u2192 High' },
                                ]).map(({ key, label }) => (
                                  <button
                                    key={key}
                                    onClick={() => setSortOption(sortOption === key ? null : key)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                      sortOption === key
                                        ? 'bg-indigo-500/25 text-indigo-400 border border-indigo-500/50'
                                        : 'bg-slate-700/50 text-slate-400 hover:text-white border border-transparent'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Active filter summary */}
                          {activeFilterCount > 0 && (
                            <div className="px-4 py-2 border-t border-slate-700 bg-slate-900/50">
                              <div className="text-[10px] text-slate-500">
                                {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active &middot; {filteredPositions.length} result{filteredPositions.length !== 1 ? 's' : ''}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5 animate-pulse">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-40 bg-slate-700/30 rounded-xl" />
                    ))}
                  </div>
                ) : filteredPositions.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
                    {filteredPositions.map(pos => (
                      <PositionCard
                        key={pos.positionId}
                        position={pos}
                        onUpdate={loadWallet}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    <p className="text-sm">No {filter !== 'all' ? filter : ''} positions found for {formatDateLabel(selectedDate)}</p>
                    {!isToday && (
                      <button onClick={() => setSelectedDate(getToday())} className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block">
                        Go to today
                      </button>
                    )}
                    {filter === 'all' && isToday && (
                      <Link to="/signals" className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block">
                        Browse signals to find opportunities
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* P&L Analytics Tab */}
          {activeTab === 'pnl' && (
            <WalletPnLTab walletType={walletType} />
          )}

          {/* Trade Journal Tab */}
          {activeTab === 'journal' && (
            <WalletJournalTab walletType={walletType} />
          )}
        </div>
      </div>

      {/* Trade Modal */}
      <TradeModal
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        scripCode=""
        currentPrice={0}
      />
    </>
  )
}
