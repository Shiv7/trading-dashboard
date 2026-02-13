package com.kotsin.dashboard.repository;

import com.kotsin.dashboard.model.entity.PaperTrade;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public interface PaperTradeRepository extends MongoRepository<PaperTrade, String> {

    List<PaperTrade> findByStatusOrderByCreatedAtDesc(String status);

    List<PaperTrade> findByStatusAndExitTimeBetweenOrderByExitTimeDesc(
            String status, Instant start, Instant end);

    List<PaperTrade> findByExitTimeBetweenOrderByExitTimeDesc(Instant start, Instant end);

    List<PaperTrade> findAllByOrderByCreatedAtDesc();

    Page<PaperTrade> findAllByOrderByCreatedAtDesc(Pageable pageable);

    List<PaperTrade> findByCreatedAtBetweenOrderByCreatedAtDesc(Instant start, Instant end);

    long countByStatus(String status);
}
