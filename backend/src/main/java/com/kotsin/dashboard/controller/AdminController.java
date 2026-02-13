package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.auth.UserResponse;
import com.kotsin.dashboard.model.entity.User;
import com.kotsin.dashboard.service.UserProfileService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {

    private final UserProfileService profileService;

    public AdminController(UserProfileService profileService) {
        this.profileService = profileService;
    }

    @GetMapping("/users")
    public ResponseEntity<?> getUsers(@RequestParam(defaultValue = "0") int page,
                                       @RequestParam(defaultValue = "20") int size) {
        Page<User> users = profileService.getAllUsers(
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        return ResponseEntity.ok(Map.of(
                "content", users.getContent().stream().map(UserResponse::fromUser).toList(),
                "totalElements", users.getTotalElements(),
                "totalPages", users.getTotalPages()
        ));
    }

    @PutMapping("/users/{userId}/role")
    public ResponseEntity<?> updateRole(@PathVariable String userId, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(profileService.updateUserRole(userId, body.get("role")));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/users/{userId}/enable")
    public ResponseEntity<?> toggleEnabled(@PathVariable String userId, @RequestBody Map<String, Boolean> body) {
        try {
            return ResponseEntity.ok(profileService.toggleUserEnabled(userId, body.getOrDefault("enabled", true)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/users/{userId}")
    public ResponseEntity<?> deleteUser(@PathVariable String userId) {
        try {
            profileService.deleteUser(userId);
            return ResponseEntity.ok(Map.of("message", "User deleted"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
