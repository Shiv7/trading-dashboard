package com.kotsin.dashboard.hotstocks.data;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.metrics.DailyCandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class FivePaisaHistoryClient {
    private static final Logger log = LoggerFactory.getLogger(FivePaisaHistoryClient.class);

    private final RestTemplate rest;
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${fastanalytics.base-url:http://localhost:8002}")
    private String baseUrl;

    public FivePaisaHistoryClient(@Qualifier("hotStocksRestTemplate") RestTemplate rest) {
        this.rest = rest;
    }

    public Map<String, List<DailyCandle>> fetchBulk(String exch, String exchType,
                                                    List<String> scripCodes,
                                                    LocalDate startDate, LocalDate endDate) {
        Map<String, Object> body = new HashMap<>();
        body.put("exch", exch);
        body.put("exch_type", exchType);
        body.put("scrip_codes", scripCodes);
        body.put("start_date", startDate.toString());
        body.put("end_date", endDate.toString());
        body.put("interval", "1d");

        String url = baseUrl + "/getBulkHisDataFromFivePaisa";
        Map<String, List<DailyCandle>> out = new HashMap<>();
        try {
            String response = rest.postForObject(url, body, String.class);
            JsonNode root = mapper.readTree(response);
            JsonNode candlesNode = root.path("candles");
            candlesNode.fields().forEachRemaining(entry -> {
                String sc = entry.getKey();
                List<DailyCandle> list = new ArrayList<>();
                for (JsonNode c : entry.getValue()) {
                    LocalDate d = LocalDate.parse(c.path("Datetime").asText().substring(0, 10));
                    list.add(new DailyCandle(
                        d,
                        c.path("Open").asDouble(),
                        c.path("High").asDouble(),
                        c.path("Low").asDouble(),
                        c.path("Close").asDouble(),
                        c.path("Volume").asLong()
                    ));
                }
                out.put(sc, list);
            });
        } catch (Exception e) {
            log.error("Failed to fetch bulk history: {}", e.getMessage(), e);
        }
        return out;
    }
}
