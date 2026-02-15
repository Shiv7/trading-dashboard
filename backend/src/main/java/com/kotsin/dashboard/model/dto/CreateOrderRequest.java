package com.kotsin.dashboard.model.dto;

import jakarta.validation.constraints.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for creating a new virtual order.
 * Matches the CreateOrder class in TradeExecutionModule.
 *
 * FIX BUG #7, #30: Added validation annotations to prevent invalid orders
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateOrderRequest {

    @NotBlank(message = "Scrip code is required")
    @Pattern(regexp = "^[A-Z0-9&-]+$", message = "Scrip code must be uppercase alphanumeric")
    private String scripCode;

    @NotNull(message = "Side is required")
    @Pattern(regexp = "^(BUY|SELL)$", message = "Side must be BUY or SELL")
    private String side;         // BUY or SELL

    @NotNull(message = "Order type is required")
    @Pattern(regexp = "^(MARKET|LIMIT)$", message = "Type must be MARKET or LIMIT")
    private String type;         // MARKET or LIMIT

    @Min(value = 1, message = "Quantity must be at least 1")
    @Max(value = 100000, message = "Quantity cannot exceed 100,000")
    private int qty;

    @Positive(message = "Limit price must be positive")
    private Double limitPrice;   // Required for LIMIT orders

    @Positive(message = "Current price must be positive")
    private Double currentPrice; // FIX: Added for MARKET orders

    @PositiveOrZero(message = "Stop loss must be positive or zero")
    private Double sl;           // Stop Loss

    @PositiveOrZero(message = "Target 1 must be positive or zero")
    private Double tp1;          // Target 1

    @PositiveOrZero(message = "Target 2 must be positive or zero")
    private Double tp2;          // Target 2

    @Min(value = 0, message = "TP1 close percent must be 0-100")
    @Max(value = 100, message = "TP1 close percent must be 0-100")
    private Double tp1ClosePercent;  // % to close at TP1 (default 50%)

    @Pattern(regexp = "^(NONE|FIXED|PCT)?$", message = "Trailing type must be NONE, FIXED, or PCT")
    private String trailingType;     // NONE, FIXED, PCT

    @PositiveOrZero(message = "Trailing value must be positive or zero")
    private Double trailingValue;    // Trailing stop value

    @PositiveOrZero(message = "Trailing step must be positive or zero")
    private Double trailingStep;     // Step for trailing updates

    // Signal reference (for auto-executed signals)
    private String signalId;

    // Strategy source: FUDKII, FUKAA, PIVOT, etc.
    private String signalSource;

    /**
     * FIX BUG #3: Custom validation to check SL/TP positions relative to entry
     * Called manually in controller before sending to execution service
     */
    public String validateSlTpPositions() {
        Double entry = limitPrice != null ? limitPrice : currentPrice;
        if (entry == null || entry <= 0) {
            return null; // Can't validate without entry price
        }

        boolean isBuy = "BUY".equals(side);

        // Validate SL position
        if (sl != null && sl > 0) {
            if (isBuy && sl >= entry) {
                return String.format("BUY order: Stop Loss (%.2f) must be BELOW entry (%.2f)", sl, entry);
            }
            if (!isBuy && sl <= entry) {
                return String.format("SELL order: Stop Loss (%.2f) must be ABOVE entry (%.2f)", sl, entry);
            }
        }

        // Validate TP1 position
        if (tp1 != null && tp1 > 0) {
            if (isBuy && tp1 <= entry) {
                return String.format("BUY order: Target 1 (%.2f) must be ABOVE entry (%.2f)", tp1, entry);
            }
            if (!isBuy && tp1 >= entry) {
                return String.format("SELL order: Target 1 (%.2f) must be BELOW entry (%.2f)", tp1, entry);
            }
        }

        // Validate TP2 relative to TP1
        if (tp2 != null && tp2 > 0 && tp1 != null && tp1 > 0) {
            if (isBuy && tp2 <= tp1) {
                return "BUY order: Target 2 must be above Target 1";
            }
            if (!isBuy && tp2 >= tp1) {
                return "SELL order: Target 2 must be below Target 1";
            }
        }

        return null; // Validation passed
    }
}
