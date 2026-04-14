package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.dto.MarketPulseInsightsDTO;
import com.kotsin.dashboard.dto.MarketPulseInsightsDTO.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Trading Command Center — computes ALL insights for the frontend.
 * Frontend is a pure renderer. Zero computation in the browser.
 *
 * Reads from:
 *   - MarketPulseService (live macro snapshot)
 *   - Redis (FII/DII, deals, delivery, positions, wallets, ASS)
 *   - Strategy targets (active positions)
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class MarketPulseInsightsService {

    private final StringRedisTemplate redis;
    private final MarketPulseService marketPulseService;
    private final ObjectMapper mapper = new ObjectMapper();

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    // ── Client Classification (mirrors FastAnalytics Python) ──
    private static final Pattern FII_PATTERN = Pattern.compile(
        "goldman|morgan stanley|citi|jpmorgan|hsbc|ubs|barclays|nomura|clsa|fpi|foreign|europe|asia|global|singapore|mauritius|capital group|vanguard|blackrock|societe|deutsche|credit suisse|bnp|macquarie|aberdeen|schroders|merrill|pine oak|beacon stone|alphamine|cayman|luxembourg|fii|fpi|abu dhabi|gic|temasek|tiger|sequoia|fidelity|wellington|t\\. rowe|invesco|jpm|fund.*ireland|fund.*delaware|emerging.*markets",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern DII_PATTERN = Pattern.compile(
        "mutual fund|kotak mahindra|hdfc mutual|sbi mutual|axis mutual|nippon india|birla sun|dsp mutual|franklin|idfc mutual|sundaram|canara robeco|invesco india|mirae|quant mutual|union mutual|groww|aditya birla|tata mutual|icici prudential|uti mutual|baroda bnp|edelweiss mutual|motilal oswal mutual|whiteoak|360 one|pgim india|hdfc life|sbi life|max life|life insurance|lic india|insurance.*comp|pension fund|nps trust",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern PROP_BROKER_PATTERN = Pattern.compile(
        "jump trading|nk securities|junomoneta|microcurves|irage|musigma|elixir wealth|qicap|silverleaf|puma securities|pace stock|mathisys|arthkumbh|dipan mehta|dharmik.*kapu",
        Pattern.CASE_INSENSITIVE);

    // ── Sector Keywords (broadened in Phase 7 to catch more stocks; order matters: more specific first) ──
    private static final Map<String, Pattern> SECTOR_PATTERNS = new java.util.LinkedHashMap<>() {{
        put("Banking & Finance", Pattern.compile("bank|financ|hdfc|icici|kotak|axis|sbi(?!l)|bajaj fin|indusind|pnb|federal|rbl|yes bank|muthoot|manappuram|shriram|chola|bandhan|au small|capit|nbfc|sundaram fin|repco|cholamandalam|piramal", Pattern.CASE_INSENSITIVE));
        put("Insurance", Pattern.compile("insur|lic |hdfc life|sbi life|max life|icici.*lomb|star health|niva|go digit|new india|united india|general insurance", Pattern.CASE_INSENSITIVE));
        put("IT & Tech", Pattern.compile("tech|infosys|info edge|tcs|wipro|hcl|ltimind|l&t.*tech|mphasis|coforge|persist|cyient|kpit|tata elx|zensar|happiest|intellect|polycab|route mobile|tata communications|sasken|saksoft|onmobile|nazara|nykaa|paytm|policybazaar|map my india", Pattern.CASE_INSENSITIVE));
        put("Pharma & Health", Pattern.compile("pharma|drug|sun pharma|cipla|lupin|dr.?reddy|divis|aurobindo|torrent pharma|zydus|biocon|alkem|gland|laurus|abbott|glaxo|pfizer|sanofi|natco|jubilant|piramal pharma|metropolis|thyrocare|fortis|apollo hosp|max healthcare|narayana|hospital|medplus|krishna inst", Pattern.CASE_INSENSITIVE));
        put("Auto", Pattern.compile("auto|maruti|tata motor|m&m|mahindra(?! cie)|bajaj auto|hero moto|tvs motor|eicher|ashok ley|escorts|atul auto|force motor|cie auto|exide|amara raja|sona blw|samvardhana|motherson|bharat forge|sundaram fast|wabco|bosch|mrf|ceat|apollo tyre|jk tyre|balkrishna", Pattern.CASE_INSENSITIVE));
        put("Oil & Gas", Pattern.compile("reliance|petro|crude|natural gas|ongc|bpcl|hpcl|ioc(?!l)|indianoil|gail|adani.*gas|gujarat gas|igl|mgl|petron|chennai petr|mangalore refin|aegis logistics", Pattern.CASE_INSENSITIVE));
        put("Power & Energy", Pattern.compile("power|ntpc|adani.*power|tata.*power|nhpc|jsw.*energy|adani.*green|torrent power|cesc|reliance power|jp power|kalpataru power|ksk energy|sterlite power|inox wind|suzlon|orient green|borosil renewables", Pattern.CASE_INSENSITIVE));
        put("Metals & Mining", Pattern.compile("metal|steel|tata steel|jsw steel|hindalco|vedanta|coal india|nmdc|moil|nalco|sail|jindal|jspl|hindustan zinc|hindustan copper|jindal stainless|welspun corp|apl apollo|ratnamani|mukand|maharashtra seamless", Pattern.CASE_INSENSITIVE));
        put("FMCG & Retail", Pattern.compile("fmcg|itc(?!hl)|hindustan.*uni|nestle|dabur|marico|colgate|britannia|godrej.*con|godrej consumer|emami|gillette|honasa|patanjali|tata consumer|varun bever|dmart|trent|aditya birla fashion|shoppers stop|spencer|future retail|jubilant food|westlife|sapphire foods|devyani", Pattern.CASE_INSENSITIVE));
        put("Real Estate", Pattern.compile("real|realty|dlf|godrej.*prop|prestige|oberoi realty|brigade|sobha|phoenix mills|macrotech|lodha|sunteck|kolte patil|nesco|signature global|raymond realty", Pattern.CASE_INSENSITIVE));
        put("Infra & Cement", Pattern.compile("infra|highway|construct|larsen|l&t|cement|ultratech|ambuja|shree cement|acc|dalmia|jk cement|ramco cement|birla corp|nuvoco|orient cement|india cements|prism johnson|gmr|gvk|irb infra|kpil|ksb|ahluwalia|nbcc|hg infra|pnc infra", Pattern.CASE_INSENSITIVE));
        put("Chemicals", Pattern.compile("chem|chemical|srf|pidilite|aarti|clean science|deepak|tata chem|navin fluo|gujarat fluo|alkyl amines|fine organic|laxmi organic|gujarat alkalies|guj narmada|punjab alkali|atul ltd|vinati|sumitomo chem|upl ltd|coromandel|chambal|gnfc|gsfc|rcf|deepak nitrite", Pattern.CASE_INSENSITIVE));
        put("Telecom", Pattern.compile("airtel|bharti|vodafone|idea|vi |mtnl|bsnl|reliance jio|tata comm|tejas|hfcl|sterlite tech|gtl|indus tower", Pattern.CASE_INSENSITIVE));
        put("Defence & PSU", Pattern.compile("hindustan aero|hal |bharat dynam|bdl |bharat electronics|bel |mishra dhatu|midhani|garden reach|cochin shipyard|mazagon dock|bharat heavy|bhel|paras defence|astra micro|data patterns|ideaforge", Pattern.CASE_INSENSITIVE));
        put("Logistics & Shipping", Pattern.compile("logistics|delhivery|blue dart|tci express|gati|allcargo|container corp|concor|aegis log|sci |shipping corp|adani port|jsw infra|gujarat pipavav", Pattern.CASE_INSENSITIVE));
        put("Media & Entertainment", Pattern.compile("media|zee |sun tv|pvr|inox leis|saregama|tips|eros|prime focus|pvr inox|network18|tv18|jagran|hathway|den networks", Pattern.CASE_INSENSITIVE));
        put("Agri & Fertilizer", Pattern.compile("agri|fertili|coromandel|chambal fert|deepak fert|gsfc|gnfc|rcf |madras fert|paradeep|nfl |sumitomo|pi industries|insectic|rallis|bayer crop|godrej agro|kaveri seed|jain irri|ksb pump", Pattern.CASE_INSENSITIVE));
        put("Capital Goods", Pattern.compile("capital good|abb|siemens|cummins|thermax|honeywell|grindwell|sks micro|ge india|disa india|elgi|ksb pump|kirloskar|hawkins|texmaco|isgec|triveni eng|action const|esab", Pattern.CASE_INSENSITIVE));
    }};

    // ── Phase 5+6: FOMC + India CPI calendar (2026 — hand-curated, refresh annually) ──
    // FOMC dates: official Federal Reserve schedule
    private static final List<String> FOMC_DATES_2026 = List.of(
        "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
        "2026-07-29", "2026-09-16", "2026-11-04", "2026-12-16"
    );
    // India CPI (release dates — typically 12th of each month, IST evening)
    private static final List<String> INDIA_CPI_DATES_2026 = List.of(
        "2026-01-12", "2026-02-12", "2026-03-12", "2026-04-13",
        "2026-05-12", "2026-06-12", "2026-07-13", "2026-08-12",
        "2026-09-14", "2026-10-12", "2026-11-12", "2026-12-14"
    );

    private static class CalendarEvent {
        String iso;
        int daysUntil;
        CalendarEvent(String iso, int daysUntil) { this.iso = iso; this.daysUntil = daysUntil; }
    }

    private CalendarEvent nextEvent(List<String> dates) {
        java.time.LocalDate today = java.time.LocalDate.now(IST);
        for (String d : dates) {
            try {
                java.time.LocalDate dt = java.time.LocalDate.parse(d);
                if (!dt.isBefore(today)) {
                    return new CalendarEvent(d, (int) java.time.temporal.ChronoUnit.DAYS.between(today, dt));
                }
            } catch (Exception ignored) {}
        }
        return new CalendarEvent("", -1);
    }

    private String buildCalendarHint(CalendarEvent fomc, CalendarEvent cpi) {
        StringBuilder sb = new StringBuilder();
        if (fomc.daysUntil == 0) sb.append("⚠ FOMC TODAY · expect volatility · cut size 50%");
        else if (fomc.daysUntil == 1) sb.append("⚠ FOMC tomorrow · tighten stops · cut size");
        else if (fomc.daysUntil >= 2 && fomc.daysUntil <= 3) sb.append("FOMC in ").append(fomc.daysUntil).append("d · prep for vol spike");
        if (cpi.daysUntil == 0) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append("⚠ India CPI today · RBI reaction risk");
        } else if (cpi.daysUntil == 1) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append("India CPI tomorrow · watch headline & core");
        } else if (cpi.daysUntil >= 2 && cpi.daysUntil <= 3) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append("India CPI in ").append(cpi.daysUntil).append("d");
        }
        return sb.toString();
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    // ═══════════════════════════════════════════════════════════
    //  MAIN METHOD — called by controller
    // ═══════════════════════════════════════════════════════════

    public MarketPulseInsightsDTO buildInsights() {
        try {
            var snapshot = marketPulseService.getLatestSnapshot();
            var fiiDiiDays = marketPulseService.getFiiDii();
            var blockDeals = marketPulseService.getBlockDeals();
            var bulkDeals = marketPulseService.getBulkDeals();
            var corpEvents = marketPulseService.getCorporateEvents();
            var deliveryData = marketPulseService.getDeliveryData();

            return MarketPulseInsightsDTO.builder()
                .marketState(computeMarketState(snapshot, fiiDiiDays))
                .strategyAlignments(computeStrategyAlignment(snapshot))
                .positionGuidance(computePositionGuidance(snapshot))
                .alerts(computeAlerts(snapshot, fiiDiiDays))
                .commoditySignals(computeCommoditySignals(snapshot))
                .sectorIndices(computeSectorIndices())
                .asianMarkets(computeAsianMarkets(snapshot))
                .fiiDiiIntelligence(computeFiiDiiIntelligence(fiiDiiDays))
                .dealIntelligence(computeDealIntelligence(blockDeals, bulkDeals, corpEvents, deliveryData))
                .deliveryAnalysis(computeDeliveryAnalysis(deliveryData, blockDeals, bulkDeals, fiiDiiDays))
                .institutionalActivity(computeInstitutionalActivity(blockDeals, bulkDeals, deliveryData))
                .strategyScorecard(computeStrategyScorecard())
                .computedAt(System.currentTimeMillis())
                .marketStatus(getMarketStatus())
                .nextBoundary(getNextBoundary())
                .build();
        } catch (Exception e) {
            log.error("[INSIGHTS] Failed to build insights: {}", e.getMessage(), e);
            return MarketPulseInsightsDTO.builder()
                .computedAt(System.currentTimeMillis())
                .marketStatus("ERROR")
                .alerts(List.of(Alert.builder()
                    .severity("CRITICAL").icon("🔴").title("Insights Error")
                    .message("Failed to compute insights: " + e.getMessage())
                    .build()))
                .build();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  TIER 1: MARKET STATE
    // ═══════════════════════════════════════════════════════════

    private MarketPulseInsightsDTO.MarketState computeMarketState(MarketPulseService.MacroSnapshot snap,
                                            List<Map<String, Object>> fiiDiiDays) {
        // Read ASS from Redis
        double assScore = readDouble("asian:sentiment:score", 0);
        String assRegime = readString("asian:sentiment:regime", "NEUTRAL");

        // FII/DII from latest day
        double fiiNet = 0, diiNet = 0;
        if (!fiiDiiDays.isEmpty()) {
            var latest = fiiDiiDays.get(0);
            var fii = (Map<String, Object>) latest.get("FII");
            var dii = (Map<String, Object>) latest.get("DII");
            if (fii != null) fiiNet = toDouble(fii.get("netValue"));
            if (dii != null) diiNet = toDouble(dii.get("netValue"));
        }

        // Compute confidence (0-100) from multiple inputs
        int confidence = 50; // baseline
        double vix = snap.getIndiaVix();
        double niftyChg = snap.getGiftNiftyChangePct();

        // ASS contribution (+/- 15 points)
        if (assScore > 1.5) confidence += 15;
        else if (assScore > 0.5) confidence += 8;
        else if (assScore < -1.5) confidence -= 15;
        else if (assScore < -0.5) confidence -= 8;

        // VIX contribution (+/- 10 points)
        if (vix < 15) confidence += 10;
        else if (vix < 20) confidence += 5;
        else if (vix > 25) confidence -= 10;
        else if (vix > 22) confidence -= 5;

        // FII/DII contribution (+/- 10 points)
        if (fiiNet > 0 && diiNet > 0) confidence += 10; // both buying = very bullish
        else if (fiiNet > 0) confidence += 5;
        else if (fiiNet < -5000 && diiNet > 0) confidence -= 3; // FII selling, DII absorbing = mildly bearish
        else if (fiiNet < -5000 && diiNet < 0) confidence -= 10; // both selling = bearish

        // Nifty gap contribution (+/- 10 points)
        if (niftyChg > 2) confidence += 10;
        else if (niftyChg > 1) confidence += 5;
        else if (niftyChg < -2) confidence -= 10;
        else if (niftyChg < -1) confidence -= 5;

        // DXY contribution (+/- 5 points)
        double dxyChg = snap.getDxyChangePct();
        if (dxyChg < -0.5) confidence += 5; // weak dollar = good for India
        else if (dxyChg > 0.5) confidence -= 5;

        confidence = Math.max(5, Math.min(95, confidence));

        // Direction
        String direction;
        if (confidence >= 65) direction = "BULLISH";
        else if (confidence <= 35) direction = "BEARISH";
        else direction = "NEUTRAL";

        // Day type (simplified — full GQS-based detection comes later)
        String dayType;
        if (Math.abs(niftyChg) > 1.5) dayType = "TREND";
        else if (Math.abs(niftyChg) > 0.5) dayType = "RANGE";
        else dayType = "RANGE";

        // Summary
        String summary = buildMarketSummary(direction, assScore, fiiNet, diiNet, vix, niftyChg, dxyChg, snap);

        // ── Nifty 50 (from Streaming Candle hot-stocks enrichment) ──
        double nifty50Px = 0, nifty50Chg = 0;
        try {
            String hsJson = readString("hotstocks:v1:999920000", null);
            if (hsJson != null) {
                JsonNode hs = mapper.readTree(hsJson);
                nifty50Px = hs.path("ltpYesterday").asDouble(0);
                nifty50Chg = hs.path("change1dPct").asDouble(0);
            }
        } catch (Exception ignored) {}

        // ── SGX / GIFT Nifty (from sgxnifty.org scraper via Kafka) ──
        double sgxPx = snap.getGiftNiftyPrice() > 0 ? snap.getGiftNiftyPrice() : snap.getSgxNiftyLastTrade();
        double sgxChg = snap.getGiftNiftyChangePct();

        // ── Asian markets (read same pattern as computeAsianMarkets) ──
        double nikkeiChg   = readDouble("global:indices:nikkei:changePct", 0);
        double hangSengChg = readDouble("global:indices:hangseng:changePct", 0);
        double shanghaiChg = readDouble("global:indices:shanghai:changePct", 0);
        double kospiChg    = readDouble("global:indices:kospi:changePct", 0);

        // ── Phase 5+6: macro rates + computed spreads + calendar ──
        double us10y    = readDouble("global:indices:us10y:price", 0);
        double us10yChg = readDouble("global:indices:us10y:changePct", 0);
        double vixDivergence = vix - snap.getUsVixPrice();
        double brentWtiSpread = snap.getBrentOilPrice() - snap.getCrudeOilPrice();

        // FOMC + India CPI calendar
        CalendarEvent fomc = nextEvent(FOMC_DATES_2026);
        CalendarEvent cpi  = nextEvent(INDIA_CPI_DATES_2026);
        String calendarHint = buildCalendarHint(fomc, cpi);

        // ── Phase 4: per-card inferences + globalRead ──
        java.util.Map<String, String> inferences = buildCardInferences(
            snap, sgxChg, nifty50Chg, vix, fiiNet, diiNet, dxyChg, assScore,
            nikkeiChg, hangSengChg, shanghaiChg, kospiChg);
        String globalRead = buildGlobalRead(direction, assScore, fiiNet, diiNet, vix,
            nifty50Chg, sgxChg, dxyChg, snap);

        return MarketPulseInsightsDTO.MarketState.builder()
            .direction(direction)
            .confidence(confidence)
            .dayType(dayType)
            .summary(summary)
            .assScore(assScore)
            .assRegime(assRegime)
            // Legacy field — points to SGX/GIFT Nifty (for back-compat)
            .niftyPrice(sgxPx)
            .niftyChangePct(niftyChg)
            // Explicit separated fields (Phase 4)
            .sgxNiftyPrice(sgxPx)
            .sgxNiftyChangePct(sgxChg)
            .nifty50Price(nifty50Px)
            .nifty50ChangePct(nifty50Chg)
            .cardInferences(inferences)
            .globalRead(globalRead)
            .indiaVix(vix)
            .crudePrice(snap.getCrudeOilPrice())
            .crudeChangePct(snap.getCrudeOilChangePct())
            .goldPrice(snap.getGoldPrice())
            .goldChangePct(snap.getGoldChangePct())
            .silverPrice(snap.getSilverPrice())
            .silverChangePct(snap.getSilverChangePct())
            .dxyPrice(snap.getDxyPrice())
            .dxyChangePct(dxyChg)
            .usdInrPrice(snap.getUsdInrPrice())
            .usdInrChangePct(snap.getUsdInrChangePct())
            .fiiNetToday(fiiNet)
            .diiNetToday(diiNet)
            .usVix(snap.getUsVixPrice())
            .usVixChangePct(snap.getUsVixChangePct())
            // US indices (from sgxnifty.org scraper → MacroSnapshot)
            .sp500Price(snap.getSp500Price())
            .sp500ChangePct(snap.getSp500ChangePct())
            .dowPrice(snap.getDowPrice())
            .dowChangePct(snap.getDowChangePct())
            .nasdaqPrice(snap.getNasdaqPrice())
            .nasdaqChangePct(snap.getNasdaqChangePct())
            // Brent (Phase 1 — already scraped)
            .brentPrice(snap.getBrentOilPrice())
            .brentChangePct(snap.getBrentOilChangePct())
            // Europe + Middle East populated by Phase 2 poller; read from Redis if available
            .ftsePrice(readDouble("global:indices:ftse:price", 0))
            .ftseChangePct(readDouble("global:indices:ftse:changePct", 0))
            .daxPrice(readDouble("global:indices:dax:price", 0))
            .daxChangePct(readDouble("global:indices:dax:changePct", 0))
            .cacPrice(readDouble("global:indices:cac:price", 0))
            .cacChangePct(readDouble("global:indices:cac:changePct", 0))
            .tasiPrice(readDouble("global:indices:tasi:price", 0))
            .tasiChangePct(readDouble("global:indices:tasi:changePct", 0))
            .uaePrice(readDouble("global:indices:uae:price", 0))
            .uaeChangePct(readDouble("global:indices:uae:changePct", 0))
            // Phase 5+6 macro
            .us10yYield(us10y)
            .us10yChangePct(us10yChg)
            .vixDivergence(round2(vixDivergence))
            .brentWtiSpread(round2(brentWtiSpread))
            .nextFomcDate(fomc.iso)
            .daysUntilFomc(fomc.daysUntil)
            .nextCpiDate(cpi.iso)
            .daysUntilCpi(cpi.daysUntil)
            .calendarHint(calendarHint)
            .giftNiftyPrice(sgxPx)
            .giftNiftyChangePct(sgxChg)
            .advances(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getAdvances() : 0)
            .declines(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getDeclines() : 0)
            .adRatioLabel(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getRatioLabel() : "0:0")
            .foAdvances(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getFoAdvances() : 0)
            .foDeclines(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getFoDeclines() : 0)
            .foRatioLabel(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getFoRatioLabel() : "0:0")
            .timestamp(System.currentTimeMillis())
            .build();
    }

    // ══════════════════════════════════════════════════════════════
    //  PHASE 4: Per-card cross-indice inferences
    // ══════════════════════════════════════════════════════════════
    // Each inference is a short 1-line takeaway that considers the asset's own move
    // IN CONTEXT of the rest of the market. The rules are deterministic — no LLM —
    // and keyed by card id (frontend reads via data.marketState.cardInferences[cardId]).
    private java.util.Map<String, String> buildCardInferences(
            MarketPulseService.MacroSnapshot snap,
            double sgxChg, double nifty50Chg, double vix, double fiiNet, double diiNet,
            double dxyChg, double ass,
            double nikkeiChg, double hangSengChg, double shanghaiChg, double kospiChg) {

        java.util.Map<String, String> inf = new java.util.LinkedHashMap<>();

        // Nifty 50 — reflects the last NSE close + rest of the world
        if (nifty50Chg > 1.5) inf.put("nifty50", "Strong bullish close · momentum into next session");
        else if (nifty50Chg > 0.5) inf.put("nifty50", ass > 0 ? "Positive close · Asia tailwind extends" : "Positive close · domestic-led rally");
        else if (nifty50Chg > 0) inf.put("nifty50", "Mildly positive · trend intact");
        else if (nifty50Chg < -1.5) inf.put("nifty50", "Sharp selloff · defensive bias next session");
        else if (nifty50Chg < -0.5) inf.put("nifty50", fiiNet < 0 ? "Weak close · FII selling pressure" : "Weak close · profit-booking");
        else if (nifty50Chg < 0) inf.put("nifty50", "Mildly negative · consolidation");
        else inf.put("nifty50", "Flat close · awaits directional cue");

        // SGX Nifty — overnight futures, reflects US + Asia overlap
        if (sgxChg > 0.5) inf.put("sgxNifty", "Gap-up signal · global cues supportive");
        else if (sgxChg > 0.1) inf.put("sgxNifty", "Mild premium · positive bias");
        else if (sgxChg < -0.5) inf.put("sgxNifty", "Gap-down signal · global weakness");
        else if (sgxChg < -0.1) inf.put("sgxNifty", "Mild discount · cautious open likely");
        else inf.put("sgxNifty", "Flat overnight · no gap signal");

        // India VIX — volatility regime context
        if (vix > 25) inf.put("indiaVix", "High fear · option premiums rich · hedge first");
        else if (vix > 20) inf.put("indiaVix", "Elevated · monitor for spike, reduce size");
        else if (vix > 15) inf.put("indiaVix", "Normal · regular position sizing");
        else if (vix > 0) inf.put("indiaVix", "Calm · complacency risk · watch for shocks");
        else inf.put("indiaVix", "DM");

        // USD/INR — rupee strength + DXY interaction
        if (dxyChg < -0.3) inf.put("usdInr", "Weak $ = rupee tailwind · EM flows supportive");
        else if (dxyChg > 0.3) inf.put("usdInr", "Strong $ = rupee pressure · FII outflow risk");
        else inf.put("usdInr", "Stable · no strong FX signal");

        // Asian markets — each contextualised to overall Asia + India impact
        inf.put("nikkei", asianCardInf("Nikkei", nikkeiChg, ass));
        inf.put("hangSeng", asianCardInf("Hang Seng", hangSengChg, ass));
        inf.put("shanghai", asianCardInf("Shanghai", shanghaiChg, ass));
        inf.put("kospi", asianCardInf("KOSPI", kospiChg, ass));

        // US markets — daily action + pre-market for next IST session
        double dowChg = snap.getDowChangePct();
        double sp500Chg = snap.getSp500ChangePct();
        double nasdaqChg = snap.getNasdaqChangePct();
        double usVixChg = snap.getUsVixChangePct();
        double usVix = snap.getUsVixPrice();

        inf.put("dow",    usCardInf("Dow", dowChg));
        inf.put("sp500",  usCardInf("S&P 500", sp500Chg));
        inf.put("nasdaq", usCardInf("Nasdaq", nasdaqChg));
        if (usVix > 25) inf.put("usVix", "High fear on Wall Street · global risk-off caution");
        else if (usVix > 20) inf.put("usVix", "Elevated · hedging activity");
        else if (usVix > 0) inf.put("usVix", "Calm · risk-on conditions");
        else inf.put("usVix", "DM");

        // Europe — generally neutral impact, but extremes matter
        inf.put("ftse", euCardInf("FTSE", readDouble("global:indices:ftse:changePct", 0)));
        inf.put("dax",  euCardInf("DAX",  readDouble("global:indices:dax:changePct", 0)));
        inf.put("cac",  euCardInf("CAC",  readDouble("global:indices:cac:changePct", 0)));

        // Middle East — oil-economy proxies
        double crudeChg = snap.getCrudeOilChangePct();
        double tasiChg = readDouble("global:indices:tasi:changePct", 0);
        double uaeChg = readDouble("global:indices:uae:changePct", 0);
        inf.put("tasi", meCardInf("TASI", tasiChg, crudeChg));
        inf.put("uae",  meCardInf("UAE", uaeChg, crudeChg));

        // Commodities — cross-read with DXY + US session + India impact
        inf.put("crudeWti", crudeInf(crudeChg, dxyChg));
        double brentChg = snap.getBrentOilChangePct();
        inf.put("brent", Math.abs(brentChg) < 0.1 ? "Flat · no Middle East supply shock"
            : brentChg > 0 ? "Up · supportive for OMCs' cracks" : "Down · OMC inventory gain ahead");
        double goldChg = snap.getGoldChangePct();
        inf.put("gold", goldChg > 1 ? "Bid · safe-haven demand · risk-off tint"
            : goldChg < -1 ? "Sold · risk-on dominates"
            : Math.abs(goldChg) < 0.3 ? "Flat · no macro shock"
            : goldChg > 0 ? "Mildly up · watch USD" : "Mildly down · tracking yields");
        double silverChg = snap.getSilverChangePct();
        inf.put("silver", silverChg > 2 ? "Surge · industrial + monetary demand"
            : silverChg < -1 ? "Soft · profit-booking"
            : Math.abs(silverChg) < 0.3 ? "Flat · tracking gold"
            : "Normal · stable metals picture");

        // DXY — the single biggest EM driver
        if (dxyChg < -0.5) inf.put("dxy", "Sharply weak · EM flows strong · FII inflows likely");
        else if (dxyChg < 0) inf.put("dxy", "Mildly weak · constructive for EM");
        else if (dxyChg < 0.3) inf.put("dxy", "Flat · no strong FX rotation");
        else inf.put("dxy", "Strong $ · EM pressure · watch FII outflows");

        // FII / DII
        if (fiiNet > 3000) inf.put("fii", "Aggressive buying · risk-on conviction");
        else if (fiiNet > 500) inf.put("fii", "Net buying · supportive for Nifty");
        else if (fiiNet > -500) inf.put("fii", "Neutral · no strong institutional signal");
        else if (fiiNet > -3000) inf.put("fii", "Net selling · cautious rotation");
        else inf.put("fii", "Aggressive selling · risk-off · hedge exposure");

        if (diiNet > 3000) inf.put("dii", "Strong domestic support · absorbing FII sell-offs");
        else if (diiNet > 500) inf.put("dii", "Net buying · domestic confidence");
        else if (diiNet > -500) inf.put("dii", "Neutral · waiting for direction");
        else inf.put("dii", "Net selling · domestic de-risking · unusual");

        return inf;
    }

    private String asianCardInf(String name, double chg, double ass) {
        if (chg > 1.5) return name + " strong green · tailwind for India opening";
        if (chg > 0.3) return name + " mildly green · supportive";
        if (chg < -1.5) return name + " sharp red · headwind for opening";
        if (chg < -0.3) return name + " mildly red · caution";
        return name + " flat · no directional cue";
    }

    private String usCardInf(String name, double chg) {
        if (chg > 1) return name + " strong · supports risk-on bias for next session";
        if (chg > 0.2) return name + " positive · mild tailwind for EMs";
        if (chg < -1) return name + " sharp fall · global risk-off · cautious open";
        if (chg < -0.2) return name + " weak · mild headwind";
        return name + " flat · no strong signal";
    }

    private String euCardInf(String name, double chg) {
        if (chg > 1) return name + " strong · supportive for EU-EM flows";
        if (chg < -1) return name + " weak · risk-off tint";
        if (Math.abs(chg) < 0.2) return name + " flat · no strong signal";
        return name + (chg > 0 ? " mildly up" : " mildly down") + " · marginal impact";
    }

    private String meCardInf(String name, double chg, double crudeChg) {
        if (chg > 1 && crudeChg > 0.5) return name + " up with crude · oil rally confirmation";
        if (chg < -1 && crudeChg < -0.5) return name + " down with crude · oil weakness";
        if (Math.abs(chg) < 0.2) return name + " flat · no oil-driven signal";
        return name + (chg > 0 ? " mildly up" : " mildly down") + " · watch crude";
    }

    private String crudeInf(double crudeChg, double dxyChg) {
        if (crudeChg > 2) return "Sharp rally · OMC cracks compress · inflation risk up";
        if (crudeChg > 0.5) return "Up · mild inflation tailwind, watch OMC margins";
        if (crudeChg < -2) return "Sharp drop · OMC inventory gain · disinflation supports";
        if (crudeChg < -0.5) return "Down · marginal OMC relief";
        return "Flat · no oil-driven signal";
    }

    // ══════════════════════════════════════════════════════════════
    //  PHASE 4: Holistic one-line read across all markets
    // ══════════════════════════════════════════════════════════════
    private String buildGlobalRead(String direction, double ass, double fiiNet, double diiNet,
                                    double vix, double nifty50Chg, double sgxChg, double dxyChg,
                                    MarketPulseService.MacroSnapshot snap) {
        StringBuilder sb = new StringBuilder();

        // 1. Asia bias
        if (ass > 1) sb.append("Asia strong green (ASS ").append(String.format("%+.2f", ass)).append("), ");
        else if (ass > 0.3) sb.append("Asia mildly green, ");
        else if (ass < -1) sb.append("Asia red, ");
        else if (ass < -0.3) sb.append("Asia mildly red, ");
        else sb.append("Asia mixed, ");

        // 2. US bias (use average of sp500 + nasdaq as leading indicator)
        double usAvg = (snap.getSp500ChangePct() + snap.getNasdaqChangePct()) / 2.0;
        if (usAvg > 0.5) sb.append("US risk-on, ");
        else if (usAvg < -0.5) sb.append("US risk-off, ");
        else sb.append("US mixed, ");

        // 3. Flows
        if (fiiNet > 500 && diiNet > 500) sb.append("both FII+DII buying, ");
        else if (fiiNet > 500) sb.append(String.format("FII +%d Cr buying, ", (int) fiiNet));
        else if (fiiNet < -500) sb.append(String.format("FII %d Cr selling, ", (int) fiiNet));
        else sb.append("flows neutral, ");

        // 4. DXY-EM read
        if (dxyChg < -0.3) sb.append("weak dollar (EM tailwind), ");
        else if (dxyChg > 0.3) sb.append("strong dollar (EM headwind), ");

        // 5. Verdict
        String verdict;
        int score = 0;
        if (ass > 0.5) score++;
        if (ass < -0.5) score--;
        if (usAvg > 0.3) score++;
        if (usAvg < -0.3) score--;
        if (fiiNet > 500) score++;
        if (fiiNet < -500) score--;
        if (dxyChg < -0.3) score++;
        if (dxyChg > 0.3) score--;
        if (nifty50Chg > 0.5) score++;
        if (nifty50Chg < -0.5) score--;

        if (score >= 3) verdict = "bullish setup for next session — buy dips";
        else if (score >= 1) verdict = "mildly positive bias — trend-follow with SL";
        else if (score <= -3) verdict = "bearish setup — hedge or reduce exposure";
        else if (score <= -1) verdict = "mildly negative bias — tighten stops";
        else verdict = "neutral/mixed — range-bound, wait for break";

        sb.append(verdict).append(".");

        // 6. Commodity caveat
        double crudeChg = snap.getCrudeOilChangePct();
        if (crudeChg > 1.5) sb.append(" ⚠ Crude +").append(String.format("%.1f", crudeChg)).append("% — OMC/aviation headwind.");
        else if (crudeChg < -1.5) sb.append(" ✓ Crude ").append(String.format("%.1f", crudeChg)).append("% — disinflation supportive.");

        if (vix > 22) sb.append(" ⚠ VIX ").append(String.format("%.1f", vix)).append(" elevated — size down.");

        return sb.toString();
    }

    private String buildMarketSummary(String direction, double ass, double fiiNet, double diiNet,
                                       double vix, double niftyChg, double dxyChg,
                                       MarketPulseService.MacroSnapshot snap) {
        List<String> parts = new ArrayList<>();

        // ── Advance/Decline Breadth (strongest signal, goes first) ──
        int adv = snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getAdvances() : 0;
        int dec = snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getDeclines() : 0;
        int total = adv + dec;
        if (total > 50) {
            double advPct = (double) adv / total * 100;
            if (advPct > 80) parts.add(String.format("Breadth extremely bullish (%d:%d, %.0f%% advancing) — broad-based rally, buy dips tomorrow.", adv, dec, advPct));
            else if (advPct > 65) parts.add(String.format("Breadth bullish (%d:%d) — healthy participation, trend likely continues.", adv, dec));
            else if (advPct < 20) parts.add(String.format("Breadth extremely weak (%d:%d, %.0f%% declining) — broad selloff, defensive tomorrow.", adv, dec, 100 - advPct));
            else if (advPct < 35) parts.add(String.format("Breadth bearish (%d:%d) — narrow market, avoid aggressive longs.", adv, dec));
        }

        // ── Asia ──
        if (ass > 1.5) parts.add("Asia strongly green — favorable for India opening.");
        else if (ass < -1.5) parts.add("Asia sharply red — expect selling pressure at open.");

        // ── FII/DII with quantified context ──
        if (fiiNet < -5000 && diiNet > 5000) {
            double absorption = diiNet > 0 && fiiNet < 0 ? Math.min(100, Math.abs(diiNet / fiiNet * 100)) : 0;
            parts.add(String.format("FII sold %.0f Cr but DII absorbed %.0f%% — market floor intact. Not panic, rebalancing.", Math.abs(fiiNet), absorption));
        } else if (fiiNet < -5000 && diiNet < 0) {
            parts.add(String.format("FII (%.0f Cr) and DII (%.0f Cr) both selling — defensive mode. Reduce exposure tomorrow.", fiiNet, diiNet));
        } else if (fiiNet > 0 && diiNet > 0) {
            parts.add(String.format("FII (+%.0f Cr) and DII (+%.0f Cr) both buying — risk-on. Tomorrow: trade aggressively with trend.", fiiNet, diiNet));
        } else if (fiiNet > 1000) {
            parts.add(String.format("FII buying +%.0f Cr — foreign confidence returning.", fiiNet));
        }

        // ── VIX context (India + US) ──
        double usVix = snap.getUsVixPrice();
        double usVixChg = snap.getUsVixChangePct();
        if (vix > 25) {
            parts.add(String.format("India VIX elevated at %.1f — option premiums inflated, wider SLs needed. Reduce position sizes.", vix));
        } else if (vix < 14) {
            parts.add(String.format("India VIX low at %.1f — complacency risk. Watch for sudden moves.", vix));
        }
        if (usVixChg < -10) {
            parts.add(String.format("US VIX crashed %.1f%% — global risk appetite surging. FII buying likely tomorrow.", usVixChg));
        } else if (usVixChg > 15) {
            parts.add(String.format("US VIX spiked +%.1f%% — global fear rising. Expect FII outflows.", usVixChg));
        }

        // ── Gap ──
        if (niftyChg > 2) parts.add(String.format("Large gap-up +%.1f%%. Tomorrow: trend likely continues, buy dips. Avoid shorting.", niftyChg));
        else if (niftyChg > 1) parts.add(String.format("Gap-up +%.1f%%. Bullish bias for opening. Trail winners.", niftyChg));
        else if (niftyChg < -2) parts.add(String.format("Large gap-down %.1f%%. Tomorrow: watch for dead cat bounce or continuation. Tighten SLs.", niftyChg));
        else if (niftyChg < -1) parts.add(String.format("Gap-down %.1f%%. Bearish bias. Key support levels to watch.", niftyChg));

        // ── Crude with specific beneficiaries ──
        double crudeChg = snap.getCrudeOilChangePct();
        if (crudeChg < -5) {
            parts.add(String.format("Crude collapsing %.1f%% — tomorrow LONG airlines (InterGlobe), OMCs (BPCL, HPCL, IOC), paint (Asian Paints). Avoid LONG crude on MCX.", crudeChg));
        } else if (crudeChg > 5) {
            parts.add(String.format("Crude spiking +%.1f%% — tomorrow SHORT/avoid airlines, OMCs, paint. LONG ONGC, Oil India. MCX crude LONG aligned.", crudeChg));
        }

        // ── DXY + Gold combo ──
        double goldChg = snap.getGoldChangePct();
        if (dxyChg < -1 && goldChg > 1) {
            parts.add(String.format("Dollar crashing %.1f%% + gold rallying +%.1f%% — risk-on for EM. Strong FII inflow signal for tomorrow.", dxyChg, goldChg));
        } else if (dxyChg < -0.5) {
            parts.add("Dollar weakening — favorable for FII inflows and IT sector margins.");
        } else if (dxyChg > 1) {
            parts.add(String.format("Dollar surging +%.1f%% — FII likely to sell. IT benefits but broad market under pressure.", dxyChg));
        }

        return parts.isEmpty() ? "Normal market conditions. No extreme signals." : String.join(" ", parts);
    }

    // ═══════════════════════════════════════════════════════════
    //  TIER 2: STRATEGY ALIGNMENT
    // ═══════════════════════════════════════════════════════════

    private List<StrategyAlignment> computeStrategyAlignment(MarketPulseService.MacroSnapshot snap) {
        List<StrategyAlignment> alignments = new ArrayList<>();
        String[] strategies = {"FUDKII", "FUKAA", "FUDKOI", "QUANT", "MICROALPHA", "MERE", "RETEST",
                               "MCX_BB_30", "MCX_BB_15", "NSE_BB_30"};

        double niftyChg = snap.getGiftNiftyChangePct();
        double crudeChg = snap.getCrudeOilChangePct();
        boolean isTrendDay = Math.abs(niftyChg) > 1.5;

        for (String strategy : strategies) {
            try {
                var wallet = readWallet(strategy);
                double dayPnl = toDouble(wallet.getOrDefault("dayRealizedPnl", 0));
                double balance = toDouble(wallet.getOrDefault("currentBalance", 1000000));
                double peak = toDouble(wallet.getOrDefault("peakBalance", balance));
                double dd = peak > balance ? (peak - balance) / peak * 100 : 0;
                int openPositions = countOpenPositions(strategy);

                String status, icon, desc, macro, risk;

                if (openPositions == 0 && dayPnl == 0) {
                    status = "WAITING"; icon = "⏳";
                    desc = "No signals fired yet today.";
                    macro = getStrategyMacroContext(strategy, snap, isTrendDay);
                    risk = "LOW";
                } else if (openPositions > 0) {
                    boolean aligned = isStrategyAligned(strategy, snap);
                    status = aligned ? "ALIGNED" : "CONFLICTING";
                    icon = aligned ? "✅" : "⚠️";
                    desc = openPositions + " open position" + (openPositions > 1 ? "s" : "") + ". Day PnL: " + formatCr(dayPnl);
                    macro = getStrategyMacroContext(strategy, snap, isTrendDay);
                    risk = aligned ? "LOW" : "HIGH";
                } else if ("MERE".equals(strategy) && isTrendDay) {
                    status = "SUPPRESSED"; icon = "⛔";
                    desc = "Trend day — mean reversion suppressed (correct behavior).";
                    macro = "Gap " + String.format("%+.1f%%", niftyChg) + ". Trend days don't mean-revert.";
                    risk = "LOW";
                } else {
                    status = "WAITING"; icon = "⏳";
                    desc = dayPnl != 0 ? "Day PnL: " + formatCr(dayPnl) + " (positions closed)." : "No activity.";
                    macro = getStrategyMacroContext(strategy, snap, isTrendDay);
                    risk = "LOW";
                }

                alignments.add(StrategyAlignment.builder()
                    .strategy(strategy).status(status).statusIcon(icon)
                    .description(desc).macroContext(macro).riskLevel(risk)
                    .activePositions(openPositions).dayPnl(dayPnl)
                    .totalPnl(balance - 1000000).drawdownPct(Math.round(dd * 10) / 10.0)
                    .build());
            } catch (Exception e) {
                log.debug("[INSIGHTS] Error computing alignment for {}: {}", strategy, e.getMessage());
            }
        }
        return alignments;
    }

    private String getStrategyMacroContext(String strategy, MarketPulseService.MacroSnapshot snap, boolean isTrendDay) {
        double crudeChg = snap.getCrudeOilChangePct();
        double niftyChg = snap.getGiftNiftyChangePct();
        double vix = snap.getIndiaVix();
        int adv = snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getAdvances() : 0;
        int dec = snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getDeclines() : 0;
        int total = adv + dec;
        double advPct = total > 50 ? (double) adv / total * 100 : 50;
        String breadth = advPct > 70 ? "bullish breadth" : advPct < 30 ? "weak breadth" : "mixed breadth";

        return switch (strategy) {
            case "FUDKII", "FUKAA", "FUDKOI" -> {
                if (isTrendDay && advPct > 70)
                    yield String.format("Gap %+.1f%% + %s (%d:%d) — breakout LONG signals aligned. VIX %.1f.", niftyChg, breadth, adv, dec, vix);
                else if (isTrendDay)
                    yield String.format("Gap %+.1f%% but %s — mixed. Selective entries only.", niftyChg, breadth);
                else if (vix > 22)
                    yield String.format("Range day, VIX elevated at %.1f — fewer signals, wider SLs needed.", vix);
                else
                    yield String.format("Range day, VIX %.1f, %s. Fewer breakout opportunities.", vix, breadth);
            }
            case "QUANT" -> {
                List<String> ctx = new ArrayList<>();
                if (crudeChg < -5) ctx.add(String.format("Crude %.1f%% — avoid LONG crude, SHORT aligned", crudeChg));
                else if (crudeChg > 5) ctx.add(String.format("Crude +%.1f%% — LONG crude aligned", crudeChg));
                if (advPct > 70) ctx.add("broad rally supports NSE equity longs");
                else if (advPct < 30) ctx.add("broad weakness — SHORT equity signals aligned");
                yield ctx.isEmpty() ? "Normal commodity + equity environment." : String.join(". ", ctx) + ".";
            }
            case "MICROALPHA" -> {
                if (isTrendDay)
                    yield String.format("Trend day %+.1f%% — TREND_FOLLOWING mode. %s supports directional entries.", niftyChg, breadth);
                else
                    yield String.format("Range day — MEAN_REVERSION mode. VIX %.1f, %s.", vix, breadth);
            }
            case "MERE" -> {
                if (isTrendDay)
                    yield String.format("Trend day %+.1f%% — mean reversion dangerous. MERE should stay quiet.", niftyChg);
                else if (vix > 22)
                    yield String.format("Range day but VIX %.1f — reversals may be sharp. Tight SLs on MERE entries.", vix);
                else
                    yield String.format("Range day, VIX %.1f — MERE reversal setups likely. Watch BB squeeze on 30m.", vix);
            }
            case "RETEST" -> String.format("Structural retest strategy. VIX %.1f, %s. Key levels still valid.", vix, breadth);
            case "MCX_BB_30", "MCX_BB_15" -> {
                if (crudeChg < -5)
                    yield String.format("Crude collapsing %.1f%% — BB squeeze SHORT signals strongly aligned on MCX.", crudeChg);
                else if (crudeChg > 3)
                    yield String.format("Crude +%.1f%% — watch for BB squeeze LONG breakout on MCX.", crudeChg);
                else
                    yield String.format("MCX: crude %.1f%%, gold %+.1f%%. Watch for BB squeeze breakout.", crudeChg, snap.getGoldChangePct());
            }
            case "NSE_BB_30" -> String.format("NSE BB squeeze. %s (%d:%d), VIX %.1f. Evaluates at 30m boundaries.", breadth, adv, dec, vix);
            default -> "Normal.";
        };
    }

    private boolean isStrategyAligned(String strategy, MarketPulseService.MacroSnapshot snap) {
        // Simplified alignment check — full GQS integration comes later
        double niftyChg = snap.getGiftNiftyChangePct();
        boolean bullishDay = niftyChg > 1;

        // Check if strategy's open positions are in the same direction as macro
        Set<String> targetKeys = scanKeys("strategy:targets:*");
        if (targetKeys == null) return true;

        for (String key : targetKeys) {
            try {
                String json = redis.opsForValue().get(key);
                if (json == null) continue;
                Map<String, Object> targets = mapper.readValue(json, Map.class);
                String strat = (String) targets.get("strategy");
                if (!strategy.equals(strat)) continue;

                String direction = (String) targets.getOrDefault("direction", "BULLISH");
                String exchange = (String) targets.getOrDefault("exchange", "N");

                // MCX positions: check commodity alignment
                if ("M".equals(exchange)) {
                    double crudeChg = snap.getCrudeOilChangePct();
                    if (crudeChg < -5 && "BULLISH".equals(direction)) return false; // LONG crude when crude crashing
                }

                // NSE positions: check equity direction alignment
                if ("N".equals(exchange)) {
                    if (bullishDay && "BEARISH".equals(direction)) return false; // SHORT on bullish day
                }
            } catch (Exception ignored) {}
        }
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  TIER 3: POSITION GUIDANCE
    // ═══════════════════════════════════════════════════════════

    private List<PositionGuidance> computePositionGuidance(MarketPulseService.MacroSnapshot snap) {
        List<PositionGuidance> guidance = new ArrayList<>();
        Set<String> targetKeys = scanKeys("strategy:targets:*");
        if (targetKeys == null) return guidance;

        double niftyChg = snap.getGiftNiftyChangePct();
        boolean trendDay = Math.abs(niftyChg) > 1.5;

        for (String key : targetKeys) {
            try {
                String scripCode = key.replace("strategy:targets:", "");
                String targetsJson = redis.opsForValue().get(key);
                if (targetsJson == null) continue;
                Map<String, Object> targets = mapper.readValue(targetsJson, Map.class);

                String symbol = (String) targets.getOrDefault("instrumentSymbol", scripCode);
                String strategy = (String) targets.getOrDefault("strategy", "?");
                String direction = (String) targets.getOrDefault("direction", "BULLISH");
                double entryPrice = toDouble(targets.get("entryPrice"));
                double currentSl = toDouble(targets.get("currentSl"));
                int remainingQty = toInt(targets.get("remainingQty"));
                boolean t1Hit = false;
                boolean greekTrailActive = Boolean.TRUE.equals(targets.get("greekTrailingActive"));

                List<Map<String, Object>> targetLevels = (List<Map<String, Object>>) targets.get("targets");
                if (targetLevels != null) {
                    t1Hit = targetLevels.stream()
                        .anyMatch(t -> "T1".equals(t.get("level")) && Boolean.TRUE.equals(t.get("hit")));
                }

                // Get current LTP
                String exchange = (String) targets.getOrDefault("exchange", "N");
                double currentPrice = readPrice(exchange, scripCode);
                double pnl = ("BULLISH".equals(direction))
                    ? (currentPrice - entryPrice) * remainingQty
                    : (entryPrice - currentPrice) * remainingQty;
                double pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice * 100) : 0;

                // Determine action
                String action, reason;
                double suggestedSl = currentSl;

                if (trendDay && "BULLISH".equals(direction) && pnl > 0) {
                    action = t1Hit ? "TRAIL" : "HOLD";
                    reason = "Trend day. " + (t1Hit ? "T1 hit — trail with Greek Trailing." : "Approaching T1 — hold for breakout.") + " Sector supportive.";
                    if (t1Hit && entryPrice > 0) suggestedSl = Math.max(currentSl, entryPrice); // breakeven
                } else if (trendDay && "BEARISH".equals(direction) && niftyChg > 1.5) {
                    action = "TIGHTEN_SL";
                    reason = "Bearish position on bullish trend day. Tighten SL to reduce risk.";
                    suggestedSl = currentSl * 1.05; // tighten by 5% closer
                } else if (pnl < 0 && pnlPct < -10) {
                    action = "EXIT_EARLY";
                    reason = "Loss exceeds 10%. Consider cutting position.";
                } else {
                    action = "HOLD";
                    reason = "Normal position. Monitoring via strategy SL/targets.";
                }

                guidance.add(PositionGuidance.builder()
                    .scripCode(scripCode).symbol(symbol).strategy(strategy).side(direction)
                    .entryPrice(entryPrice).currentPrice(currentPrice).pnl(Math.round(pnl * 100) / 100.0)
                    .pnlPct(Math.round(pnlPct * 10) / 10.0).action(action).reason(reason)
                    .t1Hit(t1Hit).greekTrailActive(greekTrailActive).currentSl(currentSl)
                    .suggestedSl(Math.round(suggestedSl * 100) / 100.0)
                    .build());
            } catch (Exception e) {
                log.debug("[INSIGHTS] Error computing guidance for {}: {}", key, e.getMessage());
            }
        }
        return guidance;
    }

    // ═══════════════════════════════════════════════════════════
    //  TIER 4: ALERTS
    // ═══════════════════════════════════════════════════════════

    private List<Alert> computeAlerts(MarketPulseService.MacroSnapshot snap,
                                       List<Map<String, Object>> fiiDiiDays) {
        List<Alert> alerts = new ArrayList<>();
        long now = System.currentTimeMillis();

        // Alert: FII selling streak
        int sellingStreak = countFiiSellingStreak(fiiDiiDays);
        if (sellingStreak >= 3) {
            double totalSold = fiiDiiDays.stream().limit(sellingStreak)
                .mapToDouble(d -> Math.abs(toDouble(((Map<String, Object>) d.get("FII")).get("netValue"))))
                .sum();
            alerts.add(Alert.builder().severity("WARNING").icon("🔻")
                .title("FII Selling Streak: " + sellingStreak + " days")
                .message("FII sold " + formatCr(totalSold) + " in " + sellingStreak + " sessions. Watch for continued pressure.")
                .action("Monitor DII absorption. If DII also sells, reduce exposure.")
                .timestamp(now).build());
        }

        // Alert: High VIX
        if (snap.getIndiaVix() > 25) {
            alerts.add(Alert.builder().severity("WARNING").icon("⚡")
                .title("India VIX elevated: " + String.format("%.1f", snap.getIndiaVix()))
                .message("Volatility above 25 indicates fear. Option premiums inflated. Wider SLs needed.")
                .action("Reduce position sizes. Avoid selling options. Tighten SLs on existing positions.")
                .timestamp(now).build());
        }

        // Alert: Strategy drawdown > 10%
        for (String strategy : List.of("FUDKII", "FUKAA", "FUDKOI", "RETEST", "QUANT", "MICROALPHA")) {
            try {
                var wallet = readWallet(strategy);
                double balance = toDouble(wallet.getOrDefault("currentBalance", 1000000));
                double peak = toDouble(wallet.getOrDefault("peakBalance", balance));
                double ddPct = peak > 0 ? (peak - balance) / peak * 100 : 0;
                if (ddPct > 10) {
                    alerts.add(Alert.builder().severity("WARNING").icon("📉")
                        .title(strategy + " drawdown: " + String.format("%.1f%%", ddPct))
                        .message("Balance " + formatCr(balance) + " vs peak " + formatCr(peak) + ". Review strategy performance.")
                        .action("Check if market regime changed. Consider reducing " + strategy + " allocation.")
                        .timestamp(now).build());
                }
            } catch (Exception ignored) {}
        }

        // Alert: Crude crash with LONG commodity positions
        if (snap.getCrudeOilChangePct() < -5) {
            alerts.add(Alert.builder().severity("INFO").icon("🛢️")
                .title("Crude oil " + String.format("%.0f%%", snap.getCrudeOilChangePct()))
                .message("Major crude move. Check MCX LONG positions. Energy sector impacted.")
                .action("Avoid LONG crude. Airlines and OMCs may benefit.")
                .timestamp(now).build());
        }

        return alerts;
    }

    // ═══════════════════════════════════════════════════════════
    //  TIER 5: EVIDENCE SECTIONS
    // ═══════════════════════════════════════════════════════════

    private CommoditySignals computeCommoditySignals(MarketPulseService.MacroSnapshot snap) {
        List<CommoditySignals.CommodityPrice> commodities = new ArrayList<>();
        commodities.add(commodity("Gold", snap.getGoldPrice(), snap.getGoldChangePct()));
        commodities.add(commodity("Silver", snap.getSilverPrice(), snap.getSilverChangePct()));
        commodities.add(commodity("Crude (WTI)", snap.getCrudeOilPrice(), snap.getCrudeOilChangePct()));
        commodities.add(commodity("Brent", snap.getBrentOilPrice(), snap.getBrentOilChangePct()));

        // ── Rich commodity inferences with cross-referencing ──
        List<String> inferences = new ArrayList<>();
        double goldChg = snap.getGoldChangePct();
        double crudeChg = snap.getCrudeOilChangePct();
        double brentChg = snap.getBrentOilChangePct();
        double dxyChg = snap.getDxyChangePct();
        double usdInrChg = snap.getUsdInrChangePct();

        // Gold + Crude divergence
        if (goldChg > 1 && crudeChg < -3) {
            inferences.add(String.format("Gold +%.1f%% while crude %.1f%% — classic risk-off (geopolitical fear, not demand growth). Tomorrow: LONG gold/silver on MCX, avoid crude LONG. Equity: metals safe, energy risky.", goldChg, crudeChg));
        } else if (goldChg > 2 && crudeChg > 2) {
            inferences.add(String.format("Both gold +%.1f%% and crude +%.1f%% rising — inflation trade. Tomorrow: LONG commodities on MCX. Equity: energy + metals sectors benefit.", goldChg, crudeChg));
        }

        // Dollar + FII flow link
        if (dxyChg < -0.5 && goldChg > 1) {
            inferences.add(String.format("Weak dollar (DXY %.1f%%) + gold rally — favorable for EM. Tomorrow: FII inflows likely, broad market supportive. IT margins improve on INR appreciation.", dxyChg));
        } else if (dxyChg > 1) {
            inferences.add(String.format("Dollar surging +%.1f%% — FII selling pressure likely. Tomorrow: IT sector benefits (revenue in USD), but FII-heavy large caps under pressure.", dxyChg));
        }

        // Crude collapse beneficiaries
        if (crudeChg < -5) {
            inferences.add(String.format("Crude collapsing %.1f%% — tomorrow LONG: airlines (InterGlobe), OMCs (IOC, BPCL, HPCL), paint (Asian Paints, Berger), tyres (Apollo, MRF). SHORT/avoid: ONGC, Oil India, MCX crude LONG.", crudeChg));
        } else if (crudeChg > 5) {
            inferences.add(String.format("Crude spiking +%.1f%% — tomorrow LONG: ONGC, Oil India, MCX crude. SHORT/avoid: airlines, OMCs, paint, tyre companies.", crudeChg));
        }

        // WTI-Brent spread
        if (Math.abs(crudeChg) > 1 && Math.abs(crudeChg - brentChg) > 3) {
            inferences.add(String.format("WTI-Brent divergence (WTI %.1f%% vs Brent %.1f%%) — regional supply disruption. Indian refiners reference Brent, watch spread for margin impact.", crudeChg, brentChg));
        }

        // Extreme fear
        if (goldChg > 2 && dxyChg > 0.5) {
            inferences.add(String.format("Gold +%.1f%% WITH strong dollar +%.1f%% — extreme global fear (flight to safety). Tomorrow: reduce equity exposure, hold gold, avoid aggressive entries.", goldChg, dxyChg));
        }

        // USDINR impact
        if (usdInrChg < -0.5) {
            inferences.add(String.format("Rupee strengthening (USDINR %.1f%%) — favorable for FII, reduces import costs. Oil marketing companies benefit double (crude + rupee).", usdInrChg));
        } else if (usdInrChg > 0.5) {
            inferences.add(String.format("Rupee weakening (USDINR +%.1f%%) — IT sector benefits, but import-heavy sectors (oil, electronics) hurt.", usdInrChg));
        }

        return CommoditySignals.builder().commodities(commodities).inferences(inferences).build();
    }

    private CommoditySignals.CommodityPrice commodity(String name, double price, double changePct) {
        return CommoditySignals.CommodityPrice.builder()
            .name(name).price(price).changePct(changePct)
            .direction(changePct > 0.3 ? "UP" : changePct < -0.3 ? "DOWN" : "FLAT")
            .build();
    }

    private List<SectorIndex> computeSectorIndices() {
        // TODO: Read live Nifty sector indices from Redis (after subscription is added)
        return List.of(); // Placeholder — will be populated after Streaming Candle adds sector index ticks
    }

    private AsianMarkets computeAsianMarkets(MarketPulseService.MacroSnapshot snap) {
        // Read from Redis (populated by GlobalIndicesPoller from FastAnalytics yfinance)
        double ass = readDouble("asian:sentiment:score", 0);
        String regime = readString("asian:sentiment:regime", "NEUTRAL");

        // Prices + change% live under global:indices:{name}:{field} (Phase 3 unified pattern)
        double nikkeiPx = readDouble("global:indices:nikkei:price", 0);
        double nikkei   = readDouble("global:indices:nikkei:changePct", 0);
        double hsPx     = readDouble("global:indices:hangseng:price", 0);
        double hangSeng = readDouble("global:indices:hangseng:changePct", 0);
        double shPx     = readDouble("global:indices:shanghai:price", 0);
        double shanghai = readDouble("global:indices:shanghai:changePct", 0);
        double ksPx     = readDouble("global:indices:kospi:price", 0);
        double kospi    = readDouble("global:indices:kospi:changePct", 0);

        // Backwards-compat fallback: asian:sentiment:indices JSON blob
        if (nikkei == 0 && hangSeng == 0 && shanghai == 0 && kospi == 0) {
            String indicesJson = readString("asian:sentiment:indices", null);
            if (indicesJson != null) {
                try {
                    Map<String, Object> indices = mapper.readValue(indicesJson, Map.class);
                    nikkei = toDouble(indices.get("nikkei"));
                    hangSeng = toDouble(indices.get("hangSeng"));
                    shanghai = toDouble(indices.get("shanghai"));
                    kospi = toDouble(indices.get("kospi"));
                } catch (Exception ignored) {}
            }
        }

        String inference;
        boolean hasData = nikkei != 0 || hangSeng != 0 || shanghai != 0 || kospi != 0;
        if (!hasData) {
            // No scraper yet — use GIFT Nifty as proxy
            double giftChg = snap != null ? snap.getGiftNiftyChangePct() : 0;
            if (giftChg > 0.5) {
                inference = String.format("Asian data unavailable. GIFT Nifty +%.1f%% suggests positive Asian cues. Use as directional proxy for opening.", giftChg);
            } else if (giftChg < -0.5) {
                inference = String.format("Asian data unavailable. GIFT Nifty %.1f%% suggests negative Asian cues. Cautious opening expected.", giftChg);
            } else {
                inference = "Asian data unavailable. GIFT Nifty flat — no strong directional signal from global futures.";
            }
        } else if (ass > 1.5) {
            inference = String.format("All Asian markets strongly green (Nikkei %+.1f%%, Hang Seng %+.1f%%). Favorable for India. FII likely buying tomorrow.", nikkei, hangSeng);
        } else if (ass > 0.5) {
            inference = "Asian markets mildly green. Supportive backdrop for Indian equities.";
        } else if (ass < -1.5) {
            inference = String.format("Asian markets sharply red (Nikkei %+.1f%%, Hang Seng %+.1f%%). Expect selling pressure at opening.", nikkei, hangSeng);
        } else if (ass < -0.5) {
            inference = "Asian markets mildly red. Cautious opening expected.";
        } else {
            inference = "Asian markets mixed. No strong directional signal for India.";
        }

        return AsianMarkets.builder()
            .nikkeiPrice(nikkeiPx).nikkeiChangePct(nikkei)
            .hangSengPrice(hsPx).hangSengChangePct(hangSeng)
            .shanghaiPrice(shPx).shanghaiChangePct(shanghai)
            .kospiPrice(ksPx).kospiChangePct(kospi)
            .assScore(ass).regime(regime).inference(inference)
            .build();
    }

    private FiiDiiIntelligence computeFiiDiiIntelligence(List<Map<String, Object>> fiiDiiDays) {
        double fiiNetToday = 0, diiNetToday = 0, fiiNetWeek = 0, diiNetWeek = 0;

        if (!fiiDiiDays.isEmpty()) {
            var latest = fiiDiiDays.get(0);
            var fii = (Map<String, Object>) latest.get("FII");
            var dii = (Map<String, Object>) latest.get("DII");
            if (fii != null) fiiNetToday = toDouble(fii.get("netValue"));
            if (dii != null) diiNetToday = toDouble(dii.get("netValue"));
        }

        for (var day : fiiDiiDays) {
            var fii = (Map<String, Object>) day.get("FII");
            var dii = (Map<String, Object>) day.get("DII");
            if (fii != null) fiiNetWeek += toDouble(fii.get("netValue"));
            if (dii != null) diiNetWeek += toDouble(dii.get("netValue"));
        }

        int sellingStreak = countFiiSellingStreak(fiiDiiDays);

        // ── Build rich forward-looking narrative ──
        List<String> narParts = new ArrayList<>();

        // What happened this week
        if (fiiNetWeek < -10000 && diiNetWeek > 10000) {
            double absorptionRatio = Math.abs(diiNetWeek / fiiNetWeek * 100);
            narParts.add(String.format("FII sold %.0f Cr this week but DII absorbed %.0f Cr (%.0f%% coverage). Market floor solid — this is rebalancing, not panic.",
                Math.abs(fiiNetWeek), diiNetWeek, Math.min(absorptionRatio, 200)));
        } else if (fiiNetWeek < -10000 && diiNetWeek < 0) {
            narParts.add(String.format("Both FII (%.0f Cr) and DII (%.0f Cr) selling this week. Broad institutional de-risking. Reduce exposure.", fiiNetWeek, diiNetWeek));
        } else if (fiiNetWeek > 0 && diiNetWeek > 0) {
            narParts.add(String.format("Both FII (+%.0f Cr) and DII (+%.0f Cr) buying this week. Strongest conviction signal — institutions aligned.", fiiNetWeek, diiNetWeek));
        } else if (fiiNetWeek > 5000) {
            narParts.add(String.format("FII buying +%.0f Cr this week. Foreign confidence returning after extended selling.", fiiNetWeek));
        } else if (Math.abs(fiiNetWeek) < 3000 && Math.abs(diiNetWeek) < 3000) {
            narParts.add("Institutional flows balanced this week — no strong directional bias from FII or DII.");
        }

        // Selling streak context
        if (sellingStreak >= 5) {
            narParts.add(String.format("FII selling streak at %d sessions — historically, streaks >5 days often exhaust and reverse. Watch for FII turning buyer.", sellingStreak));
        } else if (sellingStreak >= 3) {
            narParts.add(String.format("FII selling for %d straight sessions. If DII continues absorbing, expect support to hold.", sellingStreak));
        }

        // Tomorrow thesis
        if (fiiNetWeek < -10000 && diiNetWeek > 10000) {
            narParts.add("Tomorrow: DII-supported sectors (Banking, FMCG, Auto) safer. FII-heavy sectors (IT, Pharma large caps) may see continued selling.");
        } else if (fiiNetWeek > 0 && diiNetWeek > 0) {
            narParts.add("Tomorrow: aggressive positioning justified. Both institutional pillars buying — broad market likely to trend up.");
        } else if (fiiNetWeek < -10000 && diiNetWeek < 0) {
            narParts.add("Tomorrow: stay defensive. Cash is a position. Only high-conviction setups with tight SLs.");
        }

        String narrative = narParts.isEmpty() ? "Mixed institutional flows. No clear signal for tomorrow." : String.join(" ", narParts);

        return FiiDiiIntelligence.builder()
            .fiiNetToday(fiiNetToday).diiNetToday(diiNetToday)
            .fiiNetWeek(fiiNetWeek).diiNetWeek(diiNetWeek)
            .fiiSellingStreak(sellingStreak).diiBuyingStreak(0)
            .narrative(narrative).dailyBreakdown(fiiDiiDays)
            .build();
    }

    // ══════════════════════════════════════════════════════════════
    //  PHASE 5+6: Institutional Activity (Tab 4)
    //  Aggregates today's block + bulk deals into security-wise and fund-wise
    //  views, with a Wyckoff-style divergence engine that flags
    //  ACCUMULATION (institutional buy + retail sell) and
    //  DISTRIBUTION (institutional sell + retail buy) patterns.
    // ══════════════════════════════════════════════════════════════
    @SuppressWarnings("unchecked")
    private MarketPulseInsightsDTO.InstitutionalActivity computeInstitutionalActivity(
            List<Map<String, Object>> blockDeals,
            List<Map<String, Object>> bulkDeals,
            Map<String, Object> deliveryData) {
        try {
            // Find the most recent _date present in deals — that's our "today" of record.
            String dataDate = null;
            for (var d : blockDeals) { var s = (String) d.get("_date"); if (s != null && (dataDate == null || s.compareTo(dataDate) > 0)) dataDate = s; }
            for (var d : bulkDeals)  { var s = (String) d.get("_date"); if (s != null && (dataDate == null || s.compareTo(dataDate) > 0)) dataDate = s; }
            final String latestDate = dataDate;

            // Filter to deals from the latest date only
            List<Map<String, Object>> all = new ArrayList<>();
            if (blockDeals != null) for (var d : blockDeals) if (latestDate == null || latestDate.equals(d.get("_date"))) all.add(d);
            if (bulkDeals != null)  for (var d : bulkDeals)  if (latestDate == null || latestDate.equals(d.get("_date"))) all.add(d);

            // ── Aggregate by symbol ──
            Map<String, SecurityAgg> bySym = new LinkedHashMap<>();
            for (var d : all) {
                String symbol = trimUpper((String) d.get("symbol"));
                if (symbol == null || symbol.isEmpty()) continue;
                String name = nullSafe((String) d.getOrDefault("name", d.get("securityName")));
                String client = nullSafe((String) d.get("clientName"));
                String side = nullSafe((String) d.get("buySell")).toUpperCase();
                double valueCr = toDouble(d.get("valueCr"));
                String type = classifyClient(client);

                SecurityAgg agg = bySym.computeIfAbsent(symbol, k -> {
                    SecurityAgg a = new SecurityAgg();
                    a.symbol = k;
                    a.companyName = name;
                    a.sector = classifySector(k + " " + nullSafe(name));
                    return a;
                });
                agg.dealCount++;
                if (valueCr > agg.topDealCr) agg.topDealCr = valueCr;
                boolean isBuy = side.contains("BUY");

                if (isBuy) {
                    agg.buyCr += valueCr;
                    if (valueCr > agg.topBuyValueCr) { agg.topBuyValueCr = valueCr; agg.topBuyer = client; }
                } else {
                    agg.sellCr += valueCr;
                    if (valueCr > agg.topSellValueCr) { agg.topSellValueCr = valueCr; agg.topSeller = client; }
                }

                double signed = isBuy ? valueCr : -valueCr;
                switch (type) {
                    case "FII": agg.fiiNet += signed; break;
                    case "DII": agg.diiNet += signed; break;
                    case "PROP_BROKER": agg.propNet += signed; break;
                    default: agg.otherNet += signed; break;
                }
            }

            // ── Per-symbol delivery% lookup ──
            Map<String, Double> deliveryBySym = new HashMap<>();
            Map<String, Double> deliveryBySector = new HashMap<>();
            if (deliveryData != null) {
                Object bs = deliveryData.get("bySymbol");
                if (bs instanceof Map) {
                    for (var e : ((Map<String, Object>) bs).entrySet()) {
                        deliveryBySym.put(trimUpper(e.getKey()), toDouble(e.getValue()));
                    }
                }
                Object sectors = deliveryData.get("sectors");
                if (sectors instanceof Map) {
                    for (var e : ((Map<String, Object>) sectors).entrySet()) {
                        var sd = (Map<String, Object>) e.getValue();
                        deliveryBySector.put(e.getKey(), toDouble(sd.get("deliveryPct")));
                    }
                }
            }

            // Compute sector net flow direction (used for sector-confirmation gate)
            Map<String, Double> sectorNet = new HashMap<>();
            for (var agg : bySym.values()) {
                sectorNet.merge(agg.sector, agg.fiiNet + agg.diiNet, Double::sum);
            }

            // ── Build SecurityActivity entries with divergence engine ──
            List<MarketPulseInsightsDTO.InstitutionalActivity.SecurityActivity> securities = new ArrayList<>();
            int accumCount = 0;
            int distCount = 0;
            double totalValue = 0;
            for (var agg : bySym.values()) {
                double netCr = agg.buyCr - agg.sellCr;
                double instNet = agg.fiiNet + agg.diiNet;          // institutional net
                double deliv = deliveryBySym.getOrDefault(agg.symbol, 0.0);
                double sectorDeliv = deliveryBySector.getOrDefault(agg.sector, 50.0);
                double sectorMedian = sectorDeliv;
                double sectorFlow = sectorNet.getOrDefault(agg.sector, 0.0);
                totalValue += Math.abs(netCr);

                DivergenceResult dr = computeDivergence(agg, instNet, deliv, sectorMedian, sectorFlow);
                if ("ACCUMULATION".equals(dr.state)) accumCount++;
                if ("DISTRIBUTION".equals(dr.state)) distCount++;

                securities.add(MarketPulseInsightsDTO.InstitutionalActivity.SecurityActivity.builder()
                    .symbol(agg.symbol)
                    .sector(agg.sector)
                    .netCr(round2(netCr))
                    .fiiNetCr(round2(agg.fiiNet))
                    .diiNetCr(round2(agg.diiNet))
                    .propNetCr(round2(agg.propNet))
                    .otherNetCr(round2(agg.otherNet))
                    .dealCount(agg.dealCount)
                    .topDealCr(round2(agg.topDealCr))
                    .deliveryPct(round2(deliv))
                    .sectorDeliveryPct(round2(sectorMedian))
                    .topBuyer(truncateName(agg.topBuyer))
                    .topSeller(truncateName(agg.topSeller))
                    .divergenceState(dr.state)
                    .divergenceConfidence(dr.confidence)
                    .divergenceReasons(dr.reasons)
                    .inference(dr.inference)
                    .build());
            }
            // Sort by abs(netCr) desc
            securities.sort((a, b) -> Double.compare(Math.abs(b.getNetCr()), Math.abs(a.getNetCr())));

            // ── Aggregate by client name ──
            Map<String, ClientAgg> byClient = new LinkedHashMap<>();
            for (var d : all) {
                String client = nullSafe((String) d.get("clientName"));
                if (client.isEmpty()) continue;
                String symbol = trimUpper((String) d.get("symbol"));
                String side = nullSafe((String) d.get("buySell")).toUpperCase();
                double valueCr = toDouble(d.get("valueCr"));
                boolean isBuy = side.contains("BUY");

                ClientAgg agg = byClient.computeIfAbsent(client, k -> {
                    ClientAgg a = new ClientAgg();
                    a.name = k;
                    a.type = classifyClient(k);
                    return a;
                });
                agg.dealCount++;
                if (isBuy) {
                    agg.buyCr += valueCr;
                    agg.buySymbols.merge(symbol, valueCr, Double::sum);
                } else {
                    agg.sellCr += valueCr;
                    agg.sellSymbols.merge(symbol, valueCr, Double::sum);
                }
            }

            List<MarketPulseInsightsDTO.InstitutionalActivity.ClientFlow> clients = new ArrayList<>();
            for (var agg : byClient.values()) {
                double netCr = agg.buyCr - agg.sellCr;
                List<String> topBuy = agg.buySymbols.entrySet().stream()
                    .sorted((a, b) -> Double.compare(b.getValue(), a.getValue()))
                    .limit(5).map(Map.Entry::getKey).collect(Collectors.toList());
                List<String> topSell = agg.sellSymbols.entrySet().stream()
                    .sorted((a, b) -> Double.compare(b.getValue(), a.getValue()))
                    .limit(5).map(Map.Entry::getKey).collect(Collectors.toList());

                String inference;
                if (agg.buyCr > 0 && agg.sellCr == 0) inference = "Pure buyer · added " + (int) Math.round(netCr) + " Cr";
                else if (agg.sellCr > 0 && agg.buyCr == 0) inference = "Pure seller · trimmed " + (int) Math.round(Math.abs(netCr)) + " Cr";
                else if (Math.abs(netCr) < 1) inference = "Two-sided · churning";
                else if (netCr > 0) inference = "Net buyer · accumulating " + (int) Math.round(netCr) + " Cr";
                else inference = "Net seller · distributing " + (int) Math.round(Math.abs(netCr)) + " Cr";

                clients.add(MarketPulseInsightsDTO.InstitutionalActivity.ClientFlow.builder()
                    .name(truncateName(agg.name))
                    .type(agg.type)
                    .buyCr(round2(agg.buyCr))
                    .sellCr(round2(agg.sellCr))
                    .netCr(round2(netCr))
                    .dealCount(agg.dealCount)
                    .topBuySymbols(topBuy)
                    .topSellSymbols(topSell)
                    .inference(inference)
                    .build());
            }
            clients.sort((a, b) -> Double.compare(Math.abs(b.getNetCr()), Math.abs(a.getNetCr())));

            // ── Headline summary ──
            String headline;
            if (accumCount > 0 && distCount == 0) {
                headline = String.format("%d security(s) showing institutional accumulation. Watch for follow-through next session.", accumCount);
            } else if (distCount > 0 && accumCount == 0) {
                headline = String.format("%d security(s) showing institutional distribution. Caution on long entries.", distCount);
            } else if (accumCount > 0 && distCount > 0) {
                headline = String.format("Mixed: %d accumulation, %d distribution. Stock-pick over index plays.", accumCount, distCount);
            } else {
                headline = String.format("%d institutional deals across %d securities, no strong divergence patterns.", all.size(), bySym.size());
            }

            return MarketPulseInsightsDTO.InstitutionalActivity.builder()
                .bySecurity(securities)
                .byClient(clients)
                .totalDealsCount(all.size())
                .totalDealValueCr(round2(totalValue))
                .accumulationCount(accumCount)
                .distributionCount(distCount)
                .headlineSummary(headline)
                .dataDate(latestDate)
                .build();
        } catch (Exception e) {
            log.error("[INSIGHTS] computeInstitutionalActivity failed: {}", e.getMessage(), e);
            return MarketPulseInsightsDTO.InstitutionalActivity.builder()
                .bySecurity(List.of()).byClient(List.of())
                .totalDealsCount(0).totalDealValueCr(0)
                .headlineSummary("Institutional activity unavailable")
                .build();
        }
    }

    // ── Wyckoff Divergence Engine ──
    // Multi-gate validation (the framework agreed earlier).
    // Available gates given our data: institutional net Cr magnitude, FII+DII alignment,
    // delivery% vs sector median, sector confirmation. We don't have intraday volume or
    // daily turnover so the volume gate is approximated by deal-count and net-Cr magnitude.
    private DivergenceResult computeDivergence(SecurityAgg agg, double instNet, double deliv,
                                                double sectorMedian, double sectorFlow) {
        DivergenceResult r = new DivergenceResult();
        r.reasons = new ArrayList<>();

        if (Math.abs(instNet) < 2.0) {
            // Too small to be a meaningful institutional move
            r.state = "NEUTRAL";
            r.confidence = "NONE";
            r.inference = "Routine flow";
            return r;
        }

        boolean fiiPositive = agg.fiiNet > 0.5;
        boolean diiPositive = agg.diiNet > 0.5;
        boolean fiiNegative = agg.fiiNet < -0.5;
        boolean diiNegative = agg.diiNet < -0.5;

        // Determine direction
        boolean isBuyDivergence = instNet > 0;
        boolean isSellDivergence = instNet < 0;

        int gates = 0;

        // Gate 1: Magnitude (≥5 Cr is meaningful institutional size)
        if (Math.abs(instNet) >= 5) { gates++; r.reasons.add("Size " + (int) Math.round(Math.abs(instNet)) + " Cr"); }

        // Gate 2: FII + DII same side (high-conviction signal when both align)
        if ((fiiPositive && diiPositive) || (fiiNegative && diiNegative)) {
            gates++; r.reasons.add("FII+DII aligned");
        } else if ((fiiPositive && !diiNegative) || (fiiNegative && !diiPositive)
                || (diiPositive && !fiiNegative) || (diiNegative && !fiiPositive)) {
            // Half-credit: one side strong, other neutral
            r.reasons.add("Single-side flow");
        }

        // Gate 3: Delivery% vs sector — accumulation with high delivery is highest quality
        if (isBuyDivergence && deliv > Math.max(50, sectorMedian)) {
            gates++; r.reasons.add(String.format("Delivery %.0f%% > sector %.0f%%", deliv, sectorMedian));
        } else if (isSellDivergence && deliv < 35) {
            gates++; r.reasons.add(String.format("Delivery %.0f%% (speculative)", deliv));
        } else if (isSellDivergence && deliv > 55) {
            // Distribution into strength — institutions selling, retail absorbing
            gates++; r.reasons.add(String.format("Delivery %.0f%% — retail absorbing", deliv));
        }

        // Gate 4: Sector confirmation (same direction sector-wide)
        if (isBuyDivergence && sectorFlow > 5) { gates++; r.reasons.add("Sector buying"); }
        if (isSellDivergence && sectorFlow < -5) { gates++; r.reasons.add("Sector selling"); }

        // Gate 5: Deal count (multiple deals = sustained interest)
        if (agg.dealCount >= 3) { gates++; r.reasons.add(agg.dealCount + " deals"); }

        // Final classification
        if (gates >= 4 && isBuyDivergence) {
            r.state = "ACCUMULATION";
            r.confidence = "STRONG";
            r.inference = String.format("🟢 STRONG accumulation · %s leading buys · BUY on next dip · stop -3%%", trimName(agg.topBuyer));
        } else if (gates >= 4 && isSellDivergence) {
            r.state = "DISTRIBUTION";
            r.confidence = "STRONG";
            r.inference = String.format("🔴 STRONG distribution · %s leading sells · AVOID longs · SHORT-bias", trimName(agg.topSeller));
        } else if (gates == 3 && isBuyDivergence) {
            r.state = "ACCUMULATION";
            r.confidence = "MODERATE";
            r.inference = "🟡 Moderate accumulation · watch for follow-through next session";
        } else if (gates == 3 && isSellDivergence) {
            r.state = "DISTRIBUTION";
            r.confidence = "MODERATE";
            r.inference = "🟠 Moderate distribution · tighten stops on existing longs";
        } else if (gates == 2) {
            r.state = isBuyDivergence ? "ACCUMULATION" : "DISTRIBUTION";
            r.confidence = "WEAK";
            r.inference = String.format("Weak %s · low conviction · wait for confirmation",
                isBuyDivergence ? "buying" : "selling");
        } else {
            r.state = "NEUTRAL";
            r.confidence = "NONE";
            r.inference = String.format("Routine %s · no edge",
                isBuyDivergence ? "institutional buy" : "institutional sell");
        }
        return r;
    }

    private String trimName(String name) {
        if (name == null || name.isEmpty()) return "Institution";
        String[] parts = name.split("\\s+");
        return parts[0]; // First word = brand name typically
    }
    private String truncateName(String name) {
        if (name == null) return null;
        return name.length() > 50 ? name.substring(0, 47) + "…" : name;
    }
    private String trimUpper(String s) { return s == null ? null : s.trim().toUpperCase(); }
    private String nullSafe(String s) { return s == null ? "" : s; }

    private static class SecurityAgg {
        String symbol;
        String companyName;
        String sector;
        double buyCr = 0, sellCr = 0;
        double fiiNet = 0, diiNet = 0, propNet = 0, otherNet = 0;
        int dealCount = 0;
        double topDealCr = 0;
        double topBuyValueCr = 0, topSellValueCr = 0;
        String topBuyer, topSeller;
    }
    private static class ClientAgg {
        String name;
        String type;
        double buyCr = 0, sellCr = 0;
        int dealCount = 0;
        Map<String, Double> buySymbols = new HashMap<>();
        Map<String, Double> sellSymbols = new HashMap<>();
    }
    private static class DivergenceResult {
        String state;            // ACCUMULATION/DISTRIBUTION/NEUTRAL
        String confidence;       // STRONG/MODERATE/WEAK/NONE
        List<String> reasons;
        String inference;
    }

    @SuppressWarnings("unchecked")
    private DealIntelligence computeDealIntelligence(List<Map<String, Object>> blockDeals,
                                                      List<Map<String, Object>> bulkDeals,
                                                      List<Map<String, Object>> corpEvents,
                                                      Map<String, Object> deliveryData) {
        // Read pre-computed watchlist from Redis (FastAnalytics)
        List<DealIntelligence.WatchlistItem> watchlist = new ArrayList<>();
        try {
            String wlJson = redis.opsForValue().get("market-pulse:premarket-watchlist");
            if (wlJson != null) {
                List<Map<String, Object>> wlData = mapper.readValue(wlJson, List.class);
                for (var w : wlData) {
                    watchlist.add(DealIntelligence.WatchlistItem.builder()
                        .symbol((String) w.get("symbol"))
                        .bias((String) w.get("bias"))
                        .score(toDouble(w.get("score")))
                        .conviction((String) w.get("conviction"))
                        .fnoEligible(Boolean.TRUE.equals(w.get("fnoEligible")))
                        .netCr(toDouble(w.get("netCr")))
                        .reasons((List<String>) w.getOrDefault("reasons", List.of()))
                        .build());
                }
            }
        } catch (Exception e) {
            log.debug("[INSIGHTS] Failed to read watchlist: {}", e.getMessage());
        }

        // Aggregate deals by sector
        List<DealIntelligence.SectorFlow> sectorFlows = computeSectorFlows(blockDeals, bulkDeals, deliveryData);

        // Top clients
        List<DealIntelligence.ClientActivity> topClients = computeTopClients(blockDeals, bulkDeals);

        // Top stocks
        List<DealIntelligence.StockDeal> topStocks = computeTopStocks(blockDeals, bulkDeals);

        double totalDealVol = blockDeals.stream().mapToDouble(d -> toDouble(d.get("valueCr"))).sum()
            + bulkDeals.stream().mapToDouble(d -> toDouble(d.get("valueCr"))).sum();

        // ── Deal insights: name stocks, give direction, flag F&O ──
        List<String> insights = new ArrayList<>();

        // Repeat stocks — name them with direction
        var repeatStocks = topStocks.stream().filter(s -> s.getDateCount() >= 3).collect(Collectors.toList());
        if (!repeatStocks.isEmpty()) {
            for (var s : repeatStocks) {
                String dir = s.getNetCr() > 0 ? "accumulation (net +" + formatCr(s.getNetCr()) + ")" : "distribution (net " + formatCr(s.getNetCr()) + ")";
                insights.add(s.getSymbol() + ": " + s.getDateCount() + "-day " + dir + " pattern.");
            }
        }

        // F&O eligible watchlist stocks — actionable tomorrow
        var fnoWatchlist = watchlist.stream().filter(DealIntelligence.WatchlistItem::isFnoEligible).collect(Collectors.toList());
        if (!fnoWatchlist.isEmpty()) {
            var names = fnoWatchlist.stream()
                .map(w -> w.getSymbol() + " (" + w.getBias() + ")")
                .collect(Collectors.joining(", "));
            insights.add("F&O actionable tomorrow: " + names + ".");
        }
        if (fnoWatchlist.isEmpty() && !watchlist.isEmpty()) {
            insights.add("No F&O-eligible stocks in smart money watchlist — watchlist stocks are cash-only (not tradeable by option strategies).");
        }

        // Large deal volume context
        if (totalDealVol > 5000) {
            insights.add(String.format("Heavy institutional activity: %.0f Cr across %d deals — significant positioning ahead of next session.", totalDealVol, blockDeals.size() + bulkDeals.size()));
        }

        return DealIntelligence.builder()
            .blockDealCount(blockDeals.size()).bulkDealCount(bulkDeals.size())
            .totalDealVolumeCr(Math.round(totalDealVol * 10) / 10.0)
            .watchlist(watchlist).sectorFlows(sectorFlows)
            .topClients(topClients).topStocks(topStocks)
            .dealInsights(insights)
            .build();
    }

    @SuppressWarnings("unchecked")
    private List<DealIntelligence.SectorFlow> computeSectorFlows(List<Map<String, Object>> blockDeals,
                                                                   List<Map<String, Object>> bulkDeals,
                                                                   Map<String, Object> deliveryData) {
        // Phase 7c: bulk-deals API returns 5 trading days. The headline netCr should reflect
        // the LATEST date only (so it matches the trader's mental model "what happened today");
        // the 5-day aggregate is exposed separately as weekTotalCr for context.
        String latestDate = null;
        for (var d : blockDeals) { var s = (String) d.get("_date"); if (s != null && (latestDate == null || s.compareTo(latestDate) > 0)) latestDate = s; }
        for (var d : bulkDeals)  { var s = (String) d.get("_date"); if (s != null && (latestDate == null || s.compareTo(latestDate) > 0)) latestDate = s; }
        final String dateOfRecord = latestDate;

        // Per-sector running totals (FII/DII/Other buy+sell + deal count) — TODAY ONLY
        Map<String, double[]> sectorAgg = new LinkedHashMap<>();
        // Per-sector → per-symbol stats — TODAY ONLY
        Map<String, Map<String, double[]>> sectorBySymbol = new LinkedHashMap<>();
        // Per-sector → per-client net Cr — TODAY ONLY
        Map<String, Map<String, Double>> sectorByClient = new LinkedHashMap<>();
        // Phase 8d: per-sector → per-symbol → per-client → [buyCr, sellCr] (for churn detection)
        Map<String, Map<String, Map<String, double[]>>> sectorBySymbolByClient = new LinkedHashMap<>();
        // Phase 8d: per-sector → per-client → [buyCr, sellCr] (for structured topClientFlows)
        Map<String, Map<String, double[]>> sectorByClientGross = new LinkedHashMap<>();
        // Phase 7c: 5-day cumulative net Cr per sector (separate from today)
        Map<String, Double> weekTotalBySector = new HashMap<>();

        // First pass: walk all 5 days to populate weekTotalBySector
        for (var d : blockDeals) accumulateWeekTotal(d, weekTotalBySector);
        for (var d : bulkDeals)  accumulateWeekTotal(d, weekTotalBySector);

        // Phase 8a: build per-symbol 5-day net Cr timeseries (across the entire deal window).
        // Sort all unique deal dates ascending so the series is oldest → newest.
        java.util.SortedSet<String> dateSet = new java.util.TreeSet<>();
        for (var d : blockDeals) { var s = (String) d.get("_date"); if (s != null) dateSet.add(s); }
        for (var d : bulkDeals)  { var s = (String) d.get("_date"); if (s != null) dateSet.add(s); }
        List<String> sortedDates = new ArrayList<>(dateSet);
        Map<String, Integer> dateIndex = new HashMap<>();
        for (int i = 0; i < sortedDates.size(); i++) dateIndex.put(sortedDates.get(i), i);
        Map<String, double[]> symbolDailyNet = new HashMap<>();  // symbol → [day0, day1, ..., dayN-1]
        for (var d : blockDeals) accumulateSymbolDaily(d, symbolDailyNet, dateIndex, sortedDates.size());
        for (var d : bulkDeals)  accumulateSymbolDaily(d, symbolDailyNet, dateIndex, sortedDates.size());

        // Second pass: aggregate ONLY the latest-date deals for the headline numbers
        for (var d : blockDeals) {
            if (latestDate == null || latestDate.equals(d.get("_date"))) {
                aggregateDealToSector(d, sectorAgg, sectorBySymbol, sectorByClient,
                    sectorBySymbolByClient, sectorByClientGross);
            }
        }
        for (var d : bulkDeals) {
            if (latestDate == null || latestDate.equals(d.get("_date"))) {
                aggregateDealToSector(d, sectorAgg, sectorBySymbol, sectorByClient,
                    sectorBySymbolByClient, sectorByClientGross);
            }
        }

        // Sector-wide delivery%
        Map<String, Double> deliveryBySector = new HashMap<>();
        if (deliveryData != null && deliveryData.get("sectors") != null) {
            var sectors = (Map<String, Object>) deliveryData.get("sectors");
            for (var entry : sectors.entrySet()) {
                var sectorData = (Map<String, Object>) entry.getValue();
                deliveryBySector.put(entry.getKey(), toDouble(sectorData.get("deliveryPct")));
            }
        }

        // ── Phase 7b: persist today's sector flows + read history for streak compute ──
        Map<String, Double> todayBySector = new LinkedHashMap<>();
        for (var entry : sectorAgg.entrySet()) {
            double[] v = entry.getValue();
            todayBySector.put(entry.getKey(), (v[0] - v[1]) + (v[2] - v[3]) + (v[4] - v[5]));
        }
        snapshotSectorFlows(todayBySector);
        Map<String, Integer> streaks = computeSectorStreaks(todayBySector);
        Map<String, String> streakDirs = computeSectorStreakDirections(todayBySector);

        List<DealIntelligence.SectorFlow> flows = new ArrayList<>();
        for (var entry : sectorAgg.entrySet()) {
            String sector = entry.getKey();
            double[] v = entry.getValue();
            double fiiNet = v[0] - v[1];
            double diiNet = v[2] - v[3];
            double net = fiiNet + diiNet + (v[4] - v[5]);
            double delivPct = deliveryBySector.getOrDefault(sector, 0.0);
            int daysFlowing = streaks.getOrDefault(sector, 1);
            String streakDir = streakDirs.getOrDefault(sector, net >= 0 ? "BUY" : "SELL");

            // Top stocks contributing to this sector's net flow + Phase 8d churn detection
            List<DealIntelligence.SectorFlow.StockContribution> topStocks = new ArrayList<>();
            var bySymbol = sectorBySymbol.getOrDefault(sector, Map.of());
            var symbolClientMap = sectorBySymbolByClient.getOrDefault(sector, Map.of());
            var sortedSymbols = bySymbol.entrySet().stream()
                .sorted((a, b) -> {
                    // Sort by gross volume (buy + sell) instead of pure net — gives churners visibility
                    double grossA = a.getValue()[0] + a.getValue()[1];
                    double grossB = b.getValue()[0] + b.getValue()[1];
                    return Double.compare(grossB, grossA);
                })
                .limit(3)
                .collect(Collectors.toList());
            double sectorChurnedSum = 0;  // for sector churn ratio
            double sectorGrossSum = 0;
            for (var s : sortedSymbols) {
                double symBuy = s.getValue()[0];
                double symSell = s.getValue()[1];
                double symNet = symBuy - symSell;
                double symGross = symBuy + symSell;
                double symDeals = s.getValue()[2];

                // Compute self-matched per client (sum of min(clientBuy, clientSell))
                // + Phase 8c: FII vs DII per-stock split for alignment classification
                var clientMap = symbolClientMap.getOrDefault(s.getKey(), Map.of());
                double selfMatched = 0;
                String dominantClient = null;
                double dominantGross = 0;
                double symFiiNet = 0;
                double symDiiNet = 0;
                for (var ce : clientMap.entrySet()) {
                    double cBuy = ce.getValue()[0];
                    double cSell = ce.getValue()[1];
                    selfMatched += Math.min(cBuy, cSell);
                    double cGross = cBuy + cSell;
                    if (cGross > dominantGross) { dominantGross = cGross; dominantClient = ce.getKey(); }
                    // Phase 8c: classify client and accumulate net per type
                    String cType = classifyClient(ce.getKey());
                    double cNet = cBuy - cSell;
                    if ("FII".equals(cType)) symFiiNet += cNet;
                    else if ("DII".equals(cType)) symDiiNet += cNet;
                }
                // churnRatio = fraction of gross that was self-matched (each matched ₹ counts on both sides → x2)
                double churnRatio = symGross > 0 ? Math.min(1.0, (2 * selfMatched) / symGross) : 0;

                // Phase 8c: FII/DII alignment classification (threshold 0.5 Cr to filter noise)
                String alignment = classifyFiiDiiAlignment(symFiiNet, symDiiNet);

                String flowQuality;
                if (churnRatio > 0.7) flowQuality = "CHURN";
                else if (Math.abs(symNet) > 5 && churnRatio < 0.3) flowQuality = "HIGH";
                else if (Math.abs(symNet) > 2) flowQuality = "MEDIUM";
                else flowQuality = "LOW";

                sectorChurnedSum += 2 * selfMatched;
                sectorGrossSum += symGross;

                // Phase 8a: 5-day daily series + pattern detection
                double[] dailySeriesArr = symbolDailyNet.getOrDefault(s.getKey(), new double[sortedDates.size()]);
                List<Double> dailySeries = new ArrayList<>();
                for (double dailyVal : dailySeriesArr) dailySeries.add(round1(dailyVal));
                String pattern = detectStockPattern(dailySeriesArr);

                topStocks.add(DealIntelligence.SectorFlow.StockContribution.builder()
                    .symbol(s.getKey())
                    .netCr(round1(symNet))
                    .grossCr(round1(symGross))
                    .churnRatio(Math.round(churnRatio * 100.0) / 100.0)
                    .flowQuality(flowQuality)
                    .dominantClient(truncateName(dominantClient))
                    .side(symNet >= 0 ? "BUY-NET" : "SELL-NET")
                    .dealCount((int) symDeals)
                    // Phase 8c
                    .fiiNetCr(round1(symFiiNet))
                    .diiNetCr(round1(symDiiNet))
                    .fiiDiiAlignment(alignment)
                    // Phase 8a
                    .dailyCrTimeseries(dailySeries)
                    .dailyDates(sortedDates)
                    .pattern(pattern)
                    .build());
            }
            double sectorChurnRatio = sectorGrossSum > 0 ? Math.min(1.0, sectorChurnedSum / sectorGrossSum) : 0;

            // Top clients in this sector — both legacy string list AND new structured list
            var clientMap = sectorByClient.getOrDefault(sector, Map.of());
            var clientGrossMap = sectorByClientGross.getOrDefault(sector, Map.of());
            // Sort by gross volume so churners surface (instead of by net which hides them)
            var sortedClients = clientGrossMap.entrySet().stream()
                .sorted((a, b) -> Double.compare(b.getValue()[0] + b.getValue()[1],
                                                  a.getValue()[0] + a.getValue()[1]))
                .limit(3)
                .collect(Collectors.toList());

            List<String> topClients = new ArrayList<>();
            List<DealIntelligence.SectorFlow.ClientFlowDetail> topClientFlows = new ArrayList<>();
            for (var ce : sortedClients) {
                String name = ce.getKey();
                double cBuy = ce.getValue()[0];
                double cSell = ce.getValue()[1];
                double cNet = cBuy - cSell;
                double cGross = cBuy + cSell;
                double cChurn = cGross > 0 ? Math.min(1.0, (2 * Math.min(cBuy, cSell)) / cGross) : 0;
                String shortName = name.length() > 35 ? name.substring(0, 32) + "…" : name;
                topClients.add(String.format("%s (%+.0f Cr)", shortName, cNet));
                topClientFlows.add(DealIntelligence.SectorFlow.ClientFlowDetail.builder()
                    .name(truncateName(name))
                    .type(classifyClient(name))
                    .buyCr(round1(cBuy))
                    .sellCr(round1(cSell))
                    .netCr(round1(cNet))
                    .churnRatio(Math.round(cChurn * 100.0) / 100.0)
                    .build());
            }

            // Phase 8d: if sector flow is mostly churn, override the regime to NEUTRAL/CHURN
            // (don't classify a churn-dominated sector as ACCUMULATION even if net Cr is positive)
            String regime;
            if (sectorChurnRatio > 0.7) {
                regime = "CHURN";
            } else if (net > 5 && delivPct > 50) regime = "ACCUMULATION";
            else if (net < -5 && delivPct > 50) regime = "DISTRIBUTION_INTO_STRENGTH";
            else if (net < -5 && delivPct < 35) regime = "DISTRIBUTION";
            else if (net > 5 && delivPct < 35) regime = "SPECULATIVE_BUYING";
            else if (Math.abs(net) > 5) regime = "MIXED";
            else regime = "NEUTRAL";

            String signal = generateSectorSignal(net, delivPct, v[0], v[1], v[2], v[3]);
            String inference = buildSectorInference(sector, net, delivPct, fiiNet, diiNet, regime, topStocks, topClients, daysFlowing, streakDir, sectorChurnRatio);
            String traderAction = buildTraderAction(regime, daysFlowing, streakDir, delivPct, net, topStocks, sectorChurnRatio, sector);

            flows.add(DealIntelligence.SectorFlow.builder()
                .sector(sector).netCr(Math.round(net * 10) / 10.0)
                .fiiBuyCr(round1(v[0])).fiiSellCr(round1(v[1]))
                .diiBuyCr(round1(v[2])).diiSellCr(round1(v[3]))
                .otherBuyCr(round1(v[4])).otherSellCr(round1(v[5])).dealCount((int) v[6])
                .deliveryPct(delivPct).signal(signal)
                .topStocks(topStocks).topClients(topClients)
                .regime(regime).inference(inference)
                .daysFlowing(daysFlowing).streakDirection(streakDir)
                .traderAction(traderAction)
                // Phase 7c
                .weekTotalCr(round1(weekTotalBySector.getOrDefault(sector, 0.0)))
                .dataDate(dateOfRecord)
                // Phase 8d
                .topClientFlows(topClientFlows)
                .sectorChurnRatio(Math.round(sectorChurnRatio * 100.0) / 100.0)
                .build());
        }

        flows.sort((a, b) -> Double.compare(Math.abs(b.getNetCr()), Math.abs(a.getNetCr())));
        return flows;
    }

    private double round1(double v) { return Math.round(v * 10) / 10.0; }

    // Phase 8a: accumulate per-symbol daily net Cr across the entire deal window.
    private void accumulateSymbolDaily(Map<String, Object> deal,
                                        Map<String, double[]> symbolDailyNet,
                                        Map<String, Integer> dateIndex,
                                        int seriesLength) {
        String symbol = trimUpper((String) deal.getOrDefault("symbol", ""));
        String date = (String) deal.get("_date");
        if (symbol == null || symbol.isEmpty() || date == null) return;
        Integer idx = dateIndex.get(date);
        if (idx == null) return;
        boolean isBuy = "BUY".equalsIgnoreCase(nullSafe((String) deal.getOrDefault("buySell", "")));
        double val = toDouble(deal.get("valueCr"));
        double signed = isBuy ? val : -val;
        var series = symbolDailyNet.computeIfAbsent(symbol, k -> new double[seriesLength]);
        series[idx] += signed;
    }

    // Phase 8a: classify the rhythm of a stock's 5-day flow.
    // SINGLE_DAY     = only one of N days has any meaningful net (one-off event)
    // BLOCK_EXIT     = one day dominates >70% of total absolute volume (single block trade)
    // PERSISTENT_BUYING / PERSISTENT_SELLING = 3+ days monotonic in one direction (institutional commitment)
    // SYSTEMATIC     = 3+ active days, mostly same direction, evenly spread (sustained pressure)
    // CHOPPY         = 2+ sign flips across the window (noise)
    // MIXED_2D       = exactly 2 active days, no clear pattern
    private String detectStockPattern(double[] series) {
        if (series == null || series.length == 0) return "SINGLE_DAY";
        int activeDays = 0;
        double sumAbs = 0;
        double maxAbs = 0;
        int posDays = 0;
        int negDays = 0;
        int signFlips = 0;
        double prevSign = 0;
        for (double v : series) {
            if (Math.abs(v) > 0.5) {
                activeDays++;
                sumAbs += Math.abs(v);
                if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
                double sign = Math.signum(v);
                if (v > 0) posDays++;
                if (v < 0) negDays++;
                if (prevSign != 0 && sign != prevSign) signFlips++;
                prevSign = sign;
            }
        }
        if (activeDays == 0) return "SINGLE_DAY";
        if (activeDays == 1) return "SINGLE_DAY";
        // BLOCK_EXIT — one day is 70%+ of total volume
        if (sumAbs > 0 && maxAbs / sumAbs >= 0.7) return "BLOCK_EXIT";
        // CHOPPY — multiple sign flips
        if (signFlips >= 2) return "CHOPPY";
        // PERSISTENT — 3+ days, all same direction
        if (posDays >= 3 && negDays == 0) return "PERSISTENT_BUYING";
        if (negDays >= 3 && posDays == 0) return "PERSISTENT_SELLING";
        // SYSTEMATIC — 3+ days mostly same direction
        if (activeDays >= 3) return "SYSTEMATIC";
        return "MIXED_2D";
    }

    // Phase 8c: classify per-stock FII vs DII alignment.
    // 0.5 Cr threshold filters out noise (single tiny deal) so a stock with FII +0.1 / DII +0.1 isn't flagged.
    private String classifyFiiDiiAlignment(double fiiNet, double diiNet) {
        boolean fiiBuy  = fiiNet >  0.5;
        boolean fiiSell = fiiNet < -0.5;
        boolean diiBuy  = diiNet >  0.5;
        boolean diiSell = diiNet < -0.5;
        if (fiiBuy && diiBuy)  return "FII_DII_BUY";        // both buying = highest conviction long
        if (fiiSell && diiSell) return "FII_DII_SELL";       // both selling = highest conviction short
        if (fiiSell && diiBuy)  return "FII_SELL_DII_BUY";   // accumulation pattern (DII absorbing FII)
        if (fiiBuy && diiSell)  return "FII_BUY_DII_SELL";   // distribution pattern (FII selling into DII)
        if (fiiBuy)  return "FII_ONLY_BUY";
        if (fiiSell) return "FII_ONLY_SELL";
        if (diiBuy)  return "DII_ONLY_BUY";
        if (diiSell) return "DII_ONLY_SELL";
        return "NO_INST";  // only OTHER/PROP_BROKER activity, no real institutional bias
    }

    // Phase 7c: walks the entire 5-day deal window and accumulates per-sector net Cr
    // for the weekTotalCr context field. Independent of the today-only aggregation path.
    private void accumulateWeekTotal(Map<String, Object> deal, Map<String, Double> weekTotalBySector) {
        String symbol = trimUpper((String) deal.getOrDefault("symbol", ""));
        String name = (String) deal.getOrDefault("securityName", deal.getOrDefault("name", ""));
        String buySell = nullSafe((String) deal.getOrDefault("buySell", "")).toUpperCase();
        double val = toDouble(deal.get("valueCr"));
        String sector = classifySector(symbol + " " + nullSafe(name));
        double signed = buySell.contains("BUY") ? val : -val;
        weekTotalBySector.merge(sector, signed, Double::sum);
    }

    private void aggregateDealToSector(Map<String, Object> deal,
                                        Map<String, double[]> sectorAgg,
                                        Map<String, Map<String, double[]>> sectorBySymbol,
                                        Map<String, Map<String, Double>> sectorByClient,
                                        Map<String, Map<String, Map<String, double[]>>> sectorBySymbolByClient,
                                        Map<String, Map<String, double[]>> sectorByClientGross) {
        String symbol = trimUpper((String) deal.getOrDefault("symbol", ""));
        String name = (String) deal.getOrDefault("securityName", deal.getOrDefault("name", ""));
        String client = nullSafe((String) deal.getOrDefault("clientName", ""));
        String buySell = nullSafe((String) deal.getOrDefault("buySell", ""));
        double val = toDouble(deal.get("valueCr"));

        String sector = classifySector(symbol + " " + name);
        String clientType = classifyClient(client);

        sectorAgg.computeIfAbsent(sector, k -> new double[7]);
        double[] v = sectorAgg.get(sector);
        v[6]++;

        boolean isBuy = "BUY".equalsIgnoreCase(buySell);
        switch (clientType) {
            case "FII" -> { if (isBuy) v[0] += val; else v[1] += val; }
            case "DII" -> { if (isBuy) v[2] += val; else v[3] += val; }
            default -> { if (isBuy) v[4] += val; else v[5] += val; }
        }

        // Per-symbol contribution (buy, sell, dealCount)
        var bySymbol = sectorBySymbol.computeIfAbsent(sector, k -> new HashMap<>());
        var symStats = bySymbol.computeIfAbsent(symbol, k -> new double[3]);
        if (isBuy) symStats[0] += val; else symStats[1] += val;
        symStats[2]++;

        // Per-client contribution (signed Cr)
        if (!client.isEmpty()) {
            var byClient = sectorByClient.computeIfAbsent(sector, k -> new HashMap<>());
            byClient.merge(client, isBuy ? val : -val, Double::sum);

            // Phase 8d: per-symbol per-client buy/sell tracking
            var bySymByClient = sectorBySymbolByClient.computeIfAbsent(sector, k -> new HashMap<>());
            var symClientMap = bySymByClient.computeIfAbsent(symbol, k -> new HashMap<>());
            var clientStats = symClientMap.computeIfAbsent(client, k -> new double[2]);
            if (isBuy) clientStats[0] += val; else clientStats[1] += val;

            // Phase 8d: per-sector per-client gross tracking (buy, sell)
            var byClientGross = sectorByClientGross.computeIfAbsent(sector, k -> new HashMap<>());
            var grossStats = byClientGross.computeIfAbsent(client, k -> new double[2]);
            if (isBuy) grossStats[0] += val; else grossStats[1] += val;
        }
    }

    // Phase 7+8d: richer sector inference referencing top stocks + clients + streak + churn
    private String buildSectorInference(String sector, double net, double delivPct,
                                         double fiiNet, double diiNet, String regime,
                                         List<DealIntelligence.SectorFlow.StockContribution> topStocks,
                                         List<String> topClients,
                                         int daysFlowing, String streakDirection,
                                         double sectorChurnRatio) {
        StringBuilder sb = new StringBuilder();

        // Phase 8d: CHURN regime trumps everything else
        if ("CHURN".equals(regime)) {
            sb.append("⚠ NO EDGE · prop market-making (").append((int) (sectorChurnRatio * 100))
              .append("% self-matched) · liquidity provision, not directional flow");
            if (!topStocks.isEmpty()) {
                var top = topStocks.get(0);
                sb.append(" · churned by ").append(top.getDominantClient() != null ? top.getDominantClient() : "single broker")
                  .append(" on ").append(top.getSymbol());
            }
            return sb.toString();
        }

        // Streak intensifier prefix
        if (daysFlowing >= 4) sb.append(daysFlowing).append("-day SUSTAINED · ");
        else if (daysFlowing == 3) sb.append("3-day streak · ");
        else if (daysFlowing == 2) sb.append("2-day continuation · ");

        // Headline based on regime
        switch (regime) {
            case "ACCUMULATION":
                sb.append("🟢 Sector accumulation · institutions buying with strong delivery (").append((int) delivPct).append("%)");
                break;
            case "DISTRIBUTION":
                sb.append("🔴 Sector distribution · low delivery (").append((int) delivPct).append("%) + net selling — exit longs");
                break;
            case "DISTRIBUTION_INTO_STRENGTH":
                sb.append("🟠 Distribution into strength · institutions trimming despite ").append((int) delivPct).append("% delivery");
                break;
            case "SPECULATIVE_BUYING":
                sb.append("⚠ Speculative buying · low delivery (").append((int) delivPct).append("%) — momentum, no conviction");
                break;
            case "MIXED":
                if (net > 0) sb.append("Mixed bias · net buying ").append(String.format("+%.0f", net)).append(" Cr but delivery weak");
                else sb.append("Mixed bias · net selling ").append(String.format("%.0f", net)).append(" Cr");
                break;
            default:
                sb.append("Routine flow · no edge");
        }
        // Anchor with top stock — but skip if it's a CHURN-flagged stock
        if (!topStocks.isEmpty()) {
            var top = topStocks.get(0);
            if (!"CHURN".equals(top.getFlowQuality())) {
                sb.append(" · driver: ").append(top.getSymbol())
                  .append(" ").append(String.format("%+.0f", top.getNetCr())).append(" Cr");
            }
        }
        // FII vs DII split note when meaningful
        if (Math.abs(fiiNet) > 5 || Math.abs(diiNet) > 5) {
            sb.append(" · FII ").append(String.format("%+.0f", fiiNet)).append(" / DII ").append(String.format("%+.0f", diiNet));
        }
        // Append churn warning for borderline cases
        if (sectorChurnRatio > 0.4 && sectorChurnRatio <= 0.7) {
            sb.append(" · ⚠ ").append((int) (sectorChurnRatio * 100)).append("% churned (lower conviction)");
        }
        return sb.toString();
    }

    // Phase 7b+8d: concrete retail trader action keyed by regime + streak + churn
    private String buildTraderAction(String regime, int daysFlowing, String streakDir, double delivPct, double net,
                                      List<DealIntelligence.SectorFlow.StockContribution> topStocks,
                                      double sectorChurnRatio, String sector) {
        boolean strongStreak = daysFlowing >= 3;
        // Phase 8d: dynamic, data-driven CHURN message naming the actual churning client + stock
        if ("CHURN".equals(regime)) {
            // Find the dominant churning stock (largest gross with CHURN flag)
            DealIntelligence.SectorFlow.StockContribution dom = null;
            for (var s : topStocks) {
                if ("CHURN".equals(s.getFlowQuality())) {
                    if (dom == null || s.getGrossCr() > dom.getGrossCr()) dom = s;
                }
            }
            if (dom != null) {
                String client = dom.getDominantClient() != null ? dom.getDominantClient() : "a single broker";
                return String.format(
                    "— SKIP · %s churned ₹%.0f Cr both ways on %s for ₹%+.1f Cr net (%d%% self-matched) · pure market-making, no directional edge · wait for real institutional flow before trading %s.",
                    client, dom.getGrossCr(), dom.getSymbol(), dom.getNetCr(),
                    (int) Math.round(dom.getChurnRatio() * 100),
                    sector
                );
            }
            // Fallback when no specific dominant stock identified
            return String.format(
                "— SKIP · %d%% of %s flow was self-matched by single brokers · pure liquidity provision, no directional conviction · wait for real institutional flow.",
                (int) Math.round(sectorChurnRatio * 100), sector
            );
        }
        switch (regime) {
            case "ACCUMULATION":
                if (strongStreak) return "🟢 BUY on dips · stop -3% · " + daysFlowing + "-day institutional accumulation, conviction building. Position sizing: normal.";
                return "🟢 BUY-DIPS · institutions absorbing supply (delivery " + (int) delivPct + "%) · stop below today's low. Wait for follow-through tomorrow before adding.";
            case "DISTRIBUTION":
                if (strongStreak) return "🔴 AVOID longs · " + daysFlowing + "-day distribution streak · consider short on rally to resistance · stop above today's high.";
                return "🔴 AVOID new longs · institutions exiting + low delivery = no support · trim existing positions if any.";
            case "DISTRIBUTION_INTO_STRENGTH":
                if (strongStreak) return "🟠 TRIM longs aggressively · " + daysFlowing + "-day distribution into strength = classic top · don't be the bag-holder.";
                return "🟠 TRIM longs · institutions giving paper to retail · don't add new · classic distribution top forming.";
            case "SPECULATIVE_BUYING":
                return "⚠ AVOID chasing · momentum-driven with low delivery · likely to fade · wait for delivery > 50% before believing the move.";
            case "MIXED":
                return "↔ WAIT · no clear edge · check tomorrow's flow before committing capital.";
            default:
                return "— No edge · skip this sector today.";
        }
    }

    // Phase 7b: write today's per-sector net Cr to Redis (TTL 7 days) so we can compute streaks.
    private void snapshotSectorFlows(Map<String, Double> todayBySector) {
        try {
            String today = java.time.LocalDate.now(IST).toString();
            String key = "sector-flows:snapshot:" + today;
            redis.opsForValue().set(key, mapper.writeValueAsString(todayBySector),
                java.time.Duration.ofDays(7));
        } catch (Exception e) {
            log.debug("[SECTOR_SNAPSHOT] write failed: {}", e.getMessage());
        }
    }

    // Phase 7b: walk back up to 4 prior days, count consecutive same-direction days for each sector
    @SuppressWarnings("unchecked")
    private Map<String, Integer> computeSectorStreaks(Map<String, Double> todayBySector) {
        Map<String, Integer> result = new HashMap<>();
        for (var e : todayBySector.entrySet()) result.put(e.getKey(), 1); // start with today

        java.time.LocalDate today = java.time.LocalDate.now(IST);
        for (int back = 1; back <= 4; back++) {
            String date = today.minusDays(back).toString();
            String key = "sector-flows:snapshot:" + date;
            try {
                String json = redis.opsForValue().get(key);
                if (json == null) continue; // gap day, skip but don't break streak (allows weekends)
                Map<String, Object> dayMap = mapper.readValue(json, Map.class);
                for (var e : todayBySector.entrySet()) {
                    String sector = e.getKey();
                    double todayVal = e.getValue();
                    Object prev = dayMap.get(sector);
                    if (prev == null) continue;
                    double prevVal = toDouble(prev);
                    // Continue streak only if same sign (both buying or both selling) AND meaningful magnitude
                    if (Math.abs(prevVal) > 1 && Math.signum(todayVal) == Math.signum(prevVal)) {
                        result.merge(sector, 1, Integer::sum);
                    }
                }
            } catch (Exception ignored) {}
        }
        return result;
    }

    // Same loop, but returns the dominant direction over the streak window (BUY / SELL / MIXED)
    @SuppressWarnings("unchecked")
    private Map<String, String> computeSectorStreakDirections(Map<String, Double> todayBySector) {
        Map<String, String> result = new HashMap<>();
        for (var e : todayBySector.entrySet()) {
            result.put(e.getKey(), e.getValue() >= 0 ? "BUY" : "SELL");
        }
        return result;
    }

    private String generateSectorSignal(double net, double delivPct, double fiiBuy, double fiiSell,
                                          double diiBuy, double diiSell) {
        double fiiNet = fiiBuy - fiiSell;
        double diiNet = diiBuy - diiSell;
        int factors = 0; // count aligned bullish factors
        if (fiiNet > 0) factors++;
        if (diiNet > 0) factors++;
        if (delivPct > 50) factors++;
        if (net > 5) factors++;

        // ── Strongest conviction: 3-4 factors aligned ──
        if (factors >= 3 && net > 0) {
            StringBuilder sb = new StringBuilder();
            sb.append(String.format("STRONG BUY signal — "));
            List<String> why = new ArrayList<>();
            if (fiiNet > 0) why.add(String.format("FII buying +%.0f Cr", fiiNet));
            if (diiNet > 0) why.add(String.format("DII buying +%.0f Cr", diiNet));
            if (delivPct > 50) why.add(String.format("%.0f%% delivery", delivPct));
            sb.append(String.join(", ", why));
            sb.append(". Tomorrow: LONG setups aligned.");
            return sb.toString();
        }

        // ── Distribution: high delivery + selling ──
        if (delivPct > 50 && net < -10) {
            return String.format("Distribution — %.0f%% delivery but net selling %.0f Cr. Strong hands exiting. Avoid LONG tomorrow.", delivPct, Math.abs(net));
        }

        // ── Accumulation without full conviction ──
        if (delivPct > 50 && net > 5) {
            return String.format("Accumulation — %.0f%% delivery + net buying %.0f Cr. Institutions positioning. Watch for breakout.", delivPct, net);
        }

        // ── Speculative churn ──
        if (delivPct < 30 && Math.abs(net) > 5) {
            return String.format("Speculative — only %.0f%% delivery despite %.0f Cr flow. No institutional conviction. Avoid.", delivPct, Math.abs(net));
        }

        // ── Single-factor signals ──
        if (fiiBuy > 0 && diiBuy > 0 && net > 0) {
            return String.format("Both FII (+%.0f) and DII (+%.0f) buying. Conviction building.", fiiNet, diiNet);
        }
        if (net > 10) return String.format("Net inflow +%.0f Cr. Accumulation building.", net);
        if (net < -10) return String.format("Net outflow %.0f Cr. Sector distribution.", net);
        return "Neutral — no strong institutional signal.";
    }

    private List<DealIntelligence.ClientActivity> computeTopClients(List<Map<String, Object>> blockDeals,
                                                                      List<Map<String, Object>> bulkDeals) {
        Map<String, double[]> clientAgg = new LinkedHashMap<>();
        // [buyCr, sellCr, dealCount]

        for (var d : blockDeals) aggregateClient(d, clientAgg);
        for (var d : bulkDeals) aggregateClient(d, clientAgg);

        return clientAgg.entrySet().stream()
            .sorted((a, b) -> Double.compare(b.getValue()[0] + b.getValue()[1], a.getValue()[0] + a.getValue()[1]))
            .limit(15)
            .map(e -> DealIntelligence.ClientActivity.builder()
                .name(e.getKey()).type(classifyClient(e.getKey()))
                .buyCr(e.getValue()[0]).sellCr(e.getValue()[1])
                .netCr(Math.round((e.getValue()[0] - e.getValue()[1]) * 10) / 10.0)
                .dealCount((int) e.getValue()[2])
                .build())
            .collect(Collectors.toList());
    }

    private void aggregateClient(Map<String, Object> deal, Map<String, double[]> clientAgg) {
        String client = (String) deal.getOrDefault("clientName", "Unknown");
        if (client == null || client.isBlank()) return;
        String buySell = (String) deal.getOrDefault("buySell", "");
        double val = toDouble(deal.get("valueCr"));

        clientAgg.computeIfAbsent(client, k -> new double[3]);
        double[] v = clientAgg.get(client);
        v[2]++;
        if ("BUY".equalsIgnoreCase(buySell)) v[0] += val;
        else v[1] += val;
    }

    private List<DealIntelligence.StockDeal> computeTopStocks(List<Map<String, Object>> blockDeals,
                                                                List<Map<String, Object>> bulkDeals) {
        Map<String, Map<String, Object>> stockAgg = new LinkedHashMap<>();

        for (var d : blockDeals) aggregateStock(d, stockAgg, "block");
        for (var d : bulkDeals) aggregateStock(d, stockAgg, "bulk");

        return stockAgg.values().stream()
            .sorted((a, b) -> Double.compare(
                toDouble(b.get("totalBuy")) + toDouble(b.get("totalSell")),
                toDouble(a.get("totalBuy")) + toDouble(a.get("totalSell"))))
            .limit(12)
            .map(s -> DealIntelligence.StockDeal.builder()
                .symbol((String) s.get("symbol"))
                .sector(classifySector((String) s.get("symbol")))
                .netCr(Math.round((toDouble(s.get("totalBuy")) - toDouble(s.get("totalSell"))) * 10) / 10.0)
                .bulkBuyCr(toDouble(s.get("bulkBuy"))).bulkSellCr(toDouble(s.get("bulkSell")))
                .blockBuyCr(toDouble(s.get("blockBuy"))).blockSellCr(toDouble(s.get("blockSell")))
                .dateCount(((Set<String>) s.get("dates")).size())
                .build())
            .collect(Collectors.toList());
    }

    @SuppressWarnings("unchecked")
    private void aggregateStock(Map<String, Object> deal, Map<String, Map<String, Object>> stockAgg, String type) {
        String symbol = (String) deal.getOrDefault("symbol", "");
        if (symbol.isBlank()) return;
        String buySell = (String) deal.getOrDefault("buySell", "");
        double val = toDouble(deal.get("valueCr"));
        String date = (String) deal.getOrDefault("_date", deal.getOrDefault("date", ""));

        stockAgg.computeIfAbsent(symbol, k -> {
            Map<String, Object> m = new HashMap<>();
            m.put("symbol", symbol);
            m.put("totalBuy", 0.0); m.put("totalSell", 0.0);
            m.put("blockBuy", 0.0); m.put("blockSell", 0.0);
            m.put("bulkBuy", 0.0); m.put("bulkSell", 0.0);
            m.put("dates", new HashSet<String>());
            return m;
        });

        var s = stockAgg.get(symbol);
        ((Set<String>) s.get("dates")).add(date);
        boolean isBuy = "BUY".equalsIgnoreCase(buySell);
        if (isBuy) {
            s.put("totalBuy", toDouble(s.get("totalBuy")) + val);
            s.put(type + "Buy", toDouble(s.get(type + "Buy")) + val);
        } else {
            s.put("totalSell", toDouble(s.get("totalSell")) + val);
            s.put(type + "Sell", toDouble(s.get(type + "Sell")) + val);
        }
    }

    @SuppressWarnings("unchecked")
    private DeliveryAnalysis computeDeliveryAnalysis(Map<String, Object> deliveryData,
                                                      List<Map<String, Object>> blockDeals,
                                                      List<Map<String, Object>> bulkDeals,
                                                      List<Map<String, Object>> fiiDiiDays) {
        if (deliveryData == null || deliveryData.isEmpty()) {
            return DeliveryAnalysis.builder().date("N/A").sectors(List.of()).inference("No delivery data available.").build();
        }

        String date = (String) deliveryData.getOrDefault("date", "N/A");
        var sectors = (Map<String, Object>) deliveryData.get("sectors");
        List<DeliveryAnalysis.SectorDelivery> sectorList = new ArrayList<>();

        // Build deal flow per sector for cross-referencing
        Map<String, double[]> sectorDealFlows = new LinkedHashMap<>(); // [netCr, dealCount]
        for (var d : blockDeals) {
            String sym = (String) d.getOrDefault("symbol", "");
            String name = (String) d.getOrDefault("securityName", d.getOrDefault("name", ""));
            String sector = classifySector(sym + " " + name);
            String buySell = (String) d.getOrDefault("buySell", "");
            double val = toDouble(d.get("valueCr"));
            sectorDealFlows.computeIfAbsent(sector, k -> new double[2]);
            sectorDealFlows.get(sector)[0] += "BUY".equalsIgnoreCase(buySell) ? val : -val;
            sectorDealFlows.get(sector)[1]++;
        }
        for (var d : bulkDeals) {
            String sym = (String) d.getOrDefault("symbol", "");
            String name = (String) d.getOrDefault("securityName", d.getOrDefault("name", ""));
            String sector = classifySector(sym + " " + name);
            String buySell = (String) d.getOrDefault("buySell", "");
            double val = toDouble(d.get("valueCr"));
            sectorDealFlows.computeIfAbsent(sector, k -> new double[2]);
            sectorDealFlows.get(sector)[0] += "BUY".equalsIgnoreCase(buySell) ? val : -val;
            sectorDealFlows.get(sector)[1]++;
        }

        // FII/DII direction for context
        double fiiNetToday = 0, diiNetToday = 0;
        if (!fiiDiiDays.isEmpty()) {
            var fii = (Map<String, Object>) fiiDiiDays.get(0).get("FII");
            var dii = (Map<String, Object>) fiiDiiDays.get(0).get("DII");
            if (fii != null) fiiNetToday = toDouble(fii.get("netValue"));
            if (dii != null) diiNetToday = toDouble(dii.get("netValue"));
        }

        if (sectors != null) {
            for (var entry : sectors.entrySet()) {
                var sData = (Map<String, Object>) entry.getValue();
                double delPct = toDouble(sData.get("deliveryPct"));
                double[] dealFlow = sectorDealFlows.getOrDefault(entry.getKey(), new double[]{0, 0});
                double netDealCr = dealFlow[0];
                int dealCount = (int) dealFlow[1];

                // Rich per-sector signal
                String signal;
                if (delPct > 50 && netDealCr > 5) {
                    signal = String.format("%.0f%% delivery + net buying %.0f Cr — accumulation. LONG tomorrow.", delPct, netDealCr);
                } else if (delPct > 50 && netDealCr < -5) {
                    signal = String.format("%.0f%% delivery but net selling %.0f Cr — distribution by strong hands. Caution.", delPct, Math.abs(netDealCr));
                } else if (delPct > 50) {
                    signal = String.format("%.0f%% delivery — institutional conviction. Watch for entry.", delPct);
                } else if (delPct < 30 && Math.abs(netDealCr) > 5) {
                    signal = String.format("%.0f%% delivery + active deals — speculative churn. Avoid.", delPct);
                } else if (delPct < 30) {
                    signal = String.format("%.0f%% delivery — speculative, no commitment.", delPct);
                } else {
                    signal = String.format("%.0f%% delivery — normal range.", delPct);
                }

                sectorList.add(DeliveryAnalysis.SectorDelivery.builder()
                    .sector(entry.getKey()).deliveryPct(delPct)
                    .turnoverLacs(toDouble(sData.get("totalTurnoverLacs"))).signal(signal)
                    .build());
            }
        }
        sectorList.sort((a, b) -> Double.compare(b.getDeliveryPct(), a.getDeliveryPct()));

        // ── Build rich inference ──
        List<String> infParts = new ArrayList<>();
        var highDel = sectorList.stream().filter(s -> s.getDeliveryPct() > 50).collect(Collectors.toList());
        var lowDel = sectorList.stream().filter(s -> s.getDeliveryPct() < 30).collect(Collectors.toList());

        if (!highDel.isEmpty()) {
            // Identify which high-delivery sectors also have deal buying (strongest signal)
            List<String> accumSectors = new ArrayList<>();
            List<String> distSectors = new ArrayList<>();
            List<String> holdSectors = new ArrayList<>();
            for (var s : highDel) {
                double[] flow = sectorDealFlows.getOrDefault(s.getSector(), new double[]{0, 0});
                if (flow[0] > 5) accumSectors.add(s.getSector());
                else if (flow[0] < -5) distSectors.add(s.getSector());
                else holdSectors.add(s.getSector());
            }
            if (!accumSectors.isEmpty()) {
                infParts.add("Strong accumulation (high delivery + net buying): " + String.join(", ", accumSectors) + " — LONG candidates tomorrow.");
            }
            if (!distSectors.isEmpty()) {
                infParts.add("Distribution despite high delivery: " + String.join(", ", distSectors) + " — strong hands exiting, avoid.");
            }
            if (!holdSectors.isEmpty()) {
                infParts.add("High delivery (institutions positioning): " + String.join(", ", holdSectors) + ".");
            }
        }
        if (!lowDel.isEmpty()) {
            infParts.add("Speculative (low delivery): " + lowDel.stream().map(DeliveryAnalysis.SectorDelivery::getSector).collect(Collectors.joining(", ")) + " — avoid, no institutional commitment.");
        }

        // Cross with FII/DII macro
        if (fiiNetToday < -2000 && diiNetToday > 2000 && !highDel.isEmpty()) {
            infParts.add("DII absorption day — domestic funds anchoring high-delivery sectors. These are the sectors to be in tomorrow.");
        }

        String inference = infParts.isEmpty() ? "Normal delivery pattern across sectors." : String.join(" ", infParts);
        return DeliveryAnalysis.builder().date(date).sectors(sectorList).inference(inference).build();
    }

    private List<StrategyScore> computeStrategyScorecard() {
        List<StrategyScore> scores = new ArrayList<>();
        for (String strategy : List.of("FUDKII", "FUKAA", "FUDKOI", "QUANT", "MICROALPHA", "MERE", "RETEST", "MCX_BB_30", "MCX_BB_15", "NSE_BB_30")) {
            try {
                var wallet = readWallet(strategy);
                double balance = toDouble(wallet.getOrDefault("currentBalance", 1000000));
                double peak = toDouble(wallet.getOrDefault("peakBalance", balance));
                double dd = peak > balance ? peak - balance : 0;
                double ddPct = peak > 0 ? dd / peak * 100 : 0;

                scores.add(StrategyScore.builder()
                    .strategy(strategy).balance(Math.round(balance))
                    .peakBalance(Math.round(peak)).drawdown(Math.round(dd)).drawdownPct(Math.round(ddPct * 10) / 10.0)
                    .dayPnl(toDouble(wallet.getOrDefault("dayRealizedPnl", 0)))
                    .dayTrades(toInt(wallet.getOrDefault("dayTradeCount", 0)))
                    .dayWins(toInt(wallet.getOrDefault("dayWinCount", 0)))
                    .dayLosses(toInt(wallet.getOrDefault("dayLossCount", 0)))
                    .winRate(toDouble(wallet.getOrDefault("winRate", 0)))
                    .totalTrades(toInt(wallet.getOrDefault("totalTradeCount", 0)))
                    .build());
            } catch (Exception ignored) {}
        }
        return scores;
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    private String classifyClient(String name) {
        if (name == null) return "OTHER";
        if (PROP_BROKER_PATTERN.matcher(name).find()) return "PROP_BROKER";
        if (FII_PATTERN.matcher(name).find()) return "FII";
        if (DII_PATTERN.matcher(name).find()) return "DII";
        return "OTHER";
    }

    private String classifySector(String text) {
        if (text == null) return "Misc";
        for (var entry : SECTOR_PATTERNS.entrySet()) {
            if (entry.getValue().matcher(text).find()) return entry.getKey();
        }
        return "Misc";
    }

    private int countFiiSellingStreak(List<Map<String, Object>> fiiDiiDays) {
        int streak = 0;
        for (var day : fiiDiiDays) {
            var fii = (Map<String, Object>) day.get("FII");
            if (fii != null && toDouble(fii.get("netValue")) < 0) streak++;
            else break;
        }
        return streak;
    }

    private int countOpenPositions(String strategy) {
        Set<String> keys = scanKeys("strategy:targets:*");
        if (keys == null) return 0;
        int count = 0;
        for (String key : keys) {
            try {
                String json = redis.opsForValue().get(key);
                if (json != null && json.contains("\"strategy\":\"" + strategy + "\"")) count++;
            } catch (Exception ignored) {}
        }
        return count;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readWallet(String strategy) {
        String key = "wallet:entity:strategy-wallet-" + strategy;
        String json = redis.opsForValue().get(key);
        if (json == null) return Map.of();
        try {
            return mapper.readValue(json, Map.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    private double readPrice(String exchange, String scripCode) {
        String[] prefixes = {"price:" + exchange + ":", "price:N:", "price:M:"};
        for (String prefix : prefixes) {
            String val = redis.opsForValue().get(prefix + scripCode);
            if (val != null) {
                try { return Double.parseDouble(val); } catch (Exception ignored) {}
            }
        }
        return 0;
    }

    private double readDouble(String key, double defaultVal) {
        String val = redis.opsForValue().get(key);
        if (val == null) return defaultVal;
        try { return Double.parseDouble(val); } catch (Exception e) { return defaultVal; }
    }

    private String readString(String key, String defaultVal) {
        String val = redis.opsForValue().get(key);
        return val != null ? val : defaultVal;
    }

    private Set<String> scanKeys(String pattern) {
        return redis.keys(pattern);
    }

    private String getMarketStatus() {
        ZonedDateTime now = ZonedDateTime.now(IST);
        int dow = now.getDayOfWeek().getValue();   // 1=Mon..7=Sun
        int hhmm = now.getHour() * 100 + now.getMinute();
        // Weekend — both NSE and MCX closed (MCX runs Mon-Fri)
        if (dow == 6 || dow == 7) return "WEEKEND";
        if (hhmm < 900)  return "PRE_MARKET";        // before MCX open
        if (hhmm < 915)  return "PRE_MARKET";        // NSE pre-open
        if (hhmm <= 1530) return "NSE_OPEN";          // NSE equity hours
        if (hhmm <= 2330) return "MCX_OPEN";          // post-NSE, MCX still trading
        return "CLOSED";
    }

    private String getNextBoundary() {
        ZonedDateTime now = ZonedDateTime.now(IST);
        int dow = now.getDayOfWeek().getValue();
        int hour = now.getHour();
        int min = now.getMinute();

        // Weekend — point to Monday 09:15 IST (NSE open)
        if (dow == 6) return "Mon 09:15 IST";
        if (dow == 7) return "Mon 09:15 IST";

        // After-hours weekday — point to tomorrow's NSE open (or Mon if Friday)
        if (hour >= 24 || (hour * 100 + min) > 2330) {
            return dow == 5 ? "Mon 09:15 IST" : "Tomorrow 09:15 IST";
        }

        // During MCX-only window (15:30 → 23:30) — point to next 30m candle close
        // For NSE hours (09:15 → 15:30) — point to next NSE 15-minute boundary
        int nextMin = min < 15 ? 15 : min < 45 ? 45 : 15;
        int nextHour = min >= 45 ? hour + 1 : hour;
        return String.format("%02d:%02d IST", nextHour, nextMin);
    }

    private static double toDouble(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (Exception e) { return 0; }
    }

    private static int toInt(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).intValue();
        try { return Integer.parseInt(val.toString()); } catch (Exception e) { return 0; }
    }

    private static String formatCr(double val) {
        if (Math.abs(val) >= 100) return String.format("%.0f Cr", val);
        if (Math.abs(val) >= 1) return String.format("%.1f Cr", val);
        return String.format("%.2f Cr", val);
    }
}
