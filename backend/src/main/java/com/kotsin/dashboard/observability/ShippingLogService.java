package com.kotsin.dashboard.observability;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Phase D 2026-05-05: Unified shipping log writer (dashboard service).
 * See spec /home/ubuntu/docs/plans/2026-05-05-phase-A-B-C-D-spec.md Section 5.
 */
@Service
@Slf4j
public class ShippingLogService {

    private static final String COLLECTION = "shipping_log";
    private static final String SERVICE_NAME = "dashboard";

    @Autowired
    private MongoTemplate mongoTemplate;

    @Value("${shipping.log.enabled:true}")
    private boolean enabled;

    @Value("${shipping.log.flush.interval.ms:1000}")
    private long flushIntervalMs;

    @Value("${shipping.log.batch.size:500}")
    private int batchSize;

    @Value("${shipping.log.queue.capacity:10000}")
    private int queueCapacity;

    private BlockingQueue<Map<String, Object>> queue;
    private ScheduledExecutorService flusher;
    private long droppedCount = 0;

    @PostConstruct
    public void init() {
        if (!enabled) {
            log.info("[SHIPPING-LOG] disabled — calls become no-op");
            return;
        }
        queue = new LinkedBlockingQueue<>(queueCapacity);
        flusher = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "shipping-log-flusher");
            t.setDaemon(true);
            return t;
        });
        flusher.scheduleAtFixedRate(this::flush, flushIntervalMs, flushIntervalMs, TimeUnit.MILLISECONDS);
        log.info("[SHIPPING-LOG] enabled service={} flushIntervalMs={}", SERVICE_NAME, flushIntervalMs);
    }

    @PreDestroy
    public void shutdown() {
        if (flusher != null) {
            try { flush(); flusher.shutdown(); flusher.awaitTermination(5, TimeUnit.SECONDS); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
    }

    public void log(String level, String category, String scripCode, String strategy, String event) {
        log(level, category, scripCode, strategy, event, null, null);
    }

    public void log(String level, String category, String scripCode, String strategy,
                    String event, Map<String, Object> details) {
        log(level, category, scripCode, strategy, event, details, null);
    }

    public void log(String level, String category, String scripCode, String strategy,
                    String event, Map<String, Object> details, String correlationId) {
        if (!enabled || queue == null) return;
        Map<String, Object> doc = new HashMap<>();
        doc.put("ts", new Date());
        doc.put("service", SERVICE_NAME);
        doc.put("level", level);
        doc.put("category", category);
        if (scripCode != null) doc.put("scripCode", scripCode);
        if (strategy != null) doc.put("strategy", strategy);
        doc.put("event", event);
        if (details != null && !details.isEmpty()) doc.put("details", details);
        if (correlationId != null) doc.put("correlationId", correlationId);
        if (!queue.offer(doc)) {
            droppedCount++;
            if (droppedCount % 100 == 1) log.warn("[SHIPPING-LOG] queue full — {} dropped", droppedCount);
        }
    }

    private void flush() {
        if (queue == null || queue.isEmpty()) return;
        List<Map<String, Object>> batch = new ArrayList<>(Math.min(queue.size(), batchSize));
        queue.drainTo(batch, batchSize);
        if (batch.isEmpty()) return;
        try {
            List<Document> docs = new ArrayList<>(batch.size());
            for (Map<String, Object> m : batch) docs.add(new Document(m));
            mongoTemplate.getCollection(COLLECTION).insertMany(docs);
        } catch (Exception e) {
            log.warn("[SHIPPING-LOG] flush of {} events failed: {}", batch.size(), e.getMessage());
        }
    }

    public long getDroppedCount() { return droppedCount; }
    public int getQueueSize() { return queue == null ? 0 : queue.size(); }
    public boolean isEnabled() { return enabled; }
}
