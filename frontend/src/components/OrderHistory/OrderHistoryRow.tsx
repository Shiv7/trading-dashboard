import { useState } from 'react'

export interface UnifiedOrder {
  id: string
  signalId: string
  scripCode: string
  companyName: string
  strategy: string
  side: string
  direction?: string
  isOpen: boolean
  entryPrice: number
  exitPrice?: number
  stopLoss?: number
  target1?: number
  target2?: number
  target3?: number
  target4?: number
  trailingStop?: number
  pnl: number
  pnlPercent: number
  entryTime: string
  exitTime?: string
  exitReason?: string
  serial: number
  // Rich fields
  quantity?: number
  exchange?: string
  instrumentType?: string
  instrumentSymbol?: string
  totalCharges?: number
  estimatedEntrySlippage?: number
  estimatedEntrySlippageTotal?: number
  estimatedSlippagePct?: number
  slippageTier?: string
  exitSlippagePerUnit?: number
  exitSlippageTotal?: number
  grossPnl?: number
  chargesBrokerage?: number
  chargesStt?: number
  chargesExchange?: number
  chargesGst?: number
  chargesSebi?: number
  chargesStamp?: number
  rMultiple?: number
  riskReward?: number
  durationMinutes?: number
  executionMode?: string
  capitalEmployed?: number
}

interface OrderHistoryRowProps {
  order: UnifiedOrder
}

export type { OrderHistoryRowProps }

const fmtINR = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
const fmtINR2 = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const fmtNum = (v: number | undefined | null, d = 2) => v != null ? v.toFixed(d) : 'DM'

const fmtTime = (time?: string) => {
  if (!time) return '-'
  try {
    const d = new Date(time)
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return '-' }
}

const fmtDuration = (mins?: number) => {
  if (!mins || mins <= 0) return 'DM'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function OrderHistoryRow({ order }: OrderHistoryRowProps) {
  const [expanded, setExpanded] = useState(false)
  const isLong = order.side === 'LONG' || order.direction === 'BULLISH'

  const grossPnl = order.totalCharges != null
    ? order.pnl + order.totalCharges
    : undefined

  return (
    <>
      <tr
        className="hover:bg-slate-700/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Serial */}
        <td className="py-2.5 px-3 text-slate-500 text-sm">{order.serial}</td>

        {/* Security + Instrument */}
        <td className="py-2.5 px-3">
          <div className="font-medium text-white text-sm">{order.companyName || order.scripCode}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {order.exchange && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                order.exchange === 'M' ? 'bg-amber-500/15 text-amber-400' :
                order.exchange === 'C' ? 'bg-purple-500/15 text-purple-400' :
                'bg-blue-500/15 text-blue-400'
              }`}>{order.exchange === 'M' ? 'MCX' : order.exchange === 'C' ? 'CUR' : 'NSE'}</span>
            )}
            {order.instrumentType && (
              <span className="text-[10px] text-slate-500">{order.instrumentType}</span>
            )}
          </div>
        </td>

        {/* Strategy */}
        <td className="py-2.5 px-3">
          <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{order.strategy}</span>
        </td>

        {/* Side */}
        <td className="py-2.5 px-3">
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            {order.side}
          </span>
        </td>

        {/* Qty */}
        <td className="py-2.5 px-3 text-slate-300 text-sm">{order.quantity ?? 'DM'}</td>

        {/* Entry */}
        <td className="py-2.5 px-3 text-slate-300 text-sm">{fmtNum(order.entryPrice)}</td>

        {/* Exit */}
        <td className="py-2.5 px-3 text-slate-300 text-sm">
          {order.isOpen ? <span className="text-blue-400 text-xs">OPEN</span> : fmtNum(order.exitPrice)}
        </td>

        {/* Gross P&L */}
        <td className="py-2.5 px-3 text-sm">
          {grossPnl != null ? (
            <span className={grossPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {fmtINR(grossPnl)}
            </span>
          ) : <span className="text-slate-500 italic text-[10px]">DM</span>}
        </td>

        {/* Charges */}
        <td className="py-2.5 px-3 text-sm text-amber-400">
          {order.totalCharges != null && order.totalCharges > 0 ? fmtINR(order.totalCharges) : 'DM'}
        </td>

        {/* Net P&L */}
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-1">
            {order.isOpen && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
            <span className={`text-sm font-medium ${order.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtINR(order.pnl)}
            </span>
          </div>
          <div className={`text-[10px] ${order.pnlPercent >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
            {order.pnlPercent >= 0 ? '+' : ''}{fmtNum(order.pnlPercent)}%
          </div>
        </td>

        {/* Entry Time */}
        <td className="py-2.5 px-3 text-slate-400 text-xs">{fmtTime(order.entryTime)}</td>

        {/* Exit Time / Reason */}
        <td className="py-2.5 px-3 text-xs">
          {order.isOpen ? (
            <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 text-[10px] font-medium">OPEN</span>
          ) : (
            <div>
              <div className="text-slate-400">{fmtTime(order.exitTime)}</div>
              {order.exitReason && (
                <span className={`text-[10px] font-medium ${
                  order.exitReason.includes('TARGET') || order.exitReason.includes('T') ? 'text-emerald-400/70' :
                  order.exitReason.includes('SL') ? 'text-red-400/70' :
                  'text-slate-500'
                }`}>{order.exitReason}</span>
              )}
            </div>
          )}
        </td>
      </tr>

      {/* Expanded Detail Row */}
      {expanded && (
        <tr className="bg-slate-800/50">
          <td colSpan={12} className="px-6 py-3">
            <div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              <div>
                <span className="text-slate-500">SL</span>
                <div className="text-red-400 font-medium">{fmtNum(order.stopLoss)}</div>
              </div>
              <div>
                <span className="text-slate-500">T1</span>
                <div className="text-emerald-400 font-medium">{fmtNum(order.target1)}</div>
              </div>
              <div>
                <span className="text-slate-500">T2</span>
                <div className="text-emerald-400 font-medium">{fmtNum(order.target2)}</div>
              </div>
              <div>
                <span className="text-slate-500">T3</span>
                <div className="text-emerald-400 font-medium">{fmtNum(order.target3)}</div>
              </div>
              <div>
                <span className="text-slate-500">R:R</span>
                <div className="text-white font-medium">{fmtNum(order.riskReward)}</div>
              </div>
              <div>
                <span className="text-slate-500">R-Multiple</span>
                <div className={`font-medium ${(order.rMultiple ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtNum(order.rMultiple)}R
                </div>
              </div>
              <div>
                <span className="text-slate-500">Duration</span>
                <div className="text-white font-medium">{fmtDuration(order.durationMinutes)}</div>
              </div>
              <div>
                <span className="text-slate-500">Capital</span>
                <div className="text-white font-medium">{order.capitalEmployed ? fmtINR(order.capitalEmployed) : 'DM'}</div>
              </div>
              <div>
                <span className="text-slate-500">Entry Slippage</span>
                <div className="text-amber-400 font-medium">
                  {order.estimatedEntrySlippage != null
                    ? `${fmtNum(order.estimatedEntrySlippage)} (${fmtNum(order.estimatedSlippagePct)}%)`
                    : 'DM'}
                </div>
              </div>
              <div>
                <span className="text-slate-500">Exit Slippage</span>
                <div className="text-amber-400 font-medium">
                  {order.exitSlippagePerUnit != null
                    ? `${fmtNum(order.exitSlippagePerUnit)}/unit (${fmtINR2(order.exitSlippageTotal ?? 0)})`
                    : 'DM'}
                </div>
              </div>
              <div>
                <span className="text-slate-500">Instrument</span>
                <div className="text-slate-300 font-medium">{order.instrumentSymbol || 'DM'}</div>
              </div>
              <div>
                <span className="text-slate-500">Execution</span>
                <div className="text-slate-300 font-medium">{order.executionMode || 'DM'}</div>
              </div>
            </div>
            {/* Charge Breakdown */}
            {order.totalCharges != null && order.totalCharges > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700/50">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Charge Breakdown</span>
                <div className="flex flex-wrap gap-4 mt-1 text-xs">
                  <span className="text-slate-400">Brokerage: <span className="text-white">{order.chargesBrokerage != null ? fmtINR2(order.chargesBrokerage) : 'DM'}</span></span>
                  <span className="text-slate-400">STT/CTT: <span className="text-white">{order.chargesStt != null ? fmtINR2(order.chargesStt) : 'DM'}</span></span>
                  <span className="text-slate-400">Exchange: <span className="text-white">{order.chargesExchange != null ? fmtINR2(order.chargesExchange) : 'DM'}</span></span>
                  <span className="text-slate-400">GST: <span className="text-white">{order.chargesGst != null ? fmtINR2(order.chargesGst) : 'DM'}</span></span>
                  <span className="text-slate-400">SEBI: <span className="text-white">{order.chargesSebi != null ? fmtINR2(order.chargesSebi) : 'DM'}</span></span>
                  <span className="text-slate-400">Stamp: <span className="text-white">{order.chargesStamp != null ? fmtINR2(order.chargesStamp) : 'DM'}</span></span>
                </div>
              </div>
            )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
