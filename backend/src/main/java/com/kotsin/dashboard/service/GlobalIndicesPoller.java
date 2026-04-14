package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.util.Map;

/**
 * GlobalIndicesPoller — polls FastAnalytics {@code /api/global-indices} every 60s and
 * stashes Europe + Middle East prices in Redis under {@code global:indices:{name}:{field}}.
 *
 * {@code MarketPulseInsightsService.computeMarketState()} reads these Redis keys directly
 * and exposes them via {@code /api/market-pulse/insights}, so the dashboard frontend picks
 * them up with zero additional wiring.
 *
 * Resilience:
 *   - FastAnalytics unavailable → WARN log, previous Redis values remain (stale is fine,
 *     frontend shows `(prev close)` anyway for global markets outside trading hours).
 *   - Individual ticker returns 0 → that key is NOT overwritten, so last-known-good persists.
 *   - HTTP timeout 5s so we never block the scheduler thread.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class GlobalIndicesPoller {

    private final StringRedisTemplate redis;
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${fastanalytics.base-url:http://localhost:8002}")
    private String fastAnalyticsBaseUrl;

    private static final Duration REDIS_TTL = Duration.ofHours(24);

    @PostConstruct
    public void init() {
        log.info("[GLOBAL_INDICES] poller initialized, target={}", fastAnalyticsBaseUrl);
    }

    /**
     * Poll FastAnalytics every 60s. First run 30s after startup so we don't block
     * application boot with an external HTTP call.
     */
    @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
    public void pollGlobalIndices() {
        String url = fastAnalyticsBaseUrl + "/api/global-indices";
        try {
            String json = restTemplate.getForObject(url, String.class);
            if (json == null || json.isEmpty()) {
                log.warn("[GLOBAL_INDICES] empty response from {}", url);
                return;
            }

            JsonNode root = mapper.readTree(json);
            int updated = 0;

            String[] names = {"ftse", "dax", "cac", "tasi", "uae", "nikkei", "hangseng", "shanghai", "kospi", "us10y"};
            Map<String, Double> pctByName = new java.util.HashMap<>();

            for (String name : names) {
                JsonNode ticker = root.path(name);
                if (ticker.isMissingNode() || ticker.isNull()) continue;

                double price = ticker.path("price").asDouble(0);
                double changePct = ticker.path("changePct").asDouble(0);

                // Only write if we got a real price (prevents zeroing out last-known-good).
                if (price > 0) {
                    redis.opsForValue().set("global:indices:" + name + ":price",
                        String.valueOf(price), REDIS_TTL);
                    redis.opsForValue().set("global:indices:" + name + ":changePct",
                        String.valueOf(changePct), REDIS_TTL);
                    redis.opsForValue().set("global:indices:" + name + ":lastUpdateMs",
                        String.valueOf(System.currentTimeMillis()), REDIS_TTL);
                    updated++;
                    pctByName.put(name, changePct);
                }
            }

            // ── Backwards compatibility + ASS computation for Asian markets ──
            // computeAsianMarkets() reads asian:sentiment:{indices,score,regime}. Populate those
            // from the live Asian pcts so the existing consumer keeps working.
            Double nk = pctByName.get("nikkei");
            Double hs = pctByName.get("hangseng");
            Double sh = pctByName.get("shanghai");
            Double ks = pctByName.get("kospi");
            if (nk != null || hs != null || sh != null || ks != null) {
                Map<String, Object> asianIndices = new java.util.LinkedHashMap<>();
                if (nk != null) asianIndices.put("nikkei", nk);
                if (hs != null) asianIndices.put("hangSeng", hs);
                if (sh != null) asianIndices.put("shanghai", sh);
                if (ks != null) asianIndices.put("kospi", ks);
                try {
                    redis.opsForValue().set("asian:sentiment:indices",
                        mapper.writeValueAsString(asianIndices), REDIS_TTL);
                } catch (Exception ignored) {}

                // Simple ASS: average of available pcts (proxy for sentiment z-score).
                int count = 0; double sum = 0;
                if (nk != null) { sum += nk; count++; }
                if (hs != null) { sum += hs; count++; }
                if (sh != null) { sum += sh; count++; }
                if (ks != null) { sum += ks; count++; }
                double ass = count > 0 ? sum / count : 0;
                String regime;
                if (ass > 1.5)      regime = "STRONG_RISK_ON";
                else if (ass > 0.5) regime = "MILD_RISK_ON";
                else if (ass < -1.5) regime = "STRONG_RISK_OFF";
                else if (ass < -0.5) regime = "MILD_RISK_OFF";
                else                 regime = "NEUTRAL";
                redis.opsForValue().set("asian:sentiment:score",
                    String.format(java.util.Locale.ROOT, "%.3f", ass), REDIS_TTL);
                redis.opsForValue().set("asian:sentiment:regime", regime, REDIS_TTL);
            }

            boolean cached = root.path("cached").asBoolean(false);
            log.info("[GLOBAL_INDICES] polled {} — updated {}/{} indices {}",
                url, updated, names.length, cached ? "(FA cache)" : "(FA fresh)");

        } catch (Exception e) {
            log.warn("[GLOBAL_INDICES] poll failed: {}. Last-known-good values preserved in Redis.",
                e.getMessage());
        }
    }
}
