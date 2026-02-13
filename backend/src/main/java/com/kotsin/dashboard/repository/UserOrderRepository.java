package com.kotsin.dashboard.repository;

import com.kotsin.dashboard.model.entity.UserOrder;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UserOrderRepository extends MongoRepository<UserOrder, String> {

    Page<UserOrder> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    List<UserOrder> findByUserIdAndWalletTypeOrderByCreatedAtDesc(String userId, String walletType);

    List<UserOrder> findByUserIdAndStatusOrderByCreatedAtDesc(String userId, String status);
}
