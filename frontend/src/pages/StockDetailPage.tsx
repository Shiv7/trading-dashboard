import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { scoresApi, signalsApi, indicatorsApi, quantScoresApi, walletApi } from '../services/api'
import { useDashboardStore } from '../store/dashboardStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { useTimeframeScores } from '../hooks/useTimeframeScores'
import type { FamilyScore, Signal, IPUSignal, VCPSignal, QuantScore, Wallet } from '../types'
import { IPUPanel } from '../components/Indicators/IPUPanel'
import { VCPClusters } from '../components/Indicators/VCPClusters'
import PriceChart from '../components/Charts/PriceChart'
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


// Helper functions for microstructure data mapping
const getOfiRegime = (flowDirection?: string): 'STRONG_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'STRONG_NEGATIVE' => {
  if (!flowDirection) return 'NEUTRAL'
  switch (flowDirection) {
    case 'BUYING': return 'POSITIVE'
    case 'SELLING': return 'NEGATIVE'
    case 'BALANCED': return 'NEUTRAL'
    // Legacy values
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

export default function StockDetailPage() {
  const { scripCode } = useParams<{ scripCode: string }>()

  // Core state
  const [score, setScore] = useState<FamilyScore | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [scoreHistory, setScoreHistory] = useState<FamilyScore[]>([])
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(true)

  // Indicator state
  const [ipuSignal, setIpuSignal] = useState<IPUSignal | null>(null)
  const [vcpSignal, setVcpSignal] = useState<VCPSignal | null>(null)
  const [quantScore, setQuantScore] = useState<QuantScore | null>(null)

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

  // Load data
  useEffect(() => {
    if (!scripCode) return

    async function loadData() {
      setLoading(true)
      try {
        const [scoreData, signalsData, historyData, ipuData, vcpData, quantData, walletData] = await Promise.all([
          scoresApi.getScore(scripCode!).catch(() => null),
          signalsApi.getSignalsForStock(scripCode!, 50).catch(() => []),
          scoresApi.getScoreHistory(scripCode!, 100).catch(() => []),
          indicatorsApi.getIPUSignal(scripCode!).catch(() => null),
          indicatorsApi.getVCPSignal(scripCode!).catch(() => null),
          quantScoresApi.getScore(scripCode!).catch(() => null),
          walletApi.getWallet().catch(() => null),
        ])
        setScore(scoreData)
        setSignals(signalsData)
        setScoreHistory(historyData)
        setIpuSignal(ipuData)
        setVcpSignal(vcpData)
        setQuantScore(quantData)
        setWallet(walletData)
      } catch (error) {
        console.error('Error loading stock data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
    subscribeToStock(scripCode)

    // Subscribe to detailed indicators
    const unsubIPU = subscribeToIPU(scripCode, (data) => setIpuSignal(data as IPUSignal))
    const unsubVCP = subscribeToVCP(scripCode, (data) => setVcpSignal(data as VCPSignal))

    return () => {
      if (unsubIPU) unsubIPU.unsubscribe()
      if (unsubVCP) unsubVCP.unsubscribe()
    }
  }, [scripCode, subscribeToStock, subscribeToIPU, subscribeToVCP])

  // Use WebSocket data if available, fallback to API data
  const displayScore = (scripCode && wsScores.get(scripCode)) || score
  const displayWallet = wsWallet || wallet
  const displayQuantScore = wsQuantScore || quantScore

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


  const handleTradeExecute = async (order: { scripCode: string; direction: 'LONG' | 'SHORT'; entryPrice: number; stopLoss: number; target: number; quantity: number }) => {
    console.log(`[${tradingMode}] Executing trade:`, order)
    // TODO: Connect to order API
    alert(`${tradingMode} Trade: ${order.direction} ${order.quantity} lots of ${order.scripCode} @ ${order.entryPrice}`)
  }

  const handleClosePosition = () => {
    console.log('Closing position:', activePosition)
    // TODO: Connect to close position API
    alert(`Closing position for ${activePosition?.scripCode}`)
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-16 bg-slate-800/50 rounded-xl" />
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3 h-96 bg-slate-800/50 rounded-xl" />
          <div className="col-span-6 h-96 bg-slate-800/50 rounded-xl" />
          <div className="col-span-3 h-96 bg-slate-800/50 rounded-xl" />
        </div>
      </div>
    )
  }

  // No data state
  if (!displayScore) {
    return (
      <div className="text-center py-12">
        <div className="text-xl text-slate-400 mb-4">No data for {scripCode}</div>
        <Link to="/dashboard" className="btn btn-primary">
          Back to Dashboard
        </Link>
      </div>
    )
  }

  const priceChange = displayScore.close - displayScore.open
  const priceChangePercent = displayScore.open > 0 ? (priceChange / displayScore.open) * 100 : 0

  return (
    <div className="min-h-screen pb-20">
      {/* Header Bar */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-900/80 
                         border-b border-slate-700/50 backdrop-blur-sm sticky top-0 z-40 -mx-6 -mt-6 mb-6">
        {/* Left: Navigation + Stock Info */}
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-slate-400 hover:text-white transition-colors">
            ← Back
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">
              {displayScore.companyName || scripCode}
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-white">
                ₹{displayScore.close?.toFixed(2)}
              </span>
              <span className={`text-sm font-medium ${priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {priceChange >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
                {priceChange >= 0 ? ' ↑' : ' ↓'}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Trading Mode Toggle + Session */}
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
        </div>

        {/* Right: Wallet Summary */}
        <WalletHeader wallet={displayWallet} />
      </header>

      {/* Multi-Timeframe Analysis Section - Collapsible */}
      {allTimeframeScores.length > 0 && (
        <details className="mb-6 bg-slate-800/30 border border-slate-700/50 rounded-xl overflow-hidden" open>
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
                {directionConsensus.percentage.toFixed(0)}% {directionConsensus.dominant}
              </span>
            </div>
            <span className="text-slate-400 text-xs">Click to expand/collapse</span>
          </summary>
          <div className="p-4 space-y-4">
            {/* Score Heatmap - Full Width */}
            <MTFScoreHeatmap scores={allTimeframeScores} />

            {/* Microstructure and Options Flow - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MTFMicrostructurePanel scores={allTimeframeScores} />
              <MTFOptionsFlowPanel scores={allTimeframeScores} />
            </div>
          </div>
        </details>
      )}

      {/* Main Content - 3 Column Layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Column - MTF Analysis + Indicators */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <EnhancedMTFPanel
            scripCode={scripCode || ''}
            currentPrice={displayScore.close || 0}
          />

          {/* VCP Clusters */}
          {vcpSignal ? (
            <VCPClusters data={vcpSignal} />
          ) : (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3">VCP Module</h3>
              <div className="text-center py-4">
                <div className="text-3xl font-bold text-emerald-400 mb-1">
                  {(displayScore.vcpCombinedScore * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-slate-400">Combined Score</div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Runway</span>
                  <span className="text-white">{(displayScore.vcpRunway * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Support</span>
                  <span className="text-white">{(displayScore.vcpSupportScore * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Resistance</span>
                  <span className="text-white">{(displayScore.vcpResistanceScore * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* IPU Panel */}
          {ipuSignal ? (
            <IPUPanel data={ipuSignal} />
          ) : (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
                IPU Module
                {displayScore.ipuXfactor && <span className="text-yellow-400">⚡</span>}
              </h3>
              <div className="text-center py-4">
                <div className="text-3xl font-bold text-blue-400 mb-1">
                  {(displayScore.ipuFinalScore * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-slate-400">Final Score</div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Institutional</span>
                  <span className="text-white">{(displayScore.ipuInstProxy * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Momentum</span>
                  <span className="text-white">{displayScore.ipuMomentumState}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Exhaustion</span>
                  <span className="text-white">{(displayScore.ipuExhaustion * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Microstructure Panel - using QuantScore data */}
          <MicrostructurePanel
            data={{
              ofi: displayQuantScore?.microstructureSummary?.avgOFI || 0,
              ofiZScore: 0, // Z-score calculation would require historical data
              ofiRegime: getOfiRegime(displayQuantScore?.microstructureSummary?.flowDirection),
              vpin: displayQuantScore?.microstructureSummary?.avgVPIN || 0,
              vpinRegime: getVpinRegime(displayQuantScore?.microstructureSummary?.avgVPIN),
              kyleLambda: displayQuantScore?.microstructureSummary?.avgKyleLambda || 0,
              lambdaZScore: 0, // Z-score calculation would require historical data
              depthImbalance: displayQuantScore?.microstructureSummary?.avgDepthImbalance || 0,
              // Use actual aggressive buy/sell ratios from QuantScore
              buyPressure: (displayQuantScore?.microstructureSummary?.aggressiveBuyRatio || 0.5) * 100,
              sellPressure: (displayQuantScore?.microstructureSummary?.aggressiveSellRatio || 0.5) * 100,
              spread: displayQuantScore?.microstructureSummary?.avgSpread || 0,
              spreadZScore: 0 // Z-score calculation would require historical data
            }}
          />

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
                flipDetected: false
              },
              {
                name: 'SECURITY',
                value: 0.5,
                regime: displayScore.securityRegimeLabel?.includes('BULLISH') ? 'POSITIVE' :
                  displayScore.securityRegimeLabel?.includes('BEARISH') ? 'NEGATIVE' : 'NEUTRAL',
                zScore: 0,
                percentile: 50,
                flipDetected: false
              }
            ]}
          />

          {/* Active Setups from Market Intelligence */}
          <ActiveSetupsPanel setups={stockSetups} />
        </div>

        {/* Center Column - Chart + Narrative + Signals */}
        <div className="col-span-12 lg:col-span-6 space-y-6">
          {/* Price Chart */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                Price Action
              </h3>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>O: <span className="text-white">{displayScore.open?.toFixed(2)}</span></span>
                <span>H: <span className="text-emerald-400">{displayScore.high?.toFixed(2)}</span></span>
                <span>L: <span className="text-red-400">{displayScore.low?.toFixed(2)}</span></span>
                <span>C: <span className="text-white">{displayScore.close?.toFixed(2)}</span></span>
                <span>Vol: <span className="text-white">{(displayScore.volume / 1000).toFixed(0)}K</span></span>
              </div>
            </div>
            {scoreHistory.length > 0 ? (
              <PriceChart data={scoreHistory} height={280} showVolume />
            ) : (
              <div className="h-64 flex items-center justify-center bg-slate-700/30 rounded-lg">
                <span className="text-slate-500">Chart data loading...</span>
              </div>
            )}
          </div>

          {/* Price Narrative - using real Kafka narrative data when available */}
          <PriceNarrative
            score={displayScore}
            narrative={narrative}
            intelligence={marketIntel}
          />

          {/* Options Panel - using WebSocket QuantScore with API fallback */}
          <OptionsPanel quantScore={displayQuantScore} familyScore={displayScore} />

          {/* Signal History - merged WebSocket + API signals */}
          <SignalHistory signals={displaySignals} />

          {/* Gate Status */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4">Gate Status</h3>
            <div className="grid grid-cols-4 gap-3">
              {[
                { name: 'Hard', passed: displayScore.hardGatePassed, reason: displayScore.hardGateReason },
                { name: 'MTF', passed: displayScore.mtfGatePassed, reason: displayScore.mtfGateReason },
                { name: 'Quality', passed: displayScore.qualityGatePassed, reason: displayScore.qualityGateReason },
                { name: 'Stats', passed: displayScore.statsGatePassed, reason: displayScore.statsGateReason },
              ].map(gate => (
                <div key={gate.name} className={`p-3 rounded-lg text-center ${gate.passed
                  ? 'bg-emerald-500/10 border border-emerald-500/30'
                  : 'bg-red-500/10 border border-red-500/30'
                  }`}>
                  <div className={`text-lg mb-1 ${gate.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                    {gate.passed ? '✓' : '✗'}
                  </div>
                  <div className="text-xs font-medium text-white">{gate.name}</div>
                  {gate.reason && (
                    <div className="text-[10px] text-slate-400 mt-1 truncate" title={gate.reason}>
                      {gate.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Quick Trade + Module Summary */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <EnhancedQuickTradePanel
            score={displayScore}
            onExecute={handleTradeExecute}
            onWatchlist={() => console.log('Add to watchlist:', scripCode)}
          />

          {/* Regime Info */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4">Regime</h3>
            <div className="text-center mb-4">
              <div className={`text-2xl font-bold ${displayScore.securityAligned ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                {displayScore.indexRegimeLabel}
              </div>
              <div className="text-xs text-slate-400">Index Regime</div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Strength</span>
                <span className="text-white">{(displayScore.indexRegimeStrength * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Security</span>
                <span className="text-white">{displayScore.securityRegimeLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Aligned</span>
                <span className={displayScore.securityAligned ? 'text-emerald-400' : 'text-red-400'}>
                  {displayScore.securityAligned ? '✓ Yes' : '✗ No'}
                </span>
              </div>
            </div>
          </div>

          {/* OI/F&O Info */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wide mb-4">OI / F&O</h3>
            <div className="text-center mb-4">
              <div className={`text-lg font-bold ${displayScore.oiSignal?.includes('BULLISH') ? 'text-emerald-400' :
                displayScore.oiSignal?.includes('BEARISH') ? 'text-red-400' : 'text-slate-400'
                }`}>
                {displayScore.oiSignal || 'NEUTRAL'}
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">PCR</span>
                <span className="text-white">{displayScore.pcr?.toFixed(2) || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Spot-Future</span>
                <span className="text-white">{displayScore.spotFuturePremium?.toFixed(2) || 'N/A'}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Futures</span>
                <span className="text-white">{displayScore.futuresBuildup || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Overall Score */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">Overall Score</h3>
              <span className={`text-3xl font-bold ${displayScore.overallScore >= 7 ? 'text-emerald-400' :
                displayScore.overallScore >= 5 ? 'text-amber-400' :
                  'text-slate-400'
                }`}>
                {displayScore.overallScore.toFixed(1)}
              </span>
            </div>
            <div className="mt-3 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${displayScore.overallScore >= 7 ? 'bg-emerald-500' :
                  displayScore.overallScore >= 5 ? 'bg-amber-500' : 'bg-slate-500'
                  }`}
                style={{ width: `${displayScore.overallScore * 10}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-400">
              <span>Direction: <span className={
                displayScore.direction === 'BULLISH' ? 'text-emerald-400' :
                  displayScore.direction === 'BEARISH' ? 'text-red-400' : 'text-slate-400'
              }>{displayScore.direction}</span></span>
              <span>Signal: {displayScore.signalEmitted ?
                <span className="text-emerald-400">✓ Emitted</span> :
                <span className="text-slate-400">—</span>}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Position Bar (Fixed Footer) */}
      <ActivePositionBar
        position={activePosition}
        onClose={handleClosePosition}
      />
    </div>
  )
}
