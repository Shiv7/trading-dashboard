package com.kotsin.dashboard.controller;

import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Date;
import java.util.List;

/**
 * Phase D 2026-05-05: REST API for querying the unified shipping_log.
 *
 * <p>Endpoints:
 * <ul>
 *   <li>{@code GET /api/shipping-log/scrip/{scripCode}?since=ISO} — full lifecycle for a scrip</li>
 *   <li>{@code GET /api/shipping-log/correlation/{correlationId}} — events sharing a correlationId</li>
 *   <li>{@code GET /api/shipping-log/strategy/{strategy}?since=ISO} — events for a strategy</li>
 *   <li>{@code GET /api/shipping-log/category/{category}?since=ISO} — events of a category</li>
 *   <li>{@code GET /api/shipping-log/recent?minutes=10} — last N minutes of events</li>
 * </ul>
 * </p>
 */
@RestController
@RequestMapping("/api/shipping-log")
@Slf4j
public class ShippingLogController {

    private static final String COLLECTION = "shipping_log";

    @Autowired
    private MongoTemplate mongoTemplate;

    @Value("${shipping.log.api.enabled:true}")
    private boolean apiEnabled;

    @Value("${shipping.log.api.max.results:1000}")
    private int maxResults;

    /** Full lifecycle for a scrip. */
    @GetMapping("/scrip/{scripCode}")
    public List<Document> byScrip(
            @PathVariable String scripCode,
            @RequestParam(required = false) String since) {
        if (!apiEnabled) return List.of();
        Query q = new Query(Criteria.where("scripCode").is(scripCode));
        if (since != null) {
            try { q.addCriteria(Criteria.where("ts").gte(Date.from(Instant.parse(since)))); }
            catch (Exception ignored) { /* invalid date — ignore filter */ }
        }
        q.with(Sort.by(Sort.Direction.ASC, "ts"));
        q.limit(maxResults);
        return mongoTemplate.find(q, Document.class, COLLECTION);
    }

    /** Events sharing a correlationId — full cross-service trace. */
    @GetMapping("/correlation/{correlationId}")
    public List<Document> byCorrelation(@PathVariable String correlationId) {
        if (!apiEnabled) return List.of();
        Query q = new Query(Criteria.where("correlationId").is(correlationId))
            .with(Sort.by(Sort.Direction.ASC, "ts"))
            .limit(maxResults);
        return mongoTemplate.find(q, Document.class, COLLECTION);
    }

    /** Events for a strategy. */
    @GetMapping("/strategy/{strategy}")
    public List<Document> byStrategy(
            @PathVariable String strategy,
            @RequestParam(required = false) String since) {
        if (!apiEnabled) return List.of();
        Query q = new Query(Criteria.where("strategy").is(strategy));
        if (since != null) {
            try { q.addCriteria(Criteria.where("ts").gte(Date.from(Instant.parse(since)))); }
            catch (Exception ignored) {}
        }
        q.with(Sort.by(Sort.Direction.DESC, "ts")).limit(maxResults);
        return mongoTemplate.find(q, Document.class, COLLECTION);
    }

    /** Events of a category. */
    @GetMapping("/category/{category}")
    public List<Document> byCategory(
            @PathVariable String category,
            @RequestParam(required = false) String since) {
        if (!apiEnabled) return List.of();
        Query q = new Query(Criteria.where("category").is(category));
        if (since != null) {
            try { q.addCriteria(Criteria.where("ts").gte(Date.from(Instant.parse(since)))); }
            catch (Exception ignored) {}
        }
        q.with(Sort.by(Sort.Direction.DESC, "ts")).limit(maxResults);
        return mongoTemplate.find(q, Document.class, COLLECTION);
    }

    /** Last N minutes of events. */
    @GetMapping("/recent")
    public List<Document> recent(@RequestParam(defaultValue = "10") int minutes) {
        if (!apiEnabled) return List.of();
        Date since = new Date(System.currentTimeMillis() - minutes * 60_000L);
        Query q = new Query(Criteria.where("ts").gte(since))
            .with(Sort.by(Sort.Direction.DESC, "ts"))
            .limit(maxResults);
        return mongoTemplate.find(q, Document.class, COLLECTION);
    }
}
