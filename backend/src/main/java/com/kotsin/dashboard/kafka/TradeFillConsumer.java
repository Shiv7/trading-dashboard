package com.kotsin.dashboard.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.model.entity.TradeFill;
import com.kotsin.dashboard.repository.TradeFillRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;

/**
 * TradeFillConsumer — persists per-tranche fill events from {@code trade-fills} Kafka topic.
 *
 * Resilience contract:
 *   - If Mongo is slow or transiently down, the @KafkaListener throws → offset NOT committed
 *     → message is redelivered on next poll. This is the "never lose a fill" guarantee.
 *   - If the producer retries and we get a duplicate, the unique index (orderId, totalFilledQty)
 *     throws DuplicateKeyException which we catch and ignore. Safe to redeliver any number of times.
 *   - If the message is garbage (parse error), we LOG and SWALLOW — we cannot block the consumer
 *     group on a poison message. Garbage produces no data loss anyway since nothing was real.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class TradeFillConsumer {

    private final TradeFillRepository tradeFillRepository;

    private final ObjectMapper mapper = new ObjectMapper()
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @KafkaListener(
        topics = "trade-fills",
        groupId = "${spring.kafka.consumer.group-id:trading-dashboard-v2}-fills"
    )
    public void onFillEvent(String payload) {
        if (payload == null || payload.isEmpty()) return;

        TradeFill fill;
        try {
            JsonNode root = mapper.readTree(payload);
            fill = TradeFill.builder()
                .tradeId(getText(root, "tradeId"))
                .signalId(getText(root, "signalId"))
                .orderId(getText(root, "orderId"))
                .scripCode(getText(root, "scripCode"))
                .symbol(getText(root, "symbol"))
                .exchange(getText(root, "exchange"))
                .instrumentType(getText(root, "instrumentType"))
                .strategy(getText(root, "strategy"))
                .side(getText(root, "side"))
                .orderType(getText(root, "orderType"))
                .exitLevel(getText(root, "exitLevel"))
                .entryPrice(root.path("entryPrice").asDouble(0))
                .fillPrice(root.path("fillPrice").asDouble(0))
                .fillQty(root.path("fillQty").asInt(0))
                .totalFilledQty(root.path("totalFilledQty").asInt(0))
                .remainingQty(root.path("remainingQty").asInt(0))
                .weightedAvgFillPrice(root.path("weightedAvgFillPrice").asDouble(0))
                .isFinal(root.path("isFinal").asBoolean(false))
                .lotSize(root.path("lotSize").asInt(0))
                .targetPrice(root.path("targetPrice").asDouble(0))
                .thisFillPnl(root.path("thisFillPnl").asDouble(0))
                .cumulativePnl(root.path("cumulativePnl").asDouble(0))
                .chargesAccrued(root.path("chargesAccrued").asDouble(0))
                .fillTime(parseInstant(root, "fillTime"))
                .fillTimeMs(root.path("fillTimeMs").asLong(System.currentTimeMillis()))
                .receivedAt(Instant.now())
                .build();
        } catch (Exception e) {
            // Garbage payload — log and SWALLOW (acking this message is safe; no real data was lost).
            log.error("[FILL_SUB] parse error, skipping payload: {} — {}",
                payload.length() > 200 ? payload.substring(0, 200) + "…" : payload, e.getMessage());
            return;
        }

        if (fill.getOrderId() == null || fill.getOrderId().isEmpty()) {
            log.warn("[FILL_SUB] missing orderId, skipping: tradeId={}", fill.getTradeId());
            return;
        }

        try {
            tradeFillRepository.save(fill);
            log.info("[FILL_SUB] saved tradeId={} orderId={} level={} qty={} cumPnl={}",
                fill.getTradeId(), fill.getOrderId(), fill.getExitLevel(),
                fill.getFillQty(),
                String.format("%.2f", fill.getCumulativePnl()));
        } catch (DuplicateKeyException dup) {
            // Idempotent: producer retry already persisted. Safe to ack.
            log.debug("[FILL_SUB] duplicate fill ignored: orderId={} totalFilled={}",
                fill.getOrderId(), fill.getTotalFilledQty());
        }
        // Any other Mongo exception → propagates → offset not committed → redelivered.
    }

    private String getText(JsonNode root, String field) {
        JsonNode n = root.path(field);
        if (n.isNull() || n.isMissingNode()) return null;
        String t = n.asText(null);
        return (t == null || "null".equals(t)) ? null : t;
    }

    private Instant parseInstant(JsonNode root, String field) {
        JsonNode n = root.path(field);
        if (n.isNull() || n.isMissingNode()) return Instant.now();
        try {
            if (n.isTextual()) return Instant.parse(n.asText());
            if (n.isNumber()) return Instant.ofEpochMilli(n.asLong());
        } catch (Exception ignored) {}
        return Instant.now();
    }
}
