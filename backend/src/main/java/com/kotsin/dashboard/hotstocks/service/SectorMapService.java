package com.kotsin.dashboard.hotstocks.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Loads the curated symbol → sector mapping from classpath TSV at startup.
 * Source: hotstocks-sectors.tsv (derived from NSE sectoral index constituents).
 * Unknown symbols fall back to "Other".
 */
@Component
public class SectorMapService {

    private static final Logger log = LoggerFactory.getLogger(SectorMapService.class);
    private static final String RESOURCE_PATH = "hotstocks-sectors.tsv";
    private static final String UNKNOWN_SECTOR = "Other";

    private final Map<String, String> symbolToSector = new HashMap<>();

    @PostConstruct
    public void init() {
        try (var is = new ClassPathResource(RESOURCE_PATH).getInputStream();
             var reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            int loaded = 0;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) continue;
                String[] cols = line.split("\t", 2);
                if (cols.length != 2) continue;
                String symbol = cols[0].trim().toUpperCase();
                String sector = cols[1].trim();
                if (!symbol.isEmpty() && !sector.isEmpty()) {
                    symbolToSector.putIfAbsent(symbol, sector);
                    loaded++;
                }
            }
            log.info("SectorMapService loaded {} symbol→sector entries from {}", loaded, RESOURCE_PATH);
        } catch (Exception e) {
            log.error("Failed to load sector map from {}: {}", RESOURCE_PATH, e.getMessage(), e);
        }
    }

    public String getSector(String symbol) {
        if (symbol == null || symbol.isBlank()) return UNKNOWN_SECTOR;
        return symbolToSector.getOrDefault(symbol.trim().toUpperCase(), UNKNOWN_SECTOR);
    }

    public int size() {
        return symbolToSector.size();
    }
}
