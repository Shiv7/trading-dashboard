/**
 * Data Quality computation — derives LIVE / FALLBACK / DM status for every field
 * each strategy requires, using the data already available on the frontend.
 *
 * Convention:
 *   LIVE     = real data from tick/exchange feed (full credit)
 *   FALLBACK = derived/heuristic value (half credit)
 *   DM       = completely missing (zero credit)
 */

import type { FamilyScore, QuantScore, DataQuality } from '../../types'
import type { ProvenanceStatus } from './ProvenanceTag'

export interface FieldAuditEntry {
  field: string
  value: string | number | null
  source: string
  status: ProvenanceStatus
  reason?: string
}

export interface StrategyDQ {
  strategy: string
  label: string
  percentage: number
  liveCount: number
  fallbackCount: number
  missingCount: number
  fields: FieldAuditEntry[]
  canFire: boolean
  fireStatus: string   // "FIRED HH:MM" | "Can fire" | "Blocked: reason"
  headlineMetric: string
  headlineValue: string
  direction: string
}

export interface OverallDQ {
  percentage: number
  liveCount: number
  fallbackCount: number
  missingCount: number
  strategies: StrategyDQ[]
  allFields: FieldAuditEntry[]
}

function field(f: string, value: unknown, source: string, status: ProvenanceStatus, reason?: string): FieldAuditEntry {
  return {
    field: f,
    value: value === undefined || value === null ? null : String(value),
    source,
    status,
    reason,
  }
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '' && v !== 0
}

function hasNumericValue(v: unknown): boolean {
  return typeof v === 'number' && v !== 0
}

/**
 * Compute FUDKII strategy data quality.
 * FUDKII needs: price OHLCV, BB(20,2), SuperTrend(10,3), OI data, volume surge.
 */
function computeFudkiiDQ(score: FamilyScore | null, quantScore: QuantScore | null): StrategyDQ {
  const fields: FieldAuditEntry[] = []
  const s = score
  const q = quantScore

  // Price data
  fields.push(field('close', s?.close, 'Tick feed', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('volume', s?.volume, 'Candle agg', hasNumericValue(s?.volume) ? 'LIVE' : 'DM'))

  // BB bands — if we have breakdown or close/high/low, we can infer BB availability
  const hasBB = s?.fudkiiIgnition !== undefined || (s?.overallScore !== undefined && s?.overallScore > 0)
  fields.push(field('BB Upper', null, 'BBST calc', hasBB ? 'LIVE' : 'DM'))
  fields.push(field('BB Lower', null, 'BBST calc', hasBB ? 'LIVE' : 'DM'))
  fields.push(field('SuperTrend', null, 'BBST calc', hasBB ? 'LIVE' : 'DM'))

  // OI data — check optionsFlow or oiSignal
  const hasOI = hasValue(s?.oiSignal) && s?.oiSignal !== 'NEUTRAL'
  const hasFuturesOI = hasValue(q?.optionsFlowSummary?.oiBuildupType)
  if (hasOI) {
    fields.push(field('oiChangePercent', null, 'OI Aggregator', 'LIVE'))
    fields.push(field('oiInterpretation', s?.oiSignal, 'OI Aggregator', 'LIVE'))
  } else if (hasFuturesOI) {
    fields.push(field('oiChangePercent', null, 'Futures OI', 'FALLBACK', 'futures lookup'))
    fields.push(field('oiInterpretation', q?.optionsFlowSummary?.oiBuildupType, 'Futures OI', 'FALLBACK', 'futures lookup'))
  } else {
    fields.push(field('oiChangePercent', null, 'OI Aggregator', 'DM'))
    fields.push(field('oiInterpretation', null, 'OI Aggregator', 'DM'))
  }

  // Volume surge
  fields.push(field('volumeSurge', null, '6-candle avg', hasNumericValue(s?.volume) ? 'LIVE' : 'DM'))

  // Direction
  fields.push(field('direction', s?.direction, 'Signal', hasValue(s?.direction) && s?.direction !== 'NEUTRAL' ? 'LIVE' : s?.direction === 'NEUTRAL' ? 'LIVE' : 'DM'))

  const { live, fb, dm, pct } = tally(fields)

  // Determine fire status from gates
  const allGates = s?.hardGatePassed && s?.mtfGatePassed && s?.qualityGatePassed
  const fireStatus = s?.signalEmitted ? `FIRED` :
    allGates ? 'Can fire' :
      `Blocked: ${!s?.hardGatePassed ? 'Hard gate' : !s?.mtfGatePassed ? 'MTF gate' : 'Quality gate'}`

  return {
    strategy: 'FUDKII',
    label: 'FUDKII',
    percentage: pct,
    liveCount: live,
    fallbackCount: fb,
    missingCount: dm,
    fields,
    canFire: !!allGates,
    fireStatus,
    headlineMetric: 'KII Score',
    headlineValue: s?.fudkiiIgnition ? 'IGNITION' : (s?.overallScore?.toFixed(1) || 'DM'),
    direction: s?.direction || 'NEUTRAL',
  }
}

/**
 * Compute FUKAA strategy data quality.
 * FUKAA = FUDKII + volume surge gate + pivot SL/targets + block trades.
 */
function computeFukaaDQ(score: FamilyScore | null, quantScore: QuantScore | null): StrategyDQ {
  const fudkii = computeFudkiiDQ(score, quantScore)
  const fields = [...fudkii.fields]

  // Additional FUKAA fields
  const q = quantScore
  const s = score

  // Block trades
  fields.push(field('blockTradePct', null, 'Tick feed', hasValue(q?.microstructureSummary) ? 'LIVE' : 'DM'))

  // Pivot SL/Target — check if we have breakdown scores
  const hasPivot = hasNumericValue(s?.vcpSupportScore) || hasNumericValue(s?.vcpResistanceScore)
  fields.push(field('Pivot SL', null, 'PivotCalc', hasPivot ? 'LIVE' : 'FALLBACK', hasPivot ? undefined : 'BB_LOWER'))
  fields.push(field('Pivot T1', null, 'ConfluentTgt', hasPivot ? 'LIVE' : 'FALLBACK', hasPivot ? undefined : '2xATR'))

  // ATR
  fields.push(field('ATR (M30)', null, 'ATRService', hasNumericValue(s?.close) ? 'LIVE' : 'FALLBACK', '1% of price'))

  // R:R
  fields.push(field('R:R', null, 'PivotCalc', hasPivot ? 'LIVE' : 'FALLBACK', 'derived'))

  // Volume surge (exchange-specific)
  fields.push(field('volSurge (T-1..T-7)', null, 'Candle history', hasNumericValue(s?.volume) ? 'LIVE' : 'DM'))

  const { live, fb, dm, pct } = tally(fields)

  return {
    strategy: 'FUKAA',
    label: 'FUKAA',
    percentage: pct,
    liveCount: live,
    fallbackCount: fb,
    missingCount: dm,
    fields,
    canFire: fudkii.canFire,
    fireStatus: fudkii.fireStatus,
    headlineMetric: 'Conviction',
    headlineValue: s?.overallScore ? `${(s.overallScore * 10).toFixed(0)}%` : 'DM',
    direction: s?.direction || 'NEUTRAL',
  }
}

/**
 * Compute FUDKOI data quality.
 * FUDKOI = FUDKII + OI change ratio gate + option enrichment.
 */
function computeFudkoiDQ(score: FamilyScore | null, quantScore: QuantScore | null): StrategyDQ {
  const fudkii = computeFudkiiDQ(score, quantScore)
  const fields = [...fudkii.fields]
  const s = score
  const q = quantScore

  // OI change ratio
  const hasOIRatio = hasValue(s?.oiSignal) && s?.oiSignal !== 'NEUTRAL'
  fields.push(field('oiChangeRatio', null, 'OI Aggregator', hasOIRatio ? 'LIVE' : 'DM'))

  // Option fields
  const hasOptions = hasValue(q?.greeksSummary)
  fields.push(field('optionScripCode', null, 'OptionEnricher', hasOptions ? 'LIVE' : 'DM'))
  fields.push(field('optionLtp', null, 'Redis/Tick', hasOptions ? 'LIVE' : 'DM'))
  fields.push(field('delta', q?.greeksSummary?.totalDelta, 'BS calc',
    hasOptions ? 'LIVE' : (hasNumericValue(s?.close) ? 'FALLBACK' : 'DM'),
    hasOptions ? undefined : 'DELTA_0.5'))
  fields.push(field('optionStrike', null, 'ScripFinder', hasOptions ? 'LIVE' : 'DM'))
  fields.push(field('optionType', null, 'Direction', hasOptions ? 'LIVE' : 'DM'))

  const { live, fb, dm, pct } = tally(fields)

  return {
    strategy: 'FUDKOI',
    label: 'FUDKOI',
    percentage: pct,
    liveCount: live,
    fallbackCount: fb,
    missingCount: dm,
    fields,
    canFire: fudkii.canFire && hasOIRatio,
    fireStatus: !hasOIRatio ? 'Blocked: No OI data' : fudkii.fireStatus,
    headlineMetric: 'OI Gate',
    headlineValue: hasOIRatio ? 'PASS' : 'NO DATA',
    direction: s?.direction || 'NEUTRAL',
  }
}

/**
 * Compute MERE data quality.
 * MERE needs: M30 candles, BB %B, OI (aggregate FUT), volume, options analytics,
 * D1 regime, H4 context, candle patterns, ST flips.
 */
function computeMereDQ(score: FamilyScore | null, quantScore: QuantScore | null): StrategyDQ {
  const fields: FieldAuditEntry[] = []
  const s = score
  const q = quantScore

  // L1 Extension (BB %B)
  fields.push(field('M30 candles', null, 'Candle agg', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('BB %B (M30)', null, 'BBST calc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))

  // L2 Exhaustion
  const hasOI = hasValue(s?.oiSignal) && s?.oiSignal !== 'NEUTRAL'
  fields.push(field('FUT OI interpret.', s?.oiSignal, 'OI Aggregator', hasOI ? 'LIVE' : 'DM'))
  fields.push(field('FUT OI velocity', null, 'OI Aggregator', hasOI ? 'LIVE' : 'DM'))
  fields.push(field('Volume climax', null, 'Candle history', hasNumericValue(s?.volume) ? 'LIVE' : 'DM'))

  // L3 Options
  const hasOpts = hasValue(q?.optionsFlowSummary?.pcr) && q!.optionsFlowSummary!.pcr > 0
  fields.push(field('PCR', q?.optionsFlowSummary?.pcr, 'OptionSvc', hasOpts ? 'LIVE' : 'DM'))
  fields.push(field('Max Pain', null, 'OptionSvc', hasOpts ? 'LIVE' : 'DM'))
  fields.push(field('GEX', q?.greeksSummary?.totalGamma, 'OptionSvc', hasValue(q?.greeksSummary) ? 'LIVE' : 'DM'))
  fields.push(field('IV Percentile', q?.ivSummary?.ivRank, 'OptionSvc', hasValue(q?.ivSummary) ? 'LIVE' : 'DM'))

  // L4 Multi-TF
  fields.push(field('D1 Regime', s?.indexRegimeLabel, 'MTF svc', hasValue(s?.indexRegimeLabel) ? 'LIVE' : 'DM'))
  fields.push(field('H4 %B', null, 'H4 candle', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('H4 RSI', null, 'H4 candle', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))

  // L5 Entry Quality
  fields.push(field('M30 pattern', null, 'PatternAnalyzer', 'LIVE'))
  fields.push(field('M15 ST flip', null, 'Redis', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('ATR', null, 'BBST calc', hasNumericValue(s?.close) ? 'LIVE' : 'FALLBACK', '1% of price'))

  const { live, fb, dm, pct } = tally(fields)

  // MERE phases
  const hasExhaustion = hasValue(s?.hasExhaustion) && s?.hasExhaustion
  const phase = hasExhaustion ? 'QUALIFY' : (hasNumericValue(s?.close) ? 'SCAN' : 'NO DATA')

  return {
    strategy: 'MERE',
    label: 'MERE',
    percentage: pct,
    liveCount: live,
    fallbackCount: fb,
    missingCount: dm,
    fields,
    canFire: false,
    fireStatus: `Phase: ${phase}`,
    headlineMetric: 'Phase',
    headlineValue: phase,
    direction: s?.direction || 'NEUTRAL',
  }
}

/**
 * Compute MicroAlpha data quality.
 * MicroAlpha needs: orderbook (OFI, depth, VPIN, kyle), OI, options (GEX, PCR, IV, walls),
 * session structure, market regime, block deals.
 */
function computeMicroAlphaDQ(score: FamilyScore | null, quantScore: QuantScore | null): StrategyDQ {
  const fields: FieldAuditEntry[] = []
  const q = quantScore
  const s = score
  const ms = q?.microstructureSummary

  // 1. Flow Conviction (orderbook)
  const hasOrderbook = hasNumericValue(ms?.avgOFI) || hasNumericValue(ms?.avgVPIN)
  fields.push(field('normalizedOfi', ms?.avgOFI, 'L2 book', hasOrderbook ? 'LIVE' : 'DM'))
  fields.push(field('depthImbalance', ms?.avgDepthImbalance, 'L2 book', hasOrderbook ? 'LIVE' : 'DM'))
  fields.push(field('vpin', ms?.avgVPIN, 'Tick model', hasNumericValue(ms?.avgVPIN) ? 'LIVE' : 'DM'))
  fields.push(field('kyleLambda', ms?.avgKyleLambda, 'L2 book', hasNumericValue(ms?.avgKyleLambda) ? 'LIVE' : 'DM'))
  fields.push(field('buyPressure', ms?.aggressiveBuyRatio, 'L2 book', hasNumericValue(ms?.aggressiveBuyRatio) ? 'LIVE' : 'DM'))

  // 2. OI Conviction
  const hasOI = hasValue(s?.oiSignal) && s?.oiSignal !== 'NEUTRAL'
  const hasFuturesOI = hasValue(q?.optionsFlowSummary?.oiBuildupType)
  if (hasOI) {
    fields.push(field('OI (direct)', null, 'Exchange feed', 'LIVE'))
  } else if (hasFuturesOI) {
    fields.push(field('OI (futures)', null, 'MongoDB cache', 'FALLBACK', 'futures lookup'))
  } else {
    fields.push(field('OI', null, 'Exchange/MongoDB', 'DM'))
  }

  // 3. Gamma Regime (options)
  const hasGamma = hasValue(q?.greeksSummary)
  fields.push(field('GEX', q?.greeksSummary?.totalGamma, 'Options chain', hasGamma ? 'LIVE' : 'DM'))
  fields.push(field('PCR', q?.optionsFlowSummary?.pcr, 'Options chain', hasValue(q?.optionsFlowSummary) ? 'LIVE' : 'DM'))
  fields.push(field('IV Percentile', q?.ivSummary?.ivRank, 'Options chain', hasValue(q?.ivSummary) ? 'LIVE' : 'DM'))
  fields.push(field('callOIWall', null, 'Options chain', hasGamma ? 'LIVE' : 'DM'))

  // 4. Session Context
  fields.push(field('SessionStructure', null, 'Session svc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))

  // 5. Market Regime
  fields.push(field('MarketRegime', null, 'Regime svc', hasValue(s?.indexRegimeLabel) ? 'LIVE' : 'DM'))

  // 6. Block Deal Score
  fields.push(field('largeTradeCount', null, 'Tick feed', hasValue(q?.microstructureSummary) ? 'LIVE' : 'DM'))

  // avgVolume20
  fields.push(field('avgVolume20', null, 'Tech indicators', hasNumericValue(s?.volume) ? 'LIVE' : 'DM'))

  const { live, fb, dm, pct } = tally(fields)

  const conviction = q?.quantScore || 0

  return {
    strategy: 'MicroAlpha',
    label: 'MicroAlpha',
    percentage: pct,
    liveCount: live,
    fallbackCount: fb,
    missingCount: dm,
    fields,
    canFire: conviction >= 45,
    fireStatus: conviction >= 45 ? 'Can fire' : `Blocked: conviction ${conviction.toFixed(0)} < 45`,
    headlineMetric: 'Conviction',
    headlineValue: conviction > 0 ? `${conviction.toFixed(0)}%` : 'DM',
    direction: q?.direction || s?.direction || 'NEUTRAL',
  }
}

/**
 * Compute Pivot strategy data quality.
 * Pivot needs: price, ATR, multi-TF pivot levels (daily/weekly/monthly), confluence zones.
 */
function computePivotDQ(score: FamilyScore | null, quantScore: QuantScore | null): StrategyDQ {
  const fields: FieldAuditEntry[] = []
  const s = score

  fields.push(field('close', s?.close, 'Tick feed', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('ATR (M30)', null, 'ATRService', hasNumericValue(s?.close) ? 'LIVE' : 'FALLBACK', '1% of price'))
  fields.push(field('Daily Pivots', null, 'PivotLevelSvc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('Weekly Pivots', null, 'PivotLevelSvc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('Monthly Pivots', null, 'PivotLevelSvc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('Confluence zones', null, 'ConfluentTgt', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('BB bands', null, 'BBST calc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('SuperTrend', null, 'BBST calc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))

  const { live, fb, dm, pct } = tally(fields)
  return {
    strategy: 'Pivot', label: 'Pivot', percentage: pct,
    liveCount: live, fallbackCount: fb, missingCount: dm, fields,
    canFire: hasNumericValue(s?.close),
    fireStatus: hasNumericValue(s?.close) ? 'Can fire' : 'No data',
    headlineMetric: 'Confluence',
    headlineValue: hasNumericValue(s?.close) ? 'Active' : 'DM',
    direction: s?.direction || 'NEUTRAL',
  }
}

/**
 * Compute Quant strategy data quality.
 * Quant uses the full QuantScore pipeline (8 components).
 */
function computeQuantDQ(score: FamilyScore | null, quantScore: QuantScore | null): StrategyDQ {
  const fields: FieldAuditEntry[] = []
  const q = quantScore
  const dq = q?.dataQuality

  fields.push(field('Greeks', null, 'Options chain', dq?.hasGreeks ? 'LIVE' : (dq?.greeksApplicable === false ? 'LIVE' : 'DM')))
  fields.push(field('IV Surface', null, 'Options chain', dq?.hasIVSurface ? 'LIVE' : (dq?.ivSurfaceApplicable === false ? 'LIVE' : 'DM')))
  fields.push(field('Microstructure', null, 'L2 book', dq?.hasMicrostructure ? 'LIVE' : 'DM'))
  fields.push(field('Options Flow', null, 'Options chain', dq?.hasOptionsFlow ? 'LIVE' : 'DM'))
  fields.push(field('Price Action', null, 'Candle agg', dq?.hasPriceAction ? 'LIVE' : 'DM'))
  fields.push(field('Volume Profile', null, 'Tick model', dq?.hasVolumeProfile ? 'LIVE' : 'DM'))
  fields.push(field('Cross-Instrument', null, 'Multi-scrip', dq?.hasCrossInstrument ? 'LIVE' : (dq?.crossInstrumentApplicable === false ? 'LIVE' : 'DM')))

  const { live, fb, dm, pct } = tally(fields)
  const qScore = q?.quantScore || 0
  return {
    strategy: 'Quant', label: 'Quant', percentage: pct,
    liveCount: live, fallbackCount: fb, missingCount: dm, fields,
    canFire: qScore >= 60 && (q?.actionable ?? false),
    fireStatus: q?.actionable ? `Score: ${qScore.toFixed(0)}` : qScore > 0 ? `Score: ${qScore.toFixed(0)} (not actionable)` : 'No data',
    headlineMetric: 'Score',
    headlineValue: qScore > 0 ? `${qScore.toFixed(0)}/100` : 'DM',
    direction: q?.direction || score?.direction || 'NEUTRAL',
  }
}

/**
 * Compute BB-strategy data quality (shared for MCX-BB-15, MCX-BB-30, NSE-BB-30).
 * BB strategies need: price, BB(20,2), SuperTrend, volume, exchange-specific data.
 */
function computeBbDQ(strategyName: string, label: string, score: FamilyScore | null, quantScore: QuantScore | null): StrategyDQ {
  const fields: FieldAuditEntry[] = []
  const s = score

  fields.push(field('close', s?.close, 'Tick feed', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('volume', s?.volume, 'Candle agg', hasNumericValue(s?.volume) ? 'LIVE' : 'DM'))
  fields.push(field('BB Upper', null, 'BBST calc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('BB Lower', null, 'BBST calc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('SuperTrend', null, 'BBST calc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('ST Flip', null, 'BBST calc', hasNumericValue(s?.close) ? 'LIVE' : 'DM'))
  fields.push(field('ATR', null, 'ATRService', hasNumericValue(s?.close) ? 'LIVE' : 'FALLBACK', '1% of price'))

  const { live, fb, dm, pct } = tally(fields)
  return {
    strategy: strategyName, label, percentage: pct,
    liveCount: live, fallbackCount: fb, missingCount: dm, fields,
    canFire: hasNumericValue(s?.close),
    fireStatus: hasNumericValue(s?.close) ? 'Can fire' : 'No data',
    headlineMetric: 'BB+ST',
    headlineValue: hasNumericValue(s?.close) ? 'Active' : 'DM',
    direction: s?.direction || 'NEUTRAL',
  }
}

function tally(fields: FieldAuditEntry[]): { live: number; fb: number; dm: number; pct: number } {
  let live = 0, fb = 0, dm = 0
  for (const f of fields) {
    if (f.status === 'LIVE') live++
    else if (f.status === 'FALLBACK' || f.status === 'BOOT' || f.status === 'REDIS' || f.status === 'SWAP') fb++
    else dm++
  }
  const total = fields.length
  const pct = total > 0 ? ((live + fb * 0.5) / total) * 100 : 0
  return { live, fb, dm, pct }
}

/**
 * Main entry point — compute overall and per-strategy data quality.
 */
export function computeDataQuality(
  score: FamilyScore | null,
  quantScore: QuantScore | null,
  _dataQuality?: DataQuality | null,
): OverallDQ {
  const strategies = [
    computeFudkiiDQ(score, quantScore),
    computeFukaaDQ(score, quantScore),
    computeFudkoiDQ(score, quantScore),
    computeMereDQ(score, quantScore),
    computeMicroAlphaDQ(score, quantScore),
    computePivotDQ(score, quantScore),
    computeQuantDQ(score, quantScore),
    computeBbDQ('MCX-BB-15', 'MCX-BB-15', score, quantScore),
    computeBbDQ('MCX-BB-30', 'MCX-BB-30', score, quantScore),
    computeBbDQ('NSE-BB-30', 'NSE-BB-30', score, quantScore),
  ]

  let totalLive = 0, totalFB = 0, totalDM = 0
  const allFields: FieldAuditEntry[] = []
  for (const s of strategies) {
    totalLive += s.liveCount
    totalFB += s.fallbackCount
    totalDM += s.missingCount
    allFields.push(...s.fields)
  }

  const totalFields = totalLive + totalFB + totalDM
  const overallPct = totalFields > 0 ? ((totalLive + totalFB * 0.5) / totalFields) * 100 : 0

  return {
    percentage: overallPct,
    liveCount: totalLive,
    fallbackCount: totalFB,
    missingCount: totalDM,
    strategies,
    allFields,
  }
}
