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
    private final BasketAuditRepository basketRepo;

    public PivotBossController(PivotBossAuditRepository repo, BasketAuditRepository basketRepo) {
        this.repo = repo;
        this.basketRepo = basketRepo;
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

    /**
     * Nifty50 Basket Retest signals — reads signal_rich_audit (written by trade-exec
     * Nifty50BasketSignalConsumer). Surfaces under the PivotBoss sidebar's
     * "Nifty50 Basket Retest" tab.
     *
     * @param days lookback window in days (default 2)
     * @param limit max rows (default 200, capped at 1000)
     * @param path  optional filter "RETEST" or "TREND"
     * @param mode  optional filter "PAPER" or "LIVE"
     */
    @GetMapping("/basket-audit")
    public List<BasketAuditDoc> basketAudit(
            @RequestParam(defaultValue = "2") int days,
            @RequestParam(defaultValue = "200") int limit,
            @RequestParam(required = false) String path,
            @RequestParam(required = false) String mode,
            @RequestParam(defaultValue = "NIFTY50_BASKET") String strategy) {
        Instant from = Instant.now().minus(Math.max(1, days), ChronoUnit.DAYS);
        Instant to = Instant.now();
        PageRequest p = PageRequest.of(0, Math.max(1, Math.min(limit, 1000)),
                Sort.by(Sort.Direction.DESC, "createdAt"));

        String strat = strategy.trim().toUpperCase();
        List<BasketAuditDoc> rows = (path == null || path.isBlank())
                ? basketRepo.findByStrategyAndCreatedAtBetween(strat, from, to, p)
                : basketRepo.findByStrategyAndPathAndCreatedAtBetween(strat,
                        path.trim().toUpperCase(), from, to, p);

        if (mode != null && !mode.isBlank()) {
            String want = mode.trim().toUpperCase();
            return rows.stream().filter(r -> want.equalsIgnoreCase(r.getExecutionMode())).toList();
        }
        return rows;
    }

    /**
     * Per-day fired-vs-rejected stats for Nifty50 Basket Retest. Mirrors the existing
     * /analytics/setup-stats shape but groups by day instead of setup id.
     */
    @GetMapping("/basket-audit/daily-stats")
    public List<Map<String, Object>> basketDailyStats(
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "NIFTY50_BASKET") String strategy) {
        Instant from = Instant.now().minus(Math.max(1, days), ChronoUnit.DAYS);
        PageRequest all = PageRequest.of(0, 5000, Sort.by(Sort.Direction.DESC, "createdAt"));
        List<BasketAuditDoc> rows = basketRepo.findByStrategyAndCreatedAtBetween(
                strategy.trim().toUpperCase(), from, Instant.now(), all);

        Map<String, int[]> byDay = new HashMap<>(); // yyyy-MM-dd -> [retest, trend, total]
        for (BasketAuditDoc r : rows) {
            if (r.getCreatedAt() == null) continue;
            String day = r.getCreatedAt().atZone(java.time.ZoneId.of("Asia/Kolkata")).toLocalDate().toString();
            byDay.computeIfAbsent(day, k -> new int[3]);
            int[] c = byDay.get(day);
            if ("RETEST".equalsIgnoreCase(r.getPath())) c[0]++;
            else if ("TREND".equalsIgnoreCase(r.getPath())) c[1]++;
            c[2]++;
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, int[]> e : byDay.entrySet()) {
            Map<String, Object> row = new HashMap<>();
            row.put("day", e.getKey());
            row.put("retest", e.getValue()[0]);
            row.put("trend", e.getValue()[1]);
            row.put("total", e.getValue()[2]);
            out.add(row);
        }
        out.sort((a, b) -> ((String) b.get("day")).compareTo((String) a.get("day")));
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
