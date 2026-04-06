package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.service.LiveTradesService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/live")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class LiveTradesController {

    private final LiveTradesService liveTradesService;

    @GetMapping
    public ResponseEntity<?> getLiveData() {
        return ResponseEntity.ok(liveTradesService.getLiveData());
    }
}
