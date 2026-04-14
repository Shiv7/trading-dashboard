package com.kotsin.dashboard.hotstocks.data;

import com.kotsin.dashboard.hotstocks.model.StrategyWatch;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.List;
import java.util.Map;

@Component
public class StrategyCrossReferenceClient {
    private static final Logger log = LoggerFactory.getLogger(StrategyCrossReferenceClient.class);

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String baseUrl;

    private final RestTemplate rest;

    public StrategyCrossReferenceClient(@Qualifier("hotStocksRestTemplate") RestTemplate rest) {
        this.rest = rest;
    }

    /** Returns strategies currently watching or holding this scripCode. Empty list on failure. */
    @SuppressWarnings("unchecked")
    public List<StrategyWatch> fetchWatchers(String scripCode) {
        String url = baseUrl + "/api/strategies/watching/" + scripCode;
        try {
            List<?> raw = rest.getForObject(url, List.class);
            if (raw == null) return Collections.emptyList();
            return ((List<Map<String, Object>>) raw).stream()
                .map(mp -> new StrategyWatch(
                    String.valueOf(mp.get("strategyName")),
                    String.valueOf(mp.get("state")),
                    mp.get("triggerLevel") == null ? null : ((Number) mp.get("triggerLevel")).doubleValue(),
                    String.valueOf(mp.get("notes"))))
                .toList();
        } catch (Exception e) {
            log.debug("Strategy cross-ref unavailable for {}: {}", scripCode, e.getMessage());
            return Collections.emptyList();
        }
    }
}
