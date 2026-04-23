package com.kotsin.dashboard.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.CorsFilter;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthFilter;
    private final CorsFilter corsFilter;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthFilter, CorsFilter corsFilter) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.corsFilter = corsFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .addFilterBefore(corsFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
            .authorizeHttpRequests(auth -> auth
                // Public endpoints
                .requestMatchers("/api/auth/**").permitAll()
                .requestMatchers("/ws/**").permitAll()
                .requestMatchers("/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                .requestMatchers("/actuator/**").permitAll()
                // Read-only market data endpoints - public for dashboard display
                .requestMatchers("/api/scores/**").permitAll()
                .requestMatchers("/api/quant-scores/**").permitAll()
                .requestMatchers("/api/indicators/**").permitAll()
                .requestMatchers("/api/signals/**").permitAll()
                .requestMatchers("/api/candles/**").permitAll()
                .requestMatchers("/api/patterns/**").permitAll()
                .requestMatchers("/technical-indicators/**").permitAll()
                .requestMatchers("/api/strategy-state/**").permitAll()
                .requestMatchers("/api/signal-audit/**").permitAll()
                .requestMatchers("/api/ws-audit/**").permitAll()
                .requestMatchers("/api/monday-ship/**").permitAll()
                .requestMatchers("/api/strategy-wallets/**").permitAll()
                .requestMatchers("/api/counter-trend/**").permitAll()
                .requestMatchers("/api/f14/**").permitAll()
                .requestMatchers("/api/live/**").permitAll()
                .requestMatchers("/api/wallet/**").permitAll()
                .requestMatchers("/api/strategy-trades/**").permitAll()
                .requestMatchers("/api/orders/**").permitAll()
                .requestMatchers("/api/positions/**").permitAll()
                .requestMatchers("/api/ml/**").permitAll()
                .requestMatchers("/api/risk/**").permitAll()
                .requestMatchers("/api/market-data/**").permitAll()
                .requestMatchers("/api/market-pulse/**").permitAll()
                .requestMatchers("/api/hot-stocks/**").permitAll()
                .requestMatchers("/api/greeks/**").permitAll()
                .requestMatchers("/api/greek-trailing/**").permitAll()
                .requestMatchers("/api/pnl/**").permitAll()
                .requestMatchers("/api/wallets/**").permitAll()
                .requestMatchers("/api/state/**").permitAll()
                .requestMatchers("/api/watchlists/**").authenticated()  // user-specific, needs auth token
                .requestMatchers("/api/trades/**").permitAll()
                .requestMatchers("/api/performance/**").permitAll()
                .requestMatchers("/api/alerts/**").permitAll()
                .requestMatchers("/api/analysis/**").permitAll()
                .requestMatchers("/api/slippage/**").permitAll()
                .requestMatchers("/api/stock/**").permitAll()
                .requestMatchers("/api/health-check/**").permitAll()
                // Admin-only
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                // All other API endpoints require authentication
                .requestMatchers("/api/**").authenticated()
                // Allow everything else (static resources)
                .anyRequest().permitAll()
            );

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
