package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.IPUSignalConsumer;
import com.kotsin.dashboard.kafka.VCPSignalConsumer;
import com.kotsin.dashboard.model.dto.IPUSignalDTO;
import com.kotsin.dashboard.model.dto.VCPSignalDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * REST API for indicator data (IPU, VCP, etc.)
 */
@RestController
@RequestMapping("/api/indicators")
@RequiredArgsConstructor
@Slf4j
public class IndicatorController {

    private final IPUSignalConsumer ipuSignalConsumer;
    private final VCPSignalConsumer vcpSignalConsumer;

    /**
     * Get latest IPU signal for a specific stock
     * GET /api/indicators/{scripCode}/ipu
     */
    @GetMapping("/{scripCode}/ipu")
    public ResponseEntity<IPUSignalDTO> getIPUSignal(@PathVariable String scripCode) {
        IPUSignalDTO signal = ipuSignalConsumer.getLatestIPUSignal(scripCode);
        
        if (signal == null) {
            return ResponseEntity.notFound().build();
        }
        
        return ResponseEntity.ok(signal);
    }

    /**
     * Get latest VCP signal for a specific stock
     * GET /api/indicators/{scripCode}/vcp
     */
    @GetMapping("/{scripCode}/vcp")
    public ResponseEntity<VCPSignalDTO> getVCPSignal(@PathVariable String scripCode) {
        VCPSignalDTO signal = vcpSignalConsumer.getLatestVCPSignal(scripCode);
        
        if (signal == null) {
            return ResponseEntity.notFound().build();
        }
        
        return ResponseEntity.ok(signal);
    }

    /**
     * Get aggregated snapshot of all indicators for a stock
     * GET /api/indicators/{scripCode}/snapshot
     */
    @GetMapping("/{scripCode}/snapshot")
    public ResponseEntity<Map<String, Object>> getIndicatorSnapshot(@PathVariable String scripCode) {
        IPUSignalDTO ipu = ipuSignalConsumer.getLatestIPUSignal(scripCode);
        VCPSignalDTO vcp = vcpSignalConsumer.getLatestVCPSignal(scripCode);
        
        if (ipu == null && vcp == null) {
            return ResponseEntity.notFound().build();
        }
        
        Map<String, Object> snapshot = new HashMap<>();
        snapshot.put("scripCode", scripCode);
        snapshot.put("ipu", ipu);
        snapshot.put("vcp", vcp);
        snapshot.put("timestamp", System.currentTimeMillis());
        
        return ResponseEntity.ok(snapshot);
    }

    /**
     * Get all latest IPU signals
     * GET /api/indicators/ipu/all
     */
    @GetMapping("/ipu/all")
    public ResponseEntity<Map<String, IPUSignalDTO>> getAllIPUSignals() {
        Map<String, IPUSignalDTO> signals = ipuSignalConsumer.getAllLatestIPUSignals();
        return ResponseEntity.ok(signals);
    }

    /**
     * Get all latest VCP signals
     * GET /api/indicators/vcp/all
     */
    @GetMapping("/vcp/all")
    public ResponseEntity<Map<String, VCPSignalDTO>> getAllVCPSignals() {
        Map<String, VCPSignalDTO> signals = vcpSignalConsumer.getAllLatestVCPSignals();
        return ResponseEntity.ok(signals);
    }

    /**
     * Get top movers by IPU score
     * GET /api/indicators/top/ipu?limit=10
     */
    @GetMapping("/top/ipu")
    public ResponseEntity<Map<String, Object>> getTopIPU(
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(defaultValue = "BULLISH") String direction) {
        
        Map<String, IPUSignalDTO> allSignals = ipuSignalConsumer.getAllLatestIPUSignals();
        
        var topSignals = allSignals.values().stream()
                .filter(s -> direction.equals("ALL") || direction.equals(s.getIpuDirection()))
                .filter(s -> s.getIpuFinalScore() != null && s.getIpuFinalScore() > 0)
                .sorted((a, b) -> Double.compare(
                        b.getIpuFinalScore() != null ? b.getIpuFinalScore() : 0,
                        a.getIpuFinalScore() != null ? a.getIpuFinalScore() : 0))
                .limit(limit)
                .toList();
        
        Map<String, Object> response = new HashMap<>();
        response.put("signals", topSignals);
        response.put("count", topSignals.size());
        response.put("direction", direction);
        
        return ResponseEntity.ok(response);
    }

    /**
     * Get top movers by VCP score
     * GET /api/indicators/top/vcp?limit=10
     */
    @GetMapping("/top/vcp")
    public ResponseEntity<Map<String, Object>> getTopVCP(
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(defaultValue = "BULLISH") String direction) {
        
        Map<String, VCPSignalDTO> allSignals = vcpSignalConsumer.getAllLatestVCPSignals();
        
        var topSignals = allSignals.values().stream()
                .filter(s -> direction.equals("ALL") || direction.equals(s.getVcpSignal()))
                .filter(s -> s.getVcpCombinedScore() != null && s.getVcpCombinedScore() > 0)
                .sorted((a, b) -> Double.compare(
                        b.getVcpCombinedScore() != null ? b.getVcpCombinedScore() : 0,
                        a.getVcpCombinedScore() != null ? a.getVcpCombinedScore() : 0))
                .limit(limit)
                .toList();
        
        Map<String, Object> response = new HashMap<>();
        response.put("signals", topSignals);
        response.put("count", topSignals.size());
        response.put("direction", direction);
        
        return ResponseEntity.ok(response);
    }

    /**
     * Get alerts (high-conviction signals)
     * GET /api/indicators/alerts?type=DIB,VIB
     */
    @GetMapping("/alerts")
    public ResponseEntity<Map<String, Object>> getAlerts(
            @RequestParam(required = false) String type) {
        
        Map<String, IPUSignalDTO> allIPU = ipuSignalConsumer.getAllLatestIPUSignals();
        
        var alerts = allIPU.values().stream()
                .filter(s -> {
                    if (type == null) return s.getHasXFactor() != null && s.getHasXFactor();
                    
                    return switch (type) {
                        case "DIB" -> s.getDibTriggered() != null && s.getDibTriggered();
                        case "VIB" -> s.getVibTriggered() != null && s.getVibTriggered();
                        case "GAP" -> s.getGapStatus() != null && !s.getGapStatus().equals("NONE");
                        default -> s.getHasXFactor() != null && s.getHasXFactor();
                    };
                })
                .sorted((a, b) -> b.getTimestamp().compareTo(a.getTimestamp()))
                .limit(50)
                .toList();
        
        Map<String, Object> response = new HashMap<>();
        response.put("alerts", alerts);
        response.put("count", alerts.size());
        response.put("type", type != null ? type : "ALL");
        
        return ResponseEntity.ok(response);
    }
}
