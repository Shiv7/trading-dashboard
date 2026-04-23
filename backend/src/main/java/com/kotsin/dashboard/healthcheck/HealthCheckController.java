package com.kotsin.dashboard.healthcheck;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/health-check")
@RequiredArgsConstructor
@Slf4j
public class HealthCheckController {

    private final HealthCheckService service;

    @GetMapping
    public List<HealthCheckService.JobStatus> list() {
        return service.computeAll();
    }

    @PostMapping("/trigger/{jobId}")
    public ResponseEntity<HealthCheckService.TriggerResult> trigger(@PathVariable String jobId) {
        HealthCheckService.TriggerResult r = service.trigger(jobId);
        return r.success() ? ResponseEntity.ok(r) : ResponseEntity.badRequest().body(r);
    }
}
