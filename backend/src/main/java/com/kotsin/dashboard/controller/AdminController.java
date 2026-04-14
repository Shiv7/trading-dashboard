package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.auth.UserResponse;
import com.kotsin.dashboard.model.entity.User;
import com.kotsin.dashboard.security.SidebarPage;
import com.kotsin.dashboard.service.SlippageBackfillService;
import com.kotsin.dashboard.service.UserProfileService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {

    private final UserProfileService profileService;
    private final SlippageBackfillService slippageBackfillService;

    public AdminController(UserProfileService profileService, SlippageBackfillService slippageBackfillService) {
        this.profileService = profileService;
        this.slippageBackfillService = slippageBackfillService;
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
    public ResponseEntity<?> updateRole(@PathVariable String userId,
                                         @RequestBody Map<String, String> body,
                                         @AuthenticationPrincipal UserDetails caller) {
        try {
            String callerId = profileService.findIdByUsername(caller.getUsername());
            return ResponseEntity.ok(profileService.updateUserRole(userId, body.get("role"), callerId));
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

    @GetMapping("/sidebar-pages")
    public ResponseEntity<?> getSidebarPages() {
        List<Map<String, String>> list = Arrays.stream(SidebarPage.values())
                .map(p -> Map.of("key", p.getKey(), "label", p.getLabel()))
                .toList();
        return ResponseEntity.ok(list);
    }

    @GetMapping("/users/{userId}/permissions")
    public ResponseEntity<?> getPermissions(@PathVariable String userId) {
        try {
            return ResponseEntity.ok(Map.of("allowedPages", profileService.getAllowedPages(userId)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/users/{userId}/permissions")
    public ResponseEntity<?> updatePermissions(@PathVariable String userId,
                                                @RequestBody Map<String, List<String>> body) {
        try {
            List<String> pages = body.getOrDefault("allowedPages", List.of());
            return ResponseEntity.ok(profileService.updateAllowedPages(userId, pages));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/backfill-slippage")
    public ResponseEntity<?> backfillSlippage() {
        try {
            int count = slippageBackfillService.backfillAll();
            return ResponseEntity.ok(Map.of(
                    "message", "Slippage backfill complete",
                    "tradesUpdated", count
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }
}
