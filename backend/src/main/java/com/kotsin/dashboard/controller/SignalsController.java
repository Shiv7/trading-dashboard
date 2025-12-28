package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.kafka.SignalConsumer;
import com.kotsin.dashboard.model.dto.SignalDTO;
import com.kotsin.dashboard.service.SignalHistoryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * REST controller for signal history endpoints.
 * Returns signals from both MongoDB history AND in-memory cache (live signals).
 */
@RestController
@RequestMapping("/api/signals")
@RequiredArgsConstructor
@Slf4j
public class SignalsController {

    private final SignalHistoryService signalHistoryService;
    private final SignalConsumer signalConsumer;

    /**
     * Get paginated signal history (from cache + MongoDB)
     */
    @GetMapping
    public ResponseEntity<Page<SignalDTO>> getSignals(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String scripCode,
            @RequestParam(required = false) Boolean emittedOnly) {
        
        Pageable pageable = PageRequest.of(page, size);
        
        // First get from in-memory cache (live signals)
        Map<String, SignalDTO> cachedSignals = signalConsumer.getAllSignals();
        List<SignalDTO> allSignals = new ArrayList<>(cachedSignals.values());
        
        log.info("Returning {} signals from cache", allSignals.size());
        
        // Filter if needed
        if (scripCode != null && !scripCode.isEmpty()) {
            allSignals = allSignals.stream()
                    .filter(s -> scripCode.equals(s.getScripCode()))
                    .collect(Collectors.toList());
        }
        if (Boolean.TRUE.equals(emittedOnly)) {
            allSignals = allSignals.stream()
                    .filter(SignalDTO::isAllGatesPassed)
                    .collect(Collectors.toList());
        }
        
        // Sort by timestamp descending
        allSignals.sort(Comparator.comparing(SignalDTO::getTimestamp).reversed());
        
        // Paginate
        int start = (int) pageable.getOffset();
        int end = Math.min(start + pageable.getPageSize(), allSignals.size());
        List<SignalDTO> pageContent = start < allSignals.size() ? allSignals.subList(start, end) : List.of();
        
        return ResponseEntity.ok(new PageImpl<>(pageContent, pageable, allSignals.size()));
    }

    /**
     * Get signal by ID (from cache first, then MongoDB)
     */
    @GetMapping("/{signalId}")
    public ResponseEntity<SignalDTO> getSignalById(@PathVariable String signalId) {
        // Check cache first
        SignalDTO cached = signalConsumer.getAllSignals().get(signalId);
        if (cached != null) {
            return ResponseEntity.ok(cached);
        }
        
        // Fallback to MongoDB
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
        
        // Get from cache
        List<SignalDTO> signals = new ArrayList<>(signalConsumer.getSignalsForStock(scripCode).values());
        
        log.info("Returning {} signals for stock {} from cache", signals.size(), scripCode);
        
        // Sort by timestamp descending and limit
        signals.sort(Comparator.comparing(SignalDTO::getTimestamp).reversed());
        if (signals.size() > limit) {
            signals = signals.subList(0, limit);
        }
        
        return ResponseEntity.ok(signals);
    }
}

