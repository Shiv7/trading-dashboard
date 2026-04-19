package com.kotsin.dashboard.hotstocks.controller;

import com.kotsin.dashboard.hotstocks.job.HotStocksEnrichmentJob;
import com.kotsin.dashboard.hotstocks.job.HotStocksKillSwitchJob;
import com.kotsin.dashboard.hotstocks.job.HotStocksNonFnoScanJob;
import com.kotsin.dashboard.hotstocks.job.HotStocksPositionOpenerJob;
import com.kotsin.dashboard.hotstocks.job.HotStocksTimeStopJob;
import org.springframework.beans.factory.annotation.Autowired;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * Admin endpoints for Hot Stocks. Used to manually trigger the scheduled jobs
 * outside their cron windows (e.g., for same-day verification, runtime testing,
 * or one-off runs).
 */
@RestController
@RequestMapping("/api/hot-stocks/admin")
public class HotStocksAdminController {

    private static final Logger log = LoggerFactory.getLogger(HotStocksAdminController.class);

    private final HotStocksEnrichmentJob enrichmentJob;
    private final HotStocksPositionOpenerJob positionOpenerJob;
    private final HotStocksTimeStopJob timeStopJob;
    private final HotStocksKillSwitchJob killSwitchJob;
    @Autowired(required = false)
    private HotStocksNonFnoScanJob nonFnoScanJob;

    public HotStocksAdminController(HotStocksEnrichmentJob enrichmentJob,
                                    HotStocksPositionOpenerJob positionOpenerJob,
                                    HotStocksTimeStopJob timeStopJob,
                                    HotStocksKillSwitchJob killSwitchJob) {
        this.enrichmentJob = enrichmentJob;
        this.positionOpenerJob = positionOpenerJob;
        this.timeStopJob = timeStopJob;
        this.killSwitchJob = killSwitchJob;
    }

    @PostMapping("/run-enrichment")
    public Map<String, Object> runEnrichment() {
        log.info("HotStocksAdminController: manual enrichment trigger received");
        // Run synchronously — caller can wait. For long-running, wrap in @Async in a future pass.
        enrichmentJob.run();
        Map<String, Object> result = new HashMap<>();
        result.put("status", "triggered");
        result.put("note", "enrichment ran synchronously — check backend logs for per-scrip detail");
        return result;
    }

    @PostMapping("/run-position-opener")
    public Map<String, Object> runPositionOpener(
            @RequestParam(required = false, defaultValue = "false") boolean force) {
        log.info("HotStocksAdminController: manual position opener trigger received (force={})", force);
        // Dedup guard in openPositions() prevents double-opening if called multiple times.
        // Trading-day guard in openPositions(force) rejects weekend/holiday runs unless force=true.
        positionOpenerJob.openPositions(force);
        Map<String, Object> result = new HashMap<>();
        result.put("status", "triggered");
        result.put("force", force);
        result.put("note", "position opener ran synchronously — check backend logs for per-scrip detail. Pass ?force=true to bypass NSE trading-day guard.");
        return result;
    }

    @PostMapping("/run-time-stop")
    public Map<String, Object> runTimeStop() {
        log.info("HotStocksAdminController: manual time stop trigger received");
        timeStopJob.closeStalePositions();
        Map<String, Object> result = new HashMap<>();
        result.put("status", "triggered");
        result.put("note", "time stop ran synchronously — check backend logs for per-position detail");
        return result;
    }

    @PostMapping("/run-nonfno-scan")
    public Map<String, Object> runNonFnoScan() {
        log.info("HotStocksAdminController: manual non-F&O scan trigger received");
        Map<String, Object> result = new HashMap<>();
        if (nonFnoScanJob == null) {
            result.put("status", "unavailable");
            result.put("note", "HotStocksNonFnoScanJob bean not wired");
            return result;
        }
        nonFnoScanJob.run();
        result.put("status", "triggered");
        result.put("note", "non-F&O scan ran synchronously — picks cached in hotstocks:v1:{scrip} and subscription list in hotstocks:next-day-subscription:{tomorrow}");
        return result;
    }

    @PostMapping("/run-kill-switch")
    public Map<String, Object> runKillSwitch() {
        log.info("HotStocksAdminController: manual kill switch check trigger received");
        killSwitchJob.check();
        Map<String, Object> result = new HashMap<>();
        result.put("status", "triggered");
        result.put("note", "kill switch check ran synchronously — check backend logs and hotstocks:v1:kill_switch key");
        return result;
    }
}
