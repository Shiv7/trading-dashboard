package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.model.dto.PositionDTO;
import com.kotsin.dashboard.model.dto.WalletDTO;
import com.kotsin.dashboard.service.WalletService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST controller for wallet and position endpoints.
 */
@RestController
@RequestMapping("/api/wallet")
@RequiredArgsConstructor
public class WalletController {

    private final WalletService walletService;

    /**
     * Get current wallet state
     */
    @GetMapping
    public ResponseEntity<WalletDTO> getWallet() {
        return ResponseEntity.ok(walletService.getWallet());
    }

    /**
     * Get all positions
     */
    @GetMapping("/positions")
    public ResponseEntity<List<PositionDTO>> getPositions() {
        return ResponseEntity.ok(walletService.getPositions());
    }

    /**
     * Get open positions only
     */
    @GetMapping("/positions/open")
    public ResponseEntity<List<PositionDTO>> getOpenPositions() {
        return ResponseEntity.ok(walletService.getOpenPositions());
    }

    /**
     * Force refresh wallet from database
     */
    @PostMapping("/refresh")
    public ResponseEntity<WalletDTO> refreshWallet() {
        walletService.refreshWallet();
        return ResponseEntity.ok(walletService.getWallet());
    }
}

