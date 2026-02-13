package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.auth.UserResponse;
import com.kotsin.dashboard.model.entity.User;
import com.kotsin.dashboard.service.UserProfileService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/profile")
public class UserProfileController {

    private final UserProfileService profileService;

    public UserProfileController(UserProfileService profileService) {
        this.profileService = profileService;
    }

    @GetMapping
    public ResponseEntity<UserResponse> getProfile(Authentication auth) {
        return ResponseEntity.ok(profileService.getProfile((String) auth.getPrincipal()));
    }

    @PutMapping
    public ResponseEntity<?> updateProfile(Authentication auth, @RequestBody Map<String, String> body) {
        try {
            UserResponse user = profileService.updateProfile(
                    (String) auth.getPrincipal(),
                    body.get("displayName"),
                    body.get("email")
            );
            return ResponseEntity.ok(user);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/preferences")
    public ResponseEntity<UserResponse> updatePreferences(Authentication auth,
                                                           @RequestBody User.UserPreferences preferences) {
        return ResponseEntity.ok(profileService.updatePreferences((String) auth.getPrincipal(), preferences));
    }

    @PutMapping("/notifications")
    public ResponseEntity<UserResponse> updateNotifications(Authentication auth,
                                                             @RequestBody User.NotificationSettings settings) {
        return ResponseEntity.ok(profileService.updateNotifications((String) auth.getPrincipal(), settings));
    }
}
