package com.kotsin.dashboard.hotstocks.data;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kotsin.dashboard.hotstocks.model.CorporateEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * DEPRECATED (2026-04-11) — replaced by {@link MarketPulseRedisClient} which reads
 * pre-populated keys published by FastAnalytics (nse_market_pulse_service.py).
 *
 * Kept for reference; re-enable by re-adding @Component if the FastAnalytics
 * pipeline becomes unavailable or this scraper path is needed as a fallback.
 *
 * Historical note: works against archives.nseindia.com (not behind Akamai),
 * but NseBhavcopyClient + NseDealArchiveClient archive URLs have moved over time
 * and CorporateEventsClient's www.nseindia.com/api/* endpoint is blocked from
 * AWS/datacenter IPs by Akamai Bot Manager.
 */
@Deprecated
public class CorporateEventsClient {
    private static final Logger log = LoggerFactory.getLogger(CorporateEventsClient.class);
    private static final DateTimeFormatter DD_MMM_YYYY = DateTimeFormatter.ofPattern("dd-MMM-yyyy");

    private final RestTemplate rest = new RestTemplate();
    private final ObjectMapper mapper = new ObjectMapper();

    public List<CorporateEvent> fetchUpcoming(LocalDate from, LocalDate to) {
        String url = String.format(
            "https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=%s&to_date=%s",
            from.format(DD_MMM_YYYY), to.format(DD_MMM_YYYY));
        HttpHeaders h = new HttpHeaders();
        h.set("User-Agent", "Mozilla/5.0");
        h.set("Accept", "application/json");
        HttpEntity<String> entity = new HttpEntity<>(h);

        List<CorporateEvent> out = new ArrayList<>();
        try {
            ResponseEntity<String> resp = rest.exchange(url, HttpMethod.GET, entity, String.class);
            String body = resp.getBody();
            if (body == null) return out;
            JsonNode root = mapper.readTree(body);
            for (JsonNode node : root) {
                String symbol = node.path("symbol").asText();
                String purpose = node.path("subject").asText().toUpperCase();
                String exDate = node.path("exDate").asText();
                if (exDate.isEmpty()) continue;
                LocalDate d;
                try {
                    d = LocalDate.parse(exDate, DD_MMM_YYYY);
                } catch (Exception ex) {
                    continue;
                }
                String type;
                if (purpose.contains("DIVIDEND")) type = "DIVIDEND";
                else if (purpose.contains("SPLIT") || purpose.contains("SUB-DIV")) type = "SPLIT";
                else if (purpose.contains("BONUS")) type = "BONUS";
                else if (purpose.contains("AGM")) type = "AGM";
                else continue;
                out.add(new CorporateEvent(symbol, type, d, purpose));
            }
        } catch (Exception e) {
            log.warn("Corporate events fetch failed: {}", e.getMessage());
        }
        return out;
    }
}
