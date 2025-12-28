package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.SignalDTO;
import com.kotsin.dashboard.service.SignalHistoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST controller for signal history endpoints.
 */
@RestController
@RequestMapping("/api/signals")
@RequiredArgsConstructor
public class SignalsController {

    private final SignalHistoryService signalHistoryService;

    /**
     * Get paginated signal history
     */
    @GetMapping
    public ResponseEntity<Page<SignalDTO>> getSignals(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String scripCode,
            @RequestParam(required = false) Boolean emittedOnly) {
        
        Pageable pageable = PageRequest.of(page, size);
        return ResponseEntity.ok(signalHistoryService.getSignals(pageable, scripCode, emittedOnly));
    }

    /**
     * Get signal by ID
     */
    @GetMapping("/{signalId}")
    public ResponseEntity<SignalDTO> getSignalById(@PathVariable String signalId) {
        return signalHistoryService.getSignalById(signalId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get signals for a specific stock
     */
    @GetMapping("/stock/{scripCode}")
    public ResponseEntity<List<SignalDTO>> getSignalsForStock(
            @PathVariable String scripCode,
            @RequestParam(defaultValue = "50") int limit) {
        return ResponseEntity.ok(signalHistoryService.getSignalsForStock(scripCode, limit));
    }
}

