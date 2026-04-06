package com.kotsin.dashboard.controller;

import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/slippage")
@Slf4j
public class SlippageAuditController {

    @Autowired
    private MongoTemplate mongoTemplate;

    /**
     * Get slippage audit records with optional filters.
     */
    @GetMapping("/audit")
    public List<Map<String, Object>> getAuditRecords(
            @RequestParam(required = false) String strategy,
            @RequestParam(required = false) String scripCode,
            @RequestParam(required = false) String signalId,
            @RequestParam(required = false) String side,
            @RequestParam(defaultValue = "100") int limit) {

        Query query = new Query();
        if (strategy != null && !strategy.isEmpty()) {
            query.addCriteria(Criteria.where("strategy").is(strategy));
        }
        if (scripCode != null && !scripCode.isEmpty()) {
            query.addCriteria(Criteria.where("scripCode").is(scripCode));
        }
        if (signalId != null && !signalId.isEmpty()) {
            query.addCriteria(Criteria.where("signalId").is(signalId));
        }
        if (side != null && !side.isEmpty()) {
            query.addCriteria(Criteria.where("side").is(side.toUpperCase()));
        }
        query.with(Sort.by(Sort.Direction.DESC, "timestamp"));
        query.limit(Math.min(limit, 500));

        List<Document> docs = mongoTemplate.find(query, Document.class, "slippage_audit");
        return docs.stream()
                .map(this::docToMap)
                .collect(Collectors.toList());
    }

    /**
     * Get slippage summary — aggregate stats for monitoring.
     */
    @GetMapping("/summary")
    public Map<String, Object> getSummary(
            @RequestParam(required = false) String strategy,
            @RequestParam(defaultValue = "100") int limit) {

        Query query = new Query();
        if (strategy != null && !strategy.isEmpty()) {
            query.addCriteria(Criteria.where("strategy").is(strategy));
        }
        query.with(Sort.by(Sort.Direction.DESC, "timestamp"));
        query.limit(Math.min(limit, 1000));

        List<Document> docs = mongoTemplate.find(query, Document.class, "slippage_audit");

        // Aggregate by tier
        Map<String, List<Document>> byTier = new LinkedHashMap<>();
        double totalEstimated = 0, totalActual = 0;
        int count = 0;
        int betterThanEstimate = 0, worseThanEstimate = 0;

        for (Document doc : docs) {
            String tier = doc.getString("slippageTier");
            if (tier == null) tier = "UNKNOWN";
            byTier.computeIfAbsent(tier, k -> new ArrayList<>()).add(doc);

            double est = getDouble(doc, "estimatedSlippagePerUnit");
            double actual = getDouble(doc, "actualSlippagePerUnit");
            if (est > 0 || actual > 0) {
                totalEstimated += est;
                totalActual += actual;
                count++;
                if (actual <= est) betterThanEstimate++;
                else worseThanEstimate++;
            }
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("totalRecords", docs.size());
        summary.put("avgEstimatedSlippage", count > 0 ? totalEstimated / count : 0);
        summary.put("avgActualSlippage", count > 0 ? totalActual / count : 0);
        summary.put("betterThanEstimate", betterThanEstimate);
        summary.put("worseThanEstimate", worseThanEstimate);
        summary.put("accuracyPct", count > 0 ? (betterThanEstimate * 100.0 / count) : 0);

        // Per-tier breakdown
        Map<String, Map<String, Object>> tierBreakdown = new LinkedHashMap<>();
        for (var entry : byTier.entrySet()) {
            Map<String, Object> tierStats = new LinkedHashMap<>();
            tierStats.put("count", entry.getValue().size());
            double tierEst = 0, tierAct = 0;
            for (Document d : entry.getValue()) {
                tierEst += getDouble(d, "estimatedSlippagePct");
                tierAct += getDouble(d, "actualSlippagePct");
            }
            int n = entry.getValue().size();
            tierStats.put("avgEstimatedPct", n > 0 ? tierEst / n : 0);
            tierStats.put("avgActualPct", n > 0 ? tierAct / n : 0);
            tierBreakdown.put(entry.getKey(), tierStats);
        }
        summary.put("byTier", tierBreakdown);

        return summary;
    }

    private Map<String, Object> docToMap(Document doc) {
        Map<String, Object> map = new LinkedHashMap<>(doc);
        map.remove("_class");
        Object id = map.get("_id");
        if (id != null) {
            map.put("id", id.toString());
            map.remove("_id");
        }
        return map;
    }

    private double getDouble(Document doc, String field) {
        Object val = doc.get(field);
        if (val instanceof Number n) return n.doubleValue();
        return 0;
    }
}
