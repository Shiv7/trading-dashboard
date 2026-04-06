import { useEffect, useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { scoresApi, signalsApi, indicatorsApi, quantScoresApi, walletApi, ordersApi } from '../services/api'
import { useDashboardStore } from '../store/dashboardStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { useTimeframeScores } from '../hooks/useTimeframeScores'
import { useIndicators } from '../hooks/useIndicators'
import type { FamilyScore, Signal, IPUSignal, VCPSignal, QuantScore, Wallet } from '../types'
import { IPUPanel } from '../components/Indicators/IPUPanel'
import { VCPClusters } from '../components/Indicators/VCPClusters'
import { TechnicalIndicatorsPanel } from '../components/Indicators/TechnicalIndicatorsPanel'
import OptionsPanel from '../components/Options/OptionsPanel'
import {
  TradingModeToggle,
  WalletHeader,
  EnhancedMTFPanel,
  EnhancedQuickTradePanel,
  SignalHistory,
  ActivePositionBar,
  PriceNarrative,
} from '../components/Company'

// New components from UI revamp
import { SessionBadge } from '../components/SMTIS/SessionBadge'
import { RegimePanel } from '../components/SMTIS/RegimePanel'
import { MicrostructurePanel } from '../components/Microstructure/MicrostructurePanel'
import { ActiveSetupsPanel } from '../components/Intelligence/ActiveSetupsPanel'

// Multi-Timeframe Analysis components
import { MTFScoreHeatmap, MTFMicrostructurePanel, MTFOptionsFlowPanel } from '../components/MTF'

// Data Quality components (redesign)
import {
  VerdictBar,
  StrategyConvictionCards,
  DataAuditPanel,
  DataQualityBadge,
  DMValue,
  ProvenancedValue,
  computeDataQuality,
} from '../components/DataQuality'
import type { ProvenanceInfo } from '../components/DataQuality'


// Helper functions for microstructure data mapping
const getOfiRegime = (flowDirection?: string): 'STRONG_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'STRONG_NEGATIVE' => {
  if (!flowDirection) return 'NEUTRAL'
  switch (flowDirection) {
    case 'BUYING': return 'POSITIVE'
    case 'SELLING': return 'NEGATIVE'
    case 'BALANCED': return 'NEUTRAL'
    case 'STRONG_BULLISH': return 'STRONG_POSITIVE'
    case 'BULLISH': return 'POSITIVE'
    case 'BEARISH': return 'NEGATIVE'
    case 'STRONG_BEARISH': return 'STRONG_NEGATIVE'
    default: return 'NEUTRAL'
  }
}

const getVpinRegime = (vpin?: number): 'HIGH_TOXIC' | 'MODERATE' | 'LOW' => {
  if (!vpin) return 'LOW'
  if (vpin >= 0.7) return 'HIGH_TOXIC'
  if (vpin >= 0.5) return 'MODERATE'
  return 'LOW'
}

/** Get provenance for a field — returns LIVE if value exists, DM if not, FALLBACK if flagged */
function prov(value: unknown, fallbackReason?: string): ProvenanceInfo {
  if (value === undefined || value === null || value === '' || value === 0) {
    return fallbackReason ? { status: 'FALLBACK', reason: fallbackReason } : { status: 'DM' }
  }
  return { status: 'LIVE' }
}

export default function StockDetailPage() {
  const { scripCode } = useParams<{ scripCode: string }>()

  // Core state
  const [score, setScore] = useState<FamilyScore | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(true)

  // Indicator state
  const [ipuSignal, setIpuSignal] = useState<IPUSignal | null>(null)
  const [vcpSignal, setVcpSignal] = useState<VCPSignal | null>(null)
  const [quantScore, setQuantScore] = useState<QuantScore | null>(null)

  // Technical Indicators (BB, VWAP, SuperTrend) — data only, no chart
  const [indicatorTimeframe, setIndicatorTimeframe] = useState<string>('5m')
  // Derive exchange for market-hours gating (quantScore.exchange: N=NSE, M=MCX, C=CDS)
  const scripExchange = quantScore?.exchange
  const { indicators: techIndicators, loading: indicatorsLoading } = useIndicators(scripCode, indicatorTimeframe, scripExchange)

  // Store - integrate WebSocket data
  const wsScores = useDashboardStore((s) => s.scores)
  const wsWallet = useDashboardStore((s) => s.wallet)
  const tradingMode = useDashboardStore((s) => s.tradingMode)
  const wsSignals = useDashboardStore((s) => s.signals)
  const narratives = useDashboardStore((s) => s.narratives)
  const intelligence = useDashboardStore((s) => s.intelligence)
  const activeSetups = useDashboardStore((s) => s.activeSetups)

  // Multi-timeframe QuantScore data
  const { allScores: allTimeframeScores, latestScore: wsQuantScore, directionConsensus } = useTimeframeScores(scripCode)

  // WebSocket
  const { subscribeToStock, subscribeToIPU, subscribeToVCP } = useWebSocket()

  // Get bulk update function from store
  const bulkUpdateQuantScores = useDashboardStore((s) => s.bulkUpdateQuantScores)

  // Load data
  useEffect(() => {
    if (!scripCode) return

    async function loadData() {
      setLoading(true)
      try {
        const [scoreData, signalsData, ipuData, vcpData, quantData, walletData, allTfScores] = await Promise.all([
          scoresApi.getScore(scripCode!).catch(() => null),
          signalsApi.getSignalsForStock(scripCode!, 50).catch(() => []),
          indicatorsApi.getIPUSignal(scripCode!).catch(() => null),
          indicatorsApi.getVCPSignal(scripCode!).catch(() => null),
          quantScoresApi.getScore(scripCode!).catch(() => null),
          walletApi.getWallet().catch(() => null),
          quantScoresApi.getScoreAllTimeframes(scripCode!).catch(() => null),
        ])
        setScore(scoreData)
        setSignals(signalsData)
        setIpuSignal(ipuData)
        setVcpSignal(vcpData)
        setQuantScore(quantData)
        setWallet(walletData)

        if (allTfScores && typeof allTfScores === 'object') {
          const scoresArray = Object.values(allTfScores) as QuantScore[]
          if (scoresArray.length > 0) {
            bulkUpdateQuantScores(scoresArray)
          }
        }
      } catch (error) {
        console.error('Error loading stock data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
    subscribeToStock(scripCode)

    const unsubIPU = subscribeToIPU(scripCode, (data) => setIpuSignal(data as IPUSignal))
    const unsubVCP = subscribeToVCP(scripCode, (data) => setVcpSignal(data as VCPSignal))

    return () => {
      if (unsubIPU) unsubIPU.unsubscribe()
      if (unsubVCP) unsubVCP.unsubscribe()
    }
  }, [scripCode, subscribeToStock, subscribeToIPU, subscribeToVCP, bulkUpdateQuantScores])

  // Use WebSocket data if available, fallback to API data
  const rawDisplayScore = (scripCode && wsScores.get(scripCode)) || score
  const displayWallet = wsWallet || wallet
  const displayQuantScore = wsQuantScore || quantScore

  // Build fallback displayScore from QuantScore when FamilyScore is unavailable
  const displayScore: FamilyScore | null = rawDisplayScore || (displayQuantScore ? {
    scripCode: displayQuantScore.scripCode || scripCode || '',
    companyName: displayQuantScore.companyName || displayQuantScore.symbol || scripCode || '',
    timeframe: displayQuantScore.timeframe || '5m',
    timestamp: String(displayQuantScore.timestamp || Date.now()),
    mtis: displayQuantScore.quantScore || 0,
    mtisLabel: displayQuantScore.quantLabel || 'NEUTRAL',
    mtisTrend: 'STABLE',
    open: 0, high: 0, low: 0, close: 0, volume: 0, vwap: 0,
    vcpCombinedScore: 0, vcpRunway: 0, vcpStructuralBias: 0, vcpSupportScore: 0, vcpResistanceScore: 0,
    ipuFinalScore: 0, ipuInstProxy: 0, ipuMomentum: 0, ipuExhaustion: 0, ipuUrgency: 0,
    ipuDirectionalConviction: 0, ipuXfactor: false, ipuMomentumState: 'STEADY',
    indexRegimeLabel: 'NEUTRAL', indexRegimeStrength: 0, securityRegimeLabel: 'NEUTRAL', securityAligned: false,
    oiSignal: '', futuresBuildup: '',
    hardGatePassed: false, hardGateReason: '', mtfGatePassed: false, mtfGateReason: '',
    qualityGatePassed: false, qualityGateReason: '', statsGatePassed: false, statsGateReason: '',
    overallScore: displayQuantScore.quantScore || 0,
    direction: displayQuantScore.direction || 'NEUTRAL',
    signalEmitted: false,
  } as FamilyScore : null)

  // Merge signals: WebSocket signals for this stock + API signals
  const stockWsSignals = wsSignals.filter(s => s.scripCode === scripCode)
  const displaySignals = stockWsSignals.length > 0
    ? [...stockWsSignals, ...signals.filter(s => !stockWsSignals.find(ws => ws.signalId === s.signalId))]
    : signals

  // Get market intelligence data from store
  const narrative = scripCode ? narratives.get(scripCode) : undefined
  const marketIntel = scripCode ? intelligence.get(scripCode) : undefined
  const stockSetups = scripCode ? activeSetups.get(scripCode) : undefined

  // Get active position for this stock
  const activePosition = displayWallet?.positions?.find(
    p => p.scripCode === scripCode && p.quantity > 0
  ) || null

  // Compute Data Quality
  const dq = useMemo(
    () => computeDataQuality(displayScore, displayQuantScore, displayQuantScore?.dataQuality),
    [displayScore, displayQuantScore]
  )

  const handleTradeExecute = async (order: { scripCode: string; direction: 'LONG' | 'SHORT'; entryPrice: number; stopLoss: number; target: number; quantity: number }) => {
    try {
      const result = await ordersApi.createOrder({
        scripCode: order.scripCode,
        side: order.direction === 'LONG' ? 'BUY' : 'SELL',
        type: 'MARKET',
        qty: order.quantity,
        currentPrice: order.entryPrice,
        sl: order.stopLoss,
        tp1: order.target,
      })
      console.log(`[${tradingMode}] Order created:`, result)
      walletApi.getWallet().then(setWallet).catch(() => {})
    } catch (err) {
      console.error('Trade execution failed:', err)
    }
  }

  const handleClosePosition = async () => {
    if (!activePosition?.scripCode) return
    try {
      await ordersApi.closePosition(activePosition.scripCode)
      walletApi.getWallet().then(setWallet).catch(() => {})
    } catch (err) {
      console.error('Close position failed:', err)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-14 bg-slate-800/50 rounded-xl" />
        <div className="h-20 bg-slate-800/50 rounded-xl" />
        <div className="grid grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-48 bg-slate-800/50 rounded-xl" />)}
        </div>
      </div>
    )
  }

  // No data state
  if (!displayScore) {
    return (
      <div className="text-center py-12">
        <div className="text-xl text-slate-400 mb-4">No data for {scripCode}</div>
        <Link to="/dashboard" className="btn btn-primary">Back to Dashboard</Link>
      </div>
    )
  }

  const priceChange = displayScore.close - displayScore.open
  const priceChangePercent = displayScore.open > 0 ? (priceChange / displayScore.open) * 100 : 0

  return (
    <div className="min-h-screen pb-20">

      {/* ═══════════════════════════════════════════════════════════════
          HEADER BAR (sticky)
          ═══════════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-900/80
                         border-b border-slate-700/50 backdrop-blur-sm sticky top-0 z-40 -mx-6 -mt-6 mb-4">
        {/* Left: Nav + Stock Info */}
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-slate-400 hover:text-white transition-colors text-sm">
            \u2190 Back
          </Link>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">
              {displayScore.companyName || scripCode}
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold text-white">
                {displayScore.close > 0 ? `\u20B9${displayScore.close.toFixed(2)}` : <DMValue label="No price data" />}
              </span>
              <span className={`text-sm font-medium ${priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {priceChange >= 0 ? '+' : ''}{(priceChangePercent ?? 0).toFixed(2)}%
                {priceChange >= 0 ? ' \u2191' : ' \u2193'}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Trading Mode + Session + DQ */}
        <div className="flex items-center gap-3">
          <TradingModeToggle />
          <SessionBadge
            sessionName={(() => {
              const hour = new Date().getHours()
              if (hour < 9) return 'PRE_MARKET'
              if (hour < 10) return 'OPENING_RANGE'
              if (hour < 12) return 'MORNING_TREND'
              if (hour < 14) return 'LUNCH_CHOP'
              if (hour < 15) return 'AFTERNOON'
              return 'POWER_HOUR'
            })()}
            sessionQuality={0.75}
          />
          <DataQualityBadge
            percentage={dq.percentage}
            liveCount={dq.liveCount}
            fallbackCount={dq.fallbackCount}
            missingCount={dq.missingCount}
            compact
          />
        </div>

        {/* Right: Wallet Summary */}
        <WalletHeader wallet={displayWallet} />
      </header>


      {/* ═══════════════════════════════════════════════════════════════
          FOLD 1: VERDICT BAR — The Decision
          ═══════════════════════════════════════════════════════════════ */}
      <VerdictBar score={displayScore} dq={dq} className="mb-4" />


      {/* ═══════════════════════════════════════════════════════════════
          FOLD 1: PRICE DATA + QUICK TRADE (2-column: 55/45)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-12 gap-4 mb-6">
        {/* Price Data Strip + Narrative */}
        <div className="col-span-12 lg:col-span-7 space-y-4">
          {/* OHLCV Strip */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3">Price Action</h3>
            <div className="grid grid-cols-5 gap-4 text-center">
              <div>
                <div className="text-[10px] text-slate-500 uppercase">Open</div>
                <div className="text-sm font-mono font-bold text-white">
                  <ProvenancedValue value={displayScore.open} provenance={prov(displayScore.open)} format={v => `\u20B9${v.toFixed(2)}`} valueClassName="text-white" />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase">High</div>
                <div className="text-sm font-mono font-bold text-emerald-400">
                  <ProvenancedValue value={displayScore.high} provenance={prov(displayScore.high)} format={v => `\u20B9${v.toFixed(2)}`} valueClassName="text-emerald-400" />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase">Low</div>
                <div className="text-sm font-mono font-bold text-red-400">
                  <ProvenancedValue value={displayScore.low} provenance={prov(displayScore.low)} format={v => `\u20B9${v.toFixed(2)}`} valueClassName="text-red-400" />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase">Close</div>
                <div className="text-sm font-mono font-bold text-white">
                  <ProvenancedValue value={displayScore.close} provenance={prov(displayScore.close)} format={v => `\u20B9${v.toFixed(2)}`} valueClassName="text-white" />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase">Volume</div>
                <div className="text-sm font-mono font-bold text-white">
                  <ProvenancedValue value={displayScore.volume} provenance={prov(displayScore.volume)} format={v => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}K`} valueClassName="text-white" />
                </div>
              </div>
            </div>
            {/* Day range bar */}
            {displayScore.high > 0 && displayScore.low > 0 && displayScore.close > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[9px] text-slate-500 mb-0.5">
                  <span>\u20B9{displayScore.low.toFixed(2)}</span>
                  <span>Day Range</span>
                  <span>\u20B9{displayScore.high.toFixed(2)}</span>
                </div>
                <div className="relative h-1.5 bg-slate-700 rounded-full">
                  <div
                    className="absolute h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 rounded-full"
                    style={{ width: '100%' }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full border border-slate-600 shadow"
                    style={{
                      left: `${Math.max(0, Math.min(100, ((displayScore.close - displayScore.low) / (displayScore.high - displayScore.low)) * 100))}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    title={`Close: \u20B9${displayScore.close.toFixed(2)}`}
                  />
                </div>
              </div>
            )}
            {/* VWAP */}
            {displayScore.vwap > 0 && (
              <div className="mt-2 flex items-center gap-4 text-[10px]">
                <span className="text-slate-500">VWAP:</span>
                <span className={`font-mono font-bold ${displayScore.close >= displayScore.vwap ? 'text-emerald-400' : 'text-red-400'}`}>
                  \u20B9{displayScore.vwap.toFixed(2)}
                </span>
                <span className={`text-[9px] ${displayScore.close >= displayScore.vwap ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
                  Price {displayScore.close >= displayScore.vwap ? 'above' : 'below'} VWAP
                </span>
              </div>
            )}
          </div>

          {/* Price Narrative */}
          <PriceNarrative
            score={displayScore}
            narrative={narrative}
            intelligence={marketIntel}
          />
        </div>

        {/* Quick Trade */}
        <div className="col-span-12 lg:col-span-5 space-y-4">
          <EnhancedQuickTradePanel
            score={displayScore}
            onExecute={handleTradeExecute}
            onWatchlist={() => {}}
            exchange={scripExchange}
          />

          {/* Compact OI/Regime strip */}
          <div className="grid grid-cols-2 gap-3">
            {/* Regime */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Regime</div>
              <div className={`text-sm font-bold ${displayScore.securityAligned ? 'text-emerald-400' : 'text-amber-400'}`}>
                {displayScore.indexRegimeLabel || <DMValue />}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Strength: <ProvenancedValue value={displayScore.indexRegimeStrength} provenance={prov(displayScore.indexRegimeStrength)} format={v => `${(v * 100).toFixed(0)}%`} valueClassName="text-white" />
              </div>
              <div className="text-[10px] mt-0.5">
                Aligned: <span className={displayScore.securityAligned ? 'text-emerald-400' : 'text-red-400'}>
                  {displayScore.securityAligned ? '\u2713 Yes' : '\u2717 No'}
                </span>
              </div>
            </div>

            {/* OI / F&O */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">OI / F&O</div>
              <div className={`text-sm font-bold ${
                displayScore.oiSignal?.includes('BULLISH') ? 'text-emerald-400' :
                displayScore.oiSignal?.includes('BEARISH') ? 'text-red-400' : 'text-slate-400'
              }`}>
                {displayScore.oiSignal || <DMValue label="No OI signal" />}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                PCR: <ProvenancedValue value={displayScore.pcr} provenance={prov(displayScore.pcr)} format={v => v.toFixed(2)} valueClassName="text-white" />
              </div>
              <div className="text-[10px] mt-0.5">
                Fut: <ProvenancedValue value={displayScore.futuresBuildup} provenance={prov(displayScore.futuresBuildup)} valueClassName="text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* ═══════════════════════════════════════════════════════════════
          FOLD 2: STRATEGY CONVICTION CARDS
          ═══════════════════════════════════════════════════════════════ */}
      <StrategyConvictionCards dq={dq} className="mb-6" />


      {/* ═══════════════════════════════════════════════════════════════
          FOLD 3: EVIDENCE PANELS (2-column grid)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-12 gap-4 mb-6">
        {/* Left: Technical & Microstructure */}
        <div className="col-span-12 lg:col-span-6 space-y-4">
          {/* Technical Indicators */}
          <TechnicalIndicatorsPanel
            indicators={techIndicators}
            currentPrice={displayScore.close || 0}
            loading={indicatorsLoading}
            timeframe={indicatorTimeframe}
            onTimeframeChange={setIndicatorTimeframe}
          />

          {/* Microstructure */}
          <MicrostructurePanel
            data={{
              ofi: displayQuantScore?.microstructureSummary?.avgOFI || 0,
              ofiZScore: 0,
              ofiRegime: getOfiRegime(displayQuantScore?.microstructureSummary?.flowDirection),
              vpin: displayQuantScore?.microstructureSummary?.avgVPIN || 0,
              vpinRegime: getVpinRegime(displayQuantScore?.microstructureSummary?.avgVPIN),
              kyleLambda: displayQuantScore?.microstructureSummary?.avgKyleLambda || 0,
              lambdaZScore: 0,
              depthImbalance: displayQuantScore?.microstructureSummary?.avgDepthImbalance || 0,
              buyPressure: (displayQuantScore?.microstructureSummary?.aggressiveBuyRatio || 0.5) * 100,
              sellPressure: (displayQuantScore?.microstructureSummary?.aggressiveSellRatio || 0.5) * 100,
              spread: displayQuantScore?.microstructureSummary?.avgSpread || 0,
              spreadZScore: 0,
            }}
          />
        </div>

        {/* Right: Options + IPU/VCP + Regime */}
        <div className="col-span-12 lg:col-span-6 space-y-4">
          {/* Options Panel */}
          <OptionsPanel quantScore={displayQuantScore} familyScore={displayScore} />

          {/* VCP */}
          {vcpSignal ? (
            <VCPClusters data={vcpSignal} />
          ) : (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3">VCP Module</h3>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-lg font-bold text-emerald-400">
                    {displayScore.vcpCombinedScore > 0 ? `${(displayScore.vcpCombinedScore * 100).toFixed(0)}%` : <DMValue />}
                  </div>
                  <div className="text-[10px] text-slate-500">Combined</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {displayScore.vcpRunway > 0 ? `${(displayScore.vcpRunway * 100).toFixed(0)}%` : <DMValue />}
                  </div>
                  <div className="text-[10px] text-slate-500">Runway</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {displayScore.vcpSupportScore > 0 ? `${(displayScore.vcpSupportScore * 100).toFixed(0)}%` : <DMValue />}
                  </div>
                  <div className="text-[10px] text-slate-500">Support</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {displayScore.vcpResistanceScore > 0 ? `${(displayScore.vcpResistanceScore * 100).toFixed(0)}%` : <DMValue />}
                  </div>
                  <div className="text-[10px] text-slate-500">Resistance</div>
                </div>
              </div>
            </div>
          )}

          {/* IPU */}
          {ipuSignal ? (
            <IPUPanel data={ipuSignal} />
          ) : (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                IPU Module
                {displayScore.ipuXfactor && <span className="text-yellow-400">\u26A1</span>}
              </h3>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-lg font-bold text-blue-400">
                    {displayScore.ipuFinalScore > 0 ? `${(displayScore.ipuFinalScore * 100).toFixed(0)}%` : <DMValue />}
                  </div>
                  <div className="text-[10px] text-slate-500">Final Score</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {displayScore.ipuInstProxy > 0 ? `${(displayScore.ipuInstProxy * 100).toFixed(0)}%` : <DMValue />}
                  </div>
                  <div className="text-[10px] text-slate-500">Institutional</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{displayScore.ipuMomentumState || <DMValue />}</div>
                  <div className="text-[10px] text-slate-500">Momentum</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {displayScore.ipuExhaustion > 0 ? `${(displayScore.ipuExhaustion * 100).toFixed(0)}%` : <DMValue />}
                  </div>
                  <div className="text-[10px] text-slate-500">Exhaustion</div>
                </div>
              </div>
            </div>
          )}

          {/* Regime Panel */}
          <RegimePanel
            regimes={[
              {
                name: 'INDEX',
                value: displayScore.indexRegimeStrength || 0,
                regime: displayScore.indexRegimeLabel?.includes('BULLISH') ? 'POSITIVE' :
                  displayScore.indexRegimeLabel?.includes('BEARISH') ? 'NEGATIVE' : 'NEUTRAL',
                zScore: 0,
                percentile: (displayScore.indexRegimeStrength || 0.5) * 100,
                flipDetected: false,
              },
              {
                name: 'SECURITY',
                value: 0.5,
                regime: displayScore.securityRegimeLabel?.includes('BULLISH') ? 'POSITIVE' :
                  displayScore.securityRegimeLabel?.includes('BEARISH') ? 'NEGATIVE' : 'NEUTRAL',
                zScore: 0,
                percentile: 50,
                flipDetected: false,
              },
            ]}
          />

          {/* Active Setups */}
          <ActiveSetupsPanel setups={stockSetups} />
        </div>
      </div>


      {/* ═══════════════════════════════════════════════════════════════
          FOLD 3b: MULTI-TIMEFRAME (collapsed by default) + MTF Panel
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-12 gap-4 mb-6">
        <div className="col-span-12 lg:col-span-4">
          <EnhancedMTFPanel
            scripCode={scripCode || ''}
            currentPrice={displayScore.close || 0}
          />
        </div>

        <div className="col-span-12 lg:col-span-8">
          {allTimeframeScores.length > 0 && (
            <details className="bg-slate-800/30 border border-slate-700/50 rounded-xl overflow-hidden">
              <summary className="px-4 py-3 bg-slate-800/50 cursor-pointer hover:bg-slate-700/30 transition-colors flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-white">Multi-Timeframe Analysis</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                    {allTimeframeScores.length} TFs
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    directionConsensus.dominant === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
                    directionConsensus.dominant === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
                    'bg-slate-700 text-slate-400'
                  }`}>
                    {(directionConsensus.percentage ?? 0).toFixed(0)}% {directionConsensus.dominant}
                  </span>
                </div>
                <span className="text-slate-400 text-xs">Click to expand</span>
              </summary>
              <div className="p-4 space-y-4">
                <MTFScoreHeatmap scores={allTimeframeScores} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MTFMicrostructurePanel scores={allTimeframeScores} />
                  <MTFOptionsFlowPanel scores={allTimeframeScores} />
                </div>
              </div>
            </details>
          )}
        </div>
      </div>


      {/* ═══════════════════════════════════════════════════════════════
          FOLD 4: SIGNAL HISTORY
          ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-6">
        <SignalHistory signals={displaySignals} />
      </div>


      {/* ═══════════════════════════════════════════════════════════════
          FOLD 5: DATA AUDIT — Full Transparency
          ═══════════════════════════════════════════════════════════════ */}
      <details className="bg-slate-800/30 border border-slate-700/50 rounded-xl overflow-hidden mb-6">
        <summary className="px-4 py-3 bg-slate-800/50 cursor-pointer hover:bg-slate-700/30 transition-colors flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-white">Data Audit Trail</span>
            <span className="text-[10px] text-slate-500">{dq.allFields.length} fields tracked</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-emerald-400">{dq.liveCount} live</span>
            <span className="text-[10px] text-amber-400">{dq.fallbackCount} fallback</span>
            <span className="text-[10px] text-red-400">{dq.missingCount} missing</span>
            <span className="text-slate-400 text-xs">Click to expand</span>
          </div>
        </summary>
        <div className="p-4">
          <DataAuditPanel dq={dq} />
        </div>
      </details>


      {/* ═══════════════════════════════════════════════════════════════
          FIXED FOOTER: Active Position Bar
          ═══════════════════════════════════════════════════════════════ */}
      <ActivePositionBar
        position={activePosition}
        onClose={handleClosePosition}
      />
    </div>
  )
}
