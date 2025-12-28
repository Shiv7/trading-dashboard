package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.FamilyScoreDTO;
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

        FamilyScoreDTO.FamilyScoreDTOBuilder builder = FamilyScoreDTO.builder()
                .scripCode(scripCode)
                .companyName(equity.path("companyName").asText(scripCode))
                .timeframe(timeframe)
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .open(equity.path("open").asDouble())
                .high(equity.path("high").asDouble())
                .low(equity.path("low").asDouble())
                .close(equity.path("close").asDouble())
                .volume(equity.path("volume").asLong())
                .vwap(equity.path("vwap").asDouble());

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
        Map<String, Object> details = new HashMap<>();
        details.put("vpin", equity.path("vpin").asDouble(0));
        details.put("ofi", equity.path("ofi").asDouble(0));
        details.put("volumeDelta", equity.path("buyVolume").asLong() - equity.path("sellVolume").asLong());
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

