import { useEffect, useState, useCallback, useRef } from 'react'
import { greekTrailingApi } from '../services/api'
import type { GreekTrailState } from '../services/api'

// ─── Helpers ───────────────────────────────────────────────
function formatDuration(startMs: number): string {
  const diff = Date.now() - startMs
  if (diff < 0) return 'DM'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return `${hrs}h ${rem}m`
}

function pctFromHWM(current: number, hwm: number): number {
  if (!hwm || hwm === 0) return 0
  return ((current - hwm) / hwm) * 100
}

function trailDistance(current: number, trailStop: number): number {
  if (!current || current === 0) return 0
  return ((current - trailStop) / current) * 100
}

function deltaDrop(current: number, peak: number): number {
  if (!peak || peak === 0) return 0
  return ((peak - Math.abs(current)) / peak) * 100
}

// ─── Color Utilities ───────────────────────────────────────
function accelColor(ratio: number): string {
  if (ratio >= 1.5) return 'text-emerald-400'
  if (ratio >= 1.0) return 'text-yellow-400'
  return 'text-red-400'
}

function accelBg(ratio: number): string {
  if (ratio >= 1.5) return 'bg-emerald-500/30'
  if (ratio >= 1.0) return 'bg-yellow-500/30'
  return 'bg-red-500/30'
}

function thetaColor(rate: number): string {
  if (rate > 5) return 'text-red-500 font-bold'
  if (rate > 3) return 'text-red-400'
  if (rate > 1) return 'text-yellow-400'
  return 'text-emerald-400'
}

function thetaBg(rate: number): string {
  if (rate > 5) return 'bg-red-500/20'
  if (rate > 3) return 'bg-orange-500/20'
  if (rate > 1) return 'bg-yellow-500/20'
  return 'bg-emerald-500/20'
}

// ─── Confirmation Modal ────────────────────────────────────
function ConfirmDialog({
  open, title, message, confirmLabel, confirmColor, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  confirmColor: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-slate-400 text-sm mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-lg font-medium text-white transition-colors ${confirmColor}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Exit Reason Badge ─────────────────────────────────────
function ExitBadge({ reason }: { reason?: string }) {
  if (!reason) return <span className="text-slate-500 italic text-[10px]">DM</span>
  const colorMap: Record<string, string> = {
    TRAIL_STOP: 'bg-yellow-500/20 text-yellow-400',
    THETA_DECAY: 'bg-red-500/20 text-red-400',
    DELTA_FADE: 'bg-orange-500/20 text-orange-400',
    FORCE_EXIT: 'bg-purple-500/20 text-purple-400',
    EMERGENCY_DISABLE: 'bg-red-600/20 text-red-500',
    DTE_EXPIRY: 'bg-slate-500/20 text-slate-400',
    TARGET_HIT: 'bg-emerald-500/20 text-emerald-400',
  }
  const color = colorMap[reason] || 'bg-slate-500/20 text-slate-400'
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${color}`}>
      {reason.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Main Component ────────────────────────────────────────
export default function GreekTrailingPage() {
  const [trails, setTrails] = useState<GreekTrailState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Confirmation dialogs
  const [forceExitTarget, setForceExitTarget] = useState<string | null>(null)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Track previous deltas for arrow indicators
  const prevDeltasRef = useRef<Record<string, number>>({})

  const fetchTrails = useCallback(async () => {
    try {
      const data = await greekTrailingApi.getActive()
      // Store previous deltas before updating
      const prevMap: Record<string, number> = {}
      trails.forEach(t => { prevMap[t.positionKey] = t.currentDelta })
      prevDeltasRef.current = prevMap
      setTrails(data)
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch trails')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initial fetch + polling
  useEffect(() => {
    fetchTrails()
  }, [fetchTrails])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchTrails, 2000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchTrails])

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // ─── Actions ─────────────────────────────────────────────
  const handleForceExit = async () => {
    if (!forceExitTarget) return
    setActionLoading(true)
    try {
      await greekTrailingApi.forceExit(forceExitTarget)
      setToast({ msg: `Force-exited ${forceExitTarget}`, type: 'success' })
      fetchTrails()
    } catch (e) {
      setToast({ msg: `Force-exit failed: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' })
    } finally {
      setActionLoading(false)
      setForceExitTarget(null)
    }
  }

  const handleDisableAll = async () => {
    setActionLoading(true)
    try {
      const result = await greekTrailingApi.disable()
      setToast({ msg: `All trails disabled. ${result.trailsKilled ?? 0} killed.`, type: 'success' })
      fetchTrails()
    } catch (e) {
      setToast({ msg: `Disable failed: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' })
    } finally {
      setActionLoading(false)
      setShowDisableConfirm(false)
    }
  }

  // ─── Partition data ──────────────────────────────────────
  const activeTrails = trails.filter(t => t.status === 'TRAILING')
  const exitedTrails = trails.filter(t => t.status !== 'TRAILING')

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-display font-bold text-white">Greek Trailing Monitor</h1>
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-700 text-slate-300">
            {activeTrails.length} active
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              autoRefresh
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            {autoRefresh ? 'Live 2s' : 'Paused'}
          </button>

          {/* Manual refresh */}
          <button
            onClick={fetchTrails}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 hover:text-white hover:border-slate-600 transition-colors"
          >
            Refresh
          </button>

          {/* Emergency disable */}
          <button
            onClick={() => setShowDisableConfirm(true)}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-900/30"
          >
            DISABLE ALL
          </button>
        </div>
      </div>

      {/* Last refresh */}
      {lastRefresh && (
        <div className="text-[10px] text-slate-600">
          Last updated: {lastRefresh.toLocaleTimeString('en-IN')}
          {error && <span className="ml-2 text-red-400">{error}</span>}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && trails.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-4 opacity-30">~</div>
          <p className="text-slate-500 text-sm">No Greek trailing positions active</p>
          <p className="text-slate-600 text-xs mt-1">Trails appear when T1 targets are hit on option positions</p>
        </div>
      )}

      {/* Active Trails Table */}
      {activeTrails.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-900/60">
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium">Scrip</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium">Status</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Delta</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Accel</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Peak Delta</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Premium</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Trail Stop</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Trail %</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Theta</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Gamma</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">IV</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">DTE</th>
                  <th className="text-right px-3 py-2.5 text-slate-500 font-medium">Duration</th>
                  <th className="text-center px-3 py-2.5 text-slate-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {activeTrails.map(trail => {
                  const prevDelta = prevDeltasRef.current[trail.positionKey]
                  const deltaArrow = prevDelta !== undefined
                    ? (Math.abs(trail.currentDelta) > Math.abs(prevDelta) ? '\u2191' : Math.abs(trail.currentDelta) < Math.abs(prevDelta) ? '\u2193' : '')
                    : ''
                  const hwmPct = pctFromHWM(trail.currentPremium, trail.highWatermark)
                  const trailDist = trailDistance(trail.currentPremium, trail.trailStopPrice)
                  const deltaDropPct = deltaDrop(trail.currentDelta, trail.peakDelta)
                  const isDangerZone = trailDist < 5

                  return (
                    <tr key={trail.positionKey} className="hover:bg-slate-700/20 transition-colors">
                      {/* Scrip */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-medium text-white">
                              {trail.companyName || trail.scripCode}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {trail.optionType} {trail.strike} {trail.exchange}
                              <span className="ml-1 text-slate-600">{trail.strategy}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-emerald-400 font-medium">TRAILING</span>
                        </div>
                      </td>

                      {/* Delta */}
                      <td className="px-3 py-2.5 text-right">
                        <div className="text-white font-mono">
                          {trail.currentDelta?.toFixed(3) ?? <span className="text-slate-500 italic text-[10px]">DM</span>}
                          {deltaArrow && (
                            <span className={deltaArrow === '\u2191' ? 'text-emerald-400 ml-0.5' : 'text-red-400 ml-0.5'}>
                              {deltaArrow}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          T1: {trail.deltaAtT1?.toFixed(3) ?? 'DM'}
                        </div>
                      </td>

                      {/* Delta Acceleration */}
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <div className={`px-2 py-0.5 rounded ${accelBg(trail.deltaAccelRatio)}`}>
                            <span className={`font-mono font-medium ${accelColor(trail.deltaAccelRatio)}`}>
                              {trail.deltaAccelRatio?.toFixed(2) ?? 'DM'}x
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Peak Delta */}
                      <td className="px-3 py-2.5 text-right">
                        <div className="text-white font-mono">
                          {trail.peakDelta?.toFixed(3) ?? <span className="text-slate-500 italic text-[10px]">DM</span>}
                        </div>
                        {deltaDropPct > 0 && (
                          <div className="text-[10px] text-red-400">-{deltaDropPct.toFixed(1)}%</div>
                        )}
                      </td>

                      {/* Premium */}
                      <td className="px-3 py-2.5 text-right">
                        <div className="text-white font-mono">
                          {trail.currentPremium?.toFixed(2) ?? <span className="text-slate-500 italic text-[10px]">DM</span>}
                        </div>
                        <div className={`text-[10px] ${hwmPct < -10 ? 'text-red-400' : hwmPct < 0 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                          HWM: {trail.highWatermark?.toFixed(2) ?? 'DM'}
                          {hwmPct !== 0 && ` (${hwmPct > 0 ? '+' : ''}${hwmPct.toFixed(1)}%)`}
                        </div>
                      </td>

                      {/* Trail Stop */}
                      <td className="px-3 py-2.5 text-right">
                        <div className={`font-mono ${isDangerZone ? 'text-red-400 font-bold' : 'text-white'}`}>
                          {trail.trailStopPrice?.toFixed(2) ?? <span className="text-slate-500 italic text-[10px]">DM</span>}
                        </div>
                        <div className={`text-[10px] ${isDangerZone ? 'text-red-400' : 'text-slate-500'}`}>
                          {trailDist.toFixed(1)}% away
                        </div>
                      </td>

                      {/* Trail % (visual bar) */}
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 rounded-full transition-all"
                              style={{ width: `${Math.min(Math.max(trail.currentTrailPct || 0, 0), 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-amber-400 w-10 text-right">
                            {trail.currentTrailPct?.toFixed(1) ?? 'DM'}%
                          </span>
                        </div>
                      </td>

                      {/* Theta */}
                      <td className="px-3 py-2.5 text-right">
                        <div className={`inline-flex px-1.5 py-0.5 rounded ${thetaBg(trail.thetaBurnRate)}`}>
                          <span className={`font-mono ${thetaColor(trail.thetaBurnRate)}`}>
                            {trail.thetaBurnRate?.toFixed(2) ?? 'DM'}%
                          </span>
                        </div>
                      </td>

                      {/* Gamma */}
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {trail.currentGamma?.toFixed(4) ?? <span className="text-slate-500 italic text-[10px]">DM</span>}
                      </td>

                      {/* IV */}
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {trail.currentIV != null ? `${(trail.currentIV * 100).toFixed(1)}%` : <span className="text-slate-500 italic text-[10px]">DM</span>}
                      </td>

                      {/* DTE */}
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-mono ${trail.dte <= 2 ? 'text-red-400 font-bold' : trail.dte <= 5 ? 'text-yellow-400' : 'text-slate-300'}`}>
                          {trail.dte ?? <span className="text-slate-500 italic text-[10px]">DM</span>}d
                        </span>
                      </td>

                      {/* Duration */}
                      <td className="px-3 py-2.5 text-right text-slate-400 font-mono">
                        {trail.t1HitTime ? formatDuration(trail.t1HitTime) : <span className="text-slate-500 italic text-[10px]">DM</span>}
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setForceExitTarget(trail.positionKey)}
                          className="px-3 py-1 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border border-orange-500/30 transition-colors"
                        >
                          FORCE EXIT
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Exit History */}
      {exitedTrails.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">
            Exit History ({exitedTrails.length})
          </h2>
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-900/40">
                    <th className="text-left px-3 py-2 text-slate-500 font-medium">Scrip</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium">Exit Reason</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium">Entry</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium">Exit</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium">P&L Est.</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium">Peak Delta</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium">Duration</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium">Exited At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/20">
                  {exitedTrails.map(trail => {
                    const pnl = trail.estimatedPnl ?? (trail.exitPremium != null ? (trail.exitPremium - trail.entryPremium) * (trail.lotSize || 1) : null)
                    return (
                      <tr key={trail.positionKey} className="hover:bg-slate-700/10 transition-colors opacity-70">
                        <td className="px-3 py-2">
                          <div className="text-white">
                            {trail.companyName || trail.scripCode}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {trail.optionType} {trail.strike} {trail.strategy}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <ExitBadge reason={trail.exitReason} />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400">
                          {trail.entryPremium?.toFixed(2) ?? <span className="text-slate-500 italic text-[10px]">DM</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400">
                          {trail.exitPremium?.toFixed(2) ?? <span className="text-slate-500 italic text-[10px]">DM</span>}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-medium ${
                          pnl != null ? (pnl >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'
                        }`}>
                          {pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}` : <span className="italic text-[10px]">DM</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400">
                          {trail.peakDelta?.toFixed(3) ?? <span className="text-slate-500 italic text-[10px]">DM</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400 font-mono">
                          {trail.t1HitTime && trail.exitTime
                            ? formatDuration(trail.t1HitTime)
                            : <span className="text-slate-500 italic text-[10px]">DM</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500 text-[10px]">
                          {trail.exitTime ? new Date(trail.exitTime).toLocaleTimeString('en-IN') : <span className="italic">DM</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        open={forceExitTarget !== null}
        title="Force Exit Position"
        message={`Force-exit trailing position ${forceExitTarget}? This will immediately close the position at market.`}
        confirmLabel={actionLoading ? 'Exiting...' : 'Force Exit'}
        confirmColor="bg-orange-600 hover:bg-orange-700"
        onConfirm={handleForceExit}
        onCancel={() => setForceExitTarget(null)}
      />

      <ConfirmDialog
        open={showDisableConfirm}
        title="Emergency Disable All Trails"
        message="This will immediately kill ALL active Greek trailing positions. All trails will be force-exited at market price. This action cannot be undone."
        confirmLabel={actionLoading ? 'Disabling...' : 'DISABLE ALL'}
        confirmColor="bg-red-600 hover:bg-red-700"
        onConfirm={handleDisableAll}
        onCancel={() => setShowDisableConfirm(false)}
      />

      {/* Footer */}
      <div className="text-center text-xs text-slate-600 pt-2">
        Greek trailing activates after T1 target hit on option positions.
        Delta acceleration and theta burn drive trail-stop adjustments.
      </div>
    </div>
  )
}
