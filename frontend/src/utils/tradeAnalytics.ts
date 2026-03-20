import type { StrategyWalletTrade } from '../services/api'

// ── Formatters ──

export const fmt = (v: number, d = 2) => v.toFixed(d)

export const fmtINR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)

export const fmtINRShort = (v: number) => {
  const abs = Math.abs(v)
  if (abs >= 100000) return `${(abs / 100000).toFixed(1)}L`
  if (abs >= 1000) return `${(abs / 1000).toFixed(0)}K`
  return `${abs.toFixed(0)}`
}

export const fmtDuration = (mins?: number | null) => {
  if (!mins) return 'DM'
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
}

// ── Analytics types ──

export type AnalyticsResult = ReturnType<typeof computeAnalytics>
export type AdvancedAnalyticsResult = ReturnType<typeof computeAdvancedAnalytics>

// ── Compute analytics from a list of trades ──

export function computeAnalytics(trades: StrategyWalletTrade[]) {
  const closed = trades.filter(t => t.exitTime)
  if (closed.length === 0) return null
  const wins = closed.filter(t => t.pnl > 0)
  const losses = closed.filter(t => t.pnl < 0)
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0)
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
  const profitFactor = Math.abs(avgLoss) > 0 ? (wins.reduce((s, t) => s + t.pnl, 0)) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0)) : wins.length > 0 ? Infinity : 0
  const avgR = closed.reduce((s, t) => s + (t.rMultiple ?? (t as any).rmultiple ?? 0), 0) / closed.length
  const bestTrade = closed.reduce((best, t) => t.pnl > best.pnl ? t : best, closed[0])
  const worstTrade = closed.reduce((worst, t) => t.pnl < worst.pnl ? t : worst, closed[0])
  const avgDuration = closed.reduce((s, t) => s + (t.durationMinutes ?? 0), 0) / closed.length

  // Max drawdown
  let peak = 0, maxDD = 0, cumPnl = 0
  const sorted = [...closed].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
  for (const t of sorted) {
    cumPnl += t.pnl
    if (cumPnl > peak) peak = cumPnl
    const dd = peak - cumPnl
    if (dd > maxDD) maxDD = dd
  }

  // By direction (use direction field; only fall back to side when direction is missing)
  const bullish = closed.filter(t => t.direction ? t.direction === 'BULLISH' : t.side === 'LONG')
  const bearish = closed.filter(t => t.direction ? t.direction === 'BEARISH' : t.side === 'SHORT')
  const byDirection = {
    bullish: { count: bullish.length, pnl: bullish.reduce((s, t) => s + t.pnl, 0), winRate: bullish.length > 0 ? (bullish.filter(t => t.pnl > 0).length / bullish.length) * 100 : 0 },
    bearish: { count: bearish.length, pnl: bearish.reduce((s, t) => s + t.pnl, 0), winRate: bearish.length > 0 ? (bearish.filter(t => t.pnl > 0).length / bearish.length) * 100 : 0 },
  }

  // By exchange
  const byExchange: Record<string, { count: number; pnl: number; winRate: number }> = {}
  for (const ex of ['N', 'M', 'C']) {
    const exTrades = closed.filter(t => t.exchange === ex)
    if (exTrades.length > 0) {
      byExchange[ex] = { count: exTrades.length, pnl: exTrades.reduce((s, t) => s + t.pnl, 0), winRate: (exTrades.filter(t => t.pnl > 0).length / exTrades.length) * 100 }
    }
  }

  // By instrument type
  const byInstrument: Record<string, { count: number; pnl: number; winRate: number }> = {}
  for (const inst of ['OPTIONS', 'FUTURES', 'EQUITY']) {
    const instTrades = closed.filter(t => (t.instrumentType ?? 'EQUITY') === inst || (!t.instrumentType && inst === 'EQUITY'))
    if (instTrades.length > 0) {
      byInstrument[inst] = { count: instTrades.length, pnl: instTrades.reduce((s, t) => s + t.pnl, 0), winRate: (instTrades.filter(t => t.pnl > 0).length / instTrades.length) * 100 }
    }
  }

  // By confidence band — adaptive: if confidence has no variation, show duration + capital bands instead
  const byConfidence: { band: string; count: number; pnl: number; winRate: number; avgPnl: number }[] = []
  let confidenceBandTitle = 'Confidence Band Performance'

  const confValues = closed.map(t => t.confidence ?? 0).filter(c => c > 0)
  const confHasVariation = confValues.length >= 3 && new Set(confValues.map(v => Math.round(v))).size > 1

  if (confHasVariation) {
    // Normal confidence bands
    const bands = [
      { label: '<60%', min: 0, max: 60 },
      { label: '60-70%', min: 60, max: 70 },
      { label: '70-80%', min: 70, max: 80 },
      { label: '80-90%', min: 80, max: 90 },
      { label: '90%+', min: 90, max: 101 },
    ]
    for (const b of bands) {
      const bandTrades = closed.filter(t => {
        const c = t.confidence ?? 0
        return c >= b.min && c < b.max
      })
      if (bandTrades.length > 0) {
        const pnl = bandTrades.reduce((s, t) => s + t.pnl, 0)
        byConfidence.push({ band: b.label, count: bandTrades.length, pnl, winRate: (bandTrades.filter(t => t.pnl > 0).length / bandTrades.length) * 100, avgPnl: pnl / bandTrades.length })
      }
    }
  } else {
    // Confidence is flat — show duration-based performance bands instead
    confidenceBandTitle = 'Performance by Duration'
    const durBands = [
      { label: '<15m', min: 0, max: 15 },
      { label: '15-60m', min: 15, max: 60 },
      { label: '1-3h', min: 60, max: 180 },
      { label: '3h+', min: 180, max: Infinity },
    ]
    for (const b of durBands) {
      const bandTrades = closed.filter(t => {
        const d = t.durationMinutes ?? 0
        return d >= b.min && d < b.max
      })
      if (bandTrades.length > 0) {
        const pnl = bandTrades.reduce((s, t) => s + t.pnl, 0)
        byConfidence.push({ band: b.label, count: bandTrades.length, pnl, winRate: (bandTrades.filter(t => t.pnl > 0).length / bandTrades.length) * 100, avgPnl: pnl / bandTrades.length })
      }
    }
  }

  // By capital employed (position size bands)
  const byCapital: { band: string; count: number; pnl: number; winRate: number; avgPnl: number }[] = []
  const capValues = closed.map(t => t.capitalEmployed ?? 0).filter(c => c > 0)
  if (capValues.length >= 3) {
    const capSorted = [...capValues].sort((a, b) => a - b)
    const capMedian = capSorted[Math.floor(capSorted.length / 2)]
    const capBands = [
      { label: `<${fmtINRShort(capMedian * 0.5)}`, min: 0, max: capMedian * 0.5 },
      { label: `${fmtINRShort(capMedian * 0.5)}-${fmtINRShort(capMedian)}`, min: capMedian * 0.5, max: capMedian },
      { label: `${fmtINRShort(capMedian)}-${fmtINRShort(capMedian * 2)}`, min: capMedian, max: capMedian * 2 },
      { label: `>${fmtINRShort(capMedian * 2)}`, min: capMedian * 2, max: Infinity },
    ]
    for (const b of capBands) {
      const bandTrades = closed.filter(t => {
        const c = t.capitalEmployed ?? 0
        return c >= b.min && c < b.max
      })
      if (bandTrades.length > 0) {
        const pnl = bandTrades.reduce((s, t) => s + t.pnl, 0)
        byCapital.push({ band: b.label, count: bandTrades.length, pnl, winRate: (bandTrades.filter(t => t.pnl > 0).length / bandTrades.length) * 100, avgPnl: pnl / bandTrades.length })
      }
    }
  }

  // By R-Multiple bands
  const byRBand: { band: string; count: number; pnl: number; winRate: number; avgPnl: number }[] = []
  const rValues = closed.filter(t => (t.rMultiple ?? (t as any).rmultiple) != null).map(t => t.rMultiple ?? (t as any).rmultiple)
  if (rValues.length >= 1) {
    const rBands = [
      { label: '<-1R', min: -Infinity, max: -1 },
      { label: '-1R to 0', min: -1, max: 0 },
      { label: '0 to 1R', min: 0, max: 1 },
      { label: '1R to 2R', min: 1, max: 2 },
      { label: '>2R', min: 2, max: Infinity },
    ]
    for (const b of rBands) {
      const bandTrades = closed.filter(t => {
        const r = t.rMultiple ?? (t as any).rmultiple ?? 0
        return r >= b.min && r < b.max
      })
      if (bandTrades.length > 0) {
        const pnl = bandTrades.reduce((s, t) => s + t.pnl, 0)
        byRBand.push({ band: b.label, count: bandTrades.length, pnl, winRate: (bandTrades.filter(t => t.pnl > 0).length / bandTrades.length) * 100, avgPnl: pnl / bandTrades.length })
      }
    }
  }

  // ── By Entry Hour (IST) ──
  const entryHourMap: Record<string, { count: number; pnl: number; wins: number }> = {}
  for (const t of closed) {
    try {
      const d = new Date(t.entryTime)
      const h = parseInt(d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }))
      const band = `${h}-${h + 1}`
      if (!entryHourMap[band]) entryHourMap[band] = { count: 0, pnl: 0, wins: 0 }
      entryHourMap[band].count++
      entryHourMap[band].pnl += t.pnl
      if (t.pnl > 0) entryHourMap[band].wins++
    } catch { /* skip */ }
  }
  const byEntryHour = Object.entries(entryHourMap).map(([band, d]) => ({
    band, count: d.count, pnl: d.pnl, winRate: (d.wins / d.count) * 100, avgPnl: d.pnl / d.count,
  })).sort((a, b) => parseInt(a.band) - parseInt(b.band))

  // ── By Lots (sub-trades per parent tradeId) ──
  const parentGroups: Record<string, StrategyWalletTrade[]> = {}
  for (const t of closed) {
    const pid = t.tradeId || 'unknown'
    if (!parentGroups[pid]) parentGroups[pid] = []
    parentGroups[pid].push(t)
  }
  const lotBuckets: Record<string, { parentCount: number; subTradeCount: number; pnl: number; wins: number }> = {}
  for (const [, subs] of Object.entries(parentGroups)) {
    const lotCount = Math.min(subs.length, 5)
    const label = lotCount >= 5 ? '5+' : String(lotCount)
    if (!lotBuckets[label]) lotBuckets[label] = { parentCount: 0, subTradeCount: 0, pnl: 0, wins: 0 }
    lotBuckets[label].parentCount++
    lotBuckets[label].subTradeCount += subs.length
    const parentPnl = subs.reduce((s, t) => s + t.pnl, 0)
    lotBuckets[label].pnl += parentPnl
    if (parentPnl > 0) lotBuckets[label].wins++
  }
  // Always show lots 1-4 (and 5+ if present)
  const lotOrder = ['1', '2', '3', '4']
  if (lotBuckets['5+']) lotOrder.push('5+')
  const byLots = lotOrder.map(lots => {
    const d = lotBuckets[lots] || { parentCount: 0, subTradeCount: 0, pnl: 0, wins: 0 }
    return {
      lots: lots === '5+' ? 5 : parseInt(lots), lotsLabel: lots, parentCount: d.parentCount,
      subTradeCount: d.subTradeCount, pnl: d.pnl,
      winRate: d.parentCount > 0 ? (d.wins / d.parentCount) * 100 : 0,
      avgPnl: d.parentCount > 0 ? d.pnl / d.parentCount : 0,
    }
  })

  // ── Target Progression Funnel ──
  const totalParentTrades = Object.keys(parentGroups).length
  const funnelMap: Record<string, { count: number; pnl: number }> = {
    'SL Only': { count: 0, pnl: 0 }, 'T1': { count: 0, pnl: 0 },
    'T2': { count: 0, pnl: 0 }, 'T3': { count: 0, pnl: 0 }, 'T4': { count: 0, pnl: 0 },
  }
  for (const [, subs] of Object.entries(parentGroups)) {
    let maxTarget = 0
    for (const t of subs) {
      if (t.target4Hit) maxTarget = Math.max(maxTarget, 4)
      else if (t.target3Hit) maxTarget = Math.max(maxTarget, 3)
      else if (t.target2Hit) maxTarget = Math.max(maxTarget, 2)
      else if (t.target1Hit) maxTarget = Math.max(maxTarget, 1)
    }
    const level = maxTarget === 0 ? 'SL Only' : `T${maxTarget}`
    funnelMap[level].count++
    funnelMap[level].pnl += subs.reduce((s, t) => s + t.pnl, 0)
  }
  const funnelOrder = ['SL Only', 'T1', 'T2', 'T3', 'T4']
  const targetFunnel = funnelOrder.map(level => {
    const d = funnelMap[level]
    return {
      level, count: d.count, pnl: d.pnl, avgPnl: d.count > 0 ? d.pnl / d.count : 0,
      pctOfTotal: totalParentTrades > 0 ? (d.count / totalParentTrades) * 100 : 0,
    }
  })

  // ── By Day of Week (IST) ──
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayShorts = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayMap: Record<number, { count: number; pnl: number; wins: number }> = {}
  for (const [, subs] of Object.entries(parentGroups)) {
    const first = subs.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime())[0]
    try {
      const d = new Date(first.entryTime)
      const dayStr = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' })
      const dayIdx = dayShorts.indexOf(dayStr.replace('.', ''))
      const idx = dayIdx >= 0 ? dayIdx : d.getDay()
      if (!dayMap[idx]) dayMap[idx] = { count: 0, pnl: 0, wins: 0 }
      dayMap[idx].count++
      const parentPnl = subs.reduce((s, t) => s + t.pnl, 0)
      dayMap[idx].pnl += parentPnl
      if (parentPnl > 0) dayMap[idx].wins++
    } catch { /* skip */ }
  }
  const byDayOfWeek = Object.entries(dayMap).map(([idx, d]) => {
    const i = parseInt(idx)
    return {
      day: dayNames[i], dayShort: dayShorts[i], count: d.count, pnl: d.pnl,
      winRate: (d.wins / d.count) * 100, avgPnl: d.pnl / d.count,
    }
  }).sort((a, b) => dayNames.indexOf(a.day) - dayNames.indexOf(b.day))

  // ── By Premium Range (options only) ──
  const optionTrades = closed.filter(t => (t.instrumentType ?? '').toUpperCase() === 'OPTIONS' || (t.instrumentType ?? '').toUpperCase() === 'OPTION')
  const premiumBands = [
    { label: '<\u20B910', min: 0, max: 10 },
    { label: '\u20B910-50', min: 10, max: 50 },
    { label: '\u20B950-150', min: 50, max: 150 },
    { label: '\u20B9150-500', min: 150, max: 500 },
    { label: '\u20B9500+', min: 500, max: Infinity },
  ]
  const byPremiumRange: { band: string; count: number; pnl: number; winRate: number; avgPnl: number }[] = []
  for (const b of premiumBands) {
    const bt = optionTrades.filter(t => t.entryPrice >= b.min && t.entryPrice < b.max)
    if (bt.length > 0) {
      const pnl = bt.reduce((s, t) => s + t.pnl, 0)
      byPremiumRange.push({ band: b.label, count: bt.length, pnl, winRate: (bt.filter(t => t.pnl > 0).length / bt.length) * 100, avgPnl: pnl / bt.length })
    }
  }

  // ── Premium Erosion / Theta Analysis (options only) ──
  const erosionDurBands = [
    { label: '<15m', min: 0, max: 15 },
    { label: '15-30m', min: 15, max: 30 },
    { label: '30-60m', min: 30, max: 60 },
    { label: '1-2h', min: 60, max: 120 },
    { label: '2-4h', min: 120, max: 240 },
    { label: '4h+', min: 240, max: Infinity },
  ]
  type ErosionBand = { band: string; count: number; avgPremiumChange: number; avgErosionPerHour: number; avgPnl: number; winRate: number }
  type ErosionSummary = {
    avgErosionRate: number; avgWinPremGain: number; avgLossPremLoss: number
    totalOptionTrades: number; avgHoldMinutes: number; medianHoldMinutes: number
    winAvgHoldMin: number; lossAvgHoldMin: number
    sweetSpotBand: string; sweetSpotWR: number
    thetaEdge: number // win premium gain rate vs loss premium loss rate (ratio)
  }
  let premiumErosion: { bands: ErosionBand[]; summary: ErosionSummary } | null = null
  if (optionTrades.length > 0) {
    const tradeErosions = optionTrades.map(t => {
      const premChg = t.entryPrice !== 0 ? ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 : 0
      const dur = t.durationMinutes ?? 0
      const erosionPerHr = dur > 0 ? premChg / (dur / 60) : 0
      return { ...t, premChg, erosionPerHr, dur }
    })
    const erosionBandResults: ErosionBand[] = []
    for (const b of erosionDurBands) {
      const bt = tradeErosions.filter(t => t.dur >= b.min && t.dur < b.max)
      if (bt.length > 0) {
        erosionBandResults.push({
          band: b.label, count: bt.length,
          avgPremiumChange: bt.reduce((s, t) => s + t.premChg, 0) / bt.length,
          avgErosionPerHour: bt.reduce((s, t) => s + t.erosionPerHr, 0) / bt.length,
          avgPnl: bt.reduce((s, t) => s + t.pnl, 0) / bt.length,
          winRate: (bt.filter(t => t.pnl > 0).length / bt.length) * 100,
        })
      }
    }
    const winOpts = tradeErosions.filter(t => t.pnl > 0)
    const lossOpts = tradeErosions.filter(t => t.pnl < 0)
    const durations = tradeErosions.map(t => t.dur).sort((a, b) => a - b)
    const medianDur = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0
    // Sweet spot = band with best combo of win rate and avg pnl
    const sweetSpot = erosionBandResults.length > 0
      ? erosionBandResults.reduce((best, b) => (b.winRate * b.avgPnl) > (best.winRate * best.avgPnl) ? b : best, erosionBandResults[0])
      : null
    const avgWinErosion = winOpts.length > 0 ? winOpts.reduce((s, t) => s + Math.abs(t.erosionPerHr), 0) / winOpts.length : 0
    const avgLossErosion = lossOpts.length > 0 ? lossOpts.reduce((s, t) => s + Math.abs(t.erosionPerHr), 0) / lossOpts.length : 0
    premiumErosion = {
      bands: erosionBandResults,
      summary: {
        avgErosionRate: tradeErosions.reduce((s, t) => s + t.erosionPerHr, 0) / tradeErosions.length,
        avgWinPremGain: winOpts.length > 0 ? winOpts.reduce((s, t) => s + t.premChg, 0) / winOpts.length : 0,
        avgLossPremLoss: lossOpts.length > 0 ? lossOpts.reduce((s, t) => s + t.premChg, 0) / lossOpts.length : 0,
        totalOptionTrades: tradeErosions.length,
        avgHoldMinutes: tradeErosions.reduce((s, t) => s + t.dur, 0) / tradeErosions.length,
        medianHoldMinutes: medianDur,
        winAvgHoldMin: winOpts.length > 0 ? winOpts.reduce((s, t) => s + t.dur, 0) / winOpts.length : 0,
        lossAvgHoldMin: lossOpts.length > 0 ? lossOpts.reduce((s, t) => s + t.dur, 0) / lossOpts.length : 0,
        sweetSpotBand: sweetSpot ? sweetSpot.band : '—',
        sweetSpotWR: sweetSpot ? sweetSpot.winRate : 0,
        thetaEdge: avgLossErosion > 0 ? avgWinErosion / avgLossErosion : 0,
      },
    }
  }

  // By exit reason
  const byExitReason: Record<string, { count: number; pnl: number }> = {}
  for (const t of closed) {
    const reason = t.exitReason || 'UNKNOWN'
    if (!byExitReason[reason]) byExitReason[reason] = { count: 0, pnl: 0 }
    byExitReason[reason].count++
    byExitReason[reason].pnl += t.pnl
  }

  // By strategy (for cross-strategy comparison in ALL view)
  const strategyMap: Record<string, { count: number; pnl: number; wins: number; totalR: number; avgDur: number; totalDur: number }> = {}
  for (const t of closed) {
    const s = t.strategy || 'UNKNOWN'
    if (!strategyMap[s]) strategyMap[s] = { count: 0, pnl: 0, wins: 0, totalR: 0, avgDur: 0, totalDur: 0 }
    strategyMap[s].count++
    strategyMap[s].pnl += t.pnl
    if (t.pnl > 0) strategyMap[s].wins++
    strategyMap[s].totalR += (t.rMultiple ?? (t as any).rmultiple ?? 0)
    strategyMap[s].totalDur += (t.durationMinutes ?? 0)
  }
  const byStrategy = Object.entries(strategyMap).map(([name, d]) => ({
    name,
    count: d.count,
    pnl: d.pnl,
    winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
    avgPnl: d.count > 0 ? d.pnl / d.count : 0,
    avgR: d.count > 0 ? d.totalR / d.count : 0,
    expectancy: d.count > 0 ? d.pnl / d.count : 0,
    profitFactor: (() => {
      const sTrades = closed.filter(t => (t.strategy || 'UNKNOWN') === name)
      const sWins = sTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
      const sLosses = Math.abs(sTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
      return sLosses > 0 ? sWins / sLosses : sWins > 0 ? Infinity : 0
    })(),
    avgDur: d.count > 0 ? d.totalDur / d.count : 0,
    pnlContribution: totalPnl !== 0 ? (d.pnl / Math.abs(totalPnl)) * 100 : 0,
  })).sort((a, b) => b.pnl - a.pnl)

  // Top winners/losers by scrip
  const byScrip: Record<string, { count: number; pnl: number; wins: number }> = {}
  for (const t of closed) {
    const key = t.companyName || t.scripCode
    if (!byScrip[key]) byScrip[key] = { count: 0, pnl: 0, wins: 0 }
    byScrip[key].count++
    byScrip[key].pnl += t.pnl
    if (t.pnl > 0) byScrip[key].wins++
  }
  const topWinners = Object.entries(byScrip).sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 5)
  const topLosers = Object.entries(byScrip).sort((a, b) => a[1].pnl - b[1].pnl).slice(0, 5)

  // By hour of day (IST) -- overall + per-exchange
  const byHour: Record<number, { count: number; pnl: number; wins: number }> = {}
  const byHourExchange: Record<string, Record<number, { count: number; pnl: number; wins: number }>> = { N: {}, M: {}, C: {} }
  for (const t of sorted) {
    try {
      const d = new Date(t.entryTime)
      const istH = parseInt(d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }))
      if (!byHour[istH]) byHour[istH] = { count: 0, pnl: 0, wins: 0 }
      byHour[istH].count++
      byHour[istH].pnl += t.pnl
      if (t.pnl > 0) byHour[istH].wins++
      // Per-exchange
      const ex = t.exchange || 'N'
      if (!byHourExchange[ex]) byHourExchange[ex] = {}
      if (!byHourExchange[ex][istH]) byHourExchange[ex][istH] = { count: 0, pnl: 0, wins: 0 }
      byHourExchange[ex][istH].count++
      byHourExchange[ex][istH].pnl += t.pnl
      if (t.pnl > 0) byHourExchange[ex][istH].wins++
    } catch { /* skip */ }
  }

  // Streak analysis
  let currentStreak = 0, bestStreak = 0, worstStreak = 0, tempStreak = 0
  for (const t of sorted) {
    if (t.pnl > 0) {
      if (tempStreak >= 0) tempStreak++; else tempStreak = 1
    } else {
      if (tempStreak <= 0) tempStreak--; else tempStreak = -1
    }
    if (tempStreak > bestStreak) bestStreak = tempStreak
    if (tempStreak < worstStreak) worstStreak = tempStreak
    currentStreak = tempStreak
  }

  return {
    totalTrades: closed.length, wins: wins.length, losses: losses.length,
    totalPnl, winRate, avgWin, avgLoss, profitFactor, avgR,
    bestTrade, worstTrade, maxDrawdown: maxDD, avgDuration,
    byDirection, byExchange, byInstrument, byConfidence, confidenceBandTitle, byCapital, byRBand, byExitReason,
    topWinners, topLosers, byHour, byHourExchange,
    streaks: { current: currentStreak, best: bestStreak, worst: worstStreak },
    byEntryHour, byLots, targetFunnel, byDayOfWeek, byPremiumRange, premiumErosion, byStrategy,
  }
}

// ── Pearson correlation coefficient ──

export function pearsonCorr(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? null : num / denom
}

// ── Compute correlation matrix and advanced metrics ──

export function computeAdvancedAnalytics(trades: StrategyWalletTrade[]) {
  const closed = trades.filter(t => t.exitTime && t.pnlPercent !== 0)
  if (closed.length < 3) return null

  const metrics = [
    { key: 'confidence', label: 'Confidence', extract: (t: StrategyWalletTrade) => t.confidence },
    { key: 'riskReward', label: 'Risk:Reward', extract: (t: StrategyWalletTrade) => t.riskReward },
    { key: 'atr', label: 'ATR', extract: (t: StrategyWalletTrade) => t.atr },
    { key: 'volumeSurge', label: 'Vol Surge', extract: (t: StrategyWalletTrade) => t.volumeSurge },
    { key: 'oiChangePercent', label: 'OI Change%', extract: (t: StrategyWalletTrade) => t.oiChangePercent },
    { key: 'blockDealPercent', label: 'Block Deal%', extract: (t: StrategyWalletTrade) => t.blockDealPercent },
    { key: 'rMultiple', label: 'R-Multiple', extract: (t: StrategyWalletTrade) => t.rMultiple ?? (t as any).rmultiple },
    { key: 'durationMinutes', label: 'Duration(m)', extract: (t: StrategyWalletTrade) => t.durationMinutes },
  ]

  // Correlation matrix: each metric vs PnL%
  const correlations: { key: string; label: string; corr: number | null; n: number }[] = []
  const scatterData: Record<string, { x: number; y: number; name: string }[]> = {}

  for (const m of metrics) {
    const pairs = closed
      .map(t => ({ x: m.extract(t), y: t.pnlPercent, name: t.companyName || t.scripCode }))
      .filter(p => p.x != null && isFinite(p.x as number)) as { x: number; y: number; name: string }[]

    const corr = pairs.length >= 3 ? pearsonCorr(pairs.map(p => p.x), pairs.map(p => p.y)) : null
    correlations.push({ key: m.key, label: m.label, corr, n: pairs.length })
    if (pairs.length >= 3) scatterData[m.key] = pairs
  }

  // Cross-correlations between all metrics
  const crossCorr: { m1: string; m2: string; corr: number | null }[] = []
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const pairs = closed
        .map(t => ({ x: metrics[i].extract(t), y: metrics[j].extract(t) }))
        .filter(p => p.x != null && p.y != null && isFinite(p.x as number) && isFinite(p.y as number)) as { x: number; y: number }[]
      const c = pairs.length >= 3 ? pearsonCorr(pairs.map(p => p.x), pairs.map(p => p.y)) : null
      crossCorr.push({ m1: metrics[i].key, m2: metrics[j].key, corr: c })
    }
  }

  // Optimal parameter zones: for each metric, bucket into quartiles and show win rate + avg PnL
  const parameterZones: Record<string, { zone: string; count: number; winRate: number; avgPnl: number }[]> = {}
  for (const m of metrics) {
    const valid = closed.filter(t => m.extract(t) != null && isFinite(m.extract(t) as number))
    if (valid.length < 8) continue
    const vals = valid.map(t => m.extract(t) as number).sort((a, b) => a - b)
    const q1 = vals[Math.floor(vals.length * 0.25)]
    const q2 = vals[Math.floor(vals.length * 0.5)]
    const q3 = vals[Math.floor(vals.length * 0.75)]
    const zones = [
      { zone: `<${q1.toFixed(1)}`, filter: (v: number) => v < q1 },
      { zone: `${q1.toFixed(1)}-${q2.toFixed(1)}`, filter: (v: number) => v >= q1 && v < q2 },
      { zone: `${q2.toFixed(1)}-${q3.toFixed(1)}`, filter: (v: number) => v >= q2 && v < q3 },
      { zone: `>${q3.toFixed(1)}`, filter: (v: number) => v >= q3 },
    ]
    parameterZones[m.key] = zones.map(z => {
      const bucket = valid.filter(t => z.filter(m.extract(t) as number))
      return {
        zone: z.zone,
        count: bucket.length,
        winRate: bucket.length > 0 ? (bucket.filter(t => t.pnl > 0).length / bucket.length) * 100 : 0,
        avgPnl: bucket.length > 0 ? bucket.reduce((s, t) => s + t.pnl, 0) / bucket.length : 0,
      }
    })
  }

  return { correlations, scatterData, crossCorr, parameterZones, metrics }
}

// ── Correlation color helpers ──

export function corrColor(v: number | null): string {
  if (v === null) return 'text-slate-600'
  if (v >= 0.5) return 'text-emerald-400'
  if (v >= 0.2) return 'text-emerald-500/70'
  if (v > -0.2) return 'text-slate-400'
  if (v > -0.5) return 'text-red-500/70'
  return 'text-red-400'
}

export function corrBg(v: number | null): string {
  if (v === null) return 'bg-slate-800/30'
  const abs = Math.abs(v)
  if (abs >= 0.5) return v > 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
  if (abs >= 0.2) return v > 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
  return 'bg-slate-800/30'
}
