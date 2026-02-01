import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { quantScoresApi } from '../services/api'
import type { QuantScore, QuantScoreStats } from '../types'
import TradeModal from '../components/Trading/TradeModal'
import { useDashboardStore } from '../store/dashboardStore'
import { useWebSocket } from '../hooks/useWebSocket'

// 8 Categories with their configurations
const CATEGORIES = [
  { key: 'greeks', label: 'Greeks', max: 15, color: 'purple', icon: 'Δ', desc: 'Delta, Gamma, Vega exposure' },
  { key: 'ivSurface', label: 'IV Surface', max: 12, color: 'blue', icon: 'σ', desc: 'Volatility rank & skew' },
  { key: 'microstructure', label: 'Microstructure', max: 18, color: 'cyan', icon: '⚡', desc: 'OFI, VPIN, Kyle Lambda' },
  { key: 'optionsFlow', label: 'Options Flow', max: 15, color: 'amber', icon: '🌊', desc: 'PCR, OI buildup' },
  { key: 'priceAction', label: 'Price Action', max: 12, color: 'emerald', icon: '📊', desc: 'Wyckoff, sequences' },
  { key: 'volumeProfile', label: 'Vol Profile', max: 8, color: 'rose', icon: '📈', desc: 'POC, value area' },
  { key: 'crossInstrument', label: 'Cross-Inst', max: 10, color: 'indigo', icon: '🔗', desc: 'Spot-future premium' },
  { key: 'confluence', label: 'Confluence', max: 10, color: 'orange', icon: '⚙️', desc: 'Multi-signal agreement' },
] as const

type CategoryKey = typeof CATEGORIES[number]['key']
type FilterTab = 'all' | CategoryKey

export default function QuantScoresPage() {
  const [apiScores, setApiScores] = useState<QuantScore[]>([])
  const [stats, setStats] = useState<QuantScoreStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH'>('ALL')
  const [instrumentFilter, setInstrumentFilter] = useState<'ALL' | 'EQUITY' | 'INDEX' | 'COMMODITY'>('ALL')
  const [actionableOnly, setActionableOnly] = useState(false)
  const [selectedScore, setSelectedScore] = useState<QuantScore | null>(null)
  const [tradeModal, setTradeModal] = useState<{ open: boolean; score: QuantScore | null }>({ open: false, score: null })

  // WebSocket for real-time updates
  const { connected } = useWebSocket()
  const { quantScores: wsQuantScores, bulkUpdateQuantScores } = useDashboardStore()

  // Merge API scores with real-time WebSocket updates
  // FIX BUG #4: Changed from Map iteration to Record iteration after store change
  const scores = useMemo(() => {
    const scoreMap = new Map<string, QuantScore>()
    // First add all API scores
    apiScores.forEach(s => {
      if (s && s.scripCode) scoreMap.set(s.scripCode, s)
    })
    // Then override with any real-time WebSocket updates (nested record: scripCode -> timeframe -> score)
    // wsQuantScores is now Record<string, Record<string, QuantScore>>
    for (const [scripCode, tfRecord] of Object.entries(wsQuantScores)) {
      if (!tfRecord || typeof tfRecord !== 'object') continue
      // Get the latest score by timestamp from all timeframes
      let latestScore: QuantScore | undefined
      let latestTime = 0
      for (const score of Object.values(tfRecord)) {
        if (score && score.timestamp > latestTime) {
          latestTime = score.timestamp
          latestScore = score
        }
      }
      if (latestScore) {
        scoreMap.set(scripCode, latestScore)
      }
    }
    return Array.from(scoreMap.values())
  }, [apiScores, wsQuantScores])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000) // Fallback polling every 30s
    return () => clearInterval(interval)
  }, [])

  const loadData = async () => {
    try {
      const [scoresData, statsData] = await Promise.all([
        quantScoresApi.getAllScores(200),
        quantScoresApi.getStats(),
      ])
      setApiScores(scoresData)
      setStats(statsData)
      // Also populate the store with initial data
      bulkUpdateQuantScores(scoresData)
    } catch (error) {
      console.error('Failed to load quant scores:', error)
    } finally {
      setLoading(false)
    }
  }

  // Helper functions
  const getCategoryScore = (score: QuantScore, key: CategoryKey): number => {
    if (!score.breakdown) return 0
    const map: Record<CategoryKey, number> = {
      greeks: score.breakdown.greeksScore || 0,
      ivSurface: score.breakdown.ivSurfaceScore || 0,
      microstructure: score.breakdown.microstructureScore || 0,
      optionsFlow: score.breakdown.optionsFlowScore || 0,
      priceAction: score.breakdown.priceActionScore || 0,
      volumeProfile: score.breakdown.volumeProfileScore || 0,
      crossInstrument: score.breakdown.crossInstrumentScore || 0,
      confluence: score.breakdown.confluenceScore || 0,
    }
    return map[key]
  }

  // Filter & sort scores
  const filteredScores = useMemo(() => {
    let result = scores

    if (directionFilter !== 'ALL') {
      result = result.filter(s => s.direction === directionFilter)
    }

    if (instrumentFilter !== 'ALL') {
      result = result.filter(s => {
        const code = s.scripCode?.toUpperCase() || ''
        if (instrumentFilter === 'INDEX') return code.includes('NIFTY') || code.includes('BANKNIFTY') || code.includes('FINNIFTY')
        if (instrumentFilter === 'COMMODITY') return code.includes('GOLD') || code.includes('SILVER') || code.includes('CRUDE')
        return !code.includes('NIFTY') && !code.includes('GOLD') && !code.includes('SILVER') && !code.includes('CRUDE')
      })
    }

    if (actionableOnly) {
      result = result.filter(s => s.actionable)
    }

    // Sort by selected category if not 'all'
    if (activeTab !== 'all') {
      result = [...result].sort((a, b) => getCategoryScore(b, activeTab) - getCategoryScore(a, activeTab))
    } else {
      result = [...result].sort((a, b) => (b.quantScore || 0) - (a.quantScore || 0))
    }

    return result
  }, [scores, directionFilter, instrumentFilter, actionableOnly, activeTab])

  const getScoreColor = (score: number) => {
    if (score >= 75) return 'text-emerald-400'
    if (score >= 60) return 'text-blue-400'
    if (score >= 45) return 'text-amber-400'
    return 'text-slate-400'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading QuantScores...</div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {/* Compact Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white">QuantScores</h1>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              {connected ? 'Live' : 'Offline'}
            </div>
          </div>
          {stats && (
            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-400">
                <span className="text-white font-medium">{filteredScores.length}</span>/{stats.totalSymbols}
              </span>
              <span className="text-emerald-400">↑{stats.bullishCount}</span>
              <span className="text-red-400">↓{stats.bearishCount}</span>
              <span className="text-amber-400">⚡{stats.actionableCount}</span>
            </div>
          )}
        </div>

        {/* Unified Filter Bar */}
        <div className="flex items-center gap-2 bg-slate-800/30 rounded-lg p-1.5">
          {/* Category Icons - Compact */}
          <div className="flex items-center gap-0.5 border-r border-slate-700 pr-2">
            <button
              onClick={() => setActiveTab('all')}
              className={`w-8 h-8 rounded-md flex items-center justify-center text-sm transition-all ${activeTab === 'all' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white hover:bg-slate-700/50'
                }`}
              title="All Categories"
            >
              ∑
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveTab(cat.key)}
                className={`w-8 h-8 rounded-md flex items-center justify-center text-sm transition-all ${activeTab === cat.key
                  ? 'bg-slate-700 text-white ring-1 ring-amber-500/50'
                  : 'text-slate-500 hover:text-white hover:bg-slate-700/50'
                  }`}
                title={`${cat.label} (max ${cat.max})`}
              >
                {cat.icon}
              </button>
            ))}
          </div>

          {/* Direction Filter */}
          <div className="flex items-center gap-0.5">
            {[
              { key: 'ALL', label: 'All', icon: '○' },
              { key: 'BULLISH', label: 'Bull', icon: '↑', color: 'emerald' },
              { key: 'BEARISH', label: 'Bear', icon: '↓', color: 'red' }
            ].map((d) => (
              <button
                key={d.key}
                onClick={() => setDirectionFilter(d.key as typeof directionFilter)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${directionFilter === d.key
                  ? d.color ? `bg-${d.color}-500/20 text-${d.color}-400` : 'bg-slate-700 text-white'
                  : 'text-slate-500 hover:text-white'
                  }`}
                title={d.label}
              >
                {d.icon}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-slate-700" />

          {/* Instrument Filter */}
          <div className="flex items-center gap-0.5">
            {[
              { key: 'ALL', label: 'All' },
              { key: 'EQUITY', label: 'EQ' },
              { key: 'INDEX', label: 'IDX' },
              { key: 'COMMODITY', label: 'COM' }
            ].map((inst) => (
              <button
                key={inst.key}
                onClick={() => setInstrumentFilter(inst.key as typeof instrumentFilter)}
                className={`px-2 py-1.5 rounded-md text-[10px] font-medium transition-all ${instrumentFilter === inst.key ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white'
                  }`}
              >
                {inst.label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-slate-700" />

          {/* Actionable Toggle */}
          <button
            onClick={() => setActionableOnly(!actionableOnly)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${actionableOnly ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-white'
              }`}
          >
            ⚡
          </button>

          {/* Active Category Label */}
          {activeTab !== 'all' && (
            <div className="ml-auto px-2 py-1 bg-slate-700/50 rounded text-[10px] text-slate-400">
              Sorted by: <span className="text-white">{CATEGORIES.find(c => c.key === activeTab)?.label}</span>
            </div>
          )}
        </div>

        {/* Main Grid: List + Detail Panel */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Scores List */}
          <div className="xl:col-span-2 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-2">
            {filteredScores.slice(0, 100).map((score) => (
              <ScoreCard
                key={score.scripCode}
                score={score}
                isSelected={selectedScore?.scripCode === score.scripCode}
                activeTab={activeTab}
                getCategoryScore={getCategoryScore}
                getScoreColor={getScoreColor}
                onSelect={() => setSelectedScore(score)}
                onTrade={() => setTradeModal({ open: true, score })}
              />
            ))}

            {filteredScores.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                No stocks match current filters
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="xl:sticky xl:top-4 xl:h-fit">
            {selectedScore ? (
              <ScoreDetailPanel
                score={selectedScore}
                onTrade={() => setTradeModal({ open: true, score: selectedScore })}
              />
            ) : (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-8 text-center">
                <div className="text-5xl mb-4">📊</div>
                <div className="text-slate-400 mb-2">Select a stock</div>
                <div className="text-xs text-slate-500">Click any row to view detailed breakdown</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trade Modal */}
      <TradeModal
        isOpen={tradeModal.open}
        onClose={() => setTradeModal({ open: false, score: null })}
        scripCode={tradeModal.score?.scripCode || ''}
        companyName={tradeModal.score?.symbol}
        currentPrice={0}
        direction={tradeModal.score?.direction as 'BULLISH' | 'BEARISH' | 'NEUTRAL'}
        quantScore={tradeModal.score?.quantScore}
      />
    </>
  )
}

// Score Card Component
interface ScoreCardProps {
  score: QuantScore
  isSelected: boolean
  activeTab: FilterTab
  getCategoryScore: (s: QuantScore, k: CategoryKey) => number
  getScoreColor: (n: number) => string
  onSelect: () => void
  onTrade: () => void
}

function ScoreCard({ score, isSelected, activeTab, getCategoryScore, getScoreColor, onSelect, onTrade }: ScoreCardProps) {
  const categoryScore = activeTab !== 'all' ? getCategoryScore(score, activeTab) : null
  const categoryMax = activeTab !== 'all' ? CATEGORIES.find(c => c.key === activeTab)?.max : null

  return (
    <div
      onClick={onSelect}
      className={`bg-slate-800/30 border rounded-lg px-3 py-2.5 cursor-pointer transition-all hover:bg-slate-800/60 flex items-center gap-3 ${isSelected ? 'border-amber-500/50 bg-slate-800/60' : 'border-slate-700/30'
        }`}
    >
      {/* Direction Indicator */}
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${score.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
        score.direction === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
          'bg-slate-700/50 text-slate-500'
        }`}>
        {score.direction === 'BULLISH' ? '↑' : score.direction === 'BEARISH' ? '↓' : '−'}
      </div>

      {/* Symbol & Label */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            to={`/stock/${score.scripCode}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-white hover:text-amber-400 transition-colors truncate"
          >
            {score.symbol || score.scripCode}
          </Link>
          {score.actionable && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">⚡</span>
          )}
        </div>
        {score.warnings && score.warnings.length > 0 && (
          <div className="text-[9px] text-slate-500 truncate">
            {score.warnings[0].type?.replace(/_/g, ' ')}
          </div>
        )}
      </div>

      {/* Category Score (when filtered) */}
      {/* FIX BUG #1: Added null guard for categoryMax */}
      {activeTab !== 'all' && categoryScore !== null && categoryMax != null && (
        <div className="text-right text-xs">
          <div className="text-white font-medium">{categoryScore.toFixed(1)}</div>
          <div className="text-slate-500">/{categoryMax}</div>
        </div>
      )}

      {/* Main Score */}
      {/* FIX BUG #3: Added fallback for undefined quantScore */}
      <div className="text-right flex-shrink-0">
        <div className={`text-lg font-bold ${getScoreColor(score.quantScore ?? 0)}`}>
          {(score.quantScore ?? 0).toFixed(0)}
        </div>
      </div>

      {/* Trade Button */}
      <button
        onClick={(e) => { e.stopPropagation(); onTrade() }}
        className="px-2 py-1.5 bg-blue-500/10 text-blue-400 rounded text-[10px] font-medium hover:bg-blue-500/20 transition-colors flex-shrink-0"
      >
        Trade
      </button>
    </div>
  )
}

// Detail Panel Component
function ScoreDetailPanel({ score, onTrade }: { score: QuantScore; onTrade: () => void }) {
  const fmt = (n: number | undefined | null, d = 2) => n == null || isNaN(n) ? '-' : n.toFixed(d)
  // FIX BUG #5: Handle both 0-1 range and 0-100 range percentages
  const fmtPct = (n: number | undefined | null) => {
    if (n == null || isNaN(n)) return '-'
    // If value is > 1, assume it's already a percentage (0-100)
    // If value is <= 1, assume it's a ratio (0-1) and multiply by 100
    const pct = n > 1 ? n : n * 100
    return `${pct.toFixed(0)}%`
  }

  return (
    <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
      {/* Header */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <Link to={`/stock/${score.scripCode}`} className="text-lg font-bold text-white hover:text-amber-400">
              {score.symbol || score.scripCode}
            </Link>
            <div className="text-xs text-slate-400">{score.humanReadableTime} | {score.timeframe}</div>
          </div>
          {/* FIX BUG #3: Added fallback for undefined quantScore */}
          <div className={`text-3xl font-bold ${(score.quantScore ?? 0) >= 75 ? 'text-emerald-400' : (score.quantScore ?? 0) >= 60 ? 'text-blue-400' :
            (score.quantScore ?? 0) >= 45 ? 'text-amber-400' : 'text-slate-400'
            }`}>
            {(score.quantScore ?? 0).toFixed(1)}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-2 py-1 rounded ${score.direction === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
            score.direction === 'BEARISH' ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-400'
            }`}>
            {score.direction}
          </span>
          <span className="text-slate-400">Confidence: {fmtPct(score.confidence)}</span>
          {score.breakdown && <span className="text-slate-400">Regime: {fmt(score.breakdown.regimeModifier)}x</span>}
        </div>
        <button
          onClick={onTrade}
          className="mt-3 w-full py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-indigo-700 transition-all"
        >
          Trade Now
        </button>
      </div>

      {/* 8-Category Breakdown */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white mb-3">8-Category Breakdown</h3>
        <div className="space-y-2">
          {CATEGORIES.map((cat) => {
            const value = score.breakdown ? (score.breakdown as any)[`${cat.key}Score`] || 0 : 0
            const pct = score.breakdown ? (score.breakdown as any)[`${cat.key}Pct`] || 0 : 0
            return (
              <div key={cat.key} className="flex items-center gap-2">
                <span className="w-5 text-center text-sm">{cat.icon}</span>
                <span className="text-[11px] text-slate-400 w-20 truncate">{cat.label}</span>
                <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-slate-600'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] text-white w-14 text-right">{fmt(value, 1)}/{cat.max}</span>
              </div>
            )
          })}
        </div>
        {score.breakdown && (
          <div className="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-400 flex justify-between">
            <span>Raw: {fmt(score.breakdown.rawScore)}</span>
            <span>Regime: {fmt(score.breakdown.regimeModifier)}x</span>
            <span>Conf: {fmt(score.breakdown.confidenceModifier)}x</span>
          </div>
        )}
      </div>

      {/* Score Aggregation Explanation */}
      {score.breakdown && (
        <details className="bg-slate-800/50 border border-slate-700/50 rounded-xl group">
          <summary className="p-4 cursor-pointer flex items-center justify-between text-sm font-bold text-white hover:text-amber-400 transition-colors">
            <span className="flex items-center gap-2">
              <span className="text-amber-400">📐</span> How QuantScore is Calculated
            </span>
            <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="px-4 pb-4 space-y-3 text-xs">
            {/* Formula Overview */}
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-slate-400 mb-1">Formula:</div>
              <code className="text-emerald-400 text-[11px]">
                QuantScore = Raw Score × Regime × Confidence
              </code>
              <div className="mt-2 text-slate-400">
                = {fmt(score.breakdown.rawScore)} × {fmt(score.breakdown.regimeModifier)} × {fmt(score.breakdown.confidenceModifier)} = <span className="text-white font-bold">{fmt(score.quantScore)}</span>
              </div>
            </div>

            {/* Category Weights */}
            <div className="space-y-1.5">
              <div className="text-slate-400 font-medium">Category Weights (Max: 100 total):</div>
              <div className="grid grid-cols-2 gap-1">
                {CATEGORIES.map(cat => (
                  <div key={cat.key} className="flex justify-between text-[10px]">
                    <span className="text-slate-400">{cat.icon} {cat.label}</span>
                    <span className="text-white font-medium">{cat.max} pts</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-600 pt-1 flex justify-between text-[10px] font-medium">
                <span className="text-slate-300">Total Max Score</span>
                <span className="text-amber-400">100 pts</span>
              </div>
            </div>

            {/* Modifiers Explanation */}
            <div className="space-y-1.5">
              <div className="text-slate-400 font-medium">Modifiers:</div>
              <div className="text-[10px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Regime Modifier</span>
                  <span className="text-white">{fmt(score.breakdown.regimeModifier)}x <span className="text-slate-500">(0.7-1.3)</span></span>
                </div>
                <div className="text-slate-500 pl-2">↳ Boosts score in favorable market regime, reduces in unfavorable</div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Confidence Modifier</span>
                  <span className="text-white">{fmt(score.breakdown.confidenceModifier)}x <span className="text-slate-500">(0.8-1.0)</span></span>
                </div>
                <div className="text-slate-500 pl-2">↳ Reduces score when data quality is incomplete</div>
              </div>
            </div>

            {/* Interpretation */}
            <div className="bg-gradient-to-r from-emerald-500/10 to-amber-500/10 rounded-lg p-2">
              <div className="text-[10px] text-slate-300">
                <strong>Interpretation:</strong> Score ≥75 = Strong conviction, 60-74 = Moderate, 45-59 = Weak, &lt;45 = No action
              </div>
            </div>
          </div>
        </details>
      )}

      {/* Greeks Summary */}
      {score.greeksSummary && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <span className="text-purple-400">Δ</span> Greeks Exposure
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${score.greeksSummary.deltaBias?.includes('BULL') ? 'bg-emerald-500/20 text-emerald-400' :
              score.greeksSummary.deltaBias?.includes('BEAR') ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-400'
              }`}>
              {score.greeksSummary.deltaBias}
            </span>
          </h3>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="bg-slate-700/30 rounded-lg p-2 text-center">
              <div className="text-slate-400 mb-1">Delta</div>
              <div className={`font-bold ${(score.greeksSummary.totalDelta || 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt(score.greeksSummary.totalDelta)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2 text-center">
              <div className="text-slate-400 mb-1">Gamma</div>
              <div className="text-purple-400 font-bold">{fmt(score.greeksSummary.totalGamma, 4)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2 text-center">
              <div className="text-slate-400 mb-1">Vega</div>
              <div className="text-blue-400 font-bold">{fmt(score.greeksSummary.totalVega)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2 text-center">
              <div className="text-slate-400 mb-1">Theta</div>
              <div className="text-amber-400 font-bold">{fmt(score.greeksSummary.totalTheta)}</div>
            </div>
          </div>
          {score.greeksSummary.gammaSqueezeRisk && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
              <span>⚠️</span>
              <span>Gamma Squeeze Risk - Distance: {fmt(score.greeksSummary.gammaSqueezeDistance)}% to max gamma strike {fmt(score.greeksSummary.maxGammaStrike, 0)}</span>
            </div>
          )}
        </div>
      )}

      {/* Microstructure */}
      {score.microstructureSummary && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <span className="text-cyan-400">⚡</span> Microstructure
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${score.microstructureSummary.flowDirection === 'BUYING' ? 'bg-emerald-500/20 text-emerald-400' :
              score.microstructureSummary.flowDirection === 'SELLING' ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-400'
              }`}>
              {score.microstructureSummary.flowDirection} {fmtPct(score.microstructureSummary.flowStrength)}
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Order Flow Imbalance</div>
              <div className="text-cyan-400 font-bold">{fmt(score.microstructureSummary.avgOFI)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">VPIN (Informed Trading)</div>
              <div className={`font-bold ${(score.microstructureSummary.avgVPIN || 0) > 0.7 ? 'text-red-400' : 'text-cyan-400'}`}>
                {fmtPct(score.microstructureSummary.avgVPIN)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Depth Imbalance</div>
              <div className="text-cyan-400 font-bold">{fmtPct(score.microstructureSummary.avgDepthImbalance)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Kyle Lambda (Impact)</div>
              <div className="text-cyan-400 font-bold">{fmt(score.microstructureSummary.avgKyleLambda, 5)}</div>
            </div>
          </div>
        </div>
      )}

      {/* IV Surface */}
      {score.ivSummary && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <span className="text-blue-400">σ</span> IV Surface
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${score.ivSummary.ivSignal === 'HIGH' ? 'bg-red-500/20 text-red-400' :
              score.ivSummary.ivSignal === 'LOW' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
              }`}>
              {score.ivSummary.ivSignal}
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">ATM IV</div>
              <div className="text-white font-bold">{fmt(score.ivSummary.atmIV)}%</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">IV Rank</div>
              <div className={`font-bold ${(score.ivSummary.ivRank || 0) > 0.7 ? 'text-red-400' : (score.ivSummary.ivRank || 0) < 0.3 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {fmtPct(score.ivSummary.ivRank)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">25-Delta Skew</div>
              <div className="text-white font-bold">{fmt(score.ivSummary.skew25Delta)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Term Structure</div>
              <div className="text-white font-bold">{score.ivSummary.termStructure || '-'}</div>
            </div>
          </div>
          {score.ivSummary.ivCrushRisk && (
            <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-xs text-yellow-400">
              ⚠️ IV Crush Risk - Consider selling premium
            </div>
          )}
        </div>
      )}

      {/* Options Flow */}
      {score.optionsFlowSummary && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <span className="text-amber-400">🌊</span> Options Flow
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${score.optionsFlowSummary.pcrSignal?.includes('BULL') || score.optionsFlowSummary.pcrSignal?.includes('GREED') ? 'bg-emerald-500/20 text-emerald-400' :
              score.optionsFlowSummary.pcrSignal?.includes('BEAR') || score.optionsFlowSummary.pcrSignal?.includes('FEAR') ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-400'
              }`}>
              {score.optionsFlowSummary.pcrSignal?.replace(/_/g, ' ')}
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Put/Call Ratio</div>
              <div className={`font-bold ${(score.optionsFlowSummary.pcr || 0) > 1.2 ? 'text-red-400' : (score.optionsFlowSummary.pcr || 0) < 0.8 ? 'text-emerald-400' : 'text-white'}`}>
                {fmt(score.optionsFlowSummary.pcr)} ({score.optionsFlowSummary.pcrChange > 0 ? '+' : ''}{fmt(score.optionsFlowSummary.pcrChange)})
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">OI Buildup</div>
              <div className="text-white font-bold text-[11px]">{score.optionsFlowSummary.oiBuildupType?.replace(/_/g, ' ') || '-'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Futures</div>
              <div className="text-white font-bold text-[11px]">{score.optionsFlowSummary.futuresBuildup?.replace(/_/g, ' ') || '-'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Spot-Fut Premium</div>
              <div className={`font-bold ${(score.optionsFlowSummary.spotFuturePremium || 0) > 0.5 ? 'text-emerald-400' : (score.optionsFlowSummary.spotFuturePremium || 0) < -0.5 ? 'text-red-400' : 'text-white'}`}>
                {fmt(score.optionsFlowSummary.spotFuturePremium)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Price Action */}
      {score.priceActionSummary && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <span className="text-emerald-400">📊</span> Price Action
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Wyckoff Phase</div>
              <div className="text-white font-bold">{score.priceActionSummary.wyckoffPhase || '-'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Sequence Type</div>
              <div className="text-white font-bold">{score.priceActionSummary.sequenceType || '-'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Momentum Slope</div>
              <div className={`font-bold ${(score.priceActionSummary.momentumSlope || 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt(score.priceActionSummary.momentumSlope)}
              </div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2">
              <div className="text-slate-400">Divergences</div>
              <div className="text-white font-bold text-[11px]">
                {score.priceActionSummary.pcrDivergence ? 'PCR ' : ''}
                {score.priceActionSummary.oiDivergence ? 'OI' : ''}
                {!score.priceActionSummary.pcrDivergence && !score.priceActionSummary.oiDivergence ? 'None' : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Volume Profile */}
      {score.volumeProfileSummary && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <span className="text-rose-400">📈</span> Volume Profile
          </h3>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-slate-700/30 rounded-lg p-2 text-center">
              <div className="text-slate-400">POC</div>
              <div className="text-white font-bold">{fmt(score.volumeProfileSummary.poc, 0)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2 text-center">
              <div className="text-slate-400">VAH</div>
              <div className="text-emerald-400 font-bold">{fmt(score.volumeProfileSummary.vah, 0)}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-2 text-center">
              <div className="text-slate-400">VAL</div>
              <div className="text-red-400 font-bold">{fmt(score.volumeProfileSummary.val, 0)}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-400 flex items-center justify-between">
            <span>POC Trend: <span className="text-white">{score.volumeProfileSummary.pocTrend || '-'}</span></span>
            <span>Migration: <span className="text-white">{fmt(score.volumeProfileSummary.pocMigration)}</span></span>
          </div>
        </div>
      )}

      {/* Data Quality */}
      {score.dataQuality && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Data Quality</span>
            <span className={`font-bold ${score.dataQuality.qualityLevel === 'FULL' ? 'text-emerald-400' :
              score.dataQuality.qualityLevel === 'PARTIAL' ? 'text-amber-400' : 'text-red-400'
              }`}>
              {score.dataQuality.qualityLevel} ({fmtPct(score.dataQuality.completenessScore)})
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {score.dataQuality.hasGreeks && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Greeks</span>}
            {score.dataQuality.hasIVSurface && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">IV</span>}
            {score.dataQuality.hasMicrostructure && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Micro</span>}
            {score.dataQuality.hasOptionsFlow && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Flow</span>}
            {score.dataQuality.hasPriceAction && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Price</span>}
            {score.dataQuality.hasVolumeProfile && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Volume</span>}
            {score.dataQuality.hasCrossInstrument && <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Cross</span>}
          </div>
        </div>
      )}

      {/* Warnings */}
      {score.warnings && score.warnings.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2">⚠️ Warnings</h3>
          <div className="space-y-1.5">
            {score.warnings.map((w, i) => (
              <div
                key={i}
                className={`text-xs p-2 rounded-lg ${w.severity === 'CRITICAL' ? 'bg-red-500/10 border border-red-500/30 text-red-400' :
                  w.severity === 'HIGH' ? 'bg-orange-500/10 border border-orange-500/30 text-orange-400' :
                    'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
                  }`}
              >
                <div className="font-bold">{w.type?.replace(/_/g, ' ')}</div>
                <div className="text-[11px] opacity-80">{w.message}</div>
                {w.recommendation && <div className="text-[10px] mt-1 opacity-60">→ {w.recommendation}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full Analysis Link */}
      <Link
        to={`/stock/${score.scripCode}`}
        className="block w-full py-2.5 bg-amber-500/20 text-amber-400 text-center rounded-xl font-medium hover:bg-amber-500/30 transition-colors"
      >
        View Full Analysis & MTF Data →
      </Link>
    </div>
  )
}
