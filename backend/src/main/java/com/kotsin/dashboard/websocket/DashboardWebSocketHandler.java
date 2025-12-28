package com.kotsin.dashboard.websocket;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SubscribeMapping;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Map;

/**
 * WebSocket message handler for dashboard.
 * Handles client subscriptions and messages.
 */
@Controller
@Slf4j
@RequiredArgsConstructor
public class DashboardWebSocketHandler {

    private final WebSocketSessionManager sessionManager;

    /**
     * Called when a client connects
     */
    @EventListener
    public void handleSessionConnected(SessionConnectedEvent event) {
        String sessionId = event.getMessage().getHeaders().get("simpSessionId", String.class);
        log.info("WebSocket client connected: {}", sessionId);
    }

    /**
     * Called when a client disconnects
     */
    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        String sessionId = event.getSessionId();
        sessionManager.removeSession(sessionId);
        log.info("WebSocket client disconnected: {}", sessionId);
    }

    /**
     * Handle subscription to scores for a specific stock
     */
    @SubscribeMapping("/scores/{scripCode}")
    public void subscribeToScores(@DestinationVariable String scripCode, 
                                   SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        sessionManager.registerSubscription(sessionId, scripCode);
        log.info("Client {} subscribed to scores for {}", sessionId, scripCode);
    }

    /**
     * Handle ping from client (keep-alive)
     */
    @MessageMapping("/ping")
    public void handlePing(SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        log.debug("Ping received from {}", sessionId);
        // Could respond with pong if needed
    }

    /**
     * Handle watchlist update from client
     */
    @MessageMapping("/watchlist/add")
    public void addToWatchlist(Map<String, String> payload, 
                                SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        String scripCode = payload.get("scripCode");
        if (scripCode != null) {
            sessionManager.registerSubscription(sessionId, scripCode);
            log.info("Client {} added {} to watchlist", sessionId, scripCode);
        }
    }
}

