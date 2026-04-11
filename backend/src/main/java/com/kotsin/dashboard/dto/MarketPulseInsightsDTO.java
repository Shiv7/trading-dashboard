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
        private double niftyPrice;
        private double niftyChangePct;
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
        private double nikkeiChangePct;
        private double hangSengChangePct;
        private double shanghaiChangePct;
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
            private String signal;         // Plain language interpretation
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
