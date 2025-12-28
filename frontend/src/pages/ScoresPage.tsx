import { useEffect, useState } from 'react'
import ScoreRow from '../components/Scores/ScoreRow'
import { useDashboardStore } from '../store/dashboardStore'
import { scoresApi } from '../services/api'
import type { FamilyScore } from '../types'

export default function ScoresPage() {
  const [scores, setScores] = useState<FamilyScore[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'score' | 'vcp' | 'ipu'>('score')
  const [filterDirection, setFilterDirection] = useState<string>('')

  const wsScores = useDashboardStore((s) => s.scores)

  useEffect(() => {
    async function loadScores() {
      try {
        const data = await scoresApi.getAllScores()
        setScores(data)
      } catch (error) {
        console.error('Error loading scores:', error)
      } finally {
        setLoading(false)
      }
    }
    loadScores()
  }, [])

  // Merge WebSocket scores with initial load
  const allScores = wsScores.size > 0 
    ? Array.from(wsScores.values())
    : scores

  // Filter and sort
  const displayScores = allScores
    .filter(s => !filterDirection || s.direction === filterDirection)
    .sort((a, b) => {
      switch (sortBy) {
        case 'vcp': return b.vcpCombinedScore - a.vcpCombinedScore
        case 'ipu': return b.ipuFinalScore - a.ipuFinalScore
        default: return b.overallScore - a.overallScore
      }
    })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading scores...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-white">🎯 Family Scores</h1>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 pulse-green" />
          <span className="text-sm text-slate-400">Live Updates</span>
        </div>
      </div>

      {/* Filters and Sort */}
      <div className="flex flex-wrap gap-4">
        <div className="flex gap-2">
          <span className="text-sm text-slate-400 self-center">Direction:</span>
          {['', 'BULLISH', 'BEARISH'].map(d => (
            <button
              key={d}
              onClick={() => setFilterDirection(d)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                filterDirection === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {d || 'All'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <span className="text-sm text-slate-400 self-center">Sort by:</span>
          {[
            { value: 'score', label: 'Overall' },
            { value: 'vcp', label: 'VCP' },
            { value: 'ipu', label: 'IPU' },
          ].map(s => (
            <button
              key={s.value}
              onClick={() => setSortBy(s.value as typeof sortBy)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                sortBy === s.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scores Table */}
      <div className="card">
        {displayScores.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Direction</th>
                  <th>VCP</th>
                  <th>IPU</th>
                  <th>Regime</th>
                  <th>Gate</th>
                  <th>Score</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody>
                {displayScores.map(score => (
                  <ScoreRow key={score.scripCode} score={score} />
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
    </div>
  )
}

