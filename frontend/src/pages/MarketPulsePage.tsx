import { useEffect, useState, useCallback } from 'react'
import { marketPulseApi } from '../services/api'
import type { MacroSnapshot, BlockDeal, BulkDeal, FiiDiiDay, CorporateEvent, DeliveryData } from '../services/api'
import { isAnyMarketOpen } from '../utils/tradingUtils'
import ConvictionBadge from '../components/ConvictionBadge'
import { StatePill } from '../components/MarketPulse/StatePill'

/** Indian number format: 1,23,45,678 */
const fmtIN = (n: number, decimals = 0): string => {
  if (n == null || isNaN(n)) return 'DM'
  const abs = Math.abs(n)
  const formatted = decimals > 0
    ? abs.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : Math.round(abs).toLocaleString('en-IN')
  return n < 0 ? '-' + formatted : formatted
}

const fmtNum = (n: number, decimals = 2) =>
  n != null && !isNaN(n) ? (decimals === 0 ? fmtIN(n, 0) : n.toFixed(decimals)) : 'DM'

const fmtStaleness = (items: { _lastFetchEpoch?: number }[]) => {
  const epoch = items.find(d => d._lastFetchEpoch)?._lastFetchEpoch
  if (!epoch) return null
  const agoMs = Date.now() - epoch * 1000
  const mins = Math.floor(agoMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m ago`
}

const fmtDate = (d: string) => {
  if (!d) return 'DM'
  // Handle YYYY-MM-DD
  const ymd = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) return `${ymd[3]}-${ymd[2]}-${ymd[1].slice(2)}`
  // Handle DD-Mon-YYYY or DD-MON-YYYY (e.g. 01-Apr-2026)
  const dmy = d.match(/^(\d{2})-(\w{3})-(\d{4})$/)
  if (dmy) {
    const months: Record<string, string> = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }
    const mm = months[dmy[2]] || months[dmy[2].charAt(0).toUpperCase() + dmy[2].slice(1).toLowerCase()] || '00'
    return `${dmy[1]}-${mm}-${dmy[3].slice(2)}`
  }
  return d
}

const fmtCr = (n: number) => {
  if (!n) return '0'
  const cr = n / 1e7
  return cr >= 1 ? `${fmtIN(cr)} Cr` : `${fmtIN(n / 1e5)} L`
}

const signColor = (n: number) =>
  n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-slate-400'

const signBg = (n: number) =>
  n > 0 ? 'bg-emerald-500/10 border-emerald-500/20' : n < 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-slate-700/50 border-slate-600/30'

const signPrefix = (n: number) => (n > 0 ? '+' : '')

function vixBadgeColor(vix: number): string {
  if (vix >= 30) return 'bg-red-500/20 text-red-400 border-red-500/30'
  if (vix >= 22) return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  if (vix >= 15) return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25'
  return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
}

function vixLabel(regime: string, vix: number): string {
  if (regime && regime !== 'N/A') return regime
  if (vix >= 30) return 'Extreme fear'
  if (vix >= 22) return 'High fear'
  if (vix >= 15) return 'Normal'
  return 'Low / Complacent'
}

export default function MarketPulsePage() {
  const [snapshot, setSnapshot] = useState<MacroSnapshot | null>(null)
  const [blockDeals, setBlockDeals] = useState<BlockDeal[]>([])
  const [bulkDeals, setBulkDeals] = useState<BulkDeal[]>([])
  const [fiiDii, setFiiDii] = useState<FiiDiiDay[]>([])
  const [corpEvents, setCorpEvents] = useState<CorporateEvent[]>([])
  const [deliveryData, setDeliveryData] = useState<DeliveryData>({})
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [blockFilter, setBlockFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const [eventsShowAll, setEventsShowAll] = useState(false)
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  const [dealTab, setDealTab] = useState<'block' | 'bulk'>('block')

  const loadAll = useCallback(async () => {
    try {
      const [snap, blocks, bulks, fii, events, delivery] = await Promise.all([
        marketPulseApi.getSnapshot(),
        marketPulseApi.getBlockDeals().catch(() => []),
        marketPulseApi.getBulkDeals().catch(() => []),
        marketPulseApi.getFiiDii().catch(() => []),
        marketPulseApi.getCorporateEvents().catch(() => []),
        marketPulseApi.getDeliveryData().catch(() => ({} as DeliveryData)),
      ])
      setSnapshot(snap)
      setBlockDeals(blocks)
      setBulkDeals(bulks)
      setFiiDii(fii)
      setCorpEvents(events)
      setDeliveryData(delivery)
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Failed to load market pulse:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
    const interval = setInterval(() => {
      if (isAnyMarketOpen()) loadAll()
    }, 60000)
    return () => clearInterval(interval)
  }, [loadAll])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-64 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const s = snapshot ?? {
    giftNiftyPrice: 0, giftNiftyChange: 0, giftNiftyChangePct: 0,
    giftNiftyOvernightChangePct: 0, giftNiftyOpen: 0, giftNiftyHigh: 0,
    giftNiftyLow: 0, giftNiftyPrevClose: 0,
    sgxNiftyLastTrade: 0, sgxNiftyLastTradeTimestamp: 0,
    indiaVix: 0, vixRegime: 'N/A',
    dowPrice: 0, sp500Price: 0, nasdaqPrice: 0,
    dowChangePct: 0, sp500ChangePct: 0, nasdaqChangePct: 0,
    dxyPrice: 0, dxyChangePct: 0, usVixPrice: 0, usVixChangePct: 0,
    crudeOilPrice: 0, crudeOilChangePct: 0, brentOilPrice: 0, brentOilChangePct: 0,
    goldPrice: 0, goldChangePct: 0, silverPrice: 0, silverChangePct: 0, usdInrPrice: 0, usdInrChangePct: 0,
    advanceDecline: { advances: 0, declines: 0, unchanged: 0, ratio: 1, ratioLabel: '0:0', foAdvances: 0, foDeclines: 0, foUnchanged: 0, foRatio: 1, foRatioLabel: '0:0' },
    timestamp: 0,
  }

  const ad = s.advanceDecline
  const adTotal = ad.advances + ad.declines + ad.unchanged
  const adAdvPct = adTotal > 0 ? (ad.advances / adTotal) * 100 : 50
  const foTotal = ad.foAdvances + ad.foDeclines + ad.foUnchanged
  const foAdvPct = foTotal > 0 ? (ad.foAdvances / foTotal) * 100 : 50


  // Filtered bulk deals
  const filteredBulk = blockFilter === 'all'
    ? bulkDeals
    : bulkDeals.filter(d => d.buySell?.toUpperCase() === blockFilter.toUpperCase())

  // Corporate events — sort by date, show 10 or all
  const sortedEvents = [...corpEvents].sort((a, b) => {
    const da = new Date(a.date.split('-').reverse().join('-')).getTime()
    const db = new Date(b.date.split('-').reverse().join('-')).getTime()
    return da - db
  })
  const visibleEvents = eventsShowAll ? sortedEvents : sortedEvents.slice(0, 10)

  // ======================== DEAL INSIGHTS ENGINE ========================
  const buildDealInsights = () => {
    type Inf = { icon: string; label: string; detail: string; sentiment: 'bullish' | 'bearish' | 'neutral' }
    type WatchItem = { symbol: string; score: number; bias: 'BUY' | 'SELL'; reasons: string[]; netCr: number; sector: string }

    // --- SECTOR MAPPING ---
    const sectorKeywords: [RegExp, string][] = [
      [/bank|financ|hdfc|icici|kotak|axis|sbi|bajaj fin|indusind|bandhan|idfc|pnb|federal|rbl|yes bank|muthoot|manappuram|shriram|chola|gold fin|credit/i, 'Banking & Finance'],
      [/infra|highway|road|construct|larsen|l&t|cement|ultra|ambuja|shree|acc|dalmia|jk cement|birla corp|ramco/i, 'Infra & Cement'],
      [/tech|info|tcs|wipro|hcl|ltimind|mphasis|coforge|persist|cyient|zensar|birla.*soft|latent|kpit|tata elx|intellect/i, 'IT & Tech'],
      [/pharma|drug|sun |cipla|lupin|dr.? reddy|divis|aurobindo|torrent|zydus|biocon|alkem|glenmark|natco|laurus|ipca/i, 'Pharma & Health'],
      [/reliance|oil|petro|gas|ongc|bpcl|hpcl|ioc|gail|adani.*gas|mahanagar|deep.*ind|mrpl|cpcl|confipet/i, 'Oil & Gas'],
      [/auto|maruti|tata motor|mahindra|bajaj auto|hero|tvs|eicher|ashok ley|ola elec|ather|escort/i, 'Auto'],
      [/metal|steel|tata steel|jsw|hindalco|vedanta|coal|nmdc|moil|nalco|sail|jindal/i, 'Metals & Mining'],
      [/fmcg|itc|hindustan.*uni|nestle|dabur|marico|colgate|britannia|godrej.*con|emami|tata.*con|vmart/i, 'FMCG & Retail'],
      [/power|ntpc|adani.*power|tata.*power|nhpc|jsw.*energy|torrent.*power|cesc|adani.*green|renewable|solar|energy/i, 'Power & Energy'],
      [/telecom|bharti|airtel|jio|vodafone|indus tower|tata comm/i, 'Telecom'],
      [/real|dlf|godrej.*prop|prestige|oberoi|brigade|sobha|phoenix|embassy/i, 'Real Estate'],
      [/insur|lic|sbi life|hdfc life|icici.*lomb|star health|max.*health|general ins/i, 'Insurance'],
      [/chem|chemical|srf|pidilite|aarti|clean science|deepak|alkali|tata chem|atul|navin/i, 'Chemicals'],
      [/defence|bhel|hal|bel|bharat dynamic|mazagon|cochin ship|garden reach|paras|data pattern/i, 'Defence & PSU'],
      [/sugar|davan|renuka|balrampur|triveni|dhampur|dwarikesh/i, 'Sugar'],
      [/logist|transport|avg|blue dart|gati|allcargo|tci|container/i, 'Logistics'],
      [/agri|fert|upl|coromandel|chambal|rashtriya|gnfc|gsfc|piind|bayer/i, 'Agri & Fertilizer'],
      [/media|zee|sun tv|network|pvr|inox|saregama|tips/i, 'Media & Entertainment'],
      [/textile|cotton|raymond|page|arvind|welspun|lux|dollar/i, 'Textiles'],
    ]
    const getSector = (symbol: string, name: string): string => {
      const combined = `${symbol} ${name}`
      for (const [re, sector] of sectorKeywords) {
        if (re.test(combined)) return sector
      }
      return 'Other'
    }

    // --- 1. Aggregate block deals by symbol ---
    const blockBySymbol: Record<string, { buyCr: number; sellCr: number; buyQty: number; sellQty: number; clients: string[]; avgPrice: number; deals: number }> = {}
    for (const d of blockDeals) {
      if (!blockBySymbol[d.symbol]) blockBySymbol[d.symbol] = { buyCr: 0, sellCr: 0, buyQty: 0, sellQty: 0, clients: [], avgPrice: 0, deals: 0 }
      const entry = blockBySymbol[d.symbol]
      const val = d.valueCr || 0
      if (d.buySell === 'BUY') { entry.buyCr += val; entry.buyQty += d.quantity || 0 }
      else { entry.sellCr += val; entry.sellQty += d.quantity || 0 }
      if (d.clientName && !entry.clients.includes(d.clientName)) entry.clients.push(d.clientName)
      entry.avgPrice = d.price || entry.avgPrice
      entry.deals++
    }

    // --- 2. Aggregate bulk deals by symbol ---
    const bulkBySymbol: Record<string, { buyCr: number; sellCr: number; buyQty: number; sellQty: number; clients: string[]; deals: number }> = {}
    for (const d of bulkDeals) {
      if (!bulkBySymbol[d.symbol]) bulkBySymbol[d.symbol] = { buyCr: 0, sellCr: 0, buyQty: 0, sellQty: 0, clients: [], deals: 0 }
      const entry = bulkBySymbol[d.symbol]
      const val = d.valueCr || 0
      if (d.buySell === 'BUY') { entry.buyCr += val; entry.buyQty += d.quantity || 0 }
      else { entry.sellCr += val; entry.sellQty += d.quantity || 0 }
      if (d.clientName && !entry.clients.includes(d.clientName)) entry.clients.push(d.clientName)
      entry.deals++
    }

    // --- 3. FII/DII weekly aggregates ---
    let fiiNetWeek = 0, diiNetWeek = 0, fiiSellWeek = 0, fiiBuyWeek = 0, diiBuyWeek = 0, diiSellWeek = 0
    for (const day of fiiDii) {
      fiiNetWeek += day.FII?.netValue ?? 0
      diiNetWeek += day.DII?.netValue ?? 0
      fiiBuyWeek += day.FII?.buyValue ?? 0
      fiiSellWeek += day.FII?.sellValue ?? 0
      diiBuyWeek += day.DII?.buyValue ?? 0
      diiSellWeek += day.DII?.sellValue ?? 0
    }

    // --- 4. ALL clients across block+bulk ---
    const allClients: Record<string, { buyCr: number; sellCr: number; blockBuyCr: number; blockSellCr: number; bulkBuyCr: number; bulkSellCr: number; buySymbols: string[]; sellSymbols: string[]; dealCount: number; type: 'foreign' | 'domestic' | 'other' }> = {}
    const classifyClient = (name: string): 'foreign' | 'domestic' | 'other' => {
      if (/goldman|morgan|citi|jpmorgan|hsbc|ubs|barclays|nomura|clsa|odi|fpi|foreign|europe|asia|global|singapore|mauritius|capital group|vanguard|blackrock|societe|deutsche|credit suisse|bnp|macquarie|aberdeen|schroders/i.test(name)) return 'foreign'
      if (/kotak|hdfc|icici|sbi|axis|lic|mutual|reliance|nippon|birla|dsp|trust|india|tata|bajaj|motilal|edelweiss|aditya|sundaram|canara|franklin|idfc|bandhan|groww|zerodha|parag|quant|mirae|invesco|mahindra|union|bank of|baroda/i.test(name)) return 'domestic'
      return 'other'
    }
    const addClientDeal = (c: string, sym: string, buySell: string, val: number, source: 'block' | 'bulk') => {
      if (!allClients[c]) allClients[c] = { buyCr: 0, sellCr: 0, blockBuyCr: 0, blockSellCr: 0, bulkBuyCr: 0, bulkSellCr: 0, buySymbols: [], sellSymbols: [], dealCount: 0, type: classifyClient(c) }
      const entry = allClients[c]
      if (buySell === 'BUY') {
        entry.buyCr += val
        if (source === 'block') entry.blockBuyCr += val; else entry.bulkBuyCr += val
        if (!entry.buySymbols.includes(sym)) entry.buySymbols.push(sym)
      } else {
        entry.sellCr += val
        if (source === 'block') entry.blockSellCr += val; else entry.bulkSellCr += val
        if (!entry.sellSymbols.includes(sym)) entry.sellSymbols.push(sym)
      }
      entry.dealCount++
    }
    for (const d of blockDeals) addClientDeal(d.clientName || 'Unknown', d.symbol, d.buySell, d.valueCr || 0, 'block')
    for (const d of bulkDeals) addClientDeal(d.clientName || 'Unknown', d.symbol, d.buySell, d.valueCr || 0, 'bulk')

    const sortedClients = Object.entries(allClients)
      .map(([name, data]) => ({ name, ...data, totalCr: data.buyCr + data.sellCr, netCr: data.buyCr - data.sellCr }))
      .sort((a, b) => b.totalCr - a.totalCr)

    const topClients = sortedClients.slice(0, 15)
    const foreignClients = sortedClients.filter(c => c.type === 'foreign')
    const domesticClients = sortedClients.filter(c => c.type === 'domestic')

    // --- 5. Cross-reference: symbols in both block + bulk ---
    const crossSymbols = Object.keys(blockBySymbol).filter(s => bulkBySymbol[s])

    // --- 6. Corporate events cross-ref with deal symbols ---
    const allDealSymbols = new Set([...Object.keys(blockBySymbol), ...Object.keys(bulkBySymbol)])
    const eventsWithDeals = corpEvents.filter(e => allDealSymbols.has(e.symbol))

    // --- 7. Per-symbol combined (block + bulk) with sector ---
    const symNameMap: Record<string, string> = {}
    for (const d of blockDeals) symNameMap[d.symbol] = d.name || ''
    for (const d of bulkDeals) if (!symNameMap[d.symbol]) symNameMap[d.symbol] = d.securityName || ''

    const allSymbols = new Set([...Object.keys(blockBySymbol), ...Object.keys(bulkBySymbol)])
    const symbolCards = Array.from(allSymbols).map(symbol => {
      const blk = blockBySymbol[symbol]
      const bulk = bulkBySymbol[symbol]
      const totalBuyCr = (blk?.buyCr ?? 0) + (bulk?.buyCr ?? 0)
      const totalSellCr = (blk?.sellCr ?? 0) + (bulk?.sellCr ?? 0)
      const allClientsForSym = [...new Set([...(blk?.clients ?? []), ...(bulk?.clients ?? [])])]
      const event = corpEvents.find(e => e.symbol === symbol)
      const sector = getSector(symbol, symNameMap[symbol] || '')
      // Count unique dates this symbol appears in (repeat detection)
      const dates = new Set<string>()
      for (const d of blockDeals) if (d.symbol === symbol) dates.add(d._date)
      for (const d of bulkDeals) if (d.symbol === symbol) dates.add(d._date)
      return {
        symbol, sector,
        blockBuyCr: blk?.buyCr ?? 0, blockSellCr: blk?.sellCr ?? 0,
        blockBuyQty: blk?.buyQty ?? 0, blockSellQty: blk?.sellQty ?? 0,
        bulkBuyCr: bulk?.buyCr ?? 0, bulkSellCr: bulk?.sellCr ?? 0,
        bulkBuyQty: bulk?.buyQty ?? 0, bulkSellQty: bulk?.sellQty ?? 0,
        totalBuyCr, totalSellCr,
        netCr: totalBuyCr - totalSellCr,
        totalCr: totalBuyCr + totalSellCr,
        inBlock: !!blk, inBulk: !!bulk,
        blockDeals: blk?.deals ?? 0, bulkDeals: bulk?.deals ?? 0,
        clients: allClientsForSym,
        event, dateCount: dates.size,
      }
    }).sort((a, b) => b.totalCr - a.totalCr)

    // --- 7b. Sector aggregation with FII/DII/Other split ---
    const sectorAgg: Record<string, {
      buyCr: number; sellCr: number; stocks: string[]; deals: number;
      fiiBuyCr: number; fiiSellCr: number; diiBuyCr: number; diiSellCr: number;
      otherBuyCr: number; otherSellCr: number;
    }> = {}
    const emptySectorAgg = () => ({ buyCr: 0, sellCr: 0, stocks: [], deals: 0, fiiBuyCr: 0, fiiSellCr: 0, diiBuyCr: 0, diiSellCr: 0, otherBuyCr: 0, otherSellCr: 0 })
    for (const sc of symbolCards) {
      if (!sectorAgg[sc.sector]) sectorAgg[sc.sector] = emptySectorAgg()
      sectorAgg[sc.sector].buyCr += sc.totalBuyCr
      sectorAgg[sc.sector].sellCr += sc.totalSellCr
      sectorAgg[sc.sector].stocks.push(sc.symbol)
      sectorAgg[sc.sector].deals += sc.blockDeals + sc.bulkDeals
    }
    // Classify each raw deal into sector + FII/DII/Other
    const classifyDealToSector = (d: { symbol: string; clientName?: string; buySell: string; valueCr?: number; name?: string; securityName?: string }) => {
      const sym = d.symbol || ''
      const sector = getSector(sym, symNameMap[sym] || d.name || (d as any).securityName || '')
      if (!sectorAgg[sector]) sectorAgg[sector] = emptySectorAgg()
      const val = d.valueCr || 0
      const clientType = classifyClient(d.clientName || '')
      if (clientType === 'foreign') {
        if (d.buySell === 'BUY') sectorAgg[sector].fiiBuyCr += val
        else sectorAgg[sector].fiiSellCr += val
      } else if (clientType === 'domestic') {
        if (d.buySell === 'BUY') sectorAgg[sector].diiBuyCr += val
        else sectorAgg[sector].diiSellCr += val
      } else {
        if (d.buySell === 'BUY') sectorAgg[sector].otherBuyCr += val
        else sectorAgg[sector].otherSellCr += val
      }
    }
    for (const d of blockDeals) classifyDealToSector(d)
    for (const d of bulkDeals) classifyDealToSector(d)

    const sectorCards = Object.entries(sectorAgg)
      .map(([sector, data]) => ({
        sector, ...data,
        netCr: data.buyCr - data.sellCr, totalCr: data.buyCr + data.sellCr,
        fiiNetCr: data.fiiBuyCr - data.fiiSellCr,
        diiNetCr: data.diiBuyCr - data.diiSellCr,
        otherNetCr: data.otherBuyCr - data.otherSellCr,
      }))
      .sort((a, b) => b.totalCr - a.totalCr)

    // --- 7c. Repeat appearances (multi-date symbols) ---
    const repeatSymbols = symbolCards.filter(s => s.dateCount >= 2).sort((a, b) => b.dateCount - a.dateCount)

    // --- 8. Money flow totals ---
    const totalBlockBuyCr = Object.values(blockBySymbol).reduce((s, v) => s + v.buyCr, 0)
    const totalBlockSellCr = Object.values(blockBySymbol).reduce((s, v) => s + v.sellCr, 0)
    const totalBlockCr = totalBlockBuyCr + totalBlockSellCr
    const totalBulkBuyCr = Object.values(bulkBySymbol).reduce((s, v) => s + v.buyCr, 0)
    const totalBulkSellCr = Object.values(bulkBySymbol).reduce((s, v) => s + v.sellCr, 0)
    const totalBulkCr = totalBulkBuyCr + totalBulkSellCr
    const grandTotalCr = totalBlockCr + totalBulkCr
    const foreignBuyCr = foreignClients.reduce((s, c) => s + c.buyCr, 0)
    const foreignSellCr = foreignClients.reduce((s, c) => s + c.sellCr, 0)
    const domesticBuyCr = domesticClients.reduce((s, c) => s + c.buyCr, 0)
    const domesticSellCr = domesticClients.reduce((s, c) => s + c.sellCr, 0)

    // --- 9. Inferences ---
    const inferences: Inf[] = []
    const f = fmtIN // shorthand for Indian number format

    // FII / DII weekly narrative
    if (fiiNetWeek !== 0 || diiNetWeek !== 0) {
      if (fiiNetWeek < -5000 && diiNetWeek > 0) {
        inferences.push({
          icon: '🔄', label: 'FII Selling, DII Absorbing',
          detail: `FIIs sold ${f(Math.abs(fiiNetWeek))} Cr (bought ${f(fiiBuyWeek)}, sold ${f(fiiSellWeek)}) this week while DIIs absorbed ${f(diiNetWeek)} Cr (bought ${f(diiBuyWeek)}, sold ${f(diiSellWeek)}). Domestic institutions providing a floor — classic foreign-to-domestic rotation. DII buy intensity (${f((diiBuyWeek / (fiiBuyWeek || 1)) * 100)}% of FII buy) suggests ${diiNetWeek > Math.abs(fiiNetWeek) ? 'strong cushioning — net positive absorption' : 'partial offset only — selling pressure remains'}.`,
          sentiment: diiNetWeek > Math.abs(fiiNetWeek) * 0.8 ? 'neutral' : 'bearish'
        })
      } else if (fiiNetWeek > 0 && diiNetWeek > 0) {
        inferences.push({
          icon: '📈', label: 'Dual Institutional Buying',
          detail: `Both FIIs (+${f(fiiNetWeek)} Cr) and DIIs (+${f(diiNetWeek)} Cr) are net buyers — strong institutional consensus. Combined inflow of ${f(fiiNetWeek + diiNetWeek)} Cr typically precedes sustained rally.`,
          sentiment: 'bullish'
        })
      } else if (fiiNetWeek < 0 && diiNetWeek < 0) {
        inferences.push({
          icon: '📉', label: 'Dual Institutional Selling',
          detail: `Both FIIs (${f(fiiNetWeek)} Cr) and DIIs (${f(diiNetWeek)} Cr) are net sellers — rare risk-off signal. Combined outflow of ${f(Math.abs(fiiNetWeek + diiNetWeek))} Cr. No institutional floor — market vulnerable to further downside.`,
          sentiment: 'bearish'
        })
      } else if (fiiNetWeek > 0 && diiNetWeek < 0) {
        inferences.push({
          icon: '📊', label: 'FII Buying, DII Booking Profits',
          detail: `FIIs net bought ${f(fiiNetWeek)} Cr while DIIs sold ${f(Math.abs(diiNetWeek))} Cr. Foreign inflows but domestic profit-booking — suggests sector rotation: FIIs entering large-caps while DIIs trim mid/small-caps.`,
          sentiment: 'neutral'
        })
      }
    }

    // FII trend direction
    if (fiiDii.length >= 3) {
      const days = fiiDii.map(d => d.FII?.netValue ?? 0)
      const allNeg = days.every(d => d < 0)
      const allPos = days.every(d => d > 0)
      const worsening = days.length >= 3 && days[0] < days[1] && days[1] < days[2] && days[0] < 0
      if (allNeg && days.length >= 3) {
        inferences.push({
          icon: '🔻', label: `FII Selling Streak: ${days.length} Consecutive Sessions`,
          detail: `FIIs have been net sellers for ${days.length} straight sessions (${days.map(d => f(d) + ' Cr').join(' → ')}). ${worsening ? 'Selling is accelerating — outflow increasing each day.' : 'Selling pace is steady.'} Persistent FII outflows often correlate with global risk-off or INR weakness.`,
          sentiment: 'bearish'
        })
      } else if (allPos && days.length >= 3) {
        inferences.push({
          icon: '🔺', label: `FII Buying Streak: ${days.length} Consecutive Sessions`,
          detail: `FIIs have been net buyers for ${days.length} straight sessions. Sustained foreign buying is typically the strongest market tailwind.`,
          sentiment: 'bullish'
        })
      }
    }

    // Block + Bulk money flow
    if (grandTotalCr > 0) {
      const netBlock = totalBlockBuyCr - totalBlockSellCr
      const netBulk = totalBulkBuyCr - totalBulkSellCr
      const netTotal = netBlock + netBulk
      inferences.push({
        icon: netTotal > 0 ? '🟢' : '🔴',
        label: `Deal Flow: ${netTotal > 0 ? 'Net Accumulation' : 'Net Distribution'} (${f(grandTotalCr)} Cr total)`,
        detail: `Block deals: Buy ${f(totalBlockBuyCr)} / Sell ${f(totalBlockSellCr)} = Net ${netBlock > 0 ? '+' : ''}${f(netBlock)} Cr across ${blockDeals.length} deals. ` +
          `Bulk deals: Buy ${f(totalBulkBuyCr)} / Sell ${f(totalBulkSellCr)} = Net ${netBulk > 0 ? '+' : ''}${f(netBulk)} Cr across ${bulkDeals.length} deals. ` +
          (netTotal > 0 && fiiNetWeek < 0
            ? 'Despite broad FII outflows, selective stock-level accumulation in block/bulk deals — smart money rotating into specific names.'
            : netTotal < 0
            ? 'Net distribution across deals — institutional de-risking or PE/promoter exits.'
            : 'Deal flow aligns with institutional buying trend.'),
        sentiment: netTotal > 0 ? 'bullish' : 'bearish'
      })
    }

    // Foreign vs Domestic client breakdown
    if (foreignClients.length > 0 || domesticClients.length > 0) {
      const foreignNet = foreignBuyCr - foreignSellCr
      const domesticNet = domesticBuyCr - domesticSellCr
      const parts: string[] = []
      if (foreignClients.length > 0)
        parts.push(`Foreign (${foreignClients.length} entities): Buy ${f(foreignBuyCr)} Cr / Sell ${f(foreignSellCr)} Cr = Net ${foreignNet > 0 ? '+' : ''}${f(foreignNet)} Cr`)
      if (domesticClients.length > 0)
        parts.push(`Domestic (${domesticClients.length} entities): Buy ${f(domesticBuyCr)} Cr / Sell ${f(domesticSellCr)} Cr = Net ${domesticNet > 0 ? '+' : ''}${f(domesticNet)} Cr`)
      inferences.push({
        icon: '🏦', label: 'Foreign vs Domestic Money Flow',
        detail: parts.join('. ') + '. ' + (
          foreignNet > 0 && domesticNet > 0 ? 'Both foreign and domestic capital flowing in — strong conviction.'
          : foreignNet < 0 && domesticNet > 0 ? `Foreign selling ${f(Math.abs(foreignNet))} Cr in deals while domestic absorbing — institutional rotation from FPI to DII hands.`
          : foreignNet > 0 && domesticNet < 0 ? 'Foreign buying while domestic books profits — FPI-led move.'
          : 'Both sides reducing exposure — broad risk-off in block/bulk channel.'
        ),
        sentiment: (foreignNet + domesticNet) > 0 ? 'bullish' : 'bearish'
      })
    }

    // Cross symbols (block + bulk overlap)
    if (crossSymbols.length > 0) {
      inferences.push({
        icon: '🔗', label: `${crossSymbols.length} Stock(s) Active in Both Block & Bulk Deals`,
        detail: crossSymbols.map(sym => {
          const blk = blockBySymbol[sym], bulk = bulkBySymbol[sym]
          const net = (blk.buyCr - blk.sellCr) + (bulk.buyCr - bulk.sellCr)
          return `${sym}: net ${net > 0 ? '+' : ''}${f(net)} Cr (${blk.deals} block + ${bulk.deals} bulk)`
        }).join(' | ') + '. Multiple deal channels for same stock = high institutional conviction.',
        sentiment: 'neutral'
      })
    }

    // Mega block deals
    const bigDeals = blockDeals.filter(d => (d.valueCr || 0) >= 50).sort((a, b) => (b.valueCr || 0) - (a.valueCr || 0))
    if (bigDeals.length > 0) {
      inferences.push({
        icon: '💎', label: `${bigDeals.length} Large Block Deal(s) (50+ Cr)`,
        detail: bigDeals.slice(0, 5).map(d => `${d.symbol}: ${d.buySell} ${f(d.valueCr)} Cr by ${d.clientName}`).join(' | ') +
          '. Deals of this magnitude are strategic — PE exits, promoter restructuring, or foreign fund mandates. Not retail-driven.',
        sentiment: 'neutral'
      })
    }

    // Corporate events cross-ref
    if (eventsWithDeals.length > 0) {
      inferences.push({
        icon: '📋', label: `${eventsWithDeals.length} Deal Stocks Have Upcoming Corporate Events`,
        detail: eventsWithDeals.slice(0, 5).map(e => {
          const sym = e.symbol
          const dealData = symbolCards.find(s => s.symbol === sym)
          return `${sym} (${e.purpose} on ${e.date}): net deal flow ${dealData ? (dealData.netCr > 0 ? '+' : '') + f(dealData.netCr) + ' Cr' : 'DM'}`
        }).join(' | ') + '. Block/bulk activity ahead of corporate events often signals informed positioning — results, dividends, or restructuring may be catalysts.',
        sentiment: 'neutral'
      })
    }

    // Top bulk deal stocks (only bulk, not in block)
    const bulkOnlySymbols = Object.keys(bulkBySymbol).filter(s => !blockBySymbol[s])
    const topBulkOnly = bulkOnlySymbols
      .map(s => ({ symbol: s, ...bulkBySymbol[s], netCr: bulkBySymbol[s].buyCr - bulkBySymbol[s].sellCr, totalCr: bulkBySymbol[s].buyCr + bulkBySymbol[s].sellCr }))
      .sort((a, b) => b.totalCr - a.totalCr)
      .slice(0, 5)
    if (topBulkOnly.length > 0) {
      const topAccum = topBulkOnly.filter(s => s.netCr > 0)
      const topDistrib = topBulkOnly.filter(s => s.netCr < 0)
      const parts: string[] = []
      if (topAccum.length > 0) parts.push(`Accumulation: ${topAccum.map(s => `${s.symbol} (+${f(s.netCr)} Cr, ${s.deals} deals)`).join(', ')}`)
      if (topDistrib.length > 0) parts.push(`Distribution: ${topDistrib.map(s => `${s.symbol} (${f(s.netCr)} Cr, ${s.deals} deals)`).join(', ')}`)
      inferences.push({
        icon: '📦', label: `Top Bulk-Only Stocks (${bulkOnlySymbols.length} stocks, ${bulkDeals.length - (crossSymbols.length > 0 ? crossSymbols.reduce((s, sym) => s + (bulkBySymbol[sym]?.deals ?? 0), 0) : 0)} deals)`,
        detail: parts.join('. ') + '. Bulk deals below block threshold but reveal broader mid/small-cap institutional flows.',
        sentiment: 'neutral'
      })
    }

    // ========== NEW: Sector theme detection ==========
    const significantSectors = sectorCards.filter(s => s.sector !== 'Other' && s.totalCr > 0)
    if (significantSectors.length > 0) {
      const topSectors = significantSectors.slice(0, 3)
      const accumSectors = topSectors.filter(s => s.netCr > 0)
      const distribSectors = topSectors.filter(s => s.netCr < 0)
      const sectorDetail: string[] = []
      for (const sec of topSectors) {
        sectorDetail.push(`${sec.sector}: ${f(sec.totalCr)} Cr across ${sec.stocks.length} stocks (net ${sec.netCr > 0 ? '+' : ''}${f(sec.netCr)} Cr) [${sec.stocks.slice(0, 3).join(', ')}${sec.stocks.length > 3 ? '...' : ''}]`)
      }
      inferences.push({
        icon: '🏭', label: `Sector Flows: ${accumSectors.length > distribSectors.length ? 'Accumulation-led' : distribSectors.length > accumSectors.length ? 'Distribution-led' : 'Mixed'}`,
        detail: sectorDetail.join('. ') + `. ${accumSectors.length >= 2 ? 'Multiple sectors seeing net inflows — broad institutional conviction, not single-sector rotation.' : distribSectors.length >= 2 ? 'Multiple sectors seeing net outflows — broad de-risking across themes.' : 'Institutional flow concentrated in specific sectors — sector rotation at play.'}`,
        sentiment: accumSectors.length > distribSectors.length ? 'bullish' : distribSectors.length > accumSectors.length ? 'bearish' : 'neutral'
      })
    }

    // ========== NEW: Repeat pattern detection ==========
    if (repeatSymbols.length > 0) {
      inferences.push({
        icon: '🔁', label: `${repeatSymbols.length} Stock(s) With Multi-Day Institutional Activity`,
        detail: repeatSymbols.slice(0, 5).map(s =>
          `${s.symbol}: appeared on ${s.dateCount} days, net ${s.netCr > 0 ? '+' : ''}${f(s.netCr)} Cr (${s.sector})`
        ).join(' | ') + '. Repeat appearances across multiple sessions signal sustained institutional thesis — not one-off block placement. These are the highest-conviction names.',
        sentiment: 'neutral'
      })
    }

    // ========== NEW: FII index flow vs FPI block deal divergence ==========
    if (fiiNetWeek !== 0 && foreignClients.length > 0) {
      const fpiBlockNet = foreignBuyCr - foreignSellCr
      const divergence = (fiiNetWeek < 0 && fpiBlockNet > 0) || (fiiNetWeek > 0 && fpiBlockNet < 0)
      if (divergence) {
        inferences.push({
          icon: '⚡', label: 'FII Index Flow vs FPI Block Deals DIVERGE',
          detail: `FII index-level: ${fiiNetWeek > 0 ? '+' : ''}${f(fiiNetWeek)} Cr (broad market) vs FPI block/bulk deals: ${fpiBlockNet > 0 ? '+' : ''}${f(fpiBlockNet)} Cr (stock-specific). ${
            fiiNetWeek < 0 && fpiBlockNet > 0
              ? `FIIs dumping ${f(Math.abs(fiiNetWeek))} Cr at index level BUT selectively accumulating ${f(fpiBlockNet)} Cr in specific names via block deals. This is the classic "smart money" pattern — reducing broad exposure while building concentrated positions. The block deal names (${foreignClients.filter(c => c.netCr > 0).flatMap(c => c.buySymbols).slice(0, 3).join(', ')}) are where foreign capital is actually flowing.`
              : 'FIIs buying broadly but exiting specific positions via block deals — check for PE exits or mandate rebalancing.'
          }`,
          sentiment: fpiBlockNet > 0 ? 'bullish' : 'bearish'
        })
      }
    }

    // ========== NEW: A/D ratio vs institutional flow divergence ==========
    const ad = s.advanceDecline
    const fiiBearish = fiiNetWeek < -3000
    const fiiBullish = fiiNetWeek > 3000
    // Use F&O breadth for insights (more relevant to our trading universe)
    const useAdv = ad.foAdvances > 0 ? ad.foAdvances : ad.advances
    const useDec = ad.foDeclines > 0 ? ad.foDeclines : ad.declines
    const useLabel = ad.foRatioLabel || ad.ratioLabel || 'DM'
    if (useAdv > 0 || useDec > 0) {
      const adRatio = useAdv / (useDec || 1)
      const breadthBullish = adRatio > 1.5
      const breadthBearish = adRatio < 0.7

      if (breadthBullish && fiiBearish) {
        inferences.push({
          icon: '🔀', label: 'DIVERGENCE: Strong F&O Breadth vs FII Selling',
          detail: `F&O breadth is positive (${useAdv}:${useDec} = ${useLabel}) despite FII outflows of ${f(Math.abs(fiiNetWeek))} Cr. Domestic buying is powering advances across ${useAdv} F&O stocks even as foreign money exits. This divergence typically resolves with: (a) FII selling exhaustion → rally accelerates, or (b) breadth collapse follows FII lead → correction ahead. Watch DII flows for resolution signal.`,
          sentiment: 'neutral'
        })
      } else if (breadthBearish && fiiBullish) {
        inferences.push({
          icon: '🔀', label: 'DIVERGENCE: Weak F&O Breadth vs FII Buying',
          detail: `Narrow F&O market (${useAdv}:${useDec} = ${useLabel}) despite FII inflows of +${f(fiiNetWeek)} Cr. FII money flowing into select large-caps while broader F&O declines — classic "index up, portfolio down" scenario. FII buying is concentrated, not broad — risky for late entries.`,
          sentiment: 'bearish'
        })
      } else if (breadthBullish && fiiBullish) {
        inferences.push({
          icon: '✅', label: 'ALIGNED: Strong F&O Breadth + FII Buying',
          detail: `Broad-based F&O advance (${useAdv}:${useDec} = ${useLabel}) backed by FII inflows of +${f(fiiNetWeek)} Cr. Breadth and flows aligned — strongest conviction signal for continuation.`,
          sentiment: 'bullish'
        })
      }
    }

    // ========== NEW: VIX + DXY + USD/INR macro correlation ==========
    const vix = s.indiaVix
    const dxyChg = s.dxyChangePct
    const usdInrChg = s.usdInrChangePct
    const macroSignals: string[] = []
    let macroSentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral'

    if (vix > 0) {
      if (vix >= 25 && fiiBearish) {
        macroSignals.push(`India VIX at ${vix.toFixed(1)} (elevated fear) + FII selling ${f(Math.abs(fiiNetWeek))} Cr = risk-off environment. High VIX with persistent FII outflows historically precedes further downside before capitulation.`)
        macroSentiment = 'bearish'
      } else if (vix >= 25 && fiiNetWeek > 0) {
        macroSignals.push(`India VIX at ${vix.toFixed(1)} (fear elevated) BUT FIIs are buying +${f(fiiNetWeek)} Cr — contrarian positioning. Smart money buying into fear is a classic bottoming signal.`)
        macroSentiment = 'bullish'
      } else if (vix < 15) {
        macroSignals.push(`India VIX at ${vix.toFixed(1)} (complacent) — low volatility often precedes large moves. Any surprise (earnings miss, global shock) could spike VIX and trigger rapid unwind.`)
      }
    }
    if (dxyChg && Math.abs(dxyChg) > 0.1) {
      if (dxyChg > 0.3 && fiiNetWeek < 0) {
        macroSignals.push(`DXY strengthening (+${dxyChg.toFixed(2)}%) drives capital to USD — consistent with FII outflows from India. DXY strength typically accelerates FPI selling.`)
        macroSentiment = 'bearish'
      } else if (dxyChg < -0.3 && fiiNetWeek > 0) {
        macroSignals.push(`DXY weakening (${dxyChg.toFixed(2)}%) favors EM flows — consistent with FII inflows. Weak dollar is a tailwind for Indian equities.`)
        macroSentiment = 'bullish'
      } else if (dxyChg < -0.3 && fiiNetWeek < 0) {
        macroSignals.push(`DXY weakening (${dxyChg.toFixed(2)}%) but FIIs still selling — India-specific outflow, not global USD rotation. Possibly domestic policy/earnings concerns driving FII exits.`)
        macroSentiment = 'bearish'
      }
    }
    if (usdInrChg && Math.abs(usdInrChg) > 0.15) {
      if (usdInrChg > 0.15 && fiiNetWeek < 0) {
        macroSignals.push(`INR weakening (+${usdInrChg.toFixed(2)}% USD/INR) amplifies FII exits — currency depreciation erodes USD returns, creating a self-reinforcing sell loop.`)
      } else if (usdInrChg < -0.15 && fiiNetWeek > 0) {
        macroSignals.push(`INR strengthening (${usdInrChg.toFixed(2)}% USD/INR) alongside FII buying — virtuous cycle: inflows strengthen INR, better USD returns attract more inflows.`)
      }
    }
    if (macroSignals.length > 0) {
      inferences.push({
        icon: '🌐', label: 'Macro Correlation: VIX / DXY / INR',
        detail: macroSignals.join(' ') + (macroSentiment === 'bearish' ? ' Net macro headwinds — defensive positioning warranted.' : macroSentiment === 'bullish' ? ' Net macro tailwinds — favorable for risk-on.' : ''),
        sentiment: macroSentiment
      })
    }

    // ========== NEW: Historical deviation (FII daily avg) ==========
    if (fiiDii.length >= 2) {
      const dailyFiiNets = fiiDii.map(d => d.FII?.netValue ?? 0)
      const avgDailyFii = dailyFiiNets.reduce((s, v) => s + v, 0) / dailyFiiNets.length
      const latestFiiNet = dailyFiiNets[0] ?? 0
      const deviation = avgDailyFii !== 0 ? latestFiiNet / avgDailyFii : 0
      if (Math.abs(deviation) > 1.5 || Math.abs(latestFiiNet) > 15000) {
        inferences.push({
          icon: '📐', label: `FII Flow Deviation: Latest ${f(latestFiiNet)} Cr vs Avg ${f(avgDailyFii)} Cr`,
          detail: `Latest session FII net (${f(latestFiiNet)} Cr) is ${deviation > 0 ? f(deviation, 1) + 'x' : 'reversed vs'} the ${fiiDii.length}-day average (${f(avgDailyFii)} Cr). ${
            Math.abs(latestFiiNet) > Math.abs(avgDailyFii) * 2
              ? 'Extreme deviation — this is an outlier session. Could signal panic selling, forced liquidation, or a large mandate shift.'
              : deviation < 0
              ? 'Flow direction reversed from average — watch if this is a one-day blip or trend change.'
              : 'Flow accelerating in same direction — trend intensifying.'
          }`,
          sentiment: latestFiiNet > 0 ? 'bullish' : 'bearish'
        })
      }
    }

    // ========== NEW: Pre-results positioning (corporate event + deals) ==========
    const preResultsPlays = eventsWithDeals.filter(e =>
      (e.purpose?.toLowerCase().includes('result') || e.purpose?.toLowerCase().includes('financial'))
    )
    if (preResultsPlays.length > 0) {
      inferences.push({
        icon: '🎯', label: `${preResultsPlays.length} Pre-Results Positioning Play(s)`,
        detail: preResultsPlays.slice(0, 4).map(e => {
          const sd = symbolCards.find(s => s.symbol === e.symbol)
          const clients = sd?.clients.slice(0, 2).join(', ') || 'Unknown'
          return `${e.symbol} (${e.purpose}, ${e.date}): ${sd ? `${sd.netCr > 0 ? 'ACCUMULATION' : 'DISTRIBUTION'} ${sd.netCr > 0 ? '+' : ''}${f(sd.netCr)} Cr by ${clients}` : 'DM'}`
        }).join(' | ') + '. Institutional block/bulk activity before results = potential informed positioning. These names carry highest event-driven opportunity (and risk).',
        sentiment: 'neutral'
      })
    }

    // ========== WATCHLIST: Top 5 actionable names ==========
    const watchlist: WatchItem[] = symbolCards.map(sc => {
      let score = 0
      const reasons: string[] = []
      // Deal value magnitude
      if (sc.totalCr >= 100) { score += 30; reasons.push(`${f(sc.totalCr)} Cr deal volume`) }
      else if (sc.totalCr >= 20) { score += 15; reasons.push(`${f(sc.totalCr)} Cr deal volume`) }
      // Multi-channel (block + bulk)
      if (sc.inBlock && sc.inBulk) { score += 20; reasons.push('Block + Bulk overlap') }
      // Repeat multi-day
      if (sc.dateCount >= 2) { score += 15 * sc.dateCount; reasons.push(`${sc.dateCount}-day repeat`) }
      // Corporate event catalyst
      if (sc.event) {
        score += 15
        const isResults = sc.event.purpose?.toLowerCase().includes('result') || sc.event.purpose?.toLowerCase().includes('financial')
        reasons.push(isResults ? `Results ${sc.event.date}` : `${sc.event.purpose} ${sc.event.date}`)
        if (isResults) score += 10 // Results are highest catalyst
      }
      // Net direction conviction (heavy one-sided)
      const totalDeals = sc.blockDeals + sc.bulkDeals
      if (totalDeals >= 3 && Math.abs(sc.netCr) > sc.totalCr * 0.6) { score += 10; reasons.push('One-sided flow') }
      // Foreign client involvement
      const hasForeignClient = sc.clients.some(c => /goldman|morgan|citi|jpmorgan|hsbc|ubs|barclays|nomura|clsa|odi|fpi|foreign|europe|asia|global/i.test(c))
      if (hasForeignClient) { score += 10; reasons.push('FPI involved') }
      return {
        symbol: sc.symbol, score, bias: sc.netCr >= 0 ? 'BUY' as const : 'SELL' as const,
        reasons, netCr: sc.netCr, sector: sc.sector,
      }
    }).sort((a, b) => b.score - a.score).slice(0, 6)

    return {
      inferences, symbolCards, topClients, foreignClients, domesticClients, sortedClients,
      totalBlockCr, totalBlockBuyCr, totalBlockSellCr,
      totalBulkCr, totalBulkBuyCr, totalBulkSellCr,
      grandTotalCr, crossSymbols, eventsWithDeals,
      fiiNetWeek, diiNetWeek, fiiBuyWeek, fiiSellWeek, diiBuyWeek, diiSellWeek,
      foreignBuyCr, foreignSellCr, domesticBuyCr, domesticSellCr,
      sectorCards, repeatSymbols, watchlist,
    }
  }

  const insights = (blockDeals.length > 0 || bulkDeals.length > 0 || fiiDii.length > 0) ? buildDealInsights() : null

  // Market thesis auto-generation — "Today" = latest trading day snapshot
  const latestFiiDay = fiiDii[0]
  const latestFiiNet = latestFiiDay?.FII?.netValue ?? 0
  const latestDiiNet = latestFiiDay?.DII?.netValue ?? 0
  const latestFiiDate = latestFiiDay?._date ? fmtDate(latestFiiDay._date) : ''

  const thesisToday = (() => {
    const parts: { text: string; color: string; isBadge?: boolean; badgeBg?: string }[] = []
    // FII/DII from latest trading day
    if (latestFiiNet) parts.push({
      text: `FII ${latestFiiNet > 0 ? '▲ buying' : '▼ selling'} ${fmtIN(Math.abs(latestFiiNet))} Cr`,
      color: latestFiiNet > 0 ? 'text-emerald-400' : 'text-red-400'
    })
    if (latestDiiNet) parts.push({
      text: `DII ${latestDiiNet > 0 ? '▲ absorbing' : '▼ selling'} ${fmtIN(Math.abs(latestDiiNet))} Cr`,
      color: latestDiiNet > 0 ? 'text-emerald-400' : 'text-red-400'
    })
    if (s.indiaVix > 0) {
      const vixHigh = s.indiaVix >= 20
      parts.push({
        text: `VIX ${s.indiaVix.toFixed(1)}`,
        color: vixHigh ? 'text-white font-bold' : 'text-blue-300',
        isBadge: vixHigh,
        badgeBg: 'bg-red-500'
      })
    }
    const adR = s.advanceDecline
    if (adR?.foAdvances || adR?.foDeclines) {
      parts.push({
        text: `F&O Breadth ${adR.foRatioLabel || 'DM'}`,
        color: adR.foRatio > 1 ? 'text-emerald-400' : 'text-red-400'
      })
    }
    if (adR?.advances) {
      parts.push({
        text: `NIFTY Breadth ${adR.ratioLabel || 'DM'}`,
        color: adR.ratio > 1 ? 'text-emerald-400' : 'text-red-400'
      })
    }
    return parts
  })()
  const hasThesis = thesisToday.length > 0
  const thesisSentiment = latestFiiNet > 0 && latestDiiNet > 0 ? 'bullish' : latestFiiNet < 0 && latestDiiNet < 0 ? 'bearish' : 'neutral'

  // Sector bars: compute max for proportional widths
  const sectorBars = insights ? insights.sectorCards.filter(sc => sc.sector !== 'Other').sort((a, b) => Math.abs(b.netCr) - Math.abs(a.netCr)) : []
  const maxSectorFiiDii = sectorBars.length > 0 ? Math.max(...sectorBars.map(sc => Math.max(Math.abs(sc.fiiNetCr), Math.abs(sc.diiNetCr), Math.abs(sc.otherNetCr))), 1) : 1
  const deliverySectors = deliveryData?.sectors || {}

  return (
    <div className="space-y-4">
      {/* ===== 1. HEADER ===== */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-white">Market Pulse</h1>
        <span className="text-[15px] text-slate-400">
          {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : ''}
        </span>
      </div>

      {/* ===== 2. MACRO TICKER STRIP ===== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(() => {
          const useSgx = s.sgxNiftyLastTrade > 0;
          const price = useSgx ? s.sgxNiftyLastTrade : s.giftNiftyPrice;
          const prevClose = s.giftNiftyPrevClose > 0 ? s.giftNiftyPrevClose : 0;
          const changePct = useSgx && prevClose > 0
            ? (s.sgxNiftyLastTrade - prevClose) / prevClose * 100
            : s.giftNiftyChangePct;
          return (
            <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(changePct)}`}>
              <div className="text-base font-semibold text-slate-400 mb-2">
                {useSgx ? 'SGX NIFTY' : 'GIFT NIFTY'}
                <StatePill state={s.giftNiftyStatus?.state} />
              </div>
              <div className="text-3xl font-bold text-white tracking-tight">
                {price > 0 ? fmtNum(price, 0) : 'DM'}
              </div>
              <div className={`text-lg font-semibold ${signColor(changePct)}`}>
                {signPrefix(changePct)}{fmtNum(changePct)}%
              </div>
              {s.giftNiftyStatus?.state && s.giftNiftyStatus.state !== 'LIVE' && s.giftNiftyStatus.subtitle && (
                <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.giftNiftyStatus.subtitle}</div>
              )}
              {s.giftNiftyOvernightChangePct !== 0 && (
                <div className={`text-[13px] mt-1 ${signColor(s.giftNiftyOvernightChangePct)}`}>
                  O/N: {signPrefix(s.giftNiftyOvernightChangePct)}{fmtNum(s.giftNiftyOvernightChangePct)}%
                </div>
              )}
            </div>
          );
        })()}

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${vixBadgeColor(s.indiaVix)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">INDIA VIX<StatePill state={s.indiaVixStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">
            {s.indiaVix > 0 ? fmtNum(s.indiaVix) : 'DM'}
          </div>
          <div className="text-[13px] font-medium mt-1">{vixLabel(s.vixRegime, s.indiaVix)}</div>
          {s.indiaVixStatus?.state && s.indiaVixStatus.state !== 'LIVE' && s.indiaVixStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.indiaVixStatus.subtitle}</div>
          )}
        </div>

        <div className="rounded-xl border border-slate-600/30 bg-slate-700/50 p-4">
          <div className="text-[13px] font-semibold text-slate-400 mb-2">ADVANCE / DECLINE<StatePill state={s.advanceDeclineStatus?.state} /></div>
          {/* F&O Breadth — primary */}
          <div className="text-[11px] font-semibold text-amber-400 mb-0.5">F&O ({foTotal})</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-emerald-400">{ad.foAdvances}</span>
            <span className="text-slate-500">/</span>
            <span className="text-lg font-bold text-red-400">{ad.foDeclines}</span>
            <span className="text-sm font-semibold text-slate-300 ml-1">{ad.foRatioLabel || 'DM'}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-600 overflow-hidden mt-1">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
              style={{ width: `${foAdvPct}%` }} />
          </div>
          {/* NIFTY Total Market Breadth — secondary */}
          <div className="text-[11px] font-semibold text-blue-400 mt-2 mb-0.5">NIFTY ({adTotal})</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold text-emerald-400">{ad.advances}</span>
            <span className="text-slate-500">/</span>
            <span className="text-sm font-bold text-red-400">{ad.declines}</span>
            <span className="text-xs font-semibold text-slate-300 ml-1">{ad.ratioLabel || 'DM'}</span>
          </div>
          <div className="h-1 rounded-full bg-slate-600 overflow-hidden mt-1">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
              style={{ width: `${adAdvPct}%` }} />
          </div>
          {s.advanceDeclineStatus?.state && s.advanceDeclineStatus.state !== 'LIVE' && s.advanceDeclineStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-1 italic">{s.advanceDeclineStatus.subtitle}</div>
          )}
        </div>

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(s.dowChangePct)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">DOW JONES<StatePill state={s.dowStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.dowPrice > 0 ? fmtNum(s.dowPrice, 0) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(s.dowChangePct)}`}>{signPrefix(s.dowChangePct)}{fmtNum(s.dowChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">US Session</div>
          {s.dowStatus?.state && s.dowStatus.state !== 'LIVE' && s.dowStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.dowStatus.subtitle}</div>
          )}
        </div>

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(s.sp500ChangePct)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">S&P 500<StatePill state={s.sp500Status?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.sp500Price > 0 ? fmtNum(s.sp500Price, 0) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(s.sp500ChangePct)}`}>{signPrefix(s.sp500ChangePct)}{fmtNum(s.sp500ChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">US Session</div>
          {s.sp500Status?.state && s.sp500Status.state !== 'LIVE' && s.sp500Status.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.sp500Status.subtitle}</div>
          )}
        </div>

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(s.nasdaqChangePct)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">NASDAQ<StatePill state={s.nasdaqStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.nasdaqPrice > 0 ? fmtNum(s.nasdaqPrice, 0) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(s.nasdaqChangePct)}`}>{signPrefix(s.nasdaqChangePct)}{fmtNum(s.nasdaqChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">US Session</div>
          {s.nasdaqStatus?.state && s.nasdaqStatus.state !== 'LIVE' && s.nasdaqStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.nasdaqStatus.subtitle}</div>
          )}
        </div>
      </div>

      {/* Global Indicators row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(-s.dxyChangePct)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">DXY (USD)<StatePill state={s.dxyStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.dxyPrice > 0 ? fmtNum(s.dxyPrice, 2) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(-s.dxyChangePct)}`}>{signPrefix(s.dxyChangePct)}{fmtNum(s.dxyChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">{s.dxyChangePct > 0 ? 'Strong $ = EM pressure' : s.dxyChangePct < 0 ? 'Weak $ = EM tailwind' : ''}</div>
          {s.dxyStatus?.state && s.dxyStatus.state !== 'LIVE' && s.dxyStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.dxyStatus.subtitle}</div>
          )}
        </div>

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${s.usVixPrice > 25 ? 'bg-red-500/10 border-red-500/30' : s.usVixPrice > 18 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">US VIX (CBOE)<StatePill state={s.usVixStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.usVixPrice > 0 ? fmtNum(s.usVixPrice, 1) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(s.usVixChangePct)}`}>{signPrefix(s.usVixChangePct)}{fmtNum(s.usVixChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">{s.usVixPrice > 25 ? 'High fear' : s.usVixPrice > 18 ? 'Elevated' : 'Calm'}</div>
          {s.usVixStatus?.state && s.usVixStatus.state !== 'LIVE' && s.usVixStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.usVixStatus.subtitle}</div>
          )}
        </div>

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(s.silverChangePct)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">SILVER<StatePill state={s.silverStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.silverPrice > 0 ? '$' + fmtNum(s.silverPrice, 2) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(s.silverChangePct)}`}>{signPrefix(s.silverChangePct)}{fmtNum(s.silverChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">{
            s.silverPrice <= 0 ? ''
            : s.silverChangePct > 2 ? 'Industrial demand surge'
            : s.silverChangePct > 0.5 ? 'Mild bid — supportive'
            : s.silverChangePct < -2 ? 'Risk-off pressure'
            : s.silverChangePct < -0.5 ? 'Mild softening'
            : 'Range-bound'
          }</div>
          {s.silverStatus?.state && s.silverStatus.state !== 'LIVE' && s.silverStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.silverStatus.subtitle}</div>
          )}
        </div>

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(s.goldChangePct)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">GOLD<StatePill state={s.goldStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.goldPrice > 0 ? '$' + fmtNum(s.goldPrice, 1) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(s.goldChangePct)}`}>{signPrefix(s.goldChangePct)}{fmtNum(s.goldChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">{s.goldChangePct > 1 ? 'Risk-off / safe haven' : ''}</div>
          {s.goldStatus?.state && s.goldStatus.state !== 'LIVE' && s.goldStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.goldStatus.subtitle}</div>
          )}
        </div>

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(-s.usdInrChangePct)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">USD/INR<StatePill state={s.usdInrStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.usdInrPrice > 0 ? '₹' + fmtNum(s.usdInrPrice, 2) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(-s.usdInrChangePct)}`}>{signPrefix(s.usdInrChangePct)}{fmtNum(s.usdInrChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">{s.usdInrChangePct > 0.3 ? 'Rupee weakening = FII outflow' : s.usdInrChangePct < -0.3 ? 'Rupee strengthening' : ''}</div>
          {s.usdInrStatus?.state && s.usdInrStatus.state !== 'LIVE' && s.usdInrStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.usdInrStatus.subtitle}</div>
          )}
        </div>

        <div className={`rounded-xl border p-5 transition-all duration-150 hover:shadow-lg hover:shadow-slate-900/40 ${signBg(-s.brentOilChangePct)}`}>
          <div className="text-base font-semibold text-slate-400 mb-2">BRENT CRUDE<StatePill state={s.brentStatus?.state} /></div>
          <div className="text-3xl font-bold text-white tracking-tight">{s.brentOilPrice > 0 ? '$' + fmtNum(s.brentOilPrice, 2) : 'DM'}</div>
          <div className={`text-lg font-semibold ${signColor(s.brentOilChangePct)}`}>{signPrefix(s.brentOilChangePct)}{fmtNum(s.brentOilChangePct)}%</div>
          <div className="text-[13px] text-slate-500 mt-1">India benchmark</div>
          {s.brentStatus?.state && s.brentStatus.state !== 'LIVE' && s.brentStatus.subtitle && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic">{s.brentStatus.subtitle}</div>
          )}
        </div>
      </div>

      {/* ===== 3. MARKET THESIS BANNER (latest trading day) ===== */}
      {hasThesis && (
        <div className={`rounded-xl border px-5 py-3 ${
          thesisSentiment === 'bullish' ? 'bg-emerald-500/10 border-emerald-500/25' :
          thesisSentiment === 'bearish' ? 'bg-red-500/10 border-red-500/25' :
          'bg-blue-500/10 border-blue-500/25'
        }`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] uppercase tracking-wider text-slate-500 font-semibold shrink-0">
              {latestFiiDate || 'Latest'}
            </span>
            <span className="text-slate-600">|</span>
            {thesisToday.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-600 mx-0.5">|</span>}
                {item.isBadge ? (
                  <span className={`${item.badgeBg} ${item.color} text-[13px] px-2 py-0.5 rounded-md`}>{item.text}</span>
                ) : (
                  <span className={`text-lg font-semibold ${item.color}`}>{item.text}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Pre-Market Watchlist removed — superseded by /hot-stocks page (Phase 1a). */}

      {/* ===== 5. FLOW DASHBOARD ===== */}
      {insights && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <div className={`rounded-lg border p-2.5 text-center ${signBg(insights.fiiNetWeek)}`}>
            <div className="text-[13px] text-slate-400 uppercase">FII Net (Wk)</div>
            <div className={`text-[15px] font-bold ${signColor(insights.fiiNetWeek)}`}>
              {signPrefix(insights.fiiNetWeek)}{fmtIN(Math.abs(insights.fiiNetWeek))} Cr
            </div>
          </div>
          <div className={`rounded-lg border p-2.5 text-center ${signBg(insights.diiNetWeek)}`}>
            <div className="text-[13px] text-slate-400 uppercase">DII Net (Wk)</div>
            <div className={`text-[15px] font-bold ${signColor(insights.diiNetWeek)}`}>
              {signPrefix(insights.diiNetWeek)}{fmtIN(Math.abs(insights.diiNetWeek))} Cr
            </div>
          </div>
          <div className="rounded-lg border border-slate-600/30 bg-slate-800/50 p-2.5 text-center">
            <div className="text-[13px] text-slate-400 uppercase">Block Vol</div>
            <div className="text-[15px] font-bold text-white">{fmtIN(insights.totalBlockCr)} Cr</div>
          </div>
          <div className="rounded-lg border border-slate-600/30 bg-slate-800/50 p-2.5 text-center">
            <div className="text-[13px] text-slate-400 uppercase">Bulk Vol</div>
            <div className="text-[15px] font-bold text-white">{fmtIN(insights.totalBulkCr)} Cr</div>
          </div>
          {(() => {
            const foreignNet = insights.foreignBuyCr - insights.foreignSellCr
            return (
              <div className={`rounded-lg border p-2.5 text-center ${signBg(foreignNet)}`}>
                <div className="text-[13px] text-slate-400 uppercase">Foreign Net</div>
                <div className={`text-[15px] font-bold ${signColor(foreignNet)}`}>
                  {signPrefix(foreignNet)}{fmtIN(Math.abs(foreignNet))} Cr
                </div>
              </div>
            )
          })()}
          {(() => {
            const domesticNet = insights.domesticBuyCr - insights.domesticSellCr
            return (
              <div className={`rounded-lg border p-2.5 text-center ${signBg(domesticNet)}`}>
                <div className="text-[13px] text-slate-400 uppercase">Domestic Net</div>
                <div className={`text-[15px] font-bold ${signColor(domesticNet)}`}>
                  {signPrefix(domesticNet)}{fmtIN(Math.abs(domesticNet))} Cr
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ===== 6. INSTITUTIONAL SECTOR FLOWS (FII vs DII bars + delivery %) ===== */}
      {sectorBars.length > 0 && (
        <div className="card">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-white">Institutional Sector Flows</h3>
              <p className="text-[13px] text-slate-500 mt-0.5">Last 5 trading days — Block + Bulk deals | Values in Cr</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500/70" /> FII</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/70" /> DII</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500/70" /> Other</span>
              <span className="text-slate-700">|</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/40" /> Inflow</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/40" /> Outflow</span>
            </div>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-2 mb-2 px-3 text-[13px] text-slate-600 uppercase tracking-wider font-semibold">
            <div className="w-28 text-right shrink-0">Sector</div>
            <div className="w-44 shrink-0 text-center">FII / DII / Other Flow</div>
            <div className="w-20 shrink-0 text-right">Net</div>
            <div className="w-14 shrink-0 text-center">Del%</div>
            <div className="flex-1">Signal</div>
          </div>

          <div className="space-y-1">
            {sectorBars.map(sec => {
              const deliv = deliverySectors[sec.sector]
              const delivPct = deliv?.deliveryPct ?? 0
              const hasAnyFlow = sec.fiiNetCr !== 0 || sec.diiNetCr !== 0 || sec.otherNetCr !== 0
              const barMax = Math.max(maxSectorFiiDii, Math.abs(sec.otherNetCr), 1)
              const renderBar = (netCr: number, label: string, color: string) => {
                if (netCr === 0) return null
                const isBuy = netCr > 0
                const pct = Math.min(Math.abs(netCr) / barMax * 50, 50)
                return (
                  <div className="flex items-center gap-1">
                    <span className={`w-6 text-[13px] font-bold text-right ${color}`}>{label}</span>
                    <div className="flex-1 h-2.5 bg-slate-800/80 rounded overflow-hidden relative">
                      <div className={`absolute top-0 h-full rounded transition-all ${isBuy ? 'left-1/2 bg-emerald-500/50' : 'right-1/2 bg-red-500/50'}`}
                        style={{ width: `${pct}%` }} />
                      <div className="absolute inset-0 flex items-center justify-center"><div className="w-px h-full bg-slate-600/30" /></div>
                    </div>
                    <span className={`w-16 text-[13px] font-semibold text-right ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isBuy ? '▲' : '▼'} {fmtIN(Math.abs(netCr))} Cr
                    </span>
                  </div>
                )
              }

              // Delivery + flow interpretation — detailed actionable signals
              const highDeliv = delivPct >= 50
              const lowDeliv = delivPct > 0 && delivPct < 35
              const netBuying = sec.netCr > 5
              const netSelling = sec.netCr < -5
              const fiiSelling = sec.fiiNetCr < -5
              const diiBuying = sec.diiNetCr > 5
              const fiiBuying = sec.fiiNetCr > 5
              const diiSelling = sec.diiNetCr < -5

              let signal: { text: string; color: string; bg: string } | null = null
              if (delivPct > 0) {
                if (highDeliv && netBuying && fiiBuying && diiBuying) {
                  signal = { text: 'Strong accumulation with conviction delivery — D1 support likely forming. Look for MEAN REVERSION long entries on dips.', color: 'text-emerald-300', bg: 'bg-emerald-500/8' }
                } else if (highDeliv && netBuying) {
                  signal = { text: `Conviction buying (${delivPct}% held) — institutions taking delivery, not flipping. Breakout potential if volume sustains.`, color: 'text-emerald-400', bg: 'bg-emerald-500/5' }
                } else if (highDeliv && netSelling) {
                  signal = { text: `Deliberate unwinding at ${delivPct}% delivery — NOT panic. Planned exit, possibly D1 broken. Avoid catching the knife.`, color: 'text-red-400', bg: 'bg-red-500/5' }
                } else if (lowDeliv && netSelling && fiiSelling && diiBuying) {
                  signal = { text: `FII selling ${fmtIN(Math.abs(sec.fiiNetCr))} Cr but only ${delivPct}% delivered — speculative dump. DII absorbing. MEAN REVERSION bounce likely.`, color: 'text-amber-300', bg: 'bg-amber-500/8' }
                } else if (lowDeliv && netSelling) {
                  signal = { text: `${Math.round(100 - delivPct)}% intraday — panic selling without delivery. Likely short-covering bounce ahead. Watch for reversal candle.`, color: 'text-amber-400', bg: 'bg-amber-500/5' }
                } else if (lowDeliv && netBuying) {
                  signal = { text: `Buying at low ${delivPct}% delivery = intraday churn. Traders riding momentum but not holding — weak conviction. Wait for delivery % to rise before entry.`, color: 'text-amber-400', bg: 'bg-amber-500/5' }
                } else if (highDeliv && !netBuying && !netSelling) {
                  signal = { text: `High delivery ${delivPct}% with balanced flow — institutions positioning quietly. Breakout or breakdown imminent. Watch for direction.`, color: 'text-blue-400', bg: 'bg-blue-500/5' }
                } else if (lowDeliv) {
                  signal = { text: `Only ${delivPct}% delivery (${Math.round(100 - delivPct)}% intraday) — dominated by speculators. No institutional conviction. Avoid.`, color: 'text-slate-500', bg: 'bg-slate-700/20' }
                } else if (fiiSelling && diiBuying) {
                  signal = { text: `FII exit -${fmtIN(Math.abs(sec.fiiNetCr))} Cr absorbed by DII +${fmtIN(sec.diiNetCr)} Cr — floor being set. Mean reversion setup if DII holds.`, color: 'text-slate-300', bg: 'bg-slate-700/20' }
                } else {
                  signal = { text: `Delivery ${delivPct}% — normal range. No strong directional signal from institutional flow.`, color: 'text-slate-500', bg: 'bg-slate-700/10' }
                }
              } else if (fiiSelling && diiBuying) {
                signal = { text: `FII dumping -${fmtIN(Math.abs(sec.fiiNetCr))} Cr, DII absorbing +${fmtIN(sec.diiNetCr)} Cr — rotation from foreign to domestic hands.`, color: 'text-slate-300', bg: 'bg-slate-700/20' }
              } else if (fiiBuying && diiSelling) {
                signal = { text: `FII accumulating +${fmtIN(sec.fiiNetCr)} Cr while DII books +${fmtIN(Math.abs(sec.diiNetCr))} Cr profit — FPI-led, forward-looking bet.`, color: 'text-blue-400', bg: 'bg-blue-500/5' }
              }

              return (
                <div key={sec.sector} className={`rounded-lg border border-slate-700/30 px-3 py-2.5 ${signal?.bg || 'bg-slate-800/20'}`}>
                  <div className="flex items-center gap-2">
                    {/* Sector name */}
                    <div className="w-28 shrink-0 text-right">
                      <div className="text-[13px] text-white font-semibold truncate" title={sec.sector}>{sec.sector}</div>
                      <div className="text-[13px] text-slate-600">{sec.deals} deal{sec.deals !== 1 ? 's' : ''}</div>
                    </div>

                    {/* FII / DII / Other bars */}
                    <div className="w-44 shrink-0 flex flex-col gap-0.5">
                      {hasAnyFlow ? (
                        <>
                          {renderBar(sec.fiiNetCr, 'FII', 'text-blue-400')}
                          {renderBar(sec.diiNetCr, 'DII', 'text-amber-400')}
                          {renderBar(sec.otherNetCr, 'Oth', 'text-purple-400')}
                        </>
                      ) : (
                        <div className="h-6 bg-slate-800/60 rounded flex items-center justify-center">
                          <span className="text-[13px] text-slate-600">No classified flow</span>
                        </div>
                      )}
                    </div>

                    {/* Net value */}
                    <div className="w-20 shrink-0 text-right">
                      <div className={`text-[15px] font-bold ${signColor(sec.netCr)}`}>
                        {signPrefix(sec.netCr)}{fmtIN(Math.abs(sec.netCr))} Cr
                      </div>
                      <div className="text-[13px] text-slate-600">net flow</div>
                    </div>

                    {/* Delivery % */}
                    <div className="w-14 shrink-0 text-center">
                      {delivPct > 0 ? (
                        <div>
                          <span className={`text-[15px] font-bold ${
                            delivPct >= 50 ? 'text-emerald-400' : delivPct >= 35 ? 'text-slate-300' : 'text-red-400'
                          }`}>{delivPct}%</span>
                          <div className="text-[13px] text-slate-600">deliv</div>
                        </div>
                      ) : (
                        <span className="text-[13px] text-slate-600 italic">DM</span>
                      )}
                    </div>

                    {/* Signal / interpretation */}
                    <div className="flex-1 min-w-0 pl-2 border-l border-slate-700/30">
                      {signal ? (
                        <p className={`text-[13px] leading-snug ${signal.color}`}>{signal.text}</p>
                      ) : (
                        <p className="text-[13px] text-slate-700 italic">No delivery data available</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ---- Sector Strategy Insights ---- */}
          {(() => {
            const insights: { icon: string; title: string; detail: string; sentiment: 'bullish' | 'bearish' | 'neutral' | 'actionable' }[] = []

            // 1. FII/DII divergence
            const fiiInDiiOut = sectorBars.filter(s => s.fiiNetCr > 5 && s.diiNetCr < -5)
            const diiInFiiOut = sectorBars.filter(s => s.fiiNetCr < -5 && s.diiNetCr > 5)
            if (fiiInDiiOut.length > 0) {
              insights.push({
                icon: '🔀', title: 'FII Accumulation vs DII Exit',
                detail: `${fiiInDiiOut.map(s => `${s.sector} (FII +${fmtIN(s.fiiNetCr)} Cr, DII ${fmtIN(s.diiNetCr)} Cr)`).join(' | ')}. FPI flows are forward-looking — when FIIs buy what DIIs sell, it often signals re-rating ahead. DII selling into strength is typical profit-booking. Strategy: Look for MEAN REVERSION longs in these sectors on 15m pullbacks.`,
                sentiment: 'bullish'
              })
            }
            if (diiInFiiOut.length > 0) {
              const totalFiiExit = diiInFiiOut.reduce((s, x) => s + Math.abs(x.fiiNetCr), 0)
              const totalDiiAbsorb = diiInFiiOut.reduce((s, x) => s + x.diiNetCr, 0)
              const diiCoverage = totalFiiExit > 0 ? Math.round(totalDiiAbsorb / totalFiiExit * 100) : 0
              insights.push({
                icon: '🛡️', title: `DII Floor — ${diiCoverage}% FII Selling Absorbed`,
                detail: `${diiInFiiOut.map(s => `${s.sector} (FII -${fmtIN(Math.abs(s.fiiNetCr))} Cr, DII +${fmtIN(s.diiNetCr)} Cr)`).join(' | ')}. DII absorbing ${diiCoverage}% of FII outflow. ${diiCoverage >= 80 ? 'Strong floor — DII nearly fully absorbing FII exits. D1 support likely holds. Mean reversion long setup.' : diiCoverage >= 50 ? 'Partial floor — DII absorbing over half but gap remains. Expect range-bound action before direction.' : 'Weak floor — DII absorption insufficient. Further downside likely before equilibrium. Wait for D1 breakdown to confirm.'}`,
                sentiment: diiCoverage >= 80 ? 'actionable' : 'neutral'
              })
            }

            // 2. Dual conviction
            const bothBuying = sectorBars.filter(s => s.fiiNetCr > 5 && s.diiNetCr > 5)
            const bothSelling = sectorBars.filter(s => s.fiiNetCr < -5 && s.diiNetCr < -5)
            if (bothBuying.length > 0) {
              insights.push({
                icon: '🎯', title: 'Dual Institutional Conviction — Strongest Buy Signal',
                detail: `${bothBuying.map(s => `${s.sector}: FII +${fmtIN(s.fiiNetCr)} Cr + DII +${fmtIN(s.diiNetCr)} Cr = +${fmtIN(s.netCr)} Cr total`).join(' | ')}. Both foreign and domestic capital aligned — rarest and strongest setup. D1 support building with institutional floor on both sides. Strategy: Aggressive MEAN REVERSION longs on any dip; trend-following on breakout above recent high.`,
                sentiment: 'bullish'
              })
            }
            if (bothSelling.length > 0) {
              insights.push({
                icon: '🚨', title: 'Universal Exit — No Institutional Floor',
                detail: `${bothSelling.map(s => `${s.sector}: FII -${fmtIN(Math.abs(s.fiiNetCr))} Cr + DII -${fmtIN(Math.abs(s.diiNetCr))} Cr = ${fmtIN(s.netCr)} Cr`).join(' | ')}. Both FII and DII exiting — no institutional buyer to catch the fall. D1 support is broken or breaking. Strategy: Avoid new longs. If already long, tighten stops to D1 low. Short setups may form on pullback to broken support.`,
                sentiment: 'bearish'
              })
            }

            // 3. High delivery conviction
            const highDelivBuy = sectorBars.filter(s => (deliverySectors[s.sector]?.deliveryPct ?? 0) >= 50 && s.netCr > 5)
            const lowDelivSell = sectorBars.filter(s => { const dp = deliverySectors[s.sector]?.deliveryPct ?? 0; return dp > 0 && dp < 35 && s.netCr < -5 })
            if (highDelivBuy.length > 0) {
              insights.push({
                icon: '📦', title: 'High Delivery Accumulation — Holding Intent Confirmed',
                detail: `${highDelivBuy.map(s => `${s.sector} (${deliverySectors[s.sector]?.deliveryPct}% delivery, +${fmtIN(s.netCr)} Cr)`).join(' | ')}. Institutions are taking delivery, not flipping — these are swing/positional positions. This is the setup that precedes multi-week trends. Strategy: Enter on 5m/15m pullback to VWAP or BB mean; hold for D1 target. Stop below D1 low.`,
                sentiment: 'actionable'
              })
            }
            if (lowDelivSell.length > 0) {
              insights.push({
                icon: '⚡', title: 'Low Delivery Panic — Mean Reversion Bounce Expected',
                detail: `${lowDelivSell.map(s => `${s.sector} (${deliverySectors[s.sector]?.deliveryPct}% delivery, ${fmtIN(s.netCr)} Cr outflow)`).join(' | ')}. ${Math.round(100 - (deliverySectors[lowDelivSell[0].sector]?.deliveryPct ?? 30))}%+ was intraday — this is speculative panic, not conviction selling. Short-covering bounce likely within 1-2 sessions. Strategy: Watch for reversal candle on 15m chart; enter MEAN REVERSION long with tight stop at day low.`,
                sentiment: 'actionable'
              })
            }

            // 4. Rotation
            const topIn = sectorBars.filter(s => s.netCr > 5).slice(0, 3)
            const topOut = sectorBars.filter(s => s.netCr < -5).slice(0, 3)
            if (topIn.length > 0 && topOut.length > 0) {
              insights.push({
                icon: '🔄', title: 'Active Sector Rotation',
                detail: `Money flowing OUT of ${topOut.map(s => `${s.sector} (${fmtIN(s.netCr)} Cr)`).join(', ')} → INTO ${topIn.map(s => `${s.sector} (+${fmtIN(s.netCr)} Cr)`).join(', ')}. Institutions are reallocating, not de-risking. Strategy: Trade WITH the rotation — go long receiving sectors, avoid or short exiting sectors. The rotation direction typically persists for 5-10 sessions.`,
                sentiment: 'neutral'
              })
            }

            // 5. Breadth
            const active = sectorBars.filter(s => Math.abs(s.netCr) > 5)
            if (active.length <= 2 && active.length > 0) {
              insights.push({
                icon: '🔬', title: 'Narrow Institutional Focus',
                detail: `Flow concentrated in just ${active.map(s => `${s.sector} (${signPrefix(s.netCr)}${fmtIN(Math.abs(s.netCr))} Cr)`).join(' and ')}. This is stock-picking, not sector rotation. Only trade the names within these sectors that have deal activity. Everything else is noise.`,
                sentiment: 'neutral'
              })
            } else if (active.length >= 6) {
              const bullish = active.filter(s => s.netCr > 0).length
              const totalNet = active.reduce((s, x) => s + x.netCr, 0)
              insights.push({
                icon: '🌊', title: `Broad Participation — ${bullish}/${active.length} Sectors Net Positive`,
                detail: `Institutional activity across ${active.length} sectors with net ${totalNet > 0 ? '+' : ''}${fmtIN(totalNet)} Cr. ${bullish > active.length / 2 ? 'Majority positive — broad-based buying suggests market-wide confidence. Good environment for trend-following strategies.' : 'Majority negative — broad de-risking underway. Defensive positioning recommended; reduce exposure across the board.'}`,
                sentiment: bullish > active.length / 2 ? 'bullish' : 'bearish'
              })
            }

            // 6. VIX + flow combo
            if (s.indiaVix >= 20) {
              const netPositiveSectors = sectorBars.filter(s => s.netCr > 10)
              if (netPositiveSectors.length >= 3) {
                insights.push({
                  icon: '🧊', title: `Buying Into Fear — VIX at ${s.indiaVix.toFixed(1)} but ${netPositiveSectors.length} Sectors See Inflows`,
                  detail: `VIX elevated at ${s.indiaVix.toFixed(1)} (fear) yet institutions are accumulating in ${netPositiveSectors.map(x => x.sector).join(', ')}. Smart money buys when VIX is high — this is the classic "be greedy when others are fearful" setup. Strategy: High-conviction MEAN REVERSION longs in accumulation sectors. The VIX spike amplifies option premiums — consider selling puts in these sectors for income.`,
                  sentiment: 'actionable'
                })
              }
            }

            if (insights.length === 0) return null
            return (
              <div className="mt-4 pt-4 border-t border-slate-600/40">
                <h4 className="text-[15px] font-bold text-white mb-3">Sector Strategy Signals</h4>
                <div className="space-y-2">
                  {insights.map((inf, i) => (
                    <div key={i} className={`rounded-lg border px-4 py-3 ${
                      inf.sentiment === 'bullish' ? 'bg-emerald-500/5 border-emerald-500/20' :
                      inf.sentiment === 'bearish' ? 'bg-red-500/5 border-red-500/20' :
                      inf.sentiment === 'actionable' ? 'bg-blue-500/5 border-blue-500/20' :
                      'bg-slate-700/20 border-slate-600/20'
                    }`}>
                      <div className="flex items-start gap-2.5">
                        <span className="text-lg shrink-0">{inf.icon}</span>
                        <div>
                          <div className={`text-[15px] font-bold mb-1 ${
                            inf.sentiment === 'bullish' ? 'text-emerald-300' :
                            inf.sentiment === 'bearish' ? 'text-red-300' :
                            inf.sentiment === 'actionable' ? 'text-blue-300' :
                            'text-slate-300'
                          }`}>{inf.title}</div>
                          <p className="text-[13px] text-slate-400 leading-relaxed">{inf.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ===== 7. KEY INSIGHTS (collapsible, first 3 visible) ===== */}
      {insights && insights.inferences.length > 0 && (
        <div className="card">
          <h3 className="text-[15px] font-semibold text-white mb-3">
            Key Insights <span className="text-[13px] text-slate-500 font-normal">({insights.inferences.length})</span>
          </h3>
          <div className="space-y-1.5">
            {insights.inferences.map((inf, i) => {
              const isExpanded = expandedInsight === i
              const isVisible = i < 3 || openSections['allInsights']
              if (!isVisible) return null
              return (
                <button key={i} onClick={() => setExpandedInsight(isExpanded ? null : i)}
                  className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                    inf.sentiment === 'bullish' ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10' :
                    inf.sentiment === 'bearish' ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10' :
                    'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
                  }`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] shrink-0">{inf.icon}</span>
                    <span className={`font-semibold text-[13px] flex-1 ${
                      inf.sentiment === 'bullish' ? 'text-emerald-400' :
                      inf.sentiment === 'bearish' ? 'text-red-400' : 'text-white'
                    }`}>{inf.label}</span>
                    <span className={`text-[13px] text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>&#9662;</span>
                  </div>
                  {isExpanded && (
                    <p className="text-[15px] text-slate-300 leading-relaxed mt-1.5 pl-6">{inf.detail}</p>
                  )}
                </button>
              )
            })}
          </div>
          {insights.inferences.length > 3 && !openSections['allInsights'] && (
            <button onClick={() => toggleSection('allInsights')}
              className="mt-2 w-full py-1.5 text-[15px] text-slate-400 hover:text-white bg-slate-700/40 hover:bg-slate-700 rounded-lg transition-colors">
              Show All {insights.inferences.length} Insights
            </button>
          )}
          {openSections['allInsights'] && insights.inferences.length > 3 && (
            <button onClick={() => toggleSection('allInsights')}
              className="mt-2 w-full py-1.5 text-[15px] text-slate-400 hover:text-white bg-slate-700/40 hover:bg-slate-700 rounded-lg transition-colors">
              Show Less
            </button>
          )}
        </div>
      )}

      {/* ===== 8. FII/DII FLOWS ===== */}
      <div className="card">
        <h3 className="text-[15px] font-semibold text-white mb-3">
          FII / DII Flows
        </h3>
        {fiiDii.length === 0 ? (
          <p className="text-[15px] text-slate-500 italic">DM</p>
        ) : (
          <>
            {/* Today's summary cards — uses latest available trading day data */}
            {(() => {
              const latest = fiiDii[0]
              const fii = latest?.FII
              const dii = latest?.DII
              const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
              const istDateStr = istNow.toISOString().slice(0, 10)
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              const todayStr = `${istNow.getUTCDate()} ${months[istNow.getUTCMonth()]}'${String(istNow.getUTCFullYear()).slice(2)}`
              const dataDateStr = latest?._date ? fmtDate(latest._date) : null
              const isSameDay = latest?._date === istDateStr
              return (
                <div className="mb-4">
                  <div className="text-[13px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                    Today — {todayStr}
                    {!isSameDay && dataDateStr && (
                      <span className="normal-case ml-2 text-slate-600 font-normal">(market closed — showing data from {dataDateStr})</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <div className={`rounded-lg border p-2.5 text-center ${signBg(fii?.netValue ?? 0)}`}>
                      <div className="text-[13px] text-slate-400">FII Net</div>
                      <div className={`text-[15px] font-bold ${signColor(fii?.netValue ?? 0)}`}>
                        {signPrefix(fii?.netValue ?? 0)}{fmtIN(Math.abs(fii?.netValue ?? 0))} Cr
                      </div>
                    </div>
                    <div className={`rounded-lg border p-2.5 text-center ${signBg(dii?.netValue ?? 0)}`}>
                      <div className="text-[13px] text-slate-400">DII Net</div>
                      <div className={`text-[15px] font-bold ${signColor(dii?.netValue ?? 0)}`}>
                        {signPrefix(dii?.netValue ?? 0)}{fmtIN(Math.abs(dii?.netValue ?? 0))} Cr
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-600/30 bg-slate-700/30 p-2.5 text-center">
                      <div className="text-[13px] text-slate-400">FII Buy</div>
                      <div className="text-[15px] font-bold text-white">{fmtIN(fii?.buyValue ?? 0)} Cr</div>
                    </div>
                    <div className="rounded-lg border border-slate-600/30 bg-slate-700/30 p-2.5 text-center">
                      <div className="text-[13px] text-slate-400">FII Sell</div>
                      <div className="text-[15px] font-bold text-white">{fmtIN(fii?.sellValue ?? 0)} Cr</div>
                    </div>
                    <div className="rounded-lg border border-slate-600/30 bg-slate-700/30 p-2.5 text-center">
                      <div className="text-[13px] text-slate-400">DII Buy</div>
                      <div className="text-[15px] font-bold text-white">{fmtIN(dii?.buyValue ?? 0)} Cr</div>
                    </div>
                    <div className="rounded-lg border border-slate-600/30 bg-slate-700/30 p-2.5 text-center">
                      <div className="text-[13px] text-slate-400">DII Sell</div>
                      <div className="text-[15px] font-bold text-white">{fmtIN(dii?.sellValue ?? 0)} Cr</div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Last 5 trading days table */}
            <div className="text-[13px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
              Last {fiiDii.length} trading days
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 text-[13px] text-slate-400 uppercase">Date</th>
                  <th className="text-right py-2 text-[13px] text-slate-400 uppercase">FII Buy</th>
                  <th className="text-right py-2 text-[13px] text-slate-400 uppercase">FII Sell</th>
                  <th className="text-right py-2 text-[13px] text-slate-400 uppercase">FII Net</th>
                  <th className="text-right py-2 text-[13px] text-slate-400 uppercase">DII Buy</th>
                  <th className="text-right py-2 text-[13px] text-slate-400 uppercase">DII Sell</th>
                  <th className="text-right py-2 text-[13px] text-slate-400 uppercase">DII Net</th>
                </tr>
              </thead>
              <tbody>
                {fiiDii.map((day, i) => (
                  <tr key={i} className={`border-b border-slate-700/30 ${i === 0 ? 'bg-slate-700/20' : ''}`}>
                    <td className="py-2 text-white text-[13px]">
                      {fmtDate(day._date)}
                      {i === 0 && <span className="ml-1.5 text-[15px] text-slate-500 uppercase">latest</span>}
                    </td>
                    <td className="text-right py-2 text-white text-[13px]">{fmtIN(day.FII?.buyValue ?? 0)}</td>
                    <td className="text-right py-2 text-white text-[13px]">{fmtIN(day.FII?.sellValue ?? 0)}</td>
                    <td className={`text-right py-2 text-[13px] font-bold ${signColor(day.FII?.netValue ?? 0)}`}>
                      {signPrefix(day.FII?.netValue ?? 0)}{fmtIN(Math.abs(day.FII?.netValue ?? 0))}
                    </td>
                    <td className="text-right py-2 text-white text-[13px]">{fmtIN(day.DII?.buyValue ?? 0)}</td>
                    <td className="text-right py-2 text-white text-[13px]">{fmtIN(day.DII?.sellValue ?? 0)}</td>
                    <td className={`text-right py-2 text-[13px] font-bold ${signColor(day.DII?.netValue ?? 0)}`}>
                      {signPrefix(day.DII?.netValue ?? 0)}{fmtIN(Math.abs(day.DII?.netValue ?? 0))}
                    </td>
                  </tr>
                ))}
                {/* 5-day total row */}
                {fiiDii.length > 1 && (() => {
                  const totFiiBuy = fiiDii.reduce((s, d) => s + (d.FII?.buyValue ?? 0), 0)
                  const totFiiSell = fiiDii.reduce((s, d) => s + (d.FII?.sellValue ?? 0), 0)
                  const totFiiNet = fiiDii.reduce((s, d) => s + (d.FII?.netValue ?? 0), 0)
                  const totDiiBuy = fiiDii.reduce((s, d) => s + (d.DII?.buyValue ?? 0), 0)
                  const totDiiSell = fiiDii.reduce((s, d) => s + (d.DII?.sellValue ?? 0), 0)
                  const totDiiNet = fiiDii.reduce((s, d) => s + (d.DII?.netValue ?? 0), 0)
                  return (
                    <tr className="border-t-2 border-slate-600">
                      <td className="py-2 text-[13px] font-bold text-slate-300">{fiiDii.length}-Day Total</td>
                      <td className="text-right py-2 text-[13px] font-semibold text-slate-300">{fmtIN(totFiiBuy)}</td>
                      <td className="text-right py-2 text-[13px] font-semibold text-slate-300">{fmtIN(totFiiSell)}</td>
                      <td className={`text-right py-2 text-[13px] font-bold ${signColor(totFiiNet)}`}>
                        {signPrefix(totFiiNet)}{fmtIN(Math.abs(totFiiNet))}
                      </td>
                      <td className="text-right py-2 text-[13px] font-semibold text-slate-300">{fmtIN(totDiiBuy)}</td>
                      <td className="text-right py-2 text-[13px] font-semibold text-slate-300">{fmtIN(totDiiSell)}</td>
                      <td className={`text-right py-2 text-[13px] font-bold ${signColor(totDiiNet)}`}>
                        {signPrefix(totDiiNet)}{fmtIN(Math.abs(totDiiNet))}
                      </td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      {/* ===== 9. DEAL DATA (always expanded) ===== */}
      <div className="card">
        <h3 className="text-[15px] font-semibold text-white mb-4">
          Deal Data
          <span className="text-[13px] text-slate-500 font-normal ml-2">
            Block Deals ({blockDeals.length}) + Bulk Deals ({bulkDeals.length})
          </span>
        </h3>
        <div>
            {/* Tab buttons */}
            <div className="flex gap-1 mb-3">
              <button onClick={() => setDealTab('block')}
                className={`px-4 py-1.5 rounded text-[13px] font-medium transition-colors ${
                  dealTab === 'block' ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}>
                Block ({blockDeals.length})
              </button>
              <button onClick={() => setDealTab('bulk')}
                className={`px-4 py-1.5 rounded text-[13px] font-medium transition-colors ${
                  dealTab === 'bulk' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}>
                Bulk ({bulkDeals.length})
              </button>
              {dealTab === 'bulk' && (
                <div className="flex gap-1 ml-auto">
                  {(['all', 'buy', 'sell'] as const).map(f => (
                    <button key={f} onClick={() => setBlockFilter(f)}
                      className={`px-3 py-1 rounded text-[13px] font-medium transition-colors ${
                        blockFilter === f
                          ? f === 'buy' ? 'bg-emerald-500/20 text-emerald-400'
                            : f === 'sell' ? 'bg-red-500/20 text-red-400'
                            : 'bg-blue-500/20 text-blue-400'
                          : 'bg-slate-700 text-slate-400 hover:text-white'
                      }`}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Block Deals Table */}
            {dealTab === 'block' && (
              blockDeals.length === 0 ? (
                <p className="text-[15px] text-slate-500 italic py-6 text-center">DM</p>
              ) : (
                <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
                  <table className="w-full text-[15px]">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 text-slate-400">Date</th>
                        <th className="text-left py-2 text-slate-400">Symbol</th>
                        <th className="text-left py-2 text-slate-400">Client</th>
                        <th className="text-center py-2 text-slate-400">B/S</th>
                        <th className="text-right py-2 text-slate-400">Qty</th>
                        <th className="text-right py-2 text-slate-400">Price</th>
                        <th className="text-right py-2 text-slate-400">Value (Cr)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockDeals.map((d, i) => (
                        <tr key={i} className="border-b border-slate-700/30">
                          <td className="py-1.5 text-slate-400 whitespace-nowrap">{d.date || fmtDate(d._date)}</td>
                          <td className="py-1.5 font-medium text-white">
                            <div className="flex items-center gap-1.5">
                              {d.symbol}
                              <ConvictionBadge symbol={d.symbol} compact />
                            </div>
                          </td>
                          <td className="py-1.5 text-slate-300 text-[13px] max-w-[180px] truncate" title={d.clientName}>{d.clientName}</td>
                          <td className={`text-center py-1.5 font-medium ${d.buySell === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{d.buySell}</td>
                          <td className="text-right py-1.5 text-slate-300">{(d.quantity ?? 0).toLocaleString('en-IN')}</td>
                          <td className="text-right py-1.5 text-white">{fmtNum(d.price, 0)}</td>
                          <td className="text-right py-1.5 text-slate-300">{d.valueCr ?? fmtCr(d.quantity * d.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* Bulk Deals Table */}
            {dealTab === 'bulk' && (
              filteredBulk.length === 0 ? (
                <p className="text-[15px] text-slate-500 italic py-6 text-center">DM</p>
              ) : (
                <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
                  <table className="w-full text-[15px]">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 text-slate-400">Date</th>
                        <th className="text-left py-2 text-slate-400">Symbol</th>
                        <th className="text-left py-2 text-slate-400">Client</th>
                        <th className="text-center py-2 text-slate-400">Side</th>
                        <th className="text-right py-2 text-slate-400">Qty</th>
                        <th className="text-right py-2 text-slate-400">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBulk.slice(0, 50).map((d, i) => (
                        <tr key={i} className="border-b border-slate-700/30">
                          <td className="py-1.5 text-slate-400 whitespace-nowrap">{fmtDate(d._date)}</td>
                          <td className="py-1.5 font-medium text-white">
                            <div className="flex items-center gap-1.5">
                              {d.symbol}
                              <ConvictionBadge symbol={d.symbol} compact />
                            </div>
                          </td>
                          <td className="py-1.5 text-slate-300 max-w-[150px] truncate">{d.clientName}</td>
                          <td className="text-center py-1.5">
                            <span className={`px-2 py-0.5 rounded text-[13px] font-bold ${
                              d.buySell === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {d.buySell}
                            </span>
                          </td>
                          <td className="text-right py-1.5 text-slate-300">{(d.quantity ?? 0).toLocaleString('en-IN')}</td>
                          <td className="text-right py-1.5 text-slate-300">{d.valueCr ? `${d.valueCr} Cr` : 'DM'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredBulk.length > 50 && (
                    <p className="text-[13px] text-slate-500 mt-2 text-center py-1">
                      Showing 50 of {filteredBulk.length} bulk deals
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          {/* Deal Analysis Inferences */}
          {insights && (blockDeals.length > 0 || bulkDeals.length > 0) && (() => {
            const analysis: { icon: string; title: string; detail: string; sentiment: 'bullish' | 'bearish' | 'neutral' | 'warning' }[] = []
            const f = fmtIN

            // 1. Heavy one-sided block deals (>50 Cr) — PE exits, strategic plays
            const bigBlocks = blockDeals.filter(d => (d.valueCr || 0) >= 50)
            const bigSells = bigBlocks.filter(d => d.buySell === 'SELL')
            const bigBuys = bigBlocks.filter(d => d.buySell === 'BUY')
            if (bigSells.length > 0) {
              const totalSellCr = bigSells.reduce((s, d) => s + (d.valueCr || 0), 0)
              const uniqueSyms = [...new Set(bigSells.map(d => d.symbol))]
              const clientNames = [...new Set(bigSells.map(d => d.clientName).filter(Boolean))]
              const isForeign = clientNames.some(c => /goldman|morgan|citi|jpmorgan|hsbc|ubs|barclays|nomura|clsa|fpi|foreign|singapore|mauritius|blackrock|vanguard/i.test(c || ''))
              analysis.push({
                icon: '🔴',
                title: `Large Block Sell-offs: ${f(totalSellCr)} Cr across ${uniqueSyms.length} stock(s)`,
                detail: `${uniqueSyms.join(', ')} saw ${bigSells.length} block sell deal(s) exceeding 50 Cr each. ` +
                  `Sellers: ${clientNames.slice(0, 3).join(', ')}${clientNames.length > 3 ? ` +${clientNames.length - 3} more` : ''}. ` +
                  (isForeign
                    ? 'Foreign institutional seller(s) involved — likely FPI portfolio rebalancing or mandate-driven exit. Not necessarily a bearish signal on the company; often reflects fund-level allocation changes or profit booking.'
                    : 'Domestic seller(s) — could indicate promoter stake sale, PE exit, or pre-planned cross-trade. Check if there is a corresponding buyer at the same price (negotiated block) vs. market-dump.'),
                sentiment: 'bearish'
              })
            }
            if (bigBuys.length > 0) {
              const totalBuyCr = bigBuys.reduce((s, d) => s + (d.valueCr || 0), 0)
              const uniqueSyms = [...new Set(bigBuys.map(d => d.symbol))]
              const clientNames = [...new Set(bigBuys.map(d => d.clientName).filter(Boolean))]
              analysis.push({
                icon: '🟢',
                title: `Large Block Accumulation: ${f(totalBuyCr)} Cr into ${uniqueSyms.length} stock(s)`,
                detail: `${uniqueSyms.join(', ')} saw ${bigBuys.length} block buy deal(s) exceeding 50 Cr each by ${clientNames.slice(0, 3).join(', ')}. ` +
                  'Large block buys at negotiated prices signal strategic conviction — the buyer accepted a single large lot rather than accumulating quietly on market. This is typically PE entry, fund mandate allocation, or promoter group consolidation.',
                sentiment: 'bullish'
              })
            }

            // 2. Same stock with both BUY and SELL block deals — negotiated crosses
            const blockSymCounts: Record<string, { buys: number; sells: number; buyClients: string[]; sellClients: string[] }> = {}
            for (const d of blockDeals) {
              if (!blockSymCounts[d.symbol]) blockSymCounts[d.symbol] = { buys: 0, sells: 0, buyClients: [], sellClients: [] }
              if (d.buySell === 'BUY') { blockSymCounts[d.symbol].buys++; blockSymCounts[d.symbol].buyClients.push(d.clientName || '') }
              else { blockSymCounts[d.symbol].sells++; blockSymCounts[d.symbol].sellClients.push(d.clientName || '') }
            }
            const crossDeals = Object.entries(blockSymCounts).filter(([, v]) => v.buys > 0 && v.sells > 0)
            if (crossDeals.length > 0) {
              analysis.push({
                icon: '🔄',
                title: `Negotiated Block Crosses in ${crossDeals.length} stock(s)`,
                detail: crossDeals.map(([sym, v]) => {
                  const sameClient = v.buyClients.some(bc => v.sellClients.includes(bc))
                  return `${sym}: ${v.buys} buy + ${v.sells} sell block(s). ` +
                    (sameClient
                      ? 'SAME client on both sides — likely internal restructuring, fund-to-fund transfer, or entity migration. NOT a genuine change of ownership.'
                      : `Buyer: ${v.buyClients[0]?.slice(0, 30) || 'Unknown'} ← Seller: ${v.sellClients[0]?.slice(0, 30) || 'Unknown'}. Negotiated handover at agreed price.`)
                }).join(' | '),
                sentiment: 'neutral'
              })
            }

            // 3. Bulk deal patterns — heavy selling across many stocks = risk-off
            const bulkSellCount = bulkDeals.filter(d => d.buySell === 'SELL').length
            const bulkBuyCount = bulkDeals.filter(d => d.buySell === 'BUY').length
            if (bulkDeals.length > 20) {
              const sellRatio = bulkSellCount / bulkDeals.length
              if (sellRatio > 0.65) {
                analysis.push({
                  icon: '📉',
                  title: `Bulk Deal Bias: ${Math.round(sellRatio * 100)}% Selling (${bulkSellCount} sells vs ${bulkBuyCount} buys)`,
                  detail: `Out of ${bulkDeals.length} bulk deals, ${bulkSellCount} are sells — heavily skewed toward distribution. ` +
                    'When bulk deals are predominantly sell-side, it indicates broad-based offloading by insiders, promoters, or early investors. ' +
                    'This is a confidence-loss signal especially if the selling is in mid/small-caps where liquidity is thin.',
                  sentiment: 'bearish'
                })
              } else if (sellRatio < 0.35) {
                analysis.push({
                  icon: '📈',
                  title: `Bulk Deal Bias: ${Math.round((1 - sellRatio) * 100)}% Buying (${bulkBuyCount} buys vs ${bulkSellCount} sells)`,
                  detail: `Out of ${bulkDeals.length} bulk deals, ${bulkBuyCount} are buys — strong accumulation bias. ` +
                    'Buy-heavy bulk deals indicate insiders, promoter groups, or MFs accumulating at market prices rather than negotiated blocks. ' +
                    'Willingness to buy in open market suggests conviction that current prices are attractive.',
                  sentiment: 'bullish'
                })
              }
            }

            // 4. Repeat symbols across multiple days — stealth accumulation/distribution
            const multiDaySyms = insights.repeatSymbols.filter(s => s.dateCount >= 3)
            if (multiDaySyms.length > 0) {
              analysis.push({
                icon: '🔍',
                title: `Stealth Activity: ${multiDaySyms.length} stock(s) with deals on 3+ days`,
                detail: multiDaySyms.slice(0, 5).map(s =>
                  `${s.symbol}: deals on ${s.dateCount} separate days, net ${s.netCr > 0 ? '+' : ''}${f(s.netCr)} Cr (${s.sector})`
                ).join('. ') + '. Multi-day deal activity in the same stock is the strongest signal of deliberate institutional positioning — ' +
                  'they are building/unwinding a position over time to minimize market impact. The net direction (buy vs sell) reveals their intent.',
                sentiment: 'neutral'
              })
            }

            // 5. Event-linked deals — pre-earnings positioning
            const eventDeals = insights.eventsWithDeals
            if (eventDeals.length > 0) {
              const earningsLinked = eventDeals.filter(e =>
                e.purpose?.toLowerCase().includes('result') || e.purpose?.toLowerCase().includes('financial')
              )
              if (earningsLinked.length > 0) {
                const syms = earningsLinked.map(e => e.symbol)
                const symCards = insights.symbolCards.filter(sc => syms.includes(sc.symbol))
                const netBuying = symCards.filter(sc => sc.netCr > 0)
                const netSelling = symCards.filter(sc => sc.netCr < 0)
                analysis.push({
                  icon: '📋',
                  title: `Pre-Earnings Deal Activity: ${earningsLinked.length} stock(s) with upcoming results`,
                  detail: `${earningsLinked.map(e => `${e.symbol} (${e.date})`).join(', ')} have board meetings for financial results AND active deal flow. ` +
                    (netBuying.length > 0 ? `Net buying in ${netBuying.map(s => s.symbol).join(', ')} — could indicate informed optimism or pre-positioning. ` : '') +
                    (netSelling.length > 0 ? `Net selling in ${netSelling.map(s => s.symbol).join(', ')} — possible de-risking before results or informed caution. ` : '') +
                    'Deal activity ahead of earnings is NOT necessarily insider trading — MFs often rebalance around earnings dates — but the direction is worth noting.',
                  sentiment: 'warning'
                })
              }
            }

            // 6. Foreign vs domestic flow direction
            if (insights.foreignClients.length > 0 && insights.domesticClients.length > 0) {
              const foreignNet = insights.foreignBuyCr - insights.foreignSellCr
              const domesticNet = insights.domesticBuyCr - insights.domesticSellCr
              if ((foreignNet > 0 && domesticNet < 0) || (foreignNet < 0 && domesticNet > 0)) {
                analysis.push({
                  icon: '⚔️',
                  title: `FII/DII Divergence in Deals: ${foreignNet > 0 ? 'FII buying' : 'FII selling'} vs ${domesticNet > 0 ? 'DII buying' : 'DII selling'}`,
                  detail: `Foreign entities: net ${foreignNet > 0 ? '+' : ''}${f(foreignNet)} Cr. Domestic entities: net ${domesticNet > 0 ? '+' : ''}${f(domesticNet)} Cr. ` +
                    (foreignNet > 0
                      ? 'FIIs are accumulating stocks that DIIs are selling — this often indicates FIIs see value that domestic players are overlooking, or DIIs are booking profits into FII demand. Historically, FII-led accumulation at deal level (not just index) tends to be more forward-looking.'
                      : 'DIIs are absorbing what FIIs are dumping — domestic institutions are providing a floor. The key question: is DII buying conviction-driven or mandate-driven (SIP/insurance flows that must be deployed)? If the latter, the floor may not hold if FII selling intensifies.'),
                  sentiment: foreignNet > 0 ? 'bullish' : 'neutral'
                })
              }
            }

            // 7. Concentration analysis — few stocks dominating deal flow
            if (insights.symbolCards.length >= 5) {
              const top3Value = insights.symbolCards.slice(0, 3).reduce((s, c) => s + c.totalCr, 0)
              const totalValue = insights.grandTotalCr
              const concentrationPct = totalValue > 0 ? (top3Value / totalValue * 100) : 0
              if (concentrationPct > 60) {
                const top3 = insights.symbolCards.slice(0, 3)
                analysis.push({
                  icon: '🎯',
                  title: `Highly Concentrated: Top 3 stocks = ${Math.round(concentrationPct)}% of all deal value`,
                  detail: `${top3.map(s => `${s.symbol} (${f(s.totalCr)} Cr)`).join(', ')} dominate deal flow. ` +
                    `Remaining ${insights.symbolCards.length - 3} stocks share only ${Math.round(100 - concentrationPct)}%. ` +
                    'Concentrated deal flow means institutional interest is narrow — not a broad market rotation. Trade only in the names where capital is actually flowing; the rest are noise.',
                  sentiment: 'neutral'
                })
              }
            }

            if (analysis.length === 0) return null
            return (
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <div className="text-[13px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Deal Analysis</div>
                <div className="space-y-2">
                  {analysis.map((a, i) => (
                    <div key={i} className={`rounded-lg px-3 py-2.5 border ${
                      a.sentiment === 'bullish' ? 'bg-emerald-500/5 border-emerald-500/15' :
                      a.sentiment === 'bearish' ? 'bg-red-500/5 border-red-500/15' :
                      a.sentiment === 'warning' ? 'bg-amber-500/5 border-amber-500/15' :
                      'bg-slate-700/20 border-slate-600/20'
                    }`}>
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 text-[15px] mt-0.5">{a.icon}</span>
                        <div>
                          <div className={`text-[13px] font-semibold mb-1 ${
                            a.sentiment === 'bullish' ? 'text-emerald-300' :
                            a.sentiment === 'bearish' ? 'text-red-300' :
                            a.sentiment === 'warning' ? 'text-amber-300' :
                            'text-slate-300'
                          }`}>{a.title}</div>
                          <div className="text-[13px] text-slate-400 leading-relaxed">{a.detail}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
      </div>

      {/* ===== 10. WHO BOUGHT WHAT (always expanded) ===== */}
      {insights && insights.topClients.length > 0 && (
        <div className="card">
          <h3 className="text-[15px] font-semibold text-white mb-4">
            Institutional Activity <span className="text-[13px] text-slate-500 font-normal">({insights.topClients.length} entities)</span>
          </h3>
          <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 text-slate-400">Fund / Entity</th>
                    <th className="text-center py-2 text-slate-400">Type</th>
                    <th className="text-right py-2 text-slate-400">Bought (Cr)</th>
                    <th className="text-right py-2 text-slate-400">Sold (Cr)</th>
                    <th className="text-right py-2 text-slate-400">Net (Cr)</th>
                    <th className="text-left py-2 text-slate-400 pl-3">Stocks Bought</th>
                    <th className="text-left py-2 text-slate-400 pl-3">Stocks Sold</th>
                    <th className="text-right py-2 text-slate-400">Deals</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.topClients.map((c, i) => {
                    const netCr = c.buyCr - c.sellCr
                    return (
                      <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-800/40">
                        <td className="py-2 text-white max-w-[200px] truncate font-medium" title={c.name}>{c.name}</td>
                        <td className="text-center py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[13px] font-bold ${
                            c.type === 'foreign' ? 'bg-blue-500/20 text-blue-400' :
                            c.type === 'domestic' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-slate-600/30 text-slate-400'
                          }`}>
                            {c.type === 'foreign' ? 'FPI' : c.type === 'domestic' ? 'DII' : 'OTH'}
                          </span>
                        </td>
                        <td className="text-right py-2 text-emerald-400 font-medium">{c.buyCr > 0 ? fmtIN(c.buyCr) : '-'}</td>
                        <td className="text-right py-2 text-red-400 font-medium">{c.sellCr > 0 ? fmtIN(c.sellCr) : '-'}</td>
                        <td className={`text-right py-2 font-bold ${netCr > 0 ? 'text-emerald-400' : netCr < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {netCr > 0 ? '+' : ''}{fmtIN(netCr)}
                        </td>
                        <td className="py-2 pl-3">
                          <div className="flex flex-wrap gap-1">
                            {c.buySymbols.slice(0, 5).map(sym => (
                              <span key={sym} className="px-1.5 py-0.5 bg-emerald-500/10 rounded text-[13px] text-emerald-400">{sym}</span>
                            ))}
                            {c.buySymbols.length > 5 && <span className="text-[13px] text-slate-500">+{c.buySymbols.length - 5}</span>}
                          </div>
                        </td>
                        <td className="py-2 pl-3">
                          <div className="flex flex-wrap gap-1">
                            {c.sellSymbols.slice(0, 5).map(sym => (
                              <span key={sym} className="px-1.5 py-0.5 bg-red-500/10 rounded text-[13px] text-red-400">{sym}</span>
                            ))}
                            {c.sellSymbols.length > 5 && <span className="text-[13px] text-slate-500">+{c.sellSymbols.length - 5}</span>}
                          </div>
                        </td>
                        <td className="text-right py-2 text-slate-400">{c.dealCount}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
          </div>
        </div>
      )}

      {/* ===== 11. STOCK BREAKDOWN (always expanded) ===== */}
      {insights && insights.symbolCards.length > 0 && (
        <div className="card">
          <h3 className="text-[15px] font-semibold text-white mb-4">
            Stock-Level Analysis <span className="text-[13px] text-slate-500 font-normal">({insights.symbolCards.length} stocks)</span>
          </h3>
          <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {insights.symbolCards.slice(0, 12).map((card) => (
                  <div key={card.symbol} className="rounded-lg border border-slate-700 bg-slate-800/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-[15px]">{card.symbol}</span>
                        <ConvictionBadge symbol={card.symbol} compact />
                        {card.inBlock && <span className="text-[15px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">BLK</span>}
                        {card.inBulk && <span className="text-[15px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">BULK</span>}
                      </div>
                      <span className={`text-[13px] font-bold px-1.5 py-0.5 rounded ${
                        card.netCr > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        Net {card.netCr > 0 ? '+' : ''}{fmtIN(card.netCr)} Cr
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 text-[13px] mb-1.5">
                      {card.inBlock && (
                        <>
                          <div><span className="text-slate-500">Block Buy: </span><span className="text-emerald-400">{fmtIN(card.blockBuyCr)} Cr</span></div>
                          <div><span className="text-slate-500">Block Sell: </span><span className="text-red-400">{fmtIN(card.blockSellCr)} Cr</span></div>
                        </>
                      )}
                      {card.inBulk && (
                        <>
                          <div><span className="text-slate-500">Bulk Buy: </span><span className="text-emerald-400">{fmtIN(card.bulkBuyCr)} Cr</span></div>
                          <div><span className="text-slate-500">Bulk Sell: </span><span className="text-red-400">{fmtIN(card.bulkSellCr)} Cr</span></div>
                        </>
                      )}
                    </div>
                    <div className="text-[13px] text-slate-500 mb-1">
                      {card.blockDeals > 0 && <span className="mr-2">{card.blockDeals} block deal(s)</span>}
                      {card.bulkDeals > 0 && <span>{card.bulkDeals} bulk deal(s)</span>}
                    </div>
                    {card.clients.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {card.clients.slice(0, 4).map((c, ci) => (
                          <span key={ci} className="text-[15px] px-1 py-0.5 bg-slate-700/60 rounded text-slate-400" title={c}>
                            {c.length > 25 ? c.slice(0, 25) + '...' : c}
                          </span>
                        ))}
                        {card.clients.length > 4 && <span className="text-[15px] text-slate-600">+{card.clients.length - 4}</span>}
                      </div>
                    )}
                    {card.event && (
                      <div className="mt-1.5 pt-1.5 border-t border-slate-700/40 text-[13px]">
                        <span className="text-amber-400 font-medium">Event: </span>
                        <span className="text-slate-400">{card.event.purpose} on {card.event.date}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {insights.symbolCards.length > 12 && (
                <p className="text-[13px] text-slate-500 mt-2 text-center">
                  Showing top 12 of {insights.symbolCards.length} stocks by deal value
                </p>
              )}
          </div>
        </div>
      )}

      {/* ===== 12. EVENT-DEAL CROSSREF (always expanded) ===== */}
      {insights && insights.eventsWithDeals.length > 0 && (
        <div className="card">
          <h3 className="text-[15px] font-semibold text-white mb-4">
            Events With Active Deals <span className="text-[13px] text-amber-400 font-normal">({insights.eventsWithDeals.length} matches)</span>
          </h3>
          <div className="space-y-2">
              {insights.eventsWithDeals.map((e, i) => {
                const symData = insights.symbolCards.find(sc => sc.symbol === e.symbol)
                return (
                  <div key={i} className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-amber-400 text-[15px]">{e.symbol}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[13px] font-medium ${
                          e.purpose?.toLowerCase().includes('result') || e.purpose?.toLowerCase().includes('financial')
                            ? 'bg-blue-500/20 text-blue-400'
                            : e.purpose?.toLowerCase().includes('dividend')
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-slate-600/30 text-slate-300'
                        }`}>{e.purpose}</span>
                        <span className="text-[13px] text-slate-500">{e.date}</span>
                      </div>
                      <p className="text-[13px] text-slate-400 mt-0.5">{e.description}</p>
                    </div>
                    {symData && (
                      <div className="text-right shrink-0">
                        <div className={`text-[13px] font-bold ${symData.netCr > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {symData.netCr > 0 ? '+' : ''}{fmtIN(symData.netCr)} Cr
                        </div>
                        <div className="text-[13px] text-slate-500">{symData.blockDeals + symData.bulkDeals} deal(s)</div>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* ===== 13. CORPORATE EVENTS (always expanded) ===== */}
      <div className="card">
        <h3 className="text-[15px] font-semibold text-white mb-4">
          Corporate Events <span className="text-[13px] text-slate-500 font-normal">({corpEvents.length})</span>
        </h3>
        {corpEvents.length === 0 ? (
          <p className="text-[15px] text-slate-500 italic py-6 text-center">DM</p>
        ) : (
          <div>
              <div className="overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 text-slate-400">Date</th>
                      <th className="text-left py-2 text-slate-400">Symbol</th>
                      <th className="text-left py-2 text-slate-400">Purpose</th>
                      <th className="text-left py-2 text-slate-400">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEvents.map((e, i) => (
                      <tr key={i} className="border-b border-slate-700/30">
                        <td className="py-1.5 text-white whitespace-nowrap">{fmtDate(e.date)}</td>
                        <td className="py-1.5 font-medium text-amber-400">{e.symbol}</td>
                        <td className="py-1.5 text-slate-300">
                          <span className={`px-2 py-0.5 rounded text-[13px] font-medium ${
                            e.purpose?.toLowerCase().includes('result') || e.purpose?.toLowerCase().includes('financial')
                              ? 'bg-blue-500/20 text-blue-400'
                              : e.purpose?.toLowerCase().includes('dividend')
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : e.purpose?.toLowerCase().includes('fund') || e.purpose?.toLowerCase().includes('buyback')
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-slate-600/30 text-slate-300'
                          }`}>
                            {e.purpose}
                          </span>
                        </td>
                        <td className="py-1.5 text-slate-400 max-w-xs truncate">{e.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sortedEvents.length > 10 && (
                <button onClick={() => setEventsShowAll(!eventsShowAll)}
                  className="mt-3 w-full py-2 text-[15px] text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors">
                  {eventsShowAll ? `Show Less (10 of ${sortedEvents.length})` : `Show All ${sortedEvents.length} Events`}
                </button>
              )}
            </div>
          )
        }
      </div>
    </div>
  )
}
