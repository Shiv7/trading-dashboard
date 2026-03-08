import { X, Filter } from 'lucide-react'
import { STRATEGY_FILTER_OPTIONS } from '../../utils/strategyColors'
import type { StrategyFilter } from '../../utils/strategyColors'

// --- Filter Types ---
export type { StrategyFilter }
export type CategoryFilter = 'ALL' | 'N' | 'M' | 'C'
export type InstrumentFilter = 'ALL' | 'EQUITY' | 'FUTURES' | 'OPTION'
export type PnlFilter = 'ALL' | 'PROFITABLE' | 'LOSS'
export type SortOption = 'RECENT' | 'PNL_HIGH' | 'PNL_PCT_HIGH'

export interface TradeFilters {
  strategy: StrategyFilter
  category: CategoryFilter
  instrument: InstrumentFilter
  pnl: PnlFilter
  sort: SortOption
}

export const DEFAULT_FILTERS: TradeFilters = {
  strategy: 'ALL',
  category: 'ALL',
  instrument: 'ALL',
  pnl: 'ALL',
  sort: 'RECENT',
}

type FilterKey = 'strategy' | 'category' | 'instrument' | 'pnl' | 'sort'

const STRATEGY_OPTIONS = STRATEGY_FILTER_OPTIONS

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'N', label: 'NSE' },
  { value: 'M', label: 'MCX' },
  { value: 'C', label: 'Currency' },
]

const INSTRUMENT_OPTIONS: { value: InstrumentFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'FUTURES', label: 'Futures' },
  { value: 'OPTION', label: 'Options' },
]

const PNL_OPTIONS: { value: PnlFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PROFITABLE', label: 'Profitable' },
  { value: 'LOSS', label: 'Loss-making' },
]

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'RECENT', label: 'Most Recent' },
  { value: 'PNL_HIGH', label: 'P&L High→Low' },
  { value: 'PNL_PCT_HIGH', label: 'P&L% High→Low' },
]

// ========== Filter Icon Button (placed in section header) ==========

interface FilterIconButtonProps {
  filters: TradeFilters
  onClick: () => void
  hiddenFilters?: FilterKey[]
}

/** Small icon button to place in section header top-right. Shows active filter count badge. */
export function FilterIconButton({ filters, onClick, hiddenFilters = [] }: FilterIconButtonProps) {
  const show = (key: FilterKey) => !hiddenFilters.includes(key)

  const activeCount = [
    show('strategy') && filters.strategy !== 'ALL',
    show('category') && filters.category !== 'ALL',
    show('instrument') && filters.instrument !== 'ALL',
    show('pnl') && filters.pnl !== 'ALL',
    show('sort') && filters.sort !== 'RECENT',
  ].filter(Boolean).length

  return (
    <button
      onClick={onClick}
      className={`relative p-1.5 sm:p-2 rounded-lg transition-colors ${
        activeCount > 0
          ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
          : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-white'
      }`}
    >
      <Filter className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
      {activeCount > 0 && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 text-[8px] font-bold text-slate-900 flex items-center justify-center">
          {activeCount}
        </span>
      )}
    </button>
  )
}

// ========== Filter Panel (renders below section header when open) ==========

interface TradeFilterPanelProps {
  filters: TradeFilters
  onChange: (filters: TradeFilters) => void
  onClose: () => void
  hiddenFilters?: FilterKey[]
}

/** Expandable filter panel — render conditionally when the section's filter is open. */
export function TradeFilterPanel({ filters, onChange, onClose, hiddenFilters = [] }: TradeFilterPanelProps) {
  const show = (key: FilterKey) => !hiddenFilters.includes(key)

  const isDefault = (!show('strategy') || filters.strategy === 'ALL') &&
    (!show('category') || filters.category === 'ALL') &&
    (!show('instrument') || filters.instrument === 'ALL') &&
    (!show('pnl') || filters.pnl === 'ALL') &&
    (!show('sort') || filters.sort === 'RECENT')

  const update = (partial: Partial<TradeFilters>) => {
    onChange({ ...filters, ...partial })
  }

  const clearAll = () => {
    onChange({ ...DEFAULT_FILTERS })
  }

  return (
    <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-3 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-300">Filters & Sort</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Strategy */}
      {show('strategy') && (
        <FilterRow label="Strategy">
          <div className="flex flex-wrap gap-1">
            {STRATEGY_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                active={filters.strategy === opt.value}
                activeColor={opt.color}
                onClick={() => update({ strategy: opt.value })}
              />
            ))}
          </div>
        </FilterRow>
      )}

      {/* Category (Exchange) */}
      {show('category') && (
        <FilterRow label="Category">
          <div className="flex flex-wrap gap-1">
            {CATEGORY_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                active={filters.category === opt.value}
                onClick={() => update({ category: opt.value })}
              />
            ))}
          </div>
        </FilterRow>
      )}

      {/* Instrument Type */}
      {show('instrument') && (
        <FilterRow label="Instrument">
          <div className="flex flex-wrap gap-1">
            {INSTRUMENT_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                active={filters.instrument === opt.value}
                onClick={() => update({ instrument: opt.value })}
              />
            ))}
          </div>
        </FilterRow>
      )}

      {/* P&L */}
      {show('pnl') && (
        <FilterRow label="P&L">
          <div className="flex flex-wrap gap-1">
            {PNL_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                active={filters.pnl === opt.value}
                activeColor={
                  opt.value === 'PROFITABLE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : opt.value === 'LOSS' ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : undefined
                }
                onClick={() => update({ pnl: opt.value })}
              />
            ))}
          </div>
        </FilterRow>
      )}

      {/* Sort */}
      {show('sort') && (
        <FilterRow label="Sort">
          <div className="flex flex-wrap gap-1">
            {SORT_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                active={filters.sort === opt.value}
                onClick={() => update({ sort: opt.value })}
              />
            ))}
          </div>
        </FilterRow>
      )}

      {/* Clear All */}
      {!isDefault && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-700 transition-colors"
        >
          <X className="w-3 h-3" />
          Clear All
        </button>
      )}
    </div>
  )
}

// --- Sub-components ---

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider w-16 shrink-0 pt-1">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function Chip({
  label,
  active,
  activeColor,
  onClick,
}: {
  label: string
  active: boolean
  activeColor?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-all ${
        active
          ? activeColor || 'bg-blue-600 text-white'
          : 'bg-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  )
}

// --- Filter + Sort Utility ---

export interface FilterableItem {
  strategy?: string
  exchange?: string
  instrumentType?: string
  pnl: number
  pnlPercent: number
  timestamp: string | number
}

/** Apply filters and sort to a list of items. Caller maps their data to FilterableItem shape. */
export function applyFilters<T>(
  items: T[],
  filters: TradeFilters,
  accessor: (item: T) => FilterableItem,
): T[] {
  let result = items.filter(item => {
    const d = accessor(item)

    // Strategy filter
    if (filters.strategy !== 'ALL') {
      const s = (d.strategy || '').toUpperCase()
      if (s !== filters.strategy && !s.startsWith(filters.strategy)) return false
    }

    // Category (exchange) filter — skip if data has no exchange field
    if (filters.category !== 'ALL' && d.exchange) {
      const ex = d.exchange.toUpperCase()
      if (ex !== filters.category) return false
    }

    // Instrument filter — skip if data has no instrumentType field
    if (filters.instrument !== 'ALL' && d.instrumentType) {
      const inst = d.instrumentType.toUpperCase()
      if (filters.instrument === 'OPTION') {
        if (inst !== 'OPTION' && inst !== 'OPTIONS') return false
      } else {
        if (inst !== filters.instrument) return false
      }
    }

    // P&L filter
    if (filters.pnl === 'PROFITABLE' && d.pnl <= 0) return false
    if (filters.pnl === 'LOSS' && d.pnl >= 0) return false

    return true
  })

  // Sort
  result = [...result].sort((a, b) => {
    const da = accessor(a)
    const db = accessor(b)
    switch (filters.sort) {
      case 'PNL_HIGH':
        return db.pnl - da.pnl
      case 'PNL_PCT_HIGH':
        return db.pnlPercent - da.pnlPercent
      case 'RECENT':
      default: {
        const ta = typeof da.timestamp === 'string' ? new Date(da.timestamp).getTime() : da.timestamp
        const tb = typeof db.timestamp === 'string' ? new Date(db.timestamp).getTime() : db.timestamp
        return tb - ta
      }
    }
  })

  return result
}
