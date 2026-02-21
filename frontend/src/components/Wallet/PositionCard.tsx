import { Link } from 'react-router-dom'
import type { Position } from '../../types'
import PositionActions from '../Trading/PositionActions'

interface PositionCardProps {
  position: Position
  onUpdate?: () => void
}

export default function PositionCard({ position, onUpdate }: PositionCardProps) {
  const isLong = position.side === 'LONG'
  const isOpen = position.quantity > 0
  const displayPnl = isOpen ? position.unrealizedPnl : position.realizedPnl
  const pnlColor = displayPnl >= 0 ? 'num-positive' : 'num-negative'
  const isStrategyTrade = !!(position.equitySl || position.optionSl)
  const isFutures = position.instrumentType === 'FUTURES'
  const isMCX = position.instrumentType === 'FUTURES' || (position.strategy && position.scripCode)

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(value)
  }

  /** Format dual level: equity/option (e.g., "1170/6.10") or single for futures */
  const fmtDual = (equity?: number, option?: number) => {
    if (isFutures || !equity || !option) return null
    return `${equity.toFixed(0)}/${option.toFixed(2)}`
  }

  /** Format timestamp in IST with date */
  const fmtTime = (ts: string | number | undefined) => {
    if (!ts) return null
    try {
      const d = new Date(ts)
      if (isNaN(d.getTime())) return null
      const date = d.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short'
      })
      const time = d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
      })
      return `${date}, ${time}`
    } catch { return null }
  }

  /** Format time-only for exit history (compact) */
  const fmtTimeShort = (ts: number | undefined) => {
    if (!ts) return ''
    try {
      const d = new Date(ts)
      if (isNaN(d.getTime())) return ''
      return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
      })
    } catch { return '' }
  }

  return (
    <div className={`card transition-colors ${isOpen ? 'hover:border-blue-500/50' : 'opacity-75 border-slate-700/30'}`}>
      <Link
        to={`/stock/${position.scripCode}`}
        className="block"
      >
        {/* Entry timestamp bar at top */}
        {position.openedAt && (
          <div className="text-[10px] text-slate-500 mb-2 flex items-center gap-1.5">
            <span className="text-slate-600">Entry:</span>
            <span>{fmtTime(position.openedAt)}</span>
          </div>
        )}

        <div className="flex items-start justify-between mb-2 sm:mb-3 gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span className={`font-semibold text-sm sm:text-base truncate ${isOpen ? 'text-white' : 'text-slate-400'}`}>
                {position.companyName || position.scripCode}
              </span>
              <span className={`badge text-[10px] sm:text-xs ${isLong ? 'badge-success' : 'badge-danger'}`}>
                {position.side}
              </span>
              {position.strategy && (
                <span className={`inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold tracking-wide ${
                  position.strategy === 'FUDKII' ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
                  : position.strategy === 'FUKAA' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : position.strategy === 'PIVOT' || position.strategy === 'PIVOT_CONFLUENCE' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : position.strategy === 'MICROALPHA' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                  : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                }`}>
                  {position.strategy}
                </span>
              )}
              {position.instrumentType && (
                <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-medium bg-slate-600/30 text-slate-400 border border-slate-600/30">
                  {position.instrumentType}
                </span>
              )}
            </div>
            <div className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">
              {position.quantity > 0 ? position.quantity : ''} qty @ {formatCurrency(position.avgEntryPrice)}
              {position.delta != null && position.delta < 1 && (
                <span className="text-slate-500 ml-1 sm:ml-2">delta={position.delta}</span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-sm sm:text-lg font-semibold ${pnlColor}`}>
              {formatCurrency(displayPnl)}
            </div>
            <div className={`text-[10px] sm:text-xs ${pnlColor}`}>
              {isOpen
                ? <>{(position.unrealizedPnlPercent ?? 0) >= 0 ? '+' : ''}{(position.unrealizedPnlPercent ?? 0).toFixed(2)}%</>
                : <span className="text-slate-500">realized</span>
              }
            </div>
          </div>
        </div>

        {/* Levels - Dual format for strategy trades */}
        {isStrategyTrade && !isFutures ? (
          <div className="space-y-2 text-xs">
            {/* Entry + Dual LTP row */}
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              <div className="bg-slate-700/30 rounded p-1.5 sm:p-2">
                <div className="text-slate-400 text-[10px] sm:text-xs">Entry</div>
                <div className="text-white font-medium font-mono text-[11px] sm:text-xs">{(position.avgEntryPrice ?? 0).toFixed(2)}</div>
              </div>
              <div className="bg-blue-500/10 rounded p-1.5 sm:p-2">
                <div className="text-blue-400 text-[10px] sm:text-xs">Opt LTP</div>
                <div className="text-white font-medium font-mono text-[11px] sm:text-xs">{(position.currentPrice ?? 0).toFixed(2)}</div>
              </div>
              <div className="bg-indigo-500/10 rounded p-1.5 sm:p-2">
                <div className="text-indigo-400 text-[10px] sm:text-xs">{isMCX ? 'Fut LTP' : 'Eq LTP'}</div>
                <div className="text-white font-medium font-mono text-[11px] sm:text-xs">{(position.equityLtp ?? 0).toFixed(2)}</div>
              </div>
            </div>
            {/* SL + T1-T4 row — 3+2 grid on mobile, 5-col on sm+ */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 sm:gap-1.5">
              <div className={`rounded p-1 sm:p-1.5 ${position.slHit ? 'bg-red-500/20 border border-red-500/40' : 'bg-red-500/10'}`}>
                <div className="text-red-400 flex items-center gap-0.5 text-[10px] sm:text-xs">
                  SL {position.slHit && <span className="text-[9px]">&#10007;</span>}
                </div>
                <div className="text-white font-medium font-mono text-[10px] sm:text-[11px] truncate">
                  {fmtDual(position.equitySl, position.optionSl) ?? (position.stopLoss ?? 0).toFixed(2)}
                </div>
              </div>
              <div className={`rounded p-1 sm:p-1.5 ${position.t1Hit ? 'bg-green-500/20 border border-green-500/40' : 'bg-emerald-500/10'}`}>
                <div className="text-emerald-400 flex items-center gap-0.5 text-[10px] sm:text-xs">
                  T1 {position.t1Hit && <span className="text-green-400 text-[9px]">&#10003;</span>}
                </div>
                <div className="text-white font-medium font-mono text-[10px] sm:text-[11px] truncate">
                  {fmtDual(position.equityT1, position.optionT1) ?? (position.target1 ?? 0).toFixed(2)}
                </div>
              </div>
              <div className={`rounded p-1 sm:p-1.5 ${position.t2Hit ? 'bg-green-500/20 border border-green-500/40' : 'bg-emerald-500/10'}`}>
                <div className="text-emerald-400 flex items-center gap-0.5 text-[10px] sm:text-xs">
                  T2 {position.t2Hit && <span className="text-green-400 text-[9px]">&#10003;</span>}
                </div>
                <div className="text-white font-medium font-mono text-[10px] sm:text-[11px] truncate">
                  {fmtDual(position.equityT2, position.optionT2) ?? (position.target2 ?? 0).toFixed(2)}
                </div>
              </div>
              <div className={`rounded p-1 sm:p-1.5 ${position.t3Hit ? 'bg-green-500/20 border border-green-500/40' : 'bg-emerald-500/10'}`}>
                <div className="text-emerald-400 flex items-center gap-0.5 text-[10px] sm:text-xs">
                  T3 {position.t3Hit && <span className="text-green-400 text-[9px]">&#10003;</span>}
                </div>
                <div className="text-white font-medium font-mono text-[10px] sm:text-[11px] truncate">
                  {fmtDual(position.equityT3, position.optionT3) ?? (position.target3 ?? 0).toFixed(2)}
                </div>
              </div>
              <div className={`rounded p-1 sm:p-1.5 ${position.t4Hit ? 'bg-green-500/20 border border-green-500/40' : 'bg-emerald-500/10'}`}>
                <div className="text-emerald-400 flex items-center gap-0.5 text-[10px] sm:text-xs">
                  T4 {position.t4Hit && <span className="text-green-400 text-[9px]">&#10003;</span>}
                </div>
                <div className="text-white font-medium font-mono text-[10px] sm:text-[11px] truncate">
                  {fmtDual(position.equityT4, position.optionT4) ?? (position.target4 ?? 0).toFixed(2)}
                </div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 italic">Equity/Option levels</div>
          </div>
        ) : (
          /* Standard levels grid for non-strategy or futures trades */
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2 text-xs">
            <div className="bg-slate-700/30 rounded p-1.5 sm:p-2">
              <div className="text-slate-400 text-[10px] sm:text-xs">Entry</div>
              <div className="text-white font-medium text-[11px] sm:text-xs">{(position.avgEntryPrice ?? 0).toFixed(2)}</div>
            </div>
            <div className="bg-blue-500/10 rounded p-1.5 sm:p-2">
              <div className="text-blue-400 text-[10px] sm:text-xs">LTP</div>
              <div className="text-white font-medium text-[11px] sm:text-xs">{(position.currentPrice ?? 0).toFixed(2)}</div>
            </div>
            <div className="bg-red-500/10 rounded p-1.5 sm:p-2">
              <div className="text-red-400 text-[10px] sm:text-xs">SL</div>
              <div className="text-white font-medium text-[11px] sm:text-xs">
                {position.trailingStop ? position.trailingStop.toFixed(2) : (position.stopLoss ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="bg-emerald-500/10 rounded p-1.5 sm:p-2">
              <div className="text-emerald-400 text-[10px] sm:text-xs">Target</div>
              <div className="text-white font-medium text-[11px] sm:text-xs">{(position.target1 ?? 0).toFixed(2)}</div>
            </div>
          </div>
        )}

        {/* Status row: badges + exit history */}
        <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2">
          {/* Status badges row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {isOpen && position.status === 'IN_PROGRESS' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                In Progress
              </span>
            )}
            {isOpen && position.status === 'ACTIVE' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/15 text-green-400 border border-green-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Active
              </span>
            )}
            {position.slHit && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">SL &#10007;</span>
            )}
            {position.exitReason && position.exitReason.length > 0 && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                position.exitReason.startsWith('T') ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                : position.exitReason === 'EOD' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                : position.exitReason === 'MANUAL_CLOSE' ? 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                : 'bg-red-500/15 text-red-400 border border-red-500/30'
              }`}>{position.exitReason}</span>
            )}
            {isOpen && !!position.trailingType && position.trailingType !== 'NONE' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">Trailing</span>
            )}
            {/* Exit timestamp for closed trades */}
            {!isOpen && position.lastUpdated ? (
              <span className="text-[10px] text-slate-500 ml-auto">
                Exit: {fmtTime(position.lastUpdated)}
              </span>
            ) : isOpen ? (
              <span className="text-[10px] text-slate-500 ml-auto">
                {fmtTime(position.openedAt)}
              </span>
            ) : null}
          </div>

          {/* Exit history: per-target exit details */}
          {position.exitHistory && position.exitHistory.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {position.exitHistory.map((ev, i) => (
                <span key={i} className="text-[10px] font-mono">
                  <span className="text-green-400 font-bold">{ev.level}</span>
                  <span className="text-slate-500">: </span>
                  <span className="text-slate-300">{ev.lots}L</span>
                  <span className="text-slate-600"> @</span>
                  <span className="text-slate-300">{ev.price.toFixed(2)}</span>
                  <span className="text-slate-600"> ({fmtTimeShort(ev.timestamp)})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </Link>

      {/* Position Actions - Only show for open positions */}
      {isOpen && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <PositionActions
            scripCode={position.scripCode}
            currentSl={position.stopLoss}
            currentTp1={position.target1}
            currentTp2={position.target2}
            currentPrice={position.currentPrice}
            trailingActive={!!position.trailingType && position.trailingType !== 'NONE'}
            onUpdate={onUpdate}
          />
        </div>
      )}
    </div>
  )
}
