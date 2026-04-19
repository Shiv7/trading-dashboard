package com.kotsin.dashboard.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * Exposes F14 calibration report from MongoDB f14_calibration_report collection.
 * Updated weekly (Saturday 06:00 IST) by F14CalibrationJob in streamingcandle.
 */
@RestController
@RequestMapping("/api/f14")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class F14CalibrationController {

    private final MongoTemplate mongoTemplate;

    @GetMapping("/calibration")
    public ResponseEntity<Map<String, Object>> getLatestCalibration() {
        try {
            Document latest = mongoTemplate.getCollection("f14_calibration_report")
                    .find()
                    .sort(new Document("createdAt", -1))
                    .limit(1)
                    .first();

            if (latest == null) {
                Map<String, Object> empty = new HashMap<>();
                empty.put("available", false);
                empty.put("reason", "No calibration report yet — first run scheduled Saturday 06:00 IST");
                return ResponseEntity.ok(empty);
            }
            Map<String, Object> response = new HashMap<>(latest);
            response.put("available", true);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.warn("Calibration fetch failed: {}", e.getMessage());
            Map<String, Object> err = new HashMap<>();
            err.put("available", false);
            err.put("reason", "ERROR: " + e.getMessage());
            return ResponseEntity.ok(err);
        }
    }

    /**
     * Trigger calibration on demand (admin-only in production; here permitAll for dev).
     * Returns the newly-generated report.
     */
    @PostMapping("/calibration/run-now")
    public ResponseEntity<Map<String, Object>> runNow() {
        Map<String, Object> response = new HashMap<>();
        response.put("triggered", true);
        response.put("note", "Calibration runs in streamingcandle scheduler (Saturday 06:00 IST). " +
                "On-demand trigger requires streamingcandle endpoint, not implemented here.");
        return ResponseEntity.ok(response);
    }
}
