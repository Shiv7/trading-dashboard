package com.kotsin.dashboard.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * DTO for IPU (Institutional Participation & Urgency) Signal
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IPUSignalDTO {
    
    // Identity
    private String scripCode;
    private String companyName;
    private String timeframe;
    private LocalDateTime timestamp;
    
    // Overall IPU Score
    private Double ipuFinalScore;         // 0-1 range
    private String ipuDirection;          // BULLISH/BEARISH/NEUTRAL
    
    // Core Components
    private Double institutionalProxy;    // 0-1 Quality of flow (buy/sell imbalance)  
    private Double momentum;              // 0-1 Price momentum strength
    private Double exhaustion;            // 0-1 Whether move is exhausted
    private Double urgency;               // 0-1 How urgent the signal is
    
    // Volume Metrics
    private Long aggressiveBuyVolume;     // Market buy orders (lifted offers)
    private Long aggressiveSellVolume;    // Market sell orders (hit bids)
    private Long totalVolume;             // Regular + Aggressive
    private Double volumeExpansionPct;    // % increase from avg
    private Double aggressiveVolumeRatio; // aggressive / total (0-100)
    
    // Directional Conviction
    private Double directionalConviction; // -1 to +1 (negative = bearish, positive = bullish)
    private Double volumeDeltaPct;        // Buy volume - Sell volume (%)
    
    // X-Factor Triggers
    private Boolean dibTriggered;         // Demand Imbalance Bar (buy volume spike)
    private Boolean vibTriggered;         // Volume Imbalance Bar (sell volume spike)
    private Boolean hasXFactor;           // Either DIB or VIB
    
    // Adjustments
    private String gapStatus;             // GAP_UP_HOLDING, GAP_DOWN_HOLDING, GAP_FILL, etc.
    private Double gapConvictionMultiplier; // 1.0-1.5 boost for gap holding
    private String liquidityTier;         // EXCELLENT, GOOD, FAIR, POOR
    private Double liquidityPenalty;      // 0.7-1.0 (penalty for low liquidity)
    
    // OFI (Order Flow Imbalance)
    private Double ofiPressure;           // -1 to +1 (sell pressure to buy pressure)
    private String ofiSignal;             // BUY_PRESSURE, SELL_PRESSURE, NEUTRAL
    
    // Price Efficiency
    private Double priceEfficiency;       // How efficiently price moved (0-1)
    private Boolean runBarTriggered;      // Momentum bar activation
    
    // Context
    private String momentumState;         // ACCELERATION, TRENDING, EXHAUSTED, etc.
    private Boolean usedPassiveVolume;    // TRUE if fallback to regular volume
    
    // Additional Details
    private Map<String, Object> rawMetrics; // For debugging/expansion
}
