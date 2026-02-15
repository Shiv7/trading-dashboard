package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.IPUSignalDTO;
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
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka consumer for IPU (Institutional Participation & Urgency) signals.
 * Consumes from ip-signals-5m, ipu-signals-15m, ipu-signals-30m topics.
 * Broadcasts detailed IPU breakdowns to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class IPUSignalConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache latest IPU signal per scripCode for REST API
    private final Map<String, IPUSignalDTO> latestIPUSignals = new ConcurrentHashMap<>();

    @KafkaListener(
        topics = {"ipu-signals-5m", "ipu-signals-15m", "ipu-signals-30m"},
        groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}",
        autoStartup = "false"
    )
    public void onIPUSignal(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            
            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in IPU signal, skipping");
                return;
            }

            IPUSignalDTO dto = parseIPUSignal(root);
            log.info("IPU Signal: {} (IPU={}, direction={}, xFactor={})",
                scripCode, String.format("%.2f", dto.getIpuFinalScore()), dto.getIpuDirection(), dto.getHasXFactor());
            
            // Cache latest
            latestIPUSignals.put(scripCode, dto);
            
            // Broadcast to WebSocket
            sessionManager.broadcastIPUSignal(scripCode, dto);
            
            // Send alert for high-conviction signals
            if (dto.getHasXFactor() != null && dto.getHasXFactor()) {
                String emoji = dto.getDibTriggered() ? "🔥" : "❄️";
                String xFactorType = dto.getDibTriggered() ? "DIB" : "VIB";
                sessionManager.broadcastNotification("IPU_XFACTOR",
                    String.format("%s %s TRIGGERED for %s - Institutional flow detected!", 
                        emoji, xFactorType, dto.getCompanyName()));
            }

        } catch (Exception e) {
            log.error("Error processing IPU signal: {}", e.getMessage(), e);
        }
    }

    private IPUSignalDTO parseIPUSignal(JsonNode root) {
        String scripCode = root.path("scripCode").asText();
        String symbol = root.path("symbol").asText(scripCode);
        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        String timeframe = root.path("timeframe").asText("5m");

        // Overall IPU score
        double ipuFinalScore = root.path("ipuFinalScore").asDouble(0);
        String ipuDirection = root.path("ipuDirection").asText("NEUTRAL");

        // Core components
        double institutionalProxy = root.path("institutionalProxy").asDouble(
            root.path("instProxy").asDouble(0));
        double momentum = root.path("momentum").asDouble(0);
        double exhaustion = root.path("exhaustion").asDouble(0);
        double urgency = root.path("urgency").asDouble(0);

        // Volume metrics
        long aggressiveBuy = root.path("aggressiveBuyVolume").asLong(0);
        long aggressiveSell = root.path("aggressiveSellVolume").asLong(0);
        long totalVolume = root.path("totalVolume").asLong(aggressiveBuy + aggressiveSell);
        double volumeExpansion = root.path("volumeExpansionPct").asDouble(0);
        double aggressiveRatio = totalVolume > 0 ? 
            ((double)(aggressiveBuy + aggressiveSell) / totalVolume) * 100 : 0;

        // Directional conviction
        double directionalConviction = root.path("directionalConviction").asDouble(0);
        double volumeDeltaPct = root.path("volumeDeltaPct").asDouble(0);

        // X-Factor triggers
        boolean dibTriggered = root.path("dibTriggered").asBoolean(
            root.path("hasDIB").asBoolean(false));
        boolean vibTriggered = root.path("vibTriggered").asBoolean(
            root.path("hasVIB").asBoolean(false));
        boolean hasXFactor = dibTriggered || vibTriggered;

        // Adjustments
        String gapStatus = root.path("gapStatus").asText(
            root.path("gapAdjustment").path("status").asText("NONE"));
        double gapMultiplier = root.path("gapConvictionMultiplier").asDouble(
            root.path("gapAdjustment").path("multiplier").asDouble(1.0));
        String liquidityTier = root.path("liquidityTier").asText("UNKNOWN");
        double liquidityPenalty = root.path("liquidityPenalty").asDouble(1.0);

        // OFI
        double ofiPressure = root.path("ofiPressure").asDouble(0);
        String ofiSignal = root.path("ofiSignal").asText("NEUTRAL");

        // Price efficiency
        double priceEfficiency = root.path("priceEfficiency").asDouble(0);
        boolean runBarTriggered = root.path("runBarTriggered").asBoolean(false);

        // Context
        String momentumState = root.path("momentumState").asText("UNKNOWN");
        boolean usedPassiveVolume = root.path("usedPassiveVolume").asBoolean(false);

        // Raw metrics for debugging
        Map<String, Object> rawMetrics = new HashMap<>();
        rawMetrics.put("ofQuality", root.path("ofQuality").asDouble(0));
        rawMetrics.put("totalAggressive", aggressiveBuy + aggressiveSell);
        rawMetrics.put("timeframe", timeframe);

        return IPUSignalDTO.builder()
                .scripCode(scripCode)
                .companyName(scripLookup.resolve(scripCode, symbol))
                .timeframe(timeframe)
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .ipuFinalScore(ipuFinalScore)
                .ipuDirection(ipuDirection)
                .institutionalProxy(institutionalProxy)
                .momentum(momentum)
                .exhaustion(exhaustion)
                .urgency(urgency)
                .aggressiveBuyVolume(aggressiveBuy)
                .aggressiveSellVolume(aggressiveSell)
                .totalVolume(totalVolume)
                .volumeExpansionPct(volumeExpansion)
                .aggressiveVolumeRatio(aggressiveRatio)
                .directionalConviction(directionalConviction)
                .volumeDeltaPct(volumeDeltaPct)
                .dibTriggered(dibTriggered)
                .vibTriggered(vibTriggered)
                .hasXFactor(hasXFactor)
                .gapStatus(gapStatus)
                .gapConvictionMultiplier(gapMultiplier)
                .liquidityTier(liquidityTier)
                .liquidityPenalty(liquidityPenalty)
                .ofiPressure(ofiPressure)
                .ofiSignal(ofiSignal)
                .priceEfficiency(priceEfficiency)
                .runBarTriggered(runBarTriggered)
                .momentumState(momentumState)
                .usedPassiveVolume(usedPassiveVolume)
                .rawMetrics(rawMetrics)
                .build();
    }

    /**
     * Get latest IPU signal for a scripCode (for REST API)
     */
    public IPUSignalDTO getLatestIPUSignal(String scripCode) {
        return latestIPUSignals.get(scripCode);
    }

    /**
     * Get all latest IPU signals (for REST API)
     */
    public Map<String, IPUSignalDTO> getAllLatestIPUSignals() {
        return new HashMap<>(latestIPUSignals);
    }
}
