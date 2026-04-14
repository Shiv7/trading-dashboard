package com.kotsin.dashboard.pivotboss;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.Map;

/**
 * Read-only mirror of {@code pivotboss_signal_audit} written by streamingcandle.
 * Field names match the producer side; unknown extras are ignored by Mongo.
 */
@Document(collection = "pivotboss_signal_audit")
public class PivotBossAuditDoc {
    @Id
    private String id;
    private String scripCode;
    private String symbol;
    private Instant triggeredAt;
    private String decision;
    private Integer setupId;
    private String direction;
    private Double biasScore;
    private String biasDirection;
    private Double confluenceDepth;
    private String cprRegime;
    private String twoDayRelation;
    private String gapClass;
    private Double entryPrice;
    private Double stopLoss;
    private Double target1;
    private Double target2;
    private Double target3;
    private Double rrOnUnderlying;
    private String optionScripCode;
    private Double optionLtp;
    private Map<String, Object> extras;

    public String getId() { return id; }
    public String getScripCode() { return scripCode; }
    public String getSymbol() { return symbol; }
    public Instant getTriggeredAt() { return triggeredAt; }
    public String getDecision() { return decision; }
    public Integer getSetupId() { return setupId; }
    public String getDirection() { return direction; }
    public Double getBiasScore() { return biasScore; }
    public String getBiasDirection() { return biasDirection; }
    public Double getConfluenceDepth() { return confluenceDepth; }
    public String getCprRegime() { return cprRegime; }
    public String getTwoDayRelation() { return twoDayRelation; }
    public String getGapClass() { return gapClass; }
    public Double getEntryPrice() { return entryPrice; }
    public Double getStopLoss() { return stopLoss; }
    public Double getTarget1() { return target1; }
    public Double getTarget2() { return target2; }
    public Double getTarget3() { return target3; }
    public Double getRrOnUnderlying() { return rrOnUnderlying; }
    public String getOptionScripCode() { return optionScripCode; }
    public Double getOptionLtp() { return optionLtp; }
    public Map<String, Object> getExtras() { return extras; }
}
