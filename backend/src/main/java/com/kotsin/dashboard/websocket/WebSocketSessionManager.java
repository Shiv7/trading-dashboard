package com.kotsin.dashboard.websocket;

import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Manages WebSocket sessions and provides methods for broadcasting messages.
 * Tracks subscriptions to enable targeted message delivery.
 */
@Component
@Slf4j
public class WebSocketSessionManager {

    private final SimpMessagingTemplate messagingTemplate;
    
    // Track which scripCodes users are subscribed to
    private final Map<String, Set<String>> scripCodeSubscriptions = new ConcurrentHashMap<>();

    public WebSocketSessionManager(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Broadcast to all clients subscribed to wallet updates
     */
    public void broadcastWalletUpdate(Object payload) {
        log.debug("Broadcasting wallet update");
        messagingTemplate.convertAndSend("/topic/wallet", payload);
    }

    /**
     * Broadcast to all clients subscribed to a specific stock's scores
     */
    public void broadcastScoreUpdate(String scripCode, Object payload) {
        log.debug("Broadcasting score update for {}", scripCode);
        messagingTemplate.convertAndSend("/topic/scores/" + scripCode, payload);
        // Also broadcast to the "all scores" topic
        messagingTemplate.convertAndSend("/topic/scores", payload);
    }

    /**
     * Broadcast new signal to all clients
     */
    public void broadcastSignal(Object payload) {
        log.debug("Broadcasting new signal");
        messagingTemplate.convertAndSend("/topic/signals", payload);
    }

    /**
     * Broadcast regime update
     */
    public void broadcastRegimeUpdate(Object payload) {
        log.debug("Broadcasting regime update");
        messagingTemplate.convertAndSend("/topic/regime", payload);
    }

    /**
     * Broadcast trade update (new trade, status change, close)
     */
    public void broadcastTradeUpdate(Object payload) {
        log.debug("Broadcasting trade update");
        messagingTemplate.convertAndSend("/topic/trades", payload);
    }

    /**
     * Broadcast position update for a specific stock
     */
    public void broadcastPositionUpdate(String scripCode, Object payload) {
        log.debug("Broadcasting position update for {}", scripCode);
        messagingTemplate.convertAndSend("/topic/positions/" + scripCode, payload);
        messagingTemplate.convertAndSend("/topic/positions", payload);
    }

    /**
     * Send a notification/alert to all clients
     */
    public void broadcastNotification(String type, String message) {
        log.info("Broadcasting notification: {} - {}", type, message);
        messagingTemplate.convertAndSend("/topic/notifications", 
            Map.of("type", type, "message", message, "timestamp", System.currentTimeMillis()));
    }

    /**
     * Register a subscription for a scripCode
     */
    public void registerSubscription(String sessionId, String scripCode) {
        scripCodeSubscriptions
            .computeIfAbsent(scripCode, k -> ConcurrentHashMap.newKeySet())
            .add(sessionId);
        log.debug("Session {} subscribed to {}", sessionId, scripCode);
    }

    /**
     * Remove all subscriptions for a session
     */
    public void removeSession(String sessionId) {
        scripCodeSubscriptions.values().forEach(sessions -> sessions.remove(sessionId));
        log.debug("Removed session {}", sessionId);
    }

    /**
     * Check if anyone is subscribed to a scripCode
     */
    public boolean hasSubscribers(String scripCode) {
        Set<String> subscribers = scripCodeSubscriptions.get(scripCode);
        return subscribers != null && !subscribers.isEmpty();
    }
}

