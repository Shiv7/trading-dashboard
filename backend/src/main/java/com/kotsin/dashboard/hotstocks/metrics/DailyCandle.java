package com.kotsin.dashboard.hotstocks.metrics;

import java.time.LocalDate;

public record DailyCandle(LocalDate date, double open, double high, double low, double close, long volume) {}
