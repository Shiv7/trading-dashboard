package com.kotsin.dashboard.repository;

import com.kotsin.dashboard.model.entity.ScripGroup;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface ScripGroupRepository extends MongoRepository<ScripGroup, String> {
    List<ScripGroup> findByIdIn(List<String> ids);
}
