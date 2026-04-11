import { useState, useEffect, useCallback } from 'react'
import { marketPulseApi, CommandCenterInsights } from '../services/api'

type TabId = 'markets' | 'insights' | 'activity' | 'actions'

const fmtCr = (n: number) => {
  if (n == null || isNaN(n)) return '0'
  if (Math.abs(n) >= 100) return Math.round(n).toLocaleString('en-IN')
  return n.toFixed(1)
}
const fmtPct = (n: number) => (n == null || isNaN(n)) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
const fmtPrice = (n: number) => (n == null || isNaN(n) || n === 0) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const signColor = (n: number) => n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-slate-400'
const signBg = (n: number) => n > 0 ? 'border-emerald-500/20 bg-emerald-500/5' : n < 0 ? 'border-red-500/20 bg-red-500/5' : 'border-slate-600/30 bg-slate-700/30'

export default function InsightsPage() {
  const [data, setData] = useState<CommandCenterInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabId>(() => {
    const saved = typeof window !== 'undefined' ? sessionStorage.getItem('insights-tab') : null
    return (saved as TabId) || 'markets'
  })
  const [sections, setSections] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setSections(p => ({ ...p, [k]: !p[k] }))

  const load = useCallback(async () => {
    try {
      const r = await marketPulseApi.getInsights()
      if (r) setData(r)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])

  const switchTab = (t: TabId) => {
    setTab(t)
    try { sessionStorage.setItem('insights-tab', t) } catch {}
  }

  if (loading) return <div className="p-6 text-slate-400">Loading insights…</div>
  if (!data) return <div className="p-6 text-red-400">Failed to load insights. Check backend API.</div>

  return (
    <div className="space-y-4">
      {/* Sticky tab bar */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 bg-slate-900/95 backdrop-blur border-b border-slate-700/50">
        <div className="flex text-xs sm:text-sm">
          {(['markets', 'insights', 'activity', 'actions'] as TabId[]).map(id => (
            <button
              key={id}
              onClick={() => switchTab(id)}
              className={`flex-1 py-3 px-2 font-semibold uppercase tracking-wider transition-colors ${
                tab === id
                  ? 'text-emerald-400 border-b-2 border-emerald-400'
                  : 'text-slate-500 border-b-2 border-transparent hover:text-slate-300'
              }`}
            >
              {id === 'markets' ? '📊 Markets'
                : id === 'insights' ? '🔎 Insights'
                : id === 'activity' ? '🏛️ Activity'
                : '⚡ Actions'}
            </button>
          ))}
        </div>
        <div className="text-center text-[11px] text-slate-500 py-1">
          {(() => {
            const st = data.marketStatus || ''
            const next = data.nextBoundary || ''
            const updated = new Date(data.computedAt || Date.now()).toLocaleTimeString('en-IN', { hour12: false })
            const stLabel =
              st === 'WEEKEND'    ? '🛑 MARKET CLOSED · WEEKEND'
              : st === 'PRE_MARKET' ? '⏰ PRE-MARKET'
              : st === 'NSE_OPEN'   ? '🟢 NSE LIVE'
              : st === 'MCX_OPEN'   ? '🟢 MCX LIVE'
              : st === 'CLOSED'     ? '🔴 MARKETS CLOSED'
              : st || '—'
            const showNext = st !== 'WEEKEND' && next
            return (
              <>
                <span className="font-semibold">{stLabel}</span>
                {showNext && <span> · next {next}</span>}
                <span className="text-slate-600"> · updated {updated}</span>
              </>
            )
          })()}
        </div>
      </div>

      {tab === 'markets' && <MarketsTab data={data} />}
      {tab === 'insights' && <InsightsTab data={data} sections={sections} toggle={toggle} />}
      {tab === 'activity' && <ActivityTab data={data} />}
      {tab === 'actions' && <ActionsTab data={data} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// TAB 1: MARKETS — all global indices + FII/DII + commodities
// Order: India → Asia → US → Europe → Middle East → FII/DII →
//        Commodities → Currencies → Sectors
// ═══════════════════════════════════════════════════════════════
function MarketsTab({ data }: { data: CommandCenterInsights }) {
  const ms = data.marketState
  const am = data.asianMarkets
  const fdi = data.fiiDiiIntelligence

  const indiaHint = getMarketHint('india')
  const usdInrHint = getMarketHint('usdinr')
  const asiaHint = getMarketHint('asia')
  const usHint = getMarketHint('us')
  const europeHint = getMarketHint('europe')
  const saudiHint = getMarketHint('saudi')
  const uaeHint = getMarketHint('uae')
  const commHint = getMarketHint('commodities')
  const dxyHint = getMarketHint('dxy')

  // Phase 4: per-card inferences (lookup helper) + global read
  const inf = (id: string) => ms?.cardInferences?.[id]
  const globalRead = ms?.globalRead

  // FII/DII data date: use the most recent entry in dailyBreakdown as authoritative
  // (it's the last NSE trading day the scraper captured).
  const fiiDate: string | null = (() => {
    const db = fdi?.dailyBreakdown
    if (!db || db.length === 0) return null
    const latest = db[0] as any
    return latest?._date || latest?.FII?.date || latest?.DII?.date || null
  })()
  const fiiDateLabel = fiiDate ? fmtIndianDate(
    // Detect ISO vs Indian format — dailyBreakdown sometimes returns "10-Apr-2026"
    /^\d{4}-\d{2}-\d{2}$/.test(fiiDate)
      ? fiiDate
      : (() => {
          // Convert "DD-MMM-YYYY" to "YYYY-MM-DD" for fmtIndianDate
          const m: Record<string,string> = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'}
          const [d, mon, y] = fiiDate.split('-')
          return `${y}-${m[mon] || '01'}-${d}`
        })()
  ) : ''

  return (
    <div className="space-y-4">

      {/* ═══ Calendar pill (FOMC / India CPI awareness) ═══ */}
      {ms?.calendarHint && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-300">
          📅 <span className="font-semibold">Event watch:</span> {ms.calendarHint}
        </div>
      )}

      {/* ═══ 1. INDIA — SGX Nifty + Nifty 50 + VIX + USD/INR ═══ */}
      {ms && (
        <Region title="🇮🇳 India">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <IndexCard
              name="SGX Nifty"
              price={ms.sgxNiftyPrice || ms.niftyPrice}
              changePct={ms.sgxNiftyChangePct}
              priceFormat="int"
              label="GIFT futures · sgxnifty.org"
              hint={indiaHint}
              region="india"
              inference={inf('sgxNifty')}
            />
            <IndexCard
              name="Nifty 50"
              price={ms.nifty50Price}
              changePct={ms.nifty50ChangePct}
              priceFormat="int"
              label="NSE index"
              hint={indiaHint}
              region="india"
              inference={inf('nifty50')}
              dmIfZero
            />
            <IndexCard
              name="India VIX"
              price={ms.indiaVix}
              changePct={0}
              noChange
              priceFormat="decimal"
              label={vixLabel(ms.indiaVix) || 'Normal volatility'}
              hint={indiaHint}
              region="india"
              inference={inf('indiaVix')}
            />
            <IndexCard
              name="USD/INR"
              price={ms.usdInrPrice}
              changePct={ms.usdInrChangePct}
              invertColor
              priceFormat="rupee"
              hint={usdInrHint}
              region="usdinr"
              inference={inf('usdInr')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <MiniStat label="A/D All" value={`${ms.advances || 0}/${ms.declines || 0}`} sub={ms.adRatioLabel} />
            <MiniStat label="A/D F&O" value={`${ms.foAdvances || 0}/${ms.foDeclines || 0}`} sub={ms.foRatioLabel} />
          </div>
        </Region>
      )}

      {/* ═══ 2. ASIA ═══ */}
      {am && (
        <Region title="🌏 Asia" badge={<AssBadge score={am.assScore} regime={am.regime} />}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <IndexCard name="Nikkei 225"  price={am.nikkeiPrice}   changePct={am.nikkeiChangePct}   priceFormat="int" label="Tokyo"     hint={asiaHint} region="asia" inference={inf('nikkei')}   dmIfZero />
            <IndexCard name="Hang Seng"   price={am.hangSengPrice} changePct={am.hangSengChangePct} priceFormat="int" label="Hong Kong" hint={asiaHint} region="asia" inference={inf('hangSeng')} dmIfZero />
            <IndexCard name="Shanghai"    price={am.shanghaiPrice} changePct={am.shanghaiChangePct} priceFormat="int" label="China"     hint={asiaHint} region="asia" inference={inf('shanghai')} dmIfZero />
            <IndexCard name="KOSPI"       price={am.kospiPrice}    changePct={am.kospiChangePct}    priceFormat="int" label="Korea"     hint={asiaHint} region="asia" inference={inf('kospi')}    dmIfZero />
          </div>
          {am.inference && <p className="text-[11px] text-slate-400 mt-2 italic">{am.inference}</p>}
        </Region>
      )}

      {/* ═══ 3. UNITED STATES ═══ */}
      {ms && (
        <Region title="🇺🇸 United States">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <IndexCard name="Dow Jones"  price={ms.dowPrice}    changePct={ms.dowChangePct}    priceFormat="int" label="NYSE"   hint={usHint} region="us" inference={inf('dow')} />
            <IndexCard name="S&P 500"    price={ms.sp500Price}  changePct={ms.sp500ChangePct}  priceFormat="int" label="NYSE"   hint={usHint} region="us" inference={inf('sp500')} />
            <IndexCard name="Nasdaq 100" price={ms.nasdaqPrice} changePct={ms.nasdaqChangePct} priceFormat="int" label="Nasdaq" hint={usHint} region="us" inference={inf('nasdaq')} />
            <IndexCard name="US VIX"     price={ms.usVix}       changePct={ms.usVixChangePct}  invertColor priceFormat="decimal" label={vixLabel(ms.usVix)} hint={usHint} region="us" inference={inf('usVix')} />
          </div>
          {/* US 10Y yield + cross-spreads */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
            <IndexCard
              name="US 10Y Yield"
              price={ms.us10yYield}
              changePct={ms.us10yChangePct}
              invertColor
              priceFormat="decimal"
              label="Treasury %"
              hint={usHint}
              region="us"
              dmIfZero
              inference={ms.us10yYield > 4.5 ? 'High yields · EM headwind · FII outflow risk' : ms.us10yYield > 4 ? 'Elevated · monitor flows' : ms.us10yYield > 0 ? 'Benign · EM-friendly' : undefined}
            />
            <IndexCard
              name="VIX Divergence"
              price={ms.vixDivergence}
              changePct={0}
              noChange
              priceFormat="decimal"
              label="India VIX − US VIX"
              inference={ms.vixDivergence > 3 ? 'India fear > US · domestic risk' : ms.vixDivergence < -3 ? 'US fear > India · imported risk' : 'Aligned · no decoupling'}
            />
            <IndexCard
              name="Brent-WTI Spread"
              price={ms.brentWtiSpread}
              changePct={0}
              noChange
              priceFormat="decimal"
              label="Geopolitical premium"
              inference={ms.brentWtiSpread > 5 ? 'High premium · Mideast supply risk' : ms.brentWtiSpread < 1 ? 'Tight · supply normal' : 'Normal premium'}
            />
          </div>
        </Region>
      )}

      {/* ═══ 4. EUROPE ═══ */}
      {ms && (
        <Region title="🇪🇺 Europe">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <IndexCard name="FTSE 100" price={ms.ftsePrice} changePct={ms.ftseChangePct} priceFormat="int" label="London"    hint={europeHint} region="europe" inference={inf('ftse')} dmIfZero />
            <IndexCard name="DAX 40"   price={ms.daxPrice}  changePct={ms.daxChangePct}  priceFormat="int" label="Frankfurt" hint={europeHint} region="europe" inference={inf('dax')}  dmIfZero />
            <IndexCard name="CAC 40"   price={ms.cacPrice}  changePct={ms.cacChangePct}  priceFormat="int" label="Paris"     hint={europeHint} region="europe" inference={inf('cac')}  dmIfZero />
          </div>
        </Region>
      )}

      {/* ═══ 5. MIDDLE EAST ═══ */}
      {ms && (
        <Region title="🛢️ Middle East">
          <div className="grid grid-cols-2 gap-3">
            <IndexCard
              name="Tadawul"
              price={ms.tasiPrice}
              changePct={ms.tasiChangePct}
              priceFormat="int"
              label="Saudi · Sun-Thu"
              hint={saudiHint}
              region="saudi"
              inference={inf('tasi')}
              dmIfZero
            />
            <IndexCard
              name="UAE MSCI"
              price={ms.uaePrice}
              changePct={ms.uaeChangePct}
              priceFormat="currency"
              label="ADX/DFM proxy · Mon-Fri"
              hint={uaeHint}
              region="uae"
              inference={inf('uae')}
              dmIfZero
            />
          </div>
        </Region>
      )}

      {/* ═══ 6. FII / DII — BETWEEN INDICES AND COMMODITIES ═══ */}
      {ms && (
        <Region
          title="💰 Institutional Flows"
          hint={fiiDateLabel ? `as of ${fiiDateLabel}` : undefined}
        >
          <div className="grid grid-cols-2 gap-3">
            <FlowCard label="FII Net" value={ms.fiiNetToday} dateLabel={fiiDateLabel} inference={inf('fii')} />
            <FlowCard label="DII Net" value={ms.diiNetToday} dateLabel={fiiDateLabel} inference={inf('dii')} />
          </div>
        </Region>
      )}

      {/* ═══ 7. COMMODITIES ═══ */}
      {ms && (
        <Region title="🛢️ Commodities">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <IndexCard name="Crude WTI" price={ms.crudePrice}  changePct={ms.crudeChangePct}  priceFormat="currency" label="CME"   hint={commHint} region="commodities" inference={inf('crudeWti')} />
            <IndexCard name="Brent"     price={ms.brentPrice}  changePct={ms.brentChangePct}  priceFormat="currency" label="ICE"   hint={commHint} region="commodities" inference={inf('brent')} dmIfZero />
            <IndexCard name="Gold"      price={ms.goldPrice}   changePct={ms.goldChangePct}   priceFormat="currency" label="COMEX" hint={commHint} region="commodities" inference={inf('gold')} />
            <IndexCard name="Silver"    price={ms.silverPrice} changePct={ms.silverChangePct} priceFormat="currency" label="COMEX" hint={commHint} region="commodities" inference={inf('silver')} />
          </div>
        </Region>
      )}

      {/* ═══ 8. CURRENCIES ═══ */}
      {ms && (
        <Region title="💵 Currencies">
          <div className="grid grid-cols-2 gap-3">
            <IndexCard
              name="DXY (USD)"
              price={ms.dxyPrice}
              changePct={ms.dxyChangePct}
              invertColor
              priceFormat="decimal"
              label={dxyLabel(ms.dxyChangePct)}
              hint={dxyHint}
              region="dxy"
              inference={inf('dxy')}
            />
            <IndexCard
              name="USD/INR"
              price={ms.usdInrPrice}
              changePct={ms.usdInrChangePct}
              invertColor
              priceFormat="rupee"
              hint={usdInrHint}
              region="usdinr"
              inference={inf('usdInr')}
            />
          </div>
        </Region>
      )}

      {/* ═══ 9. NIFTY SECTORS ═══ */}
      {data.sectorIndices && data.sectorIndices.length > 0 && (
        <Region title="📊 Nifty Sectors">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.sectorIndices.map(si => (
              <div key={si.name} className={`rounded-xl border p-3 ${signBg(si.changePct)}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-semibold text-slate-200 truncate">{si.name}</span>
                  <span className={`text-[14px] font-bold ${signColor(si.changePct)}`}>{fmtPct(si.changePct)}</span>
                </div>
                {si.inference && <p className="text-[10px] text-slate-500 italic truncate">{si.inference}</p>}
              </div>
            ))}
          </div>
        </Region>
      )}

      {/* ═══ GLOBAL READ — holistic cross-indice summary ═══ */}
      {globalRead && (
        <section className="mt-2">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="text-[11px] font-semibold text-emerald-400 mb-1.5 uppercase tracking-wider">
              🔍 Cross-Indice Read
            </div>
            <p className="text-[13px] text-slate-200 leading-relaxed">{globalRead}</p>
          </div>
        </section>
      )}
    </div>
  )
}

// Section wrapper — matches Market Pulse h2 styling
function Region({ title, hint, badge, children }: { title: string; hint?: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
        {badge}
        {hint && !badge && <span className="text-[11px] text-slate-500 italic">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

// Pulsating bright green dot — rendered when the card's region is currently live.
function LivePulse() {
  return (
    <span className="relative inline-flex h-2 w-2 ml-1.5 -mt-px align-middle" title="Live session">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  )
}

// Big card matching MarketPulsePage aesthetic: rounded-xl p-4, uppercase name,
// text-xl price, text-[15px] change, optional interpretation label + weekend hint
// + cross-indice inference (Phase 4) shown above hint.
// Pass `region` to show a live pulse dot when that region's trading session is open.
type PriceFormat = 'int' | 'decimal' | 'currency' | 'rupee'
function IndexCard({
  name, price, changePct, invertColor, noChange, dmIfZero, label, hint, priceFormat = 'int', region, inference
}: {
  name: string
  price: number
  changePct: number
  invertColor?: boolean
  noChange?: boolean
  dmIfZero?: boolean
  label?: string
  hint?: string
  priceFormat?: PriceFormat
  region?: Region
  inference?: string
}) {
  const isMissing = dmIfZero && (!price || price === 0) && (!changePct || changePct === 0)
  const colorVal = invertColor ? -changePct : changePct
  const live = region ? isLiveRegion(region) : false

  const formatPrice = (p: number) => {
    if (p == null || isNaN(p)) return '—'
    const opts: Intl.NumberFormatOptions =
      priceFormat === 'int' ? { maximumFractionDigits: 0 }
      : priceFormat === 'decimal' ? { maximumFractionDigits: 2 }
      : { maximumFractionDigits: 2 }
    const fmted = p.toLocaleString('en-IN', opts)
    if (priceFormat === 'currency') return '$' + fmted
    if (priceFormat === 'rupee') return '₹' + fmted
    return fmted
  }

  return (
    <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${isMissing ? 'border-slate-700/40 bg-slate-800/20' : signBg(colorVal)}`}>
      <div className="text-base font-semibold text-slate-400 mb-2">
        {name}
        {live && <LivePulse />}
      </div>
      {isMissing ? (
        <div className="text-3xl font-bold text-slate-500 italic">DM</div>
      ) : (
        <>
          <div className="text-3xl font-bold text-white tracking-tight">{formatPrice(price)}</div>
          {!noChange && (
            <div className={`text-lg font-semibold mt-0.5 ${signColor(colorVal)}`}>{fmtPct(changePct)}</div>
          )}
        </>
      )}
      {label && <div className="text-sm text-slate-500 mt-2">{label}</div>}
      {/* Mutually exclusive bottom line: weekend/closed hint when market is shut, cross-indice inference when live. */}
      {hint ? (
        <div className="text-[12px] text-slate-500 mt-1 italic">{hint}</div>
      ) : inference ? (
        <div className="text-sm text-slate-200 mt-2 leading-snug">→ {inference}</div>
      ) : null}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Market-hours hint helper.
// All open/close times verified against official exchange sources as of Apr 2026.
// Times given in IST. DST handled dynamically (US EDT, EU CEST, UK BST active Apr-Oct).
// ═══════════════════════════════════════════════════════════════
//
// Verified schedules:
// ─────────────────────────────────────────────────────────────
// INDIA NSE (Nifty, VIX)           Mon-Fri 09:15-15:30 IST
// INDIA NSE Currency (USD/INR)     Mon-Fri 09:00-17:00 IST
// ASIA  Nikkei 225 (JST UTC+9)     Mon-Fri 05:30-11:30 IST (lunch 08:00-09:00)
// ASIA  KOSPI (KST UTC+9)          Mon-Fri 05:30-12:00 IST
// ASIA  Hang Seng (HKT UTC+8)      Mon-Fri 07:00-13:30 IST (lunch 09:30-10:30)
// ASIA  Shanghai (CST UTC+8)       Mon-Fri 07:00-12:30 IST (lunch 09:00-10:30)
// ASIA  Aggregate session          Mon-Fri 05:30-13:30 IST
// EUROPE FTSE/DAX/CAC  (summer)    Mon-Fri 12:30-21:00 IST    (BST+4:30 / CEST+3:30)
// EUROPE FTSE/DAX/CAC  (winter)    Mon-Fri 13:30-22:00 IST    (GMT+5:30 / CET+4:30)
// US    NYSE/Nasdaq (summer EDT)   Mon-Fri 19:00-01:30 IST next day
// US    NYSE/Nasdaq (winter EST)   Mon-Fri 20:00-02:30 IST next day
// SAUDI Tadawul  (AST UTC+3)       Sun-Thu 12:30-17:30 IST   (weekend Fri-Sat)
// UAE   ADX/DFM  (GST UTC+4)       Mon-Fri 11:30-16:30 IST   (Mon-Fri since Jan 2022)
// COMMODITIES CME (Crude/Gold/Silver/Brent)
//   summer EDT                     Mon 03:30 IST - Sat 02:30 IST (daily pause 02:30-03:30)
//   winter EST                     Mon 04:30 IST - Sat 03:30 IST
// DXY  ICE Futures (summer EDT)    Mon 05:30 IST - Sat 02:30 IST
// DXY  ICE Futures (winter EST)    Mon 06:30 IST - Sat 03:30 IST

type Region = 'india' | 'asia' | 'us' | 'europe' | 'saudi' | 'uae' | 'commodities' | 'dxy' | 'usdinr'

function getIstDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false }))
}

// DST status: US DST = 2nd Sun Mar → 1st Sun Nov; EU/UK DST = last Sun Mar → last Sun Oct.
// Approximation: treat Apr-Oct as DST active. Boundary weeks may be slightly off.
function isDstActive(): boolean {
  const m = getIstDate().getMonth() // 0=Jan
  return m >= 3 && m <= 9 // Apr..Oct
}

// Per-region config. openHm/closeHm are IST minutes-of-day.
// Sessions that span midnight use closeHm > 1440 (1440 + minutes-after-midnight).
interface RegionCfg {
  days: number[]   // trading days (0=Sun..6=Sat)
  openHm: number   // IST open minute-of-day
  closeHm: number  // IST close minute-of-day; if > 1440, session extends into next day
}

function regionConfig(region: Region): RegionCfg {
  const dst = isDstActive()
  const M = (h: number, m = 0) => h * 60 + m
  switch (region) {
    case 'india':       return { days: [1,2,3,4,5], openHm: M(9,15),  closeHm: M(15,30) }
    case 'usdinr':      return { days: [1,2,3,4,5], openHm: M(9),     closeHm: M(17) }
    case 'asia':        return { days: [1,2,3,4,5], openHm: M(5,30),  closeHm: M(13,30) }
    case 'europe':      return { days: [1,2,3,4,5], openHm: dst ? M(12,30) : M(13,30), closeHm: dst ? M(21) : M(22) }
    case 'us':          return { days: [1,2,3,4,5], openHm: dst ? M(19) : M(20), closeHm: dst ? 1440 + M(1,30) : 1440 + M(2,30) }
    case 'saudi':       return { days: [0,1,2,3,4], openHm: M(12,30), closeHm: M(17,30) }
    case 'uae':         return { days: [1,2,3,4,5], openHm: M(11,30), closeHm: M(16,30) }
    case 'commodities': return { days: [1,2,3,4,5], openHm: dst ? M(3,30) : M(4,30), closeHm: dst ? 1440 + M(2,30) : 1440 + M(3,30) }
    case 'dxy':         return { days: [1,2,3,4,5], openHm: dst ? M(5,30) : M(6,30), closeHm: dst ? 1440 + M(2,30) : 1440 + M(3,30) }
  }
}

// Is the market currently open given IST now?
// Handles sessions that span midnight (US, CME commodities, DXY) by also checking
// whether *yesterday's* session is still running.
function isLiveRegion(region: Region): boolean {
  const c = regionConfig(region)
  const now = getIstDate()
  const hm = now.getHours() * 60 + now.getMinutes()
  const today = now.getDay()
  const yesterday = (today + 6) % 7

  // Case A: today's session is running
  if (c.days.includes(today)) {
    if (c.closeHm > 1440) {
      if (hm >= c.openHm) return true
    } else {
      if (hm >= c.openHm && hm < c.closeHm) return true
    }
  }

  // Case B: yesterday's session spans midnight into today
  if (c.closeHm > 1440 && c.days.includes(yesterday)) {
    if (hm < c.closeHm - 1440) return true
  }

  return false
}

// Next open instant (IST) for the region, starting from now. Searches up to 10 days ahead.
function nextOpenIst(region: Region): Date {
  const c = regionConfig(region)
  const now = getIstDate()
  for (let i = 0; i < 10; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    if (!c.days.includes(d.getDay())) continue
    const candidate = new Date(d)
    candidate.setHours(Math.floor(c.openHm / 60), c.openHm % 60, 0, 0)
    if (candidate.getTime() > now.getTime()) return candidate
  }
  // Unreachable unless config is broken
  return now
}

// Formatter: "Mon 13-Apr 09:15 IST"
function fmtOpenIst(d: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const dd = String(d.getDate()).padStart(2,'0')
  const mm = months[d.getMonth()]
  const dow = days[d.getDay()]
  const hh = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${dow} ${dd}-${mm} ${hh}:${mn} IST`
}

// Market hint: empty string when live, "closed · opens <date> <day> <HH:MM IST>" otherwise.
function getMarketHint(region: Region): string {
  if (isLiveRegion(region)) return ''
  const next = nextOpenIst(region)
  return `closed · opens ${fmtOpenIst(next)}`
}

// Format an ISO date string like "2026-04-10" as "10-Apr-2026 (Fri)"
function fmtIndianDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const [y, m, d] = iso.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    return `${String(d).padStart(2,'0')}-${months[m - 1]}-${y} (${days[dt.getUTCDay()]})`
  } catch {
    return iso
  }
}

// Small derived labels for context on specific assets
function vixLabel(v: number): string {
  if (!v) return ''
  if (v > 25) return 'High fear'
  if (v > 18) return 'Elevated'
  return 'Calm'
}
function dxyLabel(chg: number): string {
  if (!chg) return ''
  return chg > 0 ? 'Strong $ = EM pressure' : 'Weak $ = EM tailwind'
}

function FlowCard({ label, value, dateLabel, inference }: { label: string; value: number; dateLabel?: string; inference?: string }) {
  return (
    <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(value)}`}>
      <div className="text-base font-semibold text-slate-400 mb-2">{label}</div>
      <div className={`text-3xl font-bold tracking-tight ${signColor(value)}`}>{value > 0 ? '+' : ''}{fmtCr(value)} Cr</div>
      <div className="text-sm text-slate-500 mt-2">
        {value > 0 ? 'Net buying — bullish' : value < 0 ? 'Net selling — bearish' : 'Flat'}
      </div>
      {inference && <div className="text-sm text-slate-200 mt-2 leading-snug">→ {inference}</div>}
      {dateLabel && <div className="text-[12px] text-slate-500 mt-1 italic">{dateLabel}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// TAB 2: INSIGHTS — narrative + evidence
// ═══════════════════════════════════════════════════════════════
function InsightsTab({ data, sections, toggle }: { data: CommandCenterInsights; sections: Record<string, boolean>; toggle: (k: string) => void }) {
  const ms = data.marketState
  const fdi = data.fiiDiiIntelligence
  const deals = data.dealIntelligence
  const delivery = data.deliveryAnalysis
  const cs = data.commoditySignals
  const dirColor = ms?.direction === 'BULLISH' ? 'text-emerald-400' : ms?.direction === 'BEARISH' ? 'text-red-400' : 'text-amber-400'
  const dirBg = ms?.direction === 'BULLISH' ? 'bg-emerald-500/10 border-emerald-500/30' : ms?.direction === 'BEARISH' ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30'

  return (
    <div className="px-3 sm:px-6 py-3 space-y-4">
      {/* Market state summary */}
      {ms && (
        <div className={`rounded-xl border p-4 ${dirBg}`}>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`text-lg font-bold ${dirColor}`}>{ms.direction} · {ms.dayType}</span>
            <span className="text-[11px] text-slate-400">Confidence {ms.confidence}/100</span>
          </div>
          <p className="text-[13px] text-slate-200 leading-snug">{ms.summary}</p>
        </div>
      )}

      {/* FII/DII Intelligence */}
      {fdi && (
        <section>
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">FII / DII Intelligence</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <MiniCard label="FII Today" value={`${fmtCr(fdi.fiiNetToday)} Cr`} color={signColor(fdi.fiiNetToday)} />
            <MiniCard label="DII Today" value={`${fmtCr(fdi.diiNetToday)} Cr`} color={signColor(fdi.diiNetToday)} />
            <MiniCard label="FII Week" value={`${fmtCr(fdi.fiiNetWeek)} Cr`} color={signColor(fdi.fiiNetWeek)} />
            <MiniCard label="DII Week" value={`${fmtCr(fdi.diiNetWeek)} Cr`} color={signColor(fdi.diiNetWeek)} />
          </div>
          {(fdi.fiiSellingStreak > 0 || fdi.diiBuyingStreak > 0) && (
            <div className="flex gap-2 text-[11px] mb-2">
              {fdi.fiiSellingStreak > 0 && <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400">FII selling streak: {fdi.fiiSellingStreak}d</span>}
              {fdi.diiBuyingStreak > 0 && <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">DII buying streak: {fdi.diiBuyingStreak}d</span>}
            </div>
          )}
          {fdi.narrative && <p className="text-[12px] text-slate-300 italic">{fdi.narrative}</p>}
        </section>
      )}

      {/* Commodity cross-signals */}
      {cs?.inferences && cs.inferences.length > 0 && (
        <Fold title="Commodity Cross-Signals" id="ins-comm" s={sections} t={toggle}>
          {cs.inferences.map((inf, i) => <p key={i} className="text-[12px] text-slate-300 mb-1">• {inf}</p>)}
        </Fold>
      )}

      {/* Smart Money Watchlist */}
      {deals?.watchlist && deals.watchlist.length > 0 && (
        <section>
          <h2 className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2">Smart Money Watchlist</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {deals.watchlist.slice(0, 10).map((w, i) => (
              <div key={w.symbol} className={`shrink-0 w-56 rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${w.bias === 'LONG' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] text-slate-500">#{i + 1}</span>
                  <span className="font-bold text-base text-white truncate">{w.symbol}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ml-auto ${w.bias === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{w.bias}</span>
                </div>
                <div className={`text-3xl font-bold tracking-tight ${w.netCr > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{w.netCr > 0 ? '+' : ''}{fmtCr(w.netCr)} Cr</div>
                <div className="text-sm text-slate-500 mt-2">{w.conviction} · {w.sector || '—'}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sector Flows */}
      {deals?.sectorFlows && deals.sectorFlows.length > 0 && (
        <Fold title={`Sector Flows (${deals.sectorFlows.length})`} id="ins-sflow" s={sections} t={toggle}>
          <div className="space-y-3">
            {deals.sectorFlows.map(sf => (
              <SectorFlowCard key={sf.sector} sf={sf} />
            ))}
          </div>
        </Fold>
      )}

      {/* Delivery */}
      {delivery?.sectors && delivery.sectors.length > 0 && (
        <Fold title={`Delivery Analysis ${delivery.date ? '(' + delivery.date + ')' : ''}`} id="ins-deliv" s={sections} t={toggle}>
          {delivery.inference && <p className="text-sm text-slate-300 mb-3">{delivery.inference}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {delivery.sectors.slice(0, 15).map(s => (
              <div key={s.sector} className={`rounded-xl border p-3 text-center transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${s.deliveryPct > 55 ? 'border-emerald-500/30 bg-emerald-500/5' : s.deliveryPct < 35 ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700/50 bg-slate-800/30'}`}>
                <div className="text-[12px] text-slate-400 truncate font-semibold">{s.sector}</div>
                <div className={`text-2xl font-bold tracking-tight mt-1 ${s.deliveryPct > 50 ? 'text-emerald-400' : s.deliveryPct < 30 ? 'text-red-400' : 'text-white'}`}>{s.deliveryPct?.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Fold>
      )}

      {/* Institutional clients */}
      {deals?.topClients && deals.topClients.length > 0 && (
        <Fold title={`Institutional Activity (${deals.topClients.length})`} id="ins-clients" s={sections} t={toggle}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2 px-1 text-[12px] uppercase tracking-wider font-semibold">Entity</th>
                  <th className="text-left text-[12px] uppercase tracking-wider font-semibold">Type</th>
                  <th className="text-right text-[12px] uppercase tracking-wider font-semibold">Buy</th>
                  <th className="text-right text-[12px] uppercase tracking-wider font-semibold">Sell</th>
                  <th className="text-right text-[12px] uppercase tracking-wider font-semibold">Net Cr</th>
                </tr>
              </thead>
              <tbody>{deals.topClients.slice(0, 20).map((c, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
                  <td className="py-2 px-1 text-slate-200 max-w-[200px] truncate">{c.name}</td>
                  <td className={`text-[13px] font-semibold ${c.type === 'FII' ? 'text-blue-400' : c.type === 'DII' ? 'text-emerald-400' : 'text-slate-500'}`}>{c.type}</td>
                  <td className="text-right text-emerald-400/80 font-mono">{fmtCr(c.buyCr)}</td>
                  <td className="text-right text-red-400/80 font-mono">{fmtCr(c.sellCr)}</td>
                  <td className={`text-right text-base font-bold tracking-tight ${signColor(c.netCr)}`}>{fmtCr(c.netCr)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Fold>
      )}

      {/* FII/DII daily breakdown */}
      {fdi?.dailyBreakdown && fdi.dailyBreakdown.length > 0 && (
        <Fold title="FII/DII Daily Breakdown" id="ins-fddaily" s={sections} t={toggle}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[360px]">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2 px-1 text-[12px] uppercase tracking-wider font-semibold">Date</th>
                  <th className="text-right text-[12px] uppercase tracking-wider font-semibold">FII Net Cr</th>
                  <th className="text-right text-[12px] uppercase tracking-wider font-semibold">DII Net Cr</th>
                </tr>
              </thead>
              <tbody>{fdi.dailyBreakdown.map((d: any, i: number) => {
                const f = d.FII || {}; const di = d.DII || {}
                return (
                  <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="py-2 px-1 text-slate-300 text-[13px]">{d._date || f.date || '—'}</td>
                    <td className={`text-right text-base font-bold tracking-tight ${signColor(f.netValue || 0)}`}>{fmtCr(f.netValue || 0)}</td>
                    <td className={`text-right text-base font-bold tracking-tight ${signColor(di.netValue || 0)}`}>{fmtCr(di.netValue || 0)}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </Fold>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// TAB 3: ACTIVITY — Wyckoff institutional accumulation/distribution
// Two views: per-security and per-fund.
// ═══════════════════════════════════════════════════════════════
function ActivityTab({ data }: { data: CommandCenterInsights }) {
  const [view, setView] = useState<'security' | 'fund'>(() => {
    const saved = typeof window !== 'undefined' ? sessionStorage.getItem('insights-activity-view') : null
    return (saved as 'security' | 'fund') || 'security'
  })
  const switchView = (v: 'security' | 'fund') => {
    setView(v)
    try { sessionStorage.setItem('insights-activity-view', v) } catch {}
  }

  const ia = data.institutionalActivity
  if (!ia) {
    return <div className="px-3 sm:px-6 py-6 text-slate-500 italic text-sm">Institutional activity data unavailable.</div>
  }

  // Filter divergences with actual signal
  const accumulation = (ia.bySecurity || []).filter(s => s.divergenceState === 'ACCUMULATION')
  const distribution = (ia.bySecurity || []).filter(s => s.divergenceState === 'DISTRIBUTION')
  const others = (ia.bySecurity || []).filter(s => s.divergenceState !== 'ACCUMULATION' && s.divergenceState !== 'DISTRIBUTION')

  return (
    <div className="space-y-4">
      {/* Headline + view toggle */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">🏛️ Institutional Activity</div>
          {ia.dataDate && <span className="text-[10px] text-slate-500 italic">as of {ia.dataDate}</span>}
        </div>
        <p className="text-[13px] text-slate-200 leading-relaxed">{ia.headlineSummary}</p>
        <div className="flex gap-3 mt-3 text-[12px]">
          <span className="text-slate-400">Total deals:</span>
          <span className="text-slate-200 font-semibold">{ia.totalDealsCount}</span>
          <span className="text-slate-400">Total Cr:</span>
          <span className="text-slate-200 font-semibold">{ia.totalDealValueCr.toLocaleString('en-IN')}</span>
          {ia.accumulationCount > 0 && <span className="text-emerald-400">▲ {ia.accumulationCount} accum</span>}
          {ia.distributionCount > 0 && <span className="text-red-400">▼ {ia.distributionCount} distrib</span>}
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-2 text-[12px]">
        <button
          onClick={() => switchView('security')}
          className={`flex-1 py-2 rounded-lg font-semibold transition-colors ${view === 'security' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800/50 text-slate-400 border border-slate-700/40'}`}
        >
          By Security
        </button>
        <button
          onClick={() => switchView('fund')}
          className={`flex-1 py-2 rounded-lg font-semibold transition-colors ${view === 'fund' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800/50 text-slate-400 border border-slate-700/40'}`}
        >
          By Fund
        </button>
      </div>

      {view === 'security' ? (
        <SecurityView accumulation={accumulation} distribution={distribution} others={others} />
      ) : (
        <FundView byClient={ia.byClient || []} />
      )}
    </div>
  )
}

function SecurityView({
  accumulation, distribution, others
}: {
  accumulation: NonNullable<CommandCenterInsights['institutionalActivity']>['bySecurity']
  distribution: NonNullable<CommandCenterInsights['institutionalActivity']>['bySecurity']
  others: NonNullable<CommandCenterInsights['institutionalActivity']>['bySecurity']
}) {
  return (
    <div className="space-y-4">
      {accumulation.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-emerald-400 mb-2">🟢 Accumulation ({accumulation.length})</h2>
          <div className="space-y-2">
            {accumulation.map(s => <SecurityRow key={s.symbol} s={s} />)}
          </div>
        </section>
      )}
      {distribution.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-red-400 mb-2">🔴 Distribution ({distribution.length})</h2>
          <div className="space-y-2">
            {distribution.map(s => <SecurityRow key={s.symbol} s={s} />)}
          </div>
        </section>
      )}
      {others.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 mb-2">All other deals ({others.length})</h2>
          <div className="space-y-2">
            {others.slice(0, 30).map(s => <SecurityRow key={s.symbol} s={s} />)}
          </div>
          {others.length > 30 && <p className="text-[11px] text-slate-500 mt-2">+{others.length - 30} more rows</p>}
        </section>
      )}
    </div>
  )
}

type SecActivity = NonNullable<CommandCenterInsights['institutionalActivity']>['bySecurity'][number]

function SecurityRow({ s }: { s: SecActivity }) {
  const isAccum = s.divergenceState === 'ACCUMULATION'
  const isDist = s.divergenceState === 'DISTRIBUTION'
  const borderColor = isAccum ? 'border-emerald-500/30 bg-emerald-500/5'
    : isDist ? 'border-red-500/30 bg-red-500/5'
    : 'border-slate-700/40 bg-slate-800/30'
  const confColor = s.divergenceConfidence === 'STRONG' ? 'bg-emerald-500/30 text-emerald-300'
    : s.divergenceConfidence === 'MODERATE' ? 'bg-amber-500/30 text-amber-300'
    : 'bg-slate-700/40 text-slate-400'
  return (
    <div className={`rounded-xl border p-4 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${borderColor}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-bold text-base text-white">{s.symbol}</span>
        <span className="text-[11px] text-slate-500">· {s.sector}</span>
        {s.divergenceState !== 'NEUTRAL' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${confColor}`}>{s.divergenceConfidence}</span>
        )}
        <span className={`ml-auto text-lg font-bold tracking-tight ${s.netCr > 0 ? 'text-emerald-400' : s.netCr < 0 ? 'text-red-400' : 'text-slate-400'}`}>
          {s.netCr > 0 ? '+' : ''}{s.netCr.toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 mt-2 text-[12px]">
        <span className="text-slate-400">FII <span className={`font-semibold ${s.fiiNetCr > 0 ? 'text-emerald-400' : s.fiiNetCr < 0 ? 'text-red-400' : 'text-slate-500'}`}>{s.fiiNetCr > 0 ? '+' : ''}{s.fiiNetCr.toFixed(1)}</span></span>
        <span className="text-slate-400">DII <span className={`font-semibold ${s.diiNetCr > 0 ? 'text-emerald-400' : s.diiNetCr < 0 ? 'text-red-400' : 'text-slate-500'}`}>{s.diiNetCr > 0 ? '+' : ''}{s.diiNetCr.toFixed(1)}</span></span>
        <span className="text-slate-400">Deliv <span className={`font-semibold ${s.deliveryPct > 55 ? 'text-emerald-400' : s.deliveryPct < 35 ? 'text-red-400' : 'text-slate-300'}`}>{s.deliveryPct.toFixed(0)}%</span></span>
        <span className="text-slate-400">Deals <span className="text-slate-300 font-semibold">{s.dealCount}</span></span>
      </div>
      {(s.topBuyer || s.topSeller) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2 text-[11px]">
          {s.topBuyer && <span className="text-emerald-400 truncate">Top buy: {s.topBuyer}</span>}
          {s.topSeller && <span className="text-red-400 truncate">Top sell: {s.topSeller}</span>}
        </div>
      )}
      <p className="text-[13px] text-slate-200 mt-2 leading-snug">{s.inference}</p>
      {s.divergenceReasons && s.divergenceReasons.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {s.divergenceReasons.map((r, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-400">{r}</span>
          ))}
        </div>
      )}
    </div>
  )
}

type ClientFlow = NonNullable<CommandCenterInsights['institutionalActivity']>['byClient'][number]

function FundView({ byClient }: { byClient: ClientFlow[] }) {
  // Group by type
  const fii = byClient.filter(c => c.type === 'FII')
  const dii = byClient.filter(c => c.type === 'DII')
  const prop = byClient.filter(c => c.type === 'PROP_BROKER')
  const other = byClient.filter(c => c.type === 'OTHER')
  return (
    <div className="space-y-4">
      {fii.length > 0 && <FundGroup title="🌐 FIIs" entities={fii} />}
      {dii.length > 0 && <FundGroup title="🇮🇳 DIIs" entities={dii} />}
      {prop.length > 0 && <FundGroup title="🏦 Prop Brokers" entities={prop} />}
      {other.length > 0 && <FundGroup title="Other / Unclassified" entities={other.slice(0, 30)} />}
    </div>
  )
}

function FundGroup({ title, entities }: { title: string; entities: ClientFlow[] }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-slate-300 mb-2">{title} ({entities.length})</h2>
      <div className="space-y-2">
        {entities.map((c, i) => (
          <div key={i} className={`rounded-xl border p-4 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${c.netCr > 0 ? 'border-emerald-500/20 bg-emerald-500/5' : c.netCr < 0 ? 'border-red-500/20 bg-red-500/5' : 'border-slate-700/40 bg-slate-800/30'}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-bold text-sm text-white truncate">{c.name}</span>
              <span className={`ml-auto text-lg font-bold tracking-tight ${c.netCr > 0 ? 'text-emerald-400' : c.netCr < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                {c.netCr > 0 ? '+' : ''}{c.netCr.toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-2 text-[12px]">
              <span className="text-slate-400">Buy <span className="text-emerald-400 font-semibold">{c.buyCr.toFixed(1)}</span></span>
              <span className="text-slate-400">Sell <span className="text-red-400 font-semibold">{c.sellCr.toFixed(1)}</span></span>
              <span className="text-slate-400">Deals <span className="text-slate-300 font-semibold">{c.dealCount}</span></span>
            </div>
            {(c.topBuySymbols.length > 0 || c.topSellSymbols.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2 text-[11px]">
                {c.topBuySymbols.length > 0 && <span className="text-emerald-400 truncate">Bought: {c.topBuySymbols.join(', ')}</span>}
                {c.topSellSymbols.length > 0 && <span className="text-red-400 truncate">Sold: {c.topSellSymbols.join(', ')}</span>}
              </div>
            )}
            <p className="text-[12px] text-slate-200 mt-2">→ {c.inference}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════
// TAB 4: ACTIONS — alerts, alignment, position guidance, scorecard
// ═══════════════════════════════════════════════════════════════
function ActionsTab({ data }: { data: CommandCenterInsights }) {
  return (
    <div className="px-3 sm:px-6 py-3 space-y-4">
      {/* Alerts first — highest priority */}
      {data.alerts && data.alerts.length > 0 ? (
        <section>
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Active Alerts</h2>
          {data.alerts.map((a, i) => (
            <div key={i} className={`rounded-lg border p-3 mb-2 ${a.severity === 'CRITICAL' ? 'border-red-500/30 bg-red-500/10' : a.severity === 'WARNING' ? 'border-amber-500/30 bg-amber-500/10' : 'border-blue-500/20 bg-blue-500/5'}`}>
              <div className="text-[13px] font-semibold"><span className="mr-1">{a.icon}</span>{a.title}</div>
              <p className="text-[12px] text-slate-300 mt-1">{a.message}</p>
              {a.action && <p className="text-[11px] text-emerald-400 mt-1 italic">→ {a.action}</p>}
            </div>
          ))}
        </section>
      ) : (
        <section>
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Active Alerts</h2>
          <div className="text-[12px] text-slate-500 italic p-3 rounded border border-slate-700/50 bg-slate-800/30">No active alerts.</div>
        </section>
      )}

      {/* Position Guidance */}
      {data.positionGuidance && data.positionGuidance.length > 0 ? (
        <section>
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Open Positions — What To Do</h2>
          {data.positionGuidance.map(pg => (
            <div key={pg.scripCode} className={`rounded-lg border p-3 mb-2 ${pg.action === 'HOLD' || pg.action === 'TRAIL' ? 'border-emerald-500/20 bg-emerald-500/5' : pg.action === 'EXIT_EARLY' ? 'border-red-500/20 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-[13px]">{pg.symbol?.substring(0, 30)}</span>
                <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${pg.action === 'HOLD' ? 'bg-emerald-500/20 text-emerald-400' : pg.action === 'TIGHTEN_SL' ? 'bg-amber-500/20 text-amber-400' : pg.action === 'EXIT_EARLY' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>{pg.action.replace('_', ' ')}</span>
                <span className="text-[10px] text-slate-400">{pg.strategy} · {pg.side}</span>
                <span className={`ml-auto font-mono text-[12px] font-semibold ${signColor(pg.pnl)}`}>{pg.pnl > 0 ? '+' : ''}{fmtCr(pg.pnl)} ({pg.pnlPct > 0 ? '+' : ''}{pg.pnlPct?.toFixed(1)}%)</span>
              </div>
              <p className="text-[11px] text-slate-300 mt-1">{pg.reason}</p>
              {pg.sectorStatus && <p className="text-[10px] text-slate-500 mt-0.5">{pg.sectorStatus}</p>}
              {pg.suggestedSl > 0 && pg.suggestedSl !== pg.currentSl && (
                <p className="text-[10px] text-amber-400 mt-1">SL: {pg.currentSl} → suggested {pg.suggestedSl}</p>
              )}
            </div>
          ))}
        </section>
      ) : (
        <section>
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Open Positions — What To Do</h2>
          <div className="text-[12px] text-slate-500 italic p-3 rounded border border-slate-700/50 bg-slate-800/30">No open positions.</div>
        </section>
      )}

      {/* Strategy Alignment */}
      {data.strategyAlignments && data.strategyAlignments.length > 0 && (
        <section>
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Strategy Alignment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.strategyAlignments.map(sa => (
              <div key={sa.strategy} className={`rounded-lg border p-3 ${sa.status === 'ALIGNED' ? 'border-emerald-500/20 bg-emerald-500/5' : sa.status === 'CONFLICTING' ? 'border-red-500/20 bg-red-500/5' : sa.status === 'SUPPRESSED' ? 'border-orange-500/20 bg-orange-500/5' : 'border-slate-600/30 bg-slate-800/50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span>{sa.statusIcon}</span>
                  <span className="font-bold text-[12px]">{sa.strategy}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${sa.riskLevel === 'HIGH' ? 'bg-red-500/20 text-red-400' : sa.riskLevel === 'LOW' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>{sa.riskLevel}</span>
                  {sa.dayPnl !== 0 && <span className={`ml-auto text-[11px] font-mono ${signColor(sa.dayPnl)}`}>{fmtCr(sa.dayPnl)}</span>}
                </div>
                <p className="text-[11px] text-slate-300">{sa.description}</p>
                {sa.macroContext && <p className="text-[10px] text-slate-500 mt-0.5">{sa.macroContext}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Strategy Scorecard */}
      {data.strategyScorecard && data.strategyScorecard.length > 0 && (
        <section>
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Scorecard</h2>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px] min-w-[420px]">
              <thead><tr className="text-slate-500 border-b border-slate-700"><th className="text-left py-1 px-1">Strategy</th><th className="text-right">Balance</th><th className="text-right">Day P&L</th><th className="text-right">DD%</th><th className="text-right">Win%</th><th className="text-right">Trades</th></tr></thead>
              <tbody>
                {data.strategyScorecard.map(s => (
                  <tr key={s.strategy} className="border-b border-slate-800">
                    <td className="py-1 px-1 font-semibold">{s.strategy}</td>
                    <td className="text-right text-slate-300">{(s.balance / 100000).toFixed(1)}L</td>
                    <td className={`text-right font-semibold ${signColor(s.dayPnl)}`}>{s.dayPnl ? fmtCr(s.dayPnl) : '—'}</td>
                    <td className={`text-right ${s.drawdownPct > 5 ? 'text-red-400' : 'text-slate-400'}`}>{s.drawdownPct > 0 ? s.drawdownPct.toFixed(1) + '%' : '—'}</td>
                    <td className="text-right text-slate-300">{s.totalTrades > 0 ? s.winRate.toFixed(0) + '%' : '—'}</td>
                    <td className="text-right text-slate-500">{s.totalTrades || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40">
      <div className="text-base font-semibold text-slate-400 mb-2">{label}</div>
      <div className="text-3xl font-bold text-white tracking-tight">{value}</div>
      {sub && <div className="text-sm text-slate-500 mt-2">{sub}</div>}
    </div>
  )
}

function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40">
      <div className="text-base font-semibold text-slate-400 mb-2">{label}</div>
      <div className={`text-3xl font-bold tracking-tight ${color}`}>{value}</div>
    </div>
  )
}

// ── Phase 7: Sector Flow card with click-to-expand drill-down ──
type SectorFlow = NonNullable<NonNullable<CommandCenterInsights['dealIntelligence']>['sectorFlows']>[number]

function SectorFlowCard({ sf }: { sf: SectorFlow }) {
  const [open, setOpen] = useState(false)
  const regimeColor =
    sf.regime === 'ACCUMULATION' ? 'text-emerald-400'
    : sf.regime === 'DISTRIBUTION' || sf.regime === 'DISTRIBUTION_INTO_STRENGTH' ? 'text-red-400'
    : sf.regime === 'SPECULATIVE_BUYING' ? 'text-amber-400'
    : sf.regime === 'CHURN' ? 'text-slate-300'
    : 'text-slate-400'
  const isChurn = sf.regime === 'CHURN'
  const fiiNet = (sf.fiiBuyCr || 0) - (sf.fiiSellCr || 0)
  const diiNet = (sf.diiBuyCr || 0) - (sf.diiSellCr || 0)
  const otherNet = (sf.otherBuyCr || 0) - (sf.otherSellCr || 0)
  const days = sf.daysFlowing ?? 1

  return (
    <div className={`rounded-xl border transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(sf.netCr)}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full p-5 text-left">
        <div className="flex items-start gap-3 flex-wrap">
          {/* LEFT: sector name + pills + regime + inference */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-slate-500 text-base">{open ? '▾' : '▸'}</span>
              <span className="text-lg font-semibold text-slate-100 truncate">{sf.sector}</span>
              <span className="text-[12px] text-slate-500">· {sf.dealCount} deals</span>
              {sf.deliveryPct > 0 && (
                <span className={`text-[12px] ${sf.deliveryPct > 50 ? 'text-emerald-400' : sf.deliveryPct < 30 ? 'text-red-400' : 'text-slate-500'}`}>
                  · {sf.deliveryPct.toFixed(0)}% deliv
                </span>
              )}
              {days >= 2 && !isChurn && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${days >= 4 ? 'bg-emerald-500/30 text-emerald-300' : days === 3 ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-600/40 text-slate-300'}`}>
                  {days}-DAY {sf.streakDirection || ''}
                </span>
              )}
              {isChurn && (
                <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-red-600 text-amber-50 border border-red-400/60 shadow-sm">
                  ⚠ CHURN {sf.sectorChurnRatio != null ? `${Math.round(sf.sectorChurnRatio * 100)}%` : ''}
                </span>
              )}
            </div>
            {sf.regime && sf.regime !== 'NEUTRAL' && (
              <div className={`text-[12px] font-semibold mt-1.5 ${regimeColor}`}>{sf.regime.replace(/_/g, ' ')}</div>
            )}
            {sf.inference && <p className="text-sm text-slate-200 mt-2 leading-snug">{sf.inference}</p>}
          </div>

          {/* RIGHT: stacked today value + 5d cumulative, each with explicit label */}
          <div className="text-right shrink-0">
            <div className={`text-3xl font-bold tracking-tight ${signColor(sf.netCr)}`}>
              {sf.netCr > 0 ? '+' : ''}{fmtCr(sf.netCr)} Cr
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {sf.dataDate ? `today · ${sf.dataDate}` : 'today'}
            </div>
            {sf.weekTotalCr != null && (
              <>
                <div className={`text-xl font-semibold tracking-tight mt-2 ${signColor(sf.weekTotalCr)}`}>
                  {sf.weekTotalCr > 0 ? '+' : ''}{sf.weekTotalCr.toFixed(0)} Cr
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">5-day cumulative</div>
              </>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-700/40 mt-1 pt-4 space-y-4">
          {/* TRADER ACTION — biggest takeaway */}
          {sf.traderAction && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5">⚡ Trader Action</div>
              <p className="text-sm text-slate-100 leading-snug">{sf.traderAction}</p>
            </div>
          )}

          {/* FII / DII / Other split */}
          <div>
            <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Institutional split</div>
            <div className="grid grid-cols-3 gap-2">
              <FlowSplit label="FII" net={fiiNet} buy={sf.fiiBuyCr} sell={sf.fiiSellCr} />
              <FlowSplit label="DII" net={diiNet} buy={sf.diiBuyCr} sell={sf.diiSellCr} />
              <FlowSplit label="Other" net={otherNet} buy={sf.otherBuyCr} sell={sf.otherSellCr} />
            </div>
          </div>

          {/* Top stocks driving the sector — mini cards with gross/net + churn detection */}
          {sf.topStocks && sf.topStocks.length > 0 && (
            <div>
              <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Top stocks driving flow</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {sf.topStocks.map(st => {
                  const stockChurn = st.flowQuality === 'CHURN'
                  const borderClass = stockChurn
                    ? 'border-slate-500/40 bg-slate-700/30'
                    : st.netCr > 0 ? 'border-emerald-500/20 bg-emerald-500/5'
                    : 'border-red-500/20 bg-red-500/5'
                  const netColorClass = stockChurn
                    ? 'text-slate-300'
                    : st.netCr > 0 ? 'text-emerald-400' : 'text-red-400'
                  return (
                    <div
                      key={st.symbol}
                      className={`rounded-lg border p-3 transition-all duration-150 hover:shadow-md hover:shadow-slate-900/40 ${borderClass}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-bold text-base text-white truncate">{st.symbol}</span>
                        {stockChurn ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-600 text-amber-50 border border-red-400/60 shrink-0">⚠ CHURN</span>
                        ) : (
                          <span className="text-[11px] text-slate-500 shrink-0">{st.dealCount}d</span>
                        )}
                      </div>
                      <div className={`text-xl font-bold tracking-tight mt-1 ${netColorClass}`}>
                        {st.netCr > 0 ? '+' : ''}{st.netCr.toFixed(1)} Cr
                      </div>
                      {st.grossCr != null && st.grossCr > 0 && (
                        <div className={`text-[12px] mt-1 font-semibold ${stockChurn ? 'text-amber-300' : 'text-slate-400'}`}>
                          gross {st.grossCr.toFixed(0)} Cr
                          {st.churnRatio != null && st.churnRatio > 0.1 && (
                            <span className={`ml-1 ${stockChurn ? 'text-red-300' : 'text-slate-500'}`}>· {Math.round(st.churnRatio * 100)}% churn</span>
                          )}
                        </div>
                      )}
                      {stockChurn && st.dominantClient && (
                        <div className="text-[10px] text-slate-400 mt-1 italic truncate">by {st.dominantClient}</div>
                      )}
                      {/* Phase 8c: FII vs DII alignment badge + actual values */}
                      {st.fiiDiiAlignment && st.fiiDiiAlignment !== 'NO_INST' && !stockChurn && (
                        <FiiDiiAlignmentBadge
                          alignment={st.fiiDiiAlignment}
                          fiiNet={st.fiiNetCr || 0}
                          diiNet={st.diiNetCr || 0}
                        />
                      )}
                      {/* Phase 8a: 5-day sparkline + pattern badge */}
                      {st.dailyCrTimeseries && st.dailyCrTimeseries.length > 0 && (
                        <DailyFlowSparkline
                          series={st.dailyCrTimeseries}
                          dates={st.dailyDates}
                          pattern={st.pattern}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top clients — structured: buy / sell / net side-by-side so churners are obvious */}
          {sf.topClientFlows && sf.topClientFlows.length > 0 ? (
            <div>
              <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Top clients in this sector</div>
              <div className="space-y-2">
                {sf.topClientFlows.map((c, i) => {
                  const isClientChurn = c.churnRatio > 0.7
                  return (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 ${isClientChurn ? 'border-slate-500/40 bg-slate-700/30' : c.netCr > 0 ? 'border-emerald-500/20 bg-emerald-500/5' : c.netCr < 0 ? 'border-red-500/20 bg-red-500/5' : 'border-slate-700/40 bg-slate-800/30'}`}
                    >
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-100 truncate">{c.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${c.type === 'FII' ? 'bg-blue-500/20 text-blue-400' : c.type === 'DII' ? 'bg-emerald-500/20 text-emerald-400' : c.type === 'PROP_BROKER' ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-600/40 text-slate-400'}`}>{c.type}</span>
                        {isClientChurn && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-600 text-amber-50 border border-red-400/60">⚠ CHURN {Math.round(c.churnRatio * 100)}%</span>}
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-[12px]">
                        <div>
                          <div className="text-slate-500">Buy</div>
                          <div className="font-semibold text-emerald-400">{c.buyCr.toFixed(1)} Cr</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Sell</div>
                          <div className="font-semibold text-red-400">{c.sellCr.toFixed(1)} Cr</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Net</div>
                          <div className={`font-bold text-base ${c.netCr > 0 ? 'text-emerald-400' : c.netCr < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                            {c.netCr > 0 ? '+' : ''}{c.netCr.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : sf.topClients && sf.topClients.length > 0 && (
            <div>
              <div className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Top clients in this sector</div>
              <div className="space-y-1">
                {sf.topClients.map((c, i) => (
                  <div key={i} className="text-sm text-slate-300 truncate">→ {c}</div>
                ))}
              </div>
            </div>
          )}

          {/* Legacy signal as fallback when inference is empty */}
          {sf.signal && !sf.inference && (
            <p className="text-sm text-slate-300 italic">{sf.signal}</p>
          )}
        </div>
      )}
    </div>
  )
}

// Phase 8c: per-stock FII vs DII alignment badge with actual values shown.
// 9 alignment classes; the most actionable are FII_DII_BUY (highest conviction long),
// FII_DII_SELL (highest conviction short), FII_SELL_DII_BUY (Wyckoff accumulation),
// and FII_BUY_DII_SELL (Wyckoff distribution).
function FiiDiiAlignmentBadge({ alignment, fiiNet, diiNet }: { alignment: string; fiiNet: number; diiNet: number }) {
  let label = ''
  let bg = ''
  switch (alignment) {
    case 'FII_DII_BUY':
      label = '🟢🟢 FII+DII BUY'
      bg = 'bg-emerald-600/30 text-emerald-200 border-emerald-500/50'
      break
    case 'FII_DII_SELL':
      label = '🔴🔴 FII+DII SELL'
      bg = 'bg-red-600/30 text-red-200 border-red-500/50'
      break
    case 'FII_SELL_DII_BUY':
      label = '⭐ ACCUM (FII↓ DII↑)'
      bg = 'bg-amber-500/30 text-amber-100 border-amber-500/60'
      break
    case 'FII_BUY_DII_SELL':
      label = '⚠ DISTRIB (FII↑ DII↓)'
      bg = 'bg-amber-500/30 text-amber-100 border-amber-500/60'
      break
    case 'FII_ONLY_BUY':
      label = '🌐 FII BUY only'
      bg = 'bg-blue-500/30 text-blue-200 border-blue-500/50'
      break
    case 'FII_ONLY_SELL':
      label = '🌐 FII SELL only'
      bg = 'bg-blue-500/30 text-blue-200 border-blue-500/50'
      break
    case 'DII_ONLY_BUY':
      label = '🇮🇳 DII BUY only'
      bg = 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40'
      break
    case 'DII_ONLY_SELL':
      label = '🇮🇳 DII SELL only'
      bg = 'bg-red-500/20 text-red-200 border-red-500/40'
      break
    default:
      return null
  }
  return (
    <div className={`mt-2 px-2 py-1 rounded border text-[10px] font-semibold ${bg}`}>
      <div>{label}</div>
      <div className="text-[10px] font-normal opacity-80 mt-0.5">
        FII <span className={fiiNet > 0 ? 'text-emerald-400' : fiiNet < 0 ? 'text-red-400' : 'opacity-60'}>{fiiNet > 0 ? '+' : ''}{fiiNet.toFixed(1)}</span>
        {' · '}
        DII <span className={diiNet > 0 ? 'text-emerald-400' : diiNet < 0 ? 'text-red-400' : 'opacity-60'}>{diiNet > 0 ? '+' : ''}{diiNet.toFixed(1)}</span>
      </div>
    </div>
  )
}

// Phase 8a: 5-day daily flow sparkline + pattern badge.
// Renders a tiny SVG bar chart of the stock's net Cr per day (oldest → newest, left → right)
// plus a pattern label. Distinguishes systematic distribution (steady selling) from
// block-exit (one big day, then quiet).
function DailyFlowSparkline({ series, dates, pattern }: { series: number[]; dates?: string[]; pattern?: string }) {
  const filtered = series.filter(v => Math.abs(v) > 0.01)
  if (filtered.length === 0) return null

  const max = Math.max(...series.map(v => Math.abs(v))) || 1
  const w = 12
  const gap = 3
  const totalW = series.length * w + (series.length - 1) * gap
  const h = 30

  const patternMap: Record<string, { label: string; color: string }> = {
    SYSTEMATIC:          { label: '📉 SYSTEMATIC',  color: 'bg-amber-500/30 text-amber-100 border-amber-500/50' },
    BLOCK_EXIT:          { label: '📦 BLOCK EXIT',  color: 'bg-blue-500/30 text-blue-100 border-blue-500/50' },
    PERSISTENT_BUYING:   { label: '🟢 PERSISTENT BUY',  color: 'bg-emerald-600/30 text-emerald-100 border-emerald-500/50' },
    PERSISTENT_SELLING:  { label: '🔴 PERSISTENT SELL', color: 'bg-red-600/30 text-red-100 border-red-500/50' },
    CHOPPY:              { label: '🌀 CHOPPY',      color: 'bg-slate-600/40 text-slate-200 border-slate-500/50' },
    SINGLE_DAY:          { label: '· 1-day',        color: 'bg-slate-700/40 text-slate-400 border-slate-600/40' },
    MIXED_2D:            { label: '2-day mixed',    color: 'bg-slate-600/30 text-slate-300 border-slate-500/40' },
  }
  const p = pattern && patternMap[pattern]

  return (
    <div className="mt-2">
      <div className="flex items-end gap-1">
        <svg width={totalW} height={h} className="shrink-0">
          {series.map((v, i) => {
            const barH = Math.max(2, (Math.abs(v) / max) * h)
            const y = v >= 0 ? h - barH : h
            const fill = v > 0 ? '#10b981' : v < 0 ? '#ef4444' : '#475569'
            const date = dates?.[i] || ''
            return (
              <rect
                key={i}
                x={i * (w + gap)}
                y={y}
                width={w}
                height={barH}
                fill={fill}
                rx={1}
              >
                <title>{date}: {v >= 0 ? '+' : ''}{v.toFixed(1)} Cr</title>
              </rect>
            )
          })}
        </svg>
        {p && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${p.color}`}>{p.label}</span>
        )}
      </div>
    </div>
  )
}

function FlowSplit({ label, net, buy, sell }: { label: string; net: number; buy: number; sell: number }) {
  return (
    <div className={`rounded-lg border p-3 text-center ${net > 0 ? 'border-emerald-500/20 bg-emerald-500/5' : net < 0 ? 'border-red-500/20 bg-red-500/5' : 'border-slate-700/40 bg-slate-800/30'}`}>
      <div className="text-[12px] text-slate-400 font-semibold uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold tracking-tight mt-0.5 ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-slate-400'}`}>
        {net > 0 ? '+' : ''}{net.toFixed(1)}
      </div>
      <div className="text-[12px] text-slate-500 mt-0.5">B {buy.toFixed(0)} · S {sell.toFixed(0)}</div>
    </div>
  )
}

function AssBadge({ score, regime }: { score: number; regime: string }) {
  if (!regime) return null
  const bg = regime.includes('RISK_ON') ? 'bg-emerald-500/20 text-emerald-400' : regime.includes('RISK_OFF') ? 'bg-red-500/20 text-red-400' : 'bg-slate-500/20 text-slate-400'
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${bg}`}>
      ASS {score?.toFixed(1) ?? '—'} · {regime}
    </span>
  )
}

function Fold({ title, id, s, t, children }: { title: string; id: string; s: Record<string, boolean>; t: (k: string) => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30">
      <button onClick={() => t(id)} className="w-full flex items-center gap-2 text-left p-3">
        <span className="text-slate-500 text-xs">{s[id] ? '▾' : '▸'}</span>
        <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">{title}</span>
      </button>
      {s[id] && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}
