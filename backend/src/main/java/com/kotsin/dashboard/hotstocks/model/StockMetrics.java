package com.kotsin.dashboard.hotstocks.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class StockMetrics {
    // Identity
    private String scripCode;
    private String symbol;
    private String sector;
    private boolean fnoEligible;
    private Instant lastUpdatedIst;

    // Price facts
    private double ltpYesterday;
    private double change1dPct;
    private double change5dPct;
    private double change20dPct;

    // vs sector + Nifty
    private double vsSectorIndexPct;
    private String vsSectorLabel;       // "LEADING" / "INLINE" / "LAGGING"
    private double vsNifty50Pct;
    private String vsNiftyLabel;

    // Smart money (10-day window)
    private int bulkDealCount;
    private int blockDealCount;
    private int dealDays;
    private double smartBuyCr;
    private double smartSellCr;
    private List<String> smartBuyClients = new ArrayList<>();
    private List<String> smartSellClients = new ArrayList<>();
    private String dominantFlow;        // "FII_BUY" / "DII_BUY" / "FII_SELL" / "DII_SELL" / "MIXED"

    // Delivery
    private double deliveryPctLatest;
    private double deliveryPctAvg5d;
    private String deliveryTrend;       // "RISING" / "FALLING" / "STABLE"
    private String deliveryInterpretation;  // "STRONG_INSTITUTIONAL_ACCUMULATION" / "MODERATE_HOLDING" / "MIXED_ROTATION" / "RETAIL_DOMINATED"
    private String deliveryTrendLabel;  // "MF_ACCUMULATING" / "MF_DISTRIBUTING" / "STABLE"
    private boolean deliveryInstitutional;

    // Structural
    private Double above50dmaPct;
    private Double above200dmaPct;
    private String trendState;          // "UPTREND" / "DOWNTREND" / "SIDEWAYS" / "INSUFFICIENT"
    private Double rsi14;
    private Double weekly52PositionPct;

    // Per-stock regime
    private String priceRegime;         // "BULLISH_TREND" / "BEARISH_TREND" / "RANGE_BOUND"
    private double priceRegimeConfidence;

    // Sector context
    private double sectorChange1dPct;
    private double sectorChange5dPct;
    private int sectorRankInSector;
    private int sectorRankBySectorPerf;
    private String sectorState;         // "LEADING" / "NEUTRAL" / "LAGGING"

    // Volume + liquidity
    private double volumeRatio5d20d;
    private String volumeRegime;        // "ELEVATED" / "NORMAL" / "QUIET"
    private double avgTurnover20dCr;
    private LiquidityTier liquidityTier;

    // Swing levels (for action cue)
    private double swingLow20d;
    private double swingHigh20d;
    private double entryZoneLow;
    private double entryZoneHigh;
    private double suggestedSlPrice;

    // OI (F&O only; null for cash)
    private Double oiChangePct5d;
    private String oiInterpretation;    // "LONG_BUILDUP" / "SHORT_COVERING" / "SHORT_BUILDUP" / "LONG_UNWINDING"
    private String volumeRegimeLabel;   // "INSTITUTIONAL_ACCUMULATION" / "RETAIL_SPIKE" / "NORMAL" / "QUIET"

    // Smart-money hedging indicators (nullable — populated only when data available).
    // Added 2026-04-15: feed Clamp 6 (short-interest rising) and Clamp 7 (PCR ballooning).
    // Delta values are ratios: 0.50 = +50%, -0.30 = -30%, null = no data / not F&O / not enough history.
    private Double shortInterestDelta5d;
    private Double pcrDelta5d;

    // Corporate events
    private List<CorporateEvent> upcomingEvents = new ArrayList<>();
    private Integer daysToNearestEvent;
    private String nearestEventType;
    private boolean eventWithin3Days;
    private boolean hasSplitAnnouncement;
    private boolean hasBonusAnnouncement;
    private boolean hasDividendExDate;
    private String nextCorporateActionLabel;

    // Strategy cross-reference
    private List<StrategyWatch> strategiesWatching = new ArrayList<>();

    // Narrative (rule-based generated)
    private String thesisText;
    private ActionCueType actionCueType;
    private String actionCueText;

    // Phase 2 scoring slot (null in Phase 1)
    private Integer confidenceScore;
    private String scoringRegime;
    private String scoringModel;

    // v2 scoring (HotStocksScoringEngine)
    private Integer v2Score;                 // signed [-100,+100]
    private Integer v2PreClampScore;         // before hard clamps
    private String  v2Tier;                  // "FNO" / "NON_FNO"
    private Double  v2DataConfidence;        // 0.0–1.0
    private java.util.List<String> v2Clamps = new java.util.ArrayList<>();
    private Integer v2Bucket1, v2Bucket2, v2Bucket3, v2Bucket4, v2Bucket5;
    private Double  v2OiChange5dPct;         // null for non-F&O
    private Double  v2NetInstitutionalCr;    // buy - sell, time-decayed

    public Integer getV2Score() { return v2Score; }
    public void setV2Score(Integer v) { this.v2Score = v; }
    public Integer getV2PreClampScore() { return v2PreClampScore; }
    public void setV2PreClampScore(Integer v) { this.v2PreClampScore = v; }
    public String getV2Tier() { return v2Tier; }
    public void setV2Tier(String v) { this.v2Tier = v; }
    public Double getV2DataConfidence() { return v2DataConfidence; }
    public void setV2DataConfidence(Double v) { this.v2DataConfidence = v; }
    public java.util.List<String> getV2Clamps() { return v2Clamps; }
    public void setV2Clamps(java.util.List<String> v) { this.v2Clamps = v; }
    public Integer getV2Bucket1() { return v2Bucket1; }
    public void setV2Bucket1(Integer v) { this.v2Bucket1 = v; }
    public Integer getV2Bucket2() { return v2Bucket2; }
    public void setV2Bucket2(Integer v) { this.v2Bucket2 = v; }
    public Integer getV2Bucket3() { return v2Bucket3; }
    public void setV2Bucket3(Integer v) { this.v2Bucket3 = v; }
    public Integer getV2Bucket4() { return v2Bucket4; }
    public void setV2Bucket4(Integer v) { this.v2Bucket4 = v; }
    public Integer getV2Bucket5() { return v2Bucket5; }
    public void setV2Bucket5(Integer v) { this.v2Bucket5 = v; }
    public Double getV2OiChange5dPct() { return v2OiChange5dPct; }
    public void setV2OiChange5dPct(Double v) { this.v2OiChange5dPct = v; }
    public Double getV2NetInstitutionalCr() { return v2NetInstitutionalCr; }
    public void setV2NetInstitutionalCr(Double v) { this.v2NetInstitutionalCr = v; }

    // ---- Getters and setters ----

    // Identity
    public String getScripCode() { return scripCode; }
    public void setScripCode(String scripCode) { this.scripCode = scripCode; }
    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    public String getSector() { return sector; }
    public void setSector(String sector) { this.sector = sector; }
    public boolean isFnoEligible() { return fnoEligible; }
    public void setFnoEligible(boolean fnoEligible) { this.fnoEligible = fnoEligible; }
    public Instant getLastUpdatedIst() { return lastUpdatedIst; }
    public void setLastUpdatedIst(Instant lastUpdatedIst) { this.lastUpdatedIst = lastUpdatedIst; }

    // Price facts
    public double getLtpYesterday() { return ltpYesterday; }
    public void setLtpYesterday(double ltpYesterday) { this.ltpYesterday = ltpYesterday; }
    public double getChange1dPct() { return change1dPct; }
    public void setChange1dPct(double change1dPct) { this.change1dPct = change1dPct; }
    public double getChange5dPct() { return change5dPct; }
    public void setChange5dPct(double change5dPct) { this.change5dPct = change5dPct; }
    public double getChange20dPct() { return change20dPct; }
    public void setChange20dPct(double change20dPct) { this.change20dPct = change20dPct; }

    // vs sector + Nifty
    public double getVsSectorIndexPct() { return vsSectorIndexPct; }
    public void setVsSectorIndexPct(double vsSectorIndexPct) { this.vsSectorIndexPct = vsSectorIndexPct; }
    public String getVsSectorLabel() { return vsSectorLabel; }
    public void setVsSectorLabel(String vsSectorLabel) { this.vsSectorLabel = vsSectorLabel; }
    public double getVsNifty50Pct() { return vsNifty50Pct; }
    public void setVsNifty50Pct(double vsNifty50Pct) { this.vsNifty50Pct = vsNifty50Pct; }
    public String getVsNiftyLabel() { return vsNiftyLabel; }
    public void setVsNiftyLabel(String vsNiftyLabel) { this.vsNiftyLabel = vsNiftyLabel; }

    // Smart money
    public int getBulkDealCount() { return bulkDealCount; }
    public void setBulkDealCount(int bulkDealCount) { this.bulkDealCount = bulkDealCount; }
    public int getBlockDealCount() { return blockDealCount; }
    public void setBlockDealCount(int blockDealCount) { this.blockDealCount = blockDealCount; }
    public int getDealDays() { return dealDays; }
    public void setDealDays(int dealDays) { this.dealDays = dealDays; }
    public double getSmartBuyCr() { return smartBuyCr; }
    public void setSmartBuyCr(double smartBuyCr) { this.smartBuyCr = smartBuyCr; }
    public double getSmartSellCr() { return smartSellCr; }
    public void setSmartSellCr(double smartSellCr) { this.smartSellCr = smartSellCr; }
    public List<String> getSmartBuyClients() { return smartBuyClients; }
    public void setSmartBuyClients(List<String> smartBuyClients) { this.smartBuyClients = smartBuyClients; }
    public List<String> getSmartSellClients() { return smartSellClients; }
    public void setSmartSellClients(List<String> smartSellClients) { this.smartSellClients = smartSellClients; }
    public String getDominantFlow() { return dominantFlow; }
    public void setDominantFlow(String dominantFlow) { this.dominantFlow = dominantFlow; }

    // Delivery
    public double getDeliveryPctLatest() { return deliveryPctLatest; }
    public void setDeliveryPctLatest(double deliveryPctLatest) { this.deliveryPctLatest = deliveryPctLatest; }
    public double getDeliveryPctAvg5d() { return deliveryPctAvg5d; }
    public void setDeliveryPctAvg5d(double deliveryPctAvg5d) { this.deliveryPctAvg5d = deliveryPctAvg5d; }
    public String getDeliveryTrend() { return deliveryTrend; }
    public void setDeliveryTrend(String deliveryTrend) { this.deliveryTrend = deliveryTrend; }
    public String getDeliveryInterpretation() { return deliveryInterpretation; }
    public void setDeliveryInterpretation(String deliveryInterpretation) { this.deliveryInterpretation = deliveryInterpretation; }
    public String getDeliveryTrendLabel() { return deliveryTrendLabel; }
    public void setDeliveryTrendLabel(String deliveryTrendLabel) { this.deliveryTrendLabel = deliveryTrendLabel; }
    public boolean isDeliveryInstitutional() { return deliveryInstitutional; }
    public void setDeliveryInstitutional(boolean deliveryInstitutional) { this.deliveryInstitutional = deliveryInstitutional; }

    // Structural
    public Double getAbove50dmaPct() { return above50dmaPct; }
    public void setAbove50dmaPct(Double above50dmaPct) { this.above50dmaPct = above50dmaPct; }
    public Double getAbove200dmaPct() { return above200dmaPct; }
    public void setAbove200dmaPct(Double above200dmaPct) { this.above200dmaPct = above200dmaPct; }
    public String getTrendState() { return trendState; }
    public void setTrendState(String trendState) { this.trendState = trendState; }
    public Double getRsi14() { return rsi14; }
    public void setRsi14(Double rsi14) { this.rsi14 = rsi14; }
    public Double getWeekly52PositionPct() { return weekly52PositionPct; }
    public void setWeekly52PositionPct(Double weekly52PositionPct) { this.weekly52PositionPct = weekly52PositionPct; }

    // Per-stock regime
    public String getPriceRegime() { return priceRegime; }
    public void setPriceRegime(String priceRegime) { this.priceRegime = priceRegime; }
    public double getPriceRegimeConfidence() { return priceRegimeConfidence; }
    public void setPriceRegimeConfidence(double priceRegimeConfidence) { this.priceRegimeConfidence = priceRegimeConfidence; }

    // Sector context
    public double getSectorChange1dPct() { return sectorChange1dPct; }
    public void setSectorChange1dPct(double sectorChange1dPct) { this.sectorChange1dPct = sectorChange1dPct; }
    public double getSectorChange5dPct() { return sectorChange5dPct; }
    public void setSectorChange5dPct(double sectorChange5dPct) { this.sectorChange5dPct = sectorChange5dPct; }
    public int getSectorRankInSector() { return sectorRankInSector; }
    public void setSectorRankInSector(int sectorRankInSector) { this.sectorRankInSector = sectorRankInSector; }
    public int getSectorRankBySectorPerf() { return sectorRankBySectorPerf; }
    public void setSectorRankBySectorPerf(int sectorRankBySectorPerf) { this.sectorRankBySectorPerf = sectorRankBySectorPerf; }
    public String getSectorState() { return sectorState; }
    public void setSectorState(String sectorState) { this.sectorState = sectorState; }

    // Volume + liquidity
    public double getVolumeRatio5d20d() { return volumeRatio5d20d; }
    public void setVolumeRatio5d20d(double volumeRatio5d20d) { this.volumeRatio5d20d = volumeRatio5d20d; }
    public String getVolumeRegime() { return volumeRegime; }
    public void setVolumeRegime(String volumeRegime) { this.volumeRegime = volumeRegime; }
    public double getAvgTurnover20dCr() { return avgTurnover20dCr; }
    public void setAvgTurnover20dCr(double avgTurnover20dCr) { this.avgTurnover20dCr = avgTurnover20dCr; }
    public LiquidityTier getLiquidityTier() { return liquidityTier; }
    public void setLiquidityTier(LiquidityTier liquidityTier) { this.liquidityTier = liquidityTier; }

    // Swing levels
    public double getSwingLow20d() { return swingLow20d; }
    public void setSwingLow20d(double swingLow20d) { this.swingLow20d = swingLow20d; }
    public double getSwingHigh20d() { return swingHigh20d; }
    public void setSwingHigh20d(double swingHigh20d) { this.swingHigh20d = swingHigh20d; }
    public double getEntryZoneLow() { return entryZoneLow; }
    public void setEntryZoneLow(double entryZoneLow) { this.entryZoneLow = entryZoneLow; }
    public double getEntryZoneHigh() { return entryZoneHigh; }
    public void setEntryZoneHigh(double entryZoneHigh) { this.entryZoneHigh = entryZoneHigh; }
    public double getSuggestedSlPrice() { return suggestedSlPrice; }
    public void setSuggestedSlPrice(double suggestedSlPrice) { this.suggestedSlPrice = suggestedSlPrice; }

    // OI
    public Double getOiChangePct5d() { return oiChangePct5d; }
    public void setOiChangePct5d(Double oiChangePct5d) { this.oiChangePct5d = oiChangePct5d; }
    public String getOiInterpretation() { return oiInterpretation; }
    public void setOiInterpretation(String oiInterpretation) { this.oiInterpretation = oiInterpretation; }
    public String getVolumeRegimeLabel() { return volumeRegimeLabel; }
    public void setVolumeRegimeLabel(String volumeRegimeLabel) { this.volumeRegimeLabel = volumeRegimeLabel; }

    // Smart-money hedging indicators
    public Double getShortInterestDelta5d() { return shortInterestDelta5d; }
    public void setShortInterestDelta5d(Double v) { this.shortInterestDelta5d = v; }
    public Double getPcrDelta5d() { return pcrDelta5d; }
    public void setPcrDelta5d(Double v) { this.pcrDelta5d = v; }

    // Corporate events
    public List<CorporateEvent> getUpcomingEvents() { return upcomingEvents; }
    public void setUpcomingEvents(List<CorporateEvent> upcomingEvents) { this.upcomingEvents = upcomingEvents; }
    public Integer getDaysToNearestEvent() { return daysToNearestEvent; }
    public void setDaysToNearestEvent(Integer daysToNearestEvent) { this.daysToNearestEvent = daysToNearestEvent; }
    public String getNearestEventType() { return nearestEventType; }
    public void setNearestEventType(String nearestEventType) { this.nearestEventType = nearestEventType; }
    public boolean isEventWithin3Days() { return eventWithin3Days; }
    public void setEventWithin3Days(boolean eventWithin3Days) { this.eventWithin3Days = eventWithin3Days; }
    public boolean isHasSplitAnnouncement() { return hasSplitAnnouncement; }
    public void setHasSplitAnnouncement(boolean hasSplitAnnouncement) { this.hasSplitAnnouncement = hasSplitAnnouncement; }
    public boolean isHasBonusAnnouncement() { return hasBonusAnnouncement; }
    public void setHasBonusAnnouncement(boolean hasBonusAnnouncement) { this.hasBonusAnnouncement = hasBonusAnnouncement; }
    public boolean isHasDividendExDate() { return hasDividendExDate; }
    public void setHasDividendExDate(boolean hasDividendExDate) { this.hasDividendExDate = hasDividendExDate; }
    public String getNextCorporateActionLabel() { return nextCorporateActionLabel; }
    public void setNextCorporateActionLabel(String nextCorporateActionLabel) { this.nextCorporateActionLabel = nextCorporateActionLabel; }

    // Strategy cross-reference
    public List<StrategyWatch> getStrategiesWatching() { return strategiesWatching; }
    public void setStrategiesWatching(List<StrategyWatch> strategiesWatching) { this.strategiesWatching = strategiesWatching; }

    // Narrative
    public String getThesisText() { return thesisText; }
    public void setThesisText(String thesisText) { this.thesisText = thesisText; }
    public ActionCueType getActionCueType() { return actionCueType; }
    public void setActionCueType(ActionCueType actionCueType) { this.actionCueType = actionCueType; }
    public String getActionCueText() { return actionCueText; }
    public void setActionCueText(String actionCueText) { this.actionCueText = actionCueText; }

    // Phase 2 scoring slot
    public Integer getConfidenceScore() { return confidenceScore; }
    public void setConfidenceScore(Integer confidenceScore) { this.confidenceScore = confidenceScore; }
    public String getScoringRegime() { return scoringRegime; }
    public void setScoringRegime(String scoringRegime) { this.scoringRegime = scoringRegime; }
    public String getScoringModel() { return scoringModel; }
    public void setScoringModel(String scoringModel) { this.scoringModel = scoringModel; }
}
