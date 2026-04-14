package com.kotsin.dashboard.hotstocks.repository;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface HotStockMetricsRepository extends MongoRepository<HotStockMetricsDoc, String> {
    Optional<HotStockMetricsDoc> findByScripCodeAndTradingDate(String scripCode, LocalDate tradingDate);
    List<HotStockMetricsDoc> findByTradingDate(LocalDate tradingDate);
}
