package com.kotsin.dashboard.hotstocks.model;

import java.time.LocalDate;

public class CorporateEvent {
    private String symbol;
    private String eventType;       // "EARNINGS" / "DIVIDEND" / "SPLIT" / "BONUS" / "AGM"
    private LocalDate eventDate;
    private String detail;          // e.g., "1:2 SPLIT" / "₹5 DIVIDEND"

    public CorporateEvent() {}

    public CorporateEvent(String symbol, String eventType, LocalDate eventDate, String detail) {
        this.symbol = symbol;
        this.eventType = eventType;
        this.eventDate = eventDate;
        this.detail = detail;
    }

    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }
    public LocalDate getEventDate() { return eventDate; }
    public void setEventDate(LocalDate eventDate) { this.eventDate = eventDate; }
    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }
}
