package com.kotsin.dashboard.service;

import org.bson.Document;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies buildTodayExit emits trailed SL (W3), target levels T1..T4 (W4),
 * and normalizes the strategy field via StrategyNameResolver (W5). These three
 * fixes together make exit cards render the same SL/target context active cards
 * show, and make the wallet strategy-filter match exit cards too.
 */
@ExtendWith(MockitoExtension.class)
class LiveTradesServiceBuildTodayExitTest {

    @InjectMocks
    private LiveTradesService service;

    @Test
    void buildTodayExit_emitsTargetsAndTrailedSl_forFudkoiTrade() {
        Document doc = new Document()
            .append("symbol", "M&M 28 APR 2026 PE 3200.00")
            .append("scripCode", "138508")
            .append("strategy", "FUDKOI")
            .append("direction", "BEARISH")
            .append("entryPrice", 52.05)
            .append("exitPrice", 49.65)
            .append("exitReason", "SL-OP")
            .append("stopLoss", 47.89)
            .append("equitySl", 3213.61)
            .append("optionSl", 49.97)
            .append("target1", 62.15)
            .append("target2", 82.28)
            .append("target3", 100.87)
            .append("target4", 120.00)
            .append("equityT1", 3170.0)
            .append("optionT1", 62.15)
            .append("target1Hit", false);

        Map<String, Object> out = service.buildTodayExit(doc);

        // targets emitted
        assertThat(out.get("target1")).isEqualTo(62.15);
        assertThat(out.get("target3")).isEqualTo(100.87);
        assertThat(out.get("optionT1")).isEqualTo(62.15);

        // SL: exit-time (trailed) SL emitted as a separate field
        assertThat(out.get("optionSl")).isEqualTo(49.97);  // trailed, used at exit
        assertThat(out.get("equitySl")).isEqualTo(3213.61);
        assertThat(out.get("stopLoss")).isEqualTo(47.89);  // signal-time (static), kept for display parity

        // Strategy field should be normalized
        assertThat(out.get("strategy")).isEqualTo("FUDKOI");
    }

    @Test
    void buildTodayExit_normalizesStrategyField() {
        Document doc = new Document()
            .append("symbol", "TESTSCRIP")
            .append("strategy", "microalpha")    // lowercase raw
            .append("signalSource", "MICROALPHA")
            .append("entryPrice", 100.0)
            .append("exitPrice", 105.0);

        Map<String, Object> out = service.buildTodayExit(doc);

        // Should be normalized to canonical "MICROALPHA"
        assertThat(out.get("strategy")).isEqualTo("MICROALPHA");
    }
}
