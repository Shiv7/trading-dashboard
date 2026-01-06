import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { scoresApi, signalsApi, indicatorsApi, quantScoresApi } from '../services/api'
import { useDashboardStore } from '../store/dashboardStore'
import { useWebSocket } from '../hooks/useWebSocket'
import type { FamilyScore, Signal, IPUSignal, VCPSignal, QuantScore } from '../types'
import { IPUPanel } from '../components/Indicators/IPUPanel'
import { VCPClusters } from '../components/Indicators/VCPClusters'
import PriceChart from '../components/Charts/PriceChart'
import TradeModal from '../components/Trading/TradeModal'
import OptionsPanel from '../components/Options/OptionsPanel'

interface Contributor {
  category: string;
  points: number;
  reason: string;
  dataSource?: string;
  rawValue?: string;
}

interface Warning {
  type: string;
  severity: string;
  message: string;
}

interface ExplanationData {
  vcp?: Record<string, string | number | boolean>;
  ipu?: Record<string, string | number | boolean>;
  regime?: Record<string, string | number | boolean>;
  oi?: Record<string, string | number | boolean>;
  summary?: string;
  contributors?: Contributor[];
  warnings?: Warning[];
}

export default function StockDetailPage() {
  const { scripCode } = useParams<{ scripCode: string }>()
  const [score, setScore] = useState<FamilyScore | null>(null)
  const [explanation, setExplanation] = useState<ExplanationData | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [scoreHistory, setScoreHistory] = useState<FamilyScore[]>([])

  // New state for detailed indicators
  const [ipuSignal, setIpuSignal] = useState<IPUSignal | null>(null)
  const [vcpSignal, setVcpSignal] = useState<VCPSignal | null>(null)
  const [quantScore, setQuantScore] = useState<QuantScore | null>(null)

  // Trade modal state
  const [tradeModalOpen, setTradeModalOpen] = useState(false)

  const [loading, setLoading] = useState(true)

  const wsScores = useDashboardStore((s) => s.scores)
  const { subscribeToStock, subscribeToIPU, subscribeToVCP } = useWebSocket()

  useEffect(() => {
    if (!scripCode) return

    async function loadData() {
      try {
        const [scoreData, explainData, signalsData, ipuData, vcpData, historyData, quantData] = await Promise.all([
          scoresApi.getScore(scripCode!).catch(() => null),
          scoresApi.explainScore(scripCode!).catch(() => null),
          signalsApi.getSignalsForStock(scripCode!, 20).catch(() => []),
          indicatorsApi.getIPUSignal(scripCode!).catch(() => null),
          indicatorsApi.getVCPSignal(scripCode!).catch(() => null),
          scoresApi.getScoreHistory(scripCode!, 100).catch(() => []),
          quantScoresApi.getScore(scripCode!).catch(() => null),
        ])
        setScore(scoreData)
        setExplanation(explainData)
        setSignals(signalsData)
        setIpuSignal(ipuData)
        setVcpSignal(vcpData)
        setScoreHistory(historyData)
        setQuantScore(quantData)
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

  // Use WebSocket score if available
  const displayScore = (scripCode && wsScores.get(scripCode)) || score

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading stock details...</div>
      </div>
    )
  }

  if (!displayScore) {
    return (
      <div className="text-center py-12">
        <div className="text-xl text-slate-400 mb-4">No data for {scripCode}</div>
        <Link to="/scores" className="btn btn-primary">
          Back to Scores
        </Link>
      </div>
    )
  }

  const renderExplanationSection = (title: string, data: Record<string, string | number | boolean>) => (
    <div className="bg-slate-700/30 rounded-lg p-4">
      <h4 className="font-medium text-white mb-3">{title}</h4>
      <div className="space-y-2 text-sm">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex justify-between">
            <span className="text-slate-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
            <span className="text-white">
              {typeof value === 'boolean' ? (value ? '✅' : '❌') :
                typeof value === 'number' ? (value < 1 ? `${(value * 100).toFixed(1)}%` : value.toFixed(2)) :
                  String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link to="/scores" className="text-sm text-blue-400 hover:text-blue-300 mb-2 block">
            ← Back to Scores
          </Link>
          <h1 className="text-2xl font-display font-bold text-white">
            {displayScore.companyName || scripCode}
          </h1>
          <div className="text-slate-400 text-sm">
            {scripCode} • {displayScore.timeframe} • Last updated: {new Date(displayScore.timestamp).toLocaleTimeString()}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className={`text-4xl font-bold ${displayScore.overallScore >= 7 ? 'text-emerald-400' : displayScore.overallScore >= 5 ? 'text-amber-400' : 'text-slate-400'}`}>
              {displayScore.overallScore.toFixed(1)}
            </div>
            <div className="text-sm text-slate-400">Overall Score</div>
          </div>
          <button
            onClick={() => setTradeModalOpen(true)}
            className={`px-6 py-3 rounded-xl font-bold text-lg transition-all flex items-center gap-2 shadow-lg ${
              displayScore.direction === 'BULLISH'
                ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-emerald-500/30'
                : displayScore.direction === 'BEARISH'
                  ? 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-red-500/30'
                  : 'bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white shadow-slate-500/30'
            }`}
          >
            {displayScore.direction === 'BULLISH' ? '🚀' : displayScore.direction === 'BEARISH' ? '📉' : '📊'}
            Trade Now
          </button>
        </div>
      </div>

      {/* Price Chart */}
      <div className="card">
        <div className="card-header">
          <span>📈 Price Action</span>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>O: <span className="text-white">{displayScore.open?.toFixed(2)}</span></span>
            <span>H: <span className="text-emerald-400">{displayScore.high?.toFixed(2)}</span></span>
            <span>L: <span className="text-red-400">{displayScore.low?.toFixed(2)}</span></span>
            <span>C: <span className="text-white">{displayScore.close?.toFixed(2)}</span></span>
            <span>Vol: <span className="text-white">{(displayScore.volume / 1000).toFixed(0)}K</span></span>
          </div>
        </div>
        {scoreHistory.length > 0 ? (
          <PriceChart
            data={scoreHistory}
            height={280}
            showVolume
          />
        ) : (
          <div className="flex items-center justify-center h-64 bg-slate-700/30 rounded-lg">
            <span className="text-slate-500">Chart data loading...</span>
          </div>
        )}
      </div>

      {/* Module Scores */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* VCP */}
        {vcpSignal ? (
          <VCPClusters data={vcpSignal} />
        ) : (
          <div className="card">
            <div className="card-header">📊 VCP Module</div>
            <div className="text-3xl font-bold text-center mb-4" style={{ color: displayScore.vcpCombinedScore >= 0.7 ? '#10b981' : displayScore.vcpCombinedScore >= 0.4 ? '#f59e0b' : '#6b7280' }}>
              {(displayScore.vcpCombinedScore * 100).toFixed(0)}%
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Runway</span><span>{(displayScore.vcpRunway * 100).toFixed(0)}%</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Structural Bias</span><span>{displayScore.vcpStructuralBias.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Support</span><span>{(displayScore.vcpSupportScore * 100).toFixed(0)}%</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Resistance</span><span>{(displayScore.vcpResistanceScore * 100).toFixed(0)}%</span></div>
            </div>
          </div>
        )}

        {/* IPU */}
        {ipuSignal ? (
          <IPUPanel data={ipuSignal} />
        ) : (
          <div className="card">
            <div className="card-header">
              🏛️ IPU Module
              {displayScore.ipuXfactor && <span className="text-yellow-400 ml-2">⚡ X-Factor</span>}
            </div>
            <div className="text-3xl font-bold text-center mb-4" style={{ color: displayScore.ipuFinalScore >= 0.7 ? '#10b981' : displayScore.ipuFinalScore >= 0.4 ? '#f59e0b' : '#6b7280' }}>
              {(displayScore.ipuFinalScore * 100).toFixed(0)}%
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Institutional</span><span>{(displayScore.ipuInstProxy * 100).toFixed(0)}%</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Momentum</span><span>{displayScore.ipuMomentumState}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Exhaustion</span><span>{(displayScore.ipuExhaustion * 100).toFixed(0)}%</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Urgency</span><span>{(displayScore.ipuUrgency * 100).toFixed(0)}%</span></div>
            </div>
          </div>
        )}

        {/* Regime */}
        <div className="card">
          <div className="card-header">🌍 Regime</div>
          <div className={`text-2xl font-bold text-center mb-4 ${displayScore.securityAligned ? 'text-emerald-400' : 'text-amber-400'}`}>
            {displayScore.indexRegimeLabel}
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Index Strength</span><span>{(displayScore.indexRegimeStrength * 100).toFixed(0)}%</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Security</span><span>{displayScore.securityRegimeLabel}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Aligned</span><span>{displayScore.securityAligned ? '✅' : '❌'}</span></div>
          </div>
        </div>

        {/* OI/F&O */}
        <div className="card">
          <div className="card-header">📈 OI/F&O</div>
          <div className={`text-xl font-bold text-center mb-4 ${displayScore.oiSignal?.includes('BULLISH') ? 'text-emerald-400' : displayScore.oiSignal?.includes('BEARISH') ? 'text-red-400' : 'text-slate-400'}`}>
            {displayScore.oiSignal || 'NEUTRAL'}
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">PCR</span><span>{displayScore.pcr?.toFixed(2) || 'N/A'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Spot-Future</span><span>{displayScore.spotFuturePremium?.toFixed(2) || 'N/A'}%</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Futures</span><span>{displayScore.futuresBuildup}</span></div>
          </div>
        </div>
      </div>

      {/* Options Analytics - Institutional Grade */}
      <OptionsPanel quantScore={quantScore} />

      {/* Gates */}
      <div className="card">
        <div className="card-header">🚪 Gate Status</div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { name: 'Hard Gate', passed: displayScore.hardGatePassed, reason: displayScore.hardGateReason },
            { name: 'MTF Gate', passed: displayScore.mtfGatePassed, reason: displayScore.mtfGateReason },
            { name: 'Quality Gate', passed: displayScore.qualityGatePassed, reason: displayScore.qualityGateReason },
            { name: 'Stats Gate', passed: displayScore.statsGatePassed, reason: displayScore.statsGateReason },
          ].map(gate => (
            <div key={gate.name} className={`p-4 rounded-lg ${gate.passed ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={gate.passed ? 'text-emerald-400' : 'text-red-400'}>
                  {gate.passed ? '✅' : '❌'}
                </span>
                <span className="font-medium text-white">{gate.name}</span>
              </div>
              {gate.reason && (
                <div className="text-xs text-slate-400">{gate.reason}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Explanation */}
      {explanation && (
        <div className="card">
          <div className="card-header">📝 Score Explanation</div>

          {/* Contributors - Score Breakdown */}
          {explanation.contributors && explanation.contributors.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-slate-300 mb-2">Score Contributors</h4>
              <div className="space-y-2">
                {explanation.contributors.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-slate-700/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${c.points > 0 ? 'bg-emerald-500/20 text-emerald-400' : c.points < 0 ? 'bg-red-500/20 text-red-400' : 'bg-slate-500/20 text-slate-400'}`}>
                        {c.points > 0 ? '+' : ''}{c.points.toFixed(1)}
                      </span>
                      <span className="text-white text-sm">{c.category.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="text-xs text-slate-400">{c.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {explanation.warnings && explanation.warnings.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-yellow-400 mb-2">⚠️ Warnings</h4>
              <div className="space-y-2">
                {explanation.warnings.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <span className={`text-xs px-2 py-0.5 rounded ${w.severity === 'HIGH' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                      {w.severity}
                    </span>
                    <span className="text-sm text-slate-300">{w.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {explanation.vcp && renderExplanationSection('VCP Analysis', explanation.vcp)}
            {explanation.ipu && renderExplanationSection('IPU Analysis', explanation.ipu)}
            {explanation.regime && renderExplanationSection('Regime Analysis', explanation.regime)}
            {explanation.oi && renderExplanationSection('OI Analysis', explanation.oi)}
          </div>
          {explanation.summary && (
            <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="font-medium text-blue-400 mb-1">Summary</div>
              <div className="text-slate-300">{explanation.summary}</div>
            </div>
          )}
        </div>
      )}

      {/* Signal History */}
      <div className="card">
        <div className="card-header">📜 Signal History</div>
        {signals.length > 0 ? (
          <div className="space-y-2">
            {signals.map(signal => (
              <div key={signal.signalId} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <div>
                  <span className={`badge ${signal.direction === 'BULLISH' ? 'badge-success' : 'badge-danger'}`}>
                    {signal.direction}
                  </span>
                  <span className="ml-2 text-slate-400 text-sm">
                    {new Date(signal.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`badge ${signal.allGatesPassed ? 'badge-success' : 'badge-danger'}`}>
                    {signal.allGatesPassed ? 'PASSED' : 'REJECTED'}
                  </span>
                  {signal.rMultiple !== undefined && (
                    <span className={signal.rMultiple >= 0 ? 'num-positive' : 'num-negative'}>
                      {signal.rMultiple >= 0 ? '+' : ''}{signal.rMultiple.toFixed(2)}R
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-slate-500 py-8">
            No signals for this stock
          </div>
        )}
      </div>

      {/* Trade Modal */}
      <TradeModal
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        scripCode={scripCode || ''}
        companyName={displayScore.companyName}
        currentPrice={displayScore.close}
        direction={displayScore.direction as 'BULLISH' | 'BEARISH' | 'NEUTRAL'}
        quantScore={displayScore.overallScore * 10}
      />
    </div>
  )
}

