package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.entity.Watchlist;
import com.kotsin.dashboard.model.entity.Watchlist.WatchlistInstrument;
import com.kotsin.dashboard.repository.WatchlistRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

@Service
public class WatchlistService {

    private static final Logger log = LoggerFactory.getLogger(WatchlistService.class);
    private static final int MAX_WATCHLISTS = 7;
    private static final int MAX_INSTRUMENTS = 50;

    private final WatchlistRepository watchlistRepository;

    public WatchlistService(WatchlistRepository watchlistRepository) {
        this.watchlistRepository = watchlistRepository;
    }

    public List<Watchlist> getUserWatchlists(String userId) {
        return watchlistRepository.findByUserIdOrderBySortOrder(userId);
    }

    public Watchlist createWatchlist(String userId, String name) {
        if (watchlistRepository.countByUserId(userId) >= MAX_WATCHLISTS) {
            throw new IllegalArgumentException("Maximum " + MAX_WATCHLISTS + " watchlists allowed");
        }

        Watchlist watchlist = Watchlist.builder()
                .userId(userId)
                .name(name)
                .sortOrder((int) watchlistRepository.countByUserId(userId))
                .instruments(new ArrayList<>())
                .isDefault(false)
                .createdAt(LocalDateTime.now())
                .build();

        return watchlistRepository.save(watchlist);
    }

    public Watchlist createDefaultWatchlist(String userId) {
        Watchlist watchlist = Watchlist.builder()
                .userId(userId)
                .name("My Watchlist")
                .sortOrder(0)
                .instruments(new ArrayList<>())
                .isDefault(true)
                .createdAt(LocalDateTime.now())
                .build();

        return watchlistRepository.save(watchlist);
    }

    public Watchlist renameWatchlist(String userId, String watchlistId, String name) {
        Watchlist wl = watchlistRepository.findByIdAndUserId(watchlistId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Watchlist not found"));
        wl.setName(name);
        wl.setUpdatedAt(LocalDateTime.now());
        return watchlistRepository.save(wl);
    }

    public void deleteWatchlist(String userId, String watchlistId) {
        Watchlist wl = watchlistRepository.findByIdAndUserId(watchlistId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Watchlist not found"));
        if (wl.isDefault()) {
            throw new IllegalArgumentException("Cannot delete default watchlist");
        }
        watchlistRepository.delete(wl);
        log.info("Deleted watchlist '{}' for user {}", wl.getName(), userId);
    }

    public Watchlist addInstrument(String userId, String watchlistId,
                                    String scripCode, String symbol, String companyName, String exchange) {
        Watchlist wl = watchlistRepository.findByIdAndUserId(watchlistId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Watchlist not found"));

        if (wl.getInstruments().size() >= MAX_INSTRUMENTS) {
            throw new IllegalArgumentException("Maximum " + MAX_INSTRUMENTS + " instruments per watchlist");
        }

        boolean exists = wl.getInstruments().stream()
                .anyMatch(i -> i.getScripCode().equals(scripCode));
        if (exists) {
            throw new IllegalArgumentException("Instrument already in watchlist");
        }

        WatchlistInstrument instrument = WatchlistInstrument.builder()
                .scripCode(scripCode)
                .symbol(symbol)
                .companyName(companyName)
                .exchange(exchange)
                .addedAt(LocalDateTime.now())
                .sortOrder(wl.getInstruments().size())
                .build();

        wl.getInstruments().add(instrument);
        wl.setUpdatedAt(LocalDateTime.now());
        return watchlistRepository.save(wl);
    }

    public Watchlist removeInstrument(String userId, String watchlistId, String scripCode) {
        Watchlist wl = watchlistRepository.findByIdAndUserId(watchlistId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Watchlist not found"));

        wl.getInstruments().removeIf(i -> i.getScripCode().equals(scripCode));
        wl.setUpdatedAt(LocalDateTime.now());
        return watchlistRepository.save(wl);
    }

    public Watchlist reorderInstruments(String userId, String watchlistId, List<String> scripCodes) {
        Watchlist wl = watchlistRepository.findByIdAndUserId(watchlistId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Watchlist not found"));

        List<WatchlistInstrument> reordered = new ArrayList<>();
        IntStream.range(0, scripCodes.size()).forEach(i -> {
            wl.getInstruments().stream()
                    .filter(inst -> inst.getScripCode().equals(scripCodes.get(i)))
                    .findFirst()
                    .ifPresent(inst -> {
                        inst.setSortOrder(i);
                        reordered.add(inst);
                    });
        });
        wl.setInstruments(reordered);
        wl.setUpdatedAt(LocalDateTime.now());
        return watchlistRepository.save(wl);
    }
}
