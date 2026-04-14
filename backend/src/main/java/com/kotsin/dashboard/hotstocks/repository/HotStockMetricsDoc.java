package com.kotsin.dashboard.hotstocks.repository;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDate;

@Document(collection = "hot_stocks_history")
public class HotStockMetricsDoc {
    @Id
    private String id;  // "{scripCode}_{tradingDate}"

    @Indexed
    private String scripCode;

    @Indexed
    private LocalDate tradingDate;

    private StockMetrics metrics;

    public HotStockMetricsDoc() {}

    public HotStockMetricsDoc(String scripCode, LocalDate tradingDate, StockMetrics metrics) {
        this.id = scripCode + "_" + tradingDate;
        this.scripCode = scripCode;
        this.tradingDate = tradingDate;
        this.metrics = metrics;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getScripCode() { return scripCode; }
    public void setScripCode(String scripCode) { this.scripCode = scripCode; }
    public LocalDate getTradingDate() { return tradingDate; }
    public void setTradingDate(LocalDate tradingDate) { this.tradingDate = tradingDate; }
    public StockMetrics getMetrics() { return metrics; }
    public void setMetrics(StockMetrics metrics) { this.metrics = metrics; }
}
