import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { patternsApi, strategyTradesApi, strategyWalletsApi } from '../services/api'
import type { PatternSignal, PatternSummary, PatternStats } from '../types'
import type { StrategyTradeRequest } from '../types/orders'
import { useDashboardStore } from '../store/dashboardStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { getOTMStrike, mapToOptionLevels, computeLotSizing } from '../utils/tradingUtils'

// Timeframe ordering: highest weight first
const TF_ORDER = ['1D', '4h', '2h', '1h', '30m', '15m', '5m', '3m', '1m']
const TF_LABELS: Record<string, string> = {
  '1D': 'Daily', '4h': '4-Hour', '2h': '2-Hour', '1h': 'Hourly',
  '30m': '30-Min', '15m': '15-Min', '5m': '5-Min', '3m': '3-Min', '1m': '1-Min',
}

// TF durations in minutes for expiry computation
const TF_MINUTES: Record<string, number> = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240, '1D': 1440,
}

// Exchange label mapping
const EXCHANGE_LABELS: Record<string, string> = {
  N: 'NSE', M: 'MCX', C: 'CUR', B: 'BSE',
}

/**
 * A pattern is expired once the candle that detected it has closed.
 * triggeredAt + TF duration = candle close → pattern no longer active.
 */
function isPatternExpired(p: PatternSignal): boolean {
  if (!p.triggeredAt || !p.timeframe) return false
  const tfMin = TF_MINUTES[normalizeTf(p.timeframe)] || 0
  if (tfMin === 0) return false
  const triggeredMs = new Date(p.triggeredAt).getTime()
  if (isNaN(triggeredMs)) return false
  return Date.now() > triggeredMs + tfMin * 60_000
}

// All candlestick and structural pattern types with icons, descriptions, and trading implications
const PATTERN_TYPES = {
  HAMMER: { icon: '\u{1F528}', color: 'emerald', desc: 'Bullish reversal, long lower shadow',
    implication: 'Signals potential bottom. Buyers stepped in aggressively after sellers pushed price down. Most reliable after a sustained downtrend.' },
  INVERTED_HAMMER: { icon: '\u{1F527}', color: 'emerald', desc: 'Bullish reversal after downtrend',
    implication: 'Buying pressure emerging. Buyers attempted to push higher but met resistance. Confirmation needed from next candle.' },
  BULLISH_ENGULFING: { icon: '\u{1F7E2}', color: 'emerald', desc: 'Bullish reversal, engulfs prior candle',
    implication: 'Strong reversal signal. Buyers completely overwhelmed sellers. The larger the engulfing body, the stronger the signal.' },
  BULLISH_HARAMI: { icon: '\u{1F930}', color: 'emerald', desc: 'Bullish reversal, inside bar',
    implication: 'Selling pressure fading. The smaller body inside the prior candle shows indecision, often preceding a reversal.' },
  PIERCING_LINE: { icon: '\u2B06\uFE0F', color: 'emerald', desc: 'Bullish reversal, pierces midpoint',
    implication: 'Buyers pushing back strongly. The close above the midpoint of the prior bearish candle signals a shift in control.' },
  MORNING_STAR: { icon: '\u{1F305}', color: 'emerald', desc: 'Strong bullish reversal, 3 candles',
    implication: 'High-reliability reversal pattern. Three-candle confirmation makes this one of the strongest bullish signals. Look for volume expansion.' },
  THREE_WHITE_SOLDIERS: { icon: '\u{1F396}\uFE0F', color: 'emerald', desc: 'Strong bullish continuation',
    implication: 'Sustained institutional buying over 3 sessions. Indicates strong accumulation. Watch for volume confirmation on each candle.' },
  TWEEZER_BOTTOM: { icon: '\u{1F53B}', color: 'emerald', desc: 'Double bottom reversal',
    implication: 'Price found strong support at the same level twice. Buyers defending this zone aggressively. Good risk-reward entry point.' },
  SHOOTING_STAR: { icon: '\u{1F4AB}', color: 'red', desc: 'Bearish reversal, long upper shadow',
    implication: 'Sellers rejected higher prices. The long upper shadow shows distribution happening. Most reliable after an uptrend.' },
  HANGING_MAN: { icon: '\u{1F3AD}', color: 'red', desc: 'Bearish reversal after uptrend',
    implication: 'Warning sign at top. Despite recovery from lows, the selling pressure during the session signals weakening momentum.' },
  BEARISH_ENGULFING: { icon: '\u{1F534}', color: 'red', desc: 'Bearish reversal, engulfs prior candle',
    implication: 'Strong bearish reversal. Sellers completely overwhelmed buyers. Often marks the beginning of a downtrend.' },
  BEARISH_HARAMI: { icon: '\u{1F38E}', color: 'red', desc: 'Bearish reversal, inside bar',
    implication: 'Buying momentum weakening. The smaller body inside the prior bullish candle signals hesitation, often preceding a decline.' },
  DARK_CLOUD_COVER: { icon: '\u2601\uFE0F', color: 'red', desc: 'Bearish reversal, covers prior gain',
    implication: 'Bears taking control. Opening above prior high but closing below midpoint shows sellers are aggressive. Gap fills are common.' },
  EVENING_STAR: { icon: '\u{1F306}', color: 'red', desc: 'Strong bearish reversal, 3 candles',
    implication: 'High-reliability bearish reversal. Three-candle confirmation at a top is a powerful sell signal. Higher TF occurrence is critical.' },
  THREE_BLACK_CROWS: { icon: '\u{1F426}\u200D\u2B1B', color: 'red', desc: 'Strong bearish continuation',
    implication: 'Sustained institutional selling over 3 sessions. Distribution phase likely in progress. Exit longs and consider shorts.' },
  TWEEZER_TOP: { icon: '\u{1F53A}', color: 'red', desc: 'Double top reversal',
    implication: 'Price rejected at the same resistance level twice. Sellers defending this zone. A break below the low confirms the reversal.' },
  DOJI: { icon: '\u2795', color: 'amber', desc: 'Indecision, small body',
    implication: 'Market indecision. Neither buyers nor sellers in control. Context matters: after a trend, signals potential reversal.' },
  DRAGONFLY_DOJI: { icon: '\u{1F409}', color: 'emerald', desc: 'Bullish doji, long lower wick',
    implication: 'Bullish reversal doji. Sellers pushed price down but buyers reclaimed all losses. Strong at bottoms, especially with volume.' },
  GRAVESTONE_DOJI: { icon: '\u{1FAA6}', color: 'red', desc: 'Bearish doji, long upper wick',
    implication: 'Bearish reversal doji. Buyers pushed price up but sellers rejected it back to open. Strong at tops, confirms distribution.' },
  SPINNING_TOP: { icon: '\u{1F3A1}', color: 'amber', desc: 'Indecision, small body with shadows',
    implication: 'Tug of war between buyers and sellers. Wait for the next candle for confirmation. Often precedes a breakout.' },
  MARUBOZU: { icon: '\u{1F4CA}', color: 'blue', desc: 'Strong momentum, no shadows',
    implication: 'Extreme conviction. No shadows means buyers (bullish) or sellers (bearish) dominated the entire session. Strong continuation signal.' },
  BREAKOUT: { icon: '\u{1F680}', color: 'emerald', desc: 'Price breaking resistance',
    implication: 'Resistance broken with momentum. Watch for volume confirmation and successful retest. Failed breakouts reverse hard.' },
  BREAKDOWN: { icon: '\u{1F4C9}', color: 'red', desc: 'Price breaking support',
    implication: 'Support broken with momentum. Expect continued selling as stop-losses trigger. Watch for volume and failed breakdown traps.' },
  REVERSAL: { icon: '\u{1F504}', color: 'purple', desc: 'Trend direction change',
    implication: 'Trend exhaustion detected. The prior move is losing steam. Wait for confirmation before taking the opposite direction.' },
  TREND_CONTINUATION: { icon: '\u27A1\uFE0F', color: 'blue', desc: 'Trend continuing',
    implication: 'The existing trend is intact and likely to continue. Pullback entries offer the best risk-reward in the trend direction.' },
  MOMENTUM: { icon: '\u26A1', color: 'cyan', desc: 'Strong directional move',
    implication: 'High-velocity move with conviction. Chase entries are risky, but the trend is strong. Wait for pullbacks to enter.' },
  MEAN_REVERSION: { icon: '\u{1F3AF}', color: 'orange', desc: 'Returning to average',
    implication: 'Price overextended from average. Expect a snap-back to the mean. Counter-trend trade with tight stop.' },
  DOUBLE_BOTTOM: { icon: '\u3030\uFE0F', color: 'emerald', desc: 'W pattern reversal',
    implication: 'Classic W-shaped reversal. The neckline break confirms the pattern. Target = distance from bottom to neckline.' },
  DOUBLE_TOP: { icon: '\u{1F3D4}\uFE0F', color: 'red', desc: 'M pattern reversal',
    implication: 'Classic M-shaped reversal. The neckline break confirms the pattern. Target = distance from top to neckline.' },
  HEAD_SHOULDERS: { icon: '\u{1F464}', color: 'purple', desc: 'H&S pattern',
    implication: 'Highly reliable reversal pattern. The neckline break with volume confirms. Target = head-to-neckline distance.' },
  HEAD_AND_SHOULDERS: { icon: '\u{1F464}', color: 'purple', desc: 'H&S bearish reversal',
    implication: 'Highly reliable reversal pattern. The neckline break with volume confirms. Target = head-to-neckline distance.' },
  INVERSE_HEAD_AND_SHOULDERS: { icon: '\u{1F464}', color: 'emerald', desc: 'Inverse H&S bullish reversal',
    implication: 'Mirror of H&S. Neckline break above confirms bullish reversal. Target = head-to-neckline distance projected upward.' },
  UNKNOWN: { icon: '\u2753', color: 'slate', desc: 'Unknown pattern type',
    implication: '' },
} as const

type PatternType = keyof typeof PATTERN_TYPES

const colorClasses: Record<string, { bg: string; text: string }> = {
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  red: { bg: 'bg-red-500/20', text: 'text-red-400' },
  amber: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  blue: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  purple: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  cyan: { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  orange: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  slate: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  indigo: { bg: 'bg-indigo-500/20', text: 'text-indigo-400' },
  rose: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPatternInfo(type: string) {
  const normalized = type?.toUpperCase().replace(/[- ]/g, '_') || 'UNKNOWN'
  return PATTERN_TYPES[normalized as PatternType] || PATTERN_TYPES.UNKNOWN
}

function normalizeTf(tf: string): string {
  // Backend sends '1d' (lowercase), normalize to canonical '1D'
  const upper = tf.toUpperCase()
  if (upper === '1D') return '1D'
  return tf.toLowerCase()  // everything else stays lowercase: '4h', '2h', '30m', etc.
}

function getTfIndex(tf: string): number {
  const idx = TF_ORDER.indexOf(normalizeTf(tf))
  return idx >= 0 ? idx : 99
}

function getTickerName(p: PatternSignal): string {
  return p.symbol || p.companyName || p.scripCode
}

interface ConfluenceResult {
  label: string
  type: 'strong' | 'divergent' | 'conflicting' | 'none'
  dominantDir: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
}

function computeConfluence(patterns: PatternSignal[]): ConfluenceResult {
  // Only consider ACTIVE (non-expired) patterns for confluence
  const activePatterns = patterns.filter(p => !isPatternExpired(p))

  if (activePatterns.length === 0) {
    return { label: 'All Patterns Expired', type: 'none', dominantDir: 'NEUTRAL' }
  }

  // Get dominant direction per TF
  const tfDirs = new Map<string, string>()
  for (const p of activePatterns) {
    const tf = normalizeTf(p.timeframe || '')
    const dir = p.direction
    if (dir === 'NEUTRAL') continue
    const existing = tfDirs.get(tf)
    if (!existing) tfDirs.set(tf, dir)
    // If mixed within same TF, mark as MIXED
    else if (existing !== dir) tfDirs.set(tf, 'MIXED')
  }

  const entries = Array.from(tfDirs.entries())
    .filter(([, d]) => d !== 'MIXED')
    .sort((a, b) => getTfIndex(a[0]) - getTfIndex(b[0]))

  if (entries.length <= 1) {
    const dir = entries[0]?.[1] || 'NEUTRAL'
    return { label: '', type: 'none', dominantDir: dir as ConfluenceResult['dominantDir'] }
  }

  const allDirs = entries.map(e => e[1])
  const uniqueDirs = new Set(allDirs)

  // All same direction
  if (uniqueDirs.size === 1) {
    const dir = allDirs[0]
    return {
      label: `Strong ${dir === 'BULLISH' ? 'Bullish' : 'Bearish'} Confluence`,
      type: 'strong',
      dominantDir: dir as ConfluenceResult['dominantDir'],
    }
  }

  // HTF divergence: highest TF disagrees with majority of lower TFs
  const htfDir = entries[0][1]
  const ltfDirs = entries.slice(1).map(e => e[1])
  const ltfMajority = ltfDirs.filter(d => d !== htfDir).length > ltfDirs.length / 2

  if (ltfMajority) {
    return {
      label: `HTF ${htfDir === 'BULLISH' ? 'Bullish' : 'Bearish'} Divergence`,
      type: 'divergent',
      dominantDir: htfDir as ConfluenceResult['dominantDir'],
    }
  }

  return { label: 'Conflicting Signals', type: 'conflicting', dominantDir: 'NEUTRAL' }
}

// Format number with fallback
const fmt = (n: number | undefined | null, decimals = 2): string => {
  if (n === undefined || n === null || isNaN(n)) return '-'
  return n.toFixed(decimals)
}

// Format SL/Target levels: null/undefined = DM (Data Missing), 0 = ERR (error)
const fmtLevel = (n: number | undefined | null, decimals = 2): { text: string; status: 'ok' | 'dm' | 'err' } => {
  if (n === undefined || n === null || isNaN(n)) return { text: 'DM', status: 'dm' }
  if (n === 0) return { text: 'ERR', status: 'err' }
  return { text: n.toFixed(decimals), status: 'ok' }
}

const fmtIST = (iso: string) => {
  const d = new Date(iso)
  const day = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' })
  const mon = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' })
  const time = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
  return `${day}${mon} ${time}`
}

// TF weights: higher TF = more weight in strength score
const TF_WEIGHT: Record<string, number> = {
  '1D': 8, '4h': 7, '2h': 6, '1h': 5, '30m': 4, '15m': 3, '5m': 2, '3m': 1, '1m': 1,
}

/**
 * Cumulative strength score (0–100) for a group of patterns.
 * Factors: per-pattern confidence weighted by TF importance + directional alignment bonus.
 * Only active (non-expired) patterns contribute.
 */
function computeStrengthScore(patterns: PatternSignal[]): number {
  const active = patterns.filter(p => !isPatternExpired(p))
  if (active.length === 0) return 0

  // Weighted average confidence (by TF importance)
  let weightedSum = 0
  let totalWeight = 0
  for (const p of active) {
    const w = TF_WEIGHT[normalizeTf(p.timeframe || '')] || 1
    weightedSum += (p.confidence || 0) * w
    totalWeight += w
  }
  const baseScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0

  // Alignment factor: all same direction = 1.0, mixed = 0.7
  const dirs = new Set(active.map(p => p.direction).filter(d => d !== 'NEUTRAL'))
  const alignment = dirs.size <= 1 ? 1.0 : 0.7

  // Multi-TF coverage bonus: more active TFs = slight boost (up to +10)
  const activeTFs = new Set(active.map(p => normalizeTf(p.timeframe || ''))).size
  const coverageBonus = Math.min(activeTFs * 2, 10)

  return Math.min(100, Math.round(baseScore * alignment + coverageBonus))
}

// Stock group type for grouped cards
interface StockGroup {
  scripCode: string
  ticker: string
  patterns: PatternSignal[]
  tfGroups: [string, PatternSignal[]][] // sorted high-to-low TF
  confluence: ConfluenceResult
  latestTime: number
  totalPatterns: number
  tfCount: number
  strengthScore: number
}

// ─── Multi-Select Dropdown ──────────────────────────────────────────────────
interface DropdownOption { value: string; label: string; icon?: string }

function MultiSelectDropdown({
  label,
  options,
  selected,
  onApply,
}: {
  label: string
  options: DropdownOption[]
  selected: string[]
  onApply: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string[]>(selected)
  const ref = useRef<HTMLDivElement>(null)

  // Sync pending when external selected changes (e.g. global reset)
  useEffect(() => { setPending(selected) }, [selected])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (val: string) => {
    setPending(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val])
  }

  const selectAll = () => setPending(options.map(o => o.value))
  const clearAll = () => setPending([])

  const apply = () => { onApply(pending); setOpen(false) }
  const reset = () => { setPending([]); onApply([]); setOpen(false) }

  const count = selected.length
  const hasChanges = JSON.stringify([...pending].sort()) !== JSON.stringify([...selected].sort())

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
          count > 0
            ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
            : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500'
        }`}
      >
        {label}
        {count > 0 && (
          <span className="bg-blue-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {count}
          </span>
        )}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Select All / Clear All */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-800/80">
            <button onClick={selectAll} className="text-[11px] text-blue-400 hover:text-blue-300">Select All</button>
            <button onClick={clearAll} className="text-[11px] text-slate-400 hover:text-slate-300">Clear All</button>
          </div>

          {/* Options */}
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map(opt => (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700/50 cursor-pointer text-xs"
              >
                <input
                  type="checkbox"
                  checked={pending.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="w-3.5 h-3.5 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0 accent-blue-500"
                />
                {opt.icon && <span className="text-sm">{opt.icon}</span>}
                <span className="text-slate-200 truncate">{opt.label}</span>
              </label>
            ))}
          </div>

          {/* Apply / Reset */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-700 bg-slate-800/80">
            <button
              onClick={apply}
              className={`flex-1 py-1.5 rounded text-[11px] font-semibold transition-all ${
                hasChanges
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-blue-600/60 text-blue-200'
              }`}
            >
              Apply{pending.length > 0 ? ` (${pending.length})` : ''}
            </button>
            <button
              onClick={reset}
              className="flex-1 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-[11px] font-semibold"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function PatternsPage() {
  const [apiPatterns, setApiPatterns] = useState<PatternSignal[]>([])
  const [summary, setSummary] = useState<PatternSummary | null>(null)
  const [stats, setStats] = useState<Record<string, PatternStats> | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'active' | 'history' | 'stats'>('active')

  // Filters (applied immediately via dropdown Apply buttons)
  const [selectedPatterns, setSelectedPatterns] = useState<string[]>([])
  const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>([])
  const [selectedConfidences, setSelectedConfidences] = useState<string[]>([])
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH' | 'NEUTRAL'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  // Selected group for detail panel (scripCode)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  // WebSocket for real-time updates
  const { connected } = useWebSocket()
  const { patternSignals: wsPatterns, bulkUpdatePatternSignals } = useDashboardStore()

  // Merge API patterns with real-time WebSocket updates
  const patterns = useMemo(() => {
    const patternMap = new Map<string, PatternSignal>()
    apiPatterns.forEach(p => { if (p?.patternId) patternMap.set(p.patternId, p) })
    wsPatterns.forEach(p => { if (p?.patternId) patternMap.set(p.patternId, p) })
    return Array.from(patternMap.values())
  }, [apiPatterns, wsPatterns])

  // ── Multi-TF Confluence Search ──
  interface ConfluenceRule { pattern: string; timeframe: string }
  const [confluenceRules, setConfluenceRules] = useState<ConfluenceRule[]>([])
  const [confluenceOpen, setConfluenceOpen] = useState(false)

  const addRule = () => setConfluenceRules(prev => [...prev, { pattern: '', timeframe: '' }])
  const removeRule = (idx: number) => setConfluenceRules(prev => prev.filter((_, i) => i !== idx))
  const updateRule = (idx: number, field: 'pattern' | 'timeframe', val: string) => {
    setConfluenceRules(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }
  const clearRules = () => { setConfluenceRules([]); setConfluenceOpen(false) }

  // ── BUY CTA state ──
  const [buyStatus, setBuyStatus] = useState<Record<string, 'idle' | 'sending' | 'filled' | 'error'>>({})
  const [walletCapital, setWalletCapital] = useState(0)

  // Load wallet capital on mount
  useEffect(() => {
    strategyWalletsApi.getSummaries().then(wallets => {
      if (wallets && wallets.length > 0) {
        // Use the first wallet's capital (or sum all)
        const total = wallets.reduce((sum, w) => sum + (w.currentCapital || 0), 0)
        if (total > 0) setWalletCapital(total)
      }
    }).catch(() => {})
  }, [])

  /** Handle BUY for a pattern group — enforces volume gate + regime check */
  const handleBuyPattern = useCallback(async (scripCode: string, groupPatterns: PatternSignal[]) => {
    // Find best active non-expired pattern with SL + T1
    const best = groupPatterns
      .filter(p => !isPatternExpired(p) && p.stopLoss && p.target1 && p.confidence >= 0.6)
      .sort((a, b) => b.confidence - a.confidence)[0]

    if (!best) return

    // HARD GATE: volume must be confirmed
    if (!best.volumeConfirmed) {
      setBuyStatus(prev => ({ ...prev, [scripCode]: 'error' }))
      setTimeout(() => setBuyStatus(prev => ({ ...prev, [scripCode]: 'idle' })), 3000)
      return
    }

    // REGIME WARNING: if AVOID, skip (could add override later)
    if (best.tradingMode === 'AVOID') {
      setBuyStatus(prev => ({ ...prev, [scripCode]: 'error' }))
      setTimeout(() => setBuyStatus(prev => ({ ...prev, [scripCode]: 'idle' })), 3000)
      return
    }

    try {
      // setBuyingScripCode removed (unused read)
      setBuyStatus(prev => ({ ...prev, [scripCode]: 'sending' }))

      const isLong = best.direction === 'BULLISH'
      const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE'
      const { strike } = getOTMStrike(best.entryPrice, best.direction)
      const conf = Math.round(best.confidence * 100)

      // Estimate premium and compute lot sizing
      const estimatedPremium = Math.max((best.atr30m || best.entryPrice * 0.004) * 3, best.entryPrice * 0.008)
      const lotSize = 50 // Default NSE lot; will be overridden by backend if option enrichment is available
      const sizing = computeLotSizing(conf, walletCapital, estimatedPremium, lotSize)
      if (sizing.disabled) {
        setBuyStatus(prev => ({ ...prev, [scripCode]: 'error' }))
        setTimeout(() => setBuyStatus(prev => ({ ...prev, [scripCode]: 'idle' })), 3000)
        return
      }

      // Map to option levels
      const optLevels = mapToOptionLevels(
        estimatedPremium, best.entryPrice, best.stopLoss!,
        [best.target1!, best.target2 ?? null, best.target3 ?? null, best.target4 ?? null],
        strike, optionType
      )

      const req: StrategyTradeRequest = {
        scripCode: best.scripCode,
        instrumentSymbol: best.symbol || best.companyName,
        instrumentType: 'OPTION',
        underlyingScripCode: best.scripCode,
        underlyingSymbol: best.symbol || best.companyName,
        side: 'BUY',
        quantity: sizing.quantity,
        lots: sizing.lots,
        lotSize,
        multiplier: 1,
        entryPrice: estimatedPremium,
        sl: optLevels.sl,
        t1: optLevels.targets[0] || 0,
        t2: optLevels.targets[1] || 0,
        t3: optLevels.targets[2] || 0,
        t4: optLevels.targets[3] || 0,
        equitySpot: best.entryPrice,
        equitySl: best.stopLoss!,
        equityT1: best.target1!,
        equityT2: best.target2 || 0,
        equityT3: best.target3 || 0,
        equityT4: best.target4 || 0,
        delta: optLevels.delta,
        optionType,
        strike,
        strategy: 'PATTERN',
        exchange: best.exchange || 'N',
        direction: isLong ? 'BULLISH' : 'BEARISH',
        confidence: conf,
      }

      const result = await strategyTradesApi.create(req)
      if (result?.success) {
        setBuyStatus(prev => ({ ...prev, [scripCode]: 'filled' }))
        setTimeout(() => setBuyStatus(prev => ({ ...prev, [scripCode]: 'idle' })), 3000)
      } else {
        setBuyStatus(prev => ({ ...prev, [scripCode]: 'error' }))
        setTimeout(() => setBuyStatus(prev => ({ ...prev, [scripCode]: 'idle' })), 3000)
      }
    } catch (e) {
      setBuyStatus(prev => ({ ...prev, [scripCode]: 'error' }))
      setTimeout(() => setBuyStatus(prev => ({ ...prev, [scripCode]: 'idle' })), 3000)
    } finally {
      // setBuyingScripCode cleared
    }
  }, [walletCapital])

  // Valid rules = both pattern and timeframe selected
  const activeRules = confluenceRules.filter(r => r.pattern && r.timeframe)

  // Confluence results: group by stock, find stocks matching ALL rules
  const confluenceResults = useMemo(() => {
    if (activeRules.length < 2) return null

    // Group all patterns by scripCode
    const byStock = new Map<string, PatternSignal[]>()
    patterns.forEach(p => {
      const key = p.scripCode
      if (!byStock.has(key)) byStock.set(key, [])
      byStock.get(key)!.push(p)
    })

    // Find stocks matching ALL rules
    const matches: { scripCode: string; companyName: string; matched: { rule: ConfluenceRule; signal: PatternSignal }[] }[] = []

    byStock.forEach((stockPatterns, scripCode) => {
      const matched: { rule: ConfluenceRule; signal: PatternSignal }[] = []
      const allRulesMatched = activeRules.every(rule => {
        const match = stockPatterns.find(p =>
          p.patternType?.toUpperCase() === rule.pattern && p.timeframe === rule.timeframe
        )
        if (match) matched.push({ rule, signal: match })
        return !!match
      })

      if (allRulesMatched) {
        const name = stockPatterns[0]?.companyName || scripCode
        matches.push({ scripCode, companyName: name, matched })
      }
    })

    return matches.sort((a, b) => b.matched.length - a.matched.length)
  }, [patterns, activeRules])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000)
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

  const handleRefresh = () => { setLoading(true); loadData() }

  // Check if any filter is active
  const hasActiveFilters = selectedPatterns.length > 0 || selectedTimeframes.length > 0 ||
    selectedConfidences.length > 0 || directionFilter !== 'ALL' || searchQuery.trim() !== ''

  const resetAll = () => {
    setSelectedPatterns([])
    setSelectedTimeframes([])
    setSelectedConfidences([])
    setDirectionFilter('ALL')
    setSearchQuery('')
    setSortOrder('desc')
  }

  // Build dropdown options: static known values + any extras seen in data
  const patternOptions = useMemo<DropdownOption[]>(() => {
    const allTypes = new Set(Object.keys(PATTERN_TYPES).filter(k => k !== 'UNKNOWN'))
    patterns.forEach(p => { if (p.patternType) allTypes.add(p.patternType.toUpperCase()) })
    return Array.from(allTypes).sort().map(t => {
      const info = getPatternInfo(t)
      return { value: t, label: t.replace(/_/g, ' '), icon: info.icon }
    })
  }, [patterns])

  const timeframeOptions = useMemo<DropdownOption[]>(() => {
    const allTfs = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1D'])
    patterns.forEach(p => { if (p.timeframe) allTfs.add(p.timeframe) })
    return Array.from(allTfs).sort((a, b) => {
      const ia = TF_ORDER.indexOf(a), ib = TF_ORDER.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    }).map(t => ({ value: t, label: t }))
  }, [patterns])

  const confidenceOptions: DropdownOption[] = [
    { value: 'HIGH', label: 'High (70%+)' },
    { value: 'MEDIUM', label: 'Medium (40-70%)' },
    { value: 'LOW', label: 'Low (<40%)' },
  ]

  // Filter individual patterns
  const filteredPatterns = useMemo(() => {
    let result = patterns

    if (selectedPatterns.length > 0) {
      result = result.filter(p => selectedPatterns.includes(p.patternType?.toUpperCase()))
    }

    if (directionFilter !== 'ALL') {
      result = result.filter(p => p.direction === directionFilter)
    }

    if (selectedTimeframes.length > 0) {
      result = result.filter(p => selectedTimeframes.includes(p.timeframe || ''))
    }

    if (selectedConfidences.length > 0) {
      result = result.filter(p => {
        const conf = p.confidence || 0
        return selectedConfidences.some(c => {
          if (c === 'HIGH') return conf >= 0.7
          if (c === 'MEDIUM') return conf >= 0.4 && conf < 0.7
          if (c === 'LOW') return conf < 0.4
          return false
        })
      })
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(p =>
        p.scripCode?.toLowerCase().includes(q) ||
        p.companyName?.toLowerCase().includes(q) ||
        (p.symbol || '').toLowerCase().includes(q) ||
        p.patternType?.toLowerCase().replace(/_/g, ' ').includes(q)
      )
    }

    return result
  }, [patterns, selectedPatterns, directionFilter, selectedTimeframes, selectedConfidences, searchQuery])

  // Group filtered patterns by scripCode and build StockGroups
  const stockGroups = useMemo<StockGroup[]>(() => {
    const byStock = new Map<string, PatternSignal[]>()
    filteredPatterns.forEach(p => {
      const key = p.scripCode
      if (!byStock.has(key)) byStock.set(key, [])
      byStock.get(key)!.push(p)
    })

    const groups: StockGroup[] = []
    byStock.forEach((pats, scripCode) => {
      // Sub-group by timeframe (normalized), sorted high-to-low
      const byTf = new Map<string, PatternSignal[]>()
      pats.forEach(p => {
        const tf = normalizeTf(p.timeframe || 'N/A')
        if (!byTf.has(tf)) byTf.set(tf, [])
        byTf.get(tf)!.push(p)
      })

      const tfGroups: [string, PatternSignal[]][] = Array.from(byTf.entries())
        .sort((a, b) => getTfIndex(a[0]) - getTfIndex(b[0]))

      // Sort patterns within each TF by confidence desc
      tfGroups.forEach(([, tfPats]) => {
        tfPats.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      })

      const latestTime = Math.max(...pats.map(p => new Date(p.triggeredAt).getTime() || 0))
      const confluence = computeConfluence(pats)
      const strengthScore = computeStrengthScore(pats)

      groups.push({
        scripCode,
        ticker: getTickerName(pats[0]),
        patterns: pats,
        tfGroups,
        confluence,
        latestTime,
        totalPatterns: pats.length,
        tfCount: tfGroups.length,
        strengthScore,
      })
    })

    // Sort groups by latest timestamp
    groups.sort((a, b) => sortOrder === 'desc' ? b.latestTime - a.latestTime : a.latestTime - b.latestTime)
    return groups
  }, [filteredPatterns, sortOrder])

  // Get selected group data
  const selectedGroupData = useMemo(() => {
    if (!selectedGroup) return null
    return stockGroups.find(g => g.scripCode === selectedGroup) || null
  }, [selectedGroup, stockGroups])

  if (loading && patterns.length === 0) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse"><div className="h-16 bg-slate-700 rounded" /></div>
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
          <button onClick={handleRefresh} disabled={loading}
            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors disabled:opacity-50">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="flex gap-2">
          {(['active', 'history', 'stats'] as const).map(v => (
            <button key={v} onClick={() => handleViewChange(v)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}>
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
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search stock or pattern..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-slate-700/50 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-48"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="w-px h-6 bg-slate-600" />

          {/* Multi-select: Patterns */}
          <MultiSelectDropdown
            label="Patterns"
            options={patternOptions}
            selected={selectedPatterns}
            onApply={setSelectedPatterns}
          />

          {/* Multi-select: Timeframes */}
          <MultiSelectDropdown
            label="Timeframes"
            options={timeframeOptions}
            selected={selectedTimeframes}
            onApply={setSelectedTimeframes}
          />

          {/* Multi-select: Confidence */}
          <MultiSelectDropdown
            label="Confidence"
            options={confidenceOptions}
            selected={selectedConfidences}
            onApply={setSelectedConfidences}
          />

          <div className="w-px h-6 bg-slate-600" />

          {/* Direction Filter (toggle buttons) */}
          <div className="flex items-center gap-0.5">
            {([
              { key: 'ALL', label: 'All', icon: '\u25CB', color: '' },
              { key: 'BULLISH', label: 'Bull', icon: '\u2191', color: 'emerald' },
              { key: 'BEARISH', label: 'Bear', icon: '\u2193', color: 'red' },
              { key: 'NEUTRAL', label: 'Ntrl', icon: '\u2212', color: 'slate' }
            ] as const).map(d => (
              <button
                key={d.key}
                onClick={() => setDirectionFilter(d.key as typeof directionFilter)}
                className={`px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                  directionFilter === d.key
                    ? d.color ? `${colorClasses[d.color]?.bg} ${colorClasses[d.color]?.text}` : 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:text-white'
                }`}
              >
                {d.icon} {d.label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-600" />

          {/* Sort by timestamp toggle */}
          <button
            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700/50 border border-slate-600 rounded-lg text-xs text-slate-300 hover:border-slate-500 hover:text-white transition-all"
            title={sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={sortOrder === 'desc'
                  ? 'M3 4h13M3 8h9M3 12h5m8-4v8m0 0l-3-3m3 3l3-3'
                  : 'M3 4h13M3 8h9M3 12h5m8 0V4m0 0L16 7m3-3l3 3'
                }
              />
            </svg>
            Time
          </button>

          {/* Reset All */}
          {hasActiveFilters && (
            <>
              <div className="w-px h-6 bg-slate-600" />
              <button onClick={resetAll}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-600 hover:bg-slate-500 text-white transition-all">
                Reset All
              </button>
            </>
          )}

          {/* Result count */}
          <div className="ml-auto text-xs text-slate-400">
            {hasActiveFilters && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-1 align-middle" />}
            {stockGroups.length} stocks ({filteredPatterns.length} patterns)
          </div>
        </div>
      )}

      {/* ── Multi-TF Confluence Search ── */}
      {view !== 'stats' && (
        <div className="space-y-2">
          {/* Toggle button */}
          <button
            onClick={() => { setConfluenceOpen(!confluenceOpen); if (!confluenceOpen && confluenceRules.length === 0) { setConfluenceRules([{ pattern: '', timeframe: '' }, { pattern: '', timeframe: '' }]) } }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              confluenceOpen || activeRules.length >= 2
                ? 'bg-purple-500/20 border border-purple-500/40 text-purple-300'
                : 'bg-slate-700/50 border border-slate-600 text-slate-400 hover:text-white hover:border-slate-500'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Multi-TF Search
            {activeRules.length >= 2 && confluenceResults && (
              <span className="bg-purple-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                {confluenceResults.length} match{confluenceResults.length !== 1 ? 'es' : ''}
              </span>
            )}
          </button>

          {/* Rule Builder */}
          {confluenceOpen && (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">Find stocks with <span className="text-purple-400 font-semibold">ALL</span> of these patterns:</div>
                <button onClick={clearRules} className="text-[11px] text-slate-500 hover:text-slate-300">Clear</button>
              </div>

              {/* Rules */}
              <div className="space-y-2">
                {confluenceRules.map((rule, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 w-4 text-right">{idx + 1}.</span>
                    <select
                      value={rule.pattern}
                      onChange={e => updateRule(idx, 'pattern', e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-slate-700/60 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="">Select pattern...</option>
                      {patternOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-slate-500">on</span>
                    <select
                      value={rule.timeframe}
                      onChange={e => updateRule(idx, 'timeframe', e.target.value)}
                      className="w-20 px-2 py-1.5 bg-slate-700/60 border border-slate-600 rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="">TF...</option>
                      {timeframeOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button onClick={() => removeRule(idx)}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1" title="Remove rule">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              {/* Add rule */}
              <button onClick={addRule}
                className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add another pattern
              </button>

              {/* Status */}
              {activeRules.length < 2 && (
                <div className="text-[11px] text-slate-500 italic">Select at least 2 complete rules to search</div>
              )}

              {/* Results */}
              {activeRules.length >= 2 && confluenceResults && (
                <div className="border-t border-slate-700/50 pt-3 space-y-2">
                  <div className="text-xs text-slate-400">
                    <span className="text-purple-400 font-bold">{confluenceResults.length}</span> stock{confluenceResults.length !== 1 ? 's' : ''} match all {activeRules.length} rules
                  </div>

                  {confluenceResults.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {confluenceResults.map(stock => (
                        <div key={stock.scripCode} className="bg-slate-900/50 border border-purple-500/20 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <Link to={`/stock/${stock.scripCode}`}
                              className="text-sm font-semibold text-white hover:text-purple-400 transition-colors">
                              {stock.companyName}
                            </Link>
                            <span className="font-mono text-[10px] text-slate-500">{stock.scripCode}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {stock.matched.map((m, i) => {
                              const pInfo = getPatternInfo(m.rule.pattern)
                              const isBull = m.signal.direction === 'BULLISH'
                              const isBear = m.signal.direction === 'BEARISH'
                              return (
                                <div key={i} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border ${
                                  isBull ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                  : isBear ? 'bg-red-500/10 border-red-500/20 text-red-400'
                                  : 'bg-slate-500/10 border-slate-500/20 text-slate-400'
                                }`}>
                                  <span>{pInfo.icon}</span>
                                  <span className="font-medium">{m.rule.pattern.replace(/_/g, ' ')}</span>
                                  <span className="text-slate-500">|</span>
                                  <span className="font-mono">{m.rule.timeframe}</span>
                                  <span className="text-slate-500">|</span>
                                  <span>{isBull ? '\u2191' : isBear ? '\u2193' : '\u2212'}</span>
                                  <span className="font-mono">{((m.signal.confidence || 0) * 100).toFixed(0)}%</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-slate-500 text-xs">No stocks match all rules</div>
                  )}
                </div>
              )}
            </div>
          )}
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

      {/* Main Content: Grouped Pattern Cards + Detail Panel */}
      {view !== 'stats' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Grouped Stock Cards */}
          <div className="xl:col-span-2 space-y-2 max-h-[calc(100vh-380px)] overflow-y-auto pr-2">
            {stockGroups.length > 0 ? (
              stockGroups.map(group => {
                const isSelected = selectedGroup === group.scripCode
                const { confluence } = group

                // Border glow based on highest-TF direction
                const htfDir = group.tfGroups[0]?.[1][0]?.direction
                const borderGlow = htfDir === 'BULLISH'
                  ? 'border-green-500/20 hover:border-green-500/40'
                  : htfDir === 'BEARISH'
                    ? 'border-red-500/20 hover:border-red-500/40'
                    : 'border-slate-700/30 hover:border-slate-600/50'

                return (
                  <div
                    key={group.scripCode}
                    onClick={() => setSelectedGroup(group.scripCode)}
                    className={`bg-slate-800/90 backdrop-blur-sm border rounded-2xl p-4 cursor-pointer transition-all duration-200 hover:shadow-lg ${
                      isSelected
                        ? 'border-amber-500/50 bg-slate-800 shadow-amber-500/10 shadow-lg'
                        : borderGlow
                    }`}
                  >
                    {/* Header: Ticker + Exchange + TF count + pattern count */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link to={`/stock/${group.scripCode}`} onClick={e => e.stopPropagation()}
                          className="text-base font-bold text-white hover:text-amber-400 transition-colors truncate">
                          {group.ticker}
                        </Link>
                        {(() => {
                          const ex = group.patterns[0]?.exchange
                          const label = ex ? EXCHANGE_LABELS[ex] || ex : null
                          return label ? (
                            <span className="px-1.5 py-0.5 bg-slate-700/60 rounded text-[9px] text-slate-400 font-bold flex-shrink-0">
                              {label}
                            </span>
                          ) : null
                        })()}
                        <span className="font-mono text-[10px] text-slate-500 flex-shrink-0">{group.scripCode}</span>
                      </div>
                      {(() => {
                        const s = group.strengthScore
                        const color = s >= 70 ? 'text-emerald-400' : s >= 40 ? 'text-amber-400' : s > 0 ? 'text-red-400' : 'text-slate-500'
                        const bg = s >= 70 ? 'bg-emerald-500/15' : s >= 40 ? 'bg-amber-500/15' : s > 0 ? 'bg-red-500/15' : 'bg-slate-700/30'
                        return (
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${bg} flex-shrink-0 ml-2`}>
                            <span className={`text-sm font-bold font-mono ${color}`}>{s}</span>
                            <span className="text-[9px] text-slate-500">/100</span>
                          </div>
                        )
                      })()}
                    </div>

                    {/* Confluence verdict */}
                    {confluence.type !== 'none' && (
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold mb-3 ${
                        confluence.type === 'strong'
                          ? confluence.dominantDir === 'BULLISH'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                          : confluence.type === 'divergent'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        {confluence.type === 'strong' ? '\u2713' : '\u26A0\uFE0F'}
                        {' '}{confluence.label}
                      </div>
                    )}

                    {/* Per-TF rows */}
                    <div className="space-y-2">
                      {group.tfGroups.map(([tf, tfPats]) => {
                        const tfDir = tfPats[0]?.direction
                        const isBull = tfDir === 'BULLISH'
                        const isBear = tfDir === 'BEARISH'
                        // Check if ALL patterns in this TF are expired
                        const allExpired = tfPats.every(p => isPatternExpired(p))
                        // Use first pattern for price levels (same direction = same SL/targets)
                        const rep = tfPats[0]
                        const sl = fmtLevel(rep.stopLoss)
                        const t1 = fmtLevel(rep.target1)
                        const rr = rep.riskRewardRatio || 0
                        const latestTs = tfPats.reduce((latest, p) => {
                          const t = new Date(p.triggeredAt).getTime()
                          return t > latest ? t : latest
                        }, 0)

                        return (
                          <div key={tf} className={`bg-slate-900/40 rounded-lg p-2.5 transition-opacity ${allExpired ? 'opacity-40' : ''}`}>
                            {/* TF header: badge + direction + pattern pills + timestamp */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold min-w-[32px] text-center ${
                                allExpired ? 'bg-slate-700/40 text-slate-500' : 'bg-slate-700/80 text-slate-200'
                              }`}>
                                {tf}
                              </span>
                              <span className={`text-sm font-bold ${
                                allExpired ? 'text-slate-500'
                                : isBull ? 'text-emerald-400' : isBear ? 'text-red-400' : 'text-slate-400'
                              }`}>
                                {isBull ? '\u2191' : isBear ? '\u2193' : '\u2212'}
                              </span>
                              {/* Pattern pills */}
                              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                                {tfPats.map((p, i) => {
                                  const pInfo = getPatternInfo(p.patternType)
                                  const expired = isPatternExpired(p)
                                  return (
                                    <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      expired
                                        ? 'bg-slate-700/30 text-slate-500'
                                        : `${colorClasses[pInfo.color]?.bg} ${colorClasses[pInfo.color]?.text}`
                                    }`}>
                                      {pInfo.icon} {p.patternType?.replace(/_/g, ' ')} {((p.confidence || 0) * 100).toFixed(0)}%
                                    </span>
                                  )
                                })}
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {allExpired && (
                                  <span className="text-[9px] text-slate-500 bg-slate-700/40 rounded px-1 py-0.5">expired</span>
                                )}
                                <span className="text-[10px] text-slate-500 font-mono">
                                  {latestTs > 0 ? fmtIST(new Date(latestTs).toISOString()) : '-'}
                                </span>
                              </div>
                            </div>
                            {/* Compact price line */}
                            <div className={`flex items-center gap-3 mt-1.5 text-[10px] font-mono ${allExpired ? 'text-slate-600' : ''}`}>
                              <span className={allExpired ? 'text-slate-600' : 'text-slate-400'}>
                                Entry <span className={allExpired ? 'text-slate-500 font-semibold' : 'text-white font-semibold'}>{fmt(rep.entryPrice)}</span>
                              </span>
                              <span className={allExpired ? 'text-slate-600' : sl.status === 'ok' ? 'text-red-400/80' : 'text-slate-500'}>
                                SL <span className="font-semibold">{sl.text}</span>
                              </span>
                              <span className={allExpired ? 'text-slate-600' : t1.status === 'ok' ? 'text-emerald-400/80' : 'text-slate-500'}>
                                T1 <span className="font-semibold">{t1.text}</span>
                              </span>
                              <span className={allExpired ? 'text-slate-600' : `${
                                rr >= 1.5 ? 'text-green-400' : rr >= 1 ? 'text-amber-400' : 'text-slate-500'
                              }`}>
                                RR <span className="font-semibold">{rr > 0 ? `1:${rr.toFixed(1)}` : 'DM'}</span>
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* BUY CTA — only shown when active patterns with SL+T1 exist */}
                    {(() => {
                      const bestBuy = group.patterns
                        .filter(p => !isPatternExpired(p) && p.stopLoss && p.target1 && p.confidence >= 0.6)
                        .sort((a, b) => b.confidence - a.confidence)[0]
                      if (!bestBuy) return null

                      const status = buyStatus[group.scripCode] || 'idle'
                      const volOk = bestBuy.volumeConfirmed
                      const regimeAvoid = bestBuy.tradingMode === 'AVOID'
                      const spreadWarn = (bestBuy.spreadImpactPct || 0) > 30
                      const slLabel = bestBuy.slSource === 'ATR' ? 'ATR' : bestBuy.slSource === 'PIVOT' ? 'PVT' : ''

                      return (
                        <div className="mt-2 pt-2 border-t border-slate-700/30 flex items-center gap-2">
                          {/* Volume + Regime badges */}
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${volOk ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                            {volOk ? 'VOL OK' : 'NO VOL'}
                          </span>
                          {bestBuy.marketRegime && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${regimeAvoid ? 'bg-red-500/15 text-red-400' : 'bg-slate-700/50 text-slate-400'}`}>
                              {bestBuy.marketRegime?.replace('_', ' ').substring(0, 12)}
                            </span>
                          )}
                          {slLabel && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400 font-mono">
                              SL:{slLabel}
                            </span>
                          )}
                          {spreadWarn && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                              Wide spread
                            </span>
                          )}

                          <button
                            onClick={e => { e.stopPropagation(); handleBuyPattern(group.scripCode, group.patterns) }}
                            disabled={!volOk || status === 'sending'}
                            className={`ml-auto px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                              status === 'filled' ? 'bg-emerald-500/20 text-emerald-400 cursor-default' :
                              status === 'error' ? 'bg-red-500/20 text-red-400 cursor-default' :
                              status === 'sending' ? 'bg-amber-500/20 text-amber-400 animate-pulse' :
                              !volOk ? 'bg-slate-700/30 text-slate-600 cursor-not-allowed' :
                              'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 active:scale-95'
                            }`}
                          >
                            {status === 'filled' ? 'FILLED' : status === 'error' ? (volOk ? 'FAILED' : 'NO VOL') : status === 'sending' ? 'SENDING...' : 'BUY'}
                          </button>
                        </div>
                      )
                    })()}

                    {/* Outcome for any completed patterns in group */}
                    {group.patterns.some(p => p.status?.includes('COMPLETED') && p.actualPnl !== undefined) && (
                      <div className="mt-2 pt-2 border-t border-slate-700/30 flex items-center gap-4 text-xs">
                        {group.patterns.filter(p => p.status?.includes('COMPLETED') && p.actualPnl !== undefined).map((p, i) => (
                          <span key={i} className={`font-mono font-bold ${(p.actualPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {p.patternType?.replace(/_/g, ' ')}: {(p.actualPnl || 0) >= 0 ? '+' : ''}{fmt(p.actualPnl, 0)}
                          </span>
                        ))}
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

          {/* Detail Panel — sticky scroll container */}
          <div className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
            {selectedGroupData ? (
              <GroupDetailPanel group={selectedGroupData} />
            ) : (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center">
                <div className="text-5xl mb-4">{'\u{1F4CA}'}</div>
                <div className="text-slate-400 mb-2">Select a stock</div>
                <div className="text-xs text-slate-500">Click any card to view multi-TF analysis</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Group Detail Panel ─────────────────────────────────────────────────────

/** Build chronological inference: what does the sequence of patterns over time tell us? */
function getChronoInference(allPatterns: PatternSignal[]): string {
  // Sort all patterns by timestamp, most recent first
  const sorted = [...allPatterns]
    .filter(p => p.triggeredAt)
    .sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime())

  if (sorted.length === 0) return ''
  if (sorted.length === 1) {
    const p = sorted[0]
    return `Only one signal: ${p.patternType?.replace(/_/g, ' ')} on ${normalizeTf(p.timeframe || '')} at ${fmtIST(p.triggeredAt)}. Insufficient data for trend progression.`
  }

  const active = sorted.filter(p => !isPatternExpired(p))
  const expired = sorted.filter(p => isPatternExpired(p))

  // Check if recent signals are building in the same direction (momentum building)
  const recentDirs = active.slice(0, 3).map(p => p.direction).filter(d => d !== 'NEUTRAL')
  const allSameRecent = recentDirs.length >= 2 && new Set(recentDirs).size === 1

  // Check if direction flipped from expired to active (reversal in progress)
  const expiredDir = expired[0]?.direction
  const activeDir = active[0]?.direction
  const flipped = expiredDir && activeDir && expiredDir !== 'NEUTRAL' && activeDir !== 'NEUTRAL' && expiredDir !== activeDir

  const parts: string[] = []

  if (active.length === 0) {
    parts.push('All signals expired. No active patterns to act on.')
  } else if (flipped) {
    parts.push(`Direction shifted from ${expiredDir?.toLowerCase()} to ${activeDir?.toLowerCase()} in recent candles — possible reversal in progress.`)
  } else if (allSameRecent) {
    const dir = recentDirs[0].toLowerCase()
    parts.push(`Last ${recentDirs.length} active signals are all ${dir} — momentum building.`)
  } else if (active.length >= 2) {
    parts.push(`${active.length} active signals across timeframes. Mixed directions suggest indecision — wait for clarity.`)
  }

  if (expired.length > 0 && active.length > 0) {
    parts.push(`${expired.length} earlier signal${expired.length > 1 ? 's' : ''} expired. The latest active signal is ${active[0].patternType?.replace(/_/g, ' ')} on ${normalizeTf(active[0].timeframe || '')} at ${fmtIST(active[0].triggeredAt)}.`)
  }

  return parts.join(' ')
}

/** Build MTF inference: crisp bullet-point summary */
function getMtfInference(confluence: ConfluenceResult, tfGroups: [string, PatternSignal[]][]): string[] {
  const bullets: string[] = []
  const activeTfGroups = tfGroups.filter(([, pats]) => pats.some(p => !isPatternExpired(p)))
  const expiredTfGroups = tfGroups.filter(([, pats]) => pats.every(p => isPatternExpired(p)))

  if (activeTfGroups.length === 0) {
    bullets.push('No active signals across any timeframe.')
    return bullets
  }

  // HTF anchor
  const htf = activeTfGroups[0]
  if (htf) {
    const [tf, pats] = htf
    const dir = pats[0]?.direction || 'NEUTRAL'
    bullets.push(`${TF_LABELS[tf] || tf} anchor: ${dir.toLowerCase()} (${pats.map(p => p.patternType?.replace(/_/g, ' ')).join(', ')})`)
  }

  // Confluence
  if (confluence.type === 'strong') {
    bullets.push(`${activeTfGroups.length} TFs aligned ${confluence.dominantDir.toLowerCase()} — high-conviction setup`)
  } else if (confluence.type === 'divergent') {
    bullets.push(`HTF diverges from lower TFs — trade with caution, HTF carries more weight`)
  } else if (confluence.type === 'conflicting') {
    bullets.push(`Conflicting signals across TFs — avoid new positions until alignment`)
  }

  // Best R:R from active patterns
  const activePatterns = tfGroups.flatMap(([, pats]) => pats).filter(p => !isPatternExpired(p))
  const bestRR = activePatterns.filter(p => p.riskRewardRatio && p.riskRewardRatio > 0)
    .sort((a, b) => (b.riskRewardRatio || 0) - (a.riskRewardRatio || 0))[0]
  if (bestRR) {
    bullets.push(`Best R:R 1:${(bestRR.riskRewardRatio || 0).toFixed(1)} on ${normalizeTf(bestRR.timeframe || '')} — Entry ${fmt(bestRR.entryPrice)}, SL ${fmtLevel(bestRR.stopLoss).text}, T1 ${fmtLevel(bestRR.target1).text}`)
  }

  // Expired note
  if (expiredTfGroups.length > 0) {
    bullets.push(`${expiredTfGroups.length} TF${expiredTfGroups.length > 1 ? 's' : ''} expired (${expiredTfGroups.map(([tf]) => tf).join(', ')}) — no longer actionable`)
  }

  return bullets
}

function GroupDetailPanel({ group }: { group: StockGroup }) {
  const { confluence, tfGroups } = group
  const mtfBullets = getMtfInference(confluence, tfGroups)
  const chronoInference = getChronoInference(group.patterns)

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Link to={`/stock/${group.scripCode}`} className="text-lg font-bold text-white hover:text-amber-400">
                {group.ticker}
              </Link>
              {(() => {
                const ex = group.patterns[0]?.exchange
                const label = ex ? EXCHANGE_LABELS[ex] || ex : null
                return label ? (
                  <span className="px-1.5 py-0.5 bg-slate-700/60 rounded text-[9px] text-slate-400 font-bold">
                    {label}
                  </span>
                ) : null
              })()}
            </div>
            <div className="text-xs text-slate-400 font-mono">{group.scripCode}</div>
          </div>
          {(() => {
            const s = group.strengthScore
            const color = s >= 70 ? 'text-emerald-400' : s >= 40 ? 'text-amber-400' : s > 0 ? 'text-red-400' : 'text-slate-500'
            const bg = s >= 70 ? 'bg-emerald-500/15' : s >= 40 ? 'bg-amber-500/15' : s > 0 ? 'bg-red-500/15' : 'bg-slate-700/30'
            const label = s >= 70 ? 'Strong' : s >= 40 ? 'Moderate' : s > 0 ? 'Weak' : 'Expired'
            return (
              <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg ${bg}`}>
                <span className={`text-xl font-bold font-mono ${color}`}>{s}</span>
                <span className="text-[9px] text-slate-500">{label}</span>
              </div>
            )
          })()}
        </div>

        {/* Confluence verdict */}
        {confluence.type !== 'none' && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold mb-3 ${
            confluence.type === 'strong'
              ? confluence.dominantDir === 'BULLISH'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                : 'bg-red-500/15 text-red-400 border border-red-500/20'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}>
            {confluence.type === 'strong' ? '\u2713' : '\u26A0\uFE0F'}
            {' '}{confluence.label}
          </div>
        )}

        <Link to={`/stock/${group.scripCode}`}
          className="block w-full py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-center rounded-lg font-medium hover:from-blue-600 hover:to-indigo-700 transition-all text-sm">
          View Stock Analysis
        </Link>
      </div>

      {/* Inference: MTF + Chronological */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-3">
        {/* MTF Inference */}
        <div>
          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Multi-TF Inference</h3>
          <ul className="space-y-1">
            {mtfBullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] leading-snug">
                <span className="text-slate-500 mt-0.5">{'\u2022'}</span>
                <span className="text-slate-200">{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Chronological Inference */}
        {chronoInference && (
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Timeline Inference</h3>
            <p className="text-[11px] text-slate-300 leading-snug pl-3">{chronoInference}</p>
          </div>
        )}
      </div>

      {/* Per-Timeframe Breakdown — compact, chronological within each TF */}
      {tfGroups.map(([tf, tfPats]) => {
        // Sort within TF: active first (most recent), then expired (most recent)
        const sorted = [...tfPats].sort((a, b) => {
          const aExp = isPatternExpired(a) ? 1 : 0
          const bExp = isPatternExpired(b) ? 1 : 0
          if (aExp !== bExp) return aExp - bExp  // active first
          return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()  // newest first
        })

        const activeCount = sorted.filter(p => !isPatternExpired(p)).length
        const allExpired = activeCount === 0
        const tfDir = sorted.find(p => !isPatternExpired(p))?.direction || sorted[0]?.direction
        const isBull = tfDir === 'BULLISH'
        const isBear = tfDir === 'BEARISH'

        // Representative pattern for price levels (most recent active, or most recent overall)
        const rep = sorted.find(p => !isPatternExpired(p)) || sorted[0]

        return (
          <div key={tf} className={`bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 ${allExpired ? 'opacity-40' : ''}`}>
            {/* TF Header row */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${allExpired ? 'bg-slate-700/40 text-slate-500' : 'bg-slate-700 text-white'}`}>{tf}</span>
                <span className={`text-[11px] font-semibold ${
                  allExpired ? 'text-slate-500' : isBull ? 'text-emerald-400' : isBear ? 'text-red-400' : 'text-slate-400'
                }`}>
                  {isBull ? '\u2191 BULL' : isBear ? '\u2193 BEAR' : '\u2212 NTRL'}
                </span>
                {allExpired && <span className="text-[9px] text-slate-500 bg-slate-700/40 rounded px-1 py-0.5">expired</span>}
              </div>
              <span className="text-[9px] text-slate-500">{activeCount}/{sorted.length} active</span>
            </div>

            {/* Pattern rows — compact single-line each */}
            <div className="space-y-1 mb-2">
              {sorted.map((p, i) => {
                const pInfo = getPatternInfo(p.patternType)
                const expired = isPatternExpired(p)
                const conf = p.confidence || 0
                return (
                  <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] ${
                    expired ? 'bg-slate-900/20 text-slate-500' : 'bg-slate-900/40'
                  }`}>
                    <span className="flex-shrink-0">{pInfo.icon}</span>
                    <span className={`font-medium truncate ${expired ? 'text-slate-500' : colorClasses[pInfo.color]?.text}`}>
                      {p.patternType?.replace(/_/g, ' ')}
                    </span>
                    <span className={`font-mono font-bold flex-shrink-0 ${
                      expired ? 'text-slate-600' : conf >= 0.7 ? 'text-emerald-400' : conf >= 0.4 ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {(conf * 100).toFixed(0)}%
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-slate-500 flex-shrink-0">
                      {p.triggeredAt ? fmtIST(p.triggeredAt) : '-'}
                    </span>
                    {expired && <span className="text-[8px] text-slate-600 flex-shrink-0">exp</span>}
                  </div>
                )
              })}
            </div>

            {/* Price levels — single compact row */}
            {!allExpired && (
              <div className="flex items-center gap-2 text-[10px] font-mono px-2 py-1.5 bg-slate-900/30 rounded">
                <span className="text-slate-400">E:<span className="text-white font-semibold ml-0.5">{fmt(rep.entryPrice)}</span></span>
                <span className={fmtLevel(rep.stopLoss).status === 'ok' ? 'text-red-400' : 'text-slate-600'}>
                  SL:<span className="font-semibold ml-0.5">{fmtLevel(rep.stopLoss).text}</span>
                </span>
                <span className={fmtLevel(rep.target1).status === 'ok' ? 'text-emerald-400' : 'text-slate-600'}>
                  T1:<span className="font-semibold ml-0.5">{fmtLevel(rep.target1).text}</span>
                </span>
                <span className={fmtLevel(rep.target2).status === 'ok' ? 'text-emerald-400' : 'text-slate-600'}>
                  T2:<span className="font-semibold ml-0.5">{fmtLevel(rep.target2).text}</span>
                </span>
                {(() => {
                  const rr = rep.riskRewardRatio || 0
                  return (
                    <span className={`ml-auto ${rr >= 1.5 ? 'text-green-400' : rr >= 1 ? 'text-amber-400' : 'text-slate-500'}`}>
                      RR:<span className="font-semibold ml-0.5">{rr > 0 ? `1:${rr.toFixed(1)}` : 'DM'}</span>
                    </span>
                  )
                })()}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
