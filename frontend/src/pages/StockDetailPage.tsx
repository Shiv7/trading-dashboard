import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { fetchJson } from '../services/api'

// ═══════════════════════════════════════════════════════════════
// Universal Stock Detail Page — works for Equity, Commodity FUT,
// Currency FUT, and Options. One endpoint, zero 404s.
// Defense-first: Risk Flags → Verdict → Data → Trade button.
// ═══════════════════════════════════════════════════════════════

interface StockContext {
  scripCode: string
  identity: {
    companyName: string; exchange: string; instrumentType: string; tradingType: string
    symbolRoot: string; expiry?: string; daysToExpiry?: number; expiryLabel?: string
    lotSize: number; multiplier: number; tickSize: number
  }
  price: {
    available: boolean; open: number; high: number; low: number; close: number
    volume: number; vwap: number; date: string; atr20: number; todayRange: number
    atrRatio: number; atrLabel: string; ma20: number
    series5d?: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>
  }
  oiTrend?: Array<{ date: string; oi: number; oiChange: number; oiChangePct: number; priceChangePct: number; buildup: string }>
  latestIV?: number
  trackRecord: {
    totalTrades: number; wins: number; winRate: number; totalPnl: number; avgPnl: number
    history?: Array<{ exitTime: string; side: string; entryPrice: number; exitPrice: number; pnl: number; exitReason: string; strategy: string; isWin: boolean }>
  }
  signals: Array<{ signalId: string; direction: string; entryPrice: number; stopLoss: number; target1: number; target2?: number; createdAt: string; reason?: string; compositeScore?: number }>
  position?: { isOpen: boolean; side: string; avgEntry: number; realizedPnl: number; status: string; qtyOpen: number; sl?: number; tp1?: number }
  enrichment?: { change1dPct?: number; change5dPct?: number; change20dPct?: number; vsSectorLabel?: string; sector?: string; ltpYesterday?: number }
  macro: { nifty50Price: number; crudePrice: number; crudeChangePct: number; dxyPrice: number; dxyChangePct: number; goldPrice: number; indiaVix: number; relevantContext: string; inference: string; fiiNetToday?: number }
  deals?: Array<{ date: string; clientName: string; buySell: string; quantity: number; price: number; valueCr: number }>
  riskFlags: Array<{ severity: 'CRITICAL' | 'WARNING' | 'INFO'; message: string }>
  verdict: { score: number; label: string; action: string; reasons: string[] }
}

const signColor = (n: number) => n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-slate-400'
const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
const fmtPrice = (n: number) => n > 0 ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'
const fmtCr = (n: number) => Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-IN') : n.toFixed(1)
/** Format ISO timestamp to readable IST: "10-Apr 18:45 IST" or "10-Apr-2026" */
const fmtTs = (ts?: string, showTime = true): string => {
  if (!ts) return ''
  try {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    // Handle both ISO "2026-04-10T03:44:00Z" and "2026-04-10" formats
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts.substring(0, 10)
    // Convert to IST (+5:30)
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
    const dd = ist.getUTCDate()
    const mm = months[ist.getUTCMonth()]
    const yy = ist.getUTCFullYear()
    if (!showTime) return `${dd}-${mm}-${yy}`
    const hh = String(ist.getUTCHours()).padStart(2, '0')
    const mn = String(ist.getUTCMinutes()).padStart(2, '0')
    return `${dd}-${mm} ${hh}:${mn} IST`
  } catch { return ts.substring(0, 10) }
}

const exchangeBadge: Record<string, string> = {
  N: 'bg-blue-500/20 text-blue-400',
  M: 'bg-amber-500/20 text-amber-400',
  C: 'bg-purple-500/20 text-purple-400',
}
const typeBadge: Record<string, string> = {
  EQ: 'bg-slate-600/40 text-slate-300',
  FUT: 'bg-amber-600/30 text-amber-300',
  OPT: 'bg-purple-600/30 text-purple-300',
}
const buildupColor: Record<string, string> = {
  LONG_BUILDUP: 'text-emerald-400',
  SHORT_BUILDUP: 'text-red-400',
  SHORT_COVERING: 'text-amber-400',
  LONG_UNWINDING: 'text-amber-400',
  NEUTRAL: 'text-slate-400',
}
const verdictStyle: Record<string, { bg: string; text: string; icon: string }> = {
  AVOID:     { bg: 'bg-red-600/20 border-red-500/50', text: 'text-red-300', icon: '⛔' },
  CAUTION:   { bg: 'bg-amber-600/20 border-amber-500/50', text: 'text-amber-300', icon: '⚠' },
  NEUTRAL:   { bg: 'bg-slate-700/30 border-slate-600/50', text: 'text-slate-300', icon: '↔' },
  FAVORABLE: { bg: 'bg-emerald-600/20 border-emerald-500/50', text: 'text-emerald-300', icon: '🟢' },
  STRONG:    { bg: 'bg-emerald-600/30 border-emerald-400/60', text: 'text-emerald-200', icon: '🟢🟢' },
}

export default function StockDetailPage() {
  const { scripCode } = useParams<{ scripCode: string }>()
  const navigate = useNavigate()
  const [ctx, setCtx] = useState<StockContext | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!scripCode) return
    try {
      const data = await fetchJson<StockContext>(`/stock/${scripCode}/context`)
      setCtx(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [scripCode])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s during likely market hours (crude check; real gating on backend)
  useEffect(() => {
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-slate-800/50 rounded-xl" />)}
    </div>
  )

  if (!ctx) return (
    <div className="text-center py-12">
      <div className="text-xl text-slate-400 mb-4">No data for {scripCode}</div>
      <Link to="/insights" className="text-blue-400 hover:text-blue-300">← Back to Insights</Link>
    </div>
  )

  const { identity: id, price: p, oiTrend, trackRecord: tr, signals, position: pos, enrichment: enr, macro, deals, riskFlags, verdict } = ctx
  const isCommodity = id.tradingType === 'COMMODITY'
  const isDerivative = id.instrumentType === 'FUT' || id.instrumentType === 'OPT'
  const exchLabel = id.exchange === 'M' ? 'MCX' : id.exchange === 'C' ? 'CDS' : 'NSE'
  const priceChg = p.available && p.open > 0 ? ((p.close - p.open) / p.open) * 100 : (enr?.change1dPct ?? 0)
  const ltp = p.available ? p.close : (enr?.ltpYesterday ?? 0)

  return (
    <div className="space-y-4 pb-20">

      {/* ════════════ ① HEADER ════════════ */}
      <header className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link to="/insights" className="text-slate-400 hover:text-white text-sm">← Insights</Link>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${exchangeBadge[id.exchange] || 'bg-slate-600/40 text-slate-300'}`}>{exchLabel}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${typeBadge[id.instrumentType] || typeBadge.EQ}`}>{id.instrumentType}</span>
            </div>
            <h1 className="text-2xl font-bold text-white leading-tight">{id.companyName || scripCode}</h1>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-3xl font-bold text-white tracking-tight">{fmtPrice(ltp)}</span>
              <span className={`text-lg font-semibold ${signColor(priceChg)}`}>{fmtPct(priceChg)}</span>
            </div>
            {p.date && <div className="text-[10px] text-slate-500 mt-0.5">last traded {fmtTs(p.date)}</div>}
          </div>
          <div className="text-right shrink-0">
            {id.expiry && (
              <div className={`text-sm font-semibold ${(id.daysToExpiry ?? 99) <= 7 ? 'text-red-400' : (id.daysToExpiry ?? 99) <= 14 ? 'text-amber-400' : 'text-slate-400'}`}>
                {id.expiryLabel} to expiry
              </div>
            )}
            {id.expiry && <div className="text-[11px] text-slate-500">{id.expiry}</div>}
            <div className="text-[11px] text-slate-500 mt-1">Lot: {id.lotSize} × {id.multiplier}</div>
            {pos && (
              <div className={`text-[11px] mt-1 font-semibold ${pos.isOpen ? 'text-emerald-400' : 'text-slate-500'}`}>
                {pos.isOpen ? `🟢 ${pos.side} OPEN` : '🔴 CLOSED'}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ════════════ ② RISK FLAGS ════════════ */}
      {riskFlags.length > 0 && (
        <div className="space-y-2">
          {riskFlags.map((f, i) => (
            <div key={i} className={`rounded-xl border p-4 ${f.severity === 'CRITICAL' ? 'border-red-500/50 bg-red-600/15' : f.severity === 'WARNING' ? 'border-amber-500/50 bg-amber-600/15' : 'border-blue-500/30 bg-blue-600/10'}`}>
              <span className="text-sm font-semibold">
                {f.severity === 'CRITICAL' ? '⛔' : f.severity === 'WARNING' ? '⚠' : 'ℹ'} {f.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ════════════ ③ VERDICT ════════════ */}
      {verdict && (() => {
        const vs = verdictStyle[verdict.label] || verdictStyle.NEUTRAL
        return (
          <div className={`rounded-xl border p-5 ${vs.bg}`}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{vs.icon}</span>
              <span className={`text-2xl font-bold ${vs.text}`}>{verdict.label}</span>
              <span className="text-slate-500 text-sm ml-auto">score {verdict.score}</span>
            </div>
            <p className={`text-base ${vs.text}`}>{verdict.action}</p>
            {verdict.reasons.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {verdict.reasons.map((r, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-300">{r}</span>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* ════════════ ④ TRACK RECORD ════════════ */}
      {tr.totalTrades > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider">📈 Your Track Record on {id.symbolRoot || scripCode}</div>
            {tr.history && tr.history.length > 0 && (
              <span className="text-[10px] text-slate-500 italic">
                {fmtTs(tr.history[tr.history.length - 1]?.exitTime, false)} → {fmtTs(tr.history[0]?.exitTime, false)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{tr.totalTrades}</div>
              <div className="text-[11px] text-slate-500">Trades</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${tr.winRate >= 50 ? 'text-emerald-400' : tr.winRate >= 30 ? 'text-amber-400' : 'text-red-400'}`}>{tr.winRate}%</div>
              <div className="text-[11px] text-slate-500">Win Rate</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold tracking-tight ${signColor(tr.totalPnl)}`}>{tr.totalPnl > 0 ? '+' : ''}₹{fmtCr(tr.totalPnl)}</div>
              <div className="text-[11px] text-slate-500">Total P&L</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold tracking-tight ${signColor(tr.avgPnl)}`}>₹{fmtCr(tr.avgPnl)}</div>
              <div className="text-[11px] text-slate-500">Avg per Trade</div>
            </div>
          </div>
          {tr.history && tr.history.length > 0 && (
            <details>
              <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300">Show last {Math.min(5, tr.history.length)} trades</summary>
              <div className="mt-2 space-y-1">
                {tr.history.slice(0, 5).map((h, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[12px]">
                    <span className="text-slate-500 w-28 shrink-0">{String(h.exitTime).substring(0, 10)}</span>
                    <span className={`font-semibold ${h.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{h.side}</span>
                    <span className="text-slate-400">→ {h.exitReason}</span>
                    <span className={`ml-auto font-bold ${signColor(h.pnl)}`}>₹{fmtCr(h.pnl)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ════════════ ⑤ PRICE + CHANGES ════════════ */}
      {p.available && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider">💰 Price Action</div>
            {p.date && <span className="text-[10px] text-slate-500 italic">as of {fmtTs(p.date, false)}</span>}
          </div>
          <div className="grid grid-cols-5 gap-3 text-center mb-3">
            {[['Open', p.open], ['High', p.high, 'text-emerald-400'], ['Low', p.low, 'text-red-400'], ['Close', p.close], ['Volume', p.volume]].map(([label, val, color]) => (
              <div key={label as string}>
                <div className="text-[11px] text-slate-500 uppercase">{label as string}</div>
                <div className={`text-base font-bold ${(color as string) || 'text-white'}`}>
                  {label === 'Volume' ? ((val as number) >= 100000 ? `${((val as number) / 100000).toFixed(1)}L` : `${((val as number) / 1000).toFixed(0)}K`) : fmtPrice(val as number)}
                </div>
              </div>
            ))}
          </div>
          {/* Day range bar */}
          {p.high > 0 && p.low > 0 && (
            <div>
              <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                <span>{fmtPrice(p.low)}</span>
                <span>Day Range</span>
                <span>{fmtPrice(p.high)}</span>
              </div>
              <div className="relative h-2 bg-slate-700 rounded-full">
                <div className="absolute h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 rounded-full w-full" />
                <div className="absolute top-1/2 w-2.5 h-2.5 bg-white rounded-full border-2 border-slate-600 shadow"
                  style={{ left: `${Math.max(2, Math.min(98, ((p.close - p.low) / (p.high - p.low)) * 100))}%`, transform: 'translate(-50%, -50%)' }} />
              </div>
            </div>
          )}
          {/* ATR context */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-[12px]">
            <div>
              <span className="text-slate-500">ATR(20): </span>
              <span className="text-white font-semibold">{fmtPrice(p.atr20)}</span>
            </div>
            <div>
              <span className="text-slate-500">Today range: </span>
              <span className="text-white font-semibold">{fmtPrice(p.todayRange)}</span>
            </div>
            <div>
              <span className="text-slate-500">Ratio: </span>
              <span className={`font-semibold ${p.atrRatio > 1.3 ? 'text-red-400' : p.atrRatio > 0.8 ? 'text-white' : 'text-emerald-400'}`}>{(p.atrRatio * 100).toFixed(0)}%</span>
            </div>
            <div>
              <span className="text-slate-500">MA(20): </span>
              <span className={`font-semibold ${p.close >= p.ma20 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPrice(p.ma20)}</span>
              <span className="text-[10px] text-slate-500 ml-1">{p.close >= p.ma20 ? 'above' : 'below'}</span>
            </div>
          </div>
          {/* Enrichment changes if available */}
          {enr && (
            <div className="flex gap-3 mt-3 text-[12px]">
              {enr.change1dPct != null && <span className={`font-semibold ${signColor(enr.change1dPct)}`}>1D {fmtPct(enr.change1dPct)}</span>}
              {enr.change5dPct != null && <span className={`font-semibold ${signColor(enr.change5dPct)}`}>5D {fmtPct(enr.change5dPct)}</span>}
              {enr.change20dPct != null && <span className={`font-semibold ${signColor(enr.change20dPct)}`}>20D {fmtPct(enr.change20dPct)}</span>}
              {enr.vsSectorLabel && <span className="text-slate-400">vs Sector: <span className="text-white font-semibold">{enr.vsSectorLabel}</span></span>}
            </div>
          )}
        </div>
      )}

      {/* ════════════ ⑥ OI DAILY TREND (derivatives only) ════════════ */}
      {oiTrend && oiTrend.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider">📊 OI Daily Trend</div>
            <span className="text-[10px] text-slate-500 italic">
              {oiTrend[oiTrend.length - 1]?.date?.substring(5)} → {oiTrend[0]?.date?.substring(5)} ({oiTrend.length} trading days)
            </span>
          </div>
          <div className="space-y-2">
            {oiTrend.map((day, i) => {
              const maxChg = Math.max(...oiTrend.map(d => Math.abs(d.oiChange)))
              const barW = maxChg > 0 ? Math.max(5, Math.abs(day.oiChange) / maxChg * 100) : 0
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-500 w-20 shrink-0">{day.date.substring(5)}</span>
                  <div className="flex-1 h-5 relative bg-slate-700/30 rounded">
                    <div
                      className={`absolute h-full rounded ${day.oiChange > 0 ? 'bg-emerald-500/30' : 'bg-red-500/30'}`}
                      style={{ width: `${barW}%`, [day.oiChange >= 0 ? 'left' : 'right']: 0 }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-white">
                      {day.oiChange > 0 ? '+' : ''}{day.oiChange.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <span className={`text-[11px] font-semibold w-20 shrink-0 ${signColor(day.priceChangePct)}`}>{fmtPct(day.priceChangePct)}</span>
                  <span className={`text-[10px] font-bold w-28 shrink-0 ${buildupColor[day.buildup] || 'text-slate-400'}`}>{day.buildup.replace('_', ' ')}</span>
                </div>
              )
            })}
          </div>
          {ctx.latestIV != null && (
            <div className="mt-3 text-[12px] text-slate-400">IV: <span className="text-white font-semibold">{ctx.latestIV.toFixed(1)}%</span></div>
          )}
        </div>
      )}

      {/* ════════════ ⑦ SMART LEVELS (from last signal) ════════════ */}
      {signals.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">🎯 Smart Levels (from last signal)</div>
          {(() => {
            const s = signals[0]
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                  <div className="text-[10px] text-slate-400 uppercase">Entry</div>
                  <div className="text-lg font-bold text-emerald-400">{fmtPrice(s.entryPrice)}</div>
                </div>
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-center">
                  <div className="text-[10px] text-slate-400 uppercase">Stop Loss</div>
                  <div className="text-lg font-bold text-red-400">{fmtPrice(s.stopLoss)}</div>
                </div>
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-center">
                  <div className="text-[10px] text-slate-400 uppercase">Target 1</div>
                  <div className="text-lg font-bold text-blue-400">{fmtPrice(s.target1)}</div>
                </div>
                {s.target2 && (
                  <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-center">
                    <div className="text-[10px] text-slate-400 uppercase">Target 2</div>
                    <div className="text-lg font-bold text-purple-400">{fmtPrice(s.target2)}</div>
                  </div>
                )}
              </div>
            )
          })()}
          {p.ma20 > 0 && <div className="mt-2 text-[12px] text-slate-400">20-day MA: <span className={`font-semibold ${p.close >= p.ma20 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPrice(p.ma20)}</span></div>}
          <div className="mt-2 text-[10px] text-slate-500 italic">Signal from {signals[0].createdAt?.substring(0, 16).replace('T', ' ')} · {signals[0].direction}</div>
        </div>
      )}

      {/* ════════════ ⑧ MACRO CONTEXT ════════════ */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            🌍 Macro Context ({macro.relevantContext === 'commodity' ? 'Commodity' : macro.relevantContext === 'currency' ? 'Currency' : 'Equity'})
          </div>
          <span className="text-[10px] text-slate-500 italic">
            updated {new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {!isCommodity && <MacroCard label="Nifty 50" value={macro.nifty50Price} />}
          <MacroCard label="Crude WTI" value={macro.crudePrice} changePct={macro.crudeChangePct} />
          <MacroCard label="DXY" value={macro.dxyPrice} changePct={macro.dxyChangePct} invert />
          <MacroCard label="Gold" value={macro.goldPrice} changePct={macro.goldChangePct} />
        </div>
        <p className="text-sm text-slate-300">→ {macro.inference}</p>
      </div>

      {/* ════════════ ⑨ RECENT SIGNALS ════════════ */}
      {signals.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider">⚡ Recent Signals ({signals.length})</div>
            {signals.length > 0 && (
              <span className="text-[10px] text-slate-500 italic">
                {fmtTs(signals[signals.length - 1]?.createdAt)} → {fmtTs(signals[0]?.createdAt)}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {signals.map((s, i) => (
              <div key={i} className={`rounded-lg border p-3 ${s.direction === 'BULLISH' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-500">{s.createdAt?.substring(0, 16).replace('T', ' ')}</span>
                  <span className={`text-sm font-bold ${s.direction === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'}`}>{s.direction}</span>
                  <span className="text-[12px] text-slate-300">Entry {fmtPrice(s.entryPrice)} · SL {fmtPrice(s.stopLoss)} · T1 {fmtPrice(s.target1)}</span>
                </div>
                {s.reason && <div className="text-[10px] text-slate-500 mt-1">{s.reason}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════ ⑩ INSTITUTIONAL DEALS (equities only) ════════════ */}
      {deals && deals.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider">🏛️ Block/Bulk Deals ({deals.length})</div>
            {deals.length > 0 && (
              <span className="text-[10px] text-slate-500 italic">
                {deals[deals.length - 1]?.date?.substring(0, 11)} → {deals[0]?.date?.substring(0, 11)}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {deals.slice(0, 10).map((d, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-slate-500 w-20 shrink-0">{d.date?.substring(0, 10)}</span>
                <span className="text-slate-200 truncate flex-1">{d.clientName}</span>
                <span className={`font-semibold ${d.buySell === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{d.buySell}</span>
                <span className="text-white font-mono">{d.valueCr?.toFixed(1)} Cr</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════ ⑪ POSITION BAR (only if OPEN) ════════════ */}
      {pos?.isOpen && (
        <div className={`rounded-xl border p-5 ${(pos.realizedPnl ?? 0) >= 0 ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
          <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">🔫 Open Position</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] text-slate-500">Side</div>
              <div className={`text-lg font-bold ${pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{pos.side}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Entry</div>
              <div className="text-lg font-bold text-white">{fmtPrice(pos.avgEntry)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">P&L</div>
              <div className={`text-lg font-bold ${signColor(pos.realizedPnl)}`}>₹{fmtCr(pos.realizedPnl)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Qty Open</div>
              <div className="text-lg font-bold text-white">{pos.qtyOpen}</div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ ⑫ NAVIGATION ════════════ */}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/insights" className="text-blue-400 hover:text-blue-300">→ Insights</Link>
        <Link to="/market-pulse" className="text-blue-400 hover:text-blue-300">→ Market Pulse</Link>
        <Link to="/order-history" className="text-blue-400 hover:text-blue-300">→ Order History</Link>
        <Link to="/hot-stocks" className="text-blue-400 hover:text-blue-300">→ Hot Stocks</Link>
      </div>
    </div>
  )
}

function MacroCard({ label, value, changePct, invert }: { label: string; value: number; changePct?: number; invert?: boolean }) {
  const colorVal = invert ? -(changePct ?? 0) : (changePct ?? 0)
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-2 text-center">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-sm font-bold text-white">{value > 0 ? value.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'}</div>
      {changePct != null && <div className={`text-[11px] font-semibold ${signColor(colorVal)}`}>{fmtPct(changePct)}</div>}
    </div>
  )
}
