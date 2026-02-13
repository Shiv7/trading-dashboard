package com.kotsin.dashboard.model.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "users")
public class User {

    @Id
    private String id;

    @Indexed(unique = true)
    private String username;

    @Indexed(unique = true)
    private String email;

    private String passwordHash;

    private String displayName;

    @Builder.Default
    private String role = "TRADER"; // ADMIN, TRADER, VIEWER

    @Builder.Default
    private boolean enabled = true;

    private UserPreferences preferences;

    private BrokerConfig brokerConfig;

    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    private LocalDateTime updatedAt;

    private LocalDateTime lastLoginAt;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UserPreferences {
        @Builder.Default
        private String timezone = "Asia/Kolkata";
        @Builder.Default
        private int defaultLotSize = 1;
        @Builder.Default
        private String riskTolerance = "MODERATE"; // LOW, MODERATE, HIGH
        private java.util.List<String> preferredInstruments;
        private NotificationSettings notificationSettings;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NotificationSettings {
        @Builder.Default
        private boolean telegram = false;
        @Builder.Default
        private boolean email = false;
        @Builder.Default
        private boolean inApp = true;
        private String telegramChatId;
        private String emailAddress;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BrokerConfig {
        @Builder.Default
        private String provider = "5PAISA";
        private String apiKeyEncrypted;
        private String secretEncrypted;
        @Builder.Default
        private boolean active = false;
    }
}
