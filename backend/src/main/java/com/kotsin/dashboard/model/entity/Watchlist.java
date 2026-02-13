package com.kotsin.dashboard.model.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "watchlists")
public class Watchlist {

    @Id
    private String id;

    @Indexed
    private String userId;

    private String name;

    @Builder.Default
    private int sortOrder = 0;

    @Builder.Default
    private List<WatchlistInstrument> instruments = new ArrayList<>();

    @Builder.Default
    private boolean isDefault = false;

    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    private LocalDateTime updatedAt;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class WatchlistInstrument {
        private String scripCode;
        private String symbol;
        private String companyName;
        private String exchange;

        @Builder.Default
        private LocalDateTime addedAt = LocalDateTime.now();

        @Builder.Default
        private int sortOrder = 0;
    }
}
