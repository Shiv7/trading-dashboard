package com.kotsin.dashboard.pivotboss;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only REST API for the PivotBoss R&F (refinement) analytics tab.
 * Sources data from the {@code pivotboss_signal_audit} Mongo collection
 * written by streamingcandle.
 */
@RestController
@RequestMapping("/api/pivotboss")
public class PivotBossController {

    private final PivotBossAuditRepository repo;

    public PivotBossController(PivotBossAuditRepository repo) {
        this.repo = repo;
    }

    /** Recent audit rows. */
    @GetMapping("/audit")
    public List<PivotBossAuditDoc> recentAudit(
            @RequestParam(defaultValue = "200") int limit,
            @RequestParam(required = false) String decision,
            @RequestParam(defaultValue = "7") int days) {
        Instant from = Instant.now().minus(days, ChronoUnit.DAYS);
        Instant to = Instant.now();
        PageRequest p = PageRequest.of(0, Math.max(1, Math.min(limit, 1000)),
                Sort.by(Sort.Direction.DESC, "triggeredAt"));
        return decision == null
            ? repo.findByTriggeredAtBetween(from, to, p)
            : repo.findByDecisionAndTriggeredAtBetween(decision, from, to, p);
    }

    /** Per-setup performance summary across the audit window. */
    @GetMapping("/analytics/setup-stats")
    public List<Map<String, Object>> setupStats(@RequestParam(defaultValue = "30") int days) {
        Instant from = Instant.now().minus(days, ChronoUnit.DAYS);
        PageRequest all = PageRequest.of(0, 5000, Sort.by(Sort.Direction.DESC, "triggeredAt"));
        List<PivotBossAuditDoc> rows = repo.findByTriggeredAtBetween(from, Instant.now(), all);

        Map<Integer, int[]> counts = new HashMap<>();   // setupId -> [fired, rejected]
        Map<Integer, double[]> biasSum = new HashMap<>();
        for (PivotBossAuditDoc r : rows) {
            if (r.getSetupId() == null) continue;
            int sid = r.getSetupId();
            counts.computeIfAbsent(sid, k -> new int[2]);
            biasSum.computeIfAbsent(sid, k -> new double[2]);
            boolean fired = "FIRED".equalsIgnoreCase(r.getDecision());
            counts.get(sid)[fired ? 0 : 1]++;
            if (r.getBiasScore() != null) {
                biasSum.get(sid)[0] += r.getBiasScore();
                biasSum.get(sid)[1] += 1;
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<Integer, int[]> e : counts.entrySet()) {
            Map<String, Object> row = new HashMap<>();
            int fired = e.getValue()[0];
            int rejected = e.getValue()[1];
            int total = fired + rejected;
            double[] bs = biasSum.get(e.getKey());
            row.put("setupId", e.getKey());
            row.put("fired", fired);
            row.put("rejected", rejected);
            row.put("total", total);
            row.put("fireRate", total > 0 ? (double) fired / total : 0.0);
            row.put("avgBias", bs[1] > 0 ? bs[0] / bs[1] : 0.0);
            out.add(row);
        }
        out.sort((a, b) -> Integer.compare((Integer) a.get("setupId"), (Integer) b.get("setupId")));
        return out;
    }

    /** Regime-vs-relation breakdown heatmap data. */
    @GetMapping("/analytics/regime-matrix")
    public List<Map<String, Object>> regimeMatrix(@RequestParam(defaultValue = "30") int days) {
        Instant from = Instant.now().minus(days, ChronoUnit.DAYS);
        PageRequest all = PageRequest.of(0, 5000, Sort.by(Sort.Direction.DESC, "triggeredAt"));
        List<PivotBossAuditDoc> rows = repo.findByTriggeredAtBetween(from, Instant.now(), all);

        Map<String, int[]> bucket = new HashMap<>();  // key="cpr|twoDay" -> [fired, total]
        for (PivotBossAuditDoc r : rows) {
            String k = (r.getCprRegime() == null ? "?" : r.getCprRegime())
                    + "|" + (r.getTwoDayRelation() == null ? "?" : r.getTwoDayRelation());
            bucket.computeIfAbsent(k, x -> new int[2]);
            bucket.get(k)[1]++;
            if ("FIRED".equalsIgnoreCase(r.getDecision())) bucket.get(k)[0]++;
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, int[]> e : bucket.entrySet()) {
            String[] parts = e.getKey().split("\\|");
            Map<String, Object> row = new HashMap<>();
            row.put("cprRegime", parts[0]);
            row.put("twoDayRelation", parts.length > 1 ? parts[1] : "?");
            row.put("fired", e.getValue()[0]);
            row.put("total", e.getValue()[1]);
            row.put("fireRate", e.getValue()[1] > 0 ? (double) e.getValue()[0] / e.getValue()[1] : 0.0);
            out.add(row);
        }
        return out;
    }
}
