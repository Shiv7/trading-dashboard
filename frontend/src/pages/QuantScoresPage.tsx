import { useEffect, useState } from 'react'
import { quantScoresApi } from '../services/api'
import type { QuantScore, QuantScoreStats } from '../types'
import TradeModal from '../components/Trading/TradeModal'

// Color utilities
const getScoreColor = (score: number) => {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 65) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  if (score >= 35) return 'text-orange-400'
  return 'text-red-400'
}


const getDirectionIcon = (direction: string) => {
  if (direction === 'BULLISH') return '🐂'
  if (direction === 'BEARISH') return '🐻'
  return '⚖️'
}

const getLabelBadge = (label: string) => {
  const colors: Record<string, string> = {
    'STRONG_BUY': 'bg-emerald-500 text-white',
    'BUY': 'bg-green-500 text-white',
    'NEUTRAL': 'bg-slate-500 text-white',
    'SELL': 'bg-orange-500 text-white',
    'STRONG_SELL': 'bg-red-500 text-white',
  }
  return colors[label] || 'bg-slate-600 text-white'
}

// Score Row Component
function QuantScoreRow({ score, expanded, onToggle, onTrade }: {
  score: QuantScore
  expanded: boolean
  onToggle: () => void
  onTrade: () => void
}) {
  const breakdown = score.breakdown

  return (
    <>
      <tr
        className="hover:bg-slate-700/50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="font-medium text-white">
          <div className="flex items-center gap-2">
            <span className="text-lg">{getDirectionIcon(score.direction)}</span>
            <div>
              <div className="font-semibold">{score.symbol || score.scripCode}</div>
              <div className="text-xs text-slate-400">{score.humanReadableTime}</div>
            </div>
          </div>
        </td>
        <td>
          <span className={`px-2 py-1 rounded text-xs font-bold ${getLabelBadge(score.quantLabel)}`}>
            {score.quantLabel?.replace('_', ' ')}
          </span>
        </td>
        <td className="text-center">
          <div className={`text-2xl font-bold ${getScoreColor(score.quantScore)}`}>
            {score.quantScore?.toFixed(1)}
          </div>
        </td>
        <td className="text-center">
          <div className="flex items-center justify-center gap-1">
            <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${score.confidence > 0.7 ? 'bg-green-400' : score.confidence > 0.5 ? 'bg-yellow-400' : 'bg-red-400'}`}
                style={{ width: `${(score.confidence || 0) * 100}%` }}
              />
            </div>
            <span className="text-xs text-slate-400">{((score.confidence || 0) * 100).toFixed(0)}%</span>
          </div>
        </td>
        <td className="text-center">
          {score.actionable ? (
            <span className="text-emerald-400 text-sm font-medium">ACTIONABLE</span>
          ) : (
            <span className="text-slate-500 text-sm">{score.actionableReason || 'Not Actionable'}</span>
          )}
        </td>
        <td className="text-center">
          {score.warnings && score.warnings.length > 0 && (
            <span className="text-amber-400">⚠️ {score.warnings.length}</span>
          )}
        </td>
        <td className="text-center">
          <button
            onClick={(e) => { e.stopPropagation(); onTrade() }}
            className="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg text-xs font-bold hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/20"
          >
            📈 Trade
          </button>
        </td>
        <td className="text-right">
          <span className="text-slate-400">{expanded ? '▼' : '▶'}</span>
        </td>
      </tr>

      {/* Expanded Details Row */}
      {expanded && breakdown && (
        <tr className="bg-slate-800/50">
          <td colSpan={8} className="p-4">
            <div className="grid grid-cols-8 gap-3 text-sm">
              {/* Category Breakdown */}
              <CategoryBar label="Greeks" score={breakdown.greeksScore} max={15} pct={breakdown.greeksPct} />
              <CategoryBar label="IV Surface" score={breakdown.ivSurfaceScore} max={12} pct={breakdown.ivSurfacePct} />
              <CategoryBar label="Microstructure" score={breakdown.microstructureScore} max={18} pct={breakdown.microstructurePct} />
              <CategoryBar label="Options Flow" score={breakdown.optionsFlowScore} max={15} pct={breakdown.optionsFlowPct} />
              <CategoryBar label="Price Action" score={breakdown.priceActionScore} max={12} pct={breakdown.priceActionPct} />
              <CategoryBar label="Volume Profile" score={breakdown.volumeProfileScore} max={8} pct={breakdown.volumeProfilePct} />
              <CategoryBar label="Cross-Instrument" score={breakdown.crossInstrumentScore} max={10} pct={breakdown.crossInstrumentPct} />
              <CategoryBar label="Confluence" score={breakdown.confluenceScore} max={10} pct={breakdown.confluencePct} />
            </div>

            {/* Greeks Summary */}
            {score.greeksSummary && (
              <div className="mt-4 p-3 bg-slate-700/50 rounded-lg">
                <div className="text-xs font-bold text-slate-300 mb-2">Greeks Summary</div>
                <div className="grid grid-cols-5 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400">Delta:</span>
                    <span className={`ml-1 ${score.greeksSummary.totalDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {score.greeksSummary.totalDelta?.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Gamma:</span>
                    <span className="ml-1 text-white">{score.greeksSummary.totalGamma?.toFixed(4)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Vega:</span>
                    <span className="ml-1 text-white">{score.greeksSummary.totalVega?.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Theta:</span>
                    <span className={`ml-1 ${score.greeksSummary.totalTheta < 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {score.greeksSummary.totalTheta?.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    {score.greeksSummary.gammaSqueezeRisk && (
                      <span className="text-amber-400">⚠️ Gamma Squeeze Risk</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Warnings */}
            {score.warnings && score.warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {score.warnings.map((w, i) => (
                  <div key={i} className={`text-xs p-2 rounded ${w.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                    w.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                    <span className="font-bold">{w.type}:</span> {w.message}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// Category Progress Bar
function CategoryBar({ label, score, max, pct }: { label: string; score: number; max: number; pct: number }) {
  const percentage = (score / max) * 100
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-green-500' : pct >= 30 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="text-center">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${percentage}%` }} />
      </div>
      <div className="text-xs text-white mt-1">{score?.toFixed(1)}/{max}</div>
    </div>
  )
}

// Stats Summary Card
function StatsCard({ stats }: { stats: QuantScoreStats | null }) {
  if (!stats) return null

  return (
    <div className="grid grid-cols-6 gap-4 mb-6">
      <div className="card p-4 text-center">
        <div className="text-2xl font-bold text-white">{stats.totalSymbols}</div>
        <div className="text-xs text-slate-400">Total Symbols</div>
      </div>
      <div className="card p-4 text-center">
        <div className="text-2xl font-bold text-emerald-400">{stats.actionableCount}</div>
        <div className="text-xs text-slate-400">Actionable</div>
      </div>
      <div className="card p-4 text-center">
        <div className="text-2xl font-bold text-green-400">{stats.bullishCount}</div>
        <div className="text-xs text-slate-400">Bullish</div>
      </div>
      <div className="card p-4 text-center">
        <div className="text-2xl font-bold text-red-400">{stats.bearishCount}</div>
        <div className="text-xs text-slate-400">Bearish</div>
      </div>
      <div className="card p-4 text-center">
        <div className="text-2xl font-bold text-blue-400">{stats.averageScore?.toFixed(1)}</div>
        <div className="text-xs text-slate-400">Avg Score</div>
      </div>
      <div className="card p-4 text-center">
        <div className="text-2xl font-bold text-purple-400">{stats.maxScore?.toFixed(1)}</div>
        <div className="text-xs text-slate-400">Max Score</div>
      </div>
    </div>
  )
}

export default function QuantScoresPage() {
  const [scores, setScores] = useState<QuantScore[]>([])
  const [stats, setStats] = useState<QuantScoreStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterDirection, setFilterDirection] = useState<string>('')
  const [filterActionable, setFilterActionable] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [tradeModal, setTradeModal] = useState<{ open: boolean; score: QuantScore | null }>({
    open: false,
    score: null,
  })

  useEffect(() => {
    async function loadData() {
      try {
        const [scoresData, statsData] = await Promise.all([
          quantScoresApi.getAllScores(100),
          quantScoresApi.getStats()
        ])
        setScores(scoresData)
        setStats(statsData)
      } catch (error) {
        console.error('Error loading quant scores:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()

    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [])

  // Filter and sort scores
  const displayScores = scores
    .filter(s => !filterDirection || s.direction === filterDirection)
    .filter(s => !filterActionable || s.actionable)
    .sort((a, b) => b.quantScore - a.quantScore)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading QuantScores...</div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-white flex items-center gap-2">
              <span className="text-3xl">📊</span>
              QuantScore Dashboard
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Institutional-grade composite scoring across 8 categories
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-slate-400">Live Updates</span>
          </div>
        </div>

        {/* Stats Summary */}
        <StatsCard stats={stats} />

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="flex gap-2">
            <span className="text-sm text-slate-400 self-center">Direction:</span>
            {['', 'BULLISH', 'BEARISH'].map(d => (
              <button
                key={d}
                onClick={() => setFilterDirection(d)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${filterDirection === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-white'
                  }`}
              >
                {d || 'All'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setFilterActionable(!filterActionable)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${filterActionable
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
          >
            Actionable Only
          </button>
        </div>

        {/* Scores Table */}
        <div className="card overflow-hidden">
          {displayScores.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700/50">
                  <tr>
                    <th className="text-left p-3 text-slate-300 font-semibold">Symbol</th>
                    <th className="text-left p-3 text-slate-300 font-semibold">Label</th>
                    <th className="text-center p-3 text-slate-300 font-semibold">Score</th>
                    <th className="text-center p-3 text-slate-300 font-semibold">Confidence</th>
                    <th className="text-center p-3 text-slate-300 font-semibold">Status</th>
                    <th className="text-center p-3 text-slate-300 font-semibold">Warnings</th>
                    <th className="text-center p-3 text-slate-300 font-semibold">Trade</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {displayScores.map(score => (
                    <QuantScoreRow
                      key={score.familyId || score.scripCode}
                      score={score}
                      expanded={expandedRow === (score.familyId || score.scripCode)}
                      onToggle={() => setExpandedRow(
                        expandedRow === (score.familyId || score.scripCode) ? null : (score.familyId || score.scripCode)
                      )}
                      onTrade={() => setTradeModal({ open: true, score })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-slate-500 py-12">
              No scores available. Waiting for market data...
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-500 rounded" />
            <span>80+ Excellent</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded" />
            <span>65-80 Strong</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-yellow-500 rounded" />
            <span>50-65 Moderate</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-orange-500 rounded" />
            <span>35-50 Weak</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded" />
            <span>&lt;35 Poor</span>
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
        direction={tradeModal.score?.direction}
        quantScore={tradeModal.score?.quantScore}
      />
    </>
  )
}

