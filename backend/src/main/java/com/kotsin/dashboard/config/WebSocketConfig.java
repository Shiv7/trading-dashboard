package com.kotsin.dashboard.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

/**
 * WebSocket configuration using STOMP protocol.
 * Enables real-time bidirectional communication between dashboard and backend.
 * 
 * BUG-007 FIX: Increased buffer limits to prevent SessionLimitExceededException
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Enable a simple in-memory message broker for topics
        // Clients subscribe to /topic/* destinations
        config.enableSimpleBroker("/topic");
        
        // Prefix for messages FROM clients TO server
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // WebSocket endpoint - clients connect here
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS(); // Fallback for browsers without WebSocket support
    }
    
    /**
     * BUG-007 FIX: Configure larger message and buffer limits
     * Previous limit: 524288 (512KB) - caused SessionLimitExceededException
     * New limit: 2MB for messages, 4MB for send buffer
     */
    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.setMessageSizeLimit(2 * 1024 * 1024);      // 2MB message size limit
        registration.setSendBufferSizeLimit(4 * 1024 * 1024);   // 4MB send buffer
        registration.setSendTimeLimit(30 * 1000);                // 30 second send timeout
    }
}

