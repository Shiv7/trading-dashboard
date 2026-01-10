import { useEffect, useState } from 'react'
import { riskApi } from '../services/api'
import type { RiskMetrics } from '../types'

export default function RiskPage() {
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadMetrics() {
      try {
        const data = await riskApi.getMetrics()
        setMetrics(data)
      } catch (error) {
        console.error('Error loading risk metrics:', error)
      } finally {
        setLoading(false)
      }
    }
    loadMetrics()

    // Refresh every 30 seconds
    const interval = setInterval(loadMetrics, 30000)
    return () => clearInterval(interval)
  }, [])

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'LOW':
        return 'text-emerald-400 bg-emerald-500/20 border-emerald-500/50'
      case 'MODERATE':
        return 'text-amber-400 bg-amber-500/20 border-amber-500/50'
      case 'HIGH':
        return 'text-red-400 bg-red-500/20 border-red-500/50'
      default:
        return 'text-slate-400 bg-slate-500/20 border-slate-500/50'
    }
  }

  const getAlertSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-500/20 text-red-400 border-red-500/50'
      case 'HIGH':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/50'
      case 'MEDIUM':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/50'
      case 'LOW':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50'
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/50'
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-24 bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="text-center text-slate-500 py-12">
        <p>Unable to load risk metrics</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-white">Risk Dashboard</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-slate-400">Auto-refresh: 30s</span>
          </div>
          <span className="text-sm text-slate-400">
            Updated: {new Date(metrics.lastUpdated).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Risk Score Hero */}
      <div className="card bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg text-slate-400 mb-2">Overall Risk Score</h2>
            <div className="flex items-baseline gap-4">
              <span className={`text-5xl font-bold ${
                metrics.riskScore.score < 30 ? 'text-emerald-400' :
                metrics.riskScore.score < 60 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {metrics.riskScore.score.toFixed(0)}
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getRiskLevelColor(metrics.riskScore.level)}`}>
                {metrics.riskScore.level}
              </span>
            </div>
          </div>
          {/* Score breakdown */}
          <div className="hidden md:flex gap-4">
            <div className="text-center">
              <div className="text-sm text-slate-400">Concentration</div>
              <div className="text-xl font-bold text-white">{metrics.riskScore.concentrationComponent.toFixed(0)}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-slate-400">Exposure</div>
              <div className="text-xl font-bold text-white">{metrics.riskScore.exposureComponent.toFixed(0)}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-slate-400">VaR</div>
              <div className="text-xl font-bold text-white">{metrics.riskScore.varComponent.toFixed(0)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Portfolio Exposure */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Portfolio Exposure</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Long Exposure</span>
              <span className="text-emerald-400 font-medium">
                ₹{(metrics.portfolioExposure.longExposure / 1000).toFixed(1)}K
                <span className="text-xs text-slate-500 ml-1">({metrics.portfolioExposure.longCount})</span>
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Short Exposure</span>
              <span className="text-red-400 font-medium">
                ₹{(metrics.portfolioExposure.shortExposure / 1000).toFixed(1)}K
                <span className="text-xs text-slate-500 ml-1">({metrics.portfolioExposure.shortCount})</span>
              </span>
            </div>
            <div className="border-t border-slate-700 pt-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Net Exposure</span>
                <span className={`font-bold ${metrics.portfolioExposure.netExposure >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  ₹{(metrics.portfolioExposure.netExposure / 1000).toFixed(1)}K
                </span>
              </div>
              <div className="text-sm text-slate-500 mt-1">
                Direction: <span className="text-white">{metrics.portfolioExposure.netDirection}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Direction Exposure */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Direction Breakdown</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-emerald-400">Bullish</span>
                <span className="text-white">{metrics.directionExposure.bullishPercent.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${metrics.directionExposure.bullishPercent}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-red-400">Bearish</span>
                <span className="text-white">{metrics.directionExposure.bearishPercent.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-red-500"
                  style={{ width: `${metrics.directionExposure.bearishPercent}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Neutral</span>
                <span className="text-white">{metrics.directionExposure.neutralPercent.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-slate-500"
                  style={{ width: `${metrics.directionExposure.neutralPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Concentration Risk */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Concentration Risk</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">HHI Score</span>
              <span className="text-white font-medium">{metrics.concentrationRisk.herfindahlIndex.toFixed(3)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Risk Level</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getRiskLevelColor(metrics.concentrationRisk.riskLevel)}`}>
                {metrics.concentrationRisk.riskLevel}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Unique Stocks</span>
              <span className="text-white">{metrics.concentrationRisk.uniqueStocks}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Max Single Stock</span>
              <span className={`font-medium ${metrics.concentrationRisk.singleStockMaxPercent > 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {metrics.concentrationRisk.singleStockMaxPercent.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Value at Risk */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Value at Risk (VaR)</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">VaR 95%</span>
              <span className="text-amber-400 font-medium">{metrics.valueAtRisk.var95.toFixed(2)}R</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">VaR 99%</span>
              <span className="text-red-400 font-medium">{metrics.valueAtRisk.var99.toFixed(2)}R</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Expected Shortfall</span>
              <span className="text-red-400 font-medium">{metrics.valueAtRisk.expectedShortfall.toFixed(2)}R</span>
            </div>
            <div className="text-xs text-slate-500">
              Based on {metrics.valueAtRisk.sampleSize} trades
            </div>
          </div>
        </div>

        {/* Risk Breakdown */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Risk Breakdown</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Open Positions</span>
              <span className="text-white font-medium">{metrics.riskBreakdown.openPositions}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Total Risk Amount</span>
              <span className="text-red-400 font-medium">₹{(metrics.riskBreakdown.totalRiskAmount / 1000).toFixed(1)}K</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Avg Risk/Trade</span>
              <span className="text-white">₹{metrics.riskBreakdown.averageRiskPerTrade.toFixed(0)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Avg R:R</span>
              <span className={`font-medium ${metrics.riskBreakdown.averageRiskReward >= 1.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {metrics.riskBreakdown.averageRiskReward.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Max Loss Exposure */}
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Max Loss Exposure</h3>
          <div className="text-center py-4">
            <div className="text-4xl font-bold text-red-400">
              ₹{(metrics.maxLossExposure / 1000).toFixed(1)}K
            </div>
            <div className="text-sm text-slate-400 mt-2">
              If all stop losses are hit
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700">
            <div className="text-sm text-slate-400">Diversification Score</div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className={`h-full ${
                    metrics.correlationMetrics.diversificationScore >= 0.7 ? 'bg-emerald-500' :
                    metrics.correlationMetrics.diversificationScore >= 0.4 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${metrics.correlationMetrics.diversificationScore * 100}%` }}
                />
              </div>
              <span className="text-white text-sm">{(metrics.correlationMetrics.diversificationScore * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Alerts */}
      {metrics.alerts && metrics.alerts.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">
            Risk Alerts
            <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-400 text-sm rounded-full">
              {metrics.alerts.length}
            </span>
          </h3>
          <div className="space-y-3">
            {metrics.alerts.map((alert, i) => (
              <div
                key={i}
                className={`p-4 rounded-lg border ${getAlertSeverityColor(alert.severity)}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getAlertSeverityColor(alert.severity)}`}>
                        {alert.severity}
                      </span>
                      <span className="text-white font-medium">{alert.type}</span>
                    </div>
                    <p className="text-slate-300 text-sm mt-2">{alert.message}</p>
                    {alert.recommendation && (
                      <p className="text-slate-500 text-xs mt-2">
                        Recommendation: {alert.recommendation}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Holdings */}
      {metrics.concentrationRisk.topHoldings && Object.keys(metrics.concentrationRisk.topHoldings).length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-white mb-4">Top Holdings</h3>
          <div className="space-y-2">
            {Object.entries(metrics.concentrationRisk.topHoldings).map(([stock, percent]) => (
              <div key={stock} className="flex items-center gap-3">
                <span className="text-white flex-1">{stock}</span>
                <div className="w-32 h-2 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full ${percent > 20 ? 'bg-amber-500' : 'bg-blue-500'}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="text-slate-400 text-sm w-16 text-right">{percent.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
