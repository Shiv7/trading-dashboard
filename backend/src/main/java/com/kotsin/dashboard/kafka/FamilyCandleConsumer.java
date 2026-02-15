package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.FamilyScoreDTO;
import com.kotsin.dashboard.service.ScripLookupService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;

/**
 * Kafka consumer for family candle topics.
 * Parses family candle data and broadcasts to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class FamilyCandleConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @KafkaListener(topics = {"family-candle-1m", "family-candle-5m", "family-candle-15m", "family-candle-30m"},
                   groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onFamilyCandle(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            JsonNode equity = root.path("equity");

            if (equity.isMissingNode() || equity.isNull()) {
                log.trace("No equity node in message, skipping");
                return;
            }

            String scripCode = equity.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in equity, skipping");
                return;
            }

            FamilyScoreDTO dto = parseFamilyScore(root, equity);
            log.info("Received family candle for {} ({}), broadcasting...", scripCode, dto.getTimeframe());

            // Broadcast to WebSocket
            sessionManager.broadcastScoreUpdate(scripCode, dto);

        } catch (Exception e) {
            log.error("Error processing family candle: {}", e.getMessage(), e);
        }
    }

    private FamilyScoreDTO parseFamilyScore(JsonNode root, JsonNode equity) {
        String scripCode = equity.path("scripCode").asText();
        String timeframe = equity.path("timeframe").asText("1m");
        long timestamp = equity.path("windowEndMillis").asLong(System.currentTimeMillis());

        // FIX BUG #21: Better null handling for OHLC - use NaN to indicate missing data
        // instead of 0 which could be confused with actual price
        double openPrice = equity.path("open").isNull() || equity.path("open").isMissingNode()
                ? Double.NaN : equity.path("open").asDouble();
        double highPrice = equity.path("high").isNull() || equity.path("high").isMissingNode()
                ? Double.NaN : equity.path("high").asDouble();
        double lowPrice = equity.path("low").isNull() || equity.path("low").isMissingNode()
                ? Double.NaN : equity.path("low").asDouble();
        double closePrice = equity.path("close").isNull() || equity.path("close").isMissingNode()
                ? Double.NaN : equity.path("close").asDouble();

        // Validate OHLC data - if any price is NaN or 0, log warning
        if (Double.isNaN(closePrice) || closePrice <= 0) {
            log.warn("[FAMILY_CANDLE] {} - Invalid/missing close price, candle data may be stale", scripCode);
        }

        FamilyScoreDTO.FamilyScoreDTOBuilder builder = FamilyScoreDTO.builder()
                .scripCode(scripCode)
                .companyName(scripLookup.resolve(scripCode, equity.path("companyName").asText("")))
                .timeframe(timeframe)
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .open(Double.isNaN(openPrice) ? 0 : openPrice)
                .high(Double.isNaN(highPrice) ? 0 : highPrice)
                .low(Double.isNaN(lowPrice) ? 0 : lowPrice)
                .close(Double.isNaN(closePrice) ? 0 : closePrice)
                .volume(equity.path("volume").asLong(0))
                .vwap(equity.path("vwap").asDouble(0));

        // VCP Module scores (from family level or equity)
        builder.vcpCombinedScore(root.path("vcpCombinedScore").asDouble(0))
               .vcpRunway(root.path("runwayScore").asDouble(0))
               .vcpStructuralBias(root.path("structuralBias").asDouble(0))
               .vcpSupportScore(root.path("supportScore").asDouble(0))
               .vcpResistanceScore(root.path("resistanceScore").asDouble(0));

        // IPU Module scores
        builder.ipuFinalScore(root.path("ipuFinalScore").asDouble(0))
               .ipuInstProxy(root.path("instProxy").asDouble(0))
               .ipuMomentum(root.path("momentumContext").asDouble(0))
               .ipuExhaustion(root.path("exhaustionScore").asDouble(0))
               .ipuUrgency(root.path("urgencyScore").asDouble(0))
               .ipuDirectionalConviction(root.path("directionalConviction").asDouble(0))
               .ipuXfactor(root.path("xfactorFlag").asBoolean(false))
               .ipuMomentumState(root.path("momentumState").asText("UNKNOWN"));

        // Regime
        builder.indexRegimeLabel(root.path("indexRegimeLabel").asText("UNKNOWN"))
               .indexRegimeStrength(root.path("indexRegimeStrength").asDouble(0))
               .securityRegimeLabel(root.path("securityRegimeLabel").asText("UNKNOWN"))
               .securityAligned(root.path("securityAligned").asBoolean(false));

        // OI/F&O
        builder.oiSignal(root.path("oiSignal").asText("NEUTRAL"))
               .pcr(root.path("pcr").isNull() ? null : root.path("pcr").asDouble())
               .spotFuturePremium(root.path("spotFuturePremium").isNull() ? null : root.path("spotFuturePremium").asDouble())
               .futuresBuildup(root.path("futuresBuildup").asText("NONE"));

        // FIX: Add raw OI data for transparency
        builder.totalCallOI(root.path("totalCallOI").isNull() ? null : root.path("totalCallOI").asLong())
               .totalPutOI(root.path("totalPutOI").isNull() ? null : root.path("totalPutOI").asLong())
               .totalCallOIChange(root.path("totalCallOIChange").isNull() ? null : root.path("totalCallOIChange").asLong())
               .totalPutOIChange(root.path("totalPutOIChange").isNull() ? null : root.path("totalPutOIChange").asLong())
               .callOiBuildingUp(root.path("callOiBuildingUp").asBoolean(false))
               .putOiUnwinding(root.path("putOiUnwinding").asBoolean(false));

        // Gate status (if available)
        builder.hardGatePassed(root.path("hardGatePassed").asBoolean(false))
               .hardGateReason(root.path("hardGateReason").asText(""))
               .mtfGatePassed(root.path("mtfGatePassed").asBoolean(false))
               .mtfGateReason(root.path("mtfGateReason").asText(""))
               .qualityGatePassed(root.path("qualityGatePassed").asBoolean(false))
               .qualityGateReason(root.path("qualityGateReason").asText(""))
               .statsGatePassed(root.path("statsGatePassed").asBoolean(false))
               .statsGateReason(root.path("statsGateReason").asText(""));

        // Overall
        double overallScore = calculateOverallScore(root);
        builder.overallScore(overallScore)
               .direction(root.path("direction").asText("NEUTRAL"))
               .signalEmitted(root.path("signalEmitted").asBoolean(false));

        // Module details map for expandable view
        // FIX BUG #22: Handle null volume data properly
        Map<String, Object> details = new HashMap<>();
        details.put("vpin", equity.path("vpin").asDouble(0));
        details.put("ofi", equity.path("ofi").asDouble(0));

        // Calculate volume delta only if both values are present
        long buyVolume = equity.path("buyVolume").asLong(0);
        long sellVolume = equity.path("sellVolume").asLong(0);
        // Only include volumeDelta if at least one volume is non-zero (data is present)
        if (buyVolume > 0 || sellVolume > 0) {
            details.put("volumeDelta", buyVolume - sellVolume);
            details.put("volumeDeltaValid", true);
        } else {
            details.put("volumeDelta", 0L);
            details.put("volumeDeltaValid", false);  // Flag to indicate data is unavailable
        }
        builder.moduleDetails(details);

        return builder.build();
    }

    private double calculateOverallScore(JsonNode root) {
        double vcpScore = root.path("vcpCombinedScore").asDouble(0);
        double ipuScore = root.path("ipuFinalScore").asDouble(0);
        double regimeStrength = root.path("indexRegimeStrength").asDouble(0.5);

        // Simple weighted average for overall score
        return (vcpScore * 0.4 + ipuScore * 0.4 + regimeStrength * 0.2) * 10;
    }
}
