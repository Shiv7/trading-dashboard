package com.kotsin.dashboard.hotstocks.data;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

@Configuration
public class HotStocksHttpConfig {

    /**
     * Shared RestTemplate used by FivePaisaHistoryClient and StrategyCrossReferenceClient.
     * 5s connect timeout prevents hang on DNS/network failure.
     * 300s read timeout accommodates the 05:45 IST bulk 5paisa fetch for ~217 F&O stocks,
     * which processes sequentially in FastAnalytics and can take 45–90s on a warm cache.
     */
    @Bean
    public RestTemplate hotStocksRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) Duration.ofSeconds(5).toMillis());
        factory.setReadTimeout((int) Duration.ofSeconds(300).toMillis());
        return new RestTemplate(factory);
    }
}
