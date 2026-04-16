package com.kotsin.dashboard.hotstocks.service;

import com.kotsin.dashboard.hotstocks.dto.HotStocksActivePosition;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@Slf4j
public class HotStocksActivePositionService {

    @Value("${tradeexec.base-url:http://localhost:8089}")
    private String baseUrl;

    private final RestTemplate restTemplate;

    public HotStocksActivePositionService(@Qualifier("hotStocksRestTemplate") RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    public List<HotStocksActivePosition> listActive() {
        String url = baseUrl + "/api/strategy-trades/active?strategy=HOTSTOCKS";
        try {
            ResponseEntity<List<Map<String, Object>>> resp = restTemplate.exchange(
                url, HttpMethod.GET, null,
                new ParameterizedTypeReference<List<Map<String, Object>>>() {});
            List<Map<String, Object>> body = resp.getBody();
            if (body == null) return List.of();
            return body.stream()
                .filter(m -> asInt(m.get("qtyOpen")) > 0)
                .map(this::map)
                .collect(Collectors.toList());
        } catch (HttpStatusCodeException e) {
            log.warn("[HOTSTOCKS-ACTIVE] upstream {} {}: {}", url, e.getStatusCode(), e.getMessage());
            return List.of();
        } catch (Exception e) {
            log.error("[HOTSTOCKS-ACTIVE] failed to fetch: {}", e.toString());
            return List.of();
        }
    }

    private HotStocksActivePosition map(Map<String, Object> m) {
        return new HotStocksActivePosition(
            String.valueOf(m.get("scripCode")),
            String.valueOf(m.getOrDefault("instrumentSymbol", m.get("symbol"))),
            String.valueOf(m.getOrDefault("exchange", "N")),
            m.get("futScripCode") == null ? null : String.valueOf(m.get("futScripCode")),
            String.valueOf(m.getOrDefault("side", "LONG")),
            asDouble(m.get("avgEntry")),
            asInt(m.get("qtyOpen")),
            asDouble(m.get("sl")),
            asDouble(m.get("t1")),
            asDouble(m.get("t2")),
            asDouble(m.get("t3")),
            asDouble(m.get("t4")),
            asBool(m.get("t1Hit")),
            asBool(m.get("t2Hit")),
            asBool(m.get("t3Hit")),
            asBool(m.get("t4Hit")),
            m.get("openedAt") == null ? null : parseInstant(String.valueOf(m.get("openedAt")))
        );
    }

    private static Instant parseInstant(String s) {
        if (s == null || s.isBlank() || "null".equals(s)) return null;
        try {
            return Instant.parse(s);
        } catch (Exception e) {
            // openedAt may be an epoch-millis long stored as number in the Map
            try {
                return Instant.ofEpochMilli(Long.parseLong(s));
            } catch (Exception ignored) {
                return null;
            }
        }
    }

    private static double asDouble(Object o) {
        if (o == null) return 0.0;
        if (o instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(String.valueOf(o)); } catch (Exception e) { return 0.0; }
    }

    private static int asInt(Object o) {
        if (o == null) return 0;
        if (o instanceof Number n) return n.intValue();
        try { return Integer.parseInt(String.valueOf(o)); } catch (Exception e) { return 0; }
    }

    private static boolean asBool(Object o) {
        return Boolean.TRUE.equals(o);
    }
}
