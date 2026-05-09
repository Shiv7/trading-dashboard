package com.kotsin.dashboard.pivotboss;

import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.time.Instant;
import java.util.List;

public interface BasketAuditRepository extends MongoRepository<BasketAuditDoc, String> {

    List<BasketAuditDoc> findByStrategyAndCreatedAtBetween(
            String strategy, Instant from, Instant to, Pageable pageable);

    List<BasketAuditDoc> findByStrategyAndPathAndCreatedAtBetween(
            String strategy, String path, Instant from, Instant to, Pageable pageable);
}
