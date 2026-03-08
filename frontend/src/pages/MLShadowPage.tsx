import { useState, useEffect, useCallback } from 'react'

const ML_EXEC_BASE = 'http://localhost:8089/api/ml'
const ML_FA_BASE = 'http://localhost:8002/api/ml'

interface RegimeInfo {
  regime: string
  confidence: number
  probabilities: Record<string, number>
  version: string
}

interface QualityInfo {
  status: string
  version?: string
  cv_auc_mean?: number
  n_samples?: number
  top_features?: Array<{ name: string; importance: number }>
}

interface ShadowLog {
  signalId: string
  strategy: string
  scripCode: string
  direction: string
  ruleBasedDecision: string
  mlDecision: {
    shouldTrade: boolean
    recommendedSize: number
    sampledProbability: number
    expectedWinRate: number
    regime: string
  }
  agreement: boolean
  disagreementType: string
  timestamp: string
}

interface BayesianDist {
  alpha: number
  beta: number
  winRate: string
  totalSamples: number
}

interface ComparisonStats {
  totalEvaluated: number
  agreement: number
  agreementRate: string
  mlTradeRuleSkip: number
  mlSkipRuleTrade: number
}

const REGIME_COLORS: Record<string, string> = {
  TRENDING_UP: 'text-green-400 bg-green-500/10 border-green-500/30',
  TRENDING_DOWN: 'text-red-400 bg-red-500/10 border-red-500/30',
  MEAN_REVERTING: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  HIGH_VOLATILITY: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  UNKNOWN: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export default function MLShadowPage() {
  const [regime, setRegime] = useState<RegimeInfo | null>(null)
  const [quality, setQuality] = useState<QualityInfo | null>(null)
  const [shadowLogs, setShadowLogs] = useState<ShadowLog[]>([])
  const [distributions, setDistributions] = useState<Record<string, BayesianDist>>({})
  const [comparison, setComparison] = useState<ComparisonStats | null>(null)
  const [training, setTraining] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [r, q, logs, dists, comp] = await Promise.all([
      fetchJson<RegimeInfo>(`${ML_FA_BASE}/regime/info`),
      fetchJson<QualityInfo>(`${ML_FA_BASE}/quality/info`),
      fetchJson<ShadowLog[]>(`${ML_EXEC_BASE}/shadow/logs?limit=30`),
      fetchJson<Record<string, BayesianDist>>(`${ML_EXEC_BASE}/bayesian/distributions`),
      fetchJson<ComparisonStats>(`${ML_EXEC_BASE}/shadow/comparison`),
    ])
    if (r) setRegime(r)
    if (q) setQuality(q)
    if (logs) setShadowLogs(logs)
    if (dists) setDistributions(dists)
    if (comp) setComparison(comp)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => clearInterval(interval)
  }, [refresh])

  const trainModels = async () => {
    setTraining('Training...')
    try {
      await fetch(`${ML_FA_BASE}/reconstruct`, { method: 'POST' })
      const [qRes, rRes] = await Promise.all([
        fetch(`${ML_FA_BASE}/quality/train`, { method: 'POST' }),
        fetch(`${ML_FA_BASE}/regime/train`, { method: 'POST' }),
      ])
      const qResult = await qRes.json()
      const rResult = await rRes.json()
      setTraining(`Quality AUC: ${qResult.cv_auc_mean?.toFixed(3) || 'N/A'} | Regime: ${rResult.status}`)
      refresh()
    } catch (e) {
      setTraining(`Error: ${e}`)
    }
  }

  const initBayesian = async () => {
    setTraining('Initializing Bayesian from trade history...')
    try {
      const r = await fetch(`${ML_EXEC_BASE}/bayesian/init-from-history`, { method: 'POST' })
      const result = await r.json()
      setTraining(`Initialized: ${Object.keys(result).join(', ')}`)
      refresh()
    } catch (e) {
      setTraining(`Error: ${e}`)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">ML Shadow Dashboard</h1>
        <div className="flex gap-2">
          <button onClick={trainModels}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
            Train Models
          </button>
          <button onClick={initBayesian}
            className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700">
            Init Bayesian
          </button>
          <button onClick={refresh}
            className="px-3 py-1.5 bg-slate-700 text-white text-sm rounded hover:bg-slate-600">
            Refresh
          </button>
        </div>
      </div>

      {training && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-blue-300 text-sm">
          {training}
        </div>
      )}

      {/* Top Row: Regime + Quality + Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Regime Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Current Regime (HMM)</h3>
          {regime && regime.regime !== undefined ? (
            <>
              <div className={`inline-block px-3 py-1 rounded-full text-sm font-bold border ${REGIME_COLORS[regime.regime] || REGIME_COLORS.UNKNOWN}`}>
                {regime.regime}
              </div>
              {regime.probabilities && (
                <div className="mt-3 space-y-1">
                  {Object.entries(regime.probabilities).map(([name, prob]) => (
                    <div key={name} className="flex justify-between text-xs">
                      <span className="text-slate-400">{name}</span>
                      <span className="text-slate-300">{(prob * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-2">v{regime.version}</p>
            </>
          ) : (
            <p className="text-slate-500 text-sm italic">Not trained yet</p>
          )}
        </div>

        {/* Quality Model Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Signal Quality (XGBoost)</h3>
          {quality && quality.version ? (
            <>
              <div className="text-2xl font-bold text-white">
                AUC {quality.cv_auc_mean?.toFixed(3) || 'N/A'}
              </div>
              <p className="text-sm text-slate-400">{quality.n_samples || 0} training samples</p>
              {quality.top_features && (
                <div className="mt-2 space-y-1">
                  {quality.top_features.slice(0, 5).map(f => (
                    <div key={f.name} className="flex justify-between text-xs">
                      <span className="text-slate-400">{f.name}</span>
                      <div className="flex items-center gap-1">
                        <div className="w-16 bg-slate-700 rounded-full h-1.5">
                          <div className="bg-blue-500 h-1.5 rounded-full"
                            style={{ width: `${Math.min(100, f.importance * 1000)}%` }} />
                        </div>
                        <span className="text-slate-300 w-10 text-right">{(f.importance * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-2">v{quality.version}</p>
            </>
          ) : (
            <p className="text-slate-500 text-sm italic">Not trained yet</p>
          )}
        </div>

        {/* Comparison Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Rule vs ML Agreement</h3>
          {comparison ? (
            <>
              <div className="text-2xl font-bold text-white">{comparison.agreementRate}</div>
              <p className="text-sm text-slate-400">{comparison.totalEvaluated} signals evaluated</p>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-green-400">Agree</span>
                  <span className="text-white font-medium">{comparison.agreement}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-yellow-400">ML Trade, Rule Skip</span>
                  <span className="text-white font-medium">{comparison.mlTradeRuleSkip}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-red-400">ML Skip, Rule Trade</span>
                  <span className="text-white font-medium">{comparison.mlSkipRuleTrade}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-slate-500 text-sm italic">No shadow data yet</p>
          )}
        </div>
      </div>

      {/* Bayesian Distributions */}
      {Object.keys(distributions).length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Bayesian Win Rate Distributions (Thompson Sampling)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(distributions).map(([key, dist]) => (
              <div key={key} className="bg-slate-700/50 rounded p-3">
                <div className="text-xs text-slate-400 mb-1">{key}</div>
                <div className="text-lg font-bold text-white">{dist.winRate}</div>
                <div className="text-xs text-slate-500">
                  {dist.totalSamples} samples | a={dist.alpha.toFixed(1)} b={dist.beta.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shadow Logs Table */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-400 mb-3">Recent Shadow Decisions</h3>
        {shadowLogs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Strategy</th>
                  <th className="pb-2 pr-3">Scrip</th>
                  <th className="pb-2 pr-3">Direction</th>
                  <th className="pb-2 pr-3">Rule</th>
                  <th className="pb-2 pr-3">ML</th>
                  <th className="pb-2 pr-3">Prob</th>
                  <th className="pb-2 pr-3">Regime</th>
                  <th className="pb-2">Match</th>
                </tr>
              </thead>
              <tbody>
                {shadowLogs.map((log, i) => (
                  <tr key={i} className="border-b border-slate-700/50">
                    <td className="py-1.5 pr-3 text-slate-400 text-xs">
                      {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '-'}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-300">{log.strategy}</td>
                    <td className="py-1.5 pr-3 text-slate-300">{log.scripCode}</td>
                    <td className="py-1.5 pr-3">
                      <span className={log.direction === 'BULLISH' ? 'text-green-400' : 'text-red-400'}>
                        {log.direction}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={log.ruleBasedDecision === 'TRADE' ? 'text-green-400' : 'text-slate-500'}>
                        {log.ruleBasedDecision}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={log.mlDecision?.shouldTrade ? 'text-green-400' : 'text-red-400'}>
                        {log.mlDecision?.shouldTrade ? 'TRADE' : 'SKIP'}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-300">
                      {((log.mlDecision?.sampledProbability || 0) * 100).toFixed(0)}%
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${REGIME_COLORS[log.mlDecision?.regime || 'UNKNOWN'] || REGIME_COLORS.UNKNOWN}`}>
                        {log.mlDecision?.regime || 'N/A'}
                      </span>
                    </td>
                    <td className="py-1.5">
                      {log.agreement ? (
                        <span className="text-green-400">Y</span>
                      ) : (
                        <span className="text-red-400">N</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-sm italic">No shadow logs yet. Enable ml.shadow.enabled=true and wait for signals.</p>
        )}
      </div>

      <div className="text-center text-xs text-slate-600 pb-4">
        SHADOW MODE - ML decisions are logged only, not executed. Auto-refreshes every 30s.
      </div>
    </div>
  )
}
