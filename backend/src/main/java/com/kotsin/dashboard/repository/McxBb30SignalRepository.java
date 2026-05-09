package com.kotsin.dashboard.repository;

import com.kotsin.dashboard.model.entity.McxBb30SignalEntity;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public interface McxBb30SignalRepository extends MongoRepository<McxBb30SignalEntity, String> {

    Optional<McxBb30SignalEntity> findByDedupKey(String dedupKey);

    List<McxBb30SignalEntity> findByConsumedAtAfterOrderByConsumedAtDesc(Instant after);
}
