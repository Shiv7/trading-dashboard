package com.kotsin.dashboard.repository;

import com.kotsin.dashboard.model.entity.UserTrade;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserTradeRepository extends MongoRepository<UserTrade, String> {

    List<UserTrade> findByUserIdAndWalletTypeAndExitTimeBetweenOrderByExitTimeDesc(
            String userId, String walletType, LocalDateTime start, LocalDateTime end);

    List<UserTrade> findByUserIdAndWalletTypeOrderByExitTimeDesc(String userId, String walletType);

    Page<UserTrade> findByUserIdAndWalletTypeOrderByExitTimeDesc(
            String userId, String walletType, Pageable pageable);

    List<UserTrade> findByUserIdAndWalletTypeAndStatusOrderByEntryTimeDesc(
            String userId, String walletType, String status);

    long countByUserIdAndWalletType(String userId, String walletType);

    long countByUserIdAndWalletTypeAndStatus(String userId, String walletType, String status);

    Optional<UserTrade> findByIdAndUserId(String id, String userId);

    List<UserTrade> findByUserIdAndWalletTypeAndScripCodeOrderByExitTimeDesc(
            String userId, String walletType, String scripCode);
}
