package com.kotsin.dashboard.model.dto.auth;

import com.kotsin.dashboard.model.entity.User;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserResponse {
    private String id;
    private String username;
    private String email;
    private String displayName;
    private String role;
    private boolean enabled;
    private String createdAt;
    private String lastLoginAt;
    private User.UserPreferences preferences;
    private java.util.List<String> allowedPages;

    public static UserResponse fromUser(User user) {
        return UserResponse.builder()
                .id(user.getId())
                .username(user.getUsername())
                .email(user.getEmail())
                .displayName(user.getDisplayName())
                .role(user.getRole())
                .enabled(user.isEnabled())
                .createdAt(user.getCreatedAt() != null ? user.getCreatedAt().toString() : null)
                .lastLoginAt(user.getLastLoginAt() != null ? user.getLastLoginAt().toString() : null)
                .preferences(user.getPreferences())
                .allowedPages(user.getAllowedPages() != null ? user.getAllowedPages() : java.util.List.of())
                .build();
    }
}
