package com.kotsin.dashboard.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

/**
 * Configuration for connecting to TradeExecutionModule (port 8089).
 */
@Configuration
public class ExecutionServiceConfig {

    @Value("${execution.service.timeout:5000}")
    private int timeout;

    /**
     * RestTemplate bean configured for execution service calls.
     * Includes timeout settings for reliable proxy behavior.
     */
    @Bean(name = "executionRestTemplate")
    @org.springframework.context.annotation.Primary
    public RestTemplate executionRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(timeout);
        factory.setReadTimeout(timeout);
        return new RestTemplate(factory);
    }

    /**
     * RestTemplate for ML proxy calls — longer timeout for model training/loading.
     */
    @Bean(name = "mlRestTemplate")
    public RestTemplate mlRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(120000); // 2 min for ML training
        return new RestTemplate(factory);
    }
}
