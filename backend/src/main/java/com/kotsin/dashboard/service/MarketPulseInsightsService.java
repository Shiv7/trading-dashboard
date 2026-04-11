package com.kotsin.dashboard.service;

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
        "goldman|morgan stanley|citi|jpmorgan|hsbc|ubs|barclays|nomura|clsa|fpi|foreign|europe|asia|global|singapore|mauritius|capital group|vanguard|blackrock|societe|deutsche|credit suisse|bnp|macquarie|aberdeen|schroders|merrill|pine oak|beacon stone",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern DII_PATTERN = Pattern.compile(
        "mutual fund|kotak mahindra|hdfc mutual|sbi mutual|axis mutual|nippon india|birla sun|dsp mutual|franklin|idfc mutual|sundaram|canara robeco|invesco|mirae|quant mutual|union mutual|groww",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern PROP_BROKER_PATTERN = Pattern.compile(
        "jump trading|nk securities|junomoneta|microcurves|irage|musigma|elixir wealth|qicap|silverleaf|puma securities|pace stock|mathisys|arthkumbh|dipan mehta|dharmik.*kapu",
        Pattern.CASE_INSENSITIVE);

    // ── Sector Keywords ──
    private static final Map<String, Pattern> SECTOR_PATTERNS = Map.ofEntries(
        Map.entry("Banking & Finance", Pattern.compile("bank|financ|hdfc|icici|kotak|axis|sbi|bajaj fin|indusind|pnb|federal|rbl|yes bank|muthoot|manappuram|shriram|chola", Pattern.CASE_INSENSITIVE)),
        Map.entry("Metals & Mining", Pattern.compile("metal|steel|tata steel|jsw|hindalco|vedanta|coal|nmdc|moil|nalco|sail|jindal", Pattern.CASE_INSENSITIVE)),
        Map.entry("IT & Tech", Pattern.compile("tech|info|tcs|wipro|hcl|ltimind|mphasis|coforge|persist|cyient|kpit|tata elx", Pattern.CASE_INSENSITIVE)),
        Map.entry("Pharma & Health", Pattern.compile("pharma|drug|sun |cipla|lupin|dr.? reddy|divis|aurobindo|torrent|zydus|biocon|alkem", Pattern.CASE_INSENSITIVE)),
        Map.entry("Oil & Gas", Pattern.compile("reliance|oil|petro|gas|ongc|bpcl|hpcl|ioc|gail|adani.*gas", Pattern.CASE_INSENSITIVE)),
        Map.entry("Auto", Pattern.compile("auto|maruti|tata motor|mahindra|bajaj auto|hero|tvs|eicher|ashok ley", Pattern.CASE_INSENSITIVE)),
        Map.entry("FMCG & Retail", Pattern.compile("fmcg|itc|hindustan.*uni|nestle|dabur|marico|colgate|britannia|godrej.*con", Pattern.CASE_INSENSITIVE)),
        Map.entry("Power & Energy", Pattern.compile("power|ntpc|adani.*power|tata.*power|nhpc|jsw.*energy|adani.*green", Pattern.CASE_INSENSITIVE)),
        Map.entry("Real Estate", Pattern.compile("real|dlf|godrej.*prop|prestige|oberoi|brigade|sobha|phoenix", Pattern.CASE_INSENSITIVE)),
        Map.entry("Infra & Cement", Pattern.compile("infra|highway|construct|larsen|l&t|cement|ultra|ambuja|shree|acc|dalmia", Pattern.CASE_INSENSITIVE)),
        Map.entry("Chemicals", Pattern.compile("chem|chemical|srf|pidilite|aarti|clean science|deepak|tata chem", Pattern.CASE_INSENSITIVE)),
        Map.entry("Insurance", Pattern.compile("insur|lic|sbi life|hdfc life|icici.*lomb|star health", Pattern.CASE_INSENSITIVE))
    );

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

    private MarketState computeMarketState(MarketPulseService.MacroSnapshot snap,
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

        return MarketState.builder()
            .direction(direction)
            .confidence(confidence)
            .dayType(dayType)
            .summary(summary)
            .assScore(assScore)
            .assRegime(assRegime)
            .niftyPrice(snap.getGiftNiftyPrice())
            .niftyChangePct(niftyChg)
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
            .giftNiftyPrice(snap.getGiftNiftyPrice())
            .giftNiftyChangePct(snap.getGiftNiftyChangePct())
            .advances(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getAdvances() : 0)
            .declines(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getDeclines() : 0)
            .adRatioLabel(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getRatioLabel() : "0:0")
            .foAdvances(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getFoAdvances() : 0)
            .foDeclines(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getFoDeclines() : 0)
            .foRatioLabel(snap.getAdvanceDecline() != null ? snap.getAdvanceDecline().getFoRatioLabel() : "0:0")
            .timestamp(System.currentTimeMillis())
            .build();
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
        // Read from Redis (set by FastAnalytics ASS scraper)
        String indicesJson = readString("asian:sentiment:indices", null);
        double ass = readDouble("asian:sentiment:score", 0);
        String regime = readString("asian:sentiment:regime", "NEUTRAL");

        double nikkei = 0, hangSeng = 0, shanghai = 0, kospi = 0;
        if (indicesJson != null) {
            try {
                Map<String, Object> indices = mapper.readValue(indicesJson, Map.class);
                nikkei = toDouble(indices.get("nikkei"));
                hangSeng = toDouble(indices.get("hangSeng"));
                shanghai = toDouble(indices.get("shanghai"));
                kospi = toDouble(indices.get("kospi"));
            } catch (Exception ignored) {}
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
            .nikkeiChangePct(nikkei).hangSengChangePct(hangSeng)
            .shanghaiChangePct(shanghai).kospiChangePct(kospi)
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

    private List<DealIntelligence.SectorFlow> computeSectorFlows(List<Map<String, Object>> blockDeals,
                                                                   List<Map<String, Object>> bulkDeals,
                                                                   Map<String, Object> deliveryData) {
        Map<String, double[]> sectorAgg = new LinkedHashMap<>();
        // [fiiBuy, fiiSell, diiBuy, diiSell, otherBuy, otherSell, dealCount]

        for (var d : blockDeals) aggregateDealToSector(d, sectorAgg);
        for (var d : bulkDeals) aggregateDealToSector(d, sectorAgg);

        // Get delivery data by sector
        Map<String, Double> deliveryBySector = new HashMap<>();
        if (deliveryData != null && deliveryData.get("sectors") != null) {
            var sectors = (Map<String, Object>) deliveryData.get("sectors");
            for (var entry : sectors.entrySet()) {
                var sectorData = (Map<String, Object>) entry.getValue();
                deliveryBySector.put(entry.getKey(), toDouble(sectorData.get("deliveryPct")));
            }
        }

        List<DealIntelligence.SectorFlow> flows = new ArrayList<>();
        for (var entry : sectorAgg.entrySet()) {
            double[] v = entry.getValue();
            double net = (v[0] - v[1]) + (v[2] - v[3]) + (v[4] - v[5]);
            double delivPct = deliveryBySector.getOrDefault(entry.getKey(), 0.0);

            String signal = generateSectorSignal(net, delivPct, v[0], v[1], v[2], v[3]);

            flows.add(DealIntelligence.SectorFlow.builder()
                .sector(entry.getKey()).netCr(Math.round(net * 10) / 10.0)
                .fiiBuyCr(v[0]).fiiSellCr(v[1]).diiBuyCr(v[2]).diiSellCr(v[3])
                .otherBuyCr(v[4]).otherSellCr(v[5]).dealCount((int) v[6])
                .deliveryPct(delivPct).signal(signal)
                .build());
        }

        flows.sort((a, b) -> Double.compare(Math.abs(b.getNetCr()), Math.abs(a.getNetCr())));
        return flows;
    }

    private void aggregateDealToSector(Map<String, Object> deal, Map<String, double[]> sectorAgg) {
        String symbol = (String) deal.getOrDefault("symbol", "");
        String name = (String) deal.getOrDefault("securityName", deal.getOrDefault("name", ""));
        String client = (String) deal.getOrDefault("clientName", "");
        String buySell = (String) deal.getOrDefault("buySell", "");
        double val = toDouble(deal.get("valueCr"));

        String sector = classifySector(symbol + " " + name);
        String clientType = classifyClient(client);

        sectorAgg.computeIfAbsent(sector, k -> new double[7]);
        double[] v = sectorAgg.get(sector);
        v[6]++; // deal count

        boolean isBuy = "BUY".equalsIgnoreCase(buySell);
        switch (clientType) {
            case "FII" -> { if (isBuy) v[0] += val; else v[1] += val; }
            case "DII" -> { if (isBuy) v[2] += val; else v[3] += val; }
            default -> { if (isBuy) v[4] += val; else v[5] += val; }
        }
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
        if (text == null) return "Other";
        for (var entry : SECTOR_PATTERNS.entrySet()) {
            if (entry.getValue().matcher(text).find()) return entry.getKey();
        }
        return "Other";
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
        int hhmm = now.getHour() * 100 + now.getMinute();
        if (hhmm < 915) return "PRE_MARKET";
        if (hhmm <= 1530) return "OPEN";
        if (hhmm <= 2330) return "MCX_OPEN";
        return "CLOSED";
    }

    private String getNextBoundary() {
        ZonedDateTime now = ZonedDateTime.now(IST);
        int min = now.getMinute();
        int hour = now.getHour();
        // NSE 30m boundaries: :15, :45
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
