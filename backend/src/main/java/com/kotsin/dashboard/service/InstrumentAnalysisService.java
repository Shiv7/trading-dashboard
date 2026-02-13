package com.kotsin.dashboard.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@Service
@Slf4j
public class InstrumentAnalysisService {

    private final RedisTemplate<String, String> redisTemplate;
    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${scripfinder.service.url:http://localhost:8102}")
    private String scripFinderUrl;

    @Value("${ml.service.url:http://localhost:8002}")
    private String mlServiceUrl;

    public InstrumentAnalysisService(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public Map<String, Object> getOverview(String scripCode) {
        Map<String, Object> overview = new LinkedHashMap<>();
        overview.put("scripCode", scripCode);

        // Get latest tick data from Redis
        try {
            String tickKey = "tick:" + scripCode + ":1m:latest";
            String tickJson = redisTemplate.opsForValue().get(tickKey);
            if (tickJson != null) {
                Object parsed = objectMapper.readValue(tickJson, Object.class);
                if (parsed instanceof List) {
                    List<?> arr = (List<?>) parsed;
                    if (arr.size() >= 2 && arr.get(1) instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> tickData = (Map<String, Object>) arr.get(1);
                        overview.put("close", tickData.get("close"));
                        overview.put("open", tickData.get("open"));
                        overview.put("high", tickData.get("high"));
                        overview.put("low", tickData.get("low"));
                        overview.put("volume", tickData.get("volume"));
                    }
                }
            }
        } catch (Exception e) {
            log.debug("No tick data for {}: {}", scripCode, e.getMessage());
        }

        // Get indicator data from Redis
        try {
            String indicatorKey = "indicator:" + scripCode;
            String indJson = redisTemplate.opsForValue().get(indicatorKey);
            if (indJson != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> indicators = objectMapper.readValue(indJson, Map.class);
                overview.put("indicators", indicators);
            }
        } catch (Exception e) {
            log.debug("No indicator data for {}: {}", scripCode, e.getMessage());
        }

        // Get signal data from Redis
        try {
            String signalKey = "signal:" + scripCode;
            String sigJson = redisTemplate.opsForValue().get(signalKey);
            if (sigJson != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> signal = objectMapper.readValue(sigJson, Map.class);
                overview.put("signal", signal);
            }
        } catch (Exception e) {
            log.debug("No signal data for {}: {}", scripCode, e.getMessage());
        }

        return overview;
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getSignals(String scripCode) {
        List<Map<String, Object>> signals = new ArrayList<>();

        // Check Redis for recent signals
        try {
            Set<String> keys = redisTemplate.keys("signal:history:" + scripCode + ":*");
            if (keys != null) {
                for (String key : keys) {
                    String json = redisTemplate.opsForValue().get(key);
                    if (json != null) {
                        Map<String, Object> signal = objectMapper.readValue(json, Map.class);
                        signals.add(signal);
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Error getting signal history for {}: {}", scripCode, e.getMessage());
        }

        // Also check current signal
        try {
            String sigJson = redisTemplate.opsForValue().get("signal:" + scripCode);
            if (sigJson != null) {
                Map<String, Object> currentSignal = objectMapper.readValue(sigJson, Map.class);
                currentSignal.put("isCurrent", true);
                signals.add(0, currentSignal);
            }
        } catch (Exception e) {
            log.debug("No current signal for {}", scripCode);
        }

        return signals;
    }

    public Map<String, Object> getPivotLevels(String scripCode) {
        Map<String, Object> pivots = new LinkedHashMap<>();

        // Try to get from ScripFinder
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> result = restTemplate.getForObject(
                    scripFinderUrl + "/api/scrip/" + scripCode + "/pivots", Map.class);
            if (result != null) {
                return result;
            }
        } catch (RestClientException e) {
            log.debug("Could not get pivots from ScripFinder: {}", e.getMessage());
        }

        // Try Redis for cached pivot data
        try {
            String pivotJson = redisTemplate.opsForValue().get("pivots:" + scripCode);
            if (pivotJson != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> cached = objectMapper.readValue(pivotJson, Map.class);
                return cached;
            }
        } catch (Exception e) {
            log.debug("No cached pivots for {}", scripCode);
        }

        pivots.put("scripCode", scripCode);
        pivots.put("message", "Pivot data not available");
        return pivots;
    }

    public Map<String, Object> getRegime(String scripCode) {
        Map<String, Object> regime = new LinkedHashMap<>();

        try {
            String regimeKey = "regime:" + scripCode;
            String regimeJson = redisTemplate.opsForValue().get(regimeKey);
            if (regimeJson != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> data = objectMapper.readValue(regimeJson, Map.class);
                return data;
            }
        } catch (Exception e) {
            log.debug("No regime data for {}", scripCode);
        }

        // Fallback: try global regime
        try {
            String globalRegime = redisTemplate.opsForValue().get("market:regime");
            if (globalRegime != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> data = objectMapper.readValue(globalRegime, Map.class);
                return data;
            }
        } catch (Exception e) {
            log.debug("No global regime data");
        }

        regime.put("regime", "UNKNOWN");
        regime.put("confidence", 0);
        return regime;
    }

    public Map<String, Object> getPrediction(String scripCode) {
        Map<String, Object> prediction = new LinkedHashMap<>();

        // Try ML service
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> result = restTemplate.getForObject(
                    mlServiceUrl + "/api/predict/" + scripCode, Map.class);
            if (result != null) {
                return result;
            }
        } catch (RestClientException e) {
            log.debug("Could not get prediction from ML service: {}", e.getMessage());
        }

        // Try Redis for cached prediction
        try {
            String predJson = redisTemplate.opsForValue().get("prediction:" + scripCode);
            if (predJson != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> cached = objectMapper.readValue(predJson, Map.class);
                return cached;
            }
        } catch (Exception e) {
            log.debug("No cached prediction for {}", scripCode);
        }

        prediction.put("scripCode", scripCode);
        prediction.put("available", false);
        prediction.put("message", "ML prediction not available");
        return prediction;
    }
}
