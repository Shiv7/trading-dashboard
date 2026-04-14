package com.kotsin.dashboard.hotstocks.data;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;

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
public class NseBhavcopyClient {
    private static final Logger log = LoggerFactory.getLogger(NseBhavcopyClient.class);
    private static final DateTimeFormatter DDMMYYYY = DateTimeFormatter.ofPattern("ddMMyyyy");
    private final RestTemplate rest = new RestTemplate();

    /** Returns map symbol → delivery % for the given trading date. Empty map on failure. */
    public Map<String, Double> fetchDeliveryPct(LocalDate date) {
        String url = String.format(
            "https://archives.nseindia.com/products/content/sec_bhavdata_full_%s.csv",
            date.format(DDMMYYYY));
        HttpHeaders headers = new HttpHeaders();
        headers.set("User-Agent", "Mozilla/5.0");
        HttpEntity<String> entity = new HttpEntity<>(headers);

        Map<String, Double> out = new HashMap<>();
        try {
            ResponseEntity<String> resp = rest.exchange(url, HttpMethod.GET, entity, String.class);
            String body = resp.getBody();
            if (body == null) return out;
            String[] lines = body.split("\n");
            if (lines.length < 2) return out;

            // CSV columns: SYMBOL, SERIES, ..., DELIV_PER
            String[] header = lines[0].split(",");
            int symbolIdx = -1, seriesIdx = -1, delivIdx = -1;
            for (int i = 0; i < header.length; i++) {
                String h = header[i].trim();
                if ("SYMBOL".equalsIgnoreCase(h)) symbolIdx = i;
                else if ("SERIES".equalsIgnoreCase(h)) seriesIdx = i;
                else if ("DELIV_PER".equalsIgnoreCase(h)) delivIdx = i;
            }
            if (symbolIdx < 0 || delivIdx < 0) return out;

            for (int i = 1; i < lines.length; i++) {
                String[] cols = lines[i].split(",");
                if (cols.length <= Math.max(symbolIdx, delivIdx)) continue;
                if (seriesIdx >= 0 && !"EQ".equalsIgnoreCase(cols[seriesIdx].trim())) continue;
                try {
                    double deliv = Double.parseDouble(cols[delivIdx].trim());
                    out.put(cols[symbolIdx].trim(), deliv);
                } catch (NumberFormatException ignored) {}
            }
        } catch (Exception e) {
            log.warn("Bhavcopy fetch failed for {}: {}", date, e.getMessage());
        }
        return out;
    }
}
