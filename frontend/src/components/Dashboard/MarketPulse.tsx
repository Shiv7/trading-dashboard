import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { indicatorsApi } from '../../services/api'
import type { IPUSignal, VCPSignal } from '../../types'

interface MarketPulseProps {
  limit?: number
}

export default function MarketPulse({ limit = 5 }: MarketPulseProps) {
  const [topIPU, setTopIPU] = useState<IPUSignal[]>([])
  const [topVCP, setTopVCP] = useState<VCPSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'ipu' | 'vcp'>('ipu')

  useEffect(() => {
    async function loadData() {
      try {
        const [ipuData, vcpData] = await Promise.all([
          indicatorsApi.getTopIPU(limit, 'BULLISH').catch(() => ({ signals: [] })),
          indicatorsApi.getTopVCP(limit, 'BULLISH').catch(() => ({ signals: [] })),
        ])
        setTopIPU(ipuData.signals || [])
        setTopVCP(vcpData.signals || [])
      } catch (error) {
        console.error('Error loading market pulse:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()

    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [limit])

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">
          <span>🔥 Market Pulse</span>
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg">
              <div className="w-10 h-10 bg-slate-600 rounded-lg" />
              <div className="flex-1">
                <div className="h-4 bg-slate-600 rounded w-24 mb-2" />
                <div className="h-3 bg-slate-700 rounded w-16" />
              </div>
              <div className="w-12 h-8 bg-slate-600 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <span>🔥 Market Pulse</span>
        <div className="flex items-center gap-1 text-xs">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-400">Live</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-700/30 p-1 rounded-lg">
        <button
          onClick={() => setActiveTab('ipu')}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
            activeTab === 'ipu'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          🏛️ IPU Flow
        </button>
        <button
          onClick={() => setActiveTab('vcp')}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
            activeTab === 'vcp'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          📊 VCP Clusters
        </button>
      </div>

      {/* Content */}
      <div className="space-y-2">
        {activeTab === 'ipu' ? (
          topIPU.length > 0 ? (
            topIPU.map((signal) => (
              <IPUItem key={signal.scripCode} signal={signal} />
            ))
          ) : (
            <EmptyState message="No strong IPU signals right now" />
          )
        ) : (
          topVCP.length > 0 ? (
            topVCP.map((signal) => (
              <VCPItem key={signal.scripCode} signal={signal} />
            ))
          ) : (
            <EmptyState message="No strong VCP signals right now" />
          )
        )}
      </div>
    </div>
  )
}

function IPUItem({ signal }: { signal: IPUSignal }) {
  const scoreColor = signal.ipuFinalScore >= 0.7
    ? 'text-emerald-400 bg-emerald-500/10'
    : signal.ipuFinalScore >= 0.5
      ? 'text-amber-400 bg-amber-500/10'
      : 'text-slate-400 bg-slate-500/10'

  return (
    <Link
      to={`/stock/${signal.scripCode}`}
      className="flex items-center gap-3 p-3 bg-slate-700/20 rounded-lg hover:bg-slate-700/40 transition-all group"
    >
      {/* Score Circle */}
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg ${scoreColor}`}>
        {(signal.ipuFinalScore * 100).toFixed(0)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white group-hover:text-blue-400 transition-colors truncate">
            {signal.companyName || signal.scripCode}
          </span>
          {signal.hasXFactor && (
            <span className="text-yellow-400 text-xs border border-yellow-400/30 px-1.5 py-0.5 rounded animate-pulse">
              X-FACTOR
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className={signal.ipuDirection === 'BULLISH' ? 'text-emerald-400' : signal.ipuDirection === 'BEARISH' ? 'text-red-400' : ''}>
            {signal.ipuDirection}
          </span>
          <span>•</span>
          <span>Inst: {(signal.institutionalProxy * 100).toFixed(0)}%</span>
          <span>•</span>
          <span>Mom: {signal.momentumState}</span>
        </div>
      </div>

      {/* Arrow */}
      <svg className="w-5 h-5 text-slate-500 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}

function VCPItem({ signal }: { signal: VCPSignal }) {
  const scoreColor = signal.vcpCombinedScore >= 60
    ? 'text-emerald-400 bg-emerald-500/10'
    : signal.vcpCombinedScore >= 40
      ? 'text-amber-400 bg-amber-500/10'
      : 'text-slate-400 bg-slate-500/10'

  return (
    <Link
      to={`/stock/${signal.scripCode}`}
      className="flex items-center gap-3 p-3 bg-slate-700/20 rounded-lg hover:bg-slate-700/40 transition-all group"
    >
      {/* Score Circle */}
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg ${scoreColor}`}>
        {signal.vcpCombinedScore.toFixed(0)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white group-hover:text-blue-400 transition-colors truncate">
            {signal.companyName || signal.scripCode}
          </span>
          {signal.penetrationScore > 0.8 && (
            <span className="text-blue-400 text-xs border border-blue-400/30 px-1.5 py-0.5 rounded">
              PENETRATING
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className={signal.vcpSignal === 'BULLISH' ? 'text-emerald-400' : signal.vcpSignal === 'BEARISH' ? 'text-red-400' : ''}>
            {signal.vcpSignal}
          </span>
          <span>•</span>
          <span>Runway: {(signal.runwayScore * 100).toFixed(0)}%</span>
          <span>•</span>
          <span>{signal.totalClusters} clusters</span>
        </div>
      </div>

      {/* Arrow */}
      <svg className="w-5 h-5 text-slate-500 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-slate-500">
      <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  )
}
