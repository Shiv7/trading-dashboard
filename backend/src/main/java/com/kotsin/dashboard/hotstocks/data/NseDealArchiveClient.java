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
public class NseDealArchiveClient {
    private static final Logger log = LoggerFactory.getLogger(NseDealArchiveClient.class);
    private static final DateTimeFormatter DDMMYY = DateTimeFormatter.ofPattern("ddMMyy");
    private final RestTemplate rest = new RestTemplate();

    public record Deal(
        LocalDate date,
        String symbol,
        String clientName,
        String buySell,     // "BUY" or "SELL"
        long quantity,
        double price,
        boolean isBlock     // true=block, false=bulk
    ) {}

    public List<Deal> fetchBulkDeals(LocalDate date) {
        return fetchDeals(date, false);
    }

    public List<Deal> fetchBlockDeals(LocalDate date) {
        return fetchDeals(date, true);
    }

    private List<Deal> fetchDeals(LocalDate date, boolean block) {
        String kind = block ? "block" : "bulk";
        String url = String.format("https://archives.nseindia.com/content/equities/%s_%s.csv",
            kind, date.format(DDMMYY));
        HttpHeaders h = new HttpHeaders();
        h.set("User-Agent", "Mozilla/5.0");
        HttpEntity<String> entity = new HttpEntity<>(h);

        List<Deal> out = new ArrayList<>();
        try {
            ResponseEntity<String> resp = rest.exchange(url, HttpMethod.GET, entity, String.class);
            String body = resp.getBody();
            if (body == null) return out;
            String[] lines = body.split("\n");
            for (int i = 1; i < lines.length; i++) {
                String[] cols = parseCsvLine(lines[i]);
                if (cols.length < 7) continue;
                try {
                    out.add(new Deal(date, cols[1].trim(), cols[3].trim(),
                        cols[4].trim().toUpperCase().startsWith("B") ? "BUY" : "SELL",
                        Long.parseLong(cols[5].trim().replace(",", "")),
                        Double.parseDouble(cols[6].trim().replace(",", "")),
                        block));
                } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            log.warn("{} deals fetch failed for {}: {}", kind, date, e.getMessage());
        }
        return out;
    }

    private String[] parseCsvLine(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;
        for (char c : line.toCharArray()) {
            if (c == '"') inQuotes = !inQuotes;
            else if (c == ',' && !inQuotes) { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        out.add(cur.toString());
        return out.toArray(new String[0]);
    }
}
