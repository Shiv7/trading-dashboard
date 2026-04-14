package com.kotsin.dashboard.config;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.Arrays;
import java.util.List;

/**
 * CORS configuration for dashboard API.
 * Allows React frontend to communicate with backend.
 *
 * Regression-prevention: startup log dumps the full allowed-origin list, and a
 * self-check at ApplicationReadyEvent time curls the server's own /api/auth/login
 * endpoint with each "known public" Origin header. Any origin that returns a
 * CORS 403 is logged with ERROR so it's impossible to silently ship a deployment
 * whose public hostname isn't in the allow-list.
 */
@Configuration
public class CorsConfig {
    private static final Logger log = LoggerFactory.getLogger(CorsConfig.class);

    /** Public origins this server is expected to serve from — must all pass the self-check. */
    private static final List<String> PUBLIC_ORIGINS_TO_VERIFY = List.of(
        "http://13.204.237.230:3001",
        "https://13.204.237.230:3001",
        "http://kotsin.in",
        "https://kotsin.in"
    );

    @Value("${cors.allowed-origins:http://localhost:*,http://127.0.0.1:*}")
    private String allowedOrigins;

    @Value("${server.port:8085}")
    private int serverPort;

    @PostConstruct
    public void logAllowedOriginsAtStartup() {
        log.info("[CORS] Allowed origins (from cors.allowed-origins): {}", allowedOrigins);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void verifyPublicOriginsAfterStartup() {
        RestTemplate rest = new RestTemplate();
        int failed = 0;
        for (String origin : PUBLIC_ORIGINS_TO_VERIFY) {
            try {
                HttpHeaders headers = new HttpHeaders();
                headers.setOrigin(origin);
                headers.setAccessControlRequestMethod(HttpMethod.POST);
                headers.set("Access-Control-Request-Headers", "content-type");
                org.springframework.http.HttpEntity<Void> req = new org.springframework.http.HttpEntity<>(headers);
                ResponseEntity<String> resp = rest.exchange(
                    "http://localhost:" + serverPort + "/api/auth/login",
                    HttpMethod.OPTIONS,
                    req,
                    String.class);
                if (resp.getStatusCode().is2xxSuccessful()) {
                    log.info("[CORS] self-check OK for origin: {}", origin);
                } else {
                    log.error("[CORS] self-check FAILED for origin: {} → status={}. " +
                        "Add this origin to cors.allowed-origins in application.properties.",
                        origin, resp.getStatusCode());
                    failed++;
                }
            } catch (Exception e) {
                log.error("[CORS] self-check FAILED for origin: {} → {}. " +
                    "The login page from this origin will return 403 in the browser. " +
                    "Add the origin to cors.allowed-origins.",
                    origin, e.getMessage());
                failed++;
            }
        }
        if (failed > 0) {
            log.error("[CORS] {} public origin(s) are NOT in the allow-list. Login will 403 " +
                "from those hostnames. Fix: edit backend/src/main/resources/application.properties " +
                "cors.allowed-origins, then restart the backend.", failed);
        } else {
            log.info("[CORS] self-check passed: all {} public origins allowed",
                PUBLIC_ORIGINS_TO_VERIFY.size());
        }
    }

    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration config = new CorsConfiguration();

        // Allow frontend origins from config
        config.setAllowedOriginPatterns(
            Arrays.asList(allowedOrigins.split(","))
        );

        // Allow common HTTP methods
        config.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));

        // Allow common headers
        config.setAllowedHeaders(Arrays.asList(
            "Authorization",
            "Content-Type",
            "X-Requested-With",
            "Accept",
            "Origin"
        ));

        // Allow credentials (cookies, auth headers)
        config.setAllowCredentials(true);

        // Cache preflight response for 1 hour
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        source.registerCorsConfiguration("/ws/**", config);

        return new CorsFilter(source);
    }
}
