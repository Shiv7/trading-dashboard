package com.kotsin.dashboard.hotstocks.model;

public class StrategyWatch {
    private String strategyName;    // "FUDKII"
    private String state;           // "WATCHING" / "ACTIVE" / "PENDING_ENTRY"
    private Double triggerLevel;    // null if not applicable
    private String notes;           // "BB squeeze forming"

    public StrategyWatch() {}

    public StrategyWatch(String strategyName, String state, Double triggerLevel, String notes) {
        this.strategyName = strategyName;
        this.state = state;
        this.triggerLevel = triggerLevel;
        this.notes = notes;
    }

    public String getStrategyName() { return strategyName; }
    public void setStrategyName(String strategyName) { this.strategyName = strategyName; }
    public String getState() { return state; }
    public void setState(String state) { this.state = state; }
    public Double getTriggerLevel() { return triggerLevel; }
    public void setTriggerLevel(Double triggerLevel) { this.triggerLevel = triggerLevel; }
    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
}
