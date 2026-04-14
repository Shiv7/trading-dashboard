package com.kotsin.dashboard.repository;

import com.kotsin.dashboard.model.entity.TradeFill;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public interface TradeFillRepository extends MongoRepository<TradeFill, String> {

    List<TradeFill> findByTradeIdOrderByFillTimeMsAsc(String tradeId);

    List<TradeFill> findBySignalIdOrderByFillTimeMsAsc(String signalId);

    List<TradeFill> findByScripCodeAndFillTimeGreaterThanEqualOrderByFillTimeMsAsc(String scripCode, Instant since);

    long countByTradeId(String tradeId);

    long countByFillTimeGreaterThanEqual(Instant since);
}
