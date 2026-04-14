package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.dto.auth.UserResponse;
import com.kotsin.dashboard.model.entity.User;
import com.kotsin.dashboard.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
public class UserProfileService {

    private static final Logger log = LoggerFactory.getLogger(UserProfileService.class);

    private final UserRepository userRepository;

    public UserProfileService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public UserResponse getProfile(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        return UserResponse.fromUser(user);
    }

    public UserResponse updateProfile(String userId, String displayName, String email) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        if (displayName != null) user.setDisplayName(displayName);
        if (email != null && !email.equals(user.getEmail())) {
            if (userRepository.existsByEmail(email)) {
                throw new IllegalArgumentException("Email already in use");
            }
            user.setEmail(email);
        }
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
        return UserResponse.fromUser(user);
    }

    public UserResponse updatePreferences(String userId, User.UserPreferences preferences) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setPreferences(preferences);
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
        return UserResponse.fromUser(user);
    }

    public UserResponse updateNotifications(String userId, User.NotificationSettings settings) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        if (user.getPreferences() == null) {
            user.setPreferences(User.UserPreferences.builder().notificationSettings(settings).build());
        } else {
            user.getPreferences().setNotificationSettings(settings);
        }
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
        return UserResponse.fromUser(user);
    }

    // Admin methods
    public Page<User> getAllUsers(Pageable pageable) {
        return userRepository.findAll(pageable);
    }

    public UserResponse updateUserRole(String userId, String role, String callerUserId) {
        if (userId.equals(callerUserId) && !"ADMIN".equals(role)) {
            throw new IllegalArgumentException("Cannot change your own admin role");
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setRole(role);
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
        log.info("Updated role for user {} to {}", user.getUsername(), role);
        return UserResponse.fromUser(user);
    }

    public UserResponse updateAllowedPages(String userId, java.util.List<String> pages) {
        java.util.Set<String> valid = com.kotsin.dashboard.security.SidebarPage.allKeys();
        for (String p : pages) {
            if (!valid.contains(p)) {
                throw new IllegalArgumentException("Unknown page key: " + p);
            }
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setAllowedPages(new java.util.ArrayList<>(pages));
        user.setUpdatedAt(java.time.LocalDateTime.now());
        userRepository.save(user);
        log.info("Updated allowedPages for user {} to {}", user.getUsername(), pages);
        return UserResponse.fromUser(user);
    }

    public java.util.List<String> getAllowedPages(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        return user.getAllowedPages() != null ? user.getAllowedPages() : java.util.List.of();
    }

    public UserResponse toggleUserEnabled(String userId, boolean enabled) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setEnabled(enabled);
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
        log.info("User {} enabled={}", user.getUsername(), enabled);
        return UserResponse.fromUser(user);
    }

    public String findIdByUsername(String username) {
        return userRepository.findByUsername(username)
                .map(User::getId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + username));
    }

    public void deleteUser(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        if ("ADMIN".equals(user.getRole())) {
            throw new IllegalArgumentException("Cannot delete admin user");
        }
        userRepository.deleteById(userId);
        log.info("Deleted user: {}", user.getUsername());
    }
}
