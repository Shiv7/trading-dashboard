import { useNavigate } from 'react-router-dom'
import type { FamilyScore } from '../../types'

interface ScoreRowProps {
  score: FamilyScore
}

export default function ScoreRow({ score }: ScoreRowProps) {
  const navigate = useNavigate()

  const getScoreColor = (value: number | undefined, max: number = 1) => {
    if (value === undefined || value === null) return 'text-slate-400'
    const normalized = value / max
    if (normalized >= 0.7) return 'text-emerald-400'
    if (normalized >= 0.4) return 'text-amber-400'
    return 'text-red-400'
  }

  const getGateStatus = () => {
    if (!score.hardGatePassed) return { status: 'HARD', color: 'text-red-400' }
    if (!score.mtfGatePassed) return { status: 'MTF', color: 'text-amber-400' }
    if (!score.qualityGatePassed) return { status: 'QUALITY', color: 'text-amber-400' }
    if (!score.statsGatePassed) return { status: 'STATS', color: 'text-amber-400' }
    return { status: 'PASS', color: 'text-emerald-400' }
  }

  const gate = getGateStatus()

  const handleRowClick = () => {
    navigate(`/stock/${score.scripCode}`)
  }

  const formatPercent = (value: number | undefined) => {
    if (value === undefined || value === null) return '-'
    return `${(value * 100).toFixed(0)}%`
  }

  const formatScore = (value: number | undefined) => {
    if (value === undefined || value === null) return '-'
    return value.toFixed(1)
  }

  return (
    <tr
      onClick={handleRowClick}
      className="hover:bg-slate-700/30 cursor-pointer"
    >
      <td className="py-3 px-4">
        <div className="font-medium text-white">
          {score.companyName || score.scripCode}
        </div>
        <div className="text-xs text-slate-500">{score.scripCode}</div>
      </td>
      <td className="py-3 px-4">
        <span className={`font-medium ${score.direction === 'BULLISH' ? 'text-emerald-400' : score.direction === 'BEARISH' ? 'text-red-400' : 'text-slate-400'}`}>
          {score.direction === 'BULLISH' ? '📈' : score.direction === 'BEARISH' ? '📉' : '➡️'} {score.direction || 'NEUTRAL'}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className={getScoreColor(score.vcpCombinedScore)}>
          {formatPercent(score.vcpCombinedScore)}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <span className={getScoreColor(score.ipuFinalScore)}>
            {formatPercent(score.ipuFinalScore)}
          </span>
          {score.ipuXfactor && (
            <span className="text-yellow-400" title="X-Factor detected">⚡</span>
          )}
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={score.securityAligned ? 'text-emerald-400' : 'text-amber-400'}>
          {score.indexRegimeLabel || '-'}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className={`badge ${gate.status === 'PASS' ? 'badge-success' : 'badge-danger'}`}>
          {gate.status}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className={`text-lg font-bold ${getScoreColor(score.overallScore, 10)}`}>
          {formatScore(score.overallScore)}
        </span>
      </td>
      <td className="py-3 px-4">
        {score.signalEmitted ? (
          <span className="badge badge-success">Emitted</span>
        ) : (
          <span className="badge badge-neutral">-</span>
        )}
      </td>
    </tr>
  )
}

