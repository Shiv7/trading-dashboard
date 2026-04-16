package com.kotsin.dashboard.hotstocks.dto;

import java.time.Instant;

public record HotStocksActivePosition(
    String scripCode,
    String symbol,
    String exchange,
    String futScripCode,
    String side,
    double avgEntry,
    int qtyOpen,
    double sl,
    double t1, double t2, double t3, double t4,
    boolean t1Hit, boolean t2Hit, boolean t3Hit, boolean t4Hit,
    Instant openedAt
) {}
