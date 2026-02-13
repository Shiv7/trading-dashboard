package com.kotsin.dashboard.repository;

import com.kotsin.dashboard.model.entity.UserWallet;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserWalletRepository extends MongoRepository<UserWallet, String> {

    Optional<UserWallet> findByUserIdAndWalletType(String userId, String walletType);

    List<UserWallet> findByUserId(String userId);
}
