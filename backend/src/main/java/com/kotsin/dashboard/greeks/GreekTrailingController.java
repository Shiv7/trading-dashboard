package com.kotsin.dashboard.greeks;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * REST endpoint for monitoring and controlling the Greek Trailing Engine on port 8085.
 * Exposes active trail states and emergency controls.
 *
 * Endpoints:
 *   GET  /api/greek-trailing/active              — list all trail states with full Greek data
 *   POST /api/greek-trailing/force-exit/{key}     — manually exit a single trail
 *   POST /api/greek-trailing/disable              — emergency kill switch
 */
@RestController
@RequestMapping("/api/greek-trailing")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class GreekTrailingController {

    private final GreekTrailingEngine engine;

    /**
     * GET /api/greek-trailing/active — list all trail states with full Greek data.
     */
    @GetMapping("/active")
    public List<Map<String, Object>> getActiveTrails() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (GreekTrailingEngine.TrailState state : engine.getAllTrailStates()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("positionKey", state.getPositionKey());
            m.put("scripCode", state.getScripCode());
            m.put("companyName", state.getCompanyName());
            m.put("optionType", state.getOptionType());
            m.put("strikePrice", state.getStrikePrice());
            m.put("status", state.getStatus());
            m.put("deltaAtT1", round(state.getDeltaAtT1()));
            m.put("currentDelta", round(state.getCurrentDelta()));
            m.put("peakDelta", round(state.getPeakDelta()));
            m.put("deltaAccelRatio", round(state.getDeltaAccelRatio()));
            m.put("premiumAtT1", round(state.getPremiumAtT1()));
            m.put("currentPremium", round(state.getCurrentPremium()));
            m.put("highWatermark", round(state.getHighWatermark()));
            m.put("trailStopPrice", round(state.getTrailStopPrice()));
            m.put("currentTrailPct", round(state.getCurrentTrailPct() * 100));
            m.put("thetaBurnRate", round(state.getThetaBurnRate() * 100));
            m.put("currentGamma", round(state.getCurrentGamma()));
            m.put("currentIV", round(state.getCurrentIV() * 100));
            m.put("dte", state.getDte());
            m.put("exitReason", state.getExitReason());
            m.put("t1HitTime", state.getT1HitTime());
            m.put("lastUpdateTime", state.getLastUpdateTime());
            m.put("trailingSinceMs", System.currentTimeMillis() - state.getT1HitTime());
            result.add(m);
        }
        return result;
    }

    /**
     * POST /api/greek-trailing/force-exit/{positionKey} — manually exit a single trail.
     */
    @PostMapping("/force-exit/{positionKey}")
    public Map<String, Object> forceExit(@PathVariable String positionKey) {
        GreekTrailingEngine.TrailState state = engine.getTrailState(positionKey);
        if (state == null) return Map.of("success", false, "error", "Trail not found");
        state.setStatus("EXITED");
        state.setExitReason("MANUAL_FORCE_EXIT");
        return Map.of("success", true, "positionKey", positionKey, "reason", "MANUAL_FORCE_EXIT");
    }

    /**
     * POST /api/greek-trailing/disable — emergency kill switch, exits all active trails.
     */
    @PostMapping("/disable")
    public Map<String, Object> disableEngine() {
        engine.getAllTrailStates().forEach(s -> {
            if ("TRAILING".equals(s.getStatus())) {
                s.setStatus("EXITED");
                s.setExitReason("ENGINE_DISABLED");
            }
        });
        return Map.of("success", true, "message", "All Greek trails disabled");
    }

    private double round(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
