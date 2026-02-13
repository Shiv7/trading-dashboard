package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.entity.Watchlist;
import com.kotsin.dashboard.service.WatchlistService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/watchlists")
public class WatchlistController {

    private final WatchlistService watchlistService;

    public WatchlistController(WatchlistService watchlistService) {
        this.watchlistService = watchlistService;
    }

    @GetMapping
    public ResponseEntity<List<Watchlist>> getWatchlists(Authentication auth) {
        return ResponseEntity.ok(watchlistService.getUserWatchlists((String) auth.getPrincipal()));
    }

    @PostMapping
    public ResponseEntity<?> createWatchlist(Authentication auth, @RequestBody Map<String, String> body) {
        try {
            Watchlist wl = watchlistService.createWatchlist((String) auth.getPrincipal(), body.get("name"));
            return ResponseEntity.ok(wl);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> renameWatchlist(Authentication auth, @PathVariable String id, @RequestBody Map<String, String> body) {
        try {
            Watchlist wl = watchlistService.renameWatchlist((String) auth.getPrincipal(), id, body.get("name"));
            return ResponseEntity.ok(wl);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteWatchlist(Authentication auth, @PathVariable String id) {
        try {
            watchlistService.deleteWatchlist((String) auth.getPrincipal(), id);
            return ResponseEntity.ok(Map.of("message", "Watchlist deleted"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/instruments")
    public ResponseEntity<?> addInstrument(Authentication auth, @PathVariable String id, @RequestBody Map<String, String> body) {
        try {
            Watchlist wl = watchlistService.addInstrument(
                    (String) auth.getPrincipal(), id,
                    body.get("scripCode"), body.get("symbol"), body.get("companyName"), body.get("exchange"));
            return ResponseEntity.ok(wl);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}/instruments/{scripCode}")
    public ResponseEntity<?> removeInstrument(Authentication auth, @PathVariable String id, @PathVariable String scripCode) {
        try {
            Watchlist wl = watchlistService.removeInstrument((String) auth.getPrincipal(), id, scripCode);
            return ResponseEntity.ok(wl);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{id}/instruments/reorder")
    public ResponseEntity<?> reorderInstruments(Authentication auth, @PathVariable String id, @RequestBody Map<String, List<String>> body) {
        try {
            Watchlist wl = watchlistService.reorderInstruments((String) auth.getPrincipal(), id, body.get("scripCodes"));
            return ResponseEntity.ok(wl);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
