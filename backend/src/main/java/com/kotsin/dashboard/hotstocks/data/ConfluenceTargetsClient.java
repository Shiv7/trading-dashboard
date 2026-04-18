package com.kotsin.dashboard.hotstocks.data;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * HTTP client for streamingcandle's {@code POST /api/confluence/equity-targets} endpoint.
 * Calls the {@code ConfluentTargetEngine} to compute pivot-based SL/T1-T4 for a cash-equity
 * position, bypassing the options overlay. Used by the HotStocks non-F&amp;O opener branch.
 *
 * <p>Pure equity call — option entry / delta / gamma are zero in the request body.
 */
@Component
public class ConfluenceTargetsClient {

    private static final Logger log = LoggerFactory.getLogger(ConfluenceTargetsClient.class);

    private final RestTemplate http;

    @Value("${streamingcandle.base-url:http://localhost:8081}")
    private String streamingcandleBaseUrl;

    public ConfluenceTargetsClient(RestTemplate hotStocksRestTemplate) {
        this.http = hotStocksRestTemplate;
    }

    public record EquityTargets(
        Double stopLoss,
        Double target1,
        Double target2,
        Double target3,
        Double target4,
        Double riskRewardRatio,
        Double atr30m,
        String tradeGrade,
        String rejectReason,
        boolean pivotSource,
        int zoneCount,
        double fortressScore,
        double roomRatio,
        String lotAllocation
    ) {
        public boolean isActionable() {
            return pivotSource && stopLoss != null && target1 != null
                && !"F".equals(tradeGrade);
        }
    }

    public Optional<EquityTargets> computeEquityTargets(String scripCode, double entry, boolean isLong) {
        if (scripCode == null || scripCode.isBlank() || entry <= 0) return Optional.empty();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("scripCode", scripCode);
        body.put("entry", entry);
        body.put("isLong", isLong);
        body.put("exchange", "N");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> req = new HttpEntity<>(body, headers);

        try {
            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> resp = (ResponseEntity<Map<String, Object>>) (ResponseEntity<?>)
                http.postForEntity(
                    streamingcandleBaseUrl + "/api/confluence/equity-targets",
                    req, Map.class);

            if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) {
                log.warn("[CONFLUENCE-CLIENT] non-2xx scrip={} entry={} status={}",
                    scripCode, entry, resp.getStatusCode());
                return Optional.empty();
            }
            Map<String, Object> r = resp.getBody();
            if (r.containsKey("error")) {
                log.warn("[CONFLUENCE-CLIENT] server error scrip={}: {}", scripCode, r.get("error"));
                return Optional.empty();
            }
            return Optional.of(new EquityTargets(
                toD(r.get("stopLoss")),
                toD(r.get("target1")),
                toD(r.get("target2")),
                toD(r.get("target3")),
                toD(r.get("target4")),
                toD(r.get("riskRewardRatio")),
                toD(r.get("atr30m")),
                toS(r.get("tradeGrade")),
                toS(r.get("rejectReason")),
                Boolean.TRUE.equals(r.get("pivotSource")),
                r.get("zoneCount") instanceof Number n ? n.intValue() : 0,
                r.get("fortressScore") instanceof Number n2 ? n2.doubleValue() : 0,
                r.get("roomRatio") instanceof Number n3 ? n3.doubleValue() : 0,
                toS(r.get("lotAllocation"))
            ));
        } catch (RestClientException e) {
            log.warn("[CONFLUENCE-CLIENT] call failed scrip={} entry={}: {}",
                scripCode, entry, e.getMessage());
            return Optional.empty();
        }
    }

    private static Double toD(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(v.toString()); } catch (NumberFormatException e) { return null; }
    }

    private static String toS(Object v) {
        return v == null ? null : v.toString();
    }
}
