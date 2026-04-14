package com.kotsin.dashboard.dto;

import lombok.Builder;
import lombok.Data;
import java.util.*;

/**
 * Single response object for the Trading Command Center page.
 * Contains ALL pre-computed insights — frontend is a pure renderer.
 *
 * 5 Tiers:
 *   T1: Market State (sticky bar)
 *   T2: Strategy Alignment
 *   T3: Position Guidance
 *   T4: Alerts
 *   T5: Evidence (collapsed sections)
 */
@Data
@Builder
public class MarketPulseInsightsDTO {

    // ═══════ TIER 1: MARKET STATE (Sticky Bar) ═══════

    private MarketState marketState;

    @Data @Builder
    public static class MarketState {
        private String direction;       // "BULLISH", "BEARISH", "NEUTRAL"
        private int confidence;         // 0-100
        private String dayType;         // "TREND", "GAP_FILL", "RANGE", "REVERSAL"
        private String summary;         // One-line plain language summary
        private double assScore;        // Asian Sentiment Score
        private String assRegime;       // "STRONG_RISK_ON", "MILD_RISK_ON", "NEUTRAL", etc.

        // Key numbers for sticky bar
        private double niftyPrice;            // legacy: fallback to SGX when NSE unavailable
        private double niftyChangePct;
        // Explicit Indian indices (Phase 4)
        private double sgxNiftyPrice;          // GIFT / SGX Nifty futures (sgxnifty.org scrape)
        private double sgxNiftyChangePct;
        private double nifty50Price;           // NSE Nifty 50 last close (from Streaming Candle via hotstocks:v1:999920000)
        private double nifty50ChangePct;
        private double indiaVix;
        private double crudePrice;
        private double crudeChangePct;
        private double goldPrice;
        private double goldChangePct;
        private double silverPrice;
        private double silverChangePct;
        private double dxyPrice;
        private double dxyChangePct;
        private double usdInrPrice;
        private double usdInrChangePct;
        private double fiiNetToday;
        private double diiNetToday;
        private double usVix;
        private double usVixChangePct;

        // US Indices (scraped from sgxnifty.org, ingested via market-context-giftnifty Kafka)
        private double sp500Price;
        private double sp500ChangePct;
        private double dowPrice;
        private double dowChangePct;
        private double nasdaqPrice;
        private double nasdaqChangePct;

        // Brent (in addition to WTI crudePrice)
        private double brentPrice;
        private double brentChangePct;

        // European Indices (populated by Phase 2 GlobalIndicesPoller — yfinance via FastAnalytics)
        private double ftsePrice;
        private double ftseChangePct;
        private double daxPrice;
        private double daxChangePct;
        private double cacPrice;
        private double cacChangePct;

        // Middle East Indices (Phase 2 — yfinance)
        private double tasiPrice;        // Saudi Tadawul All Share (^TASI.SR)
        private double tasiChangePct;
        private double uaePrice;         // iShares MSCI UAE ETF (UAE) as composite proxy — yfinance has no direct ADX/DFM
        private double uaeChangePct;

        // Macro rates (Phase 5+6)
        private double us10yYield;          // ^TNX percentage (e.g. 4.21)
        private double us10yChangePct;
        // Computed cross-market spreads & divergences
        private double vixDivergence;       // indiaVix - usVix (positive = India fear > US fear)
        private double brentWtiSpread;      // brent - crude (positive = supply tightness premium)
        // FOMC / India CPI calendar awareness
        private String nextFomcDate;        // ISO yyyy-MM-dd
        private int daysUntilFomc;          // 0 = today, -1 = past, max ~999
        private String nextCpiDate;         // ISO yyyy-MM-dd (Indian CPI)
        private int daysUntilCpi;
        private String calendarHint;        // e.g. "FOMC in 2 days · tighten stops" — empty when no near-term event

        // GIFT Nifty
        private double giftNiftyPrice;
        private double giftNiftyChangePct;

        // Advance/Decline
        private int advances;
        private int declines;
        private String adRatioLabel;
        private int foAdvances;
        private int foDeclines;
        private String foRatioLabel;

        private long timestamp;

        // Phase 4: per-card cross-indice inferences (key = card id, value = 1-line takeaway)
        // Keys: "sgxNifty","nifty50","indiaVix","usdInr","nikkei","hangSeng","shanghai","kospi",
        //       "dow","sp500","nasdaq","usVix","ftse","dax","cac","tasi","uae",
        //       "crudeWti","brent","gold","silver","dxy","fii","dii"
        private java.util.Map<String, String> cardInferences;

        // Phase 4: holistic one-line summary across all markets (shown at bottom of Markets tab)
        private String globalRead;
    }

    // ═══════ TIER 2: STRATEGY ALIGNMENT ═══════

    private List<StrategyAlignment> strategyAlignments;

    @Data @Builder
    public static class StrategyAlignment {
        private String strategy;         // "FUDKII", "QUANT", "MICROALPHA", etc.
        private String status;           // "ALIGNED", "CONFLICTING", "WAITING", "SUPPRESSED"
        private String statusIcon;       // "✅", "⚠️", "⏳", "⛔"
        private String description;      // What the strategy did
        private String macroContext;     // What macro says about it
        private String riskLevel;        // "LOW", "MEDIUM", "HIGH"
        private int activePositions;
        private double dayPnl;
        private double totalPnl;
        private double drawdownPct;
    }

    // ═══════ TIER 3: POSITION GUIDANCE ═══════

    private List<PositionGuidance> positionGuidance;

    @Data @Builder
    public static class PositionGuidance {
        private String scripCode;
        private String symbol;
        private String strategy;
        private String side;              // "LONG", "SHORT"
        private double entryPrice;
        private double currentPrice;
        private double pnl;
        private double pnlPct;
        private String action;            // "HOLD", "TIGHTEN_SL", "EXIT_EARLY", "TRAIL"
        private String reason;            // Why this action
        private String sectorStatus;      // "Nifty Metal +3.2% — supportive"
        private boolean t1Hit;
        private boolean greekTrailActive;
        private double currentSl;
        private double suggestedSl;       // What SL should be based on macro
    }

    // ═══════ TIER 4: ALERTS ═══════

    private List<Alert> alerts;

    @Data @Builder
    public static class Alert {
        private String severity;          // "CRITICAL", "WARNING", "INFO"
        private String icon;              // Emoji
        private String title;
        private String message;
        private String action;            // Suggested action
        private long timestamp;
    }

    // ═══════ TIER 5: EVIDENCE (Collapsed Sections) ═══════

    // 5a: Commodity Cross-Signals
    private CommoditySignals commoditySignals;

    @Data @Builder
    public static class CommoditySignals {
        private List<CommodityPrice> commodities;
        private List<String> inferences;   // Plain language cross-signal inferences

        @Data @Builder
        public static class CommodityPrice {
            private String name;           // "Gold", "Silver", "Crude", etc.
            private double price;
            private double changePct;
            private String direction;      // "UP", "DOWN", "FLAT"
        }
    }

    // 5b: Sector Heatmap (Nifty indices)
    private List<SectorIndex> sectorIndices;

    @Data @Builder
    public static class SectorIndex {
        private String name;               // "Bank", "Metal", "IT", "Energy", etc.
        private String fullName;           // "Nifty Bank", "Nifty Metal", etc.
        private double changePct;
        private String inference;          // "Supported by Hang Seng +3.1%"
    }

    // 5c: Asian Markets
    private AsianMarkets asianMarkets;

    @Data @Builder
    public static class AsianMarkets {
        // Last-traded prices (populated by GlobalIndicesPoller from yfinance)
        private double nikkeiPrice;
        private double nikkeiChangePct;
        private double hangSengPrice;
        private double hangSengChangePct;
        private double shanghaiPrice;
        private double shanghaiChangePct;
        private double kospiPrice;
        private double kospiChangePct;
        private double assScore;
        private String regime;
        private String inference;          // "All Asian markets green. FII likely buying."
    }

    // 5d: FII/DII Intelligence
    private FiiDiiIntelligence fiiDiiIntelligence;

    @Data @Builder
    public static class FiiDiiIntelligence {
        private double fiiNetToday;
        private double diiNetToday;
        private double fiiNetWeek;
        private double diiNetWeek;
        private int fiiSellingStreak;      // consecutive selling days
        private int diiBuyingStreak;
        private String narrative;          // "FII selling but DII absorbing. Not panic — rebalancing."
        private List<Map<String, Object>> dailyBreakdown;  // last 5 days
    }

    // 5e: Institutional Deals
    private DealIntelligence dealIntelligence;

    @Data @Builder
    public static class DealIntelligence {
        private int blockDealCount;
        private int bulkDealCount;
        private double totalDealVolumeCr;
        private List<WatchlistItem> watchlist;         // Smart money scored
        private List<SectorFlow> sectorFlows;          // Per-sector FII/DII/Other
        private List<ClientActivity> topClients;       // Top 15 institutional clients
        private List<StockDeal> topStocks;             // Top 12 by deal value
        private List<Map<String, Object>> eventsWithDeals;  // Corporate events + deal cross-ref
        private List<String> dealInsights;             // "9 stocks with 3+ day repeat", etc.

        @Data @Builder
        public static class WatchlistItem {
            private String symbol;
            private String bias;           // "LONG", "SHORT"
            private double score;
            private String conviction;     // "VERY_HIGH", "HIGH", "MODERATE"
            private boolean fnoEligible;
            private double netCr;
            private List<String> reasons;
            private String sector;
        }

        @Data @Builder
        public static class SectorFlow {
            private String sector;
            private double netCr;
            private double fiiBuyCr;
            private double fiiSellCr;
            private double diiBuyCr;
            private double diiSellCr;
            private double otherBuyCr;
            private double otherSellCr;
            private int dealCount;
            private double deliveryPct;
            private String signal;                  // Plain language interpretation (legacy 1-line)
            // Phase 7: drill-down enrichment
            private List<StockContribution> topStocks;   // top 3 contributors by abs(netCr)
            private List<String> topClients;             // top 2 client names by abs(netCr)
            private String inference;                    // richer 1-line takeaway with stock/client names
            private String regime;                       // ACCUMULATION / DISTRIBUTION / MIXED / NEUTRAL
            // Phase 7b: multi-day persistence (5-day window from Redis snapshots)
            private int daysFlowing;                     // 1=today only; 2=2-day streak; 5=full-week sustained
            private String streakDirection;              // "BUY" / "SELL" / "MIXED"
            private String traderAction;                 // concrete retail action: BUY-DIPS / TRIM / AVOID / WAIT
            // Phase 7c: 5-day cumulative context (so user sees both today's flow and the week's sum)
            private double weekTotalCr;                  // sum of net Cr across all 5 trading days returned by the API
            private String dataDate;                     // the latest deal date that today's netCr is computed from

            @Data @Builder
            public static class StockContribution {
                private String symbol;
                private double netCr;
                private String side;       // BUY-NET / SELL-NET
                private int dealCount;
                // Phase 8d: churn detection
                private double grossCr;          // sum of all buy + all sell across all clients
                private double churnRatio;       // 0..1 — fraction of gross that was self-matched by individual clients
                private String flowQuality;      // HIGH / MEDIUM / LOW / CHURN
                private String dominantClient;   // top client by gross volume
                // Phase 8c: FII vs DII alignment per stock
                private double fiiNetCr;         // sum of FII clients' net Cr on this stock
                private double diiNetCr;         // sum of DII clients' net Cr on this stock
                private String fiiDiiAlignment;  // FII_DII_BUY / FII_DII_SELL / FII_SELL_DII_BUY (accum) / FII_BUY_DII_SELL (distrib) / FII_ONLY_BUY / FII_ONLY_SELL / DII_ONLY_BUY / DII_ONLY_SELL / NO_INST
                // Phase 8a: 5-day daily flow rhythm
                private List<Double> dailyCrTimeseries;  // oldest → newest (one entry per trading day in the API window)
                private List<String> dailyDates;         // matching dates for the timeseries (yyyy-MM-dd)
                private String pattern;                  // SYSTEMATIC / BLOCK_EXIT / PERSISTENT_BUYING / PERSISTENT_SELLING / CHOPPY / SINGLE_DAY / MIXED_2D
            }

            // Phase 8d: structured client flow (replaces opaque "NAME (+X Cr)" string)
            @Data @Builder
            public static class ClientFlowDetail {
                private String name;
                private String type;       // FII / DII / PROP_BROKER / OTHER
                private double buyCr;
                private double sellCr;
                private double netCr;
                private double churnRatio; // own self-match ratio (matched / gross for this client)
            }

            // Phase 8d: structured client flow list (kept alongside legacy topClients string list)
            private List<ClientFlowDetail> topClientFlows;
            // Phase 8d: ratio of sector gross flow that was self-matched by single clients (0..1)
            private double sectorChurnRatio;
        }

        @Data @Builder
        public static class ClientActivity {
            private String name;
            private String type;           // "FII", "DII", "OTHER", "PROP_BROKER"
            private double buyCr;
            private double sellCr;
            private double netCr;
            private List<String> buySymbols;
            private List<String> sellSymbols;
            private int dealCount;
        }

        @Data @Builder
        public static class StockDeal {
            private String symbol;
            private String sector;
            private double netCr;
            private double blockBuyCr;
            private double blockSellCr;
            private double bulkBuyCr;
            private double bulkSellCr;
            private int dateCount;
            private List<String> clients;
            private String corporateEvent;
            private double blockPct;
        }
    }

    // 5f: Delivery Analysis
    private DeliveryAnalysis deliveryAnalysis;

    @Data @Builder
    public static class DeliveryAnalysis {
        private String date;
        private List<SectorDelivery> sectors;
        private String inference;          // "High delivery in banking = institutions positioning"

        @Data @Builder
        public static class SectorDelivery {
            private String sector;
            private double deliveryPct;
            private double turnoverLacs;
            private String signal;         // "High conviction", "Speculative", "Normal"
        }
    }

    // 5h: Institutional Activity (Phase 5+6) — security-wise + fund-wise breakdown of today's deals
    private InstitutionalActivity institutionalActivity;

    @Data @Builder
    public static class InstitutionalActivity {
        private List<SecurityActivity> bySecurity;     // sorted by abs(netCr) desc
        private List<ClientFlow> byClient;             // sorted by abs(netCr) desc
        private int totalDealsCount;
        private double totalDealValueCr;
        private int accumulationCount;                 // # securities flagged as institutional accumulation
        private int distributionCount;                 // # flagged as distribution
        private String headlineSummary;                // 1-line takeaway across all today's activity
        private String dataDate;                       // e.g., "10-Apr-2026"

        @Data @Builder
        public static class SecurityActivity {
            private String symbol;
            private String sector;
            private double netCr;                      // total net (buy - sell) across all clients
            private double fiiNetCr;
            private double diiNetCr;
            private double propNetCr;                  // proprietary brokers
            private double otherNetCr;
            private int dealCount;
            private double topDealCr;                  // largest single deal
            private double deliveryPct;                // from delivery-data.bySymbol
            private double sectorDeliveryPct;          // sector median for comparison
            private String topBuyer;                   // largest BUY-side client name
            private String topSeller;                  // largest SELL-side client name
            // Wyckoff divergence engine output
            private String divergenceState;            // "ACCUMULATION", "DISTRIBUTION", "MIXED", "NEUTRAL"
            private String divergenceConfidence;       // "STRONG", "MODERATE", "WEAK", "NONE"
            private List<String> divergenceReasons;    // which validation gates passed
            private String inference;                  // 1-line actionable takeaway
        }

        @Data @Builder
        public static class ClientFlow {
            private String name;
            private String type;                       // FII, DII, PROP_BROKER, OTHER
            private double buyCr;
            private double sellCr;
            private double netCr;
            private int dealCount;
            private List<String> topBuySymbols;        // up to 5
            private List<String> topSellSymbols;       // up to 5
            private String inference;                  // 1-line read of this fund's day
        }
    }

    // 5g: Strategy Scorecard
    private List<StrategyScore> strategyScorecard;

    @Data @Builder
    public static class StrategyScore {
        private String strategy;
        private double balance;
        private double peakBalance;
        private double drawdown;
        private double drawdownPct;
        private double dayPnl;
        private int dayTrades;
        private int dayWins;
        private int dayLosses;
        private double winRate;
        private int totalTrades;
        private String status;             // "Working — metals aligned", "Blocked — leverage high"
    }

    // ═══════ METADATA ═══════

    private long computedAt;               // epoch millis
    private String marketStatus;           // "PRE_MARKET", "OPEN", "CLOSED"
    private String nextBoundary;           // "14:15 IST (MCX 30m boundary)"
}
