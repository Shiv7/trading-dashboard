package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.InstrumentAnalysisService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/analysis")
public class InstrumentAnalysisController {

    private final InstrumentAnalysisService analysisService;

    public InstrumentAnalysisController(InstrumentAnalysisService analysisService) {
        this.analysisService = analysisService;
    }

    @GetMapping("/{scripCode}/overview")
    public ResponseEntity<Map<String, Object>> getOverview(@PathVariable String scripCode) {
        return ResponseEntity.ok(analysisService.getOverview(scripCode));
    }

    @GetMapping("/{scripCode}/signals")
    public ResponseEntity<List<Map<String, Object>>> getSignals(@PathVariable String scripCode) {
        return ResponseEntity.ok(analysisService.getSignals(scripCode));
    }

    @GetMapping("/{scripCode}/pivots")
    public ResponseEntity<Map<String, Object>> getPivotLevels(@PathVariable String scripCode) {
        return ResponseEntity.ok(analysisService.getPivotLevels(scripCode));
    }

    @GetMapping("/{scripCode}/regime")
    public ResponseEntity<Map<String, Object>> getRegime(@PathVariable String scripCode) {
        return ResponseEntity.ok(analysisService.getRegime(scripCode));
    }

    @GetMapping("/{scripCode}/prediction")
    public ResponseEntity<Map<String, Object>> getPrediction(@PathVariable String scripCode) {
        return ResponseEntity.ok(analysisService.getPrediction(scripCode));
    }
}
