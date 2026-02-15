package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.VCPSignalDTO;
import com.kotsin.dashboard.model.dto.VCPSignalDTO.VolumeCluster;
import com.kotsin.dashboard.service.ScripLookupService;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka consumer for VCP (Volume Cluster Profile) combined signals.
 * Consumes from vcp-combined topic.
 * Broadcasts volume cluster data and penetration scores to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class VCPSignalConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ScripLookupService scripLookup;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // Cache latest VCP signal per scripCode for REST API
    private final Map<String, VCPSignalDTO> latestVCPSignals = new ConcurrentHashMap<>();

    @KafkaListener(
        topics = "vcp-combined",
        groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}"
    )
    public void onVCPSignal(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            
            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.trace("No scripCode in VCP signal, skipping");
                return;
            }

            VCPSignalDTO dto = parseVCPSignal(root);
            log.info("VCP Signal: {} (score={}, clusters={}, runway={})",
                scripCode, String.format("%.1f", dto.getVcpCombinedScore()), dto.getTotalClusters(), String.format("%.2f", dto.getRunwayScore()));
            
            // Cache latest
            latestVCPSignals.put(scripCode, dto);
            
            // Broadcast to WebSocket
            sessionManager.broadcastVCPSignal(scripCode, dto);
            
            // Send alert for cluster penetrations
            if (dto.getPenetrationScore() != null && dto.getPenetrationScore() > 0.8) {
                sessionManager.broadcastNotification("VCP_PENETRATION",
                    String.format("🎯 Strong cluster penetration for %s at ₹%.2f (score: %.0f%%)", 
                        dto.getCompanyName(), dto.getCurrentPrice(), dto.getPenetrationScore() * 100));
            }

        } catch (Exception e) {
            log.error("Error processing VCP signal: {}", e.getMessage(), e);
        }
    }

    private VCPSignalDTO parseVCPSignal(JsonNode root) {
        String scripCode = root.path("scripCode").asText();
        String symbol = root.path("symbol").asText(scripCode);
        long timestamp = root.path("timestamp").asLong(System.currentTimeMillis());
        String timeframe = root.path("timeframe").asText("5m");

        // Overall VCP score
        double vcpCombinedScore = root.path("vcpCombinedScore").asDouble(
            root.path("combinedScore").asDouble(0));
        String vcpSignal = root.path("vcpSignal").asText(
            determineVCPSignal(vcpCombinedScore));

        // Scores
        double runwayScore = root.path("runwayScore").asDouble(0);
        double structuralBias = root.path("structuralBias").asDouble(0);
        double penetrationScore = root.path("penetrationScore").asDouble(0);
        double alignmentScore = root.path("alignmentScore").asDouble(0);

        // Price context
        double currentPrice = root.path("currentPrice").asDouble(
            root.path("spotPrice").asDouble(0));
        double kyleLambda = root.path("kyleLambda").asDouble(0);
        String pricePosition = root.path("pricePosition").asText(
            determinePricePosition(currentPrice, root));

        // Parse clusters
        List<VolumeCluster> clusters = parseClusters(root, currentPrice);
        VolumeCluster pocCluster = findClusterByType(clusters, "POC");
        VolumeCluster vahCluster = findClusterByType(clusters, "VA_HIGH");
        VolumeCluster valCluster = findClusterByType(clusters, "VA_LOW");

        // Cluster metrics
        int totalClusters = clusters.size();
        double avgClusterStrength = clusters.stream()
            .mapToDouble(c -> c.getPenetrationScore() != null ? c.getPenetrationScore() : 0)
            .average()
            .orElse(0);
        boolean hasStrongSupport = clusters.stream()
            .anyMatch(c -> "DEMAND".equals(c.getType()) && 
                           c.getDistanceFromPrice() != null && 
                           Math.abs(c.getDistanceFromPrice()) < 2);
        boolean hasStrongResistance = clusters.stream()
            .anyMatch(c -> "SUPPLY".equals(c.getType()) && 
                           c.getDistanceFromPrice() != null && 
                           Math.abs(c.getDistanceFromPrice()) < 2);

        // Volume profile
        long totalVolume = root.path("totalVolume").asLong(0);
        double valueAreaHigh = root.path("valueAreaHigh").asDouble(
            root.path("vahPrice").asDouble(0));
        double valueAreaLow = root.path("valueAreaLow").asDouble(
            root.path("valPrice").asDouble(0));
        double pointOfControl = root.path("pointOfControl").asDouble(
            root.path("pocPrice").asDouble(0));

        return VCPSignalDTO.builder()
                .scripCode(scripCode)
                .companyName(scripLookup.resolve(scripCode, symbol))
                .timeframe(timeframe)
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                .vcpCombinedScore(vcpCombinedScore)
                .vcpSignal(vcpSignal)
                .clusters(clusters)
                .pocCluster(pocCluster)
                .vahCluster(vahCluster)
                .valCluster(valCluster)
                .runwayScore(runwayScore)
                .structuralBias(structuralBias)
                .penetrationScore(penetrationScore)
                .alignmentScore(alignmentScore)
                .currentPrice(currentPrice)
                .kyleLambda(kyleLambda)
                .pricePosition(pricePosition)
                .totalClusters(totalClusters)
                .avgClusterStrength(avgClusterStrength)
                .hasStrongSupport(hasStrongSupport)
                .hasStrongResistance(hasStrongResistance)
                .totalVolume(totalVolume)
                .valueAreaHigh(valueAreaHigh)
                .valueAreaLow(valueAreaLow)
                .pointOfControl(pointOfControl)
                .build();
    }

    private List<VolumeCluster> parseClusters(JsonNode root, double currentPrice) {
        List<VolumeCluster> clusters = new ArrayList<>();
        JsonNode clustersNode = root.path("clusters");
        
        if (clustersNode.isArray()) {
            for (JsonNode c : clustersNode) {
                double price = c.path("price").asDouble(0);
                clusters.add(VolumeCluster.builder()
                        .price(price)
                        .type(c.path("type").asText("UNKNOWN"))
                        .volume(c.path("volume").asLong(0))
                        .penetrationScore(c.path("penetrationScore").asDouble(0))
                        .distanceFromPrice(currentPrice > 0 ? ((price - currentPrice) / currentPrice) * 100 : null)
                        .isActive(c.path("isActive").asBoolean(true))
                        .significance(c.path("significance").asText(
                            determineSignificance(c.path("volume").asLong(0))))
                        .build());
            }
        }
        
        return clusters;
    }

    private VolumeCluster findClusterByType(List<VolumeCluster> clusters, String type) {
        return clusters.stream()
                .filter(c -> type.equals(c.getType()))
                .findFirst()
                .orElse(null);
    }

    private String determineVCPSignal(double score) {
        if (score > 60) return "BULLISH";
        if (score < 40) return "BEARISH";
        return "NEUTRAL";
    }

    private String determinePricePosition(double currentPrice, JsonNode root) {
        double pocPrice = root.path("pocPrice").asDouble(0);
        if (pocPrice == 0) return "UNKNOWN";
        
        double diff = ((currentPrice - pocPrice) / pocPrice) * 100;
        if (Math.abs(diff) < 0.5) return "AT_POC";
        return diff > 0 ? "ABOVE_POC" : "BELOW_POC";
    }

    private String determineSignificance(long volume) {
        if (volume > 1000000) return "STRONG";
        if (volume > 100000) return "MEDIUM";
        return "WEAK";
    }

    /**
     * Get latest VCP signal for a scripCode (for REST API)
     */
    public VCPSignalDTO getLatestVCPSignal(String scripCode) {
        return latestVCPSignals.get(scripCode);
    }

    /**
     * Get all latest VCP signals (for REST API)
     */
    public Map<String, VCPSignalDTO> getAllLatestVCPSignals() {
        return new HashMap<>(latestVCPSignals);
    }
}
