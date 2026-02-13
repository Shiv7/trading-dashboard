package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.dto.SignalDTO;
import com.kotsin.dashboard.websocket.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kafka consumer for trading signals from SMTIS v2.0 enrichment pipeline.
 * Consumes from trading-signals-v2 (unified signal topic).
 * Parses signals, stores in memory, and broadcasts to WebSocket clients.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class SignalConsumer {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // In-memory signal storage for REST API
    private final Map<String, SignalDTO> signalCache = new ConcurrentHashMap<>();
    private final Map<String, Map<String, SignalDTO>> signalsByStock = new ConcurrentHashMap<>();

    @KafkaListener(topics = {"trading-signals-v2"}, groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}")
    public void onSignal(String payload) {
        try {
            log.info("📥 Received signal from Kafka: {}", payload.substring(0, Math.min(150, payload.length())));
            JsonNode root = objectMapper.readTree(payload);
            
            String scripCode = root.path("scripCode").asText();
            if (scripCode == null || scripCode.isEmpty()) {
                log.warn("Signal has no scripCode, skipping");
                return;
            }

            // Skip NO_SIGNAL signals
            String signalType = root.path("signal").asText(root.path("signalType").asText(""));
            if ("NO_SIGNAL".equals(signalType)) {
                log.debug("Skipping NO_SIGNAL for {}", scripCode);
                return;
            }

            SignalDTO dto = parseSignal(root);
            
            // Store in cache for REST API
            String signalId = dto.getSignalId();
            if (signalId == null || signalId.isEmpty()) {
                signalId = UUID.randomUUID().toString();
                dto.setSignalId(signalId);
            }
            signalCache.put(signalId, dto);
            signalsByStock.computeIfAbsent(scripCode, k -> new ConcurrentHashMap<>()).put(signalId, dto);
            
            // Broadcast to WebSocket
            sessionManager.broadcastSignal(dto);
            
            // Also send a notification
            String direction = dto.getDirection();
            String emoji = "BULLISH".equals(direction) ? "📈" : "📉";
            sessionManager.broadcastNotification("SIGNAL", 
                String.format("%s New %s signal for %s @ %.2f", emoji, direction, dto.getCompanyName(), dto.getEntryPrice()));

            log.info("🎯 Signal stored & broadcasted: {} {} {} @ {}", 
                dto.getScripCode(), dto.getSignalType(), dto.getDirection(), dto.getEntryPrice());

        } catch (Exception e) {
            log.error("Error processing signal: {}", e.getMessage(), e);
        }
    }

    /**
     * Parse signal from JSON - handles SMTIS v2.0 enrichment signals and legacy formats
     */
    private SignalDTO parseSignal(JsonNode root) {
        long timestamp = root.path("timestamp").asLong(
                root.path("generatedAt").asLong(System.currentTimeMillis()));

        // Parse entry details - SMTIS v2.0 uses entryPrice, stopLoss, target1/2/3 directly
        double entryPrice = root.path("entryPrice").asDouble(0);
        double stopLoss = root.path("stopLoss").asDouble(0);
        double target1 = root.path("target1").asDouble(0);
        double target2 = root.path("target2").asDouble(0);
        double target3 = root.path("target3").asDouble(0);
        double riskReward = root.path("riskRewardRatio").asDouble(0);

        // SMTIS v2.0 uses "category" for signal type, legacy uses "signal" or "signalType"
        String signalType = root.path("category").asText();
        if (signalType == null || signalType.isEmpty() || "null".equals(signalType)) {
            signalType = root.path("signal").asText(root.path("signalType").asText("UNKNOWN"));
        }

        // Detect signal source - SMTIS v2.0 has "source" field directly
        String signalSource = root.path("source").asText();
        if (signalSource == null || signalSource.isEmpty() || "null".equals(signalSource)) {
            signalSource = detectSignalSource(root, signalType);
        }
        String signalSourceLabel = getSignalSourceLabel(signalSource);
        boolean isMasterArch = "MASTER_ARCH".equals(signalSource);

        // Parse narrative - SMTIS v2.0 has rich rationale object
        String narrative = "";
        if (root.has("rationale") && root.path("rationale").isObject()) {
            JsonNode rationaleNode = root.path("rationale");
            narrative = rationaleNode.path("summary").asText(
                    rationaleNode.path("headline").asText(""));
        } else {
            narrative = root.path("rationale").asText("");
        }

        return SignalDTO.builder()
                .signalId(root.path("signalId").asText(UUID.randomUUID().toString()))
                .scripCode(root.path("scripCode").asText())
                .companyName(root.path("companyName").asText(root.path("scripCode").asText()))
                .timestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.of("Asia/Kolkata")))
                // Signal source
                .signalSource(signalSource)
                .signalSourceLabel(signalSourceLabel)
                .isMasterArch(isMasterArch)
                // SMTIS v2.0 fields
                .category(root.path("category").asText(null))
                .horizon(root.path("horizon").asText(null))
                .qualityScore(root.has("qualityScore") ? root.path("qualityScore").asInt() : null)
                .patternId(root.path("patternId").asText(null))
                .setupId(root.path("setupId").asText(null))
                .gexRegime(root.path("gexRegime").asText(null))
                .session(root.path("session").asText(null))
                .daysToExpiry(root.has("daysToExpiry") ? root.path("daysToExpiry").asInt() : null)
                .atConfluenceZone(root.has("atConfluenceZone") ? root.path("atConfluenceZone").asBoolean() : null)
                // Signal details
                .signalType(signalType)
                .direction(determineDirection(root))
                .confidence(root.path("confidence").asDouble(0))
                .rationale(narrative)
                .narrative(narrative)
                .entryPrice(entryPrice)
                .stopLoss(stopLoss)
                .target1(target1)
                .target2(target2)
                .target3(target3)
                .riskRewardRatio(riskReward)
                .vcpScore(root.path("vcpCombinedScore").asDouble(0))
                .ipuScore(root.path("ipuFinalScore").asDouble(0))
                .xfactorFlag(root.path("xfactorFlag").asBoolean(false))
                .regimeLabel(root.path("gexRegime").asText(root.path("indexRegimeLabel").asText("UNKNOWN")))
                // Master Arch specific (legacy)
                .finalOpportunityScore(root.has("finalScore") ? root.path("finalScore").path("current").asDouble() : null)
                .directionConfidence(root.has("directionConfidence") ? root.path("directionConfidence").asDouble() : null)
                .tradeDecision(root.path("decision").asText(null))
                .recommendedLots(root.has("recommendedLots") ? root.path("recommendedLots").asInt() : null)
                .hedgeRecommended(root.has("hedgeRecommended") ? root.path("hedgeRecommended").asBoolean() : null)
                // Gates
                .allGatesPassed(!root.path("warningSignal").asBoolean(false))
                .positionSizeMultiplier(root.path("positionSizeMultiplier").asDouble(1.0))
                .build();
    }
    
    /**
     * Detect signal source based on JSON content
     */
    private String detectSignalSource(JsonNode root, String signalType) {
        // Check for Master Architecture markers
        if (root.has("finalScore") || root.has("decision") || root.has("directionConfidence")) {
            return "MASTER_ARCH";
        }
        
        // Check for specific signal types
        if (signalType != null) {
            if (signalType.contains("VCP") || signalType.contains("VOLUME_CLUSTER")) {
                return "VCP";
            }
            if (signalType.contains("IPU") || signalType.contains("INSTITUTIONAL")) {
                return "IPU";
            }
            if (signalType.contains("FUDKII") || signalType.contains("BB_SUPERTREND")) {
                return "FUDKII";
            }
            if (signalType.contains("SUPERTREND")) {
                return "BB_SUPERTREND";
            }
        }
        
        // Check for curated signal markers
        if (root.has("entry") && root.path("entry").has("entryPrice")) {
            return "CURATED";
        }
        
        // Default to MTIS
        return "MTIS";
    }
    
    /**
     * Get human-readable label for signal source
     */
    private String getSignalSourceLabel(String source) {
        return switch (source) {
            // SMTIS v2.0 sources
            case "PATTERN" -> "🔷 Pattern Signal";
            case "SETUP" -> "📐 Setup Signal";
            case "FORECAST" -> "🔮 Forecast Signal";
            case "INTELLIGENCE" -> "🧠 Intelligence Signal";
            case "QUANT" -> "📊 Quant Signal";
            // Legacy sources
            case "MASTER_ARCH" -> "🎯 Master Architecture";
            case "MTIS" -> "📊 MTIS Score";
            case "VCP" -> "📈 Volume Cluster Pivot";
            case "IPU" -> "🏦 Institutional Flow";
            case "FUDKII" -> "⚡ FUDKII Trigger";
            case "BB_SUPERTREND" -> "📉 BB+SuperTrend";
            case "CURATED" -> "✨ Curated Signal";
            default -> "❓ " + source;
        };
    }


    /**
     * Determine direction from JSON - handles both formats
     */
    private String determineDirection(JsonNode root) {
        // TradingSignal has "direction" as enum (BULLISH/BEARISH)
        String direction = root.path("direction").asText();
        if (direction != null && !direction.isEmpty() && !"null".equals(direction)) {
            return direction.toUpperCase();
        }
        
        // Infer from signal type
        String signal = root.path("signal").asText();
        if (signal != null) {
            if (signal.contains("LONG") || signal.contains("BULLISH")) {
                return "BULLISH";
            }
            if (signal.contains("SHORT") || signal.contains("BEARISH")) {
                return "BEARISH";
            }
        }
        
        // Infer from entry vs stopLoss
        double entryPrice = root.path("entryPrice").asDouble(0);
        double stopLoss = root.path("stopLoss").asDouble(0);
        double target = root.path("target1").asDouble(0);
        
        if (entryPrice > 0 && stopLoss > 0) {
            return entryPrice > stopLoss ? "BULLISH" : "BEARISH";
        }
        if (entryPrice > 0 && target > 0) {
            return target > entryPrice ? "BULLISH" : "BEARISH";
        }
        
        return "NEUTRAL";
    }

    // ========== External Signal Integration ==========

    /**
     * Add a signal from an external source (e.g., FUDKII, FUKAA consumers).
     * Stores in cache and broadcasts to WebSocket clients.
     */
    public void addExternalSignal(SignalDTO dto) {
        String signalId = dto.getSignalId();
        if (signalId == null || signalId.isEmpty()) {
            signalId = UUID.randomUUID().toString();
            dto.setSignalId(signalId);
        }

        String scripCode = dto.getScripCode();
        signalCache.put(signalId, dto);
        if (scripCode != null) {
            signalsByStock.computeIfAbsent(scripCode, k -> new ConcurrentHashMap<>()).put(signalId, dto);
        }

        // Broadcast to WebSocket
        sessionManager.broadcastSignal(dto);

        String direction = dto.getDirection();
        String emoji = "BULLISH".equals(direction) ? "^" : "v";
        sessionManager.broadcastNotification("SIGNAL",
            String.format("%s %s %s signal for %s @ %.2f",
                emoji, direction, dto.getSignalSource(), dto.getCompanyName(), dto.getEntryPrice()));

        log.info("External signal added: {} {} {} source={} @ {}",
            dto.getScripCode(), dto.getSignalType(), dto.getDirection(), dto.getSignalSource(), dto.getEntryPrice());
    }

    // ========== REST API Support ==========

    public Map<String, SignalDTO> getAllSignals() {
        return signalCache;
    }

    public Map<String, SignalDTO> getSignalsForStock(String scripCode) {
        return signalsByStock.getOrDefault(scripCode, Map.of());
    }

    /**
     * Get recent signals (most recent first)
     */
    public java.util.List<SignalDTO> getRecentSignals(int limit) {
        return signalCache.values().stream()
                .sorted((a, b) -> b.getTimestamp().compareTo(a.getTimestamp()))
                .limit(limit)
                .collect(java.util.stream.Collectors.toList());
    }
}

