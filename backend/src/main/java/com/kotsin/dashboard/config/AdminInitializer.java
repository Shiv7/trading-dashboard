package com.kotsin.dashboard.config;

import com.kotsin.dashboard.model.entity.User;
import com.kotsin.dashboard.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.ArrayList;

@Component
public class AdminInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminInitializer.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Value("${admin.default.username:admin}")
    private String adminUsername;

    @Value("${admin.default.email:admin@kotsin.com}")
    private String adminEmail;

    @Value("${admin.default.password:admin123}")
    private String adminPassword;

    public AdminInitializer(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (userRepository.existsByUsername(adminUsername)) {
            log.info("Default admin user '{}' already exists", adminUsername);
            return;
        }

        User admin = User.builder()
                .username(adminUsername)
                .email(adminEmail)
                .passwordHash(passwordEncoder.encode(adminPassword))
                .displayName("Admin")
                .role("ADMIN")
                .enabled(true)
                .preferences(User.UserPreferences.builder()
                        .timezone("Asia/Kolkata")
                        .defaultLotSize(1)
                        .riskTolerance("MODERATE")
                        .preferredInstruments(new ArrayList<>())
                        .notificationSettings(User.NotificationSettings.builder().build())
                        .build())
                .createdAt(LocalDateTime.now())
                .build();

        userRepository.save(admin);
        log.info("Default admin user '{}' created successfully", adminUsername);
    }
}
