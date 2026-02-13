package com.kotsin.dashboard.repository;

import com.kotsin.dashboard.model.entity.Watchlist;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface WatchlistRepository extends MongoRepository<Watchlist, String> {
    List<Watchlist> findByUserIdOrderBySortOrder(String userId);
    Optional<Watchlist> findByIdAndUserId(String id, String userId);
    long countByUserId(String userId);
}
