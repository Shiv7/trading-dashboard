package com.kotsin.dashboard.pivotboss;

import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.time.Instant;
import java.util.List;

public interface PivotBossAuditRepository extends MongoRepository<PivotBossAuditDoc, String> {
    List<PivotBossAuditDoc> findByTriggeredAtBetween(Instant from, Instant to, Pageable pageable);
    List<PivotBossAuditDoc> findByDecisionAndTriggeredAtBetween(String decision, Instant from, Instant to, Pageable pageable);
    List<PivotBossAuditDoc> findByScripCodeOrderByTriggeredAtDesc(String scripCode, Pageable pageable);
}
