package com.kotsin.dashboard.service;

import com.kotsin.dashboard.repository.ScripGroupRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

/**
 * Centralized service to resolve scripCode -> companyName
 * using the ScripGroup collection. Loads once at startup and caches in memory.
 */
@Service
public class ScripLookupService {

    private static final Logger log = LoggerFactory.getLogger(ScripLookupService.class);

    private final ScripGroupRepository scripGroupRepository;
    private volatile Map<String, String> cache = Map.of();

    public ScripLookupService(ScripGroupRepository scripGroupRepository) {
        this.scripGroupRepository = scripGroupRepository;
    }

    @PostConstruct
    public void init() {
        reload();
    }

    public void reload() {
        Map<String, String> map = new HashMap<>();
        scripGroupRepository.findAll().forEach(sg -> {
            if (sg.getCompanyName() != null && !sg.getCompanyName().isEmpty()) {
                map.put(sg.getId(), sg.getCompanyName());
            }
        });
        cache = map;
        log.info("ScripLookupService: loaded {} scrip name mappings", cache.size());
    }

    /**
     * Resolve scripCode to companyName.
     * If a non-empty candidateName is already available (e.g. from Kafka message), returns that.
     * Otherwise looks up from ScripGroup cache and falls back to scripCode.
     */
    public String resolve(String scripCode, String candidateName) {
        // If the candidate name is present and is NOT the same as the scripCode, use it
        if (candidateName != null && !candidateName.isEmpty()
                && !candidateName.equals(scripCode)) {
            return candidateName;
        }
        // Look up from cache
        return cache.getOrDefault(scripCode, scripCode);
    }

    /**
     * Resolve scripCode to companyName (no candidate).
     */
    public String resolve(String scripCode) {
        if (scripCode == null || scripCode.isEmpty()) return scripCode;
        return cache.getOrDefault(scripCode, scripCode);
    }
}
