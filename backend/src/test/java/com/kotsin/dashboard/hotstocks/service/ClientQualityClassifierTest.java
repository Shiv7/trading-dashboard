package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.service.ClientQualityClassifier.Tier;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ClientQualityClassifierTest {

    private final ClientQualityClassifier c = new ClientQualityClassifier();

    @Test
    void smart_mutualFundTrustees() {
        assertEquals(Tier.SMART, c.classify("NIPPON INDIA MUTUAL FUND TRUSTEES LIMITED"));
    }

    @Test
    void smart_amcLimited() {
        assertEquals(Tier.SMART, c.classify("HDFC AMC LIMITED"));
        assertEquals(Tier.SMART, c.classify("Aditya Birla Sun Life AMC Ltd"));
    }

    @Test
    void smart_insurance() {
        assertEquals(Tier.SMART, c.classify("LIC OF INDIA INSURANCE"));
    }

    @Test
    void smart_pension() {
        assertEquals(Tier.SMART, c.classify("NATIONAL PENSION SYSTEM TRUST"));
    }

    @Test
    void smart_fpiForeignPortfolio() {
        assertEquals(Tier.SMART, c.classify("ABC FOREIGN PORTFOLIO INVESTOR"));
    }

    @Test
    void smart_fii() {
        assertEquals(Tier.SMART, c.classify("SOME FII LIMITED"));
    }

    @Test
    void smart_bankLimited_notBroker() {
        assertEquals(Tier.SMART, c.classify("AXIS BANK LIMITED"));
    }

    @Test
    void neutral_bankLimited_brokerExcluded() {
        // BANK LIMITED matched but BANK BROKERS substring → NOT SMART.
        assertEquals(Tier.NEUTRAL,
                c.classify("ZZZ BANK BROKERS CAPITAL LIMITED"),
                "BANK BROKERS exclusion overrides BANK LIMITED → NEUTRAL");
    }

    @Test
    void shell_huf() {
        assertEquals(Tier.SHELL, c.classify("RAMESH KUMAR HUF"));
    }

    @Test
    void shell_llp() {
        assertEquals(Tier.SHELL, c.classify("GROWTH PARTNERS LLP"));
    }

    @Test
    void shell_ventures() {
        assertEquals(Tier.SHELL, c.classify("ACME VENTURES PRIVATE LIMITED"));
    }

    @Test
    void shell_realtyPrivateLimited() {
        assertEquals(Tier.SHELL, c.classify("XYZ REALTY PRIVATE LIMITED"));
    }

    @Test
    void broker_exception_overridesShell() {
        // Contains CAPITAL MARKETS LIMITED but is a known broker → NEUTRAL.
        assertEquals(Tier.NEUTRAL,
                c.classify("MOTILAL OSWAL CAPITAL MARKETS LIMITED"),
                "broker exception overrides SHELL markers");
    }

    @Test
    void broker_exception_iifl() {
        assertEquals(Tier.NEUTRAL, c.classify("IIFL SECURITIES LIMITED"));
    }

    @Test
    void neutral_emptyOrNull() {
        assertEquals(Tier.NEUTRAL, c.classify(null));
        assertEquals(Tier.NEUTRAL, c.classify(""));
        assertEquals(Tier.NEUTRAL, c.classify("   "));
    }

    @Test
    void neutral_mixedCase_caseInsensitive() {
        // Mixed case still matches
        assertEquals(Tier.SMART, c.classify("nippon india mutual fund trustees ltd"));
        assertEquals(Tier.SHELL, c.classify("prestige ventures ltd"));
    }

    @Test
    void shadowWeights_areCorrect() {
        assertEquals(1.3, c.shadowWeightFor(Tier.SMART), 1e-9);
        assertEquals(1.0, c.shadowWeightFor(Tier.NEUTRAL), 1e-9);
        assertEquals(0.8, c.shadowWeightFor(Tier.SHELL), 1e-9);
    }
}
