/**
 * Single source of truth for strategy colors, types, and display helpers.
 * All components must import from here instead of defining inline color maps.
 *
 * Canonical color assignments:
 *   FUDKII = amber, FUKAA = orange, FUDKOI = teal, PIVOT = blue,
 *   MICROALPHA = purple, MERE = rose, QUANT = cyan, MANUAL = slate
 */

export type StrategyKey = 'FUDKII' | 'FUKAA' | 'FUDKOI' | 'PIVOT' | 'PIVOT_CONFLUENCE' | 'MICROALPHA' | 'MERE' | 'QUANT' | 'MCX-BB' | 'MCX-BBT+1' | 'MCX_BB' | 'MCX_BBT1' | 'MANUAL'
export type StrategyFilter = 'ALL' | StrategyKey

export interface StrategyColorSet {
  border: string
  bg: string
  text: string
  accent: string
  badgeBg: string
  badgeText: string
  badgeBorder: string
}

export const STRATEGY_COLORS: Record<string, StrategyColorSet> = {
  FUDKII:           { border: 'border-amber-500/40',  bg: 'bg-amber-500/10',  text: 'text-amber-400',  accent: 'from-amber-500 to-amber-600',  badgeBg: 'bg-amber-500/15',  badgeText: 'text-amber-400',  badgeBorder: 'border-amber-500/30' },
  FUKAA:            { border: 'border-orange-500/40', bg: 'bg-orange-500/10', text: 'text-orange-400', accent: 'from-orange-500 to-orange-600', badgeBg: 'bg-orange-500/15', badgeText: 'text-orange-400', badgeBorder: 'border-orange-500/30' },
  FUDKOI:           { border: 'border-teal-500/40',   bg: 'bg-teal-500/10',   text: 'text-teal-400',   accent: 'from-teal-500 to-teal-600',   badgeBg: 'bg-teal-500/15',   badgeText: 'text-teal-400',   badgeBorder: 'border-teal-500/30' },
  PIVOT:            { border: 'border-blue-500/40',   bg: 'bg-blue-500/10',   text: 'text-blue-400',   accent: 'from-blue-500 to-blue-600',   badgeBg: 'bg-blue-500/15',   badgeText: 'text-blue-400',   badgeBorder: 'border-blue-500/30' },
  PIVOT_CONFLUENCE: { border: 'border-blue-500/40',   bg: 'bg-blue-500/10',   text: 'text-blue-400',   accent: 'from-blue-500 to-blue-600',   badgeBg: 'bg-blue-500/15',   badgeText: 'text-blue-400',   badgeBorder: 'border-blue-500/30' },
  MICROALPHA:       { border: 'border-purple-500/40', bg: 'bg-purple-500/10', text: 'text-purple-400', accent: 'from-purple-500 to-purple-600', badgeBg: 'bg-purple-500/15', badgeText: 'text-purple-400', badgeBorder: 'border-purple-500/30' },
  MERE:             { border: 'border-rose-500/40',   bg: 'bg-rose-500/10',   text: 'text-rose-400',   accent: 'from-rose-500 to-rose-600',   badgeBg: 'bg-rose-500/15',   badgeText: 'text-rose-400',   badgeBorder: 'border-rose-500/30' },
  QUANT:            { border: 'border-cyan-500/40',   bg: 'bg-cyan-500/10',   text: 'text-cyan-400',   accent: 'from-cyan-500 to-cyan-600',   badgeBg: 'bg-cyan-500/15',   badgeText: 'text-cyan-400',   badgeBorder: 'border-cyan-500/30' },
  'MCX-BB':         { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400', accent: 'from-emerald-500 to-emerald-600', badgeBg: 'bg-emerald-500/15', badgeText: 'text-emerald-400', badgeBorder: 'border-emerald-500/30' },
  'MCX-BBT+1':      { border: 'border-cyan-500/40',    bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    accent: 'from-cyan-500 to-teal-600',    badgeBg: 'bg-cyan-500/15',    badgeText: 'text-cyan-400',    badgeBorder: 'border-cyan-500/30' },
  // Aliases for canonical keys (backward compat)
  MCX_BB:           { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400', accent: 'from-emerald-500 to-emerald-600', badgeBg: 'bg-emerald-500/15', badgeText: 'text-emerald-400', badgeBorder: 'border-emerald-500/30' },
  MCX_BBT1:         { border: 'border-cyan-500/40',    bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    accent: 'from-cyan-500 to-teal-600',    badgeBg: 'bg-cyan-500/15',    badgeText: 'text-cyan-400',    badgeBorder: 'border-cyan-500/30' },
  MANUAL:           { border: 'border-slate-500/40',  bg: 'bg-slate-500/10',  text: 'text-slate-400',  accent: 'from-slate-500 to-slate-600',  badgeBg: 'bg-slate-500/15',  badgeText: 'text-slate-400',  badgeBorder: 'border-slate-500/30' },
}

const DEFAULT_COLORS: StrategyColorSet = STRATEGY_COLORS.MANUAL

/** Get the full color set for a strategy key. */
export function getStrategyColors(strategy?: string | null): StrategyColorSet {
  if (!strategy) return DEFAULT_COLORS
  return STRATEGY_COLORS[strategy] ?? DEFAULT_COLORS
}

/** Get badge classes for inline strategy badge (PositionCard, trade rows, etc.) */
export function getStrategyBadgeClass(strategy?: string | null): string {
  const c = getStrategyColors(strategy)
  return `${c.badgeBg} ${c.badgeText} border ${c.badgeBorder}`
}

/** Get text color class for strategy name in text contexts (journal, P&L). */
export function getStrategyTextColor(strategy?: string | null): string {
  return getStrategyColors(strategy).text
}

/** Filter options for strategy filter bars (includes ALL). */
export const STRATEGY_FILTER_OPTIONS: { value: StrategyFilter; label: string; color: string }[] = [
  { value: 'ALL',          label: 'All',        color: 'bg-blue-600 text-white' },
  { value: 'FUDKII',      label: 'FUDKII',     color: `${STRATEGY_COLORS.FUDKII.badgeBg} ${STRATEGY_COLORS.FUDKII.badgeText} border ${STRATEGY_COLORS.FUDKII.badgeBorder}` },
  { value: 'FUKAA',       label: 'FUKAA',      color: `${STRATEGY_COLORS.FUKAA.badgeBg} ${STRATEGY_COLORS.FUKAA.badgeText} border ${STRATEGY_COLORS.FUKAA.badgeBorder}` },
  { value: 'FUDKOI',      label: 'FUDKOI',     color: `${STRATEGY_COLORS.FUDKOI.badgeBg} ${STRATEGY_COLORS.FUDKOI.badgeText} border ${STRATEGY_COLORS.FUDKOI.badgeBorder}` },
  { value: 'PIVOT',       label: 'PIVOT',      color: `${STRATEGY_COLORS.PIVOT.badgeBg} ${STRATEGY_COLORS.PIVOT.badgeText} border ${STRATEGY_COLORS.PIVOT.badgeBorder}` },
  { value: 'MICROALPHA',  label: 'MICRO',      color: `${STRATEGY_COLORS.MICROALPHA.badgeBg} ${STRATEGY_COLORS.MICROALPHA.badgeText} border ${STRATEGY_COLORS.MICROALPHA.badgeBorder}` },
  { value: 'MERE',        label: 'MERE',       color: `${STRATEGY_COLORS.MERE.badgeBg} ${STRATEGY_COLORS.MERE.badgeText} border ${STRATEGY_COLORS.MERE.badgeBorder}` },
  { value: 'QUANT',       label: 'QUANT',      color: `${STRATEGY_COLORS.QUANT.badgeBg} ${STRATEGY_COLORS.QUANT.badgeText} border ${STRATEGY_COLORS.QUANT.badgeBorder}` },
  { value: 'MCX-BB',     label: 'MCX-BB',     color: `${STRATEGY_COLORS['MCX-BB'].badgeBg} ${STRATEGY_COLORS['MCX-BB'].badgeText} border ${STRATEGY_COLORS['MCX-BB'].badgeBorder}` },
  { value: 'MCX-BBT+1', label: 'MCX-BBT+1',  color: `${STRATEGY_COLORS['MCX-BBT+1'].badgeBg} ${STRATEGY_COLORS['MCX-BBT+1'].badgeText} border ${STRATEGY_COLORS['MCX-BBT+1'].badgeBorder}` },
]
